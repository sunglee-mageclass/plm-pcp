// Mapeamento tipo -> controle da célula e campos/opções (`src/lib/tecido-grade/celulas.ts`).
import { describe, it, expect } from "vitest";
import { COLUNAS_TECIDO } from "@/lib/tecido-grade/colunas";
import {
  CAMPO_ARTIGO, CAMPO_VARIANTE, casasDaColuna, celulaDesabilitadaPorRegra, controleDaCelula, mesmaLista, mesmoMapa,
  opcoesDaColuna, permiteVazio, precoPorMetroTexto, OPCAO_VAZIA,
} from "@/lib/tecido-grade/celulas";

describe("controleDaCelula: cada tipo de coluna vira o controle certo", () => {
  it("texto=input, money=money, select=select, categorias=categorias, foto=foto, readonly=somente-leitura", () => {
    expect(controleDaCelula({ tipo: "texto", editavel: true })).toBe("input");
    expect(controleDaCelula({ tipo: "money", editavel: true })).toBe("money");
    expect(controleDaCelula({ tipo: "select", editavel: true })).toBe("select");
    expect(controleDaCelula({ tipo: "categorias", editavel: true })).toBe("categorias");
    expect(controleDaCelula({ tipo: "foto", editavel: true })).toBe("foto");
    expect(controleDaCelula({ tipo: "readonly", editavel: false })).toBe("somente-leitura");
    expect(controleDaCelula({ tipo: "texto", editavel: false })).toBe("somente-leitura");
  });
  it("preço por metro é só leitura no catálogo; nome é input; preço é money; categorias é popover", () => {
    const c = (k: string) => COLUNAS_TECIDO.find((x) => x.key === k)!;
    expect(controleDaCelula(c("preco_por_metro"))).toBe("somente-leitura");
    expect(controleDaCelula(c("nome"))).toBe("input");
    expect(controleDaCelula(c("preco"))).toBe("money");
    expect(controleDaCelula(c("preco_variante"))).toBe("money");
    expect(controleDaCelula(c("fornecedor"))).toBe("select");
    expect(controleDaCelula(c("categorias"))).toBe("categorias");
  });
  it("toda coluna editável (exceto categorias/foto) tem campo de rascunho", () => {
    for (const c of COLUNAS_TECIDO) {
      const ctl = controleDaCelula(c);
      if (ctl === "somente-leitura" || ctl === "foto") continue;
      const mapa = c.escopo === "artigo" ? CAMPO_ARTIGO : CAMPO_VARIANTE;
      expect(mapa[c.key], `coluna ${c.key}`).toBeTruthy();
    }
  });
});

describe("opções e regras", () => {
  const o = {
    empresas: [{ id: "e1", nome_fantasia: "Fornec" }],
    cores: [{ id: "c1", nome: "Azul" }, { id: "c2", nome: "Verde" }],
    coresApelido: [{ id: "a1", nome: "Marinho", cor_base_id: "c1" }, { id: "a2", nome: "Musgo", cor_base_id: "c2" }],
    meses: [{ id: "m1", mes: "Janeiro" }],
    anos: [{ id: "y1", ano: "2026" }],
  };
  it("opcoesDaColuna", () => {
    expect(opcoesDaColuna("fornecedor", o)).toEqual([{ id: "e1", nome: "Fornec" }]);
    expect(opcoesDaColuna("unidade", o).map((x) => x.id)).toEqual(["metro", "kg"]);
    expect(opcoesDaColuna("mes", o)).toEqual([{ id: "m1", nome: "Janeiro" }]);
    expect(opcoesDaColuna("ano", o)).toEqual([{ id: "y1", nome: "2026" }]);
    expect(opcoesDaColuna("cor_base", o)).toHaveLength(2);
    expect(opcoesDaColuna("cor_apelido", o, "c1").map((x) => x.id)).toEqual(["a1"]);
    expect(opcoesDaColuna("cor_apelido", o, "").map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(opcoesDaColuna("nome", o)).toEqual([]);
  });
  it("só fornecedor/mês/ano deixam limpar; sentinela não colide com id", () => {
    expect(["fornecedor", "mes", "ano"].every(permiteVazio)).toBe(true);
    expect(["unidade", "cor_base", "cor_apelido"].some(permiteVazio)).toBe(false);
    expect(OPCAO_VAZIA).not.toBe("");
  });
  it("rendimento só edita em Kg", () => {
    expect(celulaDesabilitadaPorRegra("rendimento", { unidade_medida: "metro" })).toBe(true);
    expect(celulaDesabilitadaPorRegra("rendimento", { unidade_medida: "kg" })).toBe(false);
    expect(celulaDesabilitadaPorRegra("nome", { unidade_medida: "metro" })).toBe(false);
  });
  it("preço por metro: preço ÷ rendimento em kg; senão —", () => {
    expect(precoPorMetroTexto({ unidade_medida: "metro", preco: 10, rendimento: 4 })).toBe("—");
    expect(precoPorMetroTexto({ unidade_medida: "kg", preco: null, rendimento: 4 })).toBe("—");
    expect(precoPorMetroTexto({ unidade_medida: "kg", preco: 10, rendimento: 4 })).toMatch(/2,50/);
  });
  it("casas e igualdades", () => {
    expect(casasDaColuna("preco")).toBe(2);
    expect(mesmaLista(["a", "b"], ["a", "b"])).toBe(true);
    expect(mesmaLista(["a", "b"], ["b", "a"])).toBe(false);
    expect(mesmoMapa({ a: "1" }, { a: "1" })).toBe(true);
    expect(mesmoMapa({ a: "1" }, { a: "2" })).toBe(false);
    expect(mesmoMapa({}, { a: "1" })).toBe(false);
  });
});
