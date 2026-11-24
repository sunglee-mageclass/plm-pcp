// Ordenação por coluna da grade "Lista" do Planejamento de Produto (PURA). 1 linha por modelo: ordena linha a linha, sempre pelo valor
// SALVO (o do servidor), nunca pelo rascunho — a linha não pode pular enquanto a pessoa digita. Vazio por último; empate mantém a ordem
// de entrada (a ordem que a TELA entregou). Mesma regra do `useSort` (`compararValores`).
import { compararValores, type SortDir } from "@/lib/comparar-valores";
import type { ColunaProduto } from "./colunas";
import { valorColuna, type LinhaProduto, type ResolverRotulo } from "./linhas";

/** Toda coluna ordena (inclusive as só-leitura: ordenar por Status/Versão/Origem é útil). */
export function colunaOrdenavel(_col: Pick<ColunaProduto, "key">): boolean {
  return true;
}

/** Devolve as linhas na nova ordem (lista nova; a de entrada não muda). */
export function ordenarLinhasProduto(
  linhas: readonly LinhaProduto[],
  col: ColunaProduto,
  dir: SortDir,
  resolver?: ResolverRotulo,
): LinhaProduto[] {
  return [...linhas].sort((a, b) =>
    compararValores(valorColuna(a, col, resolver), valorColuna(b, col, resolver), dir),
  );
}
