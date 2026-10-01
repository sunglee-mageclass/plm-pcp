/** Mínimo de uma parcela p/ decidir se fica na lista do Financeiro. */
export type ParcelaCanc = {
  oc_tecido_id?: string | null;
  status?: string | null;
  data_pagamento?: string | null;
};

/** Paga = mesma regra do `effectiveStatus` do Financeiro (status "pago" OU data de pagamento). */
export const parcelaPaga = (p: ParcelaCanc): boolean => p.status === "pago" || !!p.data_pagamento;

/**
 * OC de tecido cancelada (todos os itens cancelados): some só a parcela NÃO paga. A paga continua
 * visível (é dinheiro que saiu) e ganha o selo "OC cancelada" (`ocCancelada: true`).
 */
export function aplicarOcCancelada<P extends ParcelaCanc>(
  parcelas: P[],
  ocsCanceladas: ReadonlySet<string>,
): (P & { ocCancelada: boolean })[] {
  const out: (P & { ocCancelada: boolean })[] = [];
  for (const p of parcelas) {
    const canc = !!p.oc_tecido_id && ocsCanceladas.has(p.oc_tecido_id);
    if (canc && !parcelaPaga(p)) continue;
    out.push({ ...p, ocCancelada: canc });
  }
  return out;
}
