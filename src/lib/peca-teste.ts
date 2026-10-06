// Peça Teste (R9, plan-c) — lib PURA. Núcleo do requisito do kanban "Peça teste aprovada" (T3); a T6 estende com o estado da seção,
// status, payload e merge.
//
// ESPELHO EXATO da SQL (não reimplementar em outro lugar):
//   - `pecaTesteAprovadaTrilha` ≡ `public._peca_teste_aprovada(linha, tipo, fornecedor da linha)` (193000): considera SÓ as
//     tentativas do TIPO ATUAL da linha (`categoria_id`; o SQL filtra por `mo_linha_id` E `categoria_terceirizado_id`, então trocar
//     o tipo da linha deixa as tentativas do tipo antigo escondidas — Ruling 4); entre elas, a ATUAL (maior número) está 'aprovado'
//     E o fornecedor CONGELADO na decisão é o fornecedor ATUAL da linha (null × null conta, como o `IS NOT DISTINCT FROM` do SQL).
//     Sem tentativa = false. Linha sem tipo (`categoria_id` null) nunca casa (a coluna da tabela é NOT NULL; `= NULL` do SQL não
//     devolve linha). O chamador NÃO filtra: passa as tentativas da linha como vieram. Não olha o switch nem a M.O.
//   - `pecaTesteAprovadaModelo` ≡ a chave `peca_teste_aprovada` de `_avaliar_condicoes_kanban_core` (194000): TODA linha de M.O. cujo
//     tipo exige peça teste tem a M.O. APROVADA (`aprovado === true`) E a trilha aprovada. Sem linha exigindo = cumprido (vácuo).
// Anti-drift SQL × TS: `tests/fixtures/peca-teste-casos.ts` (unit + `tests/integration/urgc-r9-kanban.test.ts`).

export type AprovacaoPecaTeste = "aprovado" | "reprovado" | null;

/** Tentativa da trilha como o requisito a vê: tipo de serviço sob o qual foi lançada (`categoria_id`), número, decisão e o
 *  fornecedor CONGELADO na decisão (`empresa_id` da tentativa). */
export type TentativaRequisito = {
  categoria_id: string | null;
  numero: number;
  aprovacao: AprovacaoPecaTeste;
  empresa_id: string | null;
};

/** Linha de M.O. do card como o requisito a vê. `categoria_id` = o tipo de serviço ATUAL da linha (null = "Geral (legado)").
 *  `exige` = esse tipo (da loja) tem "Exige peça teste" ligado (linha sem tipo = false). `empresa_id` = o fornecedor ATUAL da
 *  linha. `tentativas` = as tentativas da linha (de QUALQUER tipo que ela já teve; a função filtra pelo tipo atual). */
export type LinhaRequisito = {
  categoria_id: string | null;
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

/** Espelho de `_peca_teste_aprovada`: entre as tentativas do TIPO ATUAL da linha, a atual está 'aprovado' E o fornecedor
 *  congelado = o fornecedor atual da linha. */
export function pecaTesteAprovadaTrilha(linha: Pick<LinhaRequisito, "categoria_id" | "empresa_id" | "tentativas">): boolean {
  const doTipo = linha.categoria_id === null ? [] : linha.tentativas.filter((t) => t.categoria_id === linha.categoria_id);
  const atual = tentativaAtual(doTipo);
  return atual !== null && atual.aprovacao === "aprovado" && (atual.empresa_id ?? null) === (linha.empresa_id ?? null);
}

/** Espelho da condição `peca_teste_aprovada`: toda linha que exige tem M.O. aprovada E peça teste aprovada. Vazio = true. */
export function pecaTesteAprovadaModelo(linhas: readonly LinhaRequisito[]): boolean {
  return linhas.every((l) => !l.exige || (l.mo_aprovado === true && pecaTesteAprovadaTrilha(l)));
}
