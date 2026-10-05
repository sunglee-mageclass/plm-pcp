// Insumo (etiqueta/aviamento de grade) vinculado a UM tamanho (urg R1): a Explosao conta so as
// pecas daquele tamanho em vez da grade inteira. Modulo PURO (sem React/Supabase) — espelho TS da
// regra SQL (`_estoque_etiqueta_core`, CTE `ce_sem`). Anti-drift: tests/fixtures/insumo-tamanho-casos.ts.
// Mudou a regra? Mude TS, SQL e a fixture.

export type InsumoTamanhoInfo = {
  tamanho_vinculado: string | null;
  formato_tamanho: string | null;
  variantes: { tamanho: string | null }[];
};

export type GradeLinha = {
  grades: Record<string, unknown> | null;
  grade_total: number | null;
};

// MESMO criterio do `ce_sem` do `_estoque_etiqueta_core`: o valor, como texto, casa numero >= 0.
const NUMERO_NAO_NEGATIVO = /^[0-9]+(\.[0-9]+)?$/;

/** 'nenhum' OU nenhuma variante com tamanho (apos trim) = o insumo nao tem tamanho proprio. */
export function insumoSemTamanho(
  formato: string | null,
  variantes: { tamanho: string | null }[],
): boolean {
  if (formato === "nenhum") return true;
  return !variantes.some((v) => v.tamanho != null && v.tamanho.trim() !== "");
}

/** O vinculo so vale se o insumo nao tem tamanho proprio; '' = sem vinculo. */
export function tamanhoEfetivoInsumo(i: InsumoTamanhoInfo): string | null {
  const t = i.tamanho_vinculado;
  if (t == null || t === "") return null;
  return insumoSemTamanho(i.formato_tamanho, i.variantes) ? t : null;
}

/** Soma por tamanho; so entram valores numericos >= 0 (regex do SQL). */
export function gradeMapa(linhas: GradeLinha[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const l of linhas) {
    if (!l.grades) continue;
    for (const [tam, v] of Object.entries(l.grades)) {
      if (v == null || (typeof v !== "number" && typeof v !== "string")) continue;
      const s = String(v);
      if (!NUMERO_NAO_NEGATIVO.test(s)) continue;
      mapa[tam] = (mapa[tam] ?? 0) + Number(s);
    }
  }
  return mapa;
}

/** Soma de `grade_total` (o "total" que a Explosao usa hoje). */
export function gradeTotal(linhas: GradeLinha[]): number {
  return linhas.reduce((acc, l) => acc + (l.grade_total ?? 0), 0);
}

/** Pecas que o insumo cobre: sem tamanho -> o total; com tamanho -> a soma daquele tamanho (ausente = 0). */
export function pecasDoInsumo(tam: string | null, mapa: Record<string, number>, total: number): number {
  if (tam == null) return total;
  return mapa[tam] ?? 0;
}

/** Fator aplicado ao custo: sem tamanho ou total <= 0 -> 1; senao pecas do tamanho / total. */
export function fatorCustoInsumo(tam: string | null, mapa: Record<string, number>, total: number): number {
  if (tam == null || total <= 0) return 1;
  return pecasDoInsumo(tam, mapa, total) / total;
}

/** Tamanho vinculado que nao tem pecas na grade (so avisa quando ha grade: total > 0). */
export function tamanhoForaDaGrade(tam: string | null, mapa: Record<string, number>, total: number): boolean {
  return !!tam && total > 0 && !((mapa[tam] ?? 0) > 0);
}

/** "40|M" -> "M · 40" (mesmo fmtTamInsumo da aba Estoque do OC Insumo). */
export function rotuloTamanho(tam: string): string {
  const [n, s] = tam.split("|");
  return s ? `${s} · ${n}` : tam;
}
