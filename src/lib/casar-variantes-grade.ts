/**
 * Grade EFETIVA (peças) de uma variante de bloco de tecido/forro/entretela, considerando
 * casamento de variantes ("casar variantes", Fatia 2B) — espelha o helper do BANCO
 * `_grade_soma_pares` (Fatia 2, `20260826120000_casar_variantes_fatia2_reserva.sql`).
 *
 * - Tecido 1 → grade da PRÓPRIA posição (`gradePosicao`), sempre — nunca soma pares.
 * - Complementar (Tecido 2/3, Forro, Entretela) SEM casamento (`complementaIds` vazio/null)
 *   → grade da própria posição, igual hoje (comportamento byte-idêntico ao pré-Fatia 2B).
 * - Complementar CASADO com 1+ variantes do Tecido 1 → Σ `grade_total` das variantes do
 *   Tecido 1 casadas (via `gradePorVarianteTecido1`, chave = `variante_tecido_id` do Tecido 1).
 *   Id órfão (variante do Tecido 1 já removida) não soma (contribui 0).
 *
 * SEM ceil/arredondamento — fracionado, mesma régua do `_grade_soma_pares`.
 * Puro: sem imports de React/Supabase. Usado pelos 3 sites do Grupo A (card de
 * Desenvolvimento + auto-cálculo de CAD em 2 rotas) — centraliza a conta para não driftar.
 */
export function gradeEfetivaPar(args: {
  isTecido1: boolean;
  complementaIds: string[] | null | undefined; // ids das variantes do Tecido 1 casadas (deste slot)
  gradePosicao: number; // grade_total da própria ordem (fallback = hoje)
  gradePorVarianteTecido1: Map<string, number>; // variante_tecido_id (Tecido 1) → grade_total
}): number {
  const { isTecido1, complementaIds, gradePosicao, gradePorVarianteTecido1 } = args;
  if (isTecido1) return gradePosicao;
  const ids = (complementaIds ?? []).filter(Boolean);
  if (ids.length === 0) return gradePosicao; // complementar sem casamento = hoje
  return ids.reduce((s, id) => s + (gradePorVarianteTecido1.get(id) ?? 0), 0); // órfão → +0
}
