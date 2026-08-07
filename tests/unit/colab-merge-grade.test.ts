import { describe, it, expect } from "vitest";
import { mergeGrade } from "../../src/lib/colab/merge-grade";
import type { GradeDetalhe } from "../../src/lib/grade-cortada";

const cel = (o: Partial<{ enviada: number; cortada: number; recebida: number; defeito: number }>) => ({ ...o });
const gd = (vid: string, tam: string, o: any): GradeDetalhe => ({ [vid]: { [tam]: cel(o) } });

describe("mergeGrade", () => {
  it("campo NÃO tocado + mudou no servidor → adota o fresh", () => {
    const base = gd("V", "M", { recebida: 1 });
    const meu = gd("V", "M", { recebida: 1 });
    const fresh = gd("V", "M", { recebida: 5 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set() });
    expect(r.valor.V.M.recebida).toBe(5);
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual(["grade:V:M:recebida"]);
  });
  it("campo tocado + servidor NÃO mudou → mantém o meu, sem conflito", () => {
    const base = gd("V", "M", { recebida: 1 });
    const meu = gd("V", "M", { recebida: 9 });
    const fresh = gd("V", "M", { recebida: 1 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set(["grade:V:M:recebida"]) });
    expect(r.valor.V.M.recebida).toBe(9);
    expect(r.conflitos).toEqual([]);
  });
  it("campo tocado + servidor mudou + valores divergem → conflito (mantém o meu)", () => {
    const base = gd("V", "M", { recebida: 1 });
    const meu = gd("V", "M", { recebida: 9 });
    const fresh = gd("V", "M", { recebida: 5 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set(["grade:V:M:recebida"]) });
    expect(r.valor.V.M.recebida).toBe(9);
    expect(r.conflitos).toEqual([{ path: "grade:V:M:recebida", meu: 9, dele: 5 }]);
  });
  it("null/ausente ≡ 0 (sem conflito nem update fantasma)", () => {
    const base = gd("V", "M", { recebida: 0 });
    const meu: GradeDetalhe = { V: { M: {} as any } };            // sem 'recebida'
    const fresh: GradeDetalhe = { V: { M: { recebida: undefined } as any } };
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set() });
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual([]);
  });
  it("célula nova no servidor (variante/tamanho ausente na base) é adotada quando não tocada", () => {
    const base: GradeDetalhe = {};
    const meu: GradeDetalhe = {};
    const fresh = gd("V", "G", { recebida: 3 });
    const r = mergeGrade({ base, meu, fresh, tocadas: new Set() });
    expect(r.valor.V.G.recebida).toBe(3);
    expect(r.atualizados).toEqual(["grade:V:G:recebida"]);
  });
});
