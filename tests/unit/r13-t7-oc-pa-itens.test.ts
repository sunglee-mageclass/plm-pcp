// [urg R13 T7] O ITEM da OC de Produto Acabado — payloads (contrato das RPCs T2), totais, rastreio do que EU editei e regras de tela.
import { describe, it, expect } from "vitest";
import {
  cabecalhoParaPayload, celulasTocadas, dadosDoRecebimento, erroDeItensParaSalvar, idsTocados, itemAvulsoVazio, itemDeRow, itemDoProduto,
  itemParaPayload, itensDeRows, itensParaPayload, linhaDeItem, motivoNaoReceber, somaGradeItem, totaisDaOc, totaisDoItem, pathCelulaItem,
  type ItemOcPa,
} from "@/components/oc-p-acabado/itens";
import { emptyCabecalho } from "@/components/oc-p-acabado/shared";

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1", ordem: 1, produto_acabado_id: "p1", nome_produto: "Vestido Midi", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  ref_fornecedor: "RF1", composicao: "100% viscose", grade_proporcao: { "36|PP": 1, "38|P": 1 },
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  qtd_total: 10, valor_unitario: "62.00", desconto_pct: "5",
  grade_detalhe: { "1": { "36|PP": { pedida: 5, recebida: 0, defeito: 0 }, "38|P": { pedida: 5, recebida: 0, defeito: 0 } } },
  status: "encomendado", data_entrega: null, nota_fiscal: null, responsavel_recebimento_id: null, devolucao: null, revisao: null,
  produto: { ref: "FEVMI10000231", modelo: { fotos_modelo: ["a.jpg"] } },
  ...over,
});
const item = (over: Partial<ItemOcPa> = {}): ItemOcPa => ({ ...itemDeRow(row()), ...over });

describe("itemDeRow / itensDeRows", () => {
  it("normaliza numéricos, nulos viram '' e o embed do produto vira REF/foto", () => {
    const i = itemDeRow(row());
    expect(i).toMatchObject({ id: "i1", tempId: "i1", doProduto: false, valor_unitario: 62, desconto_pct: 5, nota_fiscal: "", data_entrega: "", status: "encomendado", produtoRef: "FEVMI10000231", fotoPath: "a.jpg" });
    expect(i.variantes).toEqual([{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }]);
  });
  it("na ordem da OC (coluna ordem), não na do banco", () => {
    expect(itensDeRows([row({ id: "b", ordem: 2 }), row({ id: "a", ordem: 1 })]).map((i) => i.id)).toEqual(["a", "b"]);
    expect(itensDeRows(null)).toEqual([]);
  });
});

describe("payloads — o contrato de salvar_oc_p_acabado_itens", () => {
  it("item PENDENTE do picker: SÓ {produto_acabado_id, do_produto:true} (o servidor monta do produto salvo)", () => {
    const p = itemDoProduto({
      id: "px", nome: "Short", ref: "R1", grupo_id: "g", categoria_id: "c", subcategoria1_id: null, subcategoria2_id: null, empresa_id: "e1", representante_id: null,
      ref_fornecedor: null, composicao: null, grade_proporcao: { P: 1 }, qtd_total: 30, valor_unitario: 40, desconto_pct: 0, variantes: [], fotoPath: null,
    });
    expect(p.doProduto).toBe(true);
    expect(p.id).toBeNull();
    expect(itemParaPayload(p)).toEqual({ produto_acabado_id: "px", do_produto: true });
    expect(totaisDoItem(p).total).toBe(1200); // a tela mostra o que o servidor vai montar
  });
  it("item salvo: manda o id (diff por id), os campos de compra e a grade INTEIRA; NÃO manda status nem recebimento", () => {
    const pl = itemParaPayload(item());
    expect(pl).toMatchObject({ id: "i1", produto_acabado_id: "p1", nome_produto: "Vestido Midi", qtd_total: 10, valor_unitario: 62, desconto_pct: 5, ref_fornecedor: "RF1" });
    expect(Object.keys(pl)).toEqual(expect.arrayContaining(["grade_detalhe", "variantes", "grade_proporcao"]));
    for (const k of ["status", "data_entrega", "nota_fiscal", "responsavel_recebimento_id", "devolucao", "revisao", "do_produto", "tempId"]) expect(pl).not.toHaveProperty(k);
  });
  it("item avulso novo: sem id; texto vazio vira null", () => {
    const a = { ...itemAvulsoVazio(), nome_produto: "Cinto", ref_fornecedor: "", composicao: "" };
    const pl = itemParaPayload(a);
    expect(pl).not.toHaveProperty("id");
    expect(pl).not.toHaveProperty("do_produto");
    expect(pl).toMatchObject({ nome_produto: "Cinto", ref_fornecedor: null, composicao: null });
  });
  it("lista de itens = estado COMPLETO na ordem da tela (item ausente = tirado)", () => {
    expect(itensParaPayload([item({ id: "a", tempId: "a" }), item({ id: "b", tempId: "b" })]).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("cabeçalho: sem produto, sem nº da OC; data da nota vai SEMPRE ('' limpa)", () => {
    const c = { ...emptyCabecalho(), empresa_id: "e1", data_pedido: "2026-10-01", prazo_pagamento: "30/60", parcelas_entrega: 2, data_nota_entrada: "" };
    const pl = cabecalhoParaPayload(c);
    expect(pl).toEqual({ empresa_id: "e1", representante_id: null, data_pedido: "2026-10-01", data_prevista: null, prazo_pagamento: "30/60", parcelas_entrega: 2, data_nota_entrada: null, anexo_pedido_url: null });
    expect(pl).not.toHaveProperty("numero");
    expect(pl).not.toHaveProperty("nome_produto");
    expect(cabecalhoParaPayload({ ...c, data_nota_entrada: "2026-10-05" }).data_nota_entrada).toBe("2026-10-05");
  });
  it("receber: cabeçalho + chaves item_* (as que a RPC lê)", () => {
    const d = dadosDoRecebimento(emptyCabecalho(), item({ data_entrega: "2026-10-05", nota_fiscal: "4512", responsavel_recebimento_id: "u1", devolucao: "", revisao: "ok" }));
    expect(d).toMatchObject({ item_data_entrega: "2026-10-05", item_nota_fiscal: "4512", item_responsavel_recebimento_id: "u1", item_devolucao: null, item_revisao: "ok" });
    expect(d).toHaveProperty("prazo_pagamento");
  });
});

describe("totais (a conta do servidor: cadeiaValores)", () => {
  it("item e OC", () => {
    expect(totaisDoItem({ qtd_total: 10, valor_unitario: 62, desconto_pct: 5 })).toEqual({ pecas: 10, bruto: 620, desconto: 31, total: 589, unitReal: 58.9 });
    const t = totaisDaOc([{ qtd_total: 10, valor_unitario: 62, desconto_pct: 5 }, { qtd_total: 30, valor_unitario: 40, desconto_pct: 0 }]);
    expect(t).toEqual({ pecas: 40, bruto: 1820, desconto: 31, total: 1789 });
  });
});

describe("rastreio do que EU editei", () => {
  const a = item();
  it("célula de grade editada → path item:<id>:grade:<ordem>:<tam>:<campo>", () => {
    const b = { ...a, grade: { "1": { ...a.grade["1"], "36|PP": { pedida: 5, recebida: 3, defeito: 0 } } } };
    expect(celulasTocadas([a], [b])).toEqual([pathCelulaItem("i1", "1", "36|PP", "recebida")]);
    expect(celulasTocadas([a], [a])).toEqual([]);
  });
  it("item novo (sem id) não gera path de grade", () => {
    expect(celulasTocadas([a], [a, { ...itemAvulsoVazio(), grade: { "1": { P: { pedida: 1, recebida: 0, defeito: 0 } } } }])).toEqual([]);
  });
  it("linha editada e linha REMOVIDA entram em idsTocados; mexer só na grade NÃO marca a linha", () => {
    const b = item({ id: "i2", tempId: "i2" });
    expect(idsTocados([a, b], [{ ...a, valor_unitario: 70 }, b])).toEqual(["i1"]);
    expect(idsTocados([a, b], [a])).toEqual(["i2"]);
    expect(idsTocados([a], [{ ...a, grade: { "1": { "36|PP": { pedida: 9, recebida: 0, defeito: 0 } } } }])).toEqual([]);
  });
  it("a linha do merge não leva grade nem status", () => {
    const l = linhaDeItem(a);
    expect(l).not.toHaveProperty("grade");
    expect(l).not.toHaveProperty("status");
    expect(l.id).toBe("i1");
  });
});

describe("regras de tela", () => {
  it("salvar: ao menos 1 produto; avulso precisa de nome", () => {
    expect(erroDeItensParaSalvar([])).toBe("Adicione ao menos um produto à OC.");
    expect(erroDeItensParaSalvar([{ ...itemAvulsoVazio() }])).toBe("Informe o nome do produto.");
    expect(erroDeItensParaSalvar([item(), { ...itemAvulsoVazio() }])).toBe("Informe o nome do produto 2.");
    expect(erroDeItensParaSalvar([item()])).toBeNull();
    expect(erroDeItensParaSalvar([{ ...itemAvulsoVazio(), doProduto: true, produto_acabado_id: "px" }])).toBeNull(); // pendente do picker não precisa de nome
  });
  const tams = ["36|PP", "38|P"];
  const comRecebida = { "1": { "36|PP": { pedida: 5, recebida: 5, defeito: 0 }, "38|P": { pedida: 5, recebida: 4, defeito: 1 } } };
  it("receber: motivos na ordem", () => {
    expect(motivoNaoReceber(item({ status: "recebido" }), tams)).toBe("Este produto já foi recebido.");
    expect(motivoNaoReceber(item({ id: null }), tams)).toMatch(/Salve a OC/);
    expect(motivoNaoReceber(item({ produto_acabado_id: null }), tams)).toMatch(/não está ligado a um produto/);
    expect(motivoNaoReceber(item({ grade: comRecebida }), tams)).toBe("Preencha a data de entrega para marcar.");
    expect(motivoNaoReceber(item({ data_entrega: "2026-10-05" }), tams)).toBe("Preencha a grade recebida para marcar.");
    expect(motivoNaoReceber(item({ data_entrega: "2026-10-05", grade: comRecebida }), tams)).toBeNull();
  });
  it("Σ da grade respeita as colunas de tamanho da loja", () => {
    expect(somaGradeItem(comRecebida, tams, "recebida")).toBe(9);
    expect(somaGradeItem(comRecebida, ["36|PP"], "recebida")).toBe(5);
  });
});
