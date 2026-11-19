/**
 * Rótulo SÓ-LEITURA "Categoria › Subcategoria" do tecido (artigo), mostrado na Ficha Técnica — a tela viva
 * (Sheet do Planejamento, `useFichaDados`) e a impressa (`useFichaData`/`MaterialTable`) usam ESTE mesmo código
 * (evita drift). Funções puras; nada de acesso ao banco aqui.
 *
 * Regras (decisão do dono, 19/nov): TODAS as categorias do tecido, cada uma com a sua sub — "Malha › Lisa, Plano › Estampado";
 * categoria SEM sub → só o nome da categoria; tecido SEM categoria → "" (nada é exibido).
 */
export type ParCategoriaSubNome = { categoria: string; sub: string | null };

const SEP_SUB = " › ";
const SEP_PARES = ", ";

/** "Malha › Lisa, Plano" — pares vazios (categoria em branco) são ignorados; sub em branco = só a categoria. */
export function rotuloCategoriasTecido(pares: ParCategoriaSubNome[] | null | undefined): string {
  const partes: string[] = [];
  for (const p of pares ?? []) {
    const cat = (p.categoria ?? "").trim();
    if (!cat) continue;
    const sub = (p.sub ?? "").trim();
    partes.push(sub ? `${cat}${SEP_SUB}${sub}` : cat);
  }
  return partes.join(SEP_PARES);
}

export type LinkArtigoCategoria = {
  artigo_id: string;
  categoria_tecido_id: string;
  subcategoria_tecido_id?: string | null;
};

/**
 * artigo_id → pares {categoria, sub} (nomes resolvidos), ordenados pelo nome da categoria (pt-BR) p/ a ordem não depender da
 * ordem das linhas do banco. Categoria/sub de id desconhecido (catálogo ainda não chegou) é omitida/vira "sem sub".
 * `categoriaPrincipalPorArtigo` (artigos.categoria_tecido_id, legado): só vale p/ artigo SEM nenhuma linha em `artigo_categorias_tecido`.
 */
export function montarParesPorArtigo(
  links: LinkArtigoCategoria[],
  categoriaNomePorId: Map<string, string>,
  subNomePorId: Map<string, string>,
  categoriaPrincipalPorArtigo?: Map<string, string | null>,
): Map<string, ParCategoriaSubNome[]> {
  const out = new Map<string, ParCategoriaSubNome[]>();
  for (const l of links) {
    const categoria = categoriaNomePorId.get(l.categoria_tecido_id);
    if (!categoria) continue;
    const sub = l.subcategoria_tecido_id ? (subNomePorId.get(l.subcategoria_tecido_id) ?? null) : null;
    const arr = out.get(l.artigo_id) ?? [];
    arr.push({ categoria, sub });
    out.set(l.artigo_id, arr);
  }
  const comLinha = new Set(links.map((l) => l.artigo_id));
  if (categoriaPrincipalPorArtigo) {
    for (const [artigoId, catId] of categoriaPrincipalPorArtigo) {
      if (!catId || comLinha.has(artigoId)) continue;
      const categoria = categoriaNomePorId.get(catId);
      if (categoria) out.set(artigoId, [{ categoria, sub: null }]);
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR"));
  return out;
}

/** artigo_id → rótulo pronto (só os que têm algo p/ mostrar). */
export function rotulosPorArtigo(pares: Map<string, ParCategoriaSubNome[]>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, ps] of pares) {
    const r = rotuloCategoriasTecido(ps);
    if (r) m.set(id, r);
  }
  return m;
}
