// P-53 A (set/2026) — o Sheet unificado do Planejamento decide POR SEÇÃO/CAMPO pelas DUAS
// permissões (`criacao_planejamento` e `criacao_desenvolvimento`), em vez de herdar a trava da
// PÁGINA onde foi aberto (bug achado na revisão da parte 1: aberto no kanban do Dev, quem edita
// o Dev e só VÊ o Planejamento ganharia poderes de Planejamento — Excluir, Duplicar, Lançar…).
//
// Princípio "nem ganha, nem perde": um campo/ação é editável se e só se o usuário podia editá-lo
// em PELO MENOS UM dos dois Sheets antigos, com as permissões dele:
//   (Sheet antigo do Planejamento E canEdit("criacao_planejamento")) OU
//   (Sheet antigo do Dev — ModeloDetailPanel.tsx, payload do Salvar :1878-1945 e as ações do
//    cabeçalho/rodapé — E canEdit("criacao_desenvolvimento") E o Dev não travado pós-Explosão).
// Vale em QUALQUER tela que monte o PlanejamentoDetail (Planejamento, kanban do Dev, Produto Acabado).
export type EntradaPermSheet = { podeEditarPlanejamento: boolean; podeEditarDev: boolean; devBloqueado: boolean };
export type PermSheet = {
  /** Nada editável: o Sheet inteiro fica só-leitura (fieldset do SheetContent, via ReadOnlyScope). */
  sheetSomenteLeitura: boolean;
  /** Campos/seções que só o Sheet antigo do Planejamento editava (ex.: status, origem, NCM, título,
   *  peso/medidas, data de lançamento). */
  planBloqueado: boolean;
  /** Campos que os DOIS Sheets antigos editavam (nome, estilista, linha, categoria, coleção…, anexos, MO…). */
  compartilhadoBloqueado: boolean;
  /** Ações de ciclo do Planejamento: Excluir, Duplicar, Enviar/Cancelar Ordem, Lançar/Cancelar, Produto Relacionado. */
  podeAcoesPlanejamento: boolean;
};
export function resolverPermissoesSheet(e: EntradaPermSheet): PermSheet {
  return {
    sheetSomenteLeitura: !(e.podeEditarPlanejamento || e.podeEditarDev),
    planBloqueado: !e.podeEditarPlanejamento,
    compartilhadoBloqueado: !(e.podeEditarPlanejamento || !e.devBloqueado),
    podeAcoesPlanejamento: e.podeEditarPlanejamento,
  };
}
