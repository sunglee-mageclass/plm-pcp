// Resumo de vendas das telas de Produto Acabado e Importado (F4b, nov/2026).
//
// FONTE ÚNICA, PURA e testável do "Poder de venda · Markup médio (varejo/atacado) · N produtos"
// mostrado no cabeçalho da subcoleção aberta nos dois Sheets (PA e PI). O cálculo é idêntico aos
// dois; o que difere é o CUSTO unitário por produto (PA = cadeia valor/desconto + insumos; PI =
// custo landed de `moeda.ts`), então cada tela monta a sua lista de `LinhaResumoProduto` já com o
// custo calculado do seu jeito, e este módulo só soma.
//
// Decisões do dono (10/nov):
//  - Mostrar os DOIS markups médios (varejo E atacado).
//  - Poder de venda = varejo (mesma base do `ResumoVenda` do Planejamento, pra os números baterem).
//  - SEM gate de permissão de custos nas telas PA/PI (aparece pra quem abre a tela).
//
// Markup real de um canal = preço do canal ÷ custo unitário (só conta quando custo > 0 e preço > 0,
// igual ao `computeResumo` do Planejamento, que só soma `markupReal > 0`). A média é aritmética
// simples dos produtos que têm markup — não ponderada por peças —, idêntica ao Planejamento.

export type LinhaResumoProduto = {
  /** Σ peças do produto (todas as variantes/tamanhos). */
  pecas: number;
  /** Custo unitário previsto da peça (já na moeda final, BRL). 0/nulo = sem custo → sem markup. */
  custoUnit: number | null;
  /** Preço de venda VAREJO da peça (preço efetivo do canal varejo). null = sem preço. */
  precoVarejo: number | null;
  /** Preço de venda ATACADO da peça. null = sem preço. */
  precoAtacado: number | null;
};

export type ResumoProduto = {
  /** Poder de venda VAREJO = Σ (preço varejo × peças) dos produtos com preço varejo. */
  poderVarejo: number;
  /** Poder de venda ATACADO = Σ (preço atacado × peças) dos produtos com preço atacado. */
  poderAtacado: number;
  /** Média aritmética do markup real varejo (preço varejo ÷ custo) dos que o têm; 0 = nenhum. */
  markupVarejo: number;
  /** Média aritmética do markup real atacado (preço atacado ÷ custo) dos que o têm; 0 = nenhum. */
  markupAtacado: number;
  /** Nº de produtos no resumo (todos, com ou sem preço — espelha o `qtd` do ResumoVenda). */
  qtd: number;
};

const positivo = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) && v > 0 ? v : null;

/** Calcula o resumo de vendas de uma lista de produtos. Puro. */
export function resumoProduto(linhas: LinhaResumoProduto[]): ResumoProduto {
  let poderVarejo = 0;
  let poderAtacado = 0;
  let somaMkVarejo = 0;
  let nMkVarejo = 0;
  let somaMkAtacado = 0;
  let nMkAtacado = 0;

  for (const l of linhas) {
    const custo = positivo(l.custoUnit);
    const pv = positivo(l.precoVarejo);
    const pa = positivo(l.precoAtacado);
    const pecas = Math.max(0, l.pecas);

    if (pv != null) poderVarejo += pv * pecas;
    if (pa != null) poderAtacado += pa * pecas;
    // markup real só quando há custo E preço do canal (espelha `markupReal > 0` do Planejamento)
    if (custo != null && pv != null) {
      somaMkVarejo += pv / custo;
      nMkVarejo++;
    }
    if (custo != null && pa != null) {
      somaMkAtacado += pa / custo;
      nMkAtacado++;
    }
  }

  return {
    poderVarejo,
    poderAtacado,
    markupVarejo: nMkVarejo > 0 ? somaMkVarejo / nMkVarejo : 0,
    markupAtacado: nMkAtacado > 0 ? somaMkAtacado / nMkAtacado : 0,
    qtd: linhas.length,
  };
}
