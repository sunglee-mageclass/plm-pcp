/**
 * Subcategoria de tecido POR categoria marcada (Sheet do tecido). Funções puras: o estado `subPorCat`
 * guarda SÓ as categorias com sub escolhida (chave ausente = sem sub), para o snapshot do dirty-guard
 * não acender por `{A: null}` vs `{}`.
 */
export type SubPorCat = Record<string, string | null>;

export type ParCategoriaSub = { categoria_tecido_id: string; subcategoria_tecido_id: string | null };

/** Payload de `set_artigo_categorias(_artigo_id, _pares)`: 1 par por categoria MARCADA; sub de categoria desmarcada não entra. */
export function paresParaSalvar(catIds: string[], subPorCat: SubPorCat): ParCategoriaSub[] {
  return catIds.map((c) => ({ categoria_tecido_id: c, subcategoria_tecido_id: subPorCat[c] ?? null }));
}

/** Estado novo ao escolher (ou limpar, `subId` vazio/null) a sub de uma categoria. */
export function definirSub(subPorCat: SubPorCat, catId: string, subId: string | null): SubPorCat {
  const prox = { ...subPorCat };
  if (subId) prox[catId] = subId;
  else delete prox[catId];
  return prox;
}

/** Estado após mudar as categorias marcadas: descarta a sub de quem foi desmarcada. */
export function podarSubs(subPorCat: SubPorCat, catIds: string[]): SubPorCat {
  const prox: SubPorCat = {};
  for (const c of catIds) if (subPorCat[c]) prox[c] = subPorCat[c];
  return prox;
}

/** Mapa inicial a partir das linhas do servidor (só as que têm sub). */
export function subPorCatDasLinhas(
  linhas: { categoria_tecido_id: string; subcategoria_tecido_id: string | null }[],
): SubPorCat {
  const m: SubPorCat = {};
  for (const l of linhas) if (l.subcategoria_tecido_id) m[l.categoria_tecido_id] = l.subcategoria_tecido_id;
  return m;
}
