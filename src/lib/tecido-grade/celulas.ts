// Mapeamento PURO das células da grade de Tecidos (sem React, sem Supabase): que controle cada coluna usa, de que campo do
// rascunho ela lê, que opções oferece e quando fica travada. A célula (`CelulaTecido`) só desenha o que este arquivo decide.
import type { ColunaGrade } from "./colunas";
import type { ArtigoDraft } from "./salvar";
import { brl } from "@/lib/format";

export type OpcaoSelect = { id: string; nome: string };

export type ControleCelula = "input" | "money" | "select" | "categorias" | "foto" | "somente-leitura";

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
    case "categorias":
      return "categorias";
    case "foto":
      return "foto";
    default:
      return "somente-leitura";
  }
}

/** Coluna (escopo artigo) -> campo do `ArtigoDraft`. `preco_por_metro` não entra (só leitura, derivada). */
export const CAMPO_ARTIGO: Readonly<Record<string, keyof ArtigoDraft>> = {
  nome: "nome",
  fornecedor: "empresa_id",
  preco: "preco",
  unidade: "unidade_medida",
  largura_estimada: "largura_estimada",
  composicao: "composicao",
  ncm: "ncm",
  rendimento: "rendimento",
  mes: "mes_id",
  ano: "ano_id",
  categorias: "catIds",
};

/** Coluna (escopo variante) -> campo do `VarianteDraft` (`varianteParaDraft`, do Sheet). */
export const CAMPO_VARIANTE: Readonly<Record<string, "cor_id" | "cor_apelido_id" | "nome_variante" | "codigo_variante" | "preco">> = {
  cor_base: "cor_id",
  cor_apelido: "cor_apelido_id",
  nome_variante: "nome_variante",
  codigo_variante: "codigo_variante",
  preco_variante: "preco",
};

/** Casas decimais do MoneyInput por coluna (todas as de dinheiro/medida usam 2). */
export function casasDaColuna(_key: string): number {
  return 2;
}

/** Radix Select não aceita value="" num item: sentinela para "sem valor" (fornecedor, mês, ano). */
export const OPCAO_VAZIA = "__vazio__";

/** Select que deixa limpar o valor (fornecedor, mês, ano são opcionais; unidade, cor base e apelido não). */
export function permiteVazio(key: string): boolean {
  return key === "fornecedor" || key === "mes" || key === "ano";
}

export const OPCOES_UNIDADE: OpcaoSelect[] = [
  { id: "metro", nome: "Metro" },
  { id: "kg", nome: "Kg" },
];

/** Opções de cada coluna `select` (o mesmo formato das opções que `useTecidosGrade` devolve). */
export type OpcoesGradeSelect = {
  empresas: { id: string; nome_fantasia: string }[];
  cores: OpcaoSelect[];
  coresApelido: { id: string; nome: string; cor_base_id: string | null }[];
  meses: { id: string; mes: string }[];
  anos: { id: string; ano: string }[];
};

/** Opções da coluna; o apelido só lista os da cor base escolhida (sem cor base, todos — como no Sheet). */
export function opcoesDaColuna(key: string, o: OpcoesGradeSelect, corIdDaLinha = ""): OpcaoSelect[] {
  switch (key) {
    case "fornecedor":
      return o.empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }));
    case "unidade":
      return OPCOES_UNIDADE;
    case "mes":
      return o.meses.map((m) => ({ id: m.id, nome: m.mes }));
    case "ano":
      return o.anos.map((a) => ({ id: a.id, nome: String(a.ano) }));
    case "cor_base":
      return o.cores;
    case "cor_apelido":
      return (corIdDaLinha ? o.coresApelido.filter((a) => a.cor_base_id === corIdDaLinha) : o.coresApelido).map((a) => ({
        id: a.id,
        nome: a.nome,
      }));
    default:
      return [];
  }
}

/** Rendimento só vale em Kg (mesma regra do Sheet e do `montarPayloadArtigo`): em Metro a célula fica travada. */
export function celulaDesabilitadaPorRegra(key: string, valor: Pick<ArtigoDraft, "unidade_medida">): boolean {
  return key === "rendimento" && valor.unidade_medida !== "kg";
}

/** Preço por metro (só leitura): em Kg = preço ÷ rendimento (mesma conta exibida no Sheet); fora disso "—". */
export function precoPorMetroTexto(v: Pick<ArtigoDraft, "unidade_medida" | "preco" | "rendimento">): string {
  if (v.unidade_medida !== "kg" || !v.preco || !v.rendimento) return "—";
  return brl(Number(v.preco) / Number(v.rendimento));
}

/** Duas listas iguais (mesma ordem)? Usado para o rascunho não ficar "sujo" ao desfazer uma marcação de categoria. */
export function mesmaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Dois mapas {cat: sub} iguais? */
export function mesmoMapa(a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
