// Ordenação por coluna da grade de Tecidos (PURA): por GRUPO (tecido), estável, vazio por último, pelo NOME (resolver) e não pelo id.
import { describe, it, expect } from "vitest";
import { byKey } from "@/lib/tecido-grade/colunas";
import { montarLinhas, type ArtigoEntrada, type VarianteEntrada } from "@/lib/tecido-grade/linhas";
import { colunaOrdenavel, ordenarLinhasPorColuna } from "@/lib/tecido-grade/ordenar";
import { compararValores } from "@/lib/comparar-valores";

const art = (id: string, nome: string, extra: Partial<ArtigoEntrada> = {}): ArtigoEntrada => ({
  id, rev: 1, nome, empresa_id: null, preco: null, unidade_medida: "metro", largura_estimada: null, composicao: null, ncm: null,
  rendimento: null, mes_id: null, ano_id: null, ...extra,
});
const vari = (id: string, artigo_id: string, extra: Partial<VarianteEntrada> = {}): VarianteEntrada => ({
  id, artigo_id, cor_id: null, cor_apelido_id: null, nome_variante: null, codigo_variante: null, preco: null, foto_url: null, ...extra,
});

const artigos = [art("a1", "Zeta", { preco: 10 }), art("a2", "alfa", { preco: 30 }), art("a3", "Meio"), art("a4", "Beta", { preco: 20 })];
const variantes = new Map<string, VarianteEntrada[]>([
  ["a1", [vari("v1", "a1", { cor_id: "c9", nome_variante: "z" }), vari("v2", "a1", { cor_id: "c1", nome_variante: "a" })]],
  ["a2", [vari("v3", "a2", { cor_id: "c5" })]],
  ["a4", [vari("v4", "a4", { cor_id: "c2" }), vari("v5", "a4", { cor_id: "c8" })]],
]);
const linhas = montarLinhas(artigos, variantes);
const ids = (l: { artigoId: string; variantId: string | null }[]) => l.map((x) => `${x.artigoId}${x.variantId ? `/${x.variantId}` : ""}`);
const col = (k: string) => byKey(k)!;

describe("ordenarLinhasPorColuna", () => {
  it("coluna do TECIDO: ordena os grupos e NÃO mexe na ordem das cores do tecido (sem caixa/acento)", () => {
    expect(ids(ordenarLinhasPorColuna(linhas, col("nome"), "asc"))).toEqual(["a2/v3", "a4/v4", "a4/v5", "a3", "a1/v1", "a1/v2"]);
    expect(ids(ordenarLinhasPorColuna(linhas, col("nome"), "desc"))).toEqual(["a1/v1", "a1/v2", "a3", "a4/v4", "a4/v5", "a2/v3"]);
  });

  it("número como número (10 < 20 < 30) e vazio sempre por último, em asc E em desc", () => {
    expect(ids(ordenarLinhasPorColuna(linhas, col("preco"), "asc")).map((x) => x.split("/")[0])).toEqual(["a1", "a1", "a4", "a4", "a2", "a3"]);
    expect(ids(ordenarLinhasPorColuna(linhas, col("preco"), "desc")).map((x) => x.split("/")[0])).toEqual(["a2", "a4", "a4", "a1", "a1", "a3"]);
  });

  it("estável: tecidos empatados ficam na ordem de entrada", () => {
    const iguais = montarLinhas([art("x", "Igual"), art("y", "Igual"), art("z", "Igual")], new Map());
    expect(ids(ordenarLinhasPorColuna(iguais, col("nome"), "asc"))).toEqual(["x", "y", "z"]);
    expect(ids(ordenarLinhasPorColuna(iguais, col("nome"), "desc"))).toEqual(["x", "y", "z"]);
  });

  it("coluna da COR: ordena as cores dentro do tecido e o tecido pela 1ª cor (menor em asc, maior em desc); sem cor no fim", () => {
    const asc = ordenarLinhasPorColuna(linhas, col("nome_variante"), "asc"); // só a1 tem nome de variante
    expect(ids(asc)).toEqual(["a1/v2", "a1/v1", "a2/v3", "a3", "a4/v4", "a4/v5"]); // a1 primeiro (tem valor); o resto empata na ordem de entrada
    const desc = ordenarLinhasPorColuna(linhas, col("nome_variante"), "desc");
    expect(ids(desc)).toEqual(["a1/v1", "a1/v2", "a2/v3", "a3", "a4/v4", "a4/v5"]);
  });

  it("com resolver, ordena pelo NOME da cor e não pelo id (c9 = 'Azul' vem antes de c1 = 'Verde')", () => {
    const nomes: Record<string, string> = { c9: "Azul", c1: "Verde", c5: "Preto", c2: "Branco", c8: "Cinza" };
    const resolver = (_k: string, id: string) => nomes[id];
    expect(ids(ordenarLinhasPorColuna(linhas, col("cor_base"), "asc", resolver))).toEqual(["a1/v1", "a1/v2", "a4/v4", "a4/v5", "a2/v3", "a3"]);
    // sem resolver ordena pelo id cru: c1 < c9
    expect(ids(ordenarLinhasPorColuna(linhas, col("cor_base"), "asc"))[0]).toBe("a1/v2");
  });

  it("não muda a lista de entrada e mantém todas as linhas", () => {
    const antes = ids(linhas);
    const saida = ordenarLinhasPorColuna(linhas, col("nome"), "desc");
    expect(ids(linhas)).toEqual(antes);
    expect(saida).toHaveLength(linhas.length);
  });

  it("Foto não é ordenável; as demais são", () => {
    expect(colunaOrdenavel(col("foto"))).toBe(false);
    expect(colunaOrdenavel(col("nome"))).toBe(true);
    expect(colunaOrdenavel(col("preco_por_metro"))).toBe(true);
  });
});

describe("compararValores (a regra do useSort)", () => {
  it("vazios por último nos dois sentidos; número vs texto", () => {
    expect(compararValores(null, 1, "asc")).toBe(1);
    expect(compararValores(null, 1, "desc")).toBe(1);
    expect(compararValores("", "a", "desc")).toBe(1);
    expect(compararValores(2, 10, "asc")).toBeLessThan(0);
    expect(compararValores("a2", "a10", "asc")).toBeLessThan(0); // numeric
    expect(compararValores("b", "a", "desc")).toBeLessThan(0);
  });
});
