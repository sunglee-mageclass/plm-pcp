import { describe, it, expect } from "vitest";
import { necessidadePorVarianteDaArvore } from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

const arvore: PtArvore = {
  subcolecoes: [{ linhas: [{ slots: [
    { modelo_id: "m1", materiais: [
      { tipo: "tecido", numero: 1, consumo: 2, variantes: [
        { variante_tecido_id: "vA", grade_total: 10, multiplicador: 1, ordem: 1 },
      ] } ] },
  ] }] }],
} as any;

describe("necessidadePorVarianteDaArvore", () => {
  it("soma consumo×grade×mult por variante real do rascunho", () => {
    const m = necessidadePorVarianteDaArvore(arvore);
    expect(m.get("vA")).toBe(20); // 2 × 10 × 1
  });
});
