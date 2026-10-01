/**
 * Totais da aba "Serviços a Pagar" do Financeiro (fin #7).
 * "A pagar" soma SÓ as parcelas não pagas (a pagar + vencidas); "Pago" soma as pagas.
 * O rótulo segue o número: nunca "Total a pagar" sobre uma soma que inclui pagas.
 */
export type StatusServico = "pago" | "vencido" | "a_pagar";

export function totaisServicos<T extends { valor_parcela?: number | string | null }>(
  rows: T[],
  stOf: (r: T) => StatusServico,
): { pago: number; aPagar: number; total: number } {
  let pago = 0;
  let aPagar = 0;
  for (const r of rows) {
    const v = Number(r.valor_parcela || 0);
    if (stOf(r) === "pago") pago += v;
    else aPagar += v;
  }
  return { pago, aPagar, total: pago + aPagar };
}
