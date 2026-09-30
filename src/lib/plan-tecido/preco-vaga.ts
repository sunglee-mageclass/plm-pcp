import type { PtSlot } from "./types";
import { precoInfo, precoDoCard, type PrecoInfo } from "@/lib/preco";

/** Preço/custo/markup do CARD do modelo (null = não disponível). Vem do Sheet (`precoDoCard`). */
export type PrecoCardFn = (modeloId: string) => PrecoInfo | null;

/**
 * Termo de UMA vaga no poder de venda = preço efetivo × grade.
 * Vaga COM card (modelo_id + preço do card disponível): preço efetivo do CARD (P-167 A).
 * Vaga SEM card: a estimativa da vaga (custo estimado + markup da linha da vaga + preco_venda da vaga).
 */
export function termoPoderDeVenda(
  slot: PtSlot,
  grade: number,
  precoCard: PrecoInfo | null | undefined,
  estimativa: { custo: number; markup: number },
): number {
  if (slot.modelo_id && precoCard && precoCard.efetivo > 0) return precoCard.efetivo * grade;
  return precoInfo(estimativa.custo, estimativa.markup, slot.preco_venda ?? null, slot.markup_editado ?? null).efetivo * grade;
}

/**
 * Preço do CARD para o poder de venda (builder puro de `precoCardDe`).
 * `custoMap` undefined = `custo_unitario_modelos` ainda NÃO carregou => null (estimativa de hoje).
 * Carregou mas mascarado (`{}`/modelo ausente/custo 0 = sem permissão de custos): card COM preço digitado
 * usa o digitado; card SEM preço digitado tem efetivo 0 e `termoPoderDeVenda` cai na estimativa (nunca conta 0).
 */
export function precoCardDoPlano(
  modeloId: string,
  modelos: { id: string; linha_id?: string | null; preco_venda?: unknown; markup_editado?: unknown }[] | null | undefined,
  custoMap: Record<string, { real?: unknown } | undefined> | undefined,
  linhaMarkupMap: Record<string, unknown> | null | undefined,
): PrecoInfo | null {
  if (!custoMap) return null;
  const m = (modelos ?? []).find((x) => x.id === modeloId);
  if (!m) return null;
  return precoDoCard(m, custoMap, linhaMarkupMap);
}

/** Quebra de custo do CARD (derivada no servidor em `modelos.custo_*_total`). null = mascarado/indisponível. */
export type CustoCardDetalhe = { tecido: number; forro: number; entretela: number; aviamento: number };

/**
 * Detalhe do custo do card p/ a vaga COM card. Sem permissão de custos / custo ainda carregando
 * (`temCusto` false) ou modelo ausente => null (a UI mostra "—"). Nunca usa a estimativa da vaga.
 */
export function custoDetalheDoCard(
  modelo: { custo_tecido_total?: unknown; custo_forro_total?: unknown; custo_entretela_total?: unknown; custo_aviamento_total?: unknown } | null | undefined,
  temCusto: boolean,
): CustoCardDetalhe | null {
  if (!modelo || !temCusto) return null;
  const n = (v: unknown) => Number(v) || 0;
  return { tecido: n(modelo.custo_tecido_total), forro: n(modelo.custo_forro_total), entretela: n(modelo.custo_entretela_total), aviamento: n(modelo.custo_aviamento_total) };
}

/** Texto do poder de venda no Resumo: "calculando…" enquanto o custo dos cards carrega (há vaga com card). */
export function poderVendaCalculando(pendente: boolean, temSlotComCard: boolean): boolean {
  return pendente && temSlotComCard;
}
