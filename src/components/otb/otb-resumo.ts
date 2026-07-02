import { precoInfo } from "@/lib/preco";

export type ModelForResumo = {
  id: string;
  linha_id: string | null;
  preco_venda: number | null;
};
export type Custo = { previsto: number; real: number; confirmado: boolean };

export type ColecaoResumo = {
  previsto: number; // Σ custo previsto por peça × grade
  real: number;     // Σ custo real por peça × grade
  poder: number;    // Σ preço efetivo × grade
  qtdModelos: number;
  qtdPecas: number;
};

/** Agrega previsto/real/poder de venda de uma lista de modelos (mesma lógica do
 *  Planejamento). custoMap: id→{previsto,real}; gradeMap: id→grade total. */
export function computeColecaoResumo(
  models: ModelForResumo[],
  custoMap: Record<string, Custo>,
  gradeMap: Record<string, number>,
  linhaMarkupMap: Record<string, number | null>,
): ColecaoResumo {
  let previsto = 0, real = 0, poder = 0, qtdPecas = 0;
  for (const m of models) {
    const grade = Number(gradeMap[m.id]) || 0;
    const custo = custoMap[m.id];
    const pi = precoInfo(custo?.real, m.linha_id ? linhaMarkupMap[m.linha_id] : 0, m.preco_venda);
    previsto += (Number(custo?.previsto) || 0) * grade;
    real += (Number(custo?.real) || 0) * grade;
    poder += pi.efetivo * grade;
    qtdPecas += grade;
  }
  return { previsto, real, poder, qtdModelos: models.length, qtdPecas };
}
