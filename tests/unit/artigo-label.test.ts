import { describe, it, expect } from "vitest";
import { artigoLabel, unidadeSufixo } from "@/lib/artigo-label";

describe("artigoLabel", () => {
  it("nome + unidade entre colchetes", () => {
    expect(artigoLabel({ nome: "Linho Premium", unidade_medida: "metro" })).toBe("Linho Premium [metro]");
    expect(artigoLabel({ nome: "Malha Canelada", unidade_medida: "kg" })).toBe("Malha Canelada [kg]");
  });
  it("sem unidade → só o nome", () => {
    expect(artigoLabel({ nome: "Botão" })).toBe("Botão");
    expect(artigoLabel({ nome: "Botão", unidade_medida: "" })).toBe("Botão");
  });
  it("sem nome / nulo → travessão", () => {
    expect(artigoLabel(null)).toBe("—");
    expect(artigoLabel(undefined)).toBe("—");
    expect(artigoLabel({})).toBe("—");
  });
});

describe("unidadeSufixo", () => {
  it("metro vira m, kg continua kg", () => {
    expect(unidadeSufixo("metro")).toBe("m");
    expect(unidadeSufixo("metros")).toBe("m");
    expect(unidadeSufixo("kg")).toBe("kg");
    expect(unidadeSufixo("quilo")).toBe("kg");
  });
  it("vazio → vazio; desconhecido → ele mesmo (lowercase)", () => {
    expect(unidadeSufixo("")).toBe("");
    expect(unidadeSufixo(null)).toBe("");
    expect(unidadeSufixo("Unidade")).toBe("unidade");
  });
});
