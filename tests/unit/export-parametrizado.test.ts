import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { montarMatriz, baixarExport } from "@/lib/integracao/export";
import { rotulosDoTipo, keysValidasDoTipo } from "@/lib/exportar/campos-por-tipo";

// writeFile dispararia download no navegador: captura (wb, nome) e deixa o resto do xlsx real.
const writeFile = vi.hoisted(() => vi.fn());
vi.mock("xlsx", async (orig) => {
  const real = await orig<typeof import("xlsx")>();
  return { ...real, writeFile, default: { ...real, writeFile } };
});

describe("export.ts parametrizado por rotulos", () => {
  it("montarMatriz usa o mapa de rotulos recebido (nao um fixo do produto)", () => {
    const rotulos = new Map([["nome", "Nome"], ["categorias", "Categoria(s)"]]);
    const m = montarMatriz([{ nome: "Tec A", categorias: "Cat A | Cat B" }], ["nome", "categorias"], rotulos);
    expect(m[0]).toEqual(["Nome", "Categoria(s)"]);
    expect(m[1]).toEqual(["Tec A", "Cat A | Cat B"]);
  });

  it("escapa formula de celula (= + - @) no corpo", () => {
    const rotulos = new Map([["nome", "Nome"]]);
    const m = montarMatriz([{ nome: "=HYPERLINK(1)" }], ["nome"], rotulos);
    expect(m[1][0].startsWith("'")).toBe(true);
  });

  it("chave sem rotulo cai na propria key", () => {
    const m = montarMatriz([{ x: "v" }], ["x"], new Map());
    expect(m[0]).toEqual(["x"]);
  });
});

describe("baixarExport parametrizado (produto: mesmas abas/arquivo de antes)", () => {
  const OPTS = {
    rotulos: rotulosDoTipo("produto"),
    nomeAba: { "1": "SKU pai", "2": "Até cor", "3": "Até tamanho" } as Record<string, string>,
    keysValidas: keysValidasDoTipo("produto"),
  };
  const dados = {
    colunas: ["nome", "ref_sku", "coluna_fora_do_catalogo"],
    niveis: { "1": [{ nome: "Blusa", ref_sku: "A" }], "2": [{ nome: "Blusa", ref_sku: "A-AZ" }] },
  };
  let escrito: { wb: XLSX.WorkBook; nome: string } | null;
  beforeEach(() => {
    escrito = null;
    writeFile.mockReset();
    writeFile.mockImplementation((wb: XLSX.WorkBook, nome: string) => { escrito = { wb, nome }; });
  });

  it("1 nivel = .csv com 1 aba; descarta coluna fora do catalogo do tipo", () => {
    baixarExport(dados, ["1"], "exp", OPTS);
    expect(escrito?.nome).toBe("exp.csv");
    expect(escrito?.wb.SheetNames).toEqual(["SKU pai"]);
    const aoa = XLSX.utils.sheet_to_json(escrito!.wb.Sheets["SKU pai"], { header: 1 });
    expect(aoa[0]).toEqual(["Nome", "REF / SKU"]);
  });

  it("2 niveis = .xlsx com 1 aba por nivel, na ordem 1->2, com os nomes recebidos", () => {
    baixarExport(dados, ["2", "1"], "exp", OPTS);
    expect(escrito?.nome).toBe("exp.xlsx");
    expect(escrito?.wb.SheetNames).toEqual(["SKU pai", "Até cor"]);
  });

  it("usa o nomeAba do tipo recebido (nao o do produto)", () => {
    baixarExport(dados, ["1", "2"], "tec", { ...OPTS, nomeAba: { "1": "Tecido", "2": "Variante" } });
    expect(escrito?.wb.SheetNames).toEqual(["Tecido", "Variante"]);
  });

  it("nenhum nivel selecionado/existente = nao escreve nada", () => {
    baixarExport(dados, ["3"], "exp", OPTS);
    expect(escrito).toBeNull();
  });
});
