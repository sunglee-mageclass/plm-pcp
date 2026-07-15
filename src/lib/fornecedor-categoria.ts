// Filtro de fornecedor por CATEGORIA nos cards de Tecido / Aviamento.
//
// A categoria de fornecedor (`categorias_fornecedor`) é texto LIVRE por loja: cada
// loja nomeia do seu jeito ("TECIDOS", "Tecido", "Artigos", "AVIAMENTOS", …). Casar o
// nome EXATO (`.in("...nome", ["Tecido",...])`) deixava o dropdown vazio para qualquer
// loja que renomeasse as categorias (bug real na Ave Rara). Em vez disso, casa por
// TOKEN normalizado: sem acento, minúsculo, por SUBSTRING — então "tecidos"/"artigos"
// casam "tecido"/"artigo" (cobre plural e caixa sem lista de variações).

export const normalizeCat = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Tecido é o antigo "Artigo" (renomeação de UI) — a loja pode ter nomeado a categoria
// de fornecedor de tecido como "Artigo"/"Artigos"; por isso entram como tokens.
export const FABRIC_TOKENS = ["tecido", "artigo", "forro", "entretela"];
export const AVIAMENTO_TOKENS = ["aviamento"];
// Etiqueta/TAG: a loja pode nomear a categoria de fornecedor de várias formas
// (Insumo/Etiqueta/Tag). Substring normalizada cobre plural/caixa.
export const ETIQUETA_TOKENS = ["etiqueta", "tag", "insumo"];

type EmpresaComCategorias = {
  empresa_categorias_fornecedor?: ({ categorias_fornecedor?: { nome?: string | null } | null } | null)[] | null;
};

/** true se a empresa tem ao menos uma categoria de fornecedor cujo nome normalizado
 *  contém algum dos tokens (ex.: FABRIC_TOKENS p/ o card de Tecido). */
export function empresaTemCategoria(empresa: EmpresaComCategorias, tokens: string[]): boolean {
  const links = empresa?.empresa_categorias_fornecedor ?? [];
  return links.some((l) => {
    const nm = normalizeCat(l?.categorias_fornecedor?.nome);
    return nm !== "" && tokens.some((tok) => nm.includes(tok));
  });
}
