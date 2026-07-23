import { describe, it, expect } from "vitest";
import { snapshotsEqual, serializeSnapshot } from "@/hooks/useDirtySnapshot";

describe("snapshotsEqual — detecção de alterações não salvas", () => {
  it("objetos idênticos = sem alteração", () => {
    expect(snapshotsEqual({ nome: "A", preco: 10 }, { nome: "A", preco: 10 })).toBe(true);
  });

  it("campo alterado = alteração", () => {
    expect(snapshotsEqual({ nome: "A", preco: 10 }, { nome: "A", preco: 11 })).toBe(false);
  });

  it("alteração aninhada = alteração", () => {
    expect(
      snapshotsEqual({ cor: { id: 1, nome: "azul" } }, { cor: { id: 1, nome: "verde" } }),
    ).toBe(false);
  });

  it("número vs string equivalente = alteração (tipos importam)", () => {
    expect(snapshotsEqual({ qtd: 1 }, { qtd: "1" })).toBe(false);
  });

  it("null e undefined são tratados como equivalentes (formulário vazio)", () => {
    expect(snapshotsEqual(null, undefined)).toBe(true);
  });

  it("array reordenado = alteração (ordem importa)", () => {
    expect(snapshotsEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("serializeSnapshot é resiliente a ciclos (não lança)", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serializeSnapshot(a)).not.toThrow();
  });
});
