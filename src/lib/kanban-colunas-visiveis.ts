// F6 Fluxo 1 (A2) — filtro de Etapas do kanban: a pessoa escolhe quais colunas ver (individual,
// persiste via useFilterState). Seleção VAZIA = sem filtro (todas). Preserva a ordem original.
//
// A3b (dono 11/nov): a PRIMEIRA e a ÚLTIMA coluna configurável do board (a entrada e a saída do
// fluxo) ficam SEMPRE visíveis — nunca somem pelo filtro, mesmo que a seleção não as inclua. Só as
// do MEIO podem ser escondidas. (A coluna terminal sintética "Lançado" já é renderizada fora deste
// filtro pelo board; aqui `colunas` = apenas `statusKanban`.)
export function colunasVisiveis<T extends { key: string }>(colunas: readonly T[], selecao: readonly string[]): T[] {
  if (selecao.length === 0) return [...colunas];
  const sel = new Set(selecao);
  const primeira = colunas[0]?.key;
  const ultima = colunas[colunas.length - 1]?.key;
  return colunas.filter((c) => sel.has(c.key) || c.key === primeira || c.key === ultima);
}
