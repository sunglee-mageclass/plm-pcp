import { format, parse, isValid } from "date-fns";

/** Ano mínimo/máximo aceitos pelo DateField (fora disso = digitação acidental). */
export const ANO_MIN = 1900;
export const ANO_MAX = 2100;

export type LimitesData = { min?: string; max?: string }; // ISO yyyy-MM-dd

/** Formata enquanto digita: só dígitos, injeta as barras dd/mm/aaaa (máx. 8 dígitos). */
export const maskBr = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  let s = d.slice(0, 2);
  if (d.length > 2) s += "/" + d.slice(2, 4);
  if (d.length > 4) s += "/" + d.slice(4, 8);
  return s;
};

/**
 * "dd/MM/yyyy" -> ISO, ou null se incompleto/inválido. Rejeita 31/02 (round-trip), ano fora de
 * 1900–2100 e data fora de `min`/`max` (comparação ISO lexicográfica).
 */
export const brToIso = (br: string, lim: LimitesData = {}): string | null => {
  if (br.length !== 10) return null;
  const d = parse(br, "dd/MM/yyyy", new Date());
  if (!isValid(d) || format(d, "dd/MM/yyyy") !== br) return null;
  const ano = d.getFullYear();
  if (ano < ANO_MIN || ano > ANO_MAX) return null;
  const iso = format(d, "yyyy-MM-dd");
  const min = (lim.min ?? "").slice(0, 10);
  const max = (lim.max ?? "").slice(0, 10);
  if (min && iso < min) return null;
  if (max && iso > max) return null;
  return iso;
};

export type ResultadoDigitacao = {
  /** Texto mascarado a exibir. */
  texto: string;
  /** Posição do cursor no texto mascarado. */
  cursor: number;
  /** ISO a emitir: "" = limpou; null = não emitir (incompleto/inválido/ambíguo). */
  iso: string | null;
};

/**
 * Processa o que o <input> entregou (`raw`, com o cursor em `cursorRaw`): mascara, mantém o cursor
 * ao lado do mesmo dígito e decide se há data válida a emitir. Se o usuário digitou dígitos além
 * de 8 (ex.: inserir no meio de uma data completa), o mascaramento truncaria a cauda e criaria uma
 * data "válida" errada (15/07/2026 + "1" no meio -> 11/50/7202...) — nesse caso NÃO emite.
 */
export const processarDigitacao = (
  raw: string,
  cursorRaw: number,
  lim: LimitesData = {},
): ResultadoDigitacao => {
  const texto = maskBr(raw);
  const digitosAntes = raw.slice(0, Math.max(0, cursorRaw)).replace(/\D/g, "").length;
  const alvo = Math.min(digitosAntes, 8);
  let cursor = texto.length;
  if (alvo === 0) cursor = 0;
  else {
    let cont = 0;
    for (let i = 0; i < texto.length; i++) {
      if (/\d/.test(texto[i])) cont++;
      if (cont === alvo) {
        cursor = i + 1;
        break;
      }
    }
  }
  const nDigitos = raw.replace(/\D/g, "").length;
  if (texto === "") return { texto, cursor, iso: "" };
  if (nDigitos > 8) return { texto, cursor, iso: null };
  return { texto, cursor, iso: brToIso(texto, lim) };
};
