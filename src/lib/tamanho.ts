// Tamanho da grade da loja (tenant_config.tamanhos_grade) — helper ÚNICO (spec SKU §4.1, F3.5a).
// Formato "Número|Letra" (ex.: "34|PPP"). Item SOLTO (sem "|") é classificado sozinho: só dígitos → Número;
// o resto → Letra. Par invertido ("PPP|34": só o lado DIREITO é número) é destrinchado pelo conteúdo.
// Espelho SQL byte a byte: public._sku_tamanho_lados(text) / public._sku_tamanho_lado(text,text)
// (migration 20261003100000) — casados pelo anti-drift (tests/fixtures/sku-casos.ts → unit + integração).
// ⚠️ Os ~17 `split("|")` antigos do repo NÃO foram migrados (fora de escopo da F3.5a); código NOVO usa só este helper.
// PURO (sem I/O).

export type TamanhoTipo = "letra" | "numero";
export type LadosTamanho = { numero: string | null; letra: string | null };

/** Espaços das pontas: SÓ espaço, tab, CR e LF (= `btrim(x, E' \t\r\n')` do SQL — não o `.trim()` unicode do JS). */
export function aparar(s: string | null | undefined): string {
  return (s ?? "").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

/** Só dígitos ASCII (= `~ '^[0-9]+$'` do SQL). */
export function ehNumeroTamanho(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function solto(s: string): LadosTamanho {
  return ehNumeroTamanho(s) ? { numero: s, letra: null } : { numero: null, letra: s };
}

/** "34|PPP" → { numero: "34", letra: "PPP" }; "PPP|34" → idem; "36" → número; "PP" → letra; "UN" → letra. */
export function parseTamanho(t: string | null | undefined): LadosTamanho {
  const s = aparar(t);
  if (s === "") return { numero: null, letra: null };
  const i = s.indexOf("|");
  if (i < 0) return solto(s);
  const a = aparar(s.slice(0, i)) || null; // só o 1º "|" separa; o resto fica no lado direito
  const b = aparar(s.slice(i + 1)) || null;
  if (a && b) return !ehNumeroTamanho(a) && ehNumeroTamanho(b) ? { numero: b, letra: a } : { numero: a, letra: b };
  if (a) return solto(a);
  if (b) return solto(b);
  return { numero: null, letra: null };
}

/** Lado do tamanho que vale no SKU/na exibição: o do tipo pedido; se o item não tem esse lado (solto ou "UN"), o outro. */
export function ladoTamanho(t: string | null | undefined, tipo: TamanhoTipo): string | null {
  const l = parseTamanho(t);
  return tipo === "numero" ? (l.numero ?? l.letra) : (l.letra ?? l.numero);
}
