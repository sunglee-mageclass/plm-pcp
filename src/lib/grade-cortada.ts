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

/**
 * A Recebida nunca deveria ser maior que a Cortada — alerta (não bloqueio) por célula.
 * Cortada ausente lê como 0, então recebida > 0 sem cortada também é violação (correto:
 * recebeu algo que não consta como cortado).
 */
export function recebidaExcedeCortada(c: Partial<CelulaGrade> | undefined): boolean {
  return n(c?.recebida) > n(c?.cortada);
}

/** Lista (variante_tecido_id, tamanho) de toda célula da grade com Recebida > Cortada. Reusado pelo CQ. */
export function celulasRecebidaAcimaCortada(
  g: GradeDetalhe | undefined
): Array<{ variante_tecido_id: string; tamanho: string }> {
  const out: Array<{ variante_tecido_id: string; tamanho: string }> = [];
  for (const vid in g ?? {})
    for (const t in g![vid] ?? {})
      if (recebidaExcedeCortada(g![vid][t])) out.push({ variante_tecido_id: vid, tamanho: t });
  return out;
}

/**
 * Grade COMPLETA (zeros EXPLÍCITOS em toda size-key de `tamanhos`) de uma linha do payload do CQ.
 * Usada no caminho fonte-única: o `_salvar_cq_core` só faz jsonb_set das size-keys PRESENTES no
 * payload; se o operador zera tudo e a linha some (ou vai com grade parcial), o grade_detalhe da
 * fonte mantém os valores velhos e o refetch re-semeia os antigos (perda silenciosa da zeragem).
 * Enviar zeros explícitos em todas as size-keys faz o backend gravar 0 e a zeragem persistir.
 */
export function completarGradeFonte(
  grades: Record<string, number> | undefined,
  tamanhos: string[],
): { grades: Record<string, number>; grade_total: number } {
  const out: Record<string, number> = {};
  let total = 0;
  for (const t of tamanhos) {
    const v = n(grades?.[t]);
    out[t] = v;
    total += v;
  }
  return { grades: out, grade_total: total };
}
