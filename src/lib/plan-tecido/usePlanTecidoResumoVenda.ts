import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "./types";
import { custoMateriaisPrevisto, slotContaNaDemanda } from "./calc";
import { resumoVendaSubcolecao, type PrecoCardFn } from "./preco-vaga";

/**
 * F4b (nov/2026) — resumo de vendas da subcoleção do Plan. Tecido para o cabeçalho (Modo Plano):
 * poder de venda + markup médio + nº de vagas. Reusa as MESMAS queries do `ResumoPanel`
 * (queryKeys idênticas → o React Query dedupe; nenhuma requisição extra quando o painel está
 * montado) e a MESMA função pura `resumoVendaSubcolecao`, então o número do cabeçalho nunca
 * diverge do rail "Poder de venda (previsto)".
 *
 * O PT tem preço de venda ÚNICO (sem atacado) — por isso um poder/markup só, ao contrário de PA/PI.
 */
export function usePlanTecidoResumoVenda(
  arvore: PtArvore | null | undefined,
  precoCardDe: PrecoCardFn | undefined,
  reprovadoStatusSet: ReadonlySet<string> | undefined,
  /** F4b: só as vagas VISÍVEIS (filtros de status + linha da tela) entram no PV/markup. Ausente = todas. */
  slotVisivel?: (slot: PtSlot) => boolean,
): { poder: number; markupMedio: number; qtd: number } {
  const slots = arvore ? arvore.subcolecoes.flatMap((sub) => sub.linhas.flatMap((ln) => ln.slots)) : [];
  const firstTec = (slot: PtSlot) => slot.materiais.find((m) => m.tipo === "tecido");

  const artigoIds = [...new Set(slots.flatMap((s) => s.materiais).map((m) => m.artigo_id).filter((x): x is string => !!x))].sort();
  const { data: fornecSet = new Set<string>() } = useQuery({
    queryKey: ["plan-tecido-artigo-fornecedor", artigoIds],
    enabled: artigoIds.length > 0,
    queryFn: async () => {
      const rows = ((await supabase.from("artigos").select("id, empresa_id").in("id", artigoIds)).data ?? []) as { id: string; empresa_id: string | null }[];
      return new Set(rows.filter((r) => r.empresa_id).map((r) => r.id));
    },
  });

  const { data: markupMap = {} } = useQuery({
    queryKey: ["plan-tecido-linhas-markup"],
    queryFn: async () => {
      const rows = ((await supabase.from("linhas").select("id, markup")).data ?? []) as { id: string; markup: number | null }[];
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.markup) || 0])) as Record<string, number>;
    },
  });

  const moModeloIds = [...new Set(slots.map((s) => s.modelo_id).filter((x): x is string => !!x))].sort();
  const { data: moTotalMap = {} } = useQuery({
    queryKey: ["plan-tecido-resumo-mo", moModeloIds],
    enabled: moModeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: moModeloIds });
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const [id, v] of Object.entries((data ?? {}) as Record<string, { total: number | null }>)) map[id] = Number(v?.total) || 0;
      return map;
    },
  });

  // P-212 A: card reprovado (cortado ou não) fora do poder de venda — mesmo filtro `venda` do ResumoPanel.
  // F4b: além disso, só as vagas VISÍVEIS (filtros de status + linha da tela) entram — o cabeçalho soma
  // só o que está à mostra (decisão do dono). `slotVisivel` ausente = todas (ex.: cálculo fora da tela).
  const venda = slots.filter((s) => slotContaNaDemanda(s, reprovadoStatusSet) && (slotVisivel ? slotVisivel(s) : true));
  const comFornec = (slot: PtSlot) => { const t = firstTec(slot); return !!t?.artigo_id && fornecSet.has(t.artigo_id); };
  const gradeDe = (slot: PtSlot) => (firstTec(slot)?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
  const custoDe = (slot: PtSlot) => custoMateriaisPrevisto(slot) + (Number((slot.custo_simulado as { materiais?: number } | null)?.materiais) || 0) + (slot.modelo_id ? (moTotalMap[slot.modelo_id] ?? 0) : 0);
  const markupDe = (slot: PtSlot) => (slot.linha_id ? (markupMap[slot.linha_id] ?? 0) : 0);

  return resumoVendaSubcolecao(venda, { comFornec, gradeDe, custoDe, markupDe, precoCardDe });
}
