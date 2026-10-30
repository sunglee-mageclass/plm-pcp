// [urg R13 T6] A OC vista DO PRODUTO — lógica PURA: adaptador do embed `oc_item`, textos do mockup, regra de desvincular e a lista do
// "Vincular OC existente" (encomendadas, mesmo fornecedor; Importado: e mesma moeda).
import { describe, it, expect } from "vitest";
import {
  EMBED_OC_ITEM_PA, EMBED_OC_ITEM_PI, ocInfoDeItens, textoChipOc, textoDivideOc, podeDesvincularDireto, ocsParaVincular,
  nomeDoFornecedor, TEXTO_ABRA_A_OC, TEXTO_IDENTIDADE_TRAVADA, TEXTO_TIRAR_DA_OC, type OcItemEmbedRow, type OcCandidata,
} from "@/lib/oc-produto-vinculo";

const item = (over: Partial<OcItemEmbedRow> = {}): OcItemEmbedRow => ({
  id: "it1", status: "encomendado", qtd_total: 30, valor_unitario_real: "58.9", grade_detalhe: { "1": { P: { pedida: 10, recebida: 4, defeito: 0 } } },
  valor_unitario: "62", valor_unitario_m1: "9.5", desconto_pct: "5",
  oc: { id: "oc1", numero: "BELDIV-00123", status: "encomendado", empresa_id: "f1", itens: [{ count: 3 }] },
  ...over,
});

describe("embed `oc_item` — o texto do plano", () => {
  it("PA: o embed EXATO do plano §4 F-c", () => {
    expect(EMBED_OC_ITEM_PA).toBe(
      "oc_item:ocs_p_acabado_itens(id,status,qtd_total,valor_unitario_real,grade_detalhe,valor_unitario,desconto_pct, oc:ocs_p_acabado(id,numero,status,empresa_id, itens:ocs_p_acabado_itens(count)))",
    );
  });
  it("PI: espelhado nas tabelas do Importado (valor de compra = valor_unitario_m1)", () => {
    expect(EMBED_OC_ITEM_PI).toBe(
      "oc_item:ocs_importado_itens(id,status,qtd_total,valor_unitario_real,grade_detalhe,valor_unitario_m1,desconto_pct, oc:ocs_importado(id,numero,status,empresa_id, itens:ocs_importado_itens(count)))",
    );
  });
  it("nenhum dos dois reintroduz o ponteiro do cabeçalho (`ocs:ocs_*(`)", () => {
    expect(EMBED_OC_ITEM_PA).not.toMatch(/ocs:\s*ocs_/);
    expect(EMBED_OC_ITEM_PI).not.toMatch(/ocs:\s*ocs_/);
  });
});

describe("ocInfoDeItens — adaptador para o `OcVinculadaInfo` (+ nProdutos)", () => {
  it("PA: status/qtd/valores DO ITEM, nº e status do cabeçalho, nProdutos pela contagem; números coeridos", () => {
    const i = ocInfoDeItens([item()], "acabado")!;
    expect(i).toMatchObject({
      id: "oc1", numero: "BELDIV-00123", status: "encomendado", ocStatus: "encomendado", nProdutos: 3,
      qtd_total: 30, valor_unitario_real: 58.9, valor_unitario: 62, desconto_pct: 5,
    });
    expect(i.grade_detalhe["1"].P.recebida).toBe(4);
  });
  it("PI: o valor de compra do item é valor_unitario_m1", () => {
    expect(ocInfoDeItens([item()], "importado")!.valor_unitario).toBe(9.5);
  });
  it("status do ITEM e da OC são independentes (item recebido numa OC ainda encomendada)", () => {
    const i = ocInfoDeItens([item({ status: "recebido" })], "acabado")!;
    expect(i.status).toBe("recebido");
    expect(i.ocStatus).toBe("encomendado");
  });
  it("sem item / sem cabeçalho legível = sem OC; contagem ausente = 1 (o produto está na OC)", () => {
    expect(ocInfoDeItens([], "acabado")).toBeNull();
    expect(ocInfoDeItens(null, "acabado")).toBeNull();
    expect(ocInfoDeItens(undefined, "importado")).toBeNull();
    expect(ocInfoDeItens([item({ oc: null })], "acabado")).toBeNull();
    expect(ocInfoDeItens([item({ oc: { id: "o", numero: null, status: "recebido", itens: null } })], "acabado")).toMatchObject({ numero: null, nProdutos: 1, ocStatus: "recebido" });
    expect(ocInfoDeItens([item({ oc: { id: "o", numero: "X", status: "encomendado", itens: [{ count: "2" }] } })], "acabado")!.nProdutos).toBe(2);
  });
  it("aceita o objeto único (to-one) além da lista", () => {
    expect(ocInfoDeItens(item(), "acabado")!.id).toBe("oc1");
  });
});

describe("textos do mockup aprovado", () => {
  it("chip: OC com vários produtos e OC de 1 produto", () => {
    expect(textoChipOc("BELDIV-00123", 3)).toBe("Na OC BELDIV-00123 (com 3 produtos)");
    expect(textoChipOc("BELDIV-00123", 2)).toBe("Na OC BELDIV-00123 (com 2 produtos)");
    expect(textoChipOc("BELDIV-00123", 1)).toBe("Na OC BELDIV-00123 (1 produto)");
    expect(textoChipOc(null, 1)).toBe("Na OC — (1 produto)");
  });
  it("divide a OC com N: singular/plural; OC de 1 produto = sem texto", () => {
    expect(textoDivideOc(3)).toBe("Este produto divide a OC com 2 outros.");
    expect(textoDivideOc(2)).toBe("Este produto divide a OC com 1 outro.");
    expect(textoDivideOc(1)).toBeNull();
  });
  it("textos fixos", () => {
    expect(TEXTO_IDENTIDADE_TRAVADA).toBe("Identidade travada enquanto estiver na OC.");
    expect(TEXTO_TIRAR_DA_OC).toBe("Para tirar da OC, abra a OC (só enquanto encomendada e se ainda não recebido).");
    expect(TEXTO_ABRA_A_OC).toBe("Abra a OC para tirar o produto.");
  });
});

describe("desvincular — só OC de 1 produto", () => {
  it("1 produto pode; 2+ não", () => {
    expect(podeDesvincularDireto(1)).toBe(true);
    expect(podeDesvincularDireto(2)).toBe(false);
    expect(podeDesvincularDireto(5)).toBe(false);
  });
});

const oc = (id: string, over: Partial<OcCandidata> = {}): OcCandidata => ({
  id, numero: `N-${id}`, status: "encomendado", empresa_id: "f1", moeda_compra: "RMB", moeda_intermediaria: "USD", itens: [{ produto_acabado_id: "outro" }], ...over,
});

describe("ocsParaVincular — quem aparece no 'Vincular OC existente'", () => {
  it("PA: só ENCOMENDADAS do MESMO fornecedor", () => {
    const lista = [
      oc("a"),
      oc("b", { status: "recebido" }),
      oc("c", { empresa_id: "f2" }),
      oc("d", { empresa_id: null }),
    ];
    expect(ocsParaVincular(lista, { id: "p1", empresaId: "f1" }, "acabado").map((o) => o.id)).toEqual(["a"]);
  });
  it("PA: produto sem fornecedor = nenhuma", () => {
    expect(ocsParaVincular([oc("a")], { id: "p1", empresaId: null }, "acabado")).toEqual([]);
  });
  it("PA: OC que já tem o produto não entra", () => {
    expect(ocsParaVincular([oc("a", { itens: [{ produto_acabado_id: "p1" }] })], { id: "p1", empresaId: "f1" }, "acabado")).toEqual([]);
  });
  it("PI: além do fornecedor, a MESMA moeda (compra e intermediária); vazio = RMB / sem intermediária, como o servidor", () => {
    const lista = [
      oc("a"),
      oc("b", { moeda_compra: "USD" }),
      oc("c", { moeda_intermediaria: "EUR" }),
      oc("d", { moeda_intermediaria: null }),
      oc("e", { moeda_compra: null }),
    ];
    const p = { id: "i1", empresaId: "f1", moedaCompra: "RMB", moedaIntermediaria: "USD" };
    expect(ocsParaVincular(lista, p, "importado").map((o) => o.id)).toEqual(["a", "e"]);
    // intermediária vazia ("" ou null) = cadeia direta
    expect(ocsParaVincular(lista, { ...p, moedaIntermediaria: "" }, "importado").map((o) => o.id)).toEqual(["d"]);
    // produto sem moeda de compra = RMB
    expect(ocsParaVincular(lista, { ...p, moedaCompra: null }, "importado").map((o) => o.id)).toEqual(["a", "e"]);
  });
  it("PI: a coluna do item é produto_importado_id", () => {
    const l = [oc("a", { itens: [{ produto_importado_id: "i1" }] }), oc("b", { itens: [{ produto_importado_id: "outro" }] })];
    expect(ocsParaVincular(l, { id: "i1", empresaId: "f1", moedaCompra: "RMB", moedaIntermediaria: "USD" }, "importado").map((o) => o.id)).toEqual(["b"]);
  });
});

describe("nomeDoFornecedor — o rótulo do FornecedorSelect", () => {
  const empresas = [{ id: "f1", nome_fantasia: "Bella Malhas", representantes: [{ id: "r1", nome: "Rita" }, { id: "r2", nome: null }] }];
  it("empresa direto, via representante, sem nome do representante, inexistente", () => {
    expect(nomeDoFornecedor(empresas, "f1", null)).toEqual({ fornecedorNome: "Bella Malhas", empresaNome: "Bella Malhas" });
    expect(nomeDoFornecedor(empresas, "f1", "r1")).toEqual({ fornecedorNome: "Bella Malhas · Rita", empresaNome: "Bella Malhas" });
    expect(nomeDoFornecedor(empresas, "f1", "r2").fornecedorNome).toBe("Bella Malhas · —");
    expect(nomeDoFornecedor(empresas, "zz", null)).toEqual({ fornecedorNome: "", empresaNome: null });
    expect(nomeDoFornecedor(empresas, null, null)).toEqual({ fornecedorNome: "", empresaNome: null });
  });
});
