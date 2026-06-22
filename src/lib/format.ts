/**
 * Formatação numérica padrão pt-BR: decimais com vírgula, milhares com ponto,
 * SEMPRE 2 casas decimais (ex.: 3,80 — não 3,8; 1.234,50).
 */
export function fmtNum(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  if (n === "" || v === null || v === undefined || Number.isNaN(v as number)) return "0,00";
  return (v as number).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Moeda pt-BR (R$ 1.234,50). Fonte única — não duplicar `const brl` por tela.
 */
export function brl(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Para campos editáveis: pt-BR, mínimo 2 casas mas até 4 (não arredonda valores
 * de alta precisão como consumo de aviamento ao exibir).
 */
export function fmtNumEdit(n: number | string | null | undefined): string {
  if (n === "" || n === null || n === undefined) return "";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
