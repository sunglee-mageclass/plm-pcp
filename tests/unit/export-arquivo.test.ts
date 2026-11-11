import { describe, it, expect } from "vitest";
import { montarMatriz } from "@/lib/integracao/export";

describe("montarMatriz", () => {
  it("cabeçalho = rótulos dos campos; 1 linha por item, na ordem dos campos", () => {
    const linhas = [{ nome: "Blusa", ref_sku: "OPVL1" }, { nome: "Saia", ref_sku: "OPSL2" }];
    const m = montarMatriz(linhas, ["nome", "ref_sku"]);
    expect(m[0]).toEqual(["Nome", "REF / SKU"]); // rótulos do catálogo
    expect(m[1]).toEqual(["Blusa", "OPVL1"]);
    expect(m[2]).toEqual(["Saia", "OPSL2"]);
  });
  it("valor ausente vira string vazia", () => {
    const m = montarMatriz([{ nome: "X" }], ["nome", "ref_sku"]);
    expect(m[1]).toEqual(["X", ""]);
  });
  it("mantém a ordem de `campos`, não a das chaves do objeto", () => {
    const m = montarMatriz([{ nome: "A", ref_sku: "B" }], ["ref_sku", "nome"]);
    expect(m[0]).toEqual(["REF / SKU", "Nome"]);
    expect(m[1]).toEqual(["B", "A"]);
  });
  it("key fora do catálogo usa a própria key como rótulo; null vira vazio; número vira texto", () => {
    const m = montarMatriz([{ zzz: null, preco_venda: 12.5 }], ["zzz", "preco_venda"]);
    expect(m[0]).toEqual(["zzz", "Preço de venda"]);
    expect(m[1]).toEqual(["", "12.5"]);
  });
});
