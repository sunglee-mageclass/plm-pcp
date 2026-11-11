// F6 Fluxo 1 (A2) — filtro de Etapas do kanban: a pessoa escolhe quais colunas ver (individual,
// persiste via useFilterState). Seleção VAZIA = sem filtro (todas). Preserva a ordem original.
export function colunasVisiveis<T extends { key: string }>(colunas: readonly T[], selecao: readonly string[]): T[] {
  if (selecao.length === 0) return [...colunas];
  const sel = new Set(selecao);
  return colunas.filter((c) => sel.has(c.key));
}
