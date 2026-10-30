// [urg R13 T8] O ITEM da OC de Produto Importado — payloads (contrato das RPCs T3), totais em M1, landed SÓ LEITURA, rastreio do que EU
// editei, regras de tela, o picker (moeda) e o construtor do documento imprimível.
import { describe, it, expect } from "vitest";
import {
  cabecalhoParaPayload, celulasTocadas, dadosDoRecebimento, erroDeItensParaSalvar, etapasParaPayload, idsTocados, itemAvulsoVazio, itemDeRow,
  itemDoProduto, itemParaPayload, itensDeRows, itensParaPayload, linhaDeItem, motivoNaoReceber, pathCelulaItem, somaGradeItem, totaisDaOc,
  totaisDoItem, valorM1DaCompra, type ItemOcImp,
} from "@/components/oc-p-importado/itens";
import { emptyCabecalho, type EtapaDraft } from "@/components/oc-p-importado/shared";
import { mesmaMoeda, motivosDoProdutoNaOc } from "@/components/oc-p-importado/ProdutoImportadoPicker";
import { montarDocModeloOcImp } from "@/components/oc-p-importado/doc-modelo";
import { etapasDeRows } from "@/components/oc-p-importado/queries";

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1", ordem: 1, produto_importado_id: "p1", nome_produto: "Vestido Midi", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  ref_fornecedor: "RF1", composicao: "100% viscose", grade_proporcao: { "36|PP": 1, "38|P": 1 },
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  qtd_total: 10, valor_unitario_m1: "62.5000", peso_kg: "0.4000", transporte_m2: "12.0000", desconto_pct: "5",
  custo_unitario_landed_real: "123.4567",
  grade_detalhe: { "1": { "36|PP": { pedida: 5, recebida: 0, defeito: 0 }, "38|P": { pedida: 5, recebida: 0, defeito: 0 } } },
  status: "encomendado", data_entrega: null, nota_fiscal: null, responsavel_recebimento_id: null, devolucao: null, revisao: null,
  produto: { ref: "IMVMI10000231", foto_url: "a.jpg" },
  ...over,
});
const item = (over: Partial<ItemOcImp> = {}): ItemOcImp => ({ ...itemDeRow(row()), ...over });

describe("itemDeRow / itensDeRows", () => {
  it("normaliza numéricos (M1/peso/transporte/landed), nulos viram '' e o embed do produto vira REF/foto", () => {
    const i = itemDeRow(row());
    expect(i).toMatchObject({
      id: "i1", tempId: "i1", doProduto: false, valor_unitario_m1: 62.5, peso_kg: 0.4, transporte_m2: 12, desconto_pct: 5,
      custo_unitario_landed_real: 123.4567, nota_fiscal: "", data_entrega: "", status: "encomendado", produtoRef: "IMVMI10000231", fotoPath: "a.jpg",
    });
  });
  it("na ordem da OC (coluna ordem), não na do banco", () => {
    expect(itensDeRows([row({ id: "b", ordem: 2 }), row({ id: "a", ordem: 1 })]).map((i) => i.id)).toEqual(["a", "b"]);
    expect(itensDeRows(null)).toEqual([]);
  });
  it("etapas do embed: ordenadas, numéricas, rótulo nulo vira ''", () => {
    const e = etapasDeRows([
      { ordem: 2, rotulo: null, base: "frete", percentual: "100", data_vencimento: null, cotacao: "1" },
      { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: "30.5", data_vencimento: "2026-11-01", cotacao: "5.2" },
    ]);
    expect(e.map((x) => x.ordem)).toEqual([1, 2]);
    expect(e[0]).toEqual({ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30.5, data_vencimento: "2026-11-01", cotacao: 5.2 });
    expect(e[1].rotulo).toBe("");
  });
});

describe("payloads — o contrato de salvar_oc_importado_itens", () => {
  const prod = {
    id: "px", nome: "Short", ref: "R1", grupo_id: "g", categoria_id: "c", subcategoria1_id: null, subcategoria2_id: null, empresa_id: "e1", representante_id: null,
    ref_fornecedor: null, composicao: null, grade_proporcao: { P: 1 }, qtd_total: 30, moeda_compra: "RMB", moeda_intermediaria: "USD",
    valor_unitario_m1: 40, cotacao_ref: 5, peso_kg: 0.3, transporte_m2: 10, desconto_pct: 0, cotacao_final: 5.5, variantes: [], etapas: [], fotoPath: null,
  };
  it("item PENDENTE do picker: SÓ {produto_importado_id, do_produto:true} (o servidor monta do produto salvo)", () => {
    const p = itemDoProduto(prod);
    expect(p.doProduto).toBe(true);
    expect(p.id).toBeNull();
    expect(itemParaPayload(p)).toEqual({ produto_importado_id: "px", do_produto: true });
    expect(totaisDoItem(p).total).toBe(1200); // a tela mostra o que o servidor vai montar
    expect(p.custo_unitario_landed_real).toBe(0); // landed só existe depois de salvo
  });
  it("item salvo: manda id, compra (M1, peso, transporte, desconto) e a grade INTEIRA; NUNCA status, landed nem recebimento", () => {
    const pl = itemParaPayload(item());
    expect(pl).toMatchObject({ id: "i1", produto_importado_id: "p1", nome_produto: "Vestido Midi", qtd_total: 10, valor_unitario_m1: 62.5, peso_kg: 0.4, transporte_m2: 12, desconto_pct: 5, ref_fornecedor: "RF1" });
    expect(Object.keys(pl)).toEqual(expect.arrayContaining(["grade_detalhe", "variantes", "grade_proporcao"]));
    for (const k of ["status", "custo_unitario_landed_real", "data_entrega", "nota_fiscal", "responsavel_recebimento_id", "devolucao", "revisao", "do_produto", "tempId", "valor_unitario"]) {
      expect(pl).not.toHaveProperty(k);
    }
  });
  it("item avulso novo: sem id; texto vazio vira null", () => {
    const pl = itemParaPayload({ ...itemAvulsoVazio(), nome_produto: "Cinto" });
    expect(pl).not.toHaveProperty("id");
    expect(pl).not.toHaveProperty("do_produto");
    expect(pl).toMatchObject({ nome_produto: "Cinto", ref_fornecedor: null, composicao: null, valor_unitario_m1: 0, peso_kg: 0, transporte_m2: 0 });
  });
  it("lista de itens = estado COMPLETO na ordem da tela (item ausente = tirado)", () => {
    expect(itensParaPayload([item({ id: "a", tempId: "a" }), item({ id: "b", tempId: "b" })]).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("cabeçalho: moeda e cotações SEMPRE vão; sem produto; o nº da OC (editável, P-382) vai SEMPRE, aparado ('' = o servidor gera/mantém); data da nota vai sempre ('' limpa)", () => {
    const c = { ...emptyCabecalho(), empresa_id: "e1", data_pedido: "2026-10-01", moeda_compra: "RMB", moeda_intermediaria: null, cotacao_ref: 5, cotacao_final: 5.5 };
    const pl = cabecalhoParaPayload(c);
    expect(pl).toEqual({
      numero: "", empresa_id: "e1", representante_id: null, data_pedido: "2026-10-01", data_prevista: null, moeda_compra: "RMB", moeda_intermediaria: null,
      cotacao_ref: 5, cotacao_final: 5.5, data_nota_entrada: null, anexo_pedido_url: null,
    });
    expect(cabecalhoParaPayload({ ...c, numero: "  SHEDIV-00123 " }).numero).toBe("SHEDIV-00123");
    expect(pl).not.toHaveProperty("etapas"); // o cronograma vai em `_etapas`, não em `_dados`
    expect(cabecalhoParaPayload({ ...c, data_nota_entrada: "2026-10-05" }).data_nota_entrada).toBe("2026-10-05");
  });
  it("etapas: estado COMPLETO, só os campos que a RPC lê", () => {
    const e: EtapaDraft[] = [{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: "2026-11-01", cotacao: 5 }, { ordem: 2, rotulo: "", base: "frete", percentual: 100, data_vencimento: null, cotacao: 1 }];
    expect(etapasParaPayload(e)).toEqual(e);
    expect(etapasParaPayload([])).toEqual([]);
  });
  it("receber: cabeçalho + chaves item_* (as que a RPC lê)", () => {
    const d = dadosDoRecebimento(emptyCabecalho(), item({ data_entrega: "2026-10-05", nota_fiscal: "4512", responsavel_recebimento_id: "u1", devolucao: "", revisao: "ok" }));
    expect(d).toMatchObject({ item_data_entrega: "2026-10-05", item_nota_fiscal: "4512", item_responsavel_recebimento_id: "u1", item_devolucao: null, item_revisao: "ok" });
    expect(d).toHaveProperty("moeda_compra");
  });
});

describe("totais em M1 (a conta do servidor: cadeiaValores) — o landed NÃO é conta da tela", () => {
  it("item e OC", () => {
    expect(totaisDoItem({ qtd_total: 10, valor_unitario_m1: 62, desconto_pct: 5 })).toEqual({ pecas: 10, bruto: 620, desconto: 31, total: 589, unitReal: 58.9 });
    const t = totaisDaOc([{ qtd_total: 10, valor_unitario_m1: 62, desconto_pct: 5 }, { qtd_total: 30, valor_unitario_m1: 40, desconto_pct: 0 }]);
    expect(t).toEqual({ pecas: 40, bruto: 1820, desconto: 31, total: 1789 });
  });
  it("'a compra tem valor' = algum produto com M1 > 0 (a mesma regra do servidor para a cotação das etapas)", () => {
    expect(valorM1DaCompra([{ valor_unitario_m1: 0 }, { valor_unitario_m1: 3 }])).toBe(3);
    expect(valorM1DaCompra([{ valor_unitario_m1: 0 }])).toBe(0);
    expect(valorM1DaCompra([])).toBe(0);
  });
  it("o landed do item entra como veio do servidor e não muda com a edição de valores", () => {
    const a = item();
    const b = { ...a, valor_unitario_m1: 99, peso_kg: 9 };
    expect(b.custo_unitario_landed_real).toBe(123.4567);
    expect(linhaDeItem(b)).not.toHaveProperty("custo_unitario_landed_real");
  });
});

describe("rastreio do que EU editei", () => {
  const a = item();
  it("célula de grade editada → path item:<id>:grade:<ordem>:<tam>:<campo>", () => {
    const b = { ...a, grade: { "1": { ...a.grade["1"], "36|PP": { pedida: 5, recebida: 3, defeito: 0 } } } };
    expect(celulasTocadas([a], [b])).toEqual([pathCelulaItem("i1", "1", "36|PP", "recebida")]);
    expect(celulasTocadas([a], [a])).toEqual([]);
  });
  it("linha editada (inclui peso e transporte) e linha REMOVIDA entram em idsTocados; mexer só na grade NÃO marca a linha", () => {
    const b = item({ id: "i2", tempId: "i2" });
    expect(idsTocados([a, b], [{ ...a, valor_unitario_m1: 70 }, b])).toEqual(["i1"]);
    expect(idsTocados([a, b], [{ ...a, peso_kg: 1 }, b])).toEqual(["i1"]);
    expect(idsTocados([a, b], [{ ...a, transporte_m2: 1 }, b])).toEqual(["i1"]);
    expect(idsTocados([a, b], [a])).toEqual(["i2"]);
    expect(idsTocados([a], [{ ...a, grade: { "1": { "36|PP": { pedida: 9, recebida: 0, defeito: 0 } } } }])).toEqual([]);
  });
  it("a linha do merge não leva grade, status nem landed", () => {
    const l = linhaDeItem(a);
    for (const k of ["grade", "status", "custo_unitario_landed_real", "doProduto"]) expect(l).not.toHaveProperty(k);
    expect(l.id).toBe("i1");
  });
});

describe("regras de tela", () => {
  it("salvar: ao menos 1 produto; avulso precisa de nome", () => {
    expect(erroDeItensParaSalvar([])).toBe("Adicione ao menos um produto à OC.");
    expect(erroDeItensParaSalvar([{ ...itemAvulsoVazio() }])).toBe("Informe o nome do produto.");
    expect(erroDeItensParaSalvar([item(), { ...itemAvulsoVazio() }])).toBe("Informe o nome do produto 2.");
    expect(erroDeItensParaSalvar([item()])).toBeNull();
    expect(erroDeItensParaSalvar([{ ...itemAvulsoVazio(), doProduto: true, produto_importado_id: "px" }])).toBeNull();
  });
  const tams = ["36|PP", "38|P"];
  const comRecebida = { "1": { "36|PP": { pedida: 5, recebida: 5, defeito: 0 }, "38|P": { pedida: 5, recebida: 4, defeito: 1 } } };
  it("receber: motivos na ordem", () => {
    expect(motivoNaoReceber(item({ status: "recebido" }), tams)).toBe("Este produto já foi recebido.");
    expect(motivoNaoReceber(item({ id: null }), tams)).toMatch(/Salve a OC/);
    expect(motivoNaoReceber(item({ produto_importado_id: null }), tams)).toMatch(/não está ligado a um produto/);
    expect(motivoNaoReceber(item({ grade: comRecebida }), tams)).toBe("Preencha a data de entrega para marcar.");
    expect(motivoNaoReceber(item({ data_entrega: "2026-10-05" }), tams)).toBe("Preencha a grade recebida para marcar.");
    expect(motivoNaoReceber(item({ data_entrega: "2026-10-05", grade: comRecebida }), tams)).toBeNull();
  });
  it("Σ da grade respeita as colunas de tamanho da loja", () => {
    expect(somaGradeItem(comRecebida, tams, "recebida")).toBe(9);
    expect(somaGradeItem(comRecebida, ["36|PP"], "recebida")).toBe(5);
  });
});

describe("picker — a MESMA MOEDA da OC e as recusas do produto", () => {
  const prod = {
    nome: "Short", empresa_id: "e1", valor_unitario_m1: 40, qtd_total: 30, grade_proporcao: { P: 1 }, grupoNome: "Feminino", temOc: false,
    variantes: [{ ordem: 1, cor_id: "a", cor_apelido_id: null, peso: 1, qtd: 30 }], etapas: [] as EtapaDraft[], moeda_compra: "RMB", moeda_intermediaria: "USD" as string | null,
  };
  it("mesmaMoeda: compra com default RMB, intermediária vazia = direta", () => {
    expect(mesmaMoeda({ moeda_compra: "RMB", moeda_intermediaria: "USD" }, { moeda_compra: "rmb", moeda_intermediaria: "usd" })).toBe(true);
    expect(mesmaMoeda({ moeda_compra: null, moeda_intermediaria: "" }, { moeda_compra: "RMB", moeda_intermediaria: null })).toBe(true);
    expect(mesmaMoeda({ moeda_compra: "RMB", moeda_intermediaria: "USD" }, { moeda_compra: "RMB", moeda_intermediaria: null })).toBe(false);
    expect(mesmaMoeda({ moeda_compra: "USD", moeda_intermediaria: null }, { moeda_compra: "RMB", moeda_intermediaria: null })).toBe(false);
  });
  it("produto elegível → sem motivo; sem OC de referência a moeda não restringe", () => {
    expect(motivosDoProdutoNaOc(prod)).toBe("");
    expect(motivosDoProdutoNaOc(prod, { moeda_compra: "RMB", moeda_intermediaria: "USD" })).toBe("");
  });
  it("moeda diferente da OC vira motivo em PT (o servidor recusaria moeda_diferente:)", () => {
    expect(motivosDoProdutoNaOc({ ...prod, moeda_compra: "USD", moeda_intermediaria: null }, { moeda_compra: "RMB", moeda_intermediaria: "USD" }))
      .toBe("Moeda diferente da OC (USD; a OC é RMB → USD).");
  });
  it("sem valor / já tem OC / Σ% das etapas / cotação das etapas: mesmos motivos do assistente", () => {
    expect(motivosDoProdutoNaOc({ ...prod, valor_unitario_m1: 0 })).toContain("Falta o valor unitário.");
    expect(motivosDoProdutoNaOc({ ...prod, temOc: true })).toContain("Já tem OC vinculada.");
    const merc = (p: number, cot: number): EtapaDraft => ({ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: p, data_vencimento: null, cotacao: cot });
    expect(motivosDoProdutoNaOc({ ...prod, etapas: [merc(60, 5)] })).toContain("Σ% das etapas de mercadoria (60%) precisa fechar 100%.");
    expect(motivosDoProdutoNaOc({ ...prod, etapas: [merc(100, 0)] })).toContain('Etapa "Sinal" de mercadoria (100%) está sem cotação');
    expect(motivosDoProdutoNaOc({ ...prod, etapas: [merc(100, 5)] })).toBe("");
  });
});

describe("documento imprimível (Pedido de Compra) — uma matriz por produto, valores na MOEDA DA COMPRA", () => {
  const cores: Record<string, string> = { azul: "Azul" };
  const doc = (landed: number | null) => montarDocModeloOcImp({
    numero: "BELDIV-00123",
    cabecalho: { data_pedido: "2026-10-02", data_prevista: "2026-10-20", moeda_compra: "RMB", moeda_intermediaria: "USD" },
    landedUnitarioOc: landed, empresaNome: "Bella", representanteNome: null,
    itens: [item({ id: "a", tempId: "a" }), item({ id: "b", tempId: "b", nome_produto: "Blusa Lia", valor_unitario_m1: 10, desconto_pct: 0 } as any)],
    tamanhos: ["36|PP", "38|P"], grupoNome: () => "Feminino", corNome: (id) => (id ? cores[id] ?? null : null), apelidoNome: () => null, emitidoEm: "30/10/2026",
  });
  it("2 produtos → 2 grades, valores em moeda de compra e o total do pedido", () => {
    const d = doc(null);
    expect(d.grades).toHaveLength(2);
    expect(d.grade).toBeUndefined();
    expect(d.grades![0].produtoTitulo).toBe("Produto: Vestido Midi (REF IMVMI10000231)");
    expect(d.grades![0].linhas[0]).toMatchObject({ cor: "Azul", total: 10 });
    expect(String(d.grades![0].valores![0].subtotal)).toContain("¥");
    expect(String(d.totalPrevisto)).toContain("¥");
    expect(d.familiaLabel).toBe("Produto Importado");
  });
  it("o landed só aparece quando o servidor já calculou (> 0) — a impressão nunca recalcula", () => {
    expect(doc(null).dados.map((x) => x.k)).not.toContain("Custo landed unit.");
    expect(doc(0).dados.map((x) => x.k)).not.toContain("Custo landed unit.");
    expect(doc(123.4567).dados.map((x) => x.k)).toContain("Custo landed unit.");
    expect(doc(null).dados.find((x) => x.k === "Moeda da compra")!.v).toBe("RMB → USD");
  });
});
