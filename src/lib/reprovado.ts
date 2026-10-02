// Card REPROVADO — fonte única no TS (P-213 A / P-215 A). Reprovado = `status_desenvolvimento` OU
// `status_planejamento` = 'reprovado' (sem diferenciar maiúsculas). Espelha o predicado do banco
// `lower(COALESCE(status_desenvolvimento,''))='reprovado' OR lower(COALESCE(status_planejamento,''))='reprovado'`
// (`_otb_colecao_totais`, `_otb_orcamento_core`, `_dashboard_colecao_core`, `_dashboard_producao_core`).
export type ComStatus = {
  status_desenvolvimento?: string | null;
  status_planejamento?: string | null;
};

export function ehReprovado(m: ComStatus | null | undefined): boolean {
  return (
    (m?.status_desenvolvimento ?? "").toLowerCase() === "reprovado" ||
    (m?.status_planejamento ?? "").toLowerCase() === "reprovado"
  );
}
