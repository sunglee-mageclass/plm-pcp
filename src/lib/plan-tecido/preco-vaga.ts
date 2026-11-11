import type { PtSlot } from "./types";
import { precoInfo, precoDoCard, type PrecoInfo } from "@/lib/preco";

/** Preço/custo/markup do CARD do modelo (null = não disponível). Vem do Sheet (`precoDoCard`). */
export type PrecoCardFn = (modeloId: string) => PrecoInfo | null;

/**
 * Termo de UMA vaga no poder de venda = preço efetivo × grade.
 * Vaga COM card (modelo_id + preço do card disponível): preço efetivo do CARD (P-167 A).
 * Vaga SEM card: a estimativa da vaga (custo estimado + markup da linha da vaga + preco_venda da vaga).
 */
export function termoPoderDeVenda(
  slot: PtSlot,
  grade: number,
  precoCard: PrecoInfo | null | undefined,
  estimativa: { custo: number; markup: number },
): number {
  if (slot.modelo_id && precoCard && precoCard.efetivo > 0) return precoCard.efetivo * grade;
  return precoInfo(estimativa.custo, estimativa.markup, slot.preco_venda ?? null, slot.markup_editado ?? null).efetivo * grade;
}

/**
 * Preço do CARD para o poder de venda (builder puro de `precoCardDe`).
 * `custoMap` undefined = `custo_unitario_modelos` ainda NÃO carregou => null (estimativa de hoje).
 * Carregou mas mascarado (`{}`/modelo ausente/custo 0 = sem permissão de custos): card COM preço digitado
 * usa o digitado; card SEM preço digitado tem efetivo 0 e `termoPoderDeVenda` cai na estimativa (nunca conta 0).
 */
export function precoCardDoPlano(
  modeloId: string,
  modelos: { id: string; linha_id?: string | null; preco_venda?: unknown; markup_editado?: unknown }[] | null | undefined,
  custoMap: Record<string, { real?: unknown } | undefined> | undefined,
  linhaMarkupMap: Record<string, unknown> | null | undefined,
): PrecoInfo | null {
  if (!custoMap) return null;
  const m = (modelos ?? []).find((x) => x.id === modeloId);
  if (!m) return null;
  return precoDoCard(m, custoMap, linhaMarkupMap);
}

/** Quebra de custo do CARD (derivada no servidor em `modelos.custo_*_total`). null = mascarado/indisponível. */
export type CustoCardDetalhe = { tecido: number; forro: number; entretela: number; aviamento: number };

/**
 * Detalhe do custo do card p/ a vaga COM card. Sem permissão de custos / custo ainda carregando
 * (`temCusto` false) ou modelo ausente => null (a UI mostra "—"). Nunca usa a estimativa da vaga.
 */
export function custoDetalheDoCard(
  modelo: { custo_tecido_total?: unknown; custo_forro_total?: unknown; custo_entretela_total?: unknown; custo_aviamento_total?: unknown } | null | undefined,
  temCusto: boolean,
): CustoCardDetalhe | null {
  if (!modelo || !temCusto) return null;
  const n = (v: unknown) => Number(v) || 0;
  return { tecido: n(modelo.custo_tecido_total), forro: n(modelo.custo_forro_total), entretela: n(modelo.custo_entretela_total), aviamento: n(modelo.custo_aviamento_total) };
}

/** Texto do poder de venda no Resumo: "calculando…" enquanto o custo dos cards carrega (há vaga com card). */
export function poderVendaCalculando(pendente: boolean, temSlotComCard: boolean): boolean {
  return pendente && temSlotComCard;
}

/** F4b (nov/2026) — resumo de vendas da subcoleção do Plan. Tecido para o cabeçalho (poder de venda +
 *  markup médio + nº de vagas). FONTE ÚNICA com o rail (`ResumoPanel`): a MESMA base do "Poder de venda
 *  (previsto)" — só vagas com tecido+fornecedor, reprovados já fora (o chamador passa `venda`), preço do
 *  CARD quando há card (P-167 A), estimativa da vaga senão. O markup médio é a média aritmética do markup
 *  real das vagas com custo e preço, espelhando o `computeResumo` do Planejamento. O PT tem preço de venda
 *  ÚNICO (não há atacado), por isso um markup/poder só — ao contrário de PA/PI. */
export function resumoVendaSubcolecao(
  venda: PtSlot[],
  fns: {
    /** só vagas com tecido que tem fornecedor entram (gate do rail). */
    comFornec: (slot: PtSlot) => boolean;
    /** grade total da vaga (Σ grade das variantes do Tecido 1). */
    gradeDe: (slot: PtSlot) => number;
    /** custo estimado da vaga (materiais previstos + simulado + M.O.). */
    custoDe: (slot: PtSlot) => number;
    /** markup da linha da vaga (0 se sem linha). */
    markupDe: (slot: PtSlot) => number;
    /** preço/custo/markup do card do modelo (null = sem card/indisponível). */
    precoCardDe?: PrecoCardFn;
  },
): { poder: number; markupMedio: number; qtd: number } {
  let poder = 0;
  let somaMk = 0;
  let nMk = 0;
  let qtd = 0;
  for (const slot of venda) {
    if (!fns.comFornec(slot)) continue;
    qtd++;
    const grade = fns.gradeDe(slot);
    const custo = fns.custoDe(slot);
    const markup = fns.markupDe(slot);
    const precoCard = slot.modelo_id ? fns.precoCardDe?.(slot.modelo_id) : null;
    poder += termoPoderDeVenda(slot, grade, precoCard, { custo, markup });
    // markup real da vaga = efetivo ÷ custo — a MESMA fonte do preço usado no poder de venda:
    // card com preço (P-167 A) usa o markup real do card; senão a estimativa da vaga.
    const info = slot.modelo_id && precoCard && precoCard.efetivo > 0
      ? precoCard
      : precoInfo(custo, markup, slot.preco_venda ?? null, slot.markup_editado ?? null);
    if (info.markupReal > 0) { somaMk += info.markupReal; nMk++; }
  }
  return { poder, markupMedio: nMk > 0 ? somaMk / nMk : 0, qtd };
}
