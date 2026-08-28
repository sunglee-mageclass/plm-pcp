/**
 * Máscara de milhar pt-BR "ao vivo" (usada pelo <MoneyInput>). Lógica PURA (sem
 * React/DOM) para ser testável: agrupa milhares com ".", decimais com ",", e
 * emite um valor canônico (ponto decimal) separado do texto exibido.
 */

/** Agrupa dígitos inteiros em milhares com ponto: "1234567" -> "1.234.567". */
export const groupInt = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Conta caracteres "significativos" (dígitos e a vírgula decimal). O ponto de
 * milhar é auto-inserido e NÃO conta — é a chave para reposicionar o cursor após
 * reformatar (contar significativos antes do cursor no cru e reencontrar no formatado).
 */
export const countSig = (s: string) => (s.match(/[\d,]/g) || []).length;

/**
 * Normaliza ponto(s) digitados/colados para o padrão pt-BR ANTES da máscara: o
 * usuário pt-BR espera vírgula decimal, mas teclado numérico só tem ".". Só mexe
 * quando não há vírgula na string (se já há vírgula, ela É o decimal — os pontos
 * são milhar legítimo, ex. colar "1.234,56", e ficam intocados).
 *
 * Regra: sem vírgula e com ponto(s), o ÚLTIMO ponto vira decimal SE tiver no
 * máximo `decimals` dígitos depois dele (inclui ponto no fim, 0 dígitos —
 * "12." ainda digitando); os pontos ANTERIORES a esse (milhar) são removidos.
 * Se o último ponto tiver MAIS de `decimals` dígitos depois (ex. "1.234" com
 * decimals=2 → 3 dígitos), é tratado como milhar (nenhum ponto vira vírgula) —
 * é o padrão mais previsível pro fluxo "ao vivo": quem quer decimal digita
 * poucas casas depois do separador; 3+ dígitos após o ÚLTIMO ponto é sinal de
 * agrupamento de milhar, não de decimal.
 *
 * Consequência: "1.00"/"10.00" (2 dígitos após o ponto) viram DECIMAL ("1,00"=1,
 * "10,00"=10), não milhar. Isso é aceitável porque os campos que usam MoneyInput
 * são de VALOR (R$), onde 2 casas = decimal é o esperado; para escrever mil sem
 * vírgula use "1.000" (3 dígitos → milhar) ou "1000".
 */
export function normalizarPontos(raw: string, decimals: number): string {
  if (decimals <= 0 || raw.indexOf(",") !== -1 || raw.indexOf(".") === -1) return raw;
  const lastDot = raw.lastIndexOf(".");
  const afterLastDot = raw.slice(lastDot + 1).replace(/\D/g, "");
  if (afterLastDot.length > decimals) return raw; // 3+ dígitos após o último ponto = milhar
  const before = raw.slice(0, lastDot).replace(/\./g, ""); // pontos anteriores = milhar, somem
  const after = raw.slice(lastDot + 1);
  return before + "," + after;
}

/**
 * Conta "significativos" antes do cursor levando a normalização de ponto→vírgula em
 * conta (`normalizarPontos`). Sem isso, `countSig` sozinho ignora o ponto (correto
 * quando ele é só milhar auto-inserido) — mas quando o ÚLTIMO ponto acabou de virar
 * a vírgula decimal, ele PASSA a ser significativo, e usar o `raw` original
 * sub-contaria 1, colocando o cursor ANTES da vírgula nova (bug: próxima tecla cai
 * antes da vírgula em vez de depois). Espelha exatamente a normalização que
 * `maskLive` aplica ao texto inteiro, mas só até a posição do cursor.
 */
export function sigBeforeCaret(raw: string, caret: number, decimals: number): number {
  const normalizedFull = normalizarPontos(raw, decimals);
  if (normalizedFull === raw) return countSig(raw.slice(0, caret));
  // O único ponto que muda é o ÚLTIMO ponto do raw (virou vírgula); os pontos
  // ANTES dele apenas somem (nunca depois — a regra só mexe no último ponto).
  // Todo ponto removido está ANTES de `lastDot`, então o deslocamento do cursor
  // pro espaço normalizado é sempre "quantos pontos sumiram antes dele".
  const lastDot = raw.lastIndexOf(".");
  const dotsRemovedBeforeCaret = (raw.slice(0, Math.min(caret, lastDot)).match(/\./g) || []).length;
  const normalizedCaret = caret - dotsRemovedBeforeCaret;
  return countSig(normalizedFull.slice(0, normalizedCaret));
}

/** Valor canônico -> texto mascarado pt-BR (só mostra decimais se existirem no valor). */
export function valueToMasked(v: number | string | null | undefined, decimals: number): string {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) return "";
  const s = String(v).replace("-", "");
  const [rawInt = "", rawDec] = s.split(".");
  const gi = groupInt(rawInt.replace(/\D/g, ""));
  if (rawDec == null || decimals <= 0) return gi;
  const dec = rawDec.replace(/\D/g, "").slice(0, decimals);
  return dec === "" ? gi : (gi === "" ? "0" : gi) + "," + dec;
}

/** Texto cru digitado -> { masked (exibição), canonical (valor emitido) }. */
export function maskLive(raw: string, decimals: number): { masked: string; canonical: string } {
  const s = normalizarPontos(raw, decimals).replace(/[^\d,]/g, ""); // ponto decimal solto vira vírgula; sobra = milhar, auto
  const fc = decimals <= 0 ? -1 : s.indexOf(",");
  const intDigits = (fc === -1 ? s : s.slice(0, fc)).replace(/,/g, "").replace(/^0+(?=\d)/, "");
  const decDigits = fc === -1 ? undefined : s.slice(fc + 1).replace(/,/g, "").slice(0, decimals);
  const gi = groupInt(intDigits);
  // NÃO prefixar "0" no inteiro vazio (ex.: ",5" fica ",5", não "0,5"): esse "0"
  // seria o único char significativo do masked ausente no cru, e desalinharia o
  // cursor no fluxo "vírgula primeiro". No blur, valueToMasked normaliza p/ "0,5".
  const masked = decDigits === undefined ? gi : gi + "," + decDigits;
  const canonical =
    intDigits === "" && !decDigits
      ? ""
      : (intDigits === "" ? "0" : intDigits) + (decDigits ? "." + decDigits : "");
  return { masked, canonical };
}

/**
 * Nova posição do cursor após reformatar: logo após o `sigBefore`-ésimo caractere
 * significativo do texto formatado (`sigBefore` contado no texto cru antes do cursor).
 */
export function caretAfterFormat(masked: string, sigBefore: number): number {
  if (sigBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/[\d,]/.test(masked[i])) {
      if (++seen === sigBefore) return i + 1;
    }
  }
  return masked.length;
}
