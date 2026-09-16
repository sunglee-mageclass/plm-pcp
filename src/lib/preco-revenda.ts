// Cadeia markup ↔ preço para REVENDA (Produto Acabado) e Produto Importado — fonte ÚNICA, pura,
// espelhando o SQL `_pa_recomputar_precos_modelo` / `_imp_recomputar_precos_modelo`.
//
// ⚠️ ATACADO e VAREJO são INDEPENDENTES, cada um sobre a MESMA base (o custo total da peça):
//   preço_atacado = base × markup_atacado
//   preço_varejo  = base × markup_varejo   ← NÃO é `preço_atacado × markup_varejo` (mudança set/2026)
// A base é o custo da peça de revenda:
//   Acabado:  valor_unitario × (1 − desconto%) + insumos_por_peça
//   Importado: custo LANDED unitário (câmbio + frete rateado)  — o chamador passa a base já pronta.
//
// Caminho INVERSO (preço editável → devolve o markup): markup = preço ÷ base. Cada par (markup↔preço)
// é independente do outro. Como o banco só persiste MARKUP (o preço é derivado — invariante #13), o
// front usa `markupDePreco` para converter o preço digitado em markup e manda o markup pelas RPCs
// existentes (o banco recompõe o mesmo preço).

/** Arredonda a 2 casas — espelha `round(x, 2)` do SQL. */
export const arred2 = (v: number): number => Math.round(v * 100) / 100;

/** preço = base × markup (2 casas). null quando base ou markup não são positivos. */
const precoDeMarkup = (base: number, markup: number | null | undefined): number | null =>
  base > 0 && markup != null && markup > 0 ? arred2(base * markup) : null;

/** Preço atacado = base × markup_atacado. */
export const precoAtacado = (base: number, markupAtacado: number | null | undefined): number | null =>
  precoDeMarkup(base, markupAtacado);

/** Preço varejo = base × markup_varejo (INDEPENDENTE do atacado). */
export const precoVarejo = (base: number, markupVarejo: number | null | undefined): number | null =>
  precoDeMarkup(base, markupVarejo);

/**
 * Caminho INVERSO: dado o PREÇO digitado, devolve o markup equivalente (= preço ÷ base), 2 casas.
 * null quando base ≤ 0 (evita ÷0) ou preço ≤ 0 (o banco rejeita markup ≤ 0). O chamador, ao receber
 * null, não deve gravar markup (mantém o anterior ou mostra "—").
 */
export const markupDePreco = (base: number, preco: number | null | undefined): number | null =>
  base > 0 && preco != null && preco > 0 ? arred2(preco / base) : null;
