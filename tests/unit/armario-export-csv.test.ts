import { describe, it, expect } from "vitest";
import { montarMatriz } from "@/lib/integracao/export";
import {
  CAMPOS_ARMARIO, CHAVES_ARMARIO, PREF_NENHUMA_COLUNA, colunasEscolhidas, keysValidasArmario, lerRetornoExportarArmario,
  montarDadosArmario, nomeArquivoArmario, prefDeColunas, rotulosArmario,
} from "@/lib/armario/export-csv";
import { KEYS_VALIDAS } from "@/lib/integracao/campos-export";

const LINHAS = [
  { sku_pai: "AB12345678VERM", grupo: "Feminino", categoria: "Vestido", subcategoria1: "Midi", subcategoria2: null },
  { sku_pai: null, grupo: "Feminino", categoria: "Saia", subcategoria1: null, subcategoria2: "Plissada" },
];

describe("catálogo do Armário", () => {
  it("tem as 6 chaves, na ordem, com os rótulos exatos", () => {
    expect(CAMPOS_ARMARIO.map((c) => [c.key, c.rotulo])).toEqual([
      ["sku_pai", "SKU"], ["nome_armario", "Nome do Armário"], ["grupo", "Grupo"],
      ["categoria", "Categoria"], ["subcategoria1", "Subcategoria 1"], ["subcategoria2", "Subcategoria 2"],
    ]);
    expect([...keysValidasArmario()]).toEqual([...CHAVES_ARMARIO]);
  });
  it("sku_pai/nome_armario NÃO existem no catálogo central (por isso o conjunto próprio)", () => {
    expect(KEYS_VALIDAS.has("sku_pai")).toBe(false);
    expect(KEYS_VALIDAS.has("nome_armario")).toBe(false);
  });
});

describe("colunasEscolhidas / prefDeColunas", () => {
  it("pref vazio = só o SKU pré-marcado (padrão, decisão do dono)", () => {
    expect(colunasEscolhidas([])).toEqual(["sku_pai"]);
  });
  it("sai na ordem do catálogo, ignora chave desconhecida", () => {
    expect(colunasEscolhidas(["categoria", "xyz", "sku_pai"])).toEqual(["sku_pai", "categoria"]);
  });
  it("desmarcar tudo grava a marca 'nenhuma' e resulta em 0 colunas (não volta a 'todas')", () => {
    const pref = prefDeColunas([]);
    expect(pref).toEqual([PREF_NENHUMA_COLUNA]);
    expect(colunasEscolhidas(pref)).toEqual([]);
  });
  it("prefDeColunas ordena pelo catálogo", () => {
    expect(prefDeColunas(["grupo", "sku_pai"])).toEqual(["sku_pai", "grupo"]);
  });
});

describe("montarDadosArmario + montarMatriz (o que baixarExport grava no CSV)", () => {
  const ret = { nome_armario: "Verão 26", linhas: LINHAS };

  it("replica nome_armario em CADA linha e mantém a ordem da vitrine", () => {
    const d = montarDadosArmario(ret, CHAVES_ARMARIO);
    expect(d.niveis["1"]).toHaveLength(2);
    expect(d.niveis["1"].map((l) => l.nome_armario)).toEqual(["Verão 26", "Verão 26"]);
    expect(d.niveis["1"].map((l) => l.categoria)).toEqual(["Vestido", "Saia"]);
  });

  it("colunas selecionadas saem na ordem do catálogo, com os rótulos certos no cabeçalho", () => {
    const d = montarDadosArmario(ret, ["subcategoria1", "nome_armario", "sku_pai"]);
    expect(d.colunas).toEqual(["sku_pai", "nome_armario", "subcategoria1"]);
    const m = montarMatriz(d.niveis["1"], d.colunas, rotulosArmario());
    expect(m[0]).toEqual(["SKU", "Nome do Armário", "Subcategoria 1"]);
    expect(m[1]).toEqual(["AB12345678VERM", "Verão 26", "Midi"]);
  });

  it("null (sku_pai/subcategoria) vira string vazia", () => {
    const d = montarDadosArmario(ret, CHAVES_ARMARIO);
    const m = montarMatriz(d.niveis["1"], d.colunas, rotulosArmario());
    expect(m[2]).toEqual(["", "Verão 26", "Feminino", "Saia", "", "Plissada"]);
    expect(m[1][5]).toBe("");
  });

  it("célula que começa com '=' ganha apóstrofo (CSV injection, vindo do escaparCelula)", () => {
    const d = montarDadosArmario({ nome_armario: "=HYPERLINK(\"x\")", linhas: [{ sku_pai: "+cmd", grupo: "@g", categoria: "-c", subcategoria1: "ok", subcategoria2: null }] }, CHAVES_ARMARIO);
    const m = montarMatriz(d.niveis["1"], d.colunas, rotulosArmario());
    expect(m[1][0]).toBe("'+cmd");
    expect(m[1][1]).toBe("'=HYPERLINK(\"x\")");
    expect(m[1][2]).toBe("'@g");
    expect(m[1][3]).toBe("'-c");
    expect(m[1][4]).toBe("ok");
  });

  it("armário sem itens = nível 1 vazio; só cabeçalho", () => {
    const d = montarDadosArmario({ nome_armario: "X", linhas: [] }, CHAVES_ARMARIO);
    expect(d.niveis["1"]).toEqual([]);
    expect(montarMatriz(d.niveis["1"], d.colunas, rotulosArmario())).toHaveLength(1);
  });

  it("não muta as linhas do retorno da RPC", () => {
    montarDadosArmario(ret, CHAVES_ARMARIO);
    expect("nome_armario" in LINHAS[0]).toBe(false);
  });
});

describe("lerRetornoExportarArmario", () => {
  it("shape normal", () => {
    expect(lerRetornoExportarArmario({ nome_armario: "A", linhas: LINHAS })).toEqual({ nome_armario: "A", linhas: LINHAS });
  });
  it("lixo/ausente vira vazio sem lançar", () => {
    expect(lerRetornoExportarArmario(null)).toEqual({ nome_armario: "", linhas: [] });
    expect(lerRetornoExportarArmario({ linhas: "x" })).toEqual({ nome_armario: "", linhas: [] });
  });
});

describe("nomeArquivoArmario", () => {
  it("sem acento, minúsculo, hífens", () => {
    expect(nomeArquivoArmario("Verão 26 / Coleção Ação!")).toBe("armario-verao-26-colecao-acao");
  });
  it("vazio/símbolos = 'armario'", () => {
    expect(nomeArquivoArmario("")).toBe("armario");
    expect(nomeArquivoArmario(null)).toBe("armario");
    expect(nomeArquivoArmario("???")).toBe("armario");
  });
  it("nome longo é cortado sem terminar em hífen", () => {
    const n = nomeArquivoArmario("a".repeat(59) + " bbbbbb");
    expect(n.length).toBeLessThanOrEqual("armario-".length + 60);
    expect(n.endsWith("-")).toBe(false);
  });
});
