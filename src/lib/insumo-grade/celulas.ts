// Mapeamento PURO das células da grade de Insumos (sem React, sem Supabase): que controle cada coluna usa, de que campo do rascunho
// ela lê, que opções oferece e as regras da célula de TAMANHOS (multi-check) e do tamanho-vinculado. A célula (`CelulaInsumo`) só
// desenha o que este arquivo decide. Espelha `src/lib/aviamento-grade/celulas.ts`, com as peças novas do insumo.
import type { ColunaGrade } from "./colunas";
import type { BlocoDraft, InsumoDraft } from "./salvar";

export type OpcaoSelect = { id: string; nome: string };

export type ControleCelula =
  | "input"
  | "money"
  | "select"
  | "tamanhos"
  | "tamanho-vinculado"
  | "somente-leitura";

/** Tipo da coluna -> controle desenhado. Coluna não editável = texto cinza. */
export function controleDaCelula(c: Pick<ColunaGrade, "tipo" | "editavel">): ControleCelula {
  if (!c.editavel) return "somente-leitura";
  switch (c.tipo) {
    case "texto":
      return "input";
    case "money":
      return "money";
    case "select":
      return "select";
    case "tamanhos":
      return "tamanhos";
    case "tamanho-vinculado":
      return "tamanho-vinculado";
    default:
      return "somente-leitura";
  }
}

/** Coluna (escopo insumo) -> campo do `InsumoDraft`. O fornecedor lê `empresa_id` (o par com o representante é tratado na célula). */
export const CAMPO_INSUMO: Readonly<Record<string, keyof InsumoDraft>> = {
  nome: "nome",
  tipo_insumo: "tipo_insumo_id",
  unidade: "unidade",
  fornecedor: "empresa_id",
  preco: "preco",
  formato_tamanho: "formato_tamanho",
  tamanho_vinculado: "tamanho_vinculado",
  observacoes: "observacoes",
};

/** Coluna (escopo variante = a COR) -> campo do `BlocoDraft`. */
export const CAMPO_COR: Readonly<Record<string, keyof BlocoDraft>> = {
  cor: "cor_id",
  tamanhos: "tamanhos",
  preco_variante: "preco",
};

/** Mesmas listas da tela de Insumos de hoje (`cadastro.etiquetas.tsx`). */
export const UNIDADES: readonly string[] = ["unidade", "metro", "rolo", "milheiro"];
export const FORMATOS: readonly { value: string; label: string }[] = [
  { value: "ambos", label: "Ambos (PPP · 34)" },
  { value: "numero", label: "Número (34)" },
  { value: "letra", label: "Letra (PPP)" },
  { value: "nenhum", label: "Nenhum (sem tamanho)" },
];

/** Radix Select não aceita value="" num item: sentinela para "sem valor". */
export const OPCAO_VAZIA = "__vazio__";

/** Selects que deixam limpar o valor (tipo e fornecedor são opcionais; a cor vazia = variante "sem cor"). */
export function permiteVazio(key: string): boolean {
  return ["tipo_insumo", "fornecedor", "cor"].includes(key);
}

/** Valor que o select limpo grava: o tipo vai a `null` (FK); a cor vazia é "" (convenção do bloco, o Salvar grava `cor_id || null`). */
export function valorVazioDoSelect(key: string): string | null {
  return key === "cor" ? "" : null;
}

/** Casas decimais do MoneyInput (preço e preço da cor usam 2). */
export function casasDaColuna(_key: string): number {
  return 2;
}

/** Observações pode ter várias linhas (textarea que preserva as quebras; Enter aqui quebra a linha, não desce). */
export function ehTextoLongo(key: string): boolean {
  return key === "observacoes";
}

/** Opções das colunas `select` (o mesmo formato das opções que `useInsumosGrade` devolve). */
export type OpcoesGradeSelect = {
  tipos: OpcaoSelect[];
  cores: OpcaoSelect[];
  empresas: { id: string; nome_fantasia: string }[];
};

/** Opções da coluna `select` (unidade e formato são listas fixas; o fornecedor usa o `FornecedorSelect`). */
export function opcoesDaColuna(key: string, o: OpcoesGradeSelect): OpcaoSelect[] {
  switch (key) {
    case "tipo_insumo":
      return o.tipos;
    case "unidade":
      return UNIDADES.map((u) => ({ id: u, nome: u }));
    case "fornecedor":
      return o.empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }));
    case "formato_tamanho":
      return FORMATOS.map((f) => ({ id: f.value, nome: f.label }));
    case "cor":
      return o.cores;
    default:
      return [];
  }
}

/** Fornecedor da célula: os de insumo/etiqueta (TOKEN) + o já salvo no insumo, mesmo que a categoria dele tenha mudado depois. */
export function empresasParaLinha<E extends { id: string; ehInsumo?: boolean }>(
  empresas: E[],
  empresaAtualId: string | null,
): E[] {
  return empresas.filter((e) => e.ehInsumo !== false || e.id === empresaAtualId);
}

// ============================== Célula TAMANHOS (multi-check) ==============================

/** O insumo com formato "nenhum" NÃO tem tamanho: a célula de tamanhos fica desabilitada (e o Salvar grava tamanho=null). */
export function tamanhosHabilitados(formato: string | null | undefined): boolean {
  return formato !== "nenhum";
}

/**
 * Tamanhos oferecidos na célula: os da grade da loja + os já marcados que NÃO estão mais na grade (ficam visíveis p/ poder
 * desmarcar — a variante gravada antes de a grade mudar não some calada).
 */
export function opcoesDeTamanho(
  tamanhosGrade: readonly string[],
  marcados: readonly string[],
): string[] {
  const extras = marcados.filter((t) => !tamanhosGrade.includes(t));
  return [...tamanhosGrade, ...extras];
}

/** Marca/desmarca um tamanho e devolve a lista na ORDEM das opções (a ordem do clique não importa). */
export function alternarTamanho(
  marcados: readonly string[],
  tamanho: string,
  tamanhosGrade: readonly string[],
): string[] {
  const set = new Set(marcados);
  if (set.has(tamanho)) set.delete(tamanho);
  else set.add(tamanho);
  return opcoesDeTamanho(tamanhosGrade, marcados.concat(tamanho)).filter((t) => set.has(t));
}

/** Rótulo curto da célula: "M · 40, G · 42" (ou "" sem tamanho). */
export function resumoTamanhos(marcados: readonly string[], rotulo: (t: string) => string): string {
  return marcados.map(rotulo).join(", ");
}

/** Tamanhos como CONJUNTO (a ordem de marcação não suja o rascunho). */
function mesmosTamanhos(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((t) => s.has(t));
}

/** Dois blocos de cor iguais (cor, preço, CONJUNTO de tamanhos e "removida"). */
export function blocoIgual(a: BlocoDraft | undefined, b: BlocoDraft | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.cor_id === b.cor_id &&
    !!a.removido === !!b.removido &&
    Object.is(a.preco ?? null, b.preco ?? null) &&
    mesmosTamanhos(a.tamanhos, b.tamanhos)
  );
}

/** Duas listas de blocos iguais (mesma ordem, bloco a bloco). */
export function blocosIguais(a: readonly BlocoDraft[], b: readonly BlocoDraft[]): boolean {
  return a.length === b.length && a.every((x, i) => blocoIgual(x, b[i]));
}
