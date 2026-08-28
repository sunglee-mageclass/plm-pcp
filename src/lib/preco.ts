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
