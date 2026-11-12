// tests/unit/etapas-filtro-colunas.test.ts
import { describe, it, expect } from "vitest";
import { colunasVisiveis } from "@/lib/kanban-colunas-visiveis";

const COLS = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }, { key: "d", label: "D" }];

describe("colunasVisiveis", () => {
  it("seleção VAZIA = mostra TODAS (sem filtro)", () => {
    expect(colunasVisiveis(COLS, [])).toEqual(COLS);
  });

  // A3b: a PRIMEIRA e a ÚLTIMA coluna do board ficam SEMPRE visíveis, mesmo fora da seleção.
  it("seleção do MEIO: 1ª e última entram sempre, na ordem original", () => {
    // seleciona só "b"; "a" (1ª) e "d" (última) entram por serem terminais do board
    expect(colunasVisiveis(COLS, ["b"])).toEqual([
      { key: "a", label: "A" }, { key: "b", label: "B" }, { key: "d", label: "D" },
    ]);
  });

  it("coluna do MEIO pode ser escondida (não selecionada = some)", () => {
    // "c" (meio) não está na seleção e não é terminal → some
    expect(colunasVisiveis(COLS, ["b"]).map((c) => c.key)).not.toContain("c");
  });

  it("seleção que inclui a 1ª/última não duplica", () => {
    expect(colunasVisiveis(COLS, ["a", "d"])).toEqual([
      { key: "a", label: "A" }, { key: "d", label: "D" },
    ]);
  });

  it("key inexistente na seleção é ignorada (mas 1ª/última seguem)", () => {
    expect(colunasVisiveis(COLS, ["x", "b"]).map((c) => c.key)).toEqual(["a", "b", "d"]);
  });

  it("board de 1 coluna: ela é 1ª e última ao mesmo tempo, sempre visível", () => {
    const uma = [{ key: "a", label: "A" }];
    expect(colunasVisiveis(uma, ["zzz"])).toEqual(uma);
  });

  it("board de 2 colunas: ambas são terminais, nenhuma some", () => {
    const duas = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    expect(colunasVisiveis(duas, [])).toEqual(duas);
    expect(colunasVisiveis(duas, ["zzz"])).toEqual(duas);
  });
});
