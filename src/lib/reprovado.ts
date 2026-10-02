// Card REPROVADO — fonte única no TS (P-213 A / P-215 A). Reprovado = `status_desenvolvimento` OU
// `status_planejamento` = 'reprovado' (sem diferenciar maiúsculas). Espelha o predicado do banco
// `lower(COALESCE(status_desenvolvimento,''))='reprovado' OR lower(COALESCE(status_planejamento,''))='reprovado'`
// (`_otb_colecao_totais`, `_otb_orcamento_core`, `_dashboard_colecao_core`, `_dashboard_producao_core`).
export type ComStatus = {
  status_desenvolvimento?: string | null;
  status_planejamento?: string | null;
};

/** Forma posicional (status do Dev, status do Planejamento) — a implementação do predicado no TS (a variante com trim
 *  dos gates é `ehReprovadoNoGate`, abaixo; nada de cópia inline fora deste arquivo).
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

/** Variante dos GATES por posição (kanban / Enviar à Explosão / REF): mesma regra, mas com `trim` — espelha o SQL
 *  `_kanban_norm(x) = lower(btrim(coalesce(x,'')))` de `_kanban_status_gate` / `_enviar_modelo_para_cad_core` e o `normKey`
 *  do `statusParaGate`. Não trocar por `ehReprovadoStatus` (sem trim, espelho do OTB/dashboards/estoque): o par
 *  (gate NULL, reprovado) tem de concordar com o servidor. Revisão final B2: as cópias inline do TS usam esta. */
export function ehReprovadoNoGate(
  statusDesenvolvimento: string | null | undefined,
  statusPlanejamento?: string | null,
): boolean {
  const n = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return n(statusDesenvolvimento) === "reprovado" || n(statusPlanejamento) === "reprovado";
}
