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
  const s = raw.replace(/[^\d,]/g, ""); // mantém só dígitos e vírgulas (pontos = milhar, auto)
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
