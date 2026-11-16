// Ordem da grade do Armário. A grade é VISUAL (N colunas, reflui), mas a ORDEM é uma lista 1D:
// índice 1-based = ordem de envio da API. Mudar o nº de colunas NUNCA muda a ordem. Lib pura.

/** Move o elemento `de` para a posição `para` (sem mutar). Índices fora do intervalo → cópia igual. */
export function reordenar<T>(lista: readonly T[], de: number, para: number): T[] {
  const out = lista.slice();
  if (de < 0 || de >= out.length || para < 0 || para >= out.length || de === para) return out;
  const [item] = out.splice(de, 1);
  out.splice(para, 0, item);
  return out;
}

/** Atribui a ordem de envio 1..N (contígua, 1-based) na sequência atual da lista. */
export function indiceEnvio<T>(lista: readonly T[]): (T & { ordem: number })[] {
  return lista.map((x, i) => ({ ...x, ordem: i + 1 }));
}

/** Posição visual (1-based) de um índice 0-based numa grade de `colunas` colunas. */
export function posicaoGrade(indice: number, colunas: number): { linha: number; coluna: number } {
  const c = Math.max(1, Math.floor(colunas));
  return { linha: Math.floor(indice / c) + 1, coluna: (indice % c) + 1 };
}

/** Quebra a lista 1D em linhas visuais de `colunas`. Só apresentação: não altera a ordem. */
export function fatiarEmLinhas<T>(lista: readonly T[], colunas: number): T[][] {
  const c = Math.max(1, Math.floor(colunas));
  const linhas: T[][] = [];
  for (let i = 0; i < lista.length; i += c) linhas.push(lista.slice(i, i + c));
  return linhas;
}
