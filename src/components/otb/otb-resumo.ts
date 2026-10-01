import { precoInfo } from "@/lib/preco";

export type ModelForResumo = {
  id: string;
  linha_id: string | null;
  preco_venda: number | null;
  markup_editado?: number | null;
  /** [leves L4, P-209 A] card em 'reprovado' fica fora do resumo (mesma regra do Realizado do OTB no banco) */
  status_desenvolvimento?: string | null;
};

/** P-209 A: card reprovado não conta no Realizado do OTB; saindo de Reprovado volta a contar. Mesmo predicado do
 *  banco (`lower(coalesce(status_desenvolvimento,'')) <> 'reprovado'` em `_otb_colecao_totais`/`_otb_orcamento_core`). */
export function contaNoOtb(m: { status_desenvolvimento?: string | null }): boolean {
  return (m.status_desenvolvimento ?? "").toLowerCase() !== "reprovado";
}
export type Custo = { previsto: number; real: number; confirmado: boolean };

export type ColecaoResumo = {
  previsto: number; // Σ custo previsto por peça × grade
  real: number;     // Σ custo real por peça × grade
  poder: number;    // Σ preço efetivo × grade
  qtdModelos: number;
  qtdPecas: number;
};

/** Agrega previsto/real/poder de venda de uma lista de modelos (mesma lógica do
 *  Planejamento). custoMap: id→{previsto,real}; gradeMap: id→grade total. Card reprovado fica de fora
 *  (P-209 A, `contaNoOtb`) — também em `qtdModelos`. */
export function computeColecaoResumo(
  models: ModelForResumo[],
  custoMap: Record<string, Custo>,
  gradeMap: Record<string, number>,
  linhaMarkupMap: Record<string, number | null>,
): ColecaoResumo {
  let previsto = 0, real = 0, poder = 0, qtdPecas = 0, qtdModelos = 0;
  for (const m of models) {
    if (!contaNoOtb(m)) continue;
    qtdModelos++;
    const grade = Number(gradeMap[m.id]) || 0;
    const custo = custoMap[m.id];
    const pi = precoInfo(custo?.real, m.linha_id ? linhaMarkupMap[m.linha_id] : 0, m.preco_venda, m.markup_editado);
    previsto += (Number(custo?.previsto) || 0) * grade;
    real += (Number(custo?.real) || 0) * grade;
    poder += pi.efetivo * grade;
    qtdPecas += grade;
  }
  return { previsto, real, poder, qtdModelos, qtdPecas };
}
