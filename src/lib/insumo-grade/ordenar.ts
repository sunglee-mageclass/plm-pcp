// Ordenação por coluna da grade de Insumos (PURA, sem React/Supabase). Espelha `src/lib/aviamento-grade/ordenar.ts`.
// Cada insumo é um bloco (linha-pai + cores), então ordenar linha a linha ESPALHARIA as cores de um mesmo insumo. Por isso a
// ordenação é por GRUPO (insumo): as cores de um insumo ficam SEMPRE juntas.
//  - coluna do INSUMO: os grupos ordenam pelo valor do insumo; a ordem das cores dentro do grupo não muda.
//  - coluna da COR: as cores ordenam DENTRO de cada grupo, e os grupos ordenam pelo valor da sua 1ª cor já ordenada
//    (a menor em ascendente, a maior em descendente; insumo sem valor nenhum vai para o fim).
// Sempre pelo valor SALVO (servidor), nunca pelo rascunho: a linha não pode pular enquanto a pessoa digita.
// O empate mantém a ordem de entrada (ordem estável) e vazio fica sempre por último — a mesma regra do `useSort`.
import { compararValores, type SortDir } from "@/lib/comparar-valores";
import type { ColunaGrade } from "./colunas";
import { valorColuna, type LinhaGrade, type ResolverRotulo } from "./linhas";

/** Toda coluna do insumo tem ordem útil (não há foto): `tamanhos` ordena pelas chaves marcadas juntas. */
export function colunaOrdenavel(_col: Pick<ColunaGrade, "key">): boolean {
  return true;
}

/** Linhas consecutivas do mesmo insumo formam um grupo (`montarLinhas` entrega o insumo inteiro em sequência). */
function agrupar(linhas: LinhaGrade[]): LinhaGrade[][] {
  const grupos: LinhaGrade[][] = [];
  let atual: string | null = null;
  for (const l of linhas) {
    if (l.insumoId !== atual) {
      grupos.push([]);
      atual = l.insumoId;
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
  // valor do grupo = o da 1ª linha (insumo: igual em todas; cor: a 1ª após ordenar, vazios por último)
  const ordenados = [...grupos].sort((a, b) => compararValores(valor(a[0]), valor(b[0]), dir));
  return ordenados.flat();
}
