// F3.4 — grade cor × tamanho do produto COMPRADO (revenda E importado) no Sheet do Planejamento: a FONTE ÚNICA da grade
// do comprado (decisão F3 #4 — a "Grade por variante do Tecido 1" é só do interno). Texto MOVIDO de
// `useRevendaPlanejamento.ts` (a grade da revenda — Task 7 do Produto Acabado, extraída na F3.0) + o produto espelho lido
// POR ORIGEM (`produtos_acabados` na revenda, `produtos_importados` no importado — mesmo formato: variantes por `ordem`,
// `grade_proporcao`, grupo). A grade mora em `modelo_grades` com `variante_numero` = `ordem` da variante do produto
// (`_criar_card_produto_*_core` e `_aplicar_produto_ao_modelo_core` gravam assim). MESMA queryKey de antes p/ a grade
// (`["modelo-grades-revenda", modeloId]` — o Salvar invalida/recarrega por ela) e os MESMOS nomes de estado/refs (o
// `usePlanejamentoSave` os recebe sem mudar). ORDEM IMPORTA: o orquestrador chama este hook logo depois de
// `useRevendaPlanejamento` (antes dos effects de seed de MO e do merge do colab) — o seed copia `revRef.current`.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import { type Opt } from "@/components/planejamento/modelo-shared";
import { linhasGradeComprado } from "@/components/planejamento/planejamento-detail/comprado";

export type ProdutoComprado = {
  id: string;
  colecao_id: string | null;
  grupo_id: string | null;
  grade_proporcao: Record<string, number> | null;
  variantes: { ordem: number; cor: { nome: string | null } | null; apelido: { nome: string | null } | null }[] | null;
};

/**
 * Produto espelho por origem — SÓ p/ a grade (variantes, proporção, grupo) e a seção do produto. A regra da Origem NÃO lê
 * daqui (G-plano F3.4 R3: este produto só é lido com o módulo da origem SALVA ligado — "módulo off" viraria "sem produto"
 * e liberaria o 2º espelho); ela usa os DOIS espelhos de `plan-origem-espelhos` (Task 6). Embeds sem ambiguidade: exatamente
 * 1 FK em cada par (plano F3.4 §1).
 */
const PRODUTO_POR_ORIGEM: Record<"revenda" | "importado", { tabela: string; select: string }> = {
  revenda: {
    tabela: "produtos_acabados",
    select: "id, colecao_id, grupo_id, grade_proporcao, variantes:produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
  },
  importado: {
    tabela: "produtos_importados",
    select: "id, colecao_id, grupo_id, grade_proporcao, variantes:produto_importado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
  },
};

export function useGradeComprado({ modeloId, isEdit, origem, moduloOn, grupos, tenantIdAtivo, revRef, aoEditar }: {
  modeloId: string | null;
  isEdit: boolean;
  /** Origem SALVA do card (a do servidor — a troca no Select só vale depois do Salvar). */
  origem: string;
  /** Módulo da origem ligado (`produto_acabado` p/ revenda, `produto_importado` p/ importado). */
  moduloOn: boolean;
  grupos: Opt[];
  tenantIdAtivo: string;
  /** rev otimista do header (colab) — o seed da grade copia `revRef.current`. Passar o REF, não o valor. */
  revRef: RefObject<number | null>;
  /** Chamado a cada célula editada (importado: marca a ficha — a grade grava pelo BOM, plano F3.4 §3). */
  aoEditar?: () => void;
}) {
  const cfgProduto = origem === "revenda" || origem === "importado" ? PRODUTO_POR_ORIGEM[origem] : null;
  const on = isEdit && !!modeloId && !!cfgProduto && moduloOn;
  const aoEditarRef = useRef(aoEditar);
  aoEditarRef.current = aoEditar;

  // Grade cor×tamanho — estado/refs (texto movido): o rascunho entra no `dirty` combinado do orquestrador; a query/efeito
  // de seed e os handlers ficam abaixo (closures sobre o mesmo state, ordem de hooks fixa).
  const [gradeRevenda, setGradeRevenda] = useState<Record<number, Record<string, number>>>({});
  const gradeRevendaSeededRef = useRef(false);
  const gradeRevendaBaseRef = useRef("{}");
  // Trava otimista da grade da REVENDA (`salvar_grade_revenda`): rev de `modelos` capturado no momento em que a grade foi
  // LIDA do servidor (seed inicial OU recarga após P0409) — INDEPENDENTE de `revRef` (ver o comentário no `usePlanejamentoSave`).
  // No importado não é usada: a grade grava pelo BOM, sob o `.eq("rev")` do header (plano F3.4 §3).
  const gradeRevendaRevRef = useRef<number | null>(null);
  const gradeRevendaDirty = gradeRevendaSeededRef.current && JSON.stringify(gradeRevenda) !== gradeRevendaBaseRef.current;

  const { data: produto, isLoading: produtoLoading } = useQuery({
    queryKey: ["plan-comprado-produto", modeloId, origem],
    enabled: on,
    queryFn: async () => {
      if (!cfgProduto) return null;
      const { data, error } = await (supabase.from(cfgProduto.tabela as any) as any)
        .select(cfgProduto.select)
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProdutoComprado | null;
    },
  });
  const grupoNome = grupos.find((g) => g.id === produto?.grupo_id)?.nome ?? null;
  const acessorio = ehGrupoAcessorio(grupoNome);
  // Tamanhos ativos do tenant (ordem canônica) — mesma fonte/fallback do planejador Produto Acabado; colunas da grade =
  // interseção com `grade_proporcao` (texto movido; o `enabled` passa a valer p/ os dois comprados).
  const { data: tenantTamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-planejamento", tenantIdAtivo],
    enabled: !!tenantIdAtivo && on,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantIdAtivo).maybeSingle();
      const raw = (data as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });
  const variantesRevenda = useMemo(
    () => [...(produto?.variantes ?? [])].sort((a, b) => a.ordem - b.ordem),
    [produto],
  );
  const tamanhosRevenda = useMemo(() => {
    if (acessorio) return ["UN"];
    const prop = produto?.grade_proporcao ?? {};
    return tenantTamanhos.filter((t) => Object.prototype.hasOwnProperty.call(prop, t));
  }, [acessorio, produto, tenantTamanhos]);

  // Grade cor×tamanho — lê `modelo_grades` (variante_numero=ordem) e semeia 1× por abertura do card (texto movido: o
  // detalhe nasce/some por inteiro a cada abrir/fechar, então um refetch em BG nunca perde edição).
  const { data: gradeModeloRows } = useQuery({
    queryKey: ["modelo-grades-revenda", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_grades")
        .select("variante_numero, grades, grade_total")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      return (data ?? []) as { variante_numero: number; grades: Record<string, number> | null; grade_total: number }[];
    },
  });
  useEffect(() => {
    if (!gradeModeloRows || gradeRevendaSeededRef.current) return;
    const seeded: Record<number, Record<string, number>> = {};
    for (const r of gradeModeloRows) seeded[r.variante_numero] = { ...(r.grades ?? {}) };
    setGradeRevenda(seeded);
    gradeRevendaBaseRef.current = JSON.stringify(seeded);
    // Best-effort: `revRef` já deve estar semeado a essa altura (a query de `modelo` carrega
    // em paralelo, sem dependência entre as duas) — se ainda estiver null (corrida rara), o
    // 1º Salvar cai no bypass (`_rev_base: null`); qualquer conflito de verdade continua pego
    // pelo retry do header, que dispara a recarga da grade via `gradeConflict`.
    gradeRevendaRevRef.current = revRef.current;
    gradeRevendaSeededRef.current = true;
  }, [gradeModeloRows]);
  const setCelulaGradeRevenda = (ordem: number, tam: string, v: number) => {
    aoEditarRef.current?.();
    setGradeRevenda((prev) => ({ ...prev, [ordem]: { ...(prev[ordem] ?? {}), [tam]: Math.max(0, Math.trunc(v) || 0) } }));
  };
  const totalLinhaRevenda = (ordem: number) =>
    Object.values(gradeRevenda[ordem] ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalColunaRevenda = (tam: string) =>
    variantesRevenda.reduce((s, v) => s + (Number(gradeRevenda[v.ordem]?.[tam]) || 0), 0);
  const totalGeralRevenda = variantesRevenda.reduce((s, v) => s + totalLinhaRevenda(v.ordem), 0);
  // Payload da grade — estado COMPLETO (linha ausente = apagada no servidor): `salvar_grade_revenda` (revenda) e o
  // `_grades` do `salvar_modelo_bom` (comprado — plano F3.4 §3). Mesma conta de antes (`linhasGradeComprado`).
  const buildLinhasGradeRevenda = () => linhasGradeComprado(gradeRevenda);

  return {
    origem, produto: produto ?? null, produtoLoading,
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
    buildLinhasGradeRevenda,
  };
}

export type GradeComprado = ReturnType<typeof useGradeComprado>;
