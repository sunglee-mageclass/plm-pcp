// Insumo (etiqueta/aviamento de grade) vinculado a UM tamanho (urg R1): a Explosao conta so as
// pecas daquele tamanho em vez da grade inteira. Modulo PURO (sem React/Supabase) — espelho TS da
// regra SQL (`_estoque_etiqueta_core`, CTE `ce_sem`). Anti-drift: tests/fixtures/insumo-tamanho-casos.ts.
// Mudou a regra? Mude TS, SQL e a fixture.
// Regras (a fixture as fixa): "trim" = SO espacos ASCII, como btrim(x) do Postgres (tab/NBSP/quebra de linha NAO
// sao espaco — NAO usar String.prototype.trim); `formato` e comparado exato com 'nenhum' (null = nao-'nenhum');
// o fator NAO e limitado a 1; chave da grade e propriedade PROPRIA do objeto.

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

// Equivalente a btrim(x): tira SO espacos (U+0020) das pontas.
const trimEspacos = (s: string): string => s.replace(/^ +| +$/g, "");

const temChave = (mapa: Record<string, number>, tam: string): boolean =>
  Object.prototype.hasOwnProperty.call(mapa, tam);

/** 'nenhum' OU nenhuma variante com tamanho (apos btrim: so espacos) = o insumo nao tem tamanho proprio. */
export function insumoSemTamanho(
  formato: string | null,
  variantes: { tamanho: string | null }[],
): boolean {
  if (formato === "nenhum") return true;
  return !variantes.some((v) => v.tamanho != null && trimEspacos(v.tamanho) !== "");
}

/** O vinculo so vale se o insumo nao tem tamanho proprio; vazio ou so espacos = sem vinculo; espacos das pontas caem. */
export function tamanhoEfetivoInsumo(i: InsumoTamanhoInfo): string | null {
  const t = i.tamanho_vinculado == null ? "" : trimEspacos(i.tamanho_vinculado);
  if (t === "") return null;
  return insumoSemTamanho(i.formato_tamanho, i.variantes) ? t : null;
}

/** Soma por tamanho; so entram valores numericos >= 0 (regex do SQL). */
export function gradeMapa(linhas: GradeLinha[]): Record<string, number> {
  const mapa: Record<string, number> = Object.create(null);
  for (const l of linhas) {
    if (!l.grades) continue;
    for (const [tam, v] of Object.entries(l.grades)) {
      if (v == null || (typeof v !== "number" && typeof v !== "string")) continue;
      const s = String(v);
      if (!NUMERO_NAO_NEGATIVO.test(s)) continue;
      mapa[tam] = (temChave(mapa, tam) ? mapa[tam] : 0) + Number(s);
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
  return temChave(mapa, tam) ? mapa[tam] : 0;
}

/** Fator aplicado ao custo: sem tamanho ou total <= 0 -> 1; senao pecas do tamanho / total. */
export function fatorCustoInsumo(tam: string | null, mapa: Record<string, number>, total: number): number {
  if (tam == null || total <= 0) return 1;
  return pecasDoInsumo(tam, mapa, total) / total;
}

/** Tamanho vinculado que nao tem pecas na grade (so avisa quando ha grade: total > 0). */
export function tamanhoForaDaGrade(tam: string | null, mapa: Record<string, number>, total: number): boolean {
  return !!tam && total > 0 && !(pecasDoInsumo(tam, mapa, total) > 0);
}

/** "40|M" -> "M · 40" (mesmo fmtTamInsumo da aba Estoque do OC Insumo). */
export function rotuloTamanho(tam: string): string {
  const [n, s] = tam.split("|");
  return s ? `${s} · ${n}` : tam;
}

/** Switch "Vincular a um tamanho" habilitado so para insumo sem tamanho proprio ('nenhum' ou nenhum tamanho marcado nos blocos). */
export function vinculoDisponivel(formato: string | null, blocos: { tamanhos: string[] }[]): boolean {
  const variantes: { tamanho: string | null }[] = [];
  for (const b of blocos) {
    if (b.tamanhos.length === 0) variantes.push({ tamanho: null });
    else for (const t of b.tamanhos) variantes.push({ tamanho: t });
  }
  return insumoSemTamanho(formato, variantes);
}

/** Ao editar: o toggle comeca ligado quando `tamanho_vinculado` nao e vazio apos o trim de espacos. */
export function vinculoAtivoDoRegistro(tamanhoVinculado: string | null | undefined): boolean {
  return tamanhoVinculado != null && trimEspacos(tamanhoVinculado) !== "";
}

/**
 * Valor de `etiquetas.tamanho_vinculado` a gravar no Salvar (Ruling A2: o Salvar limpa o vinculo que nao vale):
 * toggle desligado, tamanho vazio ou algum tamanho marcado nos blocos (com formato != 'nenhum') => null.
 */
export function tamanhoVinculadoParaSalvar(p: {
  ativo: boolean;
  tamanho: string | null | undefined;
  formato: string | null;
  blocos: { tamanhos: string[] }[];
}): string | null {
  if (!p.ativo || p.tamanho == null) return null;
  const t = trimEspacos(p.tamanho);
  if (t === "") return null;
  return vinculoDisponivel(p.formato, p.blocos) ? t : null;
}

/** Switch ligado (e valendo) mas sem tamanho escolhido: o Salvar deve ser bloqueado em vez de gravar null calado. */
export function vinculoLigadoSemTamanho(p: {
  ativo: boolean;
  tamanho: string | null | undefined;
  formato: string | null;
  blocos: { tamanhos: string[] }[];
}): boolean {
  if (!p.ativo || !vinculoDisponivel(p.formato, p.blocos)) return false;
  return p.tamanho == null || trimEspacos(p.tamanho) === "";
}
