import type { PtSlot } from "./types";
import { precoInfo, type PrecoInfo } from "@/lib/preco";

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
  if (slot.modelo_id && precoCard) return precoCard.efetivo * grade;
  return precoInfo(estimativa.custo, estimativa.markup, slot.preco_venda ?? null, slot.markup_editado ?? null).efetivo * grade;
}
