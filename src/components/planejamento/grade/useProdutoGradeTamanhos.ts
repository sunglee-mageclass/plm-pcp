/* eslint-disable @typescript-eslint/no-explicit-any -- `sigla_sku` (cor/apelido) e colunas novas fora do types.ts: `as any` no builder, como as queries da ficha */
// PR-GRADE-1 — dados da GRADE DE TAMANHOS de UM produto (modelo), para a linha EXPANDIDA da Lista tipo Excel. LEITURA (a EDIÇÃO da
// revenda, PR-GRADE-2, mora em `useRascunhoGradeRevenda`; este hook só entrega os dados + o `rev` lido junto, base do CAS).
//
// ⚠️ SOB DEMANDA: este hook só é montado quando a linha é EXPANDIDA (`ProdutoLinhaExpandida` só existe expandida) e
// `ativo` liga as queries — NUNCA carrega a grade de todos os modelos de uma vez.
//
// Fontes (as MESMAS do Sheet — nada novo no banco, ZERO migration):
//  - INTERNO: cores = variantes do Tecido 1 (`modelo_tecidos` tipo=tecido/numero=1 → `modelo_tecido_variantes` por `ordem`,
//    parando no 1º buraco, igual a `tecido1VarianteIds`); `num` = posição 1..N (= `modelo_grades.variante_numero`); rótulo
//    `labelVarianteRowComSigla` (cor · apelido com sigla, o mesmo da seção Grade do Sheet).
//  - COMPRADO (revenda/importado): cores = `produto_acabado_variantes` / `produto_importado_variantes` por `ordem`
//    (`num` = `ordem` = `variante_numero`); colunas = tamanhos do tenant ∩ `grade_proporcao` do produto (como `useGradeComprado`).
//  - GRADE: `modelo_grades` (`variante_numero`, `grades` jsonb {tamanho:qtd}, `grade_total`).
//  - TAMANHOS: `tenant_config.tamanhos_grade`, filtrados por "Tamanho em" (`tamanhosVisiveis`, só EXIBIÇÃO); Acessórios = ["UN"].
//    Tamanho com quantidade lançada NUNCA some (esmaece ou entra no fim) — o total da linha sempre bate com o que se vê.
// Erro de leitura LANÇA (regra C3): nunca "sem cores" por falha de rede.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { normalizarOrigem, type Origem } from "@/lib/origem";
import { labelVarianteRowComSigla, varianteLabel } from "@/lib/variante";
import { tamanhosVisiveis, tipoEfetivo, type TamanhoVisivel } from "@/lib/tamanho-exibicao";
import { MOTIVO_ENVIADO_EXPLOSAO, MOTIVO_IMPORTADO } from "@/lib/produto-grade/grade-revenda";

export type CorGrade = { num: number; label: string };

/** Mesmo fallback de `useFichaDados` quando a loja ainda não configurou `tamanhos_grade`. */
const TAMANHOS_PADRAO = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

// (os motivos de trava moraram aqui na PR-GRADE-1; agora vêm de `lib/produto-grade/grade-revenda` — mesma fonte da edição)
export { MOTIVO_ENVIADO_EXPLOSAO, MOTIVO_IMPORTADO };

type LinhaGradeDb = {
  variante_numero: number;
  grades: Record<string, number> | null;
  grade_total: number | null;
};

/** Chave do cache da grade de UM produto (a edição da revenda a relê por aqui no P0409/depois de salvar). */
export const chaveGradeTamanhos = (modeloId: string | null, origem: Origem) =>
  ["modelos-planejamento", "grade-tamanhos", modeloId, origem] as const;

export type DadosBrutos = {
  /** `modelos.rev` lido ANTES da grade (revenda): base do CAS da edição. Rev velho só falha por P0409 (seguro). `null` = interno/importado. */
  rev: number | null;
  cores: CorGrade[];
  grades: Record<number, Record<string, number>>;
  totais: Record<number, number>;
  /** Comprado: chaves de `grade_proporcao` (colunas = tenant ∩ isto). `null` = interno (sem filtro). */
  proporcao: string[] | null;
  /** Comprado sem produto vinculado (estado válido: card ainda sem OC) — diferente de erro. */
  semProduto: boolean;
};

const PRODUTO_POR_ORIGEM: Record<"revenda" | "importado", { tabela: string; select: string }> = {
  revenda: {
    tabela: "produtos_acabados",
    select:
      "id, grade_proporcao, variantes:produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
  },
  importado: {
    tabela: "produtos_importados",
    select:
      "id, grade_proporcao, variantes:produto_importado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
  },
};

async function lerGrades(modeloId: string): Promise<LinhaGradeDb[]> {
  const { data, error } = await supabase
    .from("modelo_grades")
    .select("variante_numero, grades, grade_total")
    .eq("modelo_id", modeloId);
  if (error) throw error;
  return (data ?? []) as unknown as LinhaGradeDb[];
}

async function lerInterno(modeloId: string): Promise<{ cores: CorGrade[]; rows: LinhaGradeDb[] }> {
  const { data: tecidos, error } = await (supabase.from("modelo_tecidos") as any)
    .select("id")
    .eq("modelo_id", modeloId)
    .eq("tipo", "tecido")
    .eq("numero", 1);
  if (error) throw error;
  const t1 = ((tecidos ?? []) as { id: string }[])[0];
  const cores: CorGrade[] = [];
  if (t1) {
    const { data: vs, error: e2 } = await (supabase.from("modelo_tecido_variantes") as any)
      .select(
        "ordem, variante_tecido_id, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome, sigla_sku), apelido:cor_apelido_id(nome, sigla_sku))",
      )
      .eq("modelo_tecido_id", t1.id)
      .order("ordem");
    if (e2) throw e2;
    const porOrdem = new Map<number, any>();
    for (const v of (vs ?? []) as any[]) porOrdem.set(Number(v.ordem ?? 1), v);
    // Em ordem, parando no 1º buraco (igual a `tecido1VarianteIds`): `num` = posição 1..N = `variante_numero`.
    for (let ord = 1; porOrdem.has(ord) && porOrdem.get(ord).variante_tecido_id; ord++) {
      const l = labelVarianteRowComSigla(porOrdem.get(ord).variantes_tecido);
      cores.push({ num: ord, label: l !== "—" ? l : `Variante ${ord}` });
    }
  }
  return { cores, rows: await lerGrades(modeloId) };
}

async function lerComprado(
  modeloId: string,
  origem: "revenda" | "importado",
): Promise<{
  cores: CorGrade[];
  proporcao: string[];
  semProduto: boolean;
  rows: LinhaGradeDb[];
  rev: number | null;
}> {
  const cfg = PRODUTO_POR_ORIGEM[origem];
  const { data, error } = await (supabase.from(cfg.tabela as any) as any)
    .select(cfg.select)
    .eq("modelo_id", modeloId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { cores: [], proporcao: [], semProduto: true, rows: [], rev: null };
  const variantes = [...((data.variantes ?? []) as any[])].sort((a, b) => a.ordem - b.ordem);
  const cores = variantes.map((v) => ({
    num: Number(v.ordem),
    label: varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome }),
  }));
  const proporcao = Object.keys((data.grade_proporcao ?? {}) as Record<string, number>);
  // Revenda (a única que edita na lista): o `rev` é lido ANTES da grade — se alguém salvar no meio, o rev fica mais VELHO que a grade e o
  // Salvar dá P0409 (relê); nunca o contrário (rev novo com grade velha deixaria regravar por cima).
  let rev: number | null = null;
  if (origem === "revenda") {
    const { data: m, error: eRev } = await (supabase.from("modelos") as any)
      .select("rev")
      .eq("id", modeloId)
      .maybeSingle();
    if (eRev) throw eRev;
    rev = typeof m?.rev === "number" ? m.rev : null;
  }
  return { cores, proporcao, semProduto: false, rows: await lerGrades(modeloId), rev };
}

function lerTamanhosTenant(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.length > 0)
    return raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))));
  return TAMANHOS_PADRAO;
}

export function useProdutoGradeTamanhos({
  modeloId,
  origem,
  tamanhoTipo,
  acessorio,
  enviadoCad,
  ativo,
}: {
  modeloId: string | null;
  origem: string | null | undefined;
  /** `modelos.tamanho_tipo` (exibição: Letra/Número). */
  tamanhoTipo: string | null | undefined;
  /** Grupo do produto = Acessórios → grade única "UN". */
  acessorio: boolean;
  enviadoCad: boolean | null | undefined;
  /** Liga as queries. Só `true` quando a linha está EXPANDIDA (carregamento sob demanda). */
  ativo: boolean;
}) {
  const origemN: Origem = normalizarOrigem(origem);
  const tenantId = useActiveTenantId();
  const on = ativo && !!modeloId;

  // queryKey com o MESMO prefixo da grade (["modelos-planejamento", ...]): a invalidação do salvar/Realtime de `modelos` refresca
  // as linhas ABERTAS (as fechadas não têm query ativa — não custam nada).
  const q = useQuery({
    queryKey: chaveGradeTamanhos(modeloId, origemN),
    enabled: on,
    queryFn: async (): Promise<DadosBrutos> => {
      const id = modeloId as string;
      let cores: CorGrade[];
      let rows: LinhaGradeDb[];
      let proporcao: string[] | null = null;
      let semProduto = false;
      let rev: number | null = null;
      if (origemN === "interno") {
        ({ cores, rows } = await lerInterno(id));
      } else {
        ({ cores, rows, proporcao, semProduto, rev } = await lerComprado(id, origemN));
      }
      const grades: Record<number, Record<string, number>> = {};
      const totais: Record<number, number> = {};
      for (const r of rows) {
        const g: Record<string, number> = {};
        for (const [k, v] of Object.entries(r.grades ?? {})) g[k] = Number(v) || 0;
        grades[r.variante_numero] = g;
        totais[r.variante_numero] = r.grade_total ?? Object.values(g).reduce((s, v) => s + v, 0);
      }
      return { rev, cores, grades, totais, proporcao, semProduto };
    },
  });

  // Tamanhos ativos do tenant (ordem canônica). Chave "tenant-…" → a Config da Loja/Realtime invalidam (`matchTenantConfig`).
  const qTam = useQuery({
    queryKey: ["tenant-produto-grade-tamanhos", tenantId],
    enabled: on && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return lerTamanhosTenant((data as any)?.tamanhos_grade);
    },
  });

  const dados = q.data;
  const tenantTamanhos = qTam.data;

  const colunas = useMemo<TamanhoVisivel[]>(() => {
    if (!dados) return [];
    const comValor = new Set<string>();
    for (const g of Object.values(dados.grades))
      for (const [t, v] of Object.entries(g)) if (v > 0) comValor.add(t);
    let out: TamanhoVisivel[];
    if (acessorio) {
      out = [{ chave: "UN", rotulo: "UN", esmaecido: false }];
    } else {
      if (!tenantTamanhos) return [];
      const base = dados.proporcao
        ? tenantTamanhos.filter((t) => dados.proporcao!.includes(t))
        : tenantTamanhos;
      out = tamanhosVisiveis(base, tipoEfetivo(tamanhoTipo), comValor);
    }
    // Quantidade lançada em tamanho fora da lista (ex.: tamanho removido da loja) NUNCA some: entra no fim.
    const naLista = new Set(out.map((c) => c.chave));
    for (const t of comValor)
      if (!naLista.has(t)) out.push({ chave: t, rotulo: t, esmaecido: false });
    return out;
  }, [dados, tenantTamanhos, acessorio, tamanhoTipo]);

  const tamanhos = useMemo(() => colunas.map((c) => c.chave), [colunas]);

  const motivoSomenteLeitura = enviadoCad
    ? MOTIVO_ENVIADO_EXPLOSAO
    : origemN === "importado"
      ? MOTIVO_IMPORTADO
      : null;

  return {
    origem: origemN,
    /** `modelos.rev` de quando a grade foi lida (revenda; base do CAS da edição). */
    rev: dados?.rev ?? null,
    cores: dados?.cores ?? ([] as CorGrade[]),
    tamanhos,
    colunas,
    gradePorCor: dados?.grades ?? ({} as Record<number, Record<string, number>>),
    gradeTotal: dados?.totais ?? ({} as Record<number, number>),
    semProduto: dados?.semProduto ?? false,
    carregando: on && (q.isLoading || (!acessorio && qTam.isLoading)),
    // Erro só SEM dado: uma releitura que falha com a grade já na tela (rascunho em edição!) não pode trocá-la por um aviso e perder o que foi digitado.
    erro: (q.isError && !q.data
      ? q.error
      : qTam.isError && !qTam.data
        ? qTam.error
        : null) as Error | null,
    recarregar: () =>
      Promise.all([q.isError ? q.refetch() : null, qTam.isError ? qTam.refetch() : null]),
    /** Trava de leitura por motivo ESTRUTURAL (enviado à Explosão; importado grava pela ficha). A permissão/tela só-leitura vêm de `motivoGradeRevendaSomenteLeitura`. */
    somenteLeitura: !!enviadoCad || origemN === "importado",
    motivoSomenteLeitura,
  };
}

export type GradeTamanhosProduto = ReturnType<typeof useProdutoGradeTamanhos>;
