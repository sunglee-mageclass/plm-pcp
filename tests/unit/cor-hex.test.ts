import { describe, it, expect } from "vitest";
import { corParaHex } from "@/lib/cor-hex";

describe("cor-hex — cor por nome", () => {
  it("mapeia cores comuns (caixa/acento normalizados)", () => {
    expect(corParaHex("Preto")).toBe("#1a1a1a");
    expect(corParaHex("terracota")).toBe("#b5613f");
    expect(corParaHex("Off-white")).toBe("#f4f1ea");
    expect(corParaHex("Marinho")).toBe("#1f2d5a");
    expect(corParaHex("Rosê")).toBe("#c98a8a"); // acento removido → "rose"
  });
  it("casa por token dentro de nome composto", () => {
    expect(corParaHex("Azul Royal")).toBe("#2e6fb0");
  });
  it("nome desconhecido ou vazio → null", () => {
    expect(corParaHex("Botânica")).toBeNull();
    expect(corParaHex("")).toBeNull();
    expect(corParaHex(null)).toBeNull();
    expect(corParaHex(undefined)).toBeNull();
  });
});
