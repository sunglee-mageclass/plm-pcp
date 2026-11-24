/* eslint-disable @typescript-eslint/no-explicit-any -- `etiquetas`/`variantes_etiqueta` fora do types.ts (regen pendente): `as any` no builder, como a tela de Insumos de hoje */
// Gravação da grade "Lista tipo Excel" de Cadastro > Insumos. A MESMA regra da tela de hoje (`cadastro.etiquetas.tsx`, Sheet):
//   cabeçalho (insumo) → `etiquetas`.update(payload).eq("id") DIRETO. Insumo NÃO tem `rev`: sem trava otimista, "último vence".
//   variantes (cores)  → DELETE-AND-REINSERT por insumo: `variantes_etiqueta`.delete().eq("etiqueta_id") + .insert(...), EXPANDINDO cada
//                        linha de COR em N variantes (1 por tamanho marcado; cor sem tamanho = 1 variante com tamanho null; cor vazia
//                        → cor_id null). O gatilho do banco acerta `etiquetas.preco = MAX(preço das variantes)` ao inserir. Sem RPC atômica.
// A diferença do aviamento (RPC de lote com guarda): aqui o conjunto é regravado INTEIRO e só quando as cores mudaram. Se o INSERT falha
// depois do DELETE, tenta-se RESTAURAR as variantes de antes (melhor esforço) para o insumo não ficar sem cores.
// Este arquivo é PURO em React: só `supabase`, texto PT-BR e a ordem do UM Salvar.
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  tamanhoVinculadoParaSalvar,
  vinculoAtivoDoRegistro,
  vinculoLigadoSemTamanho,
} from "@/lib/insumo-tamanho";
import { blocosIguais } from "./celulas";

/** Falha de validação/servidor com texto PT-BR pronto para a linha que não gravou. */
export class ErroGrade extends Error {
  /** Onde o erro nasceu: o cabeçalho ou as cores (a grade abre as cores escondidas quando o erro é delas). */
  alvo: "cabecalho" | "variantes";
  constructor(mensagem: string, alvo: "cabecalho" | "variantes" = "cabecalho") {
    super(mensagem);
    this.name = "ErroGrade";
    this.alvo = alvo;
  }
}

// ============================== Rascunho do INSUMO ==============================

/** Linha de COR no rascunho. `cor_id === ""` = "sem cor" (o Salvar grava `cor_id || null`). `tamanhos` = chaves "num|sigla". */
export type BlocoDraft = { cor_id: string; preco: number | null; tamanhos: string[] };

/**
 * Rascunho do INSUMO na grade: o cabeçalho (nomes = colunas de `etiquetas`) + as cores. `vincular` é o "switch" do tamanho vinculado
 * (não é coluna): ligado só vale se `vinculoDisponivel`. Vazio ("" ou só espaço) é sempre `null`.
 */
export type InsumoDraft = {
  nome: string;
  tipo_insumo_id: string | null;
  unidade: string;
  empresa_id: string | null;
  representante_id: string | null;
  preco: number | null;
  formato_tamanho: string;
  vincular: boolean;
  tamanho_vinculado: string | null;
  observacoes: string | null;
  blocos: BlocoDraft[];
};

/** Os campos do insumo que a grade lê (subconjunto do `InsumoEntrada`/`GradeInsumoCompleto`). */
export type InsumoParaDraft = {
  nome: string | null;
  tipo_insumo_id: string | null;
  unidade: string | null;
  empresa_id: string | null;
  representante_id?: string | null;
  preco: number | null;
  formato_tamanho: string | null;
  tamanho_vinculado: string | null;
  observacoes: string | null;
};

/** vazio ("" ou só espaço) = null: o rascunho nunca fica "sujo" por trocar null por "". */
const vazioNulo = (v: string | null | undefined): string | null =>
  v == null || v.trim() === "" ? null : v;
const numeroOuNulo = (v: number | string | null | undefined): number | null =>
  v == null || v === "" ? null : Number(v);

/** Linha do servidor -> rascunho (a base do `useCardDraft`; a tela MEMOIZA o resultado). Insumo sem cor = `blocos: []`. */
export function insumoParaDraft(
  i: InsumoParaDraft,
  blocos: readonly { cor_id: string; preco: number | null; tamanhos: string[] }[] = [],
): InsumoDraft {
  // Mesmo ponto de partida do `openEdit` do Sheet: o toggle começa ligado quando há tamanho vinculado, com o valor sem espaços.
  const vincular = vinculoAtivoDoRegistro(i.tamanho_vinculado);
  return {
    nome: i.nome ?? "",
    tipo_insumo_id: i.tipo_insumo_id ?? null,
    unidade: i.unidade ?? "unidade",
    empresa_id: i.empresa_id ?? null,
    representante_id: i.representante_id ?? null,
    preco: numeroOuNulo(i.preco),
    formato_tamanho: i.formato_tamanho ?? "ambos",
    vincular,
    tamanho_vinculado: vincular
      ? tamanhoVinculadoParaSalvar({
          ativo: true,
          tamanho: i.tamanho_vinculado,
          formato: "nenhum",
          blocos: [],
        })
      : null,
    observacoes: vazioNulo(i.observacoes),
    blocos: blocos.map((b) => ({
      cor_id: b.cor_id ?? "",
      preco: numeroOuNulo(b.preco),
      tamanhos: [...b.tamanhos],
    })),
  };
}

/** Formato "nenhum" = insumo sem tamanho: as cores valem SEM tamanho (o Salvar grava tamanho null), sem perder a marcação do rascunho. */
export function blocosEfetivos(
  formato: string | null | undefined,
  blocos: readonly BlocoDraft[],
): BlocoDraft[] {
  return blocos.map((b) => (formato === "nenhum" ? { ...b, tamanhos: [] } : b));
}

/** Cada cor vira N variantes (1 por tamanho marcado; sem tamanho = 1 variante só da cor; cor "" = `cor_id` null). */
export function expandirBlocos(
  blocos: readonly BlocoDraft[],
): { tamanho: string | null; cor_id: string | null; preco: number | null }[] {
  return blocos.flatMap((b) =>
    (b.tamanhos.length === 0 ? [null] : b.tamanhos).map((t) => ({
      tamanho: t,
      cor_id: b.cor_id || null,
      preco: b.preco ?? null,
    })),
  );
}

/** Há cor repetida em 2 linhas? (a cor "sem cor" também não pode repetir: o índice único da variante não deixaria). */
export function temCorRepetida(blocos: readonly BlocoDraft[]): boolean {
  const vistas = new Set<string>();
  for (const b of blocos) {
    if (vistas.has(b.cor_id)) return true;
    vistas.add(b.cor_id);
  }
  return false;
}

const CAMPOS_DO_VINCULO: ReadonlyArray<keyof InsumoDraft> = [
  "vincular",
  "tamanho_vinculado",
  "formato_tamanho",
  "blocos",
];

/**
 * Valida o estado FINAL (base + campos tocados) antes de gravar qualquer coisa do insumo — `ErroGrade` em PT-BR:
 * nome vazio, cor repetida, vínculo ligado sem tamanho escolhido.
 */
export function validarInsumo(mudancas: Partial<InsumoDraft>, base: InsumoDraft): void {
  const final: InsumoDraft = { ...base, ...mudancas };
  if ("nome" in mudancas && final.nome.trim() === "")
    throw new ErroGrade("Informe o nome do insumo.");
  if ("blocos" in mudancas && temCorRepetida(final.blocos))
    throw new ErroGrade("Há mais de uma linha para a mesma cor neste insumo.", "variantes");
  if (
    CAMPOS_DO_VINCULO.some((k) => k in mudancas) &&
    vinculoLigadoSemTamanho({
      ativo: final.vincular,
      tamanho: final.tamanho_vinculado,
      formato: final.formato_tamanho,
      blocos: blocosEfetivos(final.formato_tamanho, final.blocos),
    })
  )
    throw new ErroGrade("Escolha o tamanho vinculado ou desligue o vínculo.");
}

/**
 * Rascunho (só os campos TOCADOS) -> payload do UPDATE de `etiquetas`. Texto vazio = null; fornecedor e representante andam juntos
 * (tocar um manda os dois). `tamanho_vinculado` é normalizado por `tamanhoVinculadoParaSalvar` (Ruling A2: o Salvar limpa o
 * vínculo que não vale — toggle desligado, sem tamanho ou com tamanho marcado numa cor) e só vai quando o vínculo, o formato ou as
 * cores foram tocados e o resultado difere do que já está salvo. `vincular` não é coluna.
 */
export function montarPayloadInsumo(
  mudancas: Partial<InsumoDraft>,
  base: InsumoDraft,
): Record<string, unknown> {
  const final: InsumoDraft = { ...base, ...mudancas };
  const p: Record<string, unknown> = {};
  if ("nome" in mudancas) p.nome = (mudancas.nome ?? "").trim();
  if ("tipo_insumo_id" in mudancas) p.tipo_insumo_id = mudancas.tipo_insumo_id || null;
  if ("unidade" in mudancas) p.unidade = mudancas.unidade;
  if ("empresa_id" in mudancas || "representante_id" in mudancas) {
    p.empresa_id = ("empresa_id" in mudancas ? mudancas.empresa_id : base.empresa_id) || null;
    p.representante_id =
      ("representante_id" in mudancas ? mudancas.representante_id : base.representante_id) || null;
  }
  if ("preco" in mudancas) p.preco = mudancas.preco ?? null;
  if ("formato_tamanho" in mudancas) p.formato_tamanho = mudancas.formato_tamanho;
  if ("observacoes" in mudancas) p.observacoes = mudancas.observacoes?.trim() || null;
  if (CAMPOS_DO_VINCULO.some((k) => k in mudancas)) {
    const novo = tamanhoVinculadoParaSalvar({
      ativo: final.vincular,
      tamanho: final.tamanho_vinculado,
      formato: final.formato_tamanho,
      blocos: blocosEfetivos(final.formato_tamanho, final.blocos),
    });
    const atual = base.vincular ? base.tamanho_vinculado : null;
    if (novo !== atual) p.tamanho_vinculado = novo;
  }
  return p;
}

/** Texto PT-BR do erro do UPDATE do cabeçalho (23505 = nome repetido na loja: `uq_etiquetas_tenant_nome`). */
export function mensagemSalvarInsumo(e: unknown): string {
  if ((e as { code?: string } | null)?.code === "23505")
    return "Já existe um insumo com esse nome.";
  return mensagemErro(e, "Erro ao salvar o insumo.");
}

/** Texto PT-BR do erro de regravar as cores (23505 = cor+tamanho repetidos; 23503 = variante em uso). */
export function mensagemSalvarVariantes(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code === "23505") return "Já existe uma variante com essa cor e tamanho neste insumo.";
  if (code === "23503")
    return "Uma das cores está em uso (OC, estoque ou modelo) e não pode ser trocada ou removida.";
  return mensagemErro(e, "Erro ao salvar as cores.");
}

/** UPDATE DIRETO do cabeçalho ("último vence": sem rev). 0 linhas devolvidas = o insumo sumiu (excluído) ou a loja não o enxerga. */
export async function atualizarInsumo(
  insumoId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await (supabase.from("etiquetas" as any) as any)
    .update(payload)
    .eq("id", insumoId)
    .select("id");
  if (error) throw new ErroGrade(mensagemSalvarInsumo(error));
  if (!data || data.length === 0) {
    throw new ErroGrade(
      "Este insumo não foi encontrado (talvez tenha sido excluído por outra pessoa). Recarregue a lista.",
    );
  }
}

/**
 * Regrava as variantes do insumo: apaga TODAS e insere as expandidas (cor × tamanho). Se o INSERT falhar depois do DELETE, tenta
 * restaurar as de antes (`antes`, o estado da leitura) para não deixar o insumo sem cores — e o erro original sobe em PT-BR.
 */
export async function regravarVariantes(
  insumoId: string,
  novos: readonly BlocoDraft[],
  antes: readonly BlocoDraft[],
): Promise<void> {
  const del = await (supabase.from("variantes_etiqueta" as any) as any)
    .delete()
    .eq("etiqueta_id", insumoId);
  if (del.error) throw new ErroGrade(mensagemSalvarVariantes(del.error), "variantes");
  const linhas = expandirBlocos(novos).map((v) => ({ ...v, etiqueta_id: insumoId }));
  if (linhas.length === 0) return;
  const ins = await (supabase.from("variantes_etiqueta" as any) as any).insert(linhas);
  if (ins.error) {
    const anteriores = expandirBlocos(antes).map((v) => ({ ...v, etiqueta_id: insumoId }));
    if (anteriores.length > 0) {
      try {
        await (supabase.from("variantes_etiqueta" as any) as any).insert(anteriores);
      } catch {
        /* melhor esforço: o erro original é o que importa */
      }
    }
    throw new ErroGrade(mensagemSalvarVariantes(ins.error), "variantes");
  }
}

/**
 * Salva UM insumo (cabeçalho e, se as cores mudaram, as variantes). Ordem: valida tudo → UPDATE do cabeçalho (só campos tocados) →
 * regrava as variantes. "Último vence" por insumo. As cores só são regravadas se o conjunto EFETIVO difere do que foi lido (formato
 * "nenhum" zera os tamanhos); o gatilho do banco recalcula `etiquetas.preco = MAX` ao inserir (ver nota no Report).
 */
export async function salvarInsumo(
  mudancas: Partial<InsumoDraft>,
  base: InsumoDraft,
  insumoId: string,
): Promise<void> {
  validarInsumo(mudancas, base);
  const payload = montarPayloadInsumo(mudancas, base);
  if (Object.keys(payload).length > 0) await atualizarInsumo(insumoId, payload);
  const final: InsumoDraft = { ...base, ...mudancas };
  const novos = blocosEfetivos(final.formato_tamanho, final.blocos);
  if (!blocosIguais(novos, blocosEfetivos(base.formato_tamanho, base.blocos))) {
    await regravarVariantes(insumoId, novos, blocosEfetivos(base.formato_tamanho, base.blocos));
  }
}

// ============================== UM Salvar (insumos, resultado parcial) ==============================

export type CtxSalvar = { limite?: number };

export type ItemInsumo = {
  id: string;
  dirty: () => boolean;
  salvar: (ctx: CtxSalvar) => Promise<void>;
};

export type ResultadoSalvarTudo = { ok: number; erro: number };

/** Texto PT-BR do aviso na linha que não gravou. */
export function textoErroSalvar(e: unknown): string {
  if (e instanceof ErroGrade) return e.message;
  return mensagemErro(e, "Erro ao salvar.");
}

/**
 * UM Salvar: cada insumo sujo grava (cabeçalho + cores) em sequência. PARCIAL: a falha de um insumo (nome repetido, cor repetida,
 * variante em uso…) não derruba os outros — fica sujo, com o aviso na própria linha.
 */
export async function salvarEmOrdem(
  insumos: ItemInsumo[],
  ctx: { limite?: number } = {},
): Promise<ResultadoSalvarTudo> {
  const r: ResultadoSalvarTudo = { ok: 0, erro: 0 };
  for (const item of insumos) {
    if (!item.dirty()) continue;
    try {
      await item.salvar(ctx);
      r.ok++;
    } catch {
      r.erro++;
    }
  }
  return r;
}

/** Texto do toast do Salvar ("3 salvos, 1 com erro"). `tom` diz qual toast usar. */
export function textoResultadoSalvar(r: ResultadoSalvarTudo): {
  tom: "sucesso" | "aviso" | "erro";
  texto: string;
} {
  const partes: string[] = [];
  if (r.ok > 0) partes.push(`${r.ok} ${r.ok === 1 ? "salvo" : "salvos"}`);
  if (r.erro > 0) partes.push(`${r.erro} com erro`);
  if (partes.length === 0) return { tom: "aviso", texto: "Nada para salvar." };
  const texto = `${partes.join(", ")}.`;
  if (r.erro === 0) return { tom: "sucesso", texto };
  return { tom: r.ok > 0 ? "aviso" : "erro", texto: `${texto} Veja o aviso na linha.` };
}
