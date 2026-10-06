// Peça Teste (R9, plan-c) — lib PURA. Núcleo do requisito do kanban "Peça teste aprovada" (T3); a T6 estende com o estado da seção,
// status, payload e merge.
//
// ESPELHO EXATO da SQL (não reimplementar em outro lugar):
//   - `pecaTesteAprovadaTrilha` ≡ `public._peca_teste_aprovada(linha, tipo, fornecedor da linha)` (193000): a tentativa ATUAL (maior
//     número) está 'aprovado' E o fornecedor CONGELADO na decisão é o fornecedor ATUAL da linha (null × null conta, como o
//     `IS NOT DISTINCT FROM` do SQL). Sem tentativa = false. Não olha o switch nem a M.O.
//   - `pecaTesteAprovadaModelo` ≡ a chave `peca_teste_aprovada` de `_avaliar_condicoes_kanban_core` (194000): TODA linha de M.O. cujo
//     tipo exige peça teste tem a M.O. APROVADA (`aprovado === true`) E a trilha aprovada. Sem linha exigindo = cumprido (vácuo).
// Anti-drift SQL × TS: `tests/fixtures/peca-teste-casos.ts` (unit + `tests/integration/urgc-r9-kanban.test.ts`).

export type AprovacaoPecaTeste = "aprovado" | "reprovado" | null;

/** Tentativa da trilha como o requisito a vê: número, decisão e o fornecedor CONGELADO na decisão (`empresa_id` da tentativa). */
export type TentativaRequisito = {
  numero: number;
  aprovacao: AprovacaoPecaTeste;
  empresa_id: string | null;
};

/** Linha de M.O. do card como o requisito a vê. `exige` = o tipo de serviço da linha (da loja) tem "Exige peça teste" ligado
 *  (linha sem tipo = false). `empresa_id` = o fornecedor ATUAL da linha. `tentativas` = as da trilha (linha × tipo ATUAL). */
export type LinhaRequisito = {
  exige: boolean;
  mo_aprovado: boolean | null;
  empresa_id: string | null;
  tentativas: TentativaRequisito[];
};

/** A tentativa ATUAL da trilha = a de maior número (null sem tentativa). */
export function tentativaAtual<T extends { numero: number }>(tentativas: readonly T[]): T | null {
  let atual: T | null = null;
  for (const t of tentativas) if (atual === null || t.numero > atual.numero) atual = t;
  return atual;
}

/** Espelho de `_peca_teste_aprovada`: tentativa atual 'aprovado' E fornecedor congelado = o fornecedor atual da linha. */
export function pecaTesteAprovadaTrilha(linha: Pick<LinhaRequisito, "empresa_id" | "tentativas">): boolean {
  const atual = tentativaAtual(linha.tentativas);
  return atual !== null && atual.aprovacao === "aprovado" && (atual.empresa_id ?? null) === (linha.empresa_id ?? null);
}

/** Espelho da condição `peca_teste_aprovada`: toda linha que exige tem M.O. aprovada E peça teste aprovada. Vazio = true. */
export function pecaTesteAprovadaModelo(linhas: readonly LinhaRequisito[]): boolean {
  return linhas.every((l) => !l.exige || (l.mo_aprovado === true && pecaTesteAprovadaTrilha(l)));
}
