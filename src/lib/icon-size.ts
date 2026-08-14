/**
 * Padrões v3 §Q8 — tamanhos de ícone (lucide). SÓ 4 tamanhos, fonte única.
 *
 * Onda 1 = base pronta/exportada; a adoção nas telas (trocar `size={N}` solto) é a
 * onda 2. O anti-drift §Q (regra "c") caça `size={N}` fora de {14,16,20,24}.
 * Também disponível como CSS var em src/styles.css: --icon-xs/sm/md/lg.
 *
 *   xs 14 — badge      · sm 16 — inline com texto/botão
 *   md 20 — cabeçalho  · lg 24 — chip/hero
 *
 * stroke-width 2 (1,75 em ≤14px); color = currentColor; nunca abaixo de 12px.
 */
export const LUCIDE_SIZE = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
} as const;

/** Classe Tailwind equivalente: h-3.5=14 · h-4=16 · h-5=20 · h-6=24. */
export const ICON_CLASS = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;

export type IconSizeToken = keyof typeof LUCIDE_SIZE;
