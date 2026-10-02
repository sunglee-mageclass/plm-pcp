// Card REPROVADO — fonte única no TS (P-213 A / P-215 A). Reprovado = `status_desenvolvimento` OU
// `status_planejamento` = 'reprovado' (sem diferenciar maiúsculas). Espelha o predicado do banco
// `lower(COALESCE(status_desenvolvimento,''))='reprovado' OR lower(COALESCE(status_planejamento,''))='reprovado'`
// (`_otb_colecao_totais`, `_otb_orcamento_core`, `_dashboard_colecao_core`, `_dashboard_producao_core`).
export type ComStatus = {
  status_desenvolvimento?: string | null;
  status_planejamento?: string | null;
};

/** Forma posicional (status do Dev, status do Planejamento) — a ÚNICA implementação do predicado no TS.
 *  `plan-tecido/calc.ts` reexporta como `ehReprovado(dev, plan)` (junção L4 I1). */
export function ehReprovadoStatus(
  statusDesenvolvimento: string | null | undefined,
  statusPlanejamento?: string | null,
): boolean {
  return (statusDesenvolvimento ?? "").toLowerCase() === "reprovado" || (statusPlanejamento ?? "").toLowerCase() === "reprovado";
}

export function ehReprovado(m: ComStatus | null | undefined): boolean {
  return ehReprovadoStatus(m?.status_desenvolvimento, m?.status_planejamento);
}
