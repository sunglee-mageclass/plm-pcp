import { describe, it, expect } from "vitest";
import {
  variantesNovasDoRascunho, linhasCorNova, estoqueDoArtigo, necessidadePorVarianteDaArvore, linhaResumoAoVivo, planVivoDaLinha,
  type CoberturaVarRow,
} from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

const v = (id: string | null, extra: any = {}) => ({ variante_tecido_id: id, grade_total: 10, multiplicador: 1, ordem: 1, label: `cor-${id}`, ...extra });
const slot = (modelo_id: string | null, variantes: any[], artigo_id = "A1") => ({ modelo_id, materiais: [{ tipo: "tecido", numero: 1, artigo_id, consumo: 2, variantes }] });
const mk = (...slots: any[]): PtArvore => ({ subcolecoes: [{ linhas: [{ slots }] }] }) as any;

describe("variantesNovasDoRascunho", () => {
  it("variante do rascunho fora da cobertura vira nova; a que já está na cobertura não", () => {
    const r = variantesNovasDoRascunho(mk(slot("m1", [v("vSalva"), v("vNova")])), undefined, new Set(["vSalva"]));
    expect(r).toEqual([{ variante_tecido_id: "vNova", artigo_id: "A1", label: "cor-vNova" }]);
  });
  it("dedup: mesma cor nova em 2 slots/subcoleções aparece 1×", () => {
    const r = variantesNovasDoRascunho(mk(slot("m1", [v("vNova")]), slot("m2", [v("vNova")])), undefined, new Set());
    expect(r).toHaveLength(1);
  });
  it("cor nova com grade 0 (recém-adicionada) entra (casa com o card); oculta, sem id e reprovada não", () => {
    const r = variantesNovasDoRascunho(
      mk(slot("m1", [v("vZero", { grade_total: 0 }), v("vOculta", { oculta: true }), v(null)]), slot("mRep", [v("vRep")])),
      new Set(["mRep"]), new Set(),
    );
    expect(r.map((x) => x.variante_tecido_id)).toEqual(["vZero"]);
  });
  it("usa variante_artigo_id (substituto) antes do artigo do material", () => {
    const r = variantesNovasDoRascunho(mk(slot("m1", [v("vSub", { variante_artigo_id: "A2" })])), undefined, new Set());
    expect(r[0].artigo_id).toBe("A2");
  });
});

describe("linhasCorNova", () => {
  const novas = [{ variante_tecido_id: "vNova", artigo_id: "A1", label: "Azul - Royal" }];
  it("EST = max(0, fisico + a_receber − reservado) com reserva_outras = reservado inteiro", () => {
    const [l] = linhasCorNova(novas, [{ variante_tecido_id: "vNova", fisico: 100, a_receber: 50, reservado: 30 }], new Set());
    expect(l).toMatchObject({ artigo_id: "A1", variante_tecido_id: "vNova", label: "Azul - Royal", nec_m: 0, deficit_m: 0, fisico_m: 100, prev_receb_m: 50, reserva_outras_m: 30, estoque_m: 120 });
  });
  it("reservado maior que o disponível clampa em 0", () => {
    const [l] = linhasCorNova(novas, [{ variante_tecido_id: "vNova", fisico: 10, a_receber: 0, reservado: 300 }], new Set());
    expect(l.estoque_m).toBe(0);
  });
  it("sem linha na RPC (variante sem estoque) ou RPC ainda carregando → zeros", () => {
    expect(linhasCorNova(novas, [], new Set())[0]).toMatchObject({ fisico_m: 0, prev_receb_m: 0, reserva_outras_m: 0, estoque_m: 0 });
    expect(linhasCorNova(novas, undefined, new Set())).toHaveLength(1);
  });
  it("dedup: variante já na cobertura não vira linha extra; duplicata nas novas conta 1×; sem artigo pula", () => {
    expect(linhasCorNova(novas, [], new Set(["vNova"]))).toEqual([]);
    expect(linhasCorNova([...novas, ...novas], [], new Set())).toHaveLength(1);
    expect(linhasCorNova([{ variante_tecido_id: "x", artigo_id: null, label: null }], [], new Set())).toEqual([]);
  });
  it("fluxo ponta a ponta: PLAN do rascunho + EST real da cor nova no resumo", () => {
    const arv = mk(slot("m1", [v("vNova", { grade_total: 25 })])); // 2 × 25 = 50 m
    const necViva = necessidadePorVarianteDaArvore(arv);
    const [l] = linhasCorNova(variantesNovasDoRascunho(arv, undefined, new Set()), [{ variante_tecido_id: "vNova", fisico: 20, a_receber: 10, reservado: 5 }], new Set());
    const r = linhaResumoAoVivo({ planRascunho: planVivoDaLinha(l.variante_tecido_id, necViva, true, l.nec_m), fisico_m: l.fisico_m, prev_receb_m: l.prev_receb_m, reserva_outras_m: l.reserva_outras_m });
    expect(r).toEqual({ plan: 50, est: 25, sob: 0, compr: 25 });
  });
});

describe("estoqueDoArtigo desconta reserva de outras (Resumo comum alinhado ao Modo Plano)", () => {
  const c = (artigo_id: string, fisico_m: number, prev_receb_m: number, reserva_outras_m?: number): CoberturaVarRow =>
    ({ artigo_id, variante_tecido_id: `v${Math.random()}`, nec_m: 0, deficit_m: 0, fisico_m, prev_receb_m, reserva_outras_m });
  it("estLivre = soma por variante de max(0, fisico + a chegar − reserva)", () => {
    const r = estoqueDoArtigo([c("A", 0, 1170, 641.6), c("A", 100, 0, 300), c("B", 999, 999, 0)], "A");
    expect(r.estLivre).toBeCloseTo(528.4, 1); // 528.4 + clamp(−200→0)
    expect(r.reservaOutras).toBeCloseTo(941.6, 1);
    expect(r.fisico).toBe(100);
    expect(r.prevReceb).toBe(1170);
  });
  it("prévia antiga sem reserva_outras_m → reserva 0 (físico + a chegar)", () => {
    expect(estoqueDoArtigo([c("A", 10, 5)], "A").estLivre).toBe(15);
  });
});
