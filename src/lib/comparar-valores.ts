// Comparador único das ordenações de lista/tabela (usado por `useSort` e pela grade de Tecidos).
export type SortDir = "asc" | "desc";

/**
 * Comparador único da ordenação: vazios (null/undefined/"") SEMPRE por último (em asc e em desc), número-vs-número
 * numericamente, o resto por `localeCompare` pt-BR (numeric, sem acento/caixa). `dir` só inverte a ordem dos NÃO vazios.
 * Exportado para quem ordena fora de uma lista plana (ex.: grade de Tecidos, que ordena grupos) com a MESMA regra do `useSort`.
 */
export function compararValores(av: unknown, bv: unknown, dir: SortDir): number {
  const aEmpty = av == null || av === "";
  const bEmpty = bv == null || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // vazios por último
  if (bEmpty) return -1;
  const an = Number(av), bn = Number(bv);
  const numeric = !Number.isNaN(an) && !Number.isNaN(bn) && typeof av !== "boolean" && typeof bv !== "boolean";
  const cmp = numeric
    ? an - bn
    : String(av).localeCompare(String(bv), "pt-BR", { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}
