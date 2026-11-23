// Montagem PURA das linhas da grade de Tecidos (sem React, sem Supabase).
// "Lista corrida": 1 linha por variante (cabeçalho do artigo repetido por cor);
// artigo sem nenhuma variante = 1 linha "sem cor".

import type { ColunaGrade } from "./colunas";

/** Par N:N artigo × categoria (subcategoria opcional). */
export type CategoriaEntrada = {
  categoria_tecido_id: string;
  subcategoria_tecido_id: string | null;
};

/** Campos do ARTIGO que as colunas leem (mínimo; a query da grade devolve mais). */
export type ArtigoEntrada = {
  id: string;
  rev: number | null;
  nome: string;
  empresa_id: string | null;
  preco: number | null;
  unidade_medida: string | null;
  largura_estimada: number | null;
  composicao: string | null;
  ncm: string | null;
  rendimento: number | null;
  mes_id: string | null;
  ano_id: string | null;
  /** Derivada no banco; só leitura. */
  preco_por_metro?: number | null;
  categorias?: CategoriaEntrada[];
};

/** Campos da VARIANTE que as colunas leem. */
export type VarianteEntrada = {
  id: string;
  artigo_id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
  foto_url: string | null;
};

export type LinhaGrade = {
  /** artigoId + ":" + (variantId ?? "sem-cor") */
  chave: string;
  artigoId: string;
  rev: number | null;
  /** null = linha "sem cor" (artigo sem variantes). */
  variantId: string | null;
  artigo: ArtigoEntrada;
  variante: VarianteEntrada | null;
};

export const SEM_COR = "sem-cor";

export function chaveLinha(artigoId: string, variantId: string | null): string {
  return `${artigoId}:${variantId ?? SEM_COR}`;
}

/**
 * 1 linha por variante, na ordem dos artigos recebidos e das variantes recebidas.
 * Artigo sem variantes (ausente no Map ou lista vazia) = 1 linha "sem cor".
 */
export function montarLinhas(
  artigos: ArtigoEntrada[],
  variantesPorArtigo: Map<string, VarianteEntrada[]>,
): LinhaGrade[] {
  const linhas: LinhaGrade[] = [];
  for (const artigo of artigos) {
    const variantes = variantesPorArtigo.get(artigo.id) ?? [];
    if (variantes.length === 0) {
      linhas.push({
        chave: chaveLinha(artigo.id, null),
        artigoId: artigo.id,
        rev: artigo.rev ?? null,
        variantId: null,
        artigo,
        variante: null,
      });
      continue;
    }
    for (const variante of variantes) {
      linhas.push({
        chave: chaveLinha(artigo.id, variante.id),
        artigoId: artigo.id,
        rev: artigo.rev ?? null,
        variantId: variante.id,
        artigo,
        variante,
      });
    }
  }
  return linhas;
}

/**
 * Traduz o valor cru de uma coluna de seleção/categorias (ids) em texto para ordenar.
 * Recebe a chave da coluna e o id; devolve o rótulo ou null se não achar.
 */
export type ResolverRotulo = (colKey: string, id: string) => string | null | undefined;

/**
 * Accessor para ordenação (useSort): lê do artigo (escopo "artigo") ou da variante
 * (escopo "variante"). Linha "sem cor" devolve null nas colunas de variante.
 * Sem `resolver`, colunas de seleção devolvem o id cru; com ele, o rótulo.
 */
export function valorColuna(
  linha: LinhaGrade,
  col: ColunaGrade,
  resolver?: ResolverRotulo,
): string | number | null {
  const a = linha.artigo;
  const v = linha.variante;
  const rot = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return resolver ? (resolver(col.key, id) ?? id) : id;
  };

  if (col.escopo === "variante") {
    if (!v) return null;
    switch (col.key) {
      case "cor_base":
        return rot(v.cor_id);
      case "cor_apelido":
        return rot(v.cor_apelido_id);
      case "nome_variante":
        return v.nome_variante ?? null;
      case "codigo_variante":
        return v.codigo_variante ?? null;
      case "preco_variante":
        return v.preco ?? null;
      case "foto":
        return v.foto_url ?? null;
      default:
        return null;
    }
  }

  switch (col.key) {
    case "nome":
      return a.nome ?? null;
    case "fornecedor":
      return rot(a.empresa_id);
    case "preco":
      return a.preco ?? null;
    case "unidade":
      return a.unidade_medida ?? null;
    case "largura_estimada":
      return a.largura_estimada ?? null;
    case "composicao":
      return a.composicao ?? null;
    case "ncm":
      return a.ncm ?? null;
    case "rendimento":
      return a.rendimento ?? null;
    case "mes":
      return rot(a.mes_id);
    case "ano":
      return rot(a.ano_id);
    case "preco_por_metro":
      return a.preco_por_metro ?? null;
    case "categorias": {
      const ids = (a.categorias ?? [])
        .map((c) => rot(c.categoria_tecido_id))
        .filter((x): x is string => !!x);
      return ids.length ? ids.join(", ") : null;
    }
    default:
      return null;
  }
}
