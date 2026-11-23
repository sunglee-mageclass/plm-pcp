// Catálogo PURO das colunas da grade "Lista tipo Excel" de Cadastro > Insumos (sem React, sem Supabase).
// Metadados de EDIÇÃO (tipo de célula, escopo, editável) — espelha `src/lib/aviamento-grade/colunas.ts`, com as diferenças do insumo:
//  • o nome é `nome`; o tipo é UM select (`tipo_insumo_id`, FK `tipos_insumo`) — o insumo NÃO tem categoria/subcategoria/apelido/foto;
//  • a linha-filha é a COR (1 linha por cor, 1 preço por cor) e os TAMANHOS moram numa célula de multi-check (tipo "tamanhos");
//  • `tamanho_vinculado` é um select do CABEÇALHO que só vale em insumo sem tamanho próprio (tipo "tamanho-vinculado": a regra de
//    dependência vem de `src/lib/insumo-tamanho.ts` — `vinculoDisponivel`/`tamanhoVinculadoParaSalvar`);
//  • sem `rev` e sem coluna só-leitura derivada.
// Os 2 tipos de célula NOVOS ("tamanhos" e "tamanho-vinculado") são só DECLARADOS aqui; a renderização é da grade editável (IN-2).
// Rótulos PT-BR seguem `src/lib/import/entities/insumo.descriptor.ts` (gridColunas) e a tela de Insumos de hoje.

export type TipoCelula = "texto" | "select" | "money" | "tamanhos" | "tamanho-vinculado";
export type EscopoCelula = "insumo" | "variante";

export type ColunaGrade = {
  key: string;
  rotulo: string;
  /** "insumo" = valor do cabeçalho (só a linha-pai do insumo mostra e edita); "variante" = valor da linha da COR. */
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

export const COLUNAS_INSUMO: readonly ColunaGrade[] = [
  // Insumo (cabeçalho)
  col("nome", "Nome", "insumo", "texto"),
  col("tipo_insumo", "Tipo", "insumo", "select"),
  col("unidade", "Unidade", "insumo", "select"),
  col("fornecedor", "Fornecedor", "insumo", "select"),
  col("preco", "Preço", "insumo", "money"),
  col("formato_tamanho", "Formato do tamanho", "insumo", "select"),
  col("tamanho_vinculado", "Tamanho vinculado", "insumo", "tamanho-vinculado"),
  col("observacoes", "Observações", "insumo", "texto"),
  // Variante (1 linha por COR)
  col("cor", "Cor", "variante", "select"),
  col("tamanhos", "Tamanhos", "variante", "tamanhos"),
  col("preco_variante", "Preço da cor", "variante", "money"),
];

const POR_KEY: ReadonlyMap<string, ColunaGrade> = new Map(COLUNAS_INSUMO.map((c) => [c.key, c]));

/** Posição da coluna na grade (0 = Nome): é a "coluna" do endereço de teclado (`data-grade-cel="<linha>:<coluna>"`). -1 se não existe. */
export function indiceDaColuna(key: string): number {
  return COLUNAS_INSUMO.findIndex((c) => c.key === key);
}

/** Colunas que a pessoa pode editar na célula (exclui as só-leitura), na ordem do catálogo. */
export function colunasEditaveis(): ColunaGrade[] {
  return COLUNAS_INSUMO.filter((c) => c.editavel);
}

/** Coluna pela chave; `undefined` se não existir. */
export function byKey(key: string): ColunaGrade | undefined {
  return POR_KEY.get(key);
}
