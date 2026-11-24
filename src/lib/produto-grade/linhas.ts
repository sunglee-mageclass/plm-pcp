// Montagem PURA das linhas da grade "Lista tipo Excel" do Planejamento de Produto (sem React, sem Supabase).
// Diferente de Tecidos/Aviamentos/Insumos: 1 LINHA POR MODELO — sem pai/filhos, sem variantes (a cor/tamanho mora no Sheet).
// A linha carrega o modelo INTEIRO (inclui `rev`, p/ o CAS da PR-2), na MESMA ordem recebida.

import { rotuloOrigem } from "@/lib/origem";
import type { ColunaProduto } from "./colunas";

/** Campos do MODELO que a grade lê (mínimo; a query traz exatamente estes). Colunas novas sem types.ts (ncm, titulo_pagina…) incluídas. */
export type ModeloGradeEntrada = {
  id: string;
  /** Contador otimista da raiz (`modelos.rev`): a PR-2 salva com `.eq("rev", rev)` e trata o P0409. */
  rev: number;
  nome: string | null;
  /** Só a REF OFICIAL (nunca `ref_auto`: a sigla pré-revelação não aparece — invariante 11). */
  ref: string | null;
  estilista_id: string | null;
  linha_id: string | null;
  /** Texto livre CRU (o que se grava). O que se MOSTRA é `colecao_rotulo`. */
  colecao: string | null;
  colecao_id: string | null;
  /** Rótulo da coleção (nome do OTB, senão o texto) — `rotuloColecaoDoModelo`. Nunca use para escrever de volta. */
  colecao_rotulo: string | null;
  subcolecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  status_planejamento: string | null;
  status_desenvolvimento: string | null;
  ordem_criacao_enviada: boolean | null;
  /** Já enviado à Explosão: trava os campos do Desenvolvimento (ver `colunaEditavelNoProduto`). */
  enviado_cad: boolean | null;
  versao: number | null;
  /** 'interno' | 'revenda' | 'importado'. */
  origem: string | null;
  descricao_produto: string | null;
  ncm: string | null;
  titulo_pagina: string | null;
  peso_kg: number | null;
  comprimento_cm: number | null;
  largura_cm: number | null;
  altura_cm: number | null;
  preco_venda: number | null;
  preco_anterior: number | null;
  preco_atacado: number | null;
  tamanho_tipo: string | null;
  observacoes_gerais: string | null;
  observacoes_mao_obra: string | null;
  data_lancamento: string | null;
  lancado: boolean | null;
};

export type LinhaProduto = {
  /** = id do modelo (1 linha por modelo). */
  chave: string;
  modeloId: string;
  modelo: ModeloGradeEntrada;
};

export function chaveLinha(modeloId: string): string {
  return modeloId;
}

/**
 * 1 linha por modelo, na ordem recebida. Id repetido (a paginação pode devolver o mesmo modelo 2×) entra UMA vez — a 1ª ocorrência vale.
 */
export function montarLinhas(modelos: readonly ModeloGradeEntrada[]): LinhaProduto[] {
  const vistos = new Set<string>();
  const linhas: LinhaProduto[] = [];
  for (const modelo of modelos) {
    if (vistos.has(modelo.id)) continue;
    vistos.add(modelo.id);
    linhas.push({ chave: chaveLinha(modelo.id), modeloId: modelo.id, modelo });
  }
  return linhas;
}

/**
 * Os modelos da grade NA ORDEM da tela: `ids` = o que o Planejamento já filtrou e ordenou; devolve só os que a consulta da grade tem
 * (produto recém-criado que a grade ainda não leu fica de fora até o próximo refetch — nunca se inventa linha). Id repetido entra 1×.
 */
export function modelosNaOrdemDaTela<T extends { id: string }>(
  modelos: readonly T[],
  ids: readonly { id: string }[],
): T[] {
  const porId = new Map(modelos.map((m) => [m.id, m]));
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const { id } of ids) {
    if (vistos.has(id)) continue;
    const achado = porId.get(id);
    if (!achado) continue;
    vistos.add(id);
    out.push(achado);
  }
  return out;
}

/** Traduz o valor cru de uma coluna de seleção (id) em texto. Recebe a chave da coluna e o id; devolve o rótulo ou null se não achar. */
export type ResolverRotulo = (colKey: string, id: string) => string | null | undefined;

/**
 * Accessor para exibir/ordenar (useSort): o valor da coluna naquela linha.
 * Sem `resolver`, colunas de seleção devolvem o id cru; com ele, o rótulo (id sem rótulo cai no id). `grupo` é DERIVADO da categoria:
 * só existe com `resolver` ("grupo", id da categoria) — sem ele devolve null (nunca o id da categoria disfarçado de grupo).
 * Coleção devolve o RÓTULO (nome do OTB, senão o texto livre) nos dois modos.
 */
export function valorColuna(
  linha: LinhaProduto,
  col: ColunaProduto,
  resolver?: ResolverRotulo,
): string | number | null {
  const m = linha.modelo;
  const rot = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return resolver ? (resolver(col.key, id) ?? id) : id;
  };

  switch (col.key) {
    case "ref":
      return m.ref ?? null;
    case "versao":
      return m.versao ?? null;
    case "origem":
      return rotuloOrigem(m.origem);
    case "status_planejamento": {
      const s = m.status_planejamento;
      if (!s) return null;
      return resolver ? (resolver(col.key, s) ?? s) : s;
    }
    case "nome":
      return m.nome ?? null;
    case "descricao_produto":
      return m.descricao_produto ?? null;
    case "ncm":
      return m.ncm ?? null;
    case "titulo_pagina":
      return m.titulo_pagina ?? null;
    case "peso_kg":
      return m.peso_kg ?? null;
    case "comprimento_cm":
      return m.comprimento_cm ?? null;
    case "largura_cm":
      return m.largura_cm ?? null;
    case "altura_cm":
      return m.altura_cm ?? null;
    case "preco_venda":
      return m.preco_venda ?? null;
    case "preco_anterior":
      return m.preco_anterior ?? null;
    case "preco_atacado":
      return m.preco_atacado ?? null;
    case "colecao":
      return m.colecao_rotulo ?? null;
    case "subcolecao":
      return m.subcolecao ?? null;
    case "semana":
      return m.semana ?? null;
    case "linha_id":
      return rot(m.linha_id);
    case "mes_id":
      return rot(m.mes_id);
    case "ano_id":
      return rot(m.ano_id);
    case "estilista_id":
      return rot(m.estilista_id);
    case "data_lancamento":
      return m.data_lancamento ?? null;
    case "grupo": {
      if (!m.categoria_principal_id || !resolver) return null;
      return resolver(col.key, m.categoria_principal_id) ?? null;
    }
    case "categoria_principal_id":
      return rot(m.categoria_principal_id);
    case "subcategoria1_id":
      return rot(m.subcategoria1_id);
    case "subcategoria2_id":
      return rot(m.subcategoria2_id);
    case "tamanho_tipo":
      return m.tamanho_tipo ?? null;
    case "observacoes_gerais":
      return m.observacoes_gerais ?? null;
    case "observacoes_mao_obra":
      return m.observacoes_mao_obra ?? null;
    default:
      return null;
  }
}
