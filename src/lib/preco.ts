/**
 * Lógica de formação de preço (Planejamento) — fonte única.
 *
 * Preço efetivo = preço para venda se houver, senão o preço sugerido
 * (custo × markup aplicado, arredondado). markup real = efetivo ÷ custo.
 *
 * Os 3 markups: "sugerido" (markupLinha, consulta — do Cadastro), "aplicado"
 * (markupAplicado, editável por modelo — forma o preço) e "real" (markupReal,
 * derivado do preço de venda). markupAplicado = markup_editado do modelo
 * (congelado) quando > 0, senão o sugerido da linha.
 */

/**
 * Preço sugerido: arredonda PRA CIMA até o próximo valor da grade que termina em
 * 4,90 ou 9,90 (passo 5 a partir de 4,90). Ex.: 14,67 → 14,90; 437,98 → 439,90.
 * (Os limites 4,90/9,90 virarão config da loja depois.)
 */
export function precoSugerido(v: number): number {
  if (!(v > 0)) return 0;
  const k = Math.max(0, Math.ceil((v - 4.9) / 5 - 1e-9));
  return Math.round((5 * k + 4.9) * 100) / 100;
}

export type PrecoInfo = {
  custo: number;
  markupLinha: number; // sugerido — consulta, do Cadastro (linha)
  markupAplicado: number; // aplicado — editado por modelo (markup_editado) quando > 0, senão o sugerido
  preco: number; // custo × markup aplicado
  sugerido: number; // preco arredondado
  efetivo: number; // preço para venda se houver, senão o sugerido
  markupReal: number; // efetivo ÷ custo (0 se não dá p/ calcular)
  markupExibir: number; // markup real se houver, senão o aplicado
};

export function precoInfo(custo: unknown, markupLinha: unknown, precoVenda: unknown, markupEditado?: unknown): PrecoInfo {
  const c = Number(custo) || 0;
  const mkLinha = Number(markupLinha) || 0;
  const mkEditado = Number(markupEditado) || 0;
  const mkAplicado = mkEditado > 0 ? mkEditado : mkLinha;
  const preco = c > 0 && mkAplicado > 0 ? c * mkAplicado : 0;
  const sugerido = precoSugerido(preco);
  const venda = Number(precoVenda) || 0;
  const efetivo = venda > 0 ? venda : sugerido;
  const markupReal = c > 0 && efetivo > 0 ? efetivo / c : 0;
  const markupExibir = markupReal > 0 ? markupReal : mkAplicado;
  return { custo: c, markupLinha: mkLinha, markupAplicado: mkAplicado, preco, sugerido, efetivo, markupReal, markupExibir };
}

/**
 * Markup Fase B — PREÇO que cada faixa de markup pede, dado o custo real.
 *
 * preco_da_faixa = custo × markup_da_faixa (mín/ideal/máx da LINHA). Base = custo TOTAL
 * (confiável), NÃO decompõe materiais/mão de obra — a M.O. interna prevista não está dentro
 * do custo real, então "materiais = custo − M.O." não fecha (era a causa dos valores sem
 * sentido da 1ª versão). `definido = false` quando falta custo ou markup → a UI mostra "—".
 */
export type FaixaPreco = { markup: number; preco: number; definido: boolean };

export function precoPorFaixa(custo: unknown, markup: unknown): FaixaPreco {
  const c = Number(custo) || 0;
  const mk = Number(markup) || 0;
  if (!(c > 0) || !(mk > 0)) return { markup: mk, preco: 0, definido: false };
  return { markup: mk, preco: c * mk, definido: true };
}

/**
 * Semáforo do PREÇO DE VENDA contra os preços que as faixas pedem (mín/ideal da LINHA).
 * 'ideal' (verde) = preço ≥ o preço da faixa ideal; 'min' (âmbar) = ≥ o da mín (mas < ideal);
 * 'abaixo' (vermelho) = abaixo de algum teto definido (markup insuficiente). Preço ALTO nunca
 * alarma (markup alto = lucro). 'indef' = sem preço/sem faixa p/ decidir. Comparações ≥ inclusivas.
 */
export type StatusPreco = "ideal" | "min" | "abaixo" | "indef";

export function statusPreco(precoVendaEfetivo: unknown, minDef: boolean, precoMin: unknown, idealDef: boolean, precoIdeal: unknown): StatusPreco {
  const preco = Number(precoVendaEfetivo) || 0;
  const pIdeal = Number(precoIdeal) || 0;
  const pMin = Number(precoMin) || 0;
  if (!(preco > 0) || (!idealDef && !minDef)) return "indef";
  if (idealDef && preco >= pIdeal) return "ideal";
  if (minDef && preco >= pMin) return "min";
  return "abaixo";
}

/**
 * Markup Fase B (2ª visão) — M.O. que ainda CABE para o preço de VENDA cair numa faixa de markup.
 *
 *   MO_max(faixa) = precoVenda / markup_da_faixa − materiais
 * Complementa `precoPorFaixa` (responde "quanto posso pagar de mão de obra?"). ⚠️ Exige o preço de
 * VENDA digitado (o chamador passa 0 quando não há) — sem ele a base cairia no sugerido (=custo×markup)
 * e os tetos colapsariam perto da própria M.O. real (visão inútil). `atingivel = false` quando falta
 * preço/markup OU quando os materiais já estouram o markup (moMax < 0) → a UI mostra "—".
 * (A fórmula em si é correta; o descrédito da 1ª entrega veio de DADOS DE TESTE — M.O. absurda como
 * R$300 numa peça de R$47 —, não de erro de conta.)
 */
export type FaixaMO = { markup: number; moMax: number; atingivel: boolean };

export function moPorFaixa(precoVenda: unknown, materiais: unknown, markup: unknown): FaixaMO {
  const preco = Number(precoVenda) || 0;
  const mat = Number(materiais) || 0;
  const mk = Number(markup) || 0;
  if (!(mk > 0) || !(preco > 0)) return { markup: mk, moMax: 0, atingivel: false };
  const moMax = preco / mk - mat;
  return { markup: mk, moMax, atingivel: moMax >= 0 };
}

/**
 * Semáforo da M.O. real do modelo contra os tetos das faixas (mín/ideal da LINHA).
 * 'ideal' (verde) = M.O. real cabe até o teto da faixa ideal; 'min' (âmbar) = cabe só até o teto da
 * mín; 'estoura' (vermelho) = passa até do teto da mín; 'indef' = sem base p/ decidir. ≤ inclusivo.
 */
export type StatusMO = "ideal" | "min" | "estoura" | "indef";

export function statusMO(moReal: unknown, moMinAtingivel: boolean, moMinMax: unknown, moIdealAtingivel: boolean, moIdealMax: unknown): StatusMO {
  const real = Number(moReal) || 0;
  const idealMax = Number(moIdealMax) || 0;
  const minMax = Number(moMinMax) || 0;
  if (moIdealAtingivel && real <= idealMax) return "ideal";
  if (moMinAtingivel && real <= minMax) return "min";
  if (moIdealAtingivel || moMinAtingivel) return "estoura";
  return "indef";
}

/**
 * Semáforo da M.O. real por FAIXA (4 estados) — diz ATÉ QUE FAIXA DE MARKUP a M.O. do modelo
 * permite chegar. Os tetos de M.O. andam ao contrário do markup: markup MÁXIMO ⇒ MENOR teto de
 * M.O. (mais exigente); markup MÍNIMO ⇒ MAIOR teto (mais folga). Então, do MELHOR ao pior:
 *   - 'no_maximo'  (verde): M.O. ≤ teto do MÁXIMO (o menor) — bate o markup mais alto.
 *   - 'no_ideal'   (verde): M.O. ≤ teto do IDEAL.
 *   - 'no_minimo'  (âmbar): M.O. ≤ teto do MÍNIMO (o maior) — só bate o markup mínimo.
 *   - 'acima'      (vermelho): estoura até o teto do mínimo — M.O. alta demais, não bate nem o mín.
 *   - 'indef'      (—): sem teto atingível p/ decidir.
 * M.O. baixa nunca alarma (é lucro) — por isso não há "abaixo do mínimo". ≤ inclusivo.
 * Os *Atingivel indicam se a faixa tem base (preço+markup) — sem base, aquela faixa não decide.
 */
export type StatusMoFaixa = "no_maximo" | "no_ideal" | "no_minimo" | "acima" | "indef";

export function statusMoFaixa(
  moReal: unknown,
  minAtingivel: boolean, minTeto: unknown,
  idealAtingivel: boolean, idealTeto: unknown,
  maxAtingivel: boolean, maxTeto: unknown,
): StatusMoFaixa {
  const real = Number(moReal) || 0;
  if (maxAtingivel && real <= (Number(maxTeto) || 0)) return "no_maximo";
  if (idealAtingivel && real <= (Number(idealTeto) || 0)) return "no_ideal";
  if (minAtingivel && real <= (Number(minTeto) || 0)) return "no_minimo";
  if (minAtingivel || idealAtingivel || maxAtingivel) return "acima";
  return "indef";
}

/**
 * Simulação de custo do Planejamento (manual, isolada do custo real do BOM/CAD).
 * Valores previstos que o usuário digita no card. Ver design 2026-07-21.
 */
export type CustoSimInput = {
  consumo_tecido?: number | null; // metros
  preco_tecido_m?: number | null; // R$/m
  aviamento?: number | null; // R$
  mao_obra?: number | null; // R$
};

/**
 * Custo estimado por peça: tecido (consumo × preço/m) + aviamento + mão de obra.
 * Tecido só conta se consumo E preço/m forem > 0. Nulos/negativos = 0.
 */
export function custoSimulado(i: CustoSimInput | null | undefined): { tecido: number; total: number } {
  const consumo = Math.max(0, Number(i?.consumo_tecido) || 0);
  const precoM = Math.max(0, Number(i?.preco_tecido_m) || 0);
  const tecido = consumo > 0 && precoM > 0 ? consumo * precoM : 0;
  const total = tecido + Math.max(0, Number(i?.aviamento) || 0) + Math.max(0, Number(i?.mao_obra) || 0);
  return { tecido, total };
}
