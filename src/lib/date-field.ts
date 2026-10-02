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
  /** ISO a emitir: "" = limpou; null = não emitir (incompleto/inválido). */
  iso: string | null;
  /** true = digitou/colou além de 8 dígitos: a tecla foi REJEITADA (texto = o anterior). */
  rejeitado?: boolean;
};

const contarDigitos = (s: string) => s.replace(/\D/g, "").length;

/** Posição no texto mascarado logo depois do `alvo`-ésimo dígito (0 = início). */
const cursorAposDigito = (texto: string, alvo: number): number => {
  if (alvo <= 0) return 0;
  let cont = 0;
  for (let i = 0; i < texto.length; i++) {
    if (/\d/.test(texto[i])) cont++;
    if (cont === alvo) return i + 1;
  }
  return texto.length;
};

/**
 * Processa o que o <input> entregou (`raw`, com o cursor em `cursorRaw`): mascara, mantém o cursor
 * ao lado do mesmo dígito e decide se há data válida a emitir.
 *
 * Passou de 8 dígitos (inserir/colar sobre uma data completa)? A tecla é REJEITADA como um
 * `maxLength`: volta o texto `anterior` (se não vier, desfaz o trecho inserido assumindo que o
 * anterior tinha 10 caracteres) com o cursor onde estava. Assim tela e estado nunca divergem.
 */
export const processarDigitacao = (
  raw: string,
  cursorRaw: number,
  lim: LimitesData = {},
  anterior?: string,
): ResultadoDigitacao => {
  if (contarDigitos(raw) > 8) {
    let prev: string;
    let cursor: number;
    if (anterior !== undefined) {
      prev = maskBr(anterior);
      cursor = Math.max(0, Math.min(prev.length, cursorRaw - (raw.length - anterior.length)));
    } else {
      const k = Math.max(0, raw.length - 10);
      const ini = Math.max(0, cursorRaw - k);
      prev = maskBr(raw.slice(0, ini) + raw.slice(cursorRaw));
      cursor = Math.min(ini, prev.length);
    }
    return { texto: prev, cursor, iso: null, rejeitado: true };
  }
  const texto = maskBr(raw);
  const cursor = cursorAposDigito(texto, contarDigitos(raw.slice(0, Math.max(0, cursorRaw))));
  if (texto === "") return { texto, cursor, iso: "" };
  return { texto, cursor, iso: brToIso(texto, lim) };
};
