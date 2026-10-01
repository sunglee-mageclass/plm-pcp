// Aba "Comercial & Coleção" do Dashboard — agregação por LINHA e por COLEÇÃO (achados LEVES L4, prod #14).
//
// Mesma matemática de antes (preço efetivo de `@/lib/preco`, fonte única; custo = real, senão previsto), com uma
// correção: card SEM CUSTO (custo 0 — ainda sem BOM, ou mascarado para quem não vê custos) fica FORA da margem, do
// lucro e do markup. Antes ele entrava com lucro = preço (margem de 100%) e inflava a margem da coleção. O poder de
// venda e o ticket continuam com todos os cards (não dependem do custo). `semCusto` conta os cards que ficaram de
// fora e que pesariam na conta (têm grade planejada ou real) — a tela mostra "N sem custo".
import { precoInfo } from "@/lib/preco";

export type ModeloComercial = {
  id: string;
  colecao?: string | null;
  linha_id?: string | null;
  preco_venda?: unknown;
  markup_editado?: unknown;
  linha?: {
    nome?: string | null;
    markup?: unknown;
    markup_min?: unknown;
    markup_max?: unknown;
  } | null;
};

export type CustoComercial = { previsto?: unknown; real?: unknown; confirmado?: unknown };

export type LinhaComercial = {
  key: string;
  nome: string;
  pvPlan: number;
  pvReal: number;
  /** poder de venda só dos cards COM custo — base da margem e do markup */
  pvPlanComCusto: number;
  pvRealComCusto: number;
  lucroPlan: number;
  lucroReal: number;
  gradePlan: number;
  gradeReal: number;
  semCusto: number;
  markupMin: number | null;
  markupIdeal: number | null;
};

export type TotalComercial = {
  pvPlan: number;
  pvReal: number;
  lucroPlan: number;
  lucroReal: number;
  gradePlan: number;
  gradeReal: number;
  margemPlan: number;
  margemReal: number;
  markupReal: number;
  ticket: number;
  semCusto: number;
};

const num = (v: unknown): number => Number(v) || 0;
const numOuNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** Markup real de uma linha/coleção: poder de venda ÷ custo, só dos cards com custo (0 = sem base). */
export function markupRealComercial(
  r: Pick<LinhaComercial, "pvRealComCusto" | "lucroReal">,
): number {
  const c = r.pvRealComCusto - r.lucroReal;
  return c > 0 ? r.pvRealComCusto / c : 0;
}

/** Margem real (%) de uma linha/coleção: lucro ÷ poder de venda, só dos cards com custo. */
export function margemRealComercial(
  r: Pick<LinhaComercial, "pvRealComCusto" | "lucroReal">,
): number {
  return r.pvRealComCusto > 0 ? (r.lucroReal / r.pvRealComCusto) * 100 : 0;
}

export function agregarComercial(
  modelos: ModeloComercial[],
  custoMap: Record<string, CustoComercial | undefined>,
  gradePlan: Record<string, unknown>,
  gradeReal: Record<string, unknown>,
): { porLinha: LinhaComercial[]; porColecao: LinhaComercial[]; tot: TotalComercial } {
  const ml = new Map<string, LinhaComercial>();
  const mc = new Map<string, LinhaComercial>();
  const t = {
    pvPlan: 0,
    pvReal: 0,
    pvPlanC: 0,
    pvRealC: 0,
    luPlan: 0,
    luReal: 0,
    gp: 0,
    gr: 0,
    semCusto: 0,
  };
  const acc = (
    map: Map<string, LinhaComercial>,
    key: string,
    nome: string,
    m: ModeloComercial,
    v: {
      pvP: number;
      pvR: number;
      pvPC: number;
      pvRC: number;
      luP: number;
      luR: number;
      gp: number;
      gr: number;
      sem: number;
    },
  ) => {
    let r = map.get(key);
    if (!r) {
      r = {
        key,
        nome,
        pvPlan: 0,
        pvReal: 0,
        pvPlanComCusto: 0,
        pvRealComCusto: 0,
        lucroPlan: 0,
        lucroReal: 0,
        gradePlan: 0,
        gradeReal: 0,
        semCusto: 0,
        markupMin: numOuNull(m.linha?.markup_min),
        markupIdeal: numOuNull(m.linha?.markup),
      };
      map.set(key, r);
    }
    r.pvPlan += v.pvP;
    r.pvReal += v.pvR;
    r.pvPlanComCusto += v.pvPC;
    r.pvRealComCusto += v.pvRC;
    r.lucroPlan += v.luP;
    r.lucroReal += v.luR;
    r.gradePlan += v.gp;
    r.gradeReal += v.gr;
    r.semCusto += v.sem;
  };
  for (const m of modelos) {
    const cu = custoMap?.[m.id];
    const custo = num(cu?.real) || num(cu?.previsto) || 0;
    const pi = precoInfo(custo, m.linha?.markup, m.preco_venda, m.markup_editado);
    const gp = num(gradePlan?.[m.id]);
    const gr = num(gradeReal?.[m.id]);
    const temCusto = custo > 0;
    const pvP = pi.efetivo * gp;
    const pvR = pi.efetivo * gr;
    const v = {
      pvP,
      pvR,
      pvPC: temCusto ? pvP : 0,
      pvRC: temCusto ? pvR : 0,
      luP: temCusto ? (pi.efetivo - custo) * gp : 0,
      luR: temCusto ? (pi.efetivo - custo) * gr : 0,
      gp,
      gr,
      sem: !temCusto && (gp > 0 || gr > 0) ? 1 : 0,
    };
    acc(ml, m.linha_id ?? "__none__", m.linha?.nome || "Sem linha", m, v);
    acc(mc, m.colecao ?? "__none__", m.colecao || "Sem coleção", m, v);
    t.pvPlan += v.pvP;
    t.pvReal += v.pvR;
    t.pvPlanC += v.pvPC;
    t.pvRealC += v.pvRC;
    t.luPlan += v.luP;
    t.luReal += v.luR;
    t.gp += gp;
    t.gr += gr;
    t.semCusto += v.sem;
  }
  const porLinha = Array.from(ml.values()).sort((a, b) => b.pvPlan - a.pvPlan);
  const porColecao = Array.from(mc.values()).sort((a, b) => b.pvPlan - a.pvPlan);
  const custoRealT = t.pvRealC - t.luReal;
  const custoPlanT = t.pvPlanC - t.luPlan;
  const tot: TotalComercial = {
    pvPlan: t.pvPlan,
    pvReal: t.pvReal,
    lucroPlan: t.luPlan,
    lucroReal: t.luReal,
    gradePlan: t.gp,
    gradeReal: t.gr,
    margemPlan: t.pvPlanC > 0 ? (t.luPlan / t.pvPlanC) * 100 : 0,
    margemReal: t.pvRealC > 0 ? (t.luReal / t.pvRealC) * 100 : 0,
    markupReal:
      custoRealT > 0 ? t.pvRealC / custoRealT : custoPlanT > 0 ? t.pvPlanC / custoPlanT : 0,
    // ticket = poder de venda ÷ peças (real quando há grade real; senão planejado) — todos os cards.
    ticket: t.gr > 0 ? t.pvReal / t.gr : t.gp > 0 ? t.pvPlan / t.gp : 0,
    semCusto: t.semCusto,
  };
  return { porLinha, porColecao, tot };
}

/** Grade planejada por modelo (Σ `modelo_grades.grade_total`). Erro da consulta LANÇA — não vira "0 peças" em
 *  silêncio (a tela mostra o aviso de erro). */
export async function gradePlanejadaPorModelo(
  consulta: PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Record<string, number>> {
  const { data, error } = await consulta;
  if (error) throw error;
  const m: Record<string, number> = {};
  for (const r of (data ?? []) as { modelo_id: string; grade_total: unknown }[]) {
    m[r.modelo_id] = (m[r.modelo_id] ?? 0) + num(r.grade_total);
  }
  return m;
}
