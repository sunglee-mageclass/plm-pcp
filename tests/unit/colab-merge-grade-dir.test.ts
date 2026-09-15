import { describe, it, expect } from "vitest";
import { mergeGradeDir, pathDirCel, type GradeDir } from "../../src/lib/colab/merge-grade-dir";

// helper: 1 célula (variante × loja × tam → qtd)
const g = (variante: number, loja: string, tam: string, qtd: number): GradeDir => ({ [variante]: { [loja]: { [tam]: qtd } } });

describe("mergeGradeDir", () => {
  it("célula NÃO tocada + mudou no servidor → adota o fresh", () => {
    const base = g(1, "lojaA", "M", 2);
    const meu = g(1, "lojaA", "M", 2);
    const fresh = g(1, "lojaA", "M", 7);
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set() });
    expect(r.valor[1].lojaA.M).toBe(7);
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual(["dir:1:lojaA:M"]);
  });

  it("célula tocada + servidor NÃO mudou → mantém o meu, sem conflito", () => {
    const base = g(1, "lojaA", "M", 2);
    const meu = g(1, "lojaA", "M", 9);
    const fresh = g(1, "lojaA", "M", 2);
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set([pathDirCel(1, "lojaA", "M")]) });
    expect(r.valor[1].lojaA.M).toBe(9);
    expect(r.conflitos).toEqual([]);
  });

  it("célula tocada + mudou no servidor + diverge → CONFLITO (mantém o meu)", () => {
    const base = g(1, "lojaA", "M", 2);
    const meu = g(1, "lojaA", "M", 9);
    const fresh = g(1, "lojaA", "M", 5);
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set([pathDirCel(1, "lojaA", "M")]) });
    expect(r.valor[1].lojaA.M).toBe(9); // mantém o meu
    expect(r.conflitos).toEqual([{ path: "dir:1:lojaA:M", meu: 9, dele: 5 }]);
  });

  it("célula tocada + mudou no servidor MAS coincide com o meu → sem conflito", () => {
    const base = g(1, "lojaA", "M", 2);
    const meu = g(1, "lojaA", "M", 5);
    const fresh = g(1, "lojaA", "M", 5);
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set([pathDirCel(1, "lojaA", "M")]) });
    expect(r.conflitos).toEqual([]);
  });

  it("dimensão LOJA independente: editar lojaA não conflita com mudança do servidor em lojaB", () => {
    const base: GradeDir = { 1: { lojaA: { M: 2 }, lojaB: { M: 3 } } };
    const meu: GradeDir = { 1: { lojaA: { M: 9 }, lojaB: { M: 3 } } };   // editei só lojaA
    const fresh: GradeDir = { 1: { lojaA: { M: 2 }, lojaB: { M: 8 } } }; // servidor mudou só lojaB
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set([pathDirCel(1, "lojaA", "M")]) });
    expect(r.valor[1].lojaA.M).toBe(9); // meu preservado
    expect(r.valor[1].lojaB.M).toBe(8); // lojaB adota o fresh (não toquei)
    expect(r.conflitos).toEqual([]);
  });

  it("loja NOVA no fresh (outro adicionou) é adotada", () => {
    const base: GradeDir = { 1: { lojaA: { M: 2 } } };
    const meu: GradeDir = { 1: { lojaA: { M: 2 } } };
    const fresh: GradeDir = { 1: { lojaA: { M: 2 }, lojaB: { M: 4 } } };
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set() });
    expect(r.valor[1].lojaB.M).toBe(4);
    expect(r.atualizados).toContain("dir:1:lojaB:M");
  });

  it("célula ausente ≡ 0 (não vira conflito à toa)", () => {
    const base: GradeDir = {};
    const meu: GradeDir = { 1: { lojaA: { M: 0 } } };
    const fresh: GradeDir = {};
    const r = mergeGradeDir({ base, meu, fresh, tocadas: new Set([pathDirCel(1, "lojaA", "M")]) });
    expect(r.conflitos).toEqual([]);
  });
});
