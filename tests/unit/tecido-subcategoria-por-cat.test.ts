import { describe, it, expect } from "vitest";
import { paresParaSalvar, definirSub, podarSubs, subPorCatDasLinhas } from "@/lib/tecido-subcategoria";

describe("subcategoria de tecido por categoria", () => {
  it("paresParaSalvar: categoria sem sub vai com null", () => {
    expect(paresParaSalvar(["A", "B"], { A: "s1" })).toEqual([
      { categoria_tecido_id: "A", subcategoria_tecido_id: "s1" },
      { categoria_tecido_id: "B", subcategoria_tecido_id: null },
    ]);
  });
  it("paresParaSalvar: sub de categoria desmarcada nao vaza", () => {
    const r = paresParaSalvar(["A"], { A: "s1", C: "s9" });
    expect(r).toEqual([{ categoria_tecido_id: "A", subcategoria_tecido_id: "s1" }]);
    expect(JSON.stringify(r)).not.toContain("s9");
  });
  it("paresParaSalvar: sem categorias = lista vazia", () => {
    expect(paresParaSalvar([], { A: "s1" })).toEqual([]);
  });
  it("definirSub: escolher grava, limpar remove a chave (nao deixa null)", () => {
    const a = definirSub({}, "A", "s1");
    expect(a).toEqual({ A: "s1" });
    expect(definirSub(a, "A", null)).toEqual({});
    expect(definirSub(a, "A", "")).toEqual({});
    expect(a).toEqual({ A: "s1" }); // nao muta
  });
  it("podarSubs: desmarcar categoria limpa a sub dela", () => {
    expect(podarSubs({ A: "s1", B: "s2" }, ["B"])).toEqual({ B: "s2" });
    expect(podarSubs({ A: "s1" }, [])).toEqual({});
  });
  it("subPorCatDasLinhas: so entram linhas com sub", () => {
    expect(
      subPorCatDasLinhas([
        { categoria_tecido_id: "A", subcategoria_tecido_id: "s1" },
        { categoria_tecido_id: "B", subcategoria_tecido_id: null },
      ]),
    ).toEqual({ A: "s1" });
  });
});
