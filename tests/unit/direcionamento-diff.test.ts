import { describe, it, expect } from "vitest";
import { diffPorTamanho, motivoNaoConfere } from "@/lib/direcionamento-diff";

describe("diffPorTamanho", () => {
  it("soma as linhas por tamanho e calcula o delta contra a grade real", () => {
    const diffs = diffPorTamanho(
      { P: 4, M: 6, G: 2 },
      [{ P: 2, M: 6 }, { P: 2, G: 3 }],
      ["P", "M", "G"],
    );
    expect(diffs).toEqual([
      { tamanho: "P", real: 4, direcionado: 4, delta: 0 },
      { tamanho: "M", real: 6, direcionado: 6, delta: 0 },
      { tamanho: "G", real: 2, direcionado: 3, delta: 1 },
    ]);
  });

  it("trata linhas/valores ausentes como 0", () => {
    const diffs = diffPorTamanho({ M: 5 }, [], ["M"]);
    expect(diffs).toEqual([{ tamanho: "M", real: 5, direcionado: 0, delta: -5 }]);
  });
});

describe("motivoNaoConfere", () => {
  it("null quando tudo bate", () => {
    expect(motivoNaoConfere([{ tamanho: "P", real: 2, direcionado: 2, delta: 0 }])).toBeNull();
  });

  it("falta em PT com quantidade e tamanho", () => {
    expect(
      motivoNaoConfere([
        { tamanho: "P", real: 2, direcionado: 2, delta: 0 },
        { tamanho: "M", real: 6, direcionado: 2, delta: -4 },
      ]),
    ).toBe("Falta direcionar 4 peça(s) no tamanho M.");
  });

  it("sobra em PT", () => {
    expect(motivoNaoConfere([{ tamanho: "G", real: 1, direcionado: 3, delta: 2 }])).toBe(
      "2 peça(s) a mais no tamanho G.",
    );
  });
});
