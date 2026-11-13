// Peça Teste — o REQUISITO "peça teste aprovada" (reforma por TIPO, nov/2026). Lib PURA, espelho EXATO da SQL (não reimplementar em outro lugar):
//   - `pecaTesteAprovadaTipo` ≡ `public._peca_teste_aprovada_tipo(modelo, tipo)` (20261129110000): a tentativa ATUAL (maior número) do tipo
//     está 'aprovado'. Sem tentativa = false. NÃO compara fornecedor (é da tentativa), NÃO olha a M.O. nem o switch.
//   - `pecaTesteAprovadaModelo` ≡ a chave `peca_teste_aprovada` de `_avaliar_condicoes_kanban_core` / `_avaliar_condicoes_etapas_pl_core`
//     (via a casca `_peca_teste_aprovada`): TODA linha de M.O. cujo tipo exige peça teste tem a M.O. APROVADA (`aprovado === true`) E a
//     trilha do TIPO aprovada. Sem linha exigindo = cumprido (vácuo). Trilha de tipo SEM linha de M.O. não participa (ruling R2).
//   - `statusPecaTesteModelo` ≡ `_peca_teste_status_lote_core` (20261129130000).
// Anti-drift SQL × TS: `tests/fixtures/peca-teste-tipo-casos.ts` (unit `peca-teste-requisito.test.ts` + integração `peca-teste-tipo-antidrift.test.ts`).
// `peca-teste.ts` (a seção do Sheet) re-exporta tudo daqui.

export type AprovacaoPecaTeste = "aprovado" | "reprovado" | null;

// ════════════════════════════════ requisito (espelho do SQL) ════════════════════════════════
/** Tentativa como o requisito a vê: o TIPO sob o qual foi lançada, o número e a decisão. `data_saida` só o selo da lista usa. */
export type TentativaRequisito = {
  categoria_id: string;
  numero: number;
  aprovacao: AprovacaoPecaTeste;
  data_saida?: string | null;
};
/** Linha de M.O. do card. `categoria_id` null = "Geral (legado)". `exige` = o tipo (da loja) tem "Exige peça teste" ligado. */
export type LinhaRequisito = { categoria_id: string | null; exige: boolean; mo_aprovado: boolean | null };
/** O card como o requisito o vê: as linhas de M.O. e TODAS as tentativas do card (de qualquer tipo; a função filtra por tipo). */
export type ModeloRequisito = { linhas: readonly LinhaRequisito[]; tentativas: readonly TentativaRequisito[] };

/** A tentativa ATUAL da trilha = a de maior número (null sem tentativa). */
export function tentativaAtual<T extends { numero: number }>(tentativas: readonly T[]): T | null {
  let atual: T | null = null;
  for (const t of tentativas) if (atual === null || t.numero > atual.numero) atual = t;
  return atual;
}

/** Espelho de `_peca_teste_aprovada_tipo`: entre as tentativas do tipo, a atual está 'aprovado'. Tipo null (linha sem tipo) nunca casa. */
export function pecaTesteAprovadaTipo(tentativas: readonly TentativaRequisito[], categoriaId: string | null): boolean {
  if (categoriaId === null) return false;
  const atual = tentativaAtual(tentativas.filter((t) => t.categoria_id === categoriaId));
  return atual !== null && atual.aprovacao === "aprovado";
}

/** Espelho da condição `peca_teste_aprovada`: toda linha que exige tem M.O. aprovada E a trilha do tipo aprovada. Vazio = true. */
export function pecaTesteAprovadaModelo(m: ModeloRequisito): boolean {
  return m.linhas.every((l) => !l.exige || (l.mo_aprovado === true && pecaTesteAprovadaTipo(m.tentativas, l.categoria_id)));
}

/** Status da peça teste do modelo para o SELO/FILTRO da lista de Serviços (4 estados):
 *  "nao_exige" (nenhuma linha com tipo que exige) · "aprovada" (todas as linhas que exigem estão ok) · "em_teste" (não aprovada, mas
 *  alguma trilha que exige já tem tentativa com data de saída) · "falta" (não aprovada e nenhuma iniciada). */
export type StatusPecaTesteModelo = "nao_exige" | "falta" | "em_teste" | "aprovada";
export function statusPecaTesteModelo(m: ModeloRequisito): StatusPecaTesteModelo {
  const exigem = m.linhas.filter((l) => l.exige);
  if (exigem.length === 0) return "nao_exige";
  if (pecaTesteAprovadaModelo(m)) return "aprovada";
  const iniciada = exigem.some((l) => l.categoria_id !== null && m.tentativas.some((t) => t.categoria_id === l.categoria_id && !!t.data_saida));
  return iniciada ? "em_teste" : "falta";
}
