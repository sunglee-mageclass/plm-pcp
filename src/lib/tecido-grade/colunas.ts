// Catálogo PURO das colunas da grade "Lista tipo Excel" de Cadastro > Tecidos (sem React, sem Supabase).
// Metadados de EDIÇÃO (tipo de célula, escopo, editável) — não é o catálogo do export
// (`src/lib/exportar/campos-por-tipo.ts`), só reaproveita os rótulos PT-BR.

export type TipoCelula = "texto" | "select" | "money" | "categorias" | "foto" | "readonly";
export type EscopoCelula = "artigo" | "variante";

export type ColunaGrade = {
  key: string;
  rotulo: string;
  /** "artigo" = valor do cabeçalho (repetido por cor); "variante" = valor da linha da cor. */
  escopo: EscopoCelula;
  tipo: TipoCelula;
  editavel: boolean;
};

const col = (
  key: string,
  rotulo: string,
  escopo: EscopoCelula,
  tipo: TipoCelula,
  editavel = true,
): ColunaGrade => ({ key, rotulo, escopo, tipo, editavel });

export const COLUNAS_TECIDO: readonly ColunaGrade[] = [
  // Artigo (cabeçalho)
  col("nome", "Nome", "artigo", "texto"),
  col("fornecedor", "Fornecedor", "artigo", "select"),
  col("preco", "Preço", "artigo", "money"),
  col("unidade", "Unidade", "artigo", "select"),
  col("largura_estimada", "Largura estimada", "artigo", "money"),
  col("composicao", "Composição", "artigo", "texto"),
  col("ncm", "NCM", "artigo", "texto"),
  col("rendimento", "Rendimento", "artigo", "money"),
  col("mes", "Mês", "artigo", "select"),
  col("ano", "Ano", "artigo", "select"),
  col("categorias", "Categoria(s)", "artigo", "categorias"),
  // Variante (1 linha por cor)
  col("cor_base", "Cor base", "variante", "select"),
  col("cor_apelido", "Cor apelido", "variante", "select"),
  col("nome_variante", "Nome da variante", "variante", "texto"),
  col("codigo_variante", "Código da variante", "variante", "texto"),
  col("preco_variante", "Preço da variante", "variante", "money"),
  col("foto", "Foto", "variante", "foto"),
  // Só leitura (derivada no banco)
  col("preco_por_metro", "Preço por metro", "artigo", "readonly", false),
];

const POR_KEY: ReadonlyMap<string, ColunaGrade> = new Map(COLUNAS_TECIDO.map((c) => [c.key, c]));

/** Posição da coluna na grade (0 = Nome): é a "coluna" do endereço de teclado (`data-grade-cel="<linha>:<coluna>"`). -1 se não existe. */
export function indiceDaColuna(key: string): number {
  return COLUNAS_TECIDO.findIndex((c) => c.key === key);
}

/** Colunas que a pessoa pode editar na célula (exclui as só-leitura), na ordem do catálogo. */
export function colunasEditaveis(): ColunaGrade[] {
  return COLUNAS_TECIDO.filter((c) => c.editavel);
}

/** Coluna pela chave; `undefined` se não existir. */
export function byKey(key: string): ColunaGrade | undefined {
  return POR_KEY.get(key);
}
