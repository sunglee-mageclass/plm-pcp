import { describe, it, expect } from "vitest";
import {
  montarLinhas,
  valorColuna,
  type ArtigoEntrada,
  type VarianteEntrada,
} from "@/lib/tecido-grade/linhas";
import { byKey } from "@/lib/tecido-grade/colunas";

const art = (id: string, extra: Partial<ArtigoEntrada> = {}): ArtigoEntrada => ({
  id,
  rev: 3,
  nome: `Artigo ${id}`,
  empresa_id: "emp1",
  preco: 10,
  unidade_medida: "metro",
  largura_estimada: 1.5,
  composicao: "100% algodão",
  ncm: "5208",
  rendimento: 4,
  mes_id: "m1",
  ano_id: "a1",
  categorias: [],
  ...extra,
});
const vari = (
  id: string,
  artigoId: string,
  extra: Partial<VarianteEntrada> = {},
): VarianteEntrada => ({
  id,
  artigo_id: artigoId,
  cor_id: `cor-${id}`,
  cor_apelido_id: null,
  nome_variante: `Var ${id}`,
  codigo_variante: `C-${id}`,
  preco: 12,
  foto_url: null,
  ...extra,
});

describe("montarLinhas", () => {
  it("artigo com 3 variantes gera 3 linhas, cabeçalho repetido e chaves distintas", () => {
    const a = art("A1");
    const mapa = new Map([["A1", [vari("v1", "A1"), vari("v2", "A1"), vari("v3", "A1")]]]);
    const linhas = montarLinhas([a], mapa);
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.artigo === a && l.artigoId === "A1" && l.rev === 3)).toBe(true);
    expect(linhas.map((l) => l.chave)).toEqual(["A1:v1", "A1:v2", "A1:v3"]);
    expect(new Set(linhas.map((l) => l.chave)).size).toBe(3);
    expect(linhas.map((l) => l.variantId)).toEqual(["v1", "v2", "v3"]);
  });

  it("artigo sem variante (ausente ou lista vazia) gera 1 linha 'sem cor'", () => {
    const linhas = montarLinhas([art("A1"), art("A2")], new Map([["A2", []]]));
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(l.variantId).toBeNull();
      expect(l.variante).toBeNull();
    }
    expect(linhas.map((l) => l.chave)).toEqual(["A1:sem-cor", "A2:sem-cor"]);
  });

  it("preserva a ordem dos artigos e das variantes recebidas", () => {
    const mapa = new Map([
      ["B", [vari("b2", "B"), vari("b1", "B")]],
      ["A", [vari("a1", "A")]],
    ]);
    const linhas = montarLinhas([art("B"), art("C"), art("A")], mapa);
    expect(linhas.map((l) => l.chave)).toEqual(["B:b2", "B:b1", "C:sem-cor", "A:a1"]);
  });

  it("rev nulo do artigo segue nulo na linha", () => {
    const [l] = montarLinhas([art("A1", { rev: null })], new Map());
    expect(l.rev).toBeNull();
  });

  it("lista vazia de artigos devolve lista vazia", () => {
    expect(montarLinhas([], new Map())).toEqual([]);
  });
});

describe("valorColuna", () => {
  const a = art("A1", {
    unidade_medida: "kg",
    preco_por_metro: 7.5,
    categorias: [
      { categoria_tecido_id: "c1", subcategoria_tecido_id: null },
      { categoria_tecido_id: "c2", subcategoria_tecido_id: "s1" },
    ],
  });
  const [comCor] = montarLinhas(
    [a],
    new Map([["A1", [vari("v1", "A1", { cor_apelido_id: "ap1", preco: 99 })]]]),
  );
  const [semCor] = montarLinhas([a], new Map());
  const c = (k: string) => byKey(k)!;

  it("coluna de artigo lê do artigo (também na linha sem cor)", () => {
    for (const l of [comCor, semCor]) {
      expect(valorColuna(l, c("nome"))).toBe("Artigo A1");
      expect(valorColuna(l, c("preco"))).toBe(10);
      expect(valorColuna(l, c("unidade"))).toBe("kg");
      expect(valorColuna(l, c("largura_estimada"))).toBe(1.5);
      expect(valorColuna(l, c("ncm"))).toBe("5208");
      expect(valorColuna(l, c("rendimento"))).toBe(4);
      expect(valorColuna(l, c("fornecedor"))).toBe("emp1");
      expect(valorColuna(l, c("mes"))).toBe("m1");
      expect(valorColuna(l, c("preco_por_metro"))).toBe(7.5);
    }
  });

  it("coluna de variante lê da variante", () => {
    expect(valorColuna(comCor, c("cor_base"))).toBe("cor-v1");
    expect(valorColuna(comCor, c("cor_apelido"))).toBe("ap1");
    expect(valorColuna(comCor, c("nome_variante"))).toBe("Var v1");
    expect(valorColuna(comCor, c("codigo_variante"))).toBe("C-v1");
    expect(valorColuna(comCor, c("preco_variante"))).toBe(99);
    expect(valorColuna(comCor, c("foto"))).toBeNull();
  });

  it("linha sem cor devolve null em TODAS as colunas de variante", () => {
    for (const k of [
      "cor_base",
      "cor_apelido",
      "nome_variante",
      "codigo_variante",
      "preco_variante",
      "foto",
    ]) {
      expect(valorColuna(semCor, c(k))).toBeNull();
    }
  });

  it("valores ausentes viram null", () => {
    const [l] = montarLinhas([art("X", { preco: null, ncm: null, empresa_id: null })], new Map());
    expect(valorColuna(l, c("preco"))).toBeNull();
    expect(valorColuna(l, c("ncm"))).toBeNull();
    expect(valorColuna(l, c("fornecedor"))).toBeNull();
    expect(valorColuna(l, c("categorias"))).toBeNull();
  });

  it("resolver opcional troca ids por rótulos (seleção e categorias)", () => {
    const nomes: Record<string, string> = {
      emp1: "Tecelagem Sul",
      "cor-v1": "Preto",
      c1: "Liso",
      c2: "Estampado",
    };
    const res = (_k: string, id: string) => nomes[id];
    expect(valorColuna(comCor, c("fornecedor"), res)).toBe("Tecelagem Sul");
    expect(valorColuna(comCor, c("cor_base"), res)).toBe("Preto");
    expect(valorColuna(comCor, c("categorias"), res)).toBe("Liso, Estampado");
    // sem rótulo conhecido, cai no id
    expect(valorColuna(comCor, c("mes"), res)).toBe("m1");
  });

  it("sem resolver, categorias devolve os ids juntos", () => {
    expect(valorColuna(comCor, c("categorias"))).toBe("c1, c2");
  });
});
