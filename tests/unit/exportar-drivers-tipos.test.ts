// Exportar dados por tipo (Task 5) — forma dos 3 drivers novos (tecido/aviamento/insumo), montagem dos argumentos da RPC
// (sentinela/vazio -> null no SQL), persistência por tipo (telas de pref próprias, distintas do produto) e a tradução do erro novo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { driverTecido, argsRpcTecido } from "@/components/exportar/drivers/tecido";
import { driverAviamento, argsRpcAviamento } from "@/components/exportar/drivers/aviamento";
import { driverInsumo, argsRpcInsumo } from "@/components/exportar/drivers/insumo";
import { driverProduto } from "@/components/exportar/drivers/produto";
import { SENTINELA_TODOS, idParaRpc, lerRespostaExport } from "@/components/exportar/drivers/tipos";
import { catalogoDoTipo } from "@/lib/exportar/campos-por-tipo";
import { mensagemErro, TEXTO_EXPORTAR_FILTRO_INVALIDO } from "@/lib/erro-mensagem";

describe("drivers tecido/aviamento/insumo", () => {
  it("tecido: catalogo do tipo, 2 niveis, abas Cabeçalho/Até variante", () => {
    expect(driverTecido.tipo).toBe("tecido");
    expect(driverTecido.catalogo).toEqual(catalogoDoTipo("tecido"));
    expect(driverTecido.catalogo.some((c) => c.key === "categorias")).toBe(true);
    expect(driverTecido.niveis.map((n) => n.valor)).toEqual(["1", "2"]);
    expect(driverTecido.niveis.map((n) => n.rotulo)).toEqual(["1. Cabeçalho", "2. Até variante"]);
    expect(driverTecido.nomeAba).toEqual({ "1": "Cabeçalho", "2": "Até variante" });
  });
  it("aviamento: catalogo do tipo, 2 niveis, abas Cabeçalho/Até variante", () => {
    expect(driverAviamento.catalogo).toEqual(catalogoDoTipo("aviamento"));
    expect(driverAviamento.niveis.map((n) => n.valor)).toEqual(["1", "2"]);
    expect(driverAviamento.nomeAba).toEqual({ "1": "Cabeçalho", "2": "Até variante" });
  });
  it("insumo: variante cor x tamanho (sem apelido) no catalogo; nivel 2 com o rotulo cor × tamanho", () => {
    expect(driverInsumo.catalogo.some((c) => c.key === "cor")).toBe(true);
    expect(driverInsumo.catalogo.some((c) => c.key === "cor_apelido")).toBe(false);
    expect(driverInsumo.niveis.map((n) => n.valor)).toEqual(["1", "2"]);
    expect(driverInsumo.niveis[1].rotulo).toBe("2. Até variante (cor × tamanho)");
    expect(driverInsumo.nomeAba).toEqual({ "1": "Cabeçalho", "2": "Até variante" });
  });
  it("itens e aviso de variante (parametrizado: 'cabeçalho', nunca 'SKU pai')", () => {
    expect(driverTecido.item).toEqual({ um: "tecido", varios: "tecidos" });
    expect(driverAviamento.item).toEqual({ um: "aviamento", varios: "aviamentos" });
    expect(driverInsumo.item).toEqual({ um: "insumo", varios: "insumos" });
    for (const d of [driverTecido, driverAviamento, driverInsumo]) {
      expect(d.avisoVariante).toMatch(/vazios no cabeçalho/);
      expect(d.avisoVariante).not.toMatch(/SKU pai/);
    }
    expect(driverProduto.avisoVariante).toBeUndefined(); // o produto segue com o texto de sempre
  });
  it("persistencia: cada tipo tem a PROPRIA tela de pref (distinta do produto 'integracao' e entre si)", () => {
    const telas = [driverProduto, driverTecido, driverAviamento, driverInsumo].map((d) => d.prefScreen);
    expect(telas).toEqual(["integracao", "tecido", "aviamento", "insumo"]);
    expect(new Set(telas).size).toBe(4);
  });
});

describe("argumentos da RPC (sentinela/vazio -> null)", () => {
  it("idParaRpc", () => {
    expect(idParaRpc(null)).toBe(null);
    expect(idParaRpc("")).toBe(null);
    expect(idParaRpc(SENTINELA_TODOS)).toBe(null);
    expect(idParaRpc("cat-uuid")).toBe("cat-uuid");
  });
  it("tecido", () => {
    expect(argsRpcTecido({ categoria: SENTINELA_TODOS }, ["nome"], ["1"], 20)).toEqual({ _categoria: null, _campos: ["nome"], _niveis: ["1"], _limite: 20 });
    expect(argsRpcTecido({ categoria: "cat-uuid" }, ["nome"], ["1", "2"], null)).toEqual({ _categoria: "cat-uuid", _campos: ["nome"], _niveis: ["1", "2"], _limite: null });
  });
  it("aviamento: dois filtros independentes (categoria E material)", () => {
    const a = argsRpcAviamento({ categoria: SENTINELA_TODOS, material: "mat-uuid" }, ["nome"], ["1"], null);
    expect(a._categoria).toBe(null);
    expect(a._material).toBe("mat-uuid");
    const b = argsRpcAviamento({ categoria: "cat-uuid", material: null }, ["nome"], ["1"], 20);
    expect(b._categoria).toBe("cat-uuid");
    expect(b._material).toBe(null);
    expect(Object.keys(b).sort()).toEqual(["_campos", "_categoria", "_limite", "_material", "_niveis"]);
  });
  it("insumo: um filtro (tipo de insumo)", () => {
    expect(argsRpcInsumo({ tipo: SENTINELA_TODOS }, ["nome"], ["1"], null)._tipo_insumo).toBe(null);
    expect(argsRpcInsumo({ tipo: "tp-uuid" }, ["nome"], ["1"], null)._tipo_insumo).toBe("tp-uuid");
  });
  it("resposta da RPC: campos ausentes viram vazio", () => {
    expect(lerRespostaExport(null)).toEqual({ colunas: [], total: 0, niveis: {} });
    expect(lerRespostaExport({ colunas: ["nome"], total: 3, niveis: { "1": [{ nome: "a" }] } }).total).toBe(3);
  });
});

describe("erro novo", () => {
  it("exportar_filtro_invalido (P0001, ASCII) vira texto PT", () => {
    expect(mensagemErro({ code: "P0001", message: "exportar_filtro_invalido" }, "fallback")).toBe(TEXTO_EXPORTAR_FILTRO_INVALIDO);
    expect(TEXTO_EXPORTAR_FILTRO_INVALIDO).toMatch(/filtro/);
  });
});

describe("ligacao na tela", () => {
  it("ExportarDados registra os 4 drivers (nenhum tipo cai no aviso 'nao disponivel')", () => {
    const src = readFileSync("src/components/exportar/ExportarDados.tsx", "utf8");
    for (const d of ["driverProduto", "driverTecido", "driverAviamento", "driverInsumo"]) expect(src).toContain(d);
  });
  it("a chave da previa leva o tipo (tecido/aviamento/insumo nao compartilham cache entre si)", () => {
    for (const f of ["tecido", "aviamento", "insumo"]) {
      expect(readFileSync(`src/components/exportar/drivers/${f}.tsx`, "utf8")).toMatch(new RegExp(`chave: \\["${f}"`));
    }
  });
});
