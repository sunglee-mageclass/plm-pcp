// tests/unit/etapas-filtro-colunas.test.ts
import { describe, it, expect } from "vitest";
import { colunasVisiveis } from "@/lib/kanban-colunas-visiveis";

const COLS = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];

describe("colunasVisiveis", () => {
  it("seleção VAZIA = mostra TODAS (sem filtro)", () => {
    expect(colunasVisiveis(COLS, [])).toEqual(COLS);
  });
  it("seleção parcial = só as marcadas, na ordem original", () => {
    expect(colunasVisiveis(COLS, ["c", "a"])).toEqual([{ key: "a", label: "A" }, { key: "c", label: "C" }]);
  });
  it("key inexistente na seleção é ignorada", () => {
    expect(colunasVisiveis(COLS, ["x", "b"])).toEqual([{ key: "b", label: "B" }]);
  });
});
