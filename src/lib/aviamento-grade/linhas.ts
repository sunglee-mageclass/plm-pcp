// Montagem PURA das linhas da grade de Aviamentos (sem React, sem Supabase) — espelha `src/lib/tecido-grade/linhas.ts`.
// 1 linha de DADOS por variante (cada uma carrega o aviamento, p/ ordenar e salvar); a TELA mostra o cabeçalho só na linha-pai do
// aviamento e as cores como filhas. Aviamento sem nenhuma variante = 1 linha "sem cor" (na tela, a própria linha-pai).
// Diferenças do tecido: categoria/subcategoria/material são FK ÚNICA no cabeçalho (sem lista N:N na entrada) e o aviamento não
// tem `rev` (a linha não carrega versão).

import type { ColunaGrade } from "./colunas";

/** Campos do AVIAMENTO que as colunas leem (mínimo; a query da grade devolve mais). */
export type AviamentoEntrada = {
  id: string;
  codigo: string | null;
  /** Nome do aviamento (NÃO é `nome`). */
  codigo_nome: string;
  empresa_id: string | null;
  representante_id?: string | null;
  categoria_aviamento_id: string | null;
  subcategoria_aviamento_id: string | null;
  material_aviamento_id: string | null;
  composicao: string | null;
  preco: number | null;
  ncm: string | null;
  observacoes: string | null;
  intervalo_largura_id: string | null;
  largura_exata: number | null;
};

/** Campos da VARIANTE que as colunas leem. */
export type VarianteEntrada = {
  id: string;
  aviamento_id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
  foto_url: string | null;
};

export type LinhaGrade = {
  /** aviamentoId + ":" + (variantId ?? "sem-cor") */
  chave: string;
  aviamentoId: string;
  /** null = linha "sem cor" (aviamento sem variantes). */
  variantId: string | null;
  aviamento: AviamentoEntrada;
  variante: VarianteEntrada | null;
};

export const SEM_COR = "sem-cor";

export function chaveLinha(aviamentoId: string, variantId: string | null): string {
  return `${aviamentoId}:${variantId ?? SEM_COR}`;
}

/**
 * 1 linha por variante, na ordem dos aviamentos recebidos e das variantes recebidas.
 * Aviamento sem variantes (ausente no Map ou lista vazia) = 1 linha "sem cor".
 */
export function montarLinhas(
  aviamentos: AviamentoEntrada[],
  variantesPorAviamento: Map<string, VarianteEntrada[]>,
): LinhaGrade[] {
  const linhas: LinhaGrade[] = [];
  for (const aviamento of aviamentos) {
    const variantes = variantesPorAviamento.get(aviamento.id) ?? [];
    if (variantes.length === 0) {
      linhas.push({
        chave: chaveLinha(aviamento.id, null),
        aviamentoId: aviamento.id,
        variantId: null,
        aviamento,
        variante: null,
      });
      continue;
    }
    for (const variante of variantes) {
      linhas.push({
        chave: chaveLinha(aviamento.id, variante.id),
        aviamentoId: aviamento.id,
        variantId: variante.id,
        aviamento,
        variante,
      });
    }
  }
  return linhas;
}

/**
 * Traduz o valor cru de uma coluna de seleção (id) em texto para ordenar.
 * Recebe a chave da coluna e o id; devolve o rótulo ou null se não achar.
 */
export type ResolverRotulo = (colKey: string, id: string) => string | null | undefined;

/**
 * Accessor para ordenação (useSort): lê do aviamento (escopo "aviamento") ou da variante
 * (escopo "variante"). Linha "sem cor" devolve null nas colunas de variante.
 * Sem `resolver`, colunas de seleção devolvem o id cru; com ele, o rótulo (id sem rótulo cai no id).
 */
export function valorColuna(
  linha: LinhaGrade,
  col: ColunaGrade,
  resolver?: ResolverRotulo,
): string | number | null {
  const a = linha.aviamento;
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
    case "codigo":
      return a.codigo ?? null;
    case "codigo_nome":
      return a.codigo_nome ?? null;
    case "fornecedor":
      return rot(a.empresa_id);
    case "preco":
      return a.preco ?? null;
    case "ncm":
      return a.ncm ?? null;
    case "categoria":
      return rot(a.categoria_aviamento_id);
    case "subcategoria":
      return rot(a.subcategoria_aviamento_id);
    case "material":
      return rot(a.material_aviamento_id);
    case "composicao":
      return a.composicao ?? null;
    case "intervalo_largura":
      return rot(a.intervalo_largura_id);
    case "largura_exata":
      return a.largura_exata ?? null;
    case "observacoes":
      return a.observacoes ?? null;
    default:
      return null;
  }
}
