// F3.2 — decisão F3 #6 (aprovada 22/set): o markup e a tabela da seção "Preço e Custos" usam o MESMO
// custo-base, com selo de 3 estados. Ordem: real (CAD enviado ao corte = `custo_unitario_modelos.
// confirmado`) › previsto do BOM › estimativa (tecido × preço/m + materiais + M.O.). Puro; testado.
import type { TotaisBom } from "./ficha/ficha-calc";
import { somaCustosAdicionais } from "@/lib/custo";

export type SeloCusto = "estimado" | "previsto" | "real";

/** Previsto AO VIVO da ficha: só vale quando o BOM tem material (M.O. sozinha não é "previsto do BOM"). */
export function previstoDaFicha(t: TotaisBom): number {
  return t.materiaisBom > 0 ? t.peca : 0;
}

export function baseCustoPlanejamento(i: { confirmado: boolean; realServidor: unknown; previsto: unknown; estimativa: unknown }): { valor: number; selo: SeloCusto } {
  if (i.confirmado) return { valor: Number(i.realServidor) || 0, selo: "real" };
  const prev = Number(i.previsto) || 0;
  if (prev > 0) return { valor: prev, selo: "previsto" };
  const est = Number(i.estimativa) || 0;
  return { valor: est > 0 ? est : 0, selo: "estimado" };
}

/**
 * Fix pós-rebase (item 7 — paridade com o Dev): a ESTIMATIVA do custo-base soma os custos adicionais (descrição + valor
 * por peça, lançados a qualquer momento — no Dev entram no custo SEMPRE, ModeloDetailPanel.tsx:1398). `simTotal` =
 * `custoSimulado(...).total` (tecido + aviamento + M.O.) — `preco.ts` fica INTOCADO (invariante #8): a soma mora aqui,
 * onde o custo-base é montado. Assim a tabela fecha no estimado (as linhas "Custos adicionais" aparecem e entram no total).
 */
export function estimativaComCustosAdicionais(simTotal: number, custosAdicionais: unknown): number {
  return (Number(simTotal) || 0) + somaCustosAdicionais(custosAdicionais);
}

/**
 * Preço M6 (R9) — base do markup do IMPORTADO = (real ‖ previsto) + M.O. ao vivo, igual à revenda e ao banco
 * (`_imp_recomputar` soma a M.O.). `custoData.previsto/real` do comprado NÃO trazem a M.O. (separação materiais×MO).
 * Só soma quando há custo (>0): sem custo a base fica 0 (a tabela mostra "—"), nunca "só a M.O.".
 */
export function baseMarkupComMO(custo: unknown, maoObra: unknown): number {
  const c = Number(custo) || 0;
  return c > 0 ? c + (Number(maoObra) || 0) : 0;
}

/**
 * M.O. embutida no custo-base. Selo "real" usa a M.O. real do setor (Serviços ÷ grade) — EXCETO no importado: ele não
 * tem CAD/serviços (`mao_obra_real` = 0) e a base já soma a M.O. planejada (`baseMarkupComMO`); usar o setor (0) contaria a
 * M.O. duas vezes (Materiais = base inteira + M.O.). Importado usa sempre a M.O. ao vivo.
 */
export function moEmbutidaDoCusto(i: { selo: SeloCusto; importado: boolean; maoObraSetor: number; maoObraDevLive: number }): number {
  return i.selo === "real" && !i.importado ? i.maoObraSetor : i.maoObraDevLive;
}
