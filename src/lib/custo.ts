// Custos adicionais por peça (`modelos.custos_adicionais` = [{descricao, valor}]).
// Fonte ÚNICA usada pelo front (Desenvolvimento, CAD, Serviços) para o custo "seguir para
// frente" sem divergir. No servidor, o mesmo Σ é somado no SQL (custo_unitario_modelos e
// _dashboard_custos_core). Entram no PREVISTO e no REAL; a Previsão de Mão de Obra não.
export function somaCustosAdicionais(custos: unknown): number {
  if (!Array.isArray(custos)) return 0;
  return custos.reduce((s: number, c: unknown) => {
    const v = Number((c as { valor?: unknown } | null)?.valor);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
}
