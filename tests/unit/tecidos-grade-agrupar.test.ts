import { describe, expect, it } from "vitest";
import {
  agruparCategorias,
  agruparVariantes,
  type GradeVarianteCompleta,
} from "@/components/tecido/grade/agruparGrade";

const v = (id: string, artigo_id: string): GradeVarianteCompleta => ({
  id,
  artigo_id,
  cor_id: null,
  cor_apelido_id: null,
  nome_variante: null,
  codigo_variante: null,
  preco: null,
  foto_url: null,
  created_at: "2026-01-01",
});

describe("agruparGrade (Tecidos)", () => {
  it("agrupa variantes por artigo preservando a ordem", () => {
    const m = agruparVariantes([v("1", "A"), v("2", "B"), v("3", "A")]);
    expect(m.get("A")?.map((x) => x.id)).toEqual(["1", "3"]);
    expect(m.get("B")?.map((x) => x.id)).toEqual(["2"]);
    expect(m.get("C")).toBeUndefined();
  });

  it("agrupa pares categoria/subcategoria por artigo; sub ausente vira null", () => {
    const m = agruparCategorias([
      { artigo_id: "A", categoria_tecido_id: "c1", subcategoria_tecido_id: "s1" },
      {
        artigo_id: "A",
        categoria_tecido_id: "c2",
        subcategoria_tecido_id: undefined as unknown as null,
      },
      { artigo_id: "B", categoria_tecido_id: "c1", subcategoria_tecido_id: null },
    ]);
    expect(m.get("A")).toEqual([
      { categoria_tecido_id: "c1", subcategoria_tecido_id: "s1" },
      { categoria_tecido_id: "c2", subcategoria_tecido_id: null },
    ]);
    expect(m.get("B")).toEqual([{ categoria_tecido_id: "c1", subcategoria_tecido_id: null }]);
  });

  it("entrada vazia devolve Map vazio", () => {
    expect(agruparVariantes([]).size).toBe(0);
    expect(agruparCategorias([]).size).toBe(0);
  });
});
