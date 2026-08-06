// Aritmética pura da célula da grade destrinchada: { enviada, cortada, recebida, defeito }.
// A CORTADA (reportada pela confecção no PCP) é o 4º campo, aditivo — chave ausente = 0.
export type CelulaGrade = { enviada: number; cortada: number; recebida: number; defeito: number };
export type GradeDetalhe = Record<string, Record<string, CelulaGrade>>;
export const CELULA_ZERO: CelulaGrade = { enviada: 0, cortada: 0, recebida: 0, defeito: 0 };

const n = (v: unknown) => Number(v) || 0;

/** Saldo a receber = Cortada − Recebida (negativo = recebeu mais que o cortado; anomalia). */
export function saldoCelula(c: Partial<CelulaGrade> | undefined): number {
  return n(c?.cortada) - n(c?.recebida);
}

/** Grade Real por célula = max(0, Recebida − Defeito). */
export function gradeRealCelula(c: Partial<CelulaGrade> | undefined): number {
  return Math.max(0, n(c?.recebida) - n(c?.defeito));
}

/** Soma um campo (enviada/cortada/recebida/defeito) sobre toda a grade de um bloco. */
export function somaCampo(g: GradeDetalhe | undefined, campo: keyof CelulaGrade): number {
  let s = 0;
  for (const vid in g ?? {}) for (const t in g![vid] ?? {}) s += n(g![vid][t]?.[campo]);
  return s;
}
