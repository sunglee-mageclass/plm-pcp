// F3.2 — decisão F3 #6 (aprovada 22/set): o markup e a tabela da seção "Preço e Custos" usam o MESMO
// custo-base, com selo de 3 estados. Ordem: real (CAD enviado ao corte = `custo_unitario_modelos.
// confirmado`) › previsto do BOM › estimativa (tecido × preço/m + materiais + M.O.). Puro; testado.
import type { TotaisBom } from "./ficha/ficha-calc";

export type SeloCusto = "estimado" | "previsto" | "real";

/** Previsto AO VIVO da ficha: só vale quando o BOM tem material (M.O. sozinha não é "previsto do BOM"). */
export function previstoDaFicha(t: TotaisBom): number {
  return t.materiaisBom > 0 ? t.peca : 0;
}

export function baseCustoPlanejamento(i: { confirmado: boolean; realServidor: unknown; previsto: unknown; estimativa: unknown }): { valor: number; selo: SeloCusto } {
  if (i.confirmado) return { valor: Number(i.realServidor) || 0, selo: "real" };
  const prev = Number(i.previsto) || 0;
  if (prev > 0) return { valor: prev, selo: "previsto" };
  const est = Number(i.estimativa) || 0;
  return { valor: est > 0 ? est : 0, selo: "estimado" };
}
