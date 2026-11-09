import { describe, it, expect } from "vitest";
import { linhaResumoAoVivo, necessidadePorVarianteDaArvore, necessidadeVariante } from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

describe("linhaResumoAoVivo", () => {
  it("PLAN do rascunho, EST do servidor, SOB/COMPR recalculam", () => {
    const r = linhaResumoAoVivo({
      planRascunho: 2000, // cliente
      fisico_m: 0, prev_receb_m: 1170, reserva_outras_m: 641.6, // servidor
    });
    expect(r.est).toBeCloseTo(528.4, 1);
    expect(r.plan).toBe(2000);
    expect(r.sob).toBe(0);
    expect(r.compr).toBeCloseTo(1471.6, 1); // max(0, 2000 − 528.4)
  });

  it("plan menor que o EST: sobra e nada a comprar", () => {
    const r = linhaResumoAoVivo({ planRascunho: 100, fisico_m: 300, prev_receb_m: 0, reserva_outras_m: 0 });
    expect(r.sob).toBe(200);
    expect(r.compr).toBe(0);
  });

  it("plan inválido (NaN) vira 0", () => {
    const r = linhaResumoAoVivo({ planRascunho: Number.NaN, fisico_m: 50, prev_receb_m: 0, reserva_outras_m: 0 });
    expect(r.plan).toBe(0);
    expect(r.sob).toBe(50);
  });
});

describe("necessidadePorVarianteDaArvore — guards", () => {
  const slot = (modelo_id: string | null, variantes: any[]) => ({
    modelo_id,
    materiais: [{ tipo: "tecido", numero: 1, consumo: 2, variantes }],
  });
  const mk = (slots: any[]): PtArvore => ({ subcolecoes: [{ linhas: [{ slots }] }] }) as any;
  const v = (id: string | null, extra: any = {}) => ({ variante_tecido_id: id, grade_total: 10, multiplicador: 1, ordem: 1, ...extra });

  it("mesma variante em 2 slots soma", () => {
    const m = necessidadePorVarianteDaArvore(mk([slot("m1", [v("vA")]), slot("m2", [v("vA")])]));
    expect(m.get("vA")).toBe(40);
  });
  it("variante oculta fica de fora", () => {
    const m = necessidadePorVarianteDaArvore(mk([slot("m1", [v("vA", { oculta: true })])]));
    expect(m.has("vA")).toBe(false);
  });
  it("variante sem variante_tecido_id (cor planejada) fica de fora", () => {
    const m = necessidadePorVarianteDaArvore(mk([slot("m1", [v(null)])]));
    expect(m.size).toBe(0);
  });
  it("reprovado ignora o slot do modelo", () => {
    const m = necessidadePorVarianteDaArvore(mk([slot("m1", [v("vA")]), slot("m2", [v("vA")])]), new Set(["m1"]));
    expect(m.get("vA")).toBe(20);
  });
});

describe("anti-drift cliente x servidor (nec_m)", () => {
  it("a necessidade do cliente = consumo×grade×mult do estado salvo (mesma função do servidor-espelho)", () => {
    // O nec_m do servidor é Σ consumo×grade×mult por variante (espelho de necessidadeVariante).
    const arvore = { subcolecoes: [{ linhas: [{ slots: [
      { modelo_id: "m1", materiais: [{ tipo: "tecido", numero: 1, consumo: 1.35, variantes: [
        { variante_tecido_id: "vA", grade_total: 12, multiplicador: 1.1, ordem: 1 },
        { variante_tecido_id: "vB", grade_total: 7, multiplicador: 1, ordem: 2 },
      ] }] },
    ] }] }] } as any;
    const m = necessidadePorVarianteDaArvore(arvore);
    expect(Math.abs((m.get("vA") ?? 0) - necessidadeVariante(1.35, 12, 1.1))).toBeLessThan(0.0001);
    expect(Math.abs((m.get("vB") ?? 0) - necessidadeVariante(1.35, 7, 1))).toBeLessThan(0.0001);
  });
});
