// Ordenação por coluna da grade de Tecidos (PURA, sem React/Supabase).
// Cada tecido é um bloco (linha-pai + cores), então ordenar linha a linha ESPALHARIA as cores de um mesmo tecido. Por isso a
// ordenação é por GRUPO (tecido): as cores de um tecido ficam SEMPRE juntas.
//  - coluna do TECIDO: os grupos ordenam pelo valor do tecido; a ordem das cores dentro do grupo não muda.
//  - coluna da COR: as cores ordenam DENTRO de cada grupo, e os grupos ordenam pelo valor da sua 1ª cor já ordenada
//    (a menor em ascendente, a maior em descendente; tecido sem valor nenhum vai para o fim).
// Sempre pelo valor SALVO (servidor), nunca pelo rascunho: a linha não pode pular enquanto a pessoa digita.
// O empate mantém a ordem de entrada (ordem estável) e vazio fica sempre por último — a mesma regra do `useSort`.
import { compararValores, type SortDir } from "@/lib/comparar-valores";
import type { ColunaGrade } from "./colunas";
import { valorColuna, type LinhaGrade, type ResolverRotulo } from "./linhas";

/** Coluna sem sentido para ordenar (a foto é um caminho de arquivo, sem ordem útil). */
export function colunaOrdenavel(col: Pick<ColunaGrade, "key">): boolean {
  return col.key !== "foto";
}

/** Linhas consecutivas do mesmo tecido formam um grupo (montarLinhas entrega o tecido inteiro em sequência). */
function agrupar(linhas: LinhaGrade[]): LinhaGrade[][] {
  const grupos: LinhaGrade[][] = [];
  let atual: string | null = null;
  for (const l of linhas) {
    if (l.artigoId !== atual) {
      grupos.push([]);
      atual = l.artigoId;
    }
    grupos[grupos.length - 1].push(l);
  }
  return grupos;
}

/** Devolve as linhas na nova ordem (lista nova; a de entrada não muda). */
export function ordenarLinhasPorColuna(
  linhas: LinhaGrade[],
  col: ColunaGrade,
  dir: SortDir,
  resolver?: ResolverRotulo,
): LinhaGrade[] {
  const valor = (l: LinhaGrade) => valorColuna(l, col, resolver);
  let grupos = agrupar(linhas);
  if (col.escopo === "variante") {
    grupos = grupos.map((g) => [...g].sort((a, b) => compararValores(valor(a), valor(b), dir)));
  }
  // valor do grupo = o da 1ª linha (tecido: igual em todas; cor: a 1ª após ordenar, vazios por último)
  const ordenados = [...grupos].sort((a, b) => compararValores(valor(a[0]), valor(b[0]), dir));
  return ordenados.flat();
}
