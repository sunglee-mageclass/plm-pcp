import { describe, it, expect } from "vitest";
import { COLUNAS_TECIDO, colunasEditaveis, byKey } from "@/lib/tecido-grade/colunas";

describe("COLUNAS_TECIDO", () => {
  it("mantém a ordem do catálogo (artigo, categorias, variante, foto, só-leitura)", () => {
    expect(COLUNAS_TECIDO.map((c) => c.key)).toEqual([
      "nome",
      "fornecedor",
      "preco",
      "unidade",
      "largura_estimada",
      "composicao",
      "ncm",
      "rendimento",
      "mes",
      "ano",
      "categorias",
      "cor_base",
      "cor_apelido",
      "nome_variante",
      "codigo_variante",
      "preco_variante",
      "foto",
      "preco_por_metro",
    ]);
  });

  it("tem chaves únicas e rótulos PT-BR preenchidos", () => {
    const keys = COLUNAS_TECIDO.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of COLUNAS_TECIDO) expect(c.rotulo.length).toBeGreaterThan(0);
    expect(byKey("largura_estimada")?.rotulo).toBe("Largura estimada");
    expect(byKey("categorias")?.rotulo).toBe("Categoria(s)");
  });

  it("categorias e foto são editáveis, com tipo próprio", () => {
    expect(byKey("categorias")).toMatchObject({
      tipo: "categorias",
      escopo: "artigo",
      editavel: true,
    });
    expect(byKey("foto")).toMatchObject({ tipo: "foto", escopo: "variante", editavel: true });
  });

  it("escopo e tipo das demais colunas", () => {
    expect(byKey("fornecedor")).toMatchObject({ tipo: "select", escopo: "artigo" });
    expect(byKey("preco")?.tipo).toBe("money");
    expect(byKey("unidade")?.tipo).toBe("select");
    expect(byKey("cor_base")).toMatchObject({ tipo: "select", escopo: "variante" });
    expect(byKey("cor_apelido")).toMatchObject({ tipo: "select", escopo: "variante" });
    expect(byKey("nome_variante")).toMatchObject({ tipo: "texto", escopo: "variante" });
    expect(byKey("preco_variante")).toMatchObject({ tipo: "money", escopo: "variante" });
  });

  it("preco_por_metro é só leitura e fora de colunasEditaveis()", () => {
    expect(byKey("preco_por_metro")).toMatchObject({ tipo: "readonly", editavel: false });
    const ed = colunasEditaveis();
    expect(ed.some((c) => c.key === "preco_por_metro")).toBe(false);
    expect(ed.every((c) => c.editavel)).toBe(true);
    expect(ed).toHaveLength(COLUNAS_TECIDO.length - 1);
  });

  it("byKey devolve undefined para chave inexistente", () => {
    expect(byKey("nao-existe")).toBeUndefined();
  });
});
