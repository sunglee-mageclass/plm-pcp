// Cores de gráfico (dataviz) — FONTE ÚNICA para o Recharts. Ver docs/design/ui-padroes.md §R.
//
// Os valores concretos vivem em src/styles.css (tokens --chart-*, claro + escuro); aqui só
// referenciamos via var(--…) — nunca hsl()/hex/oklch solto no componente (anti-drift regra
// `f`, tests/unit/ui-padroes-antidrift.test.ts). O Recharts aceita `fill="var(--chart-1)"` /
// `stroke="var(--chart-grid)"` — o browser resolve o CSS var no atributo SVG (mesmo padrão
// do LabelList fill="var(--foreground)" já usado no dashboard). Como reagem a --primary e ao
// tema, os gráficos acompanham claro/escuro sem código extra.
//
// Régua (resumo — detalhe em §R):
//  • Série única (magnitude) → 1 matiz  → CHART_SERIE.
//  • Categórica (entidades nominais) → ordem FIXA por entidade, NUNCA ciclada/por rank → CHART_CATEGORICAL.
//  • Sequencial (ordinal/magnitude) → 1 matiz claro→escuro → CHART_SEQ (navy) / CHART_AGE (idade).
//  • Status (ok/atenção/erro) → tom semântico §Q9 + ícone (nunca só cor) → TONE_BG/TONE_FG.
//  • Divergente (medida × meta) → CHART_DIVERGE_NEG (abaixo) / CHART_DIVERGE_POS (acima).

/** Série única (magnitude) = 1 matiz navy. Use em TODO gráfico de 1 série. */
export const CHART_SERIE = "var(--chart-1)";

/** Categórica — ordem FIXA por entidade (índice estável, NUNCA por rank/ciclada). Só quando
 *  entidades nominais precisam coexistir num mesmo gráfico; a 9ª+ deve virar "Outros". */
export const CHART_CATEGORICAL = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
] as const;

/** Sequencial navy (claro→escuro) — ordinal/magnitude: funil, etapas do pipeline. */
export const CHART_SEQ = [
  "var(--chart-seq-1)", "var(--chart-seq-2)", "var(--chart-seq-3)",
  "var(--chart-seq-4)", "var(--chart-seq-5)",
] as const;

/** Sequencial de IDADE do WIP (âmbar claro→escuro = mais velho/urgente).
 *  Índice 0 = "sem envio" (neutro, FORA da escala). Casa com `ordem` da RPC. */
export const CHART_AGE = [
  "var(--chart-age-0)", "var(--chart-age-1)", "var(--chart-age-2)",
  "var(--chart-age-3)", "var(--chart-age-4)",
] as const;

/** Grade recessiva do CartesianGrid (e traços de eixo). */
export const CHART_GRID = "var(--chart-grid)";

/** Divergente (Δ medida × meta): abaixo/negativo = navy à esquerda; acima/positivo = vermelho à direita. */
export const CHART_DIVERGE_NEG = "var(--chart-diverge-neg)";
export const CHART_DIVERGE_POS = "var(--chart-diverge-pos)";

/** Tom semântico p/ acento de KPI / stat tile / status — fórmula §Q9 (bg tint + fg legível). */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const TONE_BG: Record<Tone, string> = {
  success: "var(--tone-success-bg)",
  warning: "var(--tone-warning-bg)",
  danger: "var(--tone-danger-bg)",
  info: "var(--tone-info-bg)",
  neutral: "var(--tone-neutral-bg)",
};

export const TONE_FG: Record<Tone, string> = {
  success: "var(--tone-success-fg)",
  warning: "var(--tone-warning-fg)",
  danger: "var(--tone-danger-fg)",
  info: "var(--tone-info-fg)",
  neutral: "var(--tone-neutral-fg)",
};
