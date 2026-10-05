import { describe, it, expect } from "vitest";
import { tituloSublinha } from "@/lib/integracao/titulo-sublinha";
import { CASOS_TITULO_SUBLINHA } from "../fixtures/titulo-sublinha-casos";

// Lado TS do anti-drift "Título da sublinha" (R8, migration 20261103190000). O lado SQL roda as MESMAS fixtures em
// tests/integration/urgb-r8-titulo-sublinha.test.ts (public._integracao_titulo_sublinha).

describe("titulo-sublinha.ts — tituloSublinha (espelho _integracao_titulo_sublinha)", () => {
  for (const c of CASOS_TITULO_SUBLINHA) {
    it(`${JSON.stringify([c.titulo, c.base, c.apelido, c.modo])} → ${JSON.stringify(c.esperado)}`, () => {
      expect(tituloSublinha(c.titulo, c.base, c.apelido, c.modo)).toBe(c.esperado);
    });
  }
  it("undefined = null nas 4 pontas", () => {
    expect(tituloSublinha(undefined, "Preto", null, "cor_base")).toBeNull();
    expect(tituloSublinha("Blusa | Loja", undefined, undefined, undefined)).toBe("Blusa | Loja");
    expect(tituloSublinha("Blusa | Loja", "Preto", undefined, undefined)).toBe(
      "Blusa Preto | Loja",
    );
  });
  it("a fixture tem os casos mínimos do plano (dono, apelido, sem cor, sem |, 2×|, sobreposto, null/vazio, acento/emoji)", () => {
    const t = CASOS_TITULO_SUBLINHA.map((c) => c.titulo);
    for (const x of [
      "Vestido Suelen | Ave Rara",
      "A | B | C",
      "a | | b",
      null,
      "",
      "   ",
      "Nome |",
      "Blusa Ção 👗 | Loja",
    ]) {
      expect(t).toContain(x);
    }
  });
});
