import { describe, it, expect } from "vitest";
import {
  COLUNAS_INSUMO,
  byKey,
  colunasEditaveis,
  indiceDaColuna,
} from "@/lib/insumo-grade/colunas";

describe("COLUNAS_INSUMO", () => {
  it("mantém a ordem do catálogo (cabeçalho do insumo, depois a COR)", () => {
    expect(COLUNAS_INSUMO.map((c) => c.key)).toEqual([
      "nome",
      "tipo_insumo",
      "unidade",
      "fornecedor",
      "preco",
      "formato_tamanho",
      "tamanho_vinculado",
      "observacoes",
      "cor",
      "tamanhos",
      "preco_variante",
    ]);
  });

  it("tem chaves únicas e rótulos PT-BR preenchidos", () => {
    const keys = COLUNAS_INSUMO.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of COLUNAS_INSUMO) expect(c.rotulo.length).toBeGreaterThan(0);
    expect(byKey("nome")?.rotulo).toBe("Nome");
    expect(byKey("tipo_insumo")?.rotulo).toBe("Tipo");
    expect(byKey("observacoes")?.rotulo).toBe("Observações");
    expect(byKey("preco_variante")?.rotulo).toBe("Preço da cor");
  });

  it("cabeçalho: escopo 'insumo', tipos de célula e fornecedor/tipo/unidade/formato são selects", () => {
    expect(byKey("nome")).toMatchObject({ tipo: "texto", escopo: "insumo", editavel: true });
    for (const k of ["tipo_insumo", "unidade", "fornecedor", "formato_tamanho"]) {
      expect(byKey(k)).toMatchObject({ tipo: "select", escopo: "insumo", editavel: true });
    }
    expect(byKey("preco")).toMatchObject({ tipo: "money", escopo: "insumo" });
    expect(byKey("observacoes")).toMatchObject({ tipo: "texto", escopo: "insumo" });
  });

  it("a linha-filha é a COR: cor (select), tamanhos (multi-check) e preço da cor (money), escopo 'variante'", () => {
    expect(byKey("cor")).toMatchObject({ tipo: "select", escopo: "variante", editavel: true });
    expect(byKey("tamanhos")).toMatchObject({
      tipo: "tamanhos",
      escopo: "variante",
      editavel: true,
    });
    expect(byKey("preco_variante")).toMatchObject({
      tipo: "money",
      escopo: "variante",
      editavel: true,
    });
  });

  it("declara os 2 tipos de célula NOVOS: 'tamanhos' (variante) e 'tamanho-vinculado' (cabeçalho)", () => {
    const tipos = new Set(COLUNAS_INSUMO.map((c) => c.tipo));
    expect(tipos.has("tamanhos")).toBe(true);
    expect(tipos.has("tamanho-vinculado")).toBe(true);
    expect(byKey("tamanho_vinculado")).toMatchObject({
      tipo: "tamanho-vinculado",
      escopo: "insumo",
      editavel: true,
    });
    // só essas 2 colunas usam os tipos novos
    expect(COLUNAS_INSUMO.filter((c) => c.tipo === "tamanhos").map((c) => c.key)).toEqual([
      "tamanhos",
    ]);
    expect(COLUNAS_INSUMO.filter((c) => c.tipo === "tamanho-vinculado").map((c) => c.key)).toEqual([
      "tamanho_vinculado",
    ]);
  });

  it("insumo NÃO tem apelido, foto nem categoria/subcategoria/código", () => {
    for (const k of [
      "cor_apelido",
      "cor_base",
      "foto",
      "categoria",
      "subcategoria",
      "codigo",
      "codigo_variante",
      "nome_variante",
    ]) {
      expect(byKey(k)).toBeUndefined();
    }
    expect(COLUNAS_INSUMO.some((c) => (c.tipo as string) === "foto")).toBe(false);
  });

  it("todas as colunas são editáveis (insumo não tem coluna derivada só-leitura)", () => {
    expect(colunasEditaveis()).toHaveLength(COLUNAS_INSUMO.length);
    expect(COLUNAS_INSUMO.every((c) => c.editavel)).toBe(true);
  });

  it("indiceDaColuna acompanha a ordem do catálogo; -1 se não existe", () => {
    expect(indiceDaColuna("nome")).toBe(0);
    expect(indiceDaColuna("cor")).toBe(8);
    expect(indiceDaColuna("preco_variante")).toBe(COLUNAS_INSUMO.length - 1);
    expect(indiceDaColuna("nao-existe")).toBe(-1);
  });

  it("byKey devolve undefined para chave inexistente", () => {
    expect(byKey("nao-existe")).toBeUndefined();
  });
});
