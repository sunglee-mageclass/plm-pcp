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
