/**
 * Lançamentos do OTB: slots sequenciais e CONTÍGUOS (1..N) por subcoleção.
 *
 * O "lançamento" substituiu a "semana do calendário" — não há mais mapeamento
 * data↔semana. Cada lançamento é só um ordinal com sua própria data livre. O valor
 * persistido continua sendo o ordinal 1..5 (coluna `semana`/chaves jsonb no banco
 * ficam como estão), agora interpretado como "ordinal do lançamento".
 *
 * Invariante: dentro dos editores, ordinal = posição = número exibido. Estas funções
 * puras mantêm essa contiguidade ao adicionar/remover e ao normalizar dado antigo.
 */

export const MAX_LANCAMENTOS = 5;

/** Menor ordinal livre em 1..max (append contíguo quando o conjunto já é contíguo),
 *  ou null se atingiu o teto. */
export function proximoLancamento(ordinais: number[], max = MAX_LANCAMENTOS): number | null {
  for (let k = 1; k <= max; k++) if (!ordinais.includes(k)) return k;
  return null;
}

/** Remapeamento de ordinal antigo → novo (só os sobreviventes). */
export type Remap = Map<number, number>;

/** Remove `alvo` e renumera os sobreviventes para contíguo 1..N-1 (preserva a ordem).
 *  Devolve os novos ordinais + o remap (o `alvo` não entra no remap). */
export function removerLancamento(
  ordinais: number[],
  alvo: number,
): { ordinais: number[]; remap: Remap } {
  const restantes = ordinais.filter((o) => o !== alvo).sort((a, b) => a - b);
  const remap: Remap = new Map();
  restantes.forEach((o, i) => remap.set(o, i + 1));
  return { ordinais: restantes.map((_, i) => i + 1), remap };
}

/** Normaliza um conjunto possivelmente com buracos/duplicatas (dado antigo, ex.:
 *  [1,3,5]) para contíguo [1,2,3] + o remap dos ordinais originais. */
export function normalizar(ordinais: number[]): { ordinais: number[]; remap: Remap } {
  const sorted = [...new Set(ordinais)].sort((a, b) => a - b);
  const remap: Remap = new Map();
  sorted.forEach((o, i) => remap.set(o, i + 1));
  return { ordinais: sorted.map((_, i) => i + 1), remap };
}

/** Reindexa um Record keyed por ordinal-como-string aplicando o remap. Chaves fora
 *  do remap (ex.: o lançamento removido) somem. */
export function remapChaves<T>(m: Record<string, T>, remap: Remap): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    const nk = remap.get(Number(k));
    if (nk != null) out[String(nk)] = v;
  }
  return out;
}
