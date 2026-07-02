/**
 * Lógica de formação de preço (Planejamento) — fonte única.
 *
 * Preço efetivo = preço para venda se houver, senão o preço sugerido
 * (custo × markup da linha, arredondado). markup real = efetivo ÷ custo.
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
  markupLinha: number;
  preco: number; // custo × markup da linha
  sugerido: number; // preco arredondado
  efetivo: number; // preço para venda se houver, senão o sugerido
  markupReal: number; // efetivo ÷ custo (0 se não dá p/ calcular)
  markupExibir: number; // markup real se houver, senão o da linha
};

export function precoInfo(custo: unknown, markupLinha: unknown, precoVenda: unknown): PrecoInfo {
  const c = Number(custo) || 0;
  const mk = Number(markupLinha) || 0;
  const preco = c > 0 && mk > 0 ? c * mk : 0;
  const sugerido = precoSugerido(preco);
  const venda = Number(precoVenda) || 0;
  const efetivo = venda > 0 ? venda : sugerido;
  const markupReal = c > 0 && efetivo > 0 ? efetivo / c : 0;
  const markupExibir = markupReal > 0 ? markupReal : mk;
  return { custo: c, markupLinha: mk, preco, sugerido, efetivo, markupReal, markupExibir };
}
