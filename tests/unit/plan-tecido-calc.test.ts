import { describe, it, expect } from "vitest";
import { necessidadeVariante, necessidadePorTecido, metrosParaKg, abaterEstoque } from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

describe("plan-tecido/calc", () => {
  it("necessidadeVariante = consumo × grade_total × mult (sem perda)", () => {
    expect(necessidadeVariante(1.4, 90, 1)).toBeCloseTo(126, 5);
    expect(necessidadeVariante(0.8, 90, 1)).toBeCloseTo(72, 5);
    expect(necessidadeVariante(1, 10, 0.5)).toBeCloseTo(5, 5);
  });

  it("metrosParaKg divide por rendimento; rendimento 0/null → 0", () => {
    expect(metrosParaKg(180, 3)).toBeCloseTo(60, 5);
    expect(metrosParaKg(180, 0)).toBe(0);
    expect(metrosParaKg(180, null)).toBe(0);
  });

  it("abaterEstoque nunca fica negativo", () => {
    expect(abaterEstoque(264, 90)).toBe(174);
    expect(abaterEstoque(210, 340)).toBe(0);
  });

  it("necessidadePorTecido soma por artigo/variante em toda a árvore", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
      ] },
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 35 }] },
      ] },
    ] }] }] };
    const r = necessidadePorTecido(arv);
    expect(r).toHaveLength(1);
    expect(r[0].artigo_id).toBe("A");
    // v1: 1.4×90 + 1.2×35 = 126 + 42 = 168
    expect(r[0].variantes[0].metros).toBeCloseTo(168, 5);
    expect(r[0].totalMetros).toBeCloseTo(168, 5);
  });

  it("forro usa grade_total do Tecido 1 do mesmo slot (design D8)", () => {
    // Slot: Tecido 1 (grade_total=90, consumo=1.4, mult=1) + Forro (consumo=0.8, mult=1.0)
    // Forro deve usar tecido1Total=90 → 0.8 × 90 × 1 = 72
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "TEC1", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 1,
          variantes: [{ variante_tecido_id: "vt1", label: "Branco", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
        { artigo_id: "FOR1", artigo_nome: "Forro Acetato", unidade_medida: "metro", rendimento: null, tipo: "forro", numero: 1, consumo: 0.8, loss_percent: 0, ordem: 2,
          variantes: [{ variante_tecido_id: "vf1", label: "Natural", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 }] },
      ] },
    ] }] }] };
    const r = necessidadePorTecido(arv);
    // Must have 2 artigos: TEC1 and FOR1
    expect(r).toHaveLength(2);
    const tec = r.find((x) => x.artigo_id === "TEC1")!;
    const forro = r.find((x) => x.artigo_id === "FOR1")!;
    // Tecido: 1.4 × 90 × 1 = 126
    expect(tec.variantes[0].metros).toBeCloseTo(126, 5);
    expect(tec.totalMetros).toBeCloseTo(126, 5);
    // Forro: 0.8 × 90 × 1 = 72  (grade_total do Tecido 1 do slot)
    expect(forro.variantes[0].metros).toBeCloseTo(72, 5);
    expect(forro.totalMetros).toBeCloseTo(72, 5);
  });
});
