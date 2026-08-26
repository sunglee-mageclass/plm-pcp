import { describe, it, expect } from "vitest";
import { gradeEfetivaPar } from "@/lib/casar-variantes-grade";

describe("gradeEfetivaPar — grade efetiva pelo casamento de variantes (Fatia 2B)", () => {
  it("(a) Tecido 1 → sempre gradePosicao, mesmo com complementaIds presente", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: true,
        complementaIds: ["tempestade-id"],
        gradePosicao: 120,
        gradePorVarianteTecido1: new Map([["tempestade-id", 60]]),
      })
    ).toBe(120);
  });

  it("(b) complementar SEM casamento (ids null) → gradePosicao", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: null,
        gradePosicao: 120,
        gradePorVarianteTecido1: new Map([["tempestade-id", 60]]),
      })
    ).toBe(120);
  });

  it("(b) complementar SEM casamento (ids []) → gradePosicao", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: [],
        gradePosicao: 120,
        gradePorVarianteTecido1: new Map([["tempestade-id", 60]]),
      })
    ).toBe(120);
  });

  it("(c) casado com 1 cor → a grade dessa cor (não a posição)", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: ["tempestade-id"],
        gradePosicao: 999,
        gradePorVarianteTecido1: new Map([["tempestade-id", 60]]),
      })
    ).toBe(60);
  });

  it("(d) casado com 2 cores → soma (Tempestade 60 + Malha Tessa 120 = 180)", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: ["tempestade-id", "malha-tessa-id"],
        gradePosicao: 999,
        gradePorVarianteTecido1: new Map([
          ["tempestade-id", 60],
          ["malha-tessa-id", 120],
        ]),
      })
    ).toBe(180);
  });

  it("(e) id órfão (não está no mapa) → contribui 0; só a presente conta", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: ["tempestade-id", "orfao-id"],
        gradePosicao: 999,
        gradePorVarianteTecido1: new Map([["tempestade-id", 60]]),
      })
    ).toBe(60);
  });

  it("(f) casado com cor de grade 0 → 0", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: ["zero-id"],
        gradePosicao: 999,
        gradePorVarianteTecido1: new Map([["zero-id", 0]]),
      })
    ).toBe(0);
  });

  it("(g) caso concreto do bug (Blusa Teste v5): entretela casada só com Tempestade (60) → 60, não a posicional 120", () => {
    expect(
      gradeEfetivaPar({
        isTecido1: false,
        complementaIds: ["tempestade-id"],
        gradePosicao: 120,
        gradePorVarianteTecido1: new Map([["tempestade-id", 60]]),
      })
    ).toBe(60);
  });
});
