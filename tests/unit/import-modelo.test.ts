import { describe, it, expect } from "vitest";
import { modeloDescriptor } from "@/lib/import/entities/modelo.descriptor";
import { agregar } from "@/lib/import/aggregate";
import type { LookupMaps, RawRow } from "@/lib/import/types";

const gradeMap = new Map<string, string>();
for (const k of ["38|P", "40|M", "42|G"]) {
  const [n, s] = k.split("|");
  gradeMap.set(k.toLowerCase(), k);
  gradeMap.set(n.toLowerCase(), k);
  gradeMap.set(s.toLowerCase(), k);
}

const maps: LookupMaps = {
  categorias: new Map([["camisa", "cat-camisa"]]),
  sub1: new Map([["manga longa", "sub1-ml"]]),
  sub2: new Map(),
  colecoes: new Map([["verao", "col-verao"]]),
  linhas: new Map([["basica", "linha-basica"]]),
  meses: new Map(),
  anos: new Map(),
  tamanhos: gradeMap,
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", ...over } as RawRow;
}

// Modelo interno = SÓ CARD no Planejamento (decisão do dono): cabeçalho + grade opcional, SEM BOM.
describe("modeloDescriptor — só card (cabeçalho + grade)", () => {
  it("resolve cabeçalho + grade opcional", () => {
    const r = modeloDescriptor.resolve(row(2, {
      nome: "Camisa X", categoria: "Camisa", subcategoria1: "Manga Longa", colecao: "Verao",
      linha: "Basica", grade: "P:16, M:16, G:8", preco_venda: "199,90", preco_atacado: "99,90",
    }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro")).toBe(false);
    expect(r.cabecalho.categoria_principal_id).toBe("cat-camisa");
    expect(r.cabecalho.subcategoria1_id).toBe("sub1-ml");
    expect(r.cabecalho.colecao_id).toBe("col-verao");
    expect(r.cabecalho.linha_id).toBe("linha-basica");
    expect(r.cabecalho.preco_venda).toBe(199.9);
    expect(r.cabecalho.preco_atacado).toBe(99.9);
    // grade → 1 linha na variante 1, total 40
    expect((r.cabecalho._grades as { grade_total: number }[])[0].grade_total).toBe(40);
    // não há BOM material no payload
    expect(r.cabecalho).not.toHaveProperty("_tecidos");
    expect(r.cabecalho).not.toHaveProperty("_servicos");
  });

  it("sem grade: _grades vazio (card sem grade)", () => {
    const r = modeloDescriptor.resolve(row(2, { nome: "M", categoria: "Camisa" }), maps);
    expect(r.cabecalho._grades).toEqual([]);
  });

  it("categoria obrigatória", () => {
    const r = modeloDescriptor.resolve(row(2, { nome: "M", categoria: "Inexistente" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "categoria")).toBe(true);
  });

  it("nome obrigatório", () => {
    const r = modeloDescriptor.resolve(row(2, { nome: "", categoria: "Camisa" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "nome")).toBe(true);
  });

  it("grade: tamanho fora da grade = aviso (ignorado)", () => {
    const r = modeloDescriptor.resolve(row(2, { nome: "M", categoria: "Camisa", grade: "P:10, XG:5" }), maps);
    expect((r.cabecalho._grades as { grades: Record<string, number> }[])[0].grades).toEqual({ "38|P": 10 });
    expect(r.problemas.some((p) => p.nivel === "aviso" && /XG/.test(p.mensagem))).toBe(true);
  });

  it("agrega 2 modelos distintos = 2 entidades", () => {
    const ag = agregar(modeloDescriptor, [
      row(2, { nome: "A", categoria: "Camisa" }),
      row(3, { nome: "B", categoria: "Camisa" }),
    ], maps);
    expect(ag.entidades).toHaveLength(2);
  });

  it("rpc separa cabeçalho puro dos baldes '_'", () => {
    // sanity: o resolve não coloca campos "_" no que iria pro banco (o rpc filtra por prefixo)
    const r = modeloDescriptor.resolve(row(2, { nome: "M", categoria: "Camisa", grade: "P:10" }), maps);
    const puros = Object.keys(r.cabecalho).filter((k) => !k.startsWith("_"));
    expect(puros).toContain("categoria_principal_id");
    expect(puros).not.toContain("_grades");
    expect(puros).not.toContain("_gradeResumo");
  });
});
