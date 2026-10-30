// [urg R13 T6] Os adaptadores do canvas para o assistente (`produtoPedidoAcabado` / `produtoPedidoImportado`): o rascunho VIVO do
// produto vira `ProdutoPedido` (elegibilidade, fornecedor, grupo/categoria, peças e a conta de valor do card). Puro, sem DOM.
import { describe, it, expect } from "vitest";
import { produtoPedidoAcabado, type ProdutoDraft } from "@/components/produto-acabado/shared";
import { emptyDraft, produtoPedidoImportado, custoDoDraft, type ProdutoImportadoDraft } from "@/components/produto-importado/shared";
import { agruparPorFornecedor, totaisDoLote, respostasIniciais, textoMotivos, TEXTO_CONFLITO_PEDIDO, montarPedidos } from "@/lib/pedido-oc-lote";
import { cadeiaValores } from "@/lib/produto-acabado";

const pa = (over: Partial<ProdutoDraft> = {}): ProdutoDraft => ({
  id: "p1", rev: 1, nome: "Blusa", ref: "BLU1", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  categoria_tecido_id: null, material_aviamento_id: null, colecao_id: "col1", subcolecao: "Verão", semana: null,
  empresa_id: "f1", representante_id: null, ref_fornecedor: "", composicao: "",
  grade_proporcao: { P: 1, M: 1 }, qtd_total: 10, valor_unitario: 20, desconto_pct: 10, insumos_total: 0,
  markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
  foto_url: null, modelo_id: null, mix_id: null, tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null, modeloThumbFontes: [null, null, null], oc: null,
  ...over,
});
const ctxPA = { grupoNome: "Feminino", categoriaNome: "Blusa", fornecedorNome: "Bella Malhas", empresaNome: "Bella Malhas", cores: ["Azul"], sujo: false, conflitoDoProduto: false };

describe("produtoPedidoAcabado", () => {
  it("elegível: valor = a conta do card (cadeiaValores), peças = Σ variantes, fornecedor/grupo/categoria/cores do contexto", () => {
    const p = produtoPedidoAcabado(pa(), ctxPA);
    expect(p).toMatchObject({
      id: "p1", nome: "Blusa", ref: "BLU1", fornecedorNome: "Bella Malhas", empresaNome: "Bella Malhas", empresaId: "f1", representanteId: null,
      grupoNome: "Feminino", categoriaNome: "Blusa", grupoId: "g1", categoriaId: "c1", cores: ["Azul"], pecas: 10, valorUnitario: 20, descontoPct: 10, sujo: false,
    });
    expect(cadeiaValores(p.pecas, p.valorUnitario, p.descontoPct).totalDesc).toBe(180);
    expect(textoMotivos(agruparPorFornecedor([p], "acabado").bloqueados.flatMap((b) => b.motivos))).toBe("");
    const g = agruparPorFornecedor([p], "acabado");
    expect(g.grupos).toHaveLength(1);
    expect(totaisDoLote(g.grupos, respostasIniciais(g.grupos, "2026-10-06"), "acabado", true)).toMatchObject({ ocs: 1, produtos: 1, pecas: 10, total: 180 });
  });
  it("já tem OC / sem fornecedor / sem valor / soma não bate / grade vazia: cada um com o motivo em PT", () => {
    const txt = (d: ProdutoDraft) => {
      const g = agruparPorFornecedor([produtoPedidoAcabado(d, ctxPA)], "acabado");
      return [g.bloqueados.map((b) => textoMotivos(b.motivos)).join(" "), g.semFornecedor.length ? "SEM_FORN" : ""].join("|");
    };
    expect(txt(pa({ oc: { id: "o", numero: "BEL-1", status: "encomendado", qtd_total: 10, valor_unitario_real: 18, grade_detalhe: {}, valor_unitario: 20, desconto_pct: 10 } }))).toContain("Já tem a OC BEL-1 vinculada.");
    expect(txt(pa({ empresa_id: null }))).toBe("|SEM_FORN");
    expect(txt(pa({ valor_unitario: 0 }))).toContain("Falta o valor unitário.");
    expect(txt(pa({ qtd_total: 12 }))).toContain("A soma das variantes (10) não bate com a Qtd total (12).");
    expect(txt(pa({ grade_proporcao: {} }))).toContain("Falta a proporção de grade (tamanhos).");
  });
  it("acessório não precisa de grade de tamanhos", () => {
    const p = produtoPedidoAcabado(pa({ grade_proporcao: {} }), { ...ctxPA, grupoNome: "Acessórios" });
    expect(agruparPorFornecedor([p], "acabado").grupos).toHaveLength(1);
  });
  it("conflito: o da coleção barra todos (contexto), o do produto muda o texto", () => {
    const p = produtoPedidoAcabado(pa(), ctxPA);
    expect(textoMotivos(agruparPorFornecedor([p], "acabado", { conflitoPendente: true }).bloqueados[0].motivos)).toBe(TEXTO_CONFLITO_PEDIDO);
    const q = produtoPedidoAcabado(pa(), { ...ctxPA, conflitoDoProduto: true });
    expect(textoMotivos(agruparPorFornecedor([q], "acabado").bloqueados[0].motivos)).toMatch(/Este produto tem conflito/);
  });
  it("produto sem nome aparece como 'Produto sem nome' + motivo; 'sujo' é repassado (salvo antes do pedido)", () => {
    const p = produtoPedidoAcabado(pa({ nome: "  " }), { ...ctxPA, sujo: true });
    expect(p.nome).toBe("Produto sem nome");
    expect(p.sujo).toBe(true);
    expect(agruparPorFornecedor([p], "acabado").bloqueados[0].motivos.map((m) => m.codigo)).toContain("sem_nome");
  });
  it("2 produtos do mesmo fornecedor = 1 OC; fornecedores diferentes = 2; o `_pedidos` leva só ids e cabeçalho", () => {
    const a = produtoPedidoAcabado(pa({ id: "a" }), ctxPA);
    const b = produtoPedidoAcabado(pa({ id: "b" }), ctxPA);
    const c = produtoPedidoAcabado(pa({ id: "c", empresa_id: "f2" }), { ...ctxPA, fornecedorNome: "Aurora", empresaNome: "Aurora" });
    const g = agruparPorFornecedor([a, b, c], "acabado");
    expect(g.grupos.map((x) => x.produtos.map((p) => p.id))).toEqual([["a", "b"], ["c"]]);
    const resp = respostasIniciais(g.grupos, "2026-10-06").map((r) => ({ ...r, cabecalho: { ...r.cabecalho, dataPrevista: "2026-11-01", prazo: "30/60" } }));
    const ped = montarPedidos(g.grupos, resp, "acabado");
    expect(ped).toHaveLength(2);
    expect(ped[0]).toEqual({ empresa_id: "f1", representante_id: null, data_pedido: "2026-10-06", data_prevista: "2026-11-01", prazo_pagamento: "30/60", produto_ids: ["a", "b"] });
  });
});

const pi = (over: Partial<ProdutoImportadoDraft> = {}): ProdutoImportadoDraft => ({
  ...emptyDraft("col1", "sub1"), id: "i1", rev: 1, nome: "Casaco", grupo_id: "g1", categoria_id: "c1", empresa_id: "f1", qtd_total: 5,
  valor_unitario_m1: 9, cotacao_ref: 0.14, cotacao_final: 5.5, grade_proporcao: { P: 1 }, moeda_compra: "RMB", moeda_intermediaria: "USD",
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 5, _touched: false }],
  etapas: [
    { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: null, cotacao: 0.14 },
    { ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: null, cotacao: 0.14 },
    { ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, data_vencimento: null, cotacao: 1 },
  ],
  ...over,
});
const ctxPI = { grupoNome: "Casacos", categoriaNome: "Jaqueta", fornecedorNome: "Yiwu", empresaNome: "Yiwu", cores: ["Azul"], sujo: false, conflitoDoProduto: false };

describe("produtoPedidoImportado", () => {
  it("valor = 'Valor bruto (BRL)' do card; peças = Qtd total; moeda do produto", () => {
    const d = pi();
    const p = produtoPedidoImportado(d, ctxPI);
    expect(p).toMatchObject({ id: "i1", pecas: 5, valorUnitario: 9, descontoPct: 0, moedaCompra: "RMB", moedaIntermediaria: "USD", grupoNome: "Casacos" });
    expect(custoDoDraft(d).totalBrl).toBeGreaterThan(0);
    expect(agruparPorFornecedor([p], "importado").grupos).toHaveLength(1);
  });
  it("agrupa por fornecedor E moeda: mesma empresa com moedas diferentes = OCs separadas (P-363)", () => {
    const a = produtoPedidoImportado(pi({ id: "a" }), ctxPI);
    const b = produtoPedidoImportado(pi({ id: "b" }), ctxPI);
    const c = produtoPedidoImportado(pi({ id: "c", moeda_compra: "USD", moeda_intermediaria: null }), ctxPI);
    const g = agruparPorFornecedor([a, b, c], "importado");
    expect(g.grupos.map((x) => x.produtos.map((p) => p.id))).toEqual([["a", "b"], ["c"]]);
    const resp = respostasIniciais(g.grupos, "2026-10-06").map((r) => ({ ...r, cabecalho: { ...r.cabecalho, dataPrevista: "2026-11-01" } }));
    expect(montarPedidos(g.grupos, resp, "importado").map((x) => [x.moeda_compra, x.moeda_intermediaria])).toEqual([["RMB", "USD"], ["USD", null]]);
  });
  it("moeda vazia = RMB; intermediária vazia/'' = cadeia direta (null) — como o servidor agrupa", () => {
    const p = produtoPedidoImportado(pi({ moeda_compra: "", moeda_intermediaria: "" }), ctxPI);
    expect(p.moedaCompra).toBe("RMB");
    expect(p.moedaIntermediaria).toBeNull();
  });
  it("a recusa do card (Σ% das etapas) entra como motivo próprio da família; sem nome só 'Falta o nome'", () => {
    const ruim = produtoPedidoImportado(pi({ etapas: [{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 50, data_vencimento: null, cotacao: 0.14 }] }), ctxPI);
    expect(agruparPorFornecedor([ruim], "importado").bloqueados[0].motivos.map((m) => m.codigo)).toContain("validacao");
    const semNome = produtoPedidoImportado(pi({ nome: "" }), ctxPI);
    expect(agruparPorFornecedor([semNome], "importado").bloqueados[0].motivos.map((m) => m.codigo)).toEqual(["sem_nome"]);
  });
  it("já tem OC / sem fornecedor / soma não bate", () => {
    const comOc = produtoPedidoImportado(pi({ oc: { id: "o", numero: "CAS-9", status: "encomendado", nProdutos: 2 } }), ctxPI);
    expect(textoMotivos(agruparPorFornecedor([comOc], "importado").bloqueados[0].motivos)).toBe("Já tem a OC CAS-9 vinculada.");
    expect(agruparPorFornecedor([produtoPedidoImportado(pi({ empresa_id: null }), ctxPI)], "importado").semFornecedor).toHaveLength(1);
    expect(textoMotivos(agruparPorFornecedor([produtoPedidoImportado(pi({ qtd_total: 7 }), ctxPI)], "importado").bloqueados[0].motivos)).toContain("A soma das variantes (5)");
  });
  it("rascunho local sem id fica com id vazio (o Sheet o trata como sujo e salva antes)", () => {
    expect(produtoPedidoImportado(pi({ id: null }), ctxPI).id).toBe("");
  });
});
