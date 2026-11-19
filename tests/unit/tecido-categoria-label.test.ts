import { describe, it, expect } from "vitest";
import { rotuloCategoriasTecido, montarParesPorArtigo, rotulosPorArtigo } from "@/lib/tecido-categoria-label";

describe("rotuloCategoriasTecido", () => {
  it("categoria com sub", () => {
    expect(rotuloCategoriasTecido([{ categoria: "Malha", sub: "Lisa" }])).toBe("Malha › Lisa");
  });
  it("categoria sem sub (null, vazio ou só espaço) mostra só a categoria", () => {
    expect(rotuloCategoriasTecido([{ categoria: "Malha", sub: null }])).toBe("Malha");
    expect(rotuloCategoriasTecido([{ categoria: "Malha", sub: "" }])).toBe("Malha");
    expect(rotuloCategoriasTecido([{ categoria: "Malha", sub: "  " }])).toBe("Malha");
  });
  it("várias categorias, cada uma com a sua sub, separadas por vírgula", () => {
    expect(rotuloCategoriasTecido([
      { categoria: "Malha", sub: "Lisa" },
      { categoria: "Plano", sub: "Estampado" },
    ])).toBe("Malha › Lisa, Plano › Estampado");
  });
  it("mistura com e sem sub", () => {
    expect(rotuloCategoriasTecido([
      { categoria: "Malha", sub: "Lisa" },
      { categoria: "Forro", sub: null },
    ])).toBe("Malha › Lisa, Forro");
  });
  it("sem categoria → vazio (nada a exibir)", () => {
    expect(rotuloCategoriasTecido([])).toBe("");
    expect(rotuloCategoriasTecido(null)).toBe("");
    expect(rotuloCategoriasTecido(undefined)).toBe("");
    expect(rotuloCategoriasTecido([{ categoria: "  ", sub: "Lisa" }])).toBe("");
  });
});

describe("montarParesPorArtigo / rotulosPorArtigo", () => {
  const cats = new Map([["c1", "Malha"], ["c2", "Plano"], ["c3", "Forro"]]);
  const subs = new Map([["s1", "Lisa"], ["s2", "Estampado"]]);

  it("resolve nomes, ordena por categoria e omite artigo sem categoria", () => {
    const pares = montarParesPorArtigo([
      { artigo_id: "a1", categoria_tecido_id: "c2", subcategoria_tecido_id: "s2" },
      { artigo_id: "a1", categoria_tecido_id: "c1", subcategoria_tecido_id: "s1" },
      { artigo_id: "a2", categoria_tecido_id: "c3", subcategoria_tecido_id: null },
    ], cats, subs);
    const r = rotulosPorArtigo(pares);
    expect(r.get("a1")).toBe("Malha › Lisa, Plano › Estampado");
    expect(r.get("a2")).toBe("Forro");
    expect(r.has("a3")).toBe(false);
  });
  it("id de categoria desconhecido é ignorado; sub desconhecida vira só a categoria", () => {
    const pares = montarParesPorArtigo([
      { artigo_id: "a1", categoria_tecido_id: "zz", subcategoria_tecido_id: null },
      { artigo_id: "a1", categoria_tecido_id: "c1", subcategoria_tecido_id: "sx" },
    ], cats, subs);
    expect(rotulosPorArtigo(pares).get("a1")).toBe("Malha");
  });
  it("categoria legada do artigo só vale quando não há nenhuma linha de vínculo", () => {
    const legado = new Map<string, string | null>([["a1", "c3"], ["a2", "c3"], ["a3", null]]);
    const pares = montarParesPorArtigo(
      [{ artigo_id: "a1", categoria_tecido_id: "c1", subcategoria_tecido_id: "s1" }], cats, subs, legado);
    const r = rotulosPorArtigo(pares);
    expect(r.get("a1")).toBe("Malha › Lisa");
    expect(r.get("a2")).toBe("Forro");
    expect(r.has("a3")).toBe(false);
  });
});
