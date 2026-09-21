// Sugestão do valor de cadastro mais PRÓXIMO do que o usuário digitou (fuzzy match), para a
// área de análise oferecer "você quis dizer X?" quando o nome não casou exato.
// Puro/testável. Usa distância de Levenshtein normalizada sobre o texto já normalizado
// (normalizeCat: sem acento/caixa). Retorna candidatos ordenados por similaridade.

import { normalizeCat } from "@/lib/fornecedor-categoria";

/** Distância de edição (Levenshtein) entre a e b. O(len a × len b). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Similaridade 0..1 (1 = idêntico). Normaliza pela maior string, com bônus p/ prefixo/substring
 *  (digitar "Royal" deve casar bem "Royal Malhas" — Levenshtein puro penalizaria o sufixo). */
export function similaridade(a: string, b: string): number {
  const na = normalizeCat(a);
  const nb = normalizeCat(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length) || 1;
  const lev = 1 - levenshtein(na, nb) / maxLen;
  // bônus: um é prefixo do outro (0.92) ou substring (0.85) — o melhor entre lev e o bônus.
  const [curto, longo] = na.length <= nb.length ? [na, nb] : [nb, na];
  let bonus = 0;
  if (longo.startsWith(curto)) bonus = 0.92;
  else if (longo.includes(curto)) bonus = 0.85;
  // encolhe o bônus se o trecho digitado for muito curto vs o alvo (evita "az" casar tudo).
  if (bonus > 0 && curto.length < 3) bonus *= 0.6;
  return Math.max(lev, bonus);
}

export type Candidato<T> = { item: T; score: number };

/**
 * Ranqueia opções por proximidade ao texto digitado. `getNome` extrai o nome de cada opção.
 * Retorna os `limite` melhores acima de `minScore` (default 0.4), do mais próximo ao menos.
 * Usado p/ "você quis dizer?" — a 1ª sugestão é o topo da lista.
 */
export function sugestoes<T>(
  digitado: string,
  opcoes: T[],
  getNome: (o: T) => string,
  limite = 5,
  minScore = 0.4,
): Candidato<T>[] {
  const alvo = normalizeCat(digitado);
  if (!alvo) return [];
  return opcoes
    .map((item) => ({ item, score: similaridade(alvo, getNome(item)) }))
    .filter((c) => c.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limite);
}

/** A melhor sugestão (ou null) — atalho para "você quis dizer X?". */
export function melhorSugestao<T>(
  digitado: string,
  opcoes: T[],
  getNome: (o: T) => string,
  minScore = 0.5,
): T | null {
  return sugestoes(digitado, opcoes, getNome, 1, minScore)[0]?.item ?? null;
}
