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
  it("ordem de chaves diferente sem mudança → SEM conflito", () => {
    const baseObj = { x: 1, y: 2 };
    const freshObj = { y: 2, x: 1 };
    const r = mergeDraft({
      base: { ...base, obj: baseObj },
      draft: { ...base, obj: baseObj },
      fresh: { ...base, obj: freshObj },
      touched: new Set(["obj"])
    });
    expect(r.valor.obj).toEqual(baseObj);
    expect(r.conflitos).toEqual([]);
  });
  it("NaN do servidor não é update quando não tocado", () => {
    const r = mergeDraft({
      base: { a: NaN, b: "x", c: null },
      draft: { a: NaN, b: "x", c: null },
      fresh: { a: NaN, b: "x", c: null },
      touched: new Set()
    });
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual([]);
  });
  it("NaN→número do servidor atualiza quando não tocado", () => {
    const r = mergeDraft({
      base: { a: NaN, b: "x", c: null },
      draft: { a: NaN, b: "x", c: null },
      fresh: { a: 42, b: "x", c: null },
      touched: new Set()
    });
    expect(r.valor.a).toBe(42);
    expect(r.atualizados).toEqual(["a"]);
  });
  it("campo não tocado null→array no fresh NÃO lança e atualiza", () => {
    const r = mergeDraft({
      base: { a: null, b: "x", c: null },
      draft: { a: null, b: "x", c: null },
      fresh: { a: [1, 2, 3], b: "x", c: null },
      touched: new Set()
    });
    expect(r.valor.a).toEqual([1, 2, 3]);
    expect(r.atualizados).toEqual(["a"]);
    expect(r.conflitos).toEqual([]);
  });
  it("0 vs -0 em campo tocado → sem conflito", () => {
    const r = mergeDraft({
      base: { a: 0, b: "x", c: null },
      draft: { a: -0, b: "x", c: null },
      fresh: { a: 0, b: "x", c: null },
      touched: new Set(["a"])
    });
    expect(r.valor.a).toBe(-0);
    expect(r.conflitos).toEqual([]);
  });
  it("{a:undefined} vs {} em campo jsonb tocado → sem conflito", () => {
    const r = mergeDraft({
      base: { obj: { a: undefined }, b: "x", c: null },
      draft: { obj: { a: undefined }, b: "x", c: null },
      fresh: { obj: {}, b: "x", c: null },
      touched: new Set(["obj"])
    });
    expect(r.conflitos).toEqual([]);
    expect(r.valor.obj).toEqual({ a: undefined }); // mantém o meu
  });
  it("objeto vs array em campo não tocado → ATUALIZA (são diferentes)", () => {
    const r = mergeDraft({
      base: { data: { 0: 1, 1: 2 }, b: "x", c: null },
      draft: { data: { 0: 1, 1: 2 }, b: "x", c: null },
      fresh: { data: [1, 2], b: "x", c: null },
      touched: new Set()
    });
    expect(r.valor.data).toEqual([1, 2]); // fresh venceu, são diferentes
    expect(r.atualizados).toEqual(["data"]);
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
  it("dup-id no draft → apenas 1 conflito (mantém primeira ocorrência)", () => {
    const r = mergeLinhas({
      base: [L("1", 1)],
      draft: [L("1", 5), L("1", 7)],
      fresh: [L("1", 9)],
      touchedIds: new Set(["1"])
    });
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toEqual(L("1", 5)); // primeira ocorrência
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].path).toBe("linha:1");
  });
  it("linha em draft+fresh AUSENTE do base (tocada) NÃO lança e conflita", () => {
    const r = mergeLinhas({
      base: [],
      draft: [L("1", 5)],
      fresh: [L("1", 9)],
      touchedIds: new Set(["1"])
    });
    expect(r.linhas).toEqual([L("1", 5)]); // mantém minha
    expect(r.conflitos).toHaveLength(1); // há conflito (servidor mandou diferente)
    expect(r.conflitos[0]).toMatchObject({ path: "linha:1" });
  });
});
