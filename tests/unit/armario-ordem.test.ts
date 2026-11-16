import { describe, it, expect } from "vitest";
import { reordenar, indiceEnvio, posicaoGrade, fatiarEmLinhas } from "@/lib/armario/ordem";

const lista = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
const ids = (l: { id: string }[]) => l.map((x) => x.id).join("");

describe("reordenar", () => {
  it("move sem mutar a original", () => {
    const r = reordenar(lista, 0, 3);
    expect(ids(r)).toBe("bcdaefg");
    expect(ids(lista)).toBe("abcdefg");
    expect(ids(reordenar(lista, 5, 1))).toBe("afbcdeg");
  });
  it("de===para ou fora do intervalo = sem mudança", () => {
    expect(ids(reordenar(lista, 2, 2))).toBe("abcdefg");
    expect(ids(reordenar(lista, -1, 2))).toBe("abcdefg");
    expect(ids(reordenar(lista, 2, 99))).toBe("abcdefg");
  });
});

describe("indiceEnvio", () => {
  it("é 1-based, contíguo 1..N, na sequência da lista", () => {
    const r = indiceEnvio(reordenar(lista, 0, 3));
    expect(r.map((x) => x.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ids(r)).toBe("bcdaefg");
  });
  it("lista vazia", () => {
    expect(indiceEnvio([])).toEqual([]);
  });
});

describe("colunas são visuais: NÃO mudam a ordem 1..N", () => {
  it("mudar colunas só refluí a grade; a ordem de envio é a mesma", () => {
    const base = indiceEnvio(lista);
    for (const cols of [1, 2, 3, 4, 6, 12]) {
      const achatada = fatiarEmLinhas(base, cols).flat();
      expect(achatada).toEqual(base);
      expect(indiceEnvio(achatada).map((x) => x.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });
  it("posicaoGrade reflui por colunas", () => {
    expect(posicaoGrade(4, 3)).toEqual({ linha: 2, coluna: 2 });
    expect(posicaoGrade(4, 2)).toEqual({ linha: 3, coluna: 1 });
  });
  it("reordenar muda a sequência independente de colunas", () => {
    const r = reordenar(lista, 6, 0);
    expect(ids(fatiarEmLinhas(r, 3).flat())).toBe("gabcdef");
    expect(ids(fatiarEmLinhas(r, 5).flat())).toBe("gabcdef");
  });
});
