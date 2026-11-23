// Funções PURAS de agrupamento da grade de Aviamentos (sem React, sem Supabase) — testáveis em unit.
// Espelha `src/components/tecido/grade/agruparGrade.ts`, sem as categorias N:N (no aviamento a categoria é FK do cabeçalho).

/** Variante COMPLETA (todas as colunas que a grade edita). */
export type GradeVarianteCompleta = {
  id: string;
  aviamento_id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
  foto_url: string | null;
  created_at: string;
};

/** Agrupa as variantes por aviamento, preservando a ordem de entrada (a query ordena por created_at, id). */
export function agruparVariantes(
  variantes: GradeVarianteCompleta[],
): Map<string, GradeVarianteCompleta[]> {
  const mapa = new Map<string, GradeVarianteCompleta[]>();
  for (const v of variantes) {
    const lista = mapa.get(v.aviamento_id);
    if (lista) lista.push(v);
    else mapa.set(v.aviamento_id, [v]);
  }
  return mapa;
}
