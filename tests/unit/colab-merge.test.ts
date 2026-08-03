import { describe, it, expect } from "vitest";
import { mergeDraft, mergeLinhas } from "../../src/lib/colab/merge";

describe("mergeDraft (escalar)", () => {
  const base = { a: 1, b: "x", c: null as string | null };
  it("campo NÃO tocado assume o fresh", () => {
    const r = mergeDraft({ base, draft: { ...base }, fresh: { ...base, a: 2 }, touched: new Set() });
    expect(r.valor.a).toBe(2); expect(r.conflitos).toEqual([]); expect(r.atualizados).toEqual(["a"]);
  });
  it("tocado e servidor NÃO mudou → mantém o meu", () => {
    const r = mergeDraft({ base, draft: { ...base, b: "meu" }, fresh: { ...base }, touched: new Set(["b"]) });
    expect(r.valor.b).toBe("meu"); expect(r.conflitos).toEqual([]);
  });
  it("tocado E servidor mudou → conflito (mantém o meu no valor)", () => {
    const r = mergeDraft({ base, draft: { ...base, b: "meu" }, fresh: { ...base, b: "dele" }, touched: new Set(["b"]) });
    expect(r.valor.b).toBe("meu");
    expect(r.conflitos).toEqual([{ path: "b", meu: "meu", dele: "dele" }]);
  });
});

describe("mergeLinhas (coleções por id)", () => {
  const L = (id: string, v: number) => ({ id, v });
  it("linha mudada só pelo servidor → resolve sozinha", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 1)], fresh: [L("1", 9)], touchedIds: new Set() });
    expect(r.linhas).toEqual([L("1", 9)]); expect(r.conflitos).toEqual([]);
  });
  it("linha tocada pelos dois → conflito de LINHA (mantém a minha)", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 5)], fresh: [L("1", 9)], touchedIds: new Set(["1"]) });
    expect(r.linhas).toEqual([L("1", 5)]);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: "linha:1" });
  });
  it("adições dos dois lados → união (minha sem id preservada; a dele entra)", () => {
    const minhaNova = { id: null, v: 7 };
    const r = mergeLinhas({ base: [], draft: [minhaNova], fresh: [L("9", 3)], touchedIds: new Set() });
    expect(r.linhas).toEqual(expect.arrayContaining([minhaNova, L("9", 3)]));
  });
  it("removida no servidor + tocada por mim → conflito (dele: null)", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 5)], fresh: [], touchedIds: new Set(["1"]) });
    expect(r.conflitos[0]).toMatchObject({ path: "linha:1", dele: null });
    expect(r.linhas).toEqual([L("1", 5)]); // mantém a minha até resolver
  });
  it("removida no servidor e NÃO tocada → some", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 1)], fresh: [], touchedIds: new Set() });
    expect(r.linhas).toEqual([]);
  });
});
