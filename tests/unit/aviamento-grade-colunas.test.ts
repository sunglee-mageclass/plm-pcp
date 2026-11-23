import { describe, it, expect } from "vitest";
import {
  COLUNAS_AVIAMENTO,
  byKey,
  colunasEditaveis,
  indiceDaColuna,
} from "@/lib/aviamento-grade/colunas";

describe("COLUNAS_AVIAMENTO", () => {
  it("mantém a ordem do catálogo (cabeçalho do aviamento, depois a variante)", () => {
    expect(COLUNAS_AVIAMENTO.map((c) => c.key)).toEqual([
      "codigo",
      "codigo_nome",
      "fornecedor",
      "preco",
      "ncm",
      "categoria",
      "subcategoria",
      "material",
      "composicao",
      "intervalo_largura",
      "largura_exata",
      "observacoes",
      "cor_base",
      "cor_apelido",
      "nome_variante",
      "codigo_variante",
      "preco_variante",
      "foto",
    ]);
  });

  it("tem chaves únicas e rótulos PT-BR preenchidos", () => {
    const keys = COLUNAS_AVIAMENTO.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of COLUNAS_AVIAMENTO) expect(c.rotulo.length).toBeGreaterThan(0);
    expect(byKey("codigo_nome")?.rotulo).toBe("Nome");
    expect(byKey("codigo")?.rotulo).toBe("Código");
    expect(byKey("intervalo_largura")?.rotulo).toBe("Intervalo de largura");
    expect(byKey("observacoes")?.rotulo).toBe("Observações");
  });

  it("o nome é codigo_nome (não existe coluna 'nome') e o código é texto editável", () => {
    expect(byKey("nome")).toBeUndefined();
    expect(byKey("codigo_nome")).toMatchObject({
      tipo: "texto",
      escopo: "aviamento",
      editavel: true,
    });
    expect(byKey("codigo")).toMatchObject({ tipo: "texto", escopo: "aviamento", editavel: true });
  });

  it("categoria, subcategoria e material são 3 selects simples do cabeçalho (sem tipo N:N)", () => {
    for (const k of ["categoria", "subcategoria", "material"]) {
      expect(byKey(k)).toMatchObject({ tipo: "select", escopo: "aviamento", editavel: true });
    }
    expect(COLUNAS_AVIAMENTO.some((c) => (c.tipo as string) === "categorias")).toBe(false);
    expect(byKey("categorias")).toBeUndefined();
  });

  it("escopo e tipo das demais colunas", () => {
    expect(byKey("fornecedor")).toMatchObject({ tipo: "select", escopo: "aviamento" });
    expect(byKey("preco")).toMatchObject({ tipo: "money", escopo: "aviamento" });
    expect(byKey("ncm")).toMatchObject({ tipo: "texto", escopo: "aviamento" });
    expect(byKey("composicao")).toMatchObject({ tipo: "texto", escopo: "aviamento" });
    expect(byKey("intervalo_largura")).toMatchObject({ tipo: "select", escopo: "aviamento" });
    expect(byKey("largura_exata")).toMatchObject({ tipo: "money", escopo: "aviamento" });
    expect(byKey("observacoes")).toMatchObject({ tipo: "texto", escopo: "aviamento" });
    expect(byKey("cor_base")).toMatchObject({ tipo: "select", escopo: "variante" });
    expect(byKey("cor_apelido")).toMatchObject({ tipo: "select", escopo: "variante" });
    expect(byKey("nome_variante")).toMatchObject({ tipo: "texto", escopo: "variante" });
    expect(byKey("codigo_variante")).toMatchObject({ tipo: "texto", escopo: "variante" });
    expect(byKey("preco_variante")).toMatchObject({ tipo: "money", escopo: "variante" });
    expect(byKey("foto")).toMatchObject({ tipo: "foto", escopo: "variante", editavel: true });
  });

  it("todas as colunas são editáveis (aviamento não tem coluna derivada só-leitura)", () => {
    expect(colunasEditaveis()).toHaveLength(COLUNAS_AVIAMENTO.length);
    expect(COLUNAS_AVIAMENTO.every((c) => c.editavel)).toBe(true);
  });

  it("indiceDaColuna acompanha a ordem do catálogo; -1 se não existe", () => {
    expect(indiceDaColuna("codigo")).toBe(0);
    expect(indiceDaColuna("codigo_nome")).toBe(1);
    expect(indiceDaColuna("foto")).toBe(COLUNAS_AVIAMENTO.length - 1);
    expect(indiceDaColuna("nao-existe")).toBe(-1);
  });

  it("byKey devolve undefined para chave inexistente", () => {
    expect(byKey("nao-existe")).toBeUndefined();
  });
});
