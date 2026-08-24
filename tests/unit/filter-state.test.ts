import { describe, it, expect } from "vitest";
import { parseFilterSel } from "@/hooks/useFilterState";

describe("parseFilterSel", () => {
  const initial = ["x", "y"];

  it("(a) null → initial", () => {
    expect(parseFilterSel(null, initial)).toEqual(initial);
  });

  it("(b) array de strings válido → o array", () => {
    expect(parseFilterSel('["a","b"]', initial)).toEqual(["a", "b"]);
  });

  it("(c) JSON inválido → initial (sem throw)", () => {
    expect(() => parseFilterSel("{oops", initial)).not.toThrow();
    expect(parseFilterSel("{oops", initial)).toEqual(initial);
  });

  it("(d) não-array (string) → initial", () => {
    expect(parseFilterSel('"x"', initial)).toEqual(initial);
  });

  it("(e) array com elemento não-string → initial", () => {
    expect(parseFilterSel("[1,2]", initial)).toEqual(initial);
  });

  it("(f) array vazio → [] (vazio é válido = 'todos', não cai no initial)", () => {
    expect(parseFilterSel("[]", initial)).toEqual([]);
  });
});
