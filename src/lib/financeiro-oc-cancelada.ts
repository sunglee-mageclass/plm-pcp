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

/** OC de tecido "cancelada" = tem ≥1 item e TODOS estão cancelados. */
export const ocTecidoCancelada = (
  itens: ReadonlyArray<{ cancelado?: boolean | null }> | null | undefined,
): boolean => !!itens && itens.length > 0 && itens.every((it) => !!it.cancelado);

/** Texto do tooltip do "Desmarcar" desabilitado (parcela PAGA de OC cancelada). */
export const MOTIVO_NAO_DESMARCAR_OC_CANCELADA =
  "OC cancelada — para desfazer o pagamento, reabra a OC";

/**
 * Desmarcar pago numa parcela de OC cancelada a faria sumir do Financeiro (a não paga de OC cancelada
 * é escondida) sem como remarcar → só se desmarca quando a OC NÃO está cancelada.
 */
export const podeDesmarcarPagamento = (p: { ocCancelada?: boolean | null }): boolean =>
  !p.ocCancelada;
