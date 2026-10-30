// [urg R13 T5] Lib pura do assistente "Fazer pedido" (1 OC por fornecedor, vários produtos).
import { describe, expect, it, vi } from "vitest";
import { contarParcelasPrazo } from "@/components/oc-p-acabado/shared";
import { previewNumeroOc } from "@/lib/produto-acabado";
import {
  agruparPorFornecedor, alternarProdutoNaOc, aplicarCabecalhoATodas, avancarHerdando, chavesCacheDoPedido, criarPedidosDoLote,
  errosDoLote, herdarCabecalho, montarPedidos, motivosForaDoPedido, ocEntra, parcelasDoPrazo, previewSiglaOcLote,
  produtosASalvar, respostasIniciais, SalvarProdutoError, TEXTO_DATA_PREVISTA_OBRIGATORIA, textoMotivos, textoOcsCriadas,
  totaisDaOc, totaisDoLote, totalDoProduto,
  type EntradaPedido, type FamiliaPedido, type OcCriadaLote, type ProdutoPedido,
} from "@/lib/pedido-oc-lote";

const HOJE = "2026-10-06";

const entradaOk = (o: Partial<EntradaPedido> = {}): EntradaPedido => ({
  temOc: false, nome: "Calça", empresaId: "e1", valorUnitario: 100, qtdTotal: 10, somaVariantes: 10, nVariantes: 2,
  precisaGrade: true, somaPesosGrade: 5, erroDaFamilia: null, conflitoDoProduto: false, ...o,
});

function produto(id: string, o: Partial<ProdutoPedido> & { entrada?: Partial<EntradaPedido> } = {}): ProdutoPedido {
  const { entrada, ...resto } = o;
  return {
    id, nome: `Produto ${id}`, ref: `REF${id}`, fornecedorNome: "Beleza Têxtil", empresaNome: "Beleza Têxtil",
    empresaId: "e1", representanteId: null, moedaCompra: null, moedaIntermediaria: null,
    grupoNome: "Vestuário", categoriaNome: "Calça", cores: ["Preto"], pecas: 10, valorUnitario: 100, descontoPct: 0,
    sujo: false, entrada: entradaOk({ nome: `Produto ${id}`, empresaId: resto.empresaId === undefined ? "e1" : resto.empresaId, ...entrada }),
    ...resto,
  };
}

describe("motivosForaDoPedido (espelho de _oc_produto_motivos)", () => {
  it("elegível = lista vazia", () => {
    expect(motivosForaDoPedido(entradaOk(), { conflitoPendente: false })).toEqual([]);
  });
  it("mesma ordem do servidor", () => {
    const m = motivosForaDoPedido(
      entradaOk({ temOc: true, ocNumero: "BELDIV-00001", nome: " ", empresaId: null, qtdTotal: 0, nVariantes: 0, somaPesosGrade: 0, valorUnitario: 0, erroDaFamilia: "x" }),
      { conflitoPendente: true },
    );
    expect(m.map((x) => x.codigo)).toEqual(["ja_tem_oc", "conflito", "sem_nome", "sem_fornecedor", "sem_quantidade", "sem_variantes", "grade_vazia", "sem_valor", "validacao"]);
    expect(m[0].texto).toBe("Já tem a OC BELDIV-00001 vinculada.");
  });
  it("soma das variantes diferente da quantidade; acessório não exige grade", () => {
    const m = motivosForaDoPedido(entradaOk({ somaVariantes: 8, precisaGrade: false, somaPesosGrade: 0 }), { conflitoPendente: false });
    expect(m).toHaveLength(1);
    expect(m[0].codigo).toBe("soma_nao_bate");
    expect(m[0].texto).toBe("A soma das variantes (8) não bate com a Qtd total (10).");
  });
});

describe("agruparPorFornecedor", () => {
  it("PA: chave = empresa|representante; mesma empresa com representantes diferentes = OCs separadas", () => {
    const r = agruparPorFornecedor([
      produto("1"), produto("2"), produto("3", { representanteId: "r1" }), produto("4", { empresaId: "e2", fornecedorNome: "Outra" }),
    ], "acabado");
    expect(r.grupos.map((g) => g.chave)).toEqual(["e1|", "e1|r1", "e2|"]);
    expect(r.grupos[0].produtos.map((p) => p.id)).toEqual(["1", "2"]);
  });
  it("PA ignora a moeda; PI separa por moeda_compra|moeda_intermediaria (P-363)", () => {
    const ps = [produto("1", { moedaCompra: "USD" }), produto("2", { moedaCompra: "EUR" }), produto("3", { moedaCompra: "USD", moedaIntermediaria: "CNY" })];
    expect(agruparPorFornecedor(ps, "acabado").grupos).toHaveLength(1);
    const pi = agruparPorFornecedor(ps, "importado");
    expect(pi.grupos.map((g) => g.chave)).toEqual(["e1||USD|", "e1||EUR|", "e1||USD|CNY"]);
    expect(pi.grupos[2].moedaIntermediaria).toBe("CNY");
  });
  it("sem fornecedor à parte; bloqueados com o motivo; quem tem OUTRO motivo + sem fornecedor vai para bloqueados", () => {
    const r = agruparPorFornecedor([
      produto("1"),
      produto("2", { empresaId: null, entrada: { empresaId: null } }),
      produto("3", { entrada: { temOc: true, ocNumero: "X-1" } }),
      produto("4", { empresaId: null, entrada: { empresaId: null, valorUnitario: 0 } }),
    ], "acabado");
    expect(r.grupos).toHaveLength(1);
    expect(r.semFornecedor.map((p) => p.id)).toEqual(["2"]);
    expect(r.bloqueados.map((b) => b.produto.id)).toEqual(["3", "4"]);
    expect(textoMotivos(r.bloqueados[0].motivos)).toBe("Já tem a OC X-1 vinculada.");
    expect(r.bloqueados[1].motivos.map((m) => m.codigo)).toEqual(["sem_fornecedor", "sem_valor"]);
  });
  it("conflito pendente na coleção bloqueia todos", () => {
    const r = agruparPorFornecedor([produto("1"), produto("2")], "acabado", { conflitoPendente: true });
    expect(r.grupos).toHaveLength(0);
    expect(r.bloqueados).toHaveLength(2);
  });
});

describe("previewSiglaOcLote (espelho de _oc_lote_sigla, P-361)", () => {
  const it1 = { grupoNome: "Vestuário", categoriaNome: "Calça" };
  it("1 item reproduz previewNumeroOc byte a byte", () => {
    expect(previewSiglaOcLote("Beleza", [it1])).toBe(previewNumeroOc("Beleza", "Vestuário", "Calça", false));
    expect(previewSiglaOcLote("Beleza", [it1])).toBe("BELVCA");
    const ac = { grupoNome: "Acessórios", categoriaNome: "Cinto" };
    expect(previewSiglaOcLote("Beleza", [ac])).toBe(previewNumeroOc("Beleza", "Acessórios", "Cinto", true));
  });
  it("todos iguais = G1+C2; acessórios = ACE; resto = DIV", () => {
    expect(previewSiglaOcLote("Beleza", [it1, it1])).toBe("BELVCA");
    expect(previewSiglaOcLote("Beleza", [{ grupoNome: "Acessórios", categoriaNome: "Cinto" }, { grupoNome: "Acessórios", categoriaNome: "Bolsa" }])).toBe("BELACE");
    expect(previewSiglaOcLote("Beleza", [it1, { grupoNome: "Vestuário", categoriaNome: "Saia" }])).toBe("BELDIV");
    expect(previewSiglaOcLote("Beleza", [it1, { grupoNome: "Acessórios", categoriaNome: "Cinto" }])).toBe("BELDIV");
  });
  it("fornecedor sem letras = FOR; nome normalizado como o servidor (3 letras, sem acento)", () => {
    expect(previewSiglaOcLote("", [it1])).toBe("FORVCA");
    expect(previewSiglaOcLote("12 --", [it1, { grupoNome: "X", categoriaNome: "Y" }])).toBe("FORDIV");
    expect(previewSiglaOcLote("Ágata Moda", [it1])).toBe("AGAVCA");
  });
  it("compara por id quando o adaptador os tem", () => {
    const a = { grupoNome: "Vestuário", categoriaNome: "Calça", grupoId: "g1", categoriaId: "c1" };
    const b = { grupoNome: "Vestuário", categoriaNome: "Calça", grupoId: "g1", categoriaId: "c2" };
    expect(previewSiglaOcLote("Beleza", [a, a])).toBe("BELVCA");
    expect(previewSiglaOcLote("Beleza", [a, b])).toBe("BELDIV");
  });
});

describe("herança do cabeçalho entre as páginas", () => {
  const grupos = agruparPorFornecedor([produto("1"), produto("2", { empresaId: "e2" }), produto("3", { empresaId: "e3" })], "acabado").grupos;
  it("respostas iniciais: OC incluída, data do pedido = hoje, data prevista vazia", () => {
    const r = respostasIniciais(grupos, HOJE);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ incluida: true, cabecalho: { dataPedido: HOJE, dataPrevista: "", prazo: "" } });
  });
  it("Próxima herda só o que está vazio na seguinte", () => {
    const r = respostasIniciais(grupos, HOJE);
    r[0].cabecalho = { dataPedido: "2026-10-01", dataPrevista: "2026-11-01", prazo: "30/60" };
    r[1].cabecalho = { dataPedido: HOJE, dataPrevista: "", prazo: "90" };
    const out = avancarHerdando(r, 0);
    expect(out[1].cabecalho).toEqual({ dataPedido: HOJE, dataPrevista: "2026-11-01", prazo: "90" });
    expect(out[2]).toBe(r[2]);
    expect(r[1].cabecalho.dataPrevista).toBe(""); // não muta o original
    expect(avancarHerdando(r, 2)).toHaveLength(3); // última página: nada a herdar
  });
  it("herdarCabecalho: data do pedido nunca fica vazia por herança", () => {
    expect(herdarCabecalho({ dataPedido: "a", dataPrevista: "b", prazo: "c" }, { dataPedido: "", dataPrevista: "", prazo: "" })).toEqual({ dataPedido: "a", dataPrevista: "b", prazo: "c" });
  });
  it("aplicar a todas sobrescreve as outras (menos a de origem)", () => {
    const r = respostasIniciais(grupos, HOJE);
    r[1].cabecalho = { dataPedido: "x", dataPrevista: "y", prazo: "z" };
    r[1].incluida = false;
    const out = aplicarCabecalhoATodas([{ ...r[0], cabecalho: { dataPedido: HOJE, dataPrevista: "2026-12-01", prazo: "30" } }, r[1], r[2]], 0);
    expect(out[1].cabecalho).toEqual({ dataPedido: HOJE, dataPrevista: "2026-12-01", prazo: "30" });
    expect(out[1].incluida).toBe(false); // só o cabeçalho
    expect(out[2].cabecalho.dataPrevista).toBe("2026-12-01");
  });
});

describe("totais (R$ só com permissão de custos)", () => {
  const ps = [produto("1", { pecas: 10, valorUnitario: 100, descontoPct: 10 }), produto("2", { pecas: 5, valorUnitario: 40, descontoPct: 0 })];
  const g = agruparPorFornecedor(ps, "acabado").grupos;
  it("PA pela cadeiaValores (bruto → com desconto)", () => {
    expect(totalDoProduto(ps[0], "acabado")).toBe(900);
    expect(totalDoProduto(ps[1], "acabado")).toBe(200);
  });
  it("PI pelo valor em M1 (qtd × unitário), sem desconto", () => {
    expect(totalDoProduto({ pecas: 10, valorUnitario: 100, descontoPct: 10 }, "importado")).toBe(1000);
    expect(totalDoProduto({ pecas: 3, valorUnitario: 33.333, descontoPct: 0 }, "importado")).toBe(100);
  });
  it("totais da OC e do lote; produto desmarcado e OC desmarcada ficam fora", () => {
    let r = respostasIniciais(g, HOJE);
    expect(totaisDaOc(g[0], r[0], "acabado", true)).toEqual({ produtos: 2, pecas: 15, total: 1100 });
    expect(totaisDoLote(g, r, "acabado", true)).toEqual({ ocs: 1, produtos: 2, pecas: 15, total: 1100 });
    r = alternarProdutoNaOc(r, 0, "1");
    expect(totaisDoLote(g, r, "acabado", true)).toEqual({ ocs: 1, produtos: 1, pecas: 5, total: 200 });
    r = alternarProdutoNaOc(r, 0, "2");
    expect(ocEntra(g[0], r[0])).toBe(false); // todos os produtos fora = a OC não entra
    expect(totaisDoLote(g, r, "acabado", true).ocs).toBe(0);
    r = alternarProdutoNaOc(r, 0, "2"); // volta
    r[0] = { ...r[0], incluida: false };
    expect(totaisDoLote(g, r, "acabado", true).ocs).toBe(0);
  });
  it("sem permissão de custos: total null, peças e contagens iguais", () => {
    const r = respostasIniciais(g, HOJE);
    expect(totaisDaOc(g[0], r[0], "acabado", false)).toEqual({ produtos: 2, pecas: 15, total: null });
    expect(totaisDoLote(g, r, "acabado", false)).toEqual({ ocs: 1, produtos: 2, pecas: 15, total: null });
  });
});

describe("parcelas do prazo (sobre o total da OC, P-355)", () => {
  it("mesma conta das outras OCs", () => {
    for (const p of ["30/60/90", "30, 60", "30-60", "à vista", "", "  "]) expect(parcelasDoPrazo(p)).toBe(contarParcelasPrazo(p));
    expect(parcelasDoPrazo("30/60/90")).toBe(3);
    expect(parcelasDoPrazo("")).toBe(1);
  });
});

describe("validação e montarPedidos (shape do _pedidos do servidor)", () => {
  const ps = [produto("1"), produto("2"), produto("3", { empresaId: "e2", fornecedorNome: "Outra", representanteId: "r9" })];
  const g = agruparPorFornecedor(ps, "acabado").grupos;

  it("Data prevista é obrigatória nas OCs que entram", () => {
    const r = respostasIniciais(g, HOJE);
    expect(errosDoLote(g, r)).toEqual([{ indice: 0, mensagem: TEXTO_DATA_PREVISTA_OBRIGATORIA }, { indice: 1, mensagem: TEXTO_DATA_PREVISTA_OBRIGATORIA }]);
    expect(TEXTO_DATA_PREVISTA_OBRIGATORIA).toBe("Preencha a data de entrega");
    r[0].cabecalho.dataPrevista = "2026-11-01";
    r[1] = { ...r[1], incluida: false }; // OC desmarcada não é conferida
    expect(errosDoLote(g, r)).toEqual([]);
  });

  it("PA: exatamente as chaves do contrato", () => {
    const r = respostasIniciais(g, HOJE);
    r[0].cabecalho = { dataPedido: HOJE, dataPrevista: "2026-11-01", prazo: " 30/60 " };
    r[1].cabecalho = { dataPedido: "", dataPrevista: "2026-11-15", prazo: "" };
    const out = montarPedidos(g, r, "acabado");
    expect(out).toEqual([
      { empresa_id: "e1", representante_id: null, data_pedido: HOJE, data_prevista: "2026-11-01", prazo_pagamento: "30/60", produto_ids: ["1", "2"] },
      { empresa_id: "e2", representante_id: "r9", data_pedido: null, data_prevista: "2026-11-15", prazo_pagamento: null, produto_ids: ["3"] },
    ]);
    expect(Object.keys(out[0])).not.toContain("moeda_compra");
  });

  it("OC desmarcada e produto desmarcado ficam fora; OC sem produto some", () => {
    let r = respostasIniciais(g, HOJE);
    r.forEach((x) => { x.cabecalho.dataPrevista = "2026-11-01"; });
    r = alternarProdutoNaOc(r, 0, "2");
    r[1] = { ...r[1], incluida: false };
    expect(montarPedidos(g, r, "acabado").map((p) => p.produto_ids)).toEqual([["1"]]);
    r = alternarProdutoNaOc(r, 0, "1");
    expect(montarPedidos(g, r, "acabado")).toEqual([]);
  });

  it("PI: leva moeda_compra e moeda_intermediaria do grupo", () => {
    const gi = agruparPorFornecedor([produto("1", { moedaCompra: "USD", moedaIntermediaria: "CNY" })], "importado").grupos;
    const r = respostasIniciais(gi, HOJE);
    r[0].cabecalho.dataPrevista = "2026-11-01";
    expect(montarPedidos(gi, r, "importado")).toEqual([{
      empresa_id: "e1", representante_id: null, data_pedido: HOJE, data_prevista: "2026-11-01", prazo_pagamento: null,
      produto_ids: ["1"], moeda_compra: "USD", moeda_intermediaria: "CNY",
    }]);
  });
});

describe("criarPedidosDoLote (salvar sujos → 1 chamada → tudo ou nada)", () => {
  function cenario(sujos: string[]) {
    const ps = [produto("1", { sujo: sujos.includes("1") }), produto("2", { sujo: sujos.includes("2") }), produto("3", { empresaId: "e2", fornecedorNome: "Outra", sujo: sujos.includes("3") })];
    const grupos = agruparPorFornecedor(ps, "acabado").grupos;
    const respostas = respostasIniciais(grupos, HOJE);
    respostas.forEach((x) => { x.cabecalho.dataPrevista = "2026-11-01"; });
    return { grupos, respostas, ps };
  }
  const criadas: OcCriadaLote[] = [
    { oc_id: "o1", numero: "BELDIV-00001", produto_ids: ["1", "2"] },
    { oc_id: "o2", numero: "OUTVCA-00001", produto_ids: ["3"] },
  ];

  it("salva só os sujos que vão no pedido, antes de criar, e cria UMA vez", async () => {
    const { grupos, respostas } = cenario(["2", "3"]);
    const ordem: string[] = [];
    const onSalvarProduto = vi.fn(async (p: ProdutoPedido) => { ordem.push(`salvar:${p.id}`); });
    const onCriar = vi.fn(async () => { ordem.push("criar"); return criadas; });
    const out = await criarPedidosDoLote({ grupos, respostas, familia: "acabado", jaSalvos: new Set(), onSalvarProduto, onCriar });
    expect(out).toBe(criadas);
    expect(ordem).toEqual(["salvar:2", "salvar:3", "criar"]);
    expect(onCriar).toHaveBeenCalledTimes(1);
    expect(onCriar.mock.calls[0][0]).toHaveLength(2);
  });

  it("sujo desmarcado não é salvo", async () => {
    const { grupos, respostas } = cenario(["2"]);
    const r = alternarProdutoNaOc(respostas, 0, "2");
    expect(produtosASalvar(grupos, r)).toEqual([]);
    const onSalvarProduto = vi.fn(async () => {});
    await criarPedidosDoLote({ grupos, respostas: r, familia: "acabado", jaSalvos: new Set(), onSalvarProduto, onCriar: async () => criadas });
    expect(onSalvarProduto).not.toHaveBeenCalled();
  });

  it("falhou o salvar = SalvarProdutoError e NADA é criado; nova tentativa não regrava quem já foi salvo", async () => {
    const { grupos, respostas } = cenario(["1", "2"]);
    const jaSalvos = new Set<string>();
    const onCriar = vi.fn(async () => criadas);
    const falha = new Error("boom");
    const onSalvarProduto = vi.fn(async (p: ProdutoPedido) => { if (p.id === "2") throw falha; });
    const prom = criarPedidosDoLote({ grupos, respostas, familia: "acabado", jaSalvos, onSalvarProduto, onCriar });
    await expect(prom).rejects.toBeInstanceOf(SalvarProdutoError);
    await prom.catch((e: SalvarProdutoError) => { expect(e.produto.id).toBe("2"); expect(e.causa).toBe(falha); });
    expect(onCriar).not.toHaveBeenCalled();
    expect([...jaSalvos]).toEqual(["1"]);
    const ok = vi.fn(async () => {});
    await criarPedidosDoLote({ grupos, respostas, familia: "acabado", jaSalvos, onSalvarProduto: ok, onCriar });
    expect(ok).toHaveBeenCalledTimes(1); // só o "2"
    expect(onCriar).toHaveBeenCalledTimes(1);
  });

  it("falhou o criar = o erro sobe (produtos seguem salvos)", async () => {
    const { grupos, respostas } = cenario(["1"]);
    const jaSalvos = new Set<string>();
    await expect(criarPedidosDoLote({
      grupos, respostas, familia: "acabado", jaSalvos, onSalvarProduto: async () => {}, onCriar: async () => { throw new Error("pedido_recusado"); },
    })).rejects.toThrow("pedido_recusado");
    expect(jaSalvos.has("1")).toBe(true);
  });

  it("sem pedido nenhum: não salva nem chama o servidor", async () => {
    const { grupos, respostas } = cenario(["1"]);
    const r = respostas.map((x) => ({ ...x, incluida: false }));
    const onCriar = vi.fn(async () => criadas);
    const onSalvarProduto = vi.fn(async () => {});
    expect(await criarPedidosDoLote({ grupos, respostas: r, familia: "acabado", jaSalvos: new Set(), onSalvarProduto, onCriar })).toEqual([]);
    expect(onCriar).not.toHaveBeenCalled();
    expect(onSalvarProduto).not.toHaveBeenCalled();
  });
});

describe("textos e cache", () => {
  it("OCs criadas no singular/plural", () => {
    expect(textoOcsCriadas(1)).toBe("1 OC criada");
    expect(textoOcsCriadas(3)).toBe("3 OCs criadas");
  });
  it("cache por família: produtos, OCs, OC aberta e contagem das abas", () => {
    const f = (x: FamiliaPedido) => chavesCacheDoPedido(x).map((k) => k[0]);
    expect(f("acabado")).toEqual(["produtos-acabados", "ocs_p_acabado", "oc-p-acabado", "sidebar-badges"]);
    expect(f("importado")).toEqual(["produtos-importados", "ocs_importado", "oc-importado", "sidebar-badges"]);
  });
});
