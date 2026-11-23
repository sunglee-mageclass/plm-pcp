// Montagem PURA das linhas da grade de Insumos (sem React, sem Supabase) — espelha `src/lib/aviamento-grade/linhas.ts`.
// A linha-FILHA é a COR (decisão do dono: 1 linha por cor, com 1 preço por cor e os tamanhos numa célula de multi-check) — não a
// variante cor×tamanho do banco. 1 linha de DADOS por cor (cada uma carrega o insumo, p/ ordenar e salvar); a TELA mostra o cabeçalho
// só na linha-pai do insumo e as cores como filhas. Insumo sem nenhuma variante = 1 linha "sem cor" (na tela, a própria linha-pai).
// Diferenças do aviamento: sem apelido/foto/categoria; `tipo_insumo_id` é UM select; os tamanhos são uma LISTA da linha, não linhas.

import type { ColunaGrade } from "./colunas";

/** Campos do INSUMO (`etiquetas`) que as colunas leem (mínimo; a query da grade devolve mais). */
export type InsumoEntrada = {
  id: string;
  nome: string;
  unidade: string;
  preco: number | null;
  empresa_id: string | null;
  representante_id?: string | null;
  observacoes: string | null;
  formato_tamanho: string;
  tipo_insumo_id: string | null;
  tamanho_vinculado: string | null;
};

/** Bloco de COR do insumo (= `BlocoCorInsumo` da camada de dados). `cor_id === ""` = "sem cor". */
export type BlocoEntrada = { cor_id: string; preco: number | null; tamanhos: string[] };

export type LinhaGrade = {
  /** insumoId + ":" + (cor_id || "sem-cor") */
  chave: string;
  insumoId: string;
  /** "" = bloco "sem cor" (variantes sem cor); null = insumo SEM nenhuma variante (linha "sem cor" sem bloco). */
  corId: string | null;
  insumo: InsumoEntrada;
  /** null = insumo sem variantes. */
  bloco: BlocoEntrada | null;
};

export const SEM_COR = "sem-cor";

export function chaveLinha(insumoId: string, corId: string | null): string {
  return `${insumoId}:${corId || SEM_COR}`;
}

/**
 * 1 linha por COR, na ordem dos insumos recebidos e dos blocos recebidos.
 * Insumo sem blocos (ausente no Map ou lista vazia) = 1 linha "sem cor" (`bloco: null`).
 */
export function montarLinhas(
  insumos: InsumoEntrada[],
  blocosPorEtiqueta: Map<string, BlocoEntrada[]>,
): LinhaGrade[] {
  const linhas: LinhaGrade[] = [];
  for (const insumo of insumos) {
    const blocos = blocosPorEtiqueta.get(insumo.id) ?? [];
    if (blocos.length === 0) {
      linhas.push({
        chave: chaveLinha(insumo.id, null),
        insumoId: insumo.id,
        corId: null,
        insumo,
        bloco: null,
      });
      continue;
    }
    for (const bloco of blocos) {
      linhas.push({
        chave: chaveLinha(insumo.id, bloco.cor_id),
        insumoId: insumo.id,
        corId: bloco.cor_id,
        insumo,
        bloco,
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
 * Accessor para ordenação (useSort): lê do insumo (escopo "insumo") ou do bloco da cor (escopo "variante"). Linha "sem cor" sem
 * bloco devolve null nas colunas da cor. Sem `resolver`, colunas de seleção devolvem o id cru; com ele, o rótulo (id sem rótulo cai
 * no id). `tamanhos` = as chaves marcadas juntas por ", " (vazio = null); `tamanho_vinculado` = a chave gravada ("40|M").
 */
export function valorColuna(
  linha: LinhaGrade,
  col: ColunaGrade,
  resolver?: ResolverRotulo,
): string | number | null {
  const i = linha.insumo;
  const b = linha.bloco;
  const rot = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return resolver ? (resolver(col.key, id) ?? id) : id;
  };

  if (col.escopo === "variante") {
    if (!b) return null;
    switch (col.key) {
      case "cor":
        return rot(b.cor_id);
      case "tamanhos":
        return b.tamanhos.length > 0 ? b.tamanhos.join(", ") : null;
      case "preco_variante":
        return b.preco ?? null;
      default:
        return null;
    }
  }

  switch (col.key) {
    case "nome":
      return i.nome ?? null;
    case "tipo_insumo":
      return rot(i.tipo_insumo_id);
    case "unidade":
      return i.unidade ?? null;
    case "fornecedor":
      return rot(i.empresa_id);
    case "preco":
      return i.preco ?? null;
    case "formato_tamanho":
      return i.formato_tamanho ?? null;
    case "tamanho_vinculado":
      return i.tamanho_vinculado || null;
    case "observacoes":
      return i.observacoes ?? null;
    default:
      return null;
  }
}
