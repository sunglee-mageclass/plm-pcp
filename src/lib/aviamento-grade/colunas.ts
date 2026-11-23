// Catálogo PURO das colunas da grade "Lista tipo Excel" de Cadastro > Aviamentos (sem React, sem Supabase).
// Metadados de EDIÇÃO (tipo de célula, escopo, editável) — espelha `src/lib/tecido-grade/colunas.ts`, com as diferenças do aviamento:
//  • o nome é `codigo_nome` (chave "codigo_nome", rótulo "Nome"); `codigo` é separado (gerado por gatilho, mas editável);
//  • categoria/subcategoria/material são FK ÚNICA no próprio aviamento → 3 selects simples (SEM tipo "categorias" N:N);
//    a subcategoria cascateia pela categoria; o material é independente;
//  • sem `rev` e sem coluna só-leitura derivada (o aviamento não tem "preço por metro").
// Rótulos PT-BR seguem `src/lib/import/entities/aviamento.descriptor.ts` (gridColunas).

export type TipoCelula = "texto" | "select" | "money" | "foto" | "readonly";
export type EscopoCelula = "aviamento" | "variante";

export type ColunaGrade = {
  key: string;
  rotulo: string;
  /** "aviamento" = valor do cabeçalho (só a linha-pai do aviamento mostra e edita); "variante" = valor da linha da cor. */
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

export const COLUNAS_AVIAMENTO: readonly ColunaGrade[] = [
  // Aviamento (cabeçalho)
  col("codigo", "Código", "aviamento", "texto"),
  col("codigo_nome", "Nome", "aviamento", "texto"),
  col("fornecedor", "Fornecedor", "aviamento", "select"),
  col("preco", "Preço", "aviamento", "money"),
  col("ncm", "NCM", "aviamento", "texto"),
  col("categoria", "Categoria", "aviamento", "select"),
  col("subcategoria", "Subcategoria", "aviamento", "select"),
  col("material", "Material", "aviamento", "select"),
  col("composicao", "Composição", "aviamento", "texto"),
  col("intervalo_largura", "Intervalo de largura", "aviamento", "select"),
  col("largura_exata", "Largura exata", "aviamento", "money"),
  col("observacoes", "Observações", "aviamento", "texto"),
  // Variante (1 linha por cor)
  col("cor_base", "Cor base", "variante", "select"),
  col("cor_apelido", "Cor apelido", "variante", "select"),
  col("nome_variante", "Nome da variante", "variante", "texto"),
  col("codigo_variante", "Código da variante", "variante", "texto"),
  col("preco_variante", "Preço da variante", "variante", "money"),
  col("foto", "Foto", "variante", "foto"),
];

const POR_KEY: ReadonlyMap<string, ColunaGrade> = new Map(COLUNAS_AVIAMENTO.map((c) => [c.key, c]));

/** Posição da coluna na grade (0 = Código): é a "coluna" do endereço de teclado (`data-grade-cel="<linha>:<coluna>"`). -1 se não existe. */
export function indiceDaColuna(key: string): number {
  return COLUNAS_AVIAMENTO.findIndex((c) => c.key === key);
}

/** Colunas que a pessoa pode editar na célula (exclui as só-leitura), na ordem do catálogo. */
export function colunasEditaveis(): ColunaGrade[] {
  return COLUNAS_AVIAMENTO.filter((c) => c.editavel);
}

/** Coluna pela chave; `undefined` se não existir. */
export function byKey(key: string): ColunaGrade | undefined {
  return POR_KEY.get(key);
}
