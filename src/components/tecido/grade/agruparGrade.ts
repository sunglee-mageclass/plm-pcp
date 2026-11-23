// Funções PURAS de agrupamento da grade de Tecidos (sem React, sem Supabase) — testáveis em unit.

/** Variante COMPLETA (todas as colunas que a grade edita). */
export type GradeVarianteCompleta = {
  id: string;
  artigo_id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
  foto_url: string | null;
  created_at: string;
};

/** Par N:N artigo × categoria (com subcategoria opcional). */
export type GradeArtigoCategoria = {
  artigo_id: string;
  categoria_tecido_id: string;
  subcategoria_tecido_id: string | null;
};

export type GradeCatPar = Pick<
  GradeArtigoCategoria,
  "categoria_tecido_id" | "subcategoria_tecido_id"
>;

/** Agrupa as variantes por artigo, preservando a ordem de entrada (a query ordena por created_at, id). */
export function agruparVariantes(
  variantes: GradeVarianteCompleta[],
): Map<string, GradeVarianteCompleta[]> {
  const mapa = new Map<string, GradeVarianteCompleta[]>();
  for (const v of variantes) {
    const lista = mapa.get(v.artigo_id);
    if (lista) lista.push(v);
    else mapa.set(v.artigo_id, [v]);
  }
  return mapa;
}

/** Agrupa os pares categoria/subcategoria por artigo (o `artigo_id` sai do par, fica só a chave do Map). */
export function agruparCategorias(links: GradeArtigoCategoria[]): Map<string, GradeCatPar[]> {
  const mapa = new Map<string, GradeCatPar[]>();
  for (const l of links) {
    const par: GradeCatPar = {
      categoria_tecido_id: l.categoria_tecido_id,
      subcategoria_tecido_id: l.subcategoria_tecido_id ?? null,
    };
    const lista = mapa.get(l.artigo_id);
    if (lista) lista.push(par);
    else mapa.set(l.artigo_id, [par]);
  }
  return mapa;
}
