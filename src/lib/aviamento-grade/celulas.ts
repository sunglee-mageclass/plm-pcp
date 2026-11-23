// Mapeamento PURO das células da grade de Aviamentos (sem React, sem Supabase): que controle cada coluna usa, de que campo do
// rascunho ela lê, que opções oferece e como a subcategoria cascateia pela categoria. A célula (`CelulaAviamento`) só desenha
// o que este arquivo decide. Espelha `src/lib/tecido-grade/celulas.ts`, adaptado: categoria/subcategoria/material são 3 SELECTS
// simples (FK única do cabeçalho — sem popover multi) e o fornecedor é o par empresa+representante.
import type { ColunaGrade } from "./colunas";
import type { AviamentoDraft, VarianteDraft } from "./salvar";

export type OpcaoSelect = { id: string; nome: string };

export type ControleCelula = "input" | "money" | "select" | "foto" | "somente-leitura";

/** Tipo da coluna -> controle desenhado. Coluna não editável (ou `readonly`) = texto cinza. */
export function controleDaCelula(c: Pick<ColunaGrade, "tipo" | "editavel">): ControleCelula {
  if (!c.editavel || c.tipo === "readonly") return "somente-leitura";
  switch (c.tipo) {
    case "texto":
      return "input";
    case "money":
      return "money";
    case "select":
      return "select";
    case "foto":
      return "foto";
    default:
      return "somente-leitura";
  }
}

/** Coluna (escopo aviamento) -> campo do `AviamentoDraft`. O fornecedor lê `empresa_id` (o par com o representante é tratado na célula). */
export const CAMPO_AVIAMENTO: Readonly<Record<string, keyof AviamentoDraft>> = {
  codigo: "codigo",
  codigo_nome: "codigo_nome",
  fornecedor: "empresa_id",
  preco: "preco",
  ncm: "ncm",
  categoria: "categoria_aviamento_id",
  subcategoria: "subcategoria_aviamento_id",
  material: "material_aviamento_id",
  composicao: "composicao",
  intervalo_largura: "intervalo_largura_id",
  largura_exata: "largura_exata",
  observacoes: "observacoes",
};

/** Coluna (escopo variante) -> campo do `VarianteDraft`. */
export const CAMPO_VARIANTE: Readonly<Record<string, keyof VarianteDraft>> = {
  cor_base: "cor_id",
  cor_apelido: "cor_apelido_id",
  nome_variante: "nome_variante",
  codigo_variante: "codigo_variante",
  preco_variante: "preco",
};

/** Casas decimais do MoneyInput por coluna (preço e largura usam 2). */
export function casasDaColuna(_key: string): number {
  return 2;
}

/** Radix Select não aceita value="" num item: sentinela para "sem valor". */
export const OPCAO_VAZIA = "__vazio__";

/** Select que deixa limpar o valor (tudo é opcional no aviamento, exceto a cor base da variante). */
export function permiteVazio(key: string): boolean {
  return [
    "fornecedor",
    "categoria",
    "subcategoria",
    "material",
    "intervalo_largura",
    "cor_apelido",
  ].includes(key);
}

/** Colunas multilinha (textarea que preserva as quebras; Enter aqui quebra a linha, não desce). */
export function ehTextoLongo(key: string): boolean {
  return key === "composicao" || key === "observacoes";
}

/** Opções de cada coluna `select` (o mesmo formato das opções que `useAviamentosGrade` devolve). */
export type OpcoesGradeSelect = {
  categorias: OpcaoSelect[];
  subcategorias: { id: string; nome: string; categoria_aviamento_id: string }[];
  materiais: OpcaoSelect[];
  cores: OpcaoSelect[];
  coresApelido: { id: string; nome: string; cor_base_id: string | null }[];
  empresas: { id: string; nome_fantasia: string }[];
  intervalos: OpcaoSelect[];
};

/**
 * Opções da coluna. A subcategoria só lista as da categoria do aviamento (sem categoria, todas — como o card da tela); o apelido só
 * lista os da cor base escolhida (sem cor base, todos — como no Sheet do tecido).
 */
export function opcoesDaColuna(
  key: string,
  o: OpcoesGradeSelect,
  ctx: { categoriaId?: string | null; corId?: string | null } = {},
): OpcaoSelect[] {
  switch (key) {
    case "fornecedor":
      return o.empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }));
    case "categoria":
      return o.categorias;
    case "subcategoria":
      return (
        ctx.categoriaId
          ? o.subcategorias.filter((s) => s.categoria_aviamento_id === ctx.categoriaId)
          : o.subcategorias
      ).map((s) => ({ id: s.id, nome: s.nome }));
    case "material":
      return o.materiais;
    case "intervalo_largura":
      return o.intervalos;
    case "cor_base":
      return o.cores;
    case "cor_apelido":
      return (
        ctx.corId ? o.coresApelido.filter((a) => a.cor_base_id === ctx.corId) : o.coresApelido
      ).map((a) => ({
        id: a.id,
        nome: a.nome,
      }));
    default:
      return [];
  }
}

/**
 * Trocar a CATEGORIA zera a subcategoria que não pertence à nova (a subcategoria cascateia pela categoria). Devolve o valor da
 * subcategoria que deve ficar (a atual, se ainda pertence; senão `null`).
 */
export function subcategoriaAposTrocarCategoria(
  novaCategoriaId: string | null,
  subAtualId: string | null,
  subcategorias: { id: string; categoria_aviamento_id: string }[],
): string | null {
  if (!subAtualId) return null;
  if (!novaCategoriaId) return null;
  const sub = subcategorias.find((s) => s.id === subAtualId);
  return sub && sub.categoria_aviamento_id === novaCategoriaId ? subAtualId : null;
}

/** Fornecedor da célula: os de aviamento (TOKEN) + o já salvo no aviamento, mesmo que a categoria dele tenha mudado depois. */
export function empresasParaLinha<E extends { id: string; ehAviamento?: boolean }>(
  empresas: E[],
  empresaAtualId: string | null,
): E[] {
  return empresas.filter((e) => e.ehAviamento !== false || e.id === empresaAtualId);
}
