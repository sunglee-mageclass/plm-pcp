// Exportar dados por tipo — helpers puros do contrato do driver (estado do filtro por tipo, nome-base do arquivo, tipo salvo).
import { describe, it, expect } from "vitest";
import { SENTINELA_TODOS, valorFiltroValido, nomeBaseArquivo, tipoValido, TIPOS_EXPORT } from "@/components/exportar/drivers/tipos";
import { NOME_ABA_PRODUTO, NIVEIS_PRODUTO, driverProduto } from "@/components/exportar/drivers/produto";
import { CAMPOS_EXPORT } from "@/lib/integracao/campos-export";

describe("estado do filtro por tipo", () => {
  it("vazio = nada escolhido (prévia nao consulta)", () => {
    expect(valorFiltroValido([], [{ id: "a" }])).toBe(null);
  });
  it("sentinela __todos__ vale sempre (todos)", () => {
    expect(SENTINELA_TODOS).toBe("__todos__");
    expect(valorFiltroValido([SENTINELA_TODOS], [])).toBe(SENTINELA_TODOS);
  });
  it("id so vale se ainda existe na lista carregada", () => {
    expect(valorFiltroValido(["a"], [{ id: "a" }, { id: "b" }])).toBe("a");
    expect(valorFiltroValido(["x"], [{ id: "a" }])).toBe(null); // id sumiu
  });
  it("nome-base do arquivo por tipo (usa o valor/id do filtro; sentinela e vazio = todas/todos)", () => {
    expect(nomeBaseArquivo("tecido", { categoria: "Malha" })).toBe("export-tecido-Malha");
    expect(nomeBaseArquivo("tecido", { categoria: SENTINELA_TODOS })).toBe("export-tecido-todas");
    expect(nomeBaseArquivo("tecido", { categoria: null })).toBe("export-tecido-todas");
    expect(nomeBaseArquivo("aviamento", { categoria: "Botoes", material: "Metal" })).toBe("export-aviamento-Botoes-Metal");
    expect(nomeBaseArquivo("aviamento", { categoria: SENTINELA_TODOS, material: SENTINELA_TODOS })).toBe("export-aviamento-todas-todos");
    expect(nomeBaseArquivo("insumo", { tipo: "Etiqueta" })).toBe("export-insumo-Etiqueta");
    expect(nomeBaseArquivo("insumo", { tipo: SENTINELA_TODOS })).toBe("export-insumo-todos");
  });
  it("nome-base do PRODUTO = o de sempre (export-<colecao>-<sub>; null = todas)", () => {
    expect(nomeBaseArquivo("produto", { colecao: "Verão", subcolecao: "R1" })).toBe("export-Verão-R1");
    expect(nomeBaseArquivo("produto", { colecao: "Verão", subcolecao: null })).toBe("export-Verão-todas");
    expect(nomeBaseArquivo("produto", { colecao: null, subcolecao: null })).toBe("export-todas-as-colecoes-todas");
  });
});

describe("tipo salvo", () => {
  it("vazio ou desconhecido = produto; valores válidos passam", () => {
    expect(tipoValido([])).toBe("produto");
    expect(tipoValido(["xyz"])).toBe("produto");
    for (const t of TIPOS_EXPORT) expect(tipoValido([t.valor])).toBe(t.valor);
    expect(TIPOS_EXPORT.map((t) => t.valor)).toEqual(["produto", "tecido", "aviamento", "insumo"]);
  });
});

describe("driver produto (contrato)", () => {
  it("3 níveis, abas do Excel e catálogo de sempre; prefs na tela histórica 'integracao'", () => {
    expect(driverProduto.tipo).toBe("produto");
    expect(driverProduto.catalogo).toBe(CAMPOS_EXPORT);
    expect(driverProduto.niveis).toBe(NIVEIS_PRODUTO);
    expect(NIVEIS_PRODUTO.map((n) => n.valor)).toEqual(["1", "2", "3"]);
    expect(NOME_ABA_PRODUTO).toEqual({ "1": "SKU pai", "2": "Até cor", "3": "Até tamanho" });
    expect(driverProduto.nomeAba).toBe(NOME_ABA_PRODUTO);
    expect(driverProduto.prefScreen).toBe("integracao");
  });
});
