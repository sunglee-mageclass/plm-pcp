import { describe, it, expect } from "vitest";
import { parseStrArray } from "@/hooks/useUiPrefs";

// A validação pura compartilhada por filtro e agrupamento (mesma semântica do antigo
// parseFilterSel). O resto do useUiPrefs (query/debounce/espelho) depende de React/Supabase/
// window — coberto por integração/E2E, não aqui.
describe("parseStrArray (useUiPrefs)", () => {
  const initial = ["x", "y"];

  it("null → initial", () => {
    expect(parseStrArray(null, initial)).toEqual(initial);
  });

  it("array de strings válido → o array", () => {
    expect(parseStrArray('["a","b"]', initial)).toEqual(["a", "b"]);
  });

  it("JSON inválido → initial (sem throw)", () => {
    expect(() => parseStrArray("{oops", initial)).not.toThrow();
    expect(parseStrArray("{oops", initial)).toEqual(initial);
  });

  it("não-array (string) → initial", () => {
    expect(parseStrArray('"x"', initial)).toEqual(initial);
  });

  it("array com elemento não-string → initial", () => {
    expect(parseStrArray("[1,2]", initial)).toEqual(initial);
  });

  it("array vazio → [] (vazio é válido = 'nenhum agrupamento'/'todos', não cai no initial)", () => {
    expect(parseStrArray("[]", initial)).toEqual([]);
  });

  it("dimensões de agrupamento (ex.: categoria+linha) round-trip", () => {
    const dims = ["categoria", "linha"];
    expect(parseStrArray(JSON.stringify(dims), [])).toEqual(dims);
  });
});
