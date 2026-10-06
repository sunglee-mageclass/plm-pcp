// [urg R13] Pedido em lote (Produto Acabado e Importado) — lógica PURA: elegibilidade/motivos, resumo (nº e R$), a sequência com falha
// parcial, e as funções COMPARTILHADAS com o "Fazer pedido" do card (payload da OC e recusas): o card e o lote usam as mesmas.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  TEXTO_CONFLITO_PEDIDO, motivosForaDoPedido, marcadosIniciais, alternarMarca, marcarTodos, itensDoPedido, resumoDoLote,
  executarPedidosEmSequencia, criarPedidoDoProduto, textoResumoResultado, pedidosTexto, elegivel, textoMotivos,
  type EntradaPedido, type ItemPedidoLote, type ResultadoPedidoItem,
} from "@/lib/pedido-em-lote";
import {
  itemPedidoAcabado, erroDoPedidoAcabado, montarDadosOcAcabado, ocInfoDeRow, type ProdutoDraft,
} from "@/components/produto-acabado/shared";
import {
  emptyDraft, itemPedidoImportado, erroDoPedidoImportado, montarDadosOcImportado, custoDoDraft, type ProdutoImportadoDraft,
} from "@/components/produto-importado/shared";
import { cadeiaValores } from "@/lib/produto-acabado";

const ler = (p: string) => readFileSync(p, "utf8");

const entradaOk: EntradaPedido = {
  temOc: false, ocNumero: null, nome: "Blusa", empresaId: "f1", valorUnitario: 10, qtdTotal: 20, somaVariantes: 20, nVariantes: 2,
  precisaGrade: true, somaPesosGrade: 3, erroDaFamilia: null, conflitoDoProduto: false,
};
const semConflito = { conflitoPendente: false };
const codigos = (e: Partial<EntradaPedido>, ctx = semConflito) => motivosForaDoPedido({ ...entradaOk, ...e }, ctx).map((m) => m.codigo);

describe("motivosForaDoPedido — quem fica de fora e por quê", () => {
  it("produto completo é elegível (sem motivo)", () => {
    expect(motivosForaDoPedido(entradaOk, semConflito)).toEqual([]);
  });
  it("já tem OC (com e sem número)", () => {
    expect(motivosForaDoPedido({ ...entradaOk, temOc: true, ocNumero: "BLU-0001" }, semConflito)[0].texto).toBe("Já tem a OC BLU-0001 vinculada.");
    expect(motivosForaDoPedido({ ...entradaOk, temOc: true }, semConflito)[0].texto).toBe("Já tem OC vinculada.");
  });
  it("falta fornecedor / valor / quantidade / nome", () => {
    expect(codigos({ empresaId: null })).toEqual(["sem_fornecedor"]);
    expect(codigos({ valorUnitario: 0 })).toEqual(["sem_valor"]);
    expect(codigos({ qtdTotal: 0, somaVariantes: 0 })).toEqual(["sem_quantidade"]);
    expect(codigos({ nome: "   " })).toEqual(["sem_nome"]);
  });
  it("variantes vazias e soma ≠ total", () => {
    expect(codigos({ nVariantes: 0, somaVariantes: 0 })).toEqual(["sem_variantes"]);
    const m = motivosForaDoPedido({ ...entradaOk, somaVariantes: 15 }, semConflito);
    expect(m.map((x) => x.codigo)).toEqual(["soma_nao_bate"]);
    expect(m[0].texto).toBe("A soma das variantes (15) não bate com a Qtd total (20).");
  });
  it("grade vazia só pesa para quem NÃO é acessório", () => {
    expect(codigos({ somaPesosGrade: 0 })).toEqual(["grade_vazia"]);
    expect(codigos({ somaPesosGrade: 0, precisaGrade: false })).toEqual([]);
  });
  it("conflito: o da coleção vale para TODOS (a mesma trava do botão do card); o texto muda se é deste produto", () => {
    const g = motivosForaDoPedido(entradaOk, { conflitoPendente: true });
    expect(g.map((x) => x.codigo)).toEqual(["conflito"]);
    expect(g[0].texto).toBe(TEXTO_CONFLITO_PEDIDO);
    const p = motivosForaDoPedido({ ...entradaOk, conflitoDoProduto: true }, { conflitoPendente: true });
    expect(p).toHaveLength(1);
    expect(p[0].texto).toMatch(/Este produto tem conflito/);
  });
  it("vários motivos juntos, na ordem da tela; a recusa da família entra no fim", () => {
    const c = codigos({ temOc: true, empresaId: null, valorUnitario: 0, erroDaFamilia: "Σ% das etapas de mercadoria (90%) precisa fechar 100%." });
    expect(c).toEqual(["ja_tem_oc", "sem_fornecedor", "sem_valor", "validacao"]);
  });
  it("textoMotivos junta os textos", () => {
    expect(textoMotivos([{ codigo: "sem_valor", texto: "A." }, { codigo: "sem_fornecedor", texto: "B." }])).toBe("A. B.");
  });
});

const item = (id: string, valor: number | null, motivos: ItemPedidoLote["motivos"] = [], pecas = 10): ItemPedidoLote => ({
  id, nome: `Produto ${id}`, ref: null, pecas, valor, motivos,
});
const FORA = [{ codigo: "sem_valor" as const, texto: "Falta o valor unitário." }];

describe("marcação e resumo", () => {
  const itens = [item("a", 100.5), item("b", 200.25), item("c", 50, FORA), item("d", 10)];
  it("marcadosIniciais: todos os elegíveis (rodapé) ou só os elegíveis entre os escolhidos (selecionados)", () => {
    expect([...marcadosIniciais(itens)].sort()).toEqual(["a", "b", "d"]);
    expect([...marcadosIniciais(itens, new Set(["a", "c"]))]).toEqual(["a"]);
  });
  it("quem está de fora nunca entra na marcação (nem por alternar, nem por marcar todos)", () => {
    expect(alternarMarca(itens, new Set(["a"]), "c").has("c")).toBe(false);
    expect(alternarMarca(itens, new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
    expect(alternarMarca(itens, new Set(["a", "b"]), "b")).toEqual(new Set(["a"]));
    expect([...marcarTodos(itens, true)].sort()).toEqual(["a", "b", "d"]);
    expect(marcarTodos(itens, false).size).toBe(0);
  });
  it("itensDoPedido ignora marcado não elegível (defesa) e mantém a ordem da lista", () => {
    expect(itensDoPedido(itens, new Set(["d", "c", "a"])).map((i) => i.id)).toEqual(["a", "d"]);
  });
  it("resumo: nº de pedidos, peças e total em R$ (soma dos marcados, 2 casas)", () => {
    expect(resumoDoLote(itens, new Set(["a", "b"]), true)).toEqual({ pedidos: 2, pecas: 20, total: 300.75 });
    expect(resumoDoLote(itens, new Set(), true)).toEqual({ pedidos: 0, pecas: 0, total: 0 });
  });
  it("sem permissão de ver custos: nº e peças, NUNCA o total", () => {
    expect(resumoDoLote(itens, new Set(["a", "b"]), false)).toEqual({ pedidos: 2, pecas: 20, total: null });
  });
  it("não tem erro de ponto flutuante no total", () => {
    const f = [item("x", 0.1), item("y", 0.2)];
    expect(resumoDoLote(f, new Set(["x", "y"]), true).total).toBe(0.3);
  });
  it("elegivel + pedidosTexto", () => {
    expect(elegivel(itens[0])).toBe(true);
    expect(elegivel(itens[2])).toBe(false);
    expect(pedidosTexto(1)).toBe("1 pedido");
    expect(pedidosTexto(3)).toBe("3 pedidos");
  });
});

describe("executarPedidosEmSequencia — um por vez; a falha de um NÃO para os outros", () => {
  const lista = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }, { id: "c", nome: "C" }];
  const opcoes = (extra: object = {}) => ({ mensagemDoErro: (e: unknown) => `ERRO: ${(e as Error).message}`, ...extra });

  it("cria todos em sequência (nunca 2 ao mesmo tempo) e na ordem da lista", async () => {
    let emVoo = 0, maxEmVoo = 0;
    const ordem: string[] = [];
    const r = await executarPedidosEmSequencia(lista, async (i) => {
      emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo);
      await new Promise((res) => setTimeout(res, 5));
      ordem.push(i.id); emVoo--;
      return { ocId: `oc-${i.id}`, ocNumero: `N${i.id}` };
    }, opcoes());
    expect(maxEmVoo).toBe(1);
    expect(ordem).toEqual(["a", "b", "c"]);
    expect(r.criados).toBe(3);
    expect(r.falhas).toBe(0);
    expect(r.itens.every((x) => x.ok)).toBe(true);
  });

  it("falha parcial: o 2º falha, o 1º e o 3º são criados; o erro vem em PT pelo mensagemDoErro", async () => {
    const chamados: string[] = [];
    const r = await executarPedidosEmSequencia(lista, async (i) => {
      chamados.push(i.id);
      if (i.id === "b") throw new Error("sem fornecedor");
      return { ocId: `oc-${i.id}`, ocNumero: null };
    }, opcoes());
    expect(chamados).toEqual(["a", "b", "c"]); // o "c" rodou depois da falha do "b"
    expect(r.criados).toBe(2);
    expect(r.falhas).toBe(1);
    expect(r.itens[1]).toEqual({ id: "b", nome: "B", ok: false, erro: "ERRO: sem fornecedor" });
    expect(textoResumoResultado(r)).toBe("2 pedidos criados · 1 falhou");
  });

  it("todos falham: nada criado, nunca lança", async () => {
    const r = await executarPedidosEmSequencia(lista, async () => { throw new Error("rede"); }, opcoes());
    expect(r.criados).toBe(0);
    expect(r.falhas).toBe(3);
    expect(textoResumoResultado(r)).toBe("Nenhum pedido criado · 3 falharam");
  });

  it("mensagemDoErro que também lança não derruba o lote", async () => {
    const r = await executarPedidosEmSequencia([lista[0]], async () => { throw new Error("x"); }, { mensagemDoErro: () => { throw new Error("boom"); } });
    expect(r.itens[0]).toEqual({ id: "a", nome: "A", ok: false, erro: "Falha ao criar o pedido." });
  });

  it("onProgresso antes de cada item (feitos = quantos já terminaram) e onResultado depois de cada um", async () => {
    const prog: Array<[number, number, string]> = [];
    const res: ResultadoPedidoItem[] = [];
    await executarPedidosEmSequencia(lista, async (i) => {
      if (i.id === "a") throw new Error("falhou");
      return { ocId: i.id, ocNumero: null };
    }, opcoes({ onProgresso: (f: number, t: number, a: { id: string }) => prog.push([f, t, a.id]), onResultado: (r: ResultadoPedidoItem) => res.push(r) }));
    expect(prog).toEqual([[0, 3, "a"], [1, 3, "b"], [2, 3, "c"]]);
    expect(res.map((r) => [r.id, r.ok])).toEqual([["a", false], ["b", true], ["c", true]]);
  });

  it("lista vazia: nada acontece", async () => {
    const criar = vi.fn();
    const r = await executarPedidosEmSequencia([], criar, opcoes());
    expect(criar).not.toHaveBeenCalled();
    expect(r).toEqual({ itens: [], criados: 0, falhas: 0 });
  });

  it("textoResumoResultado: singular/plural", () => {
    expect(textoResumoResultado({ criados: 1, falhas: 0 })).toBe("1 pedido criado");
    expect(textoResumoResultado({ criados: 5, falhas: 0 })).toBe("5 pedidos criados");
    expect(textoResumoResultado({ criados: 1, falhas: 1 })).toBe("1 pedido criado · 1 falhou");
  });
});

describe("criarPedidoDoProduto — a ordem do 'Fazer pedido' do card, dentro do lote", () => {
  const erro = (m: string) => Object.assign(new Error(m), { code: "P0001" });
  const monta = (over: Record<string, unknown> = {}) => {
    const ordem: string[] = [];
    const o = {
      produto: { id: "p", sujo: false } as { id: string; sujo: boolean } | undefined,
      recusa: () => null as string | null,
      sujo: (p: { sujo: boolean }) => p.sujo,
      salvar: vi.fn(async () => { ordem.push("salvar"); return "id-salvo"; }),
      criar: vi.fn(async (_p: unknown, salvo: string | undefined) => { ordem.push("criar"); return { ocId: "oc", salvo }; }),
      erro,
      ...over,
    };
    return { o, ordem };
  };
  it("produto sumiu da lista: erro, nada salvo nem criado", async () => {
    const { o } = monta({ produto: undefined });
    await expect(criarPedidoDoProduto(o as any)).rejects.toThrow("Este produto não está mais na lista.");
    expect(o.salvar).not.toHaveBeenCalled();
    expect(o.criar).not.toHaveBeenCalled();
  });
  it("recusa (já tem OC / conflito / soma): erro com o texto, NÃO salva e NÃO cria", async () => {
    const { o } = monta({ recusa: () => TEXTO_CONFLITO_PEDIDO });
    await expect(criarPedidoDoProduto(o as any)).rejects.toMatchObject({ message: TEXTO_CONFLITO_PEDIDO, code: "P0001" });
    expect(o.salvar).not.toHaveBeenCalled();
    expect(o.criar).not.toHaveBeenCalled();
  });
  it("produto LIMPO: não regrava (só cria a OC)", async () => {
    const { o, ordem } = monta();
    const r = await criarPedidoDoProduto(o as any);
    expect(ordem).toEqual(["criar"]);
    expect(r).toEqual({ ocId: "oc", salvo: undefined });
  });
  it("produto SUJO: salva ANTES de criar e entrega o id salvo ao criar (rascunho local do Importado)", async () => {
    const { o, ordem } = monta({ produto: { id: "p", sujo: true } });
    const r = await criarPedidoDoProduto(o as any);
    expect(ordem).toEqual(["salvar", "criar"]);
    expect(r).toEqual({ ocId: "oc", salvo: "id-salvo" });
  });
  it("falha ao salvar: a OC NÃO é criada (nunca gera pedido em cima de rascunho não persistido)", async () => {
    const { o } = monta({ produto: { id: "p", sujo: true }, salvar: vi.fn(async () => { throw erro("P0409"); }) });
    await expect(criarPedidoDoProduto(o as any)).rejects.toThrow("P0409");
    expect(o.criar).not.toHaveBeenCalled();
  });
});

// ── Produto Acabado ─────────────────────────────────────────────────────────────────────────────────────────────────
const pa = (over: Partial<ProdutoDraft> = {}): ProdutoDraft => ({
  id: "p1", rev: 1, nome: "Blusa", ref: "BLU00000001", grupo_id: "g1", categoria_id: "c1",
  subcategoria1_id: "s1", subcategoria2_id: null, categoria_tecido_id: null, material_aviamento_id: null,
  colecao_id: "col1", subcolecao: "Verão", semana: null,
  empresa_id: "f1", representante_id: "r1", ref_fornecedor: "RF-9", composicao: "100% algodão",
  grade_proporcao: { P: 1, M: 2, G: 1 }, qtd_total: 40, valor_unitario: 25, desconto_pct: 10, insumos_total: 0,
  markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
  foto_url: null, modelo_id: null, mix_id: null, tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 20 }, { ordem: 2, cor_id: "rosa", cor_apelido_id: null, peso: 1, qtd: 20 }],
  modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null, modeloThumbFontes: [null, null, null], oc: null,
  ...over,
});
const ctxPA = { grupoNome: "Camisas", conflitoPendente: false, conflitoDoProduto: false };

describe("Produto Acabado — itemPedidoAcabado", () => {
  it("elegível: valor = a conta do card (cadeiaValores: total com desconto), peças = Σ variantes", () => {
    const i = itemPedidoAcabado(pa(), ctxPA);
    expect(i.motivos).toEqual([]);
    expect(i.valor).toBe(cadeiaValores(40, 25, 10).totalDesc); // 900
    expect(i.valor).toBe(900);
    expect(i.pecas).toBe(40);
    expect(i.id).toBe("p1");
  });
  it("já tem OC; sem fornecedor; sem valor; grade vazia; soma não bate", () => {
    const oc = { id: "o1", numero: "BLU-1", status: "encomendado" as const, qtd_total: 40, valor_unitario_real: 22.5, grade_detalhe: {}, valor_unitario: 25, desconto_pct: 10 };
    expect(itemPedidoAcabado(pa({ oc }), ctxPA).motivos.map((m) => m.codigo)).toEqual(["ja_tem_oc"]);
    expect(itemPedidoAcabado(pa({ empresa_id: null }), ctxPA).motivos.map((m) => m.codigo)).toEqual(["sem_fornecedor"]);
    expect(itemPedidoAcabado(pa({ valor_unitario: 0 }), ctxPA).motivos.map((m) => m.codigo)).toEqual(["sem_valor"]);
    expect(itemPedidoAcabado(pa({ grade_proporcao: {} }), ctxPA).motivos.map((m) => m.codigo)).toEqual(["grade_vazia"]);
    expect(itemPedidoAcabado(pa({ qtd_total: 41 }), ctxPA).motivos.map((m) => m.codigo)).toEqual(["soma_nao_bate"]);
  });
  it("acessório não precisa de grade de tamanhos", () => {
    expect(itemPedidoAcabado(pa({ grade_proporcao: {} }), { ...ctxPA, grupoNome: "Acessórios" }).motivos).toEqual([]);
  });
  it("conflito pendente na coleção barra todos", () => {
    expect(itemPedidoAcabado(pa(), { ...ctxPA, conflitoPendente: true }).motivos.map((m) => m.codigo)).toEqual(["conflito"]);
  });
  it("produto sem nome aparece como 'Produto sem nome' + motivo", () => {
    const i = itemPedidoAcabado(pa({ nome: "" }), ctxPA);
    expect(i.nome).toBe("Produto sem nome");
    expect(i.motivos.map((m) => m.codigo)).toEqual(["sem_nome"]);
  });
});

describe("Produto Acabado — o que o card e o lote compartilham", () => {
  it("erroDoPedidoAcabado: conflito → soma das variantes (os textos que o card sempre teve)", () => {
    expect(erroDoPedidoAcabado(pa(), false)).toBeNull();
    expect(erroDoPedidoAcabado(pa(), true)).toBe("Há conflitos de edição pendentes nesta coleção — resolva-os antes de fazer o pedido.");
    expect(erroDoPedidoAcabado(pa({ qtd_total: 50 }), false)).toBe(
      'A soma das variantes (40) precisa bater com a Qtd total (50) antes de fazer o pedido — use "Redistribuir por peso" ou ajuste manualmente.',
    );
    // o conflito ganha da soma (a ordem de sempre)
    expect(erroDoPedidoAcabado(pa({ qtd_total: 50 }), true)).toBe(TEXTO_CONFLITO_PEDIDO);
  });
  it("montarDadosOcAcabado: o payload EXATO que o 'Fazer pedido' do card montava", () => {
    expect(montarDadosOcAcabado(pa(), "2026-10-06")).toEqual({
      nome_produto: "Blusa", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: "s1", subcategoria2_id: null,
      empresa_id: "f1", representante_id: "r1", ref_fornecedor: "RF-9", composicao: "100% algodão",
      data_pedido: "2026-10-06", prazo_pagamento: "30", parcelas_entrega: 1,
      grade_proporcao: { P: 1, M: 2, G: 1 },
      variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 20 }, { ordem: 2, cor_id: "rosa", cor_apelido_id: null, peso: 1, qtd: 20 }],
      qtd_total: 40, valor_unitario: 25, desconto_pct: 10, produto_acabado_id: "p1",
    });
    // texto vazio vira null (como o card fazia)
    const d = montarDadosOcAcabado(pa({ ref_fornecedor: "", composicao: "" }), "2026-10-06");
    expect(d.ref_fornecedor).toBeNull();
    expect(d.composicao).toBeNull();
  });
  it("ocInfoDeRow: a OC recém-criada no shape do rascunho (números coeridos, defaults)", () => {
    expect(ocInfoDeRow({ id: "o1", numero: "BLU-1", status: "encomendado", qtd_total: 40, valor_unitario_real: "22.5" as any, grade_detalhe: null as any, valor_unitario: "25" as any, desconto_pct: null as any }))
      .toEqual({ id: "o1", numero: "BLU-1", status: "encomendado", qtd_total: 40, valor_unitario_real: 22.5, grade_detalhe: {}, valor_unitario: 25, desconto_pct: 0 });
  });
});

// ── Produto Importado ───────────────────────────────────────────────────────────────────────────────────────────────
const pi = (over: Partial<ProdutoImportadoDraft> = {}): ProdutoImportadoDraft => ({
  ...emptyDraft("col1", "Verão"),
  id: "i1", nome: "Casaco", grupo_id: "g1", categoria_id: "c1", empresa_id: "f1", representante_id: null,
  ref: "CAS00000001", grade_proporcao: { P: 1, M: 1 }, qtd_total: 30, valor_unitario_m1: 12, cotacao_ref: 0.14, cotacao_final: 5.5,
  moeda_compra: "RMB", moeda_intermediaria: "USD",
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 30, _touched: false }],
  etapas: [
    { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: null, cotacao: 0.14 },
    { ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: null, cotacao: 0.14 },
    { ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, data_vencimento: null, cotacao: 1 },
  ],
  ...over,
});
const ctxPI = { grupoNome: "Casacos", conflitoPendente: false, conflitoDoProduto: false };

describe("Produto Importado — itemPedidoImportado", () => {
  it("elegível: valor = 'Valor bruto (BRL)' do card (custoDoDraft.totalBrl)", () => {
    const d = pi();
    const i = itemPedidoImportado(d, ctxPI);
    expect(i.motivos).toEqual([]);
    expect(i.valor).toBe(custoDoDraft(d).totalBrl);
    expect(i.valor).toBeGreaterThan(0);
    expect(i.pecas).toBe(30);
  });
  it("já tem OC; sem fornecedor; sem valor (M1); soma não bate", () => {
    expect(itemPedidoImportado(pi({ oc: { id: "o", numero: "CAS-1", status: "encomendado" } }), ctxPI).motivos[0].texto).toBe("Já tem a OC CAS-1 vinculada.");
    expect(itemPedidoImportado(pi({ empresa_id: null }), ctxPI).motivos.map((m) => m.codigo)).toEqual(["sem_fornecedor"]);
    expect(itemPedidoImportado(pi({ valor_unitario_m1: 0 }), ctxPI).motivos.map((m) => m.codigo)).toEqual(["sem_valor"]);
    expect(itemPedidoImportado(pi({ qtd_total: 31 }), ctxPI).motivos.map((m) => m.codigo)).toEqual(["soma_nao_bate"]);
  });
  it("a recusa do card (validarDraft: Σ% das etapas) entra como motivo — uma vez só", () => {
    const d = pi({ etapas: [{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 50, data_vencimento: null, cotacao: 0.14 }] });
    const m = itemPedidoImportado(d, ctxPI).motivos;
    expect(m.map((x) => x.codigo)).toEqual(["validacao"]);
    expect(m[0].texto).toMatch(/Σ% das etapas de mercadoria/);
  });
  it("sem nome: só 'Falta o nome' (não repete o 'Informe o nome' do validarDraft)", () => {
    expect(itemPedidoImportado(pi({ nome: "" }), ctxPI).motivos.map((m) => m.codigo)).toEqual(["sem_nome"]);
  });
  it("tem moeda/cotação do card: etapa de mercadoria sem cotação com valor > 0 fica de fora (P-207 A)", () => {
    const d = pi({ etapas: pi().etapas.map((e) => (e.base === "mercadoria" ? { ...e, cotacao: 0 } : e)) });
    const m = itemPedidoImportado(d, ctxPI).motivos;
    expect(m.map((x) => x.codigo)).toEqual(["validacao"]);
  });
});

describe("Produto Importado — o que o card e o lote compartilham", () => {
  it("erroDoPedidoImportado: conflito → validarParaPedido → soma das variantes (ordem e textos do card)", () => {
    expect(erroDoPedidoImportado(pi(), false)).toBeNull();
    expect(erroDoPedidoImportado(pi(), true)).toBe(TEXTO_CONFLITO_PEDIDO);
    expect(erroDoPedidoImportado(pi({ qtd_total: 0, variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0 }] }), false)).toBe("Qtd total precisa ser maior que zero.");
    expect(erroDoPedidoImportado(pi({ qtd_total: 31 }), false)).toBe(
      "A soma das variantes (30) precisa bater com a Qtd total (31) antes de fazer o pedido — use o rateio por peso ou ajuste manualmente.",
    );
  });
  it("montarDadosOcImportado: o payload EXATO que o 'Fazer pedido' do card montava", () => {
    const d = pi({ ref_fornecedor: "", composicao: "", data_pedido: null, data_prevista: "2026-12-01", peso_kg: 0.4, transporte_m2: 3, desconto_pct: 5 });
    expect(montarDadosOcImportado(d, "i1", "2026-10-06")).toEqual({
      nome_produto: "Casaco", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
      empresa_id: "f1", representante_id: null, ref_fornecedor: null, composicao: null,
      data_pedido: "2026-10-06", data_prevista: "2026-12-01",
      grade_proporcao: { P: 1, M: 1 }, variantes: d.variantes, qtd_total: 30,
      moeda_compra: "RMB", moeda_intermediaria: "USD", valor_unitario_m1: 12, cotacao_ref: 0.14,
      peso_kg: 0.4, transporte_m2: 3, desconto_pct: 5, cotacao_final: 5.5, produto_importado_id: "i1",
    });
    // data do pedido já preenchida no card vale sobre "hoje"
    expect(montarDadosOcImportado(pi({ data_pedido: "2026-09-01" }), "i1", "2026-10-06").data_pedido).toBe("2026-09-01");
  });
});

describe("anti-drift: o card e o lote NÃO montam o payload da OC cada um por si", () => {
  it("o payload só existe nos shared.ts; as chamadas de RPC só nos pedido.ts", () => {
    const cardPA = ler("src/components/produto-acabado/ProdutoCard.tsx");
    const cardPI = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
    for (const src of [cardPA, cardPI]) {
      expect(src).not.toMatch(/prazo_pagamento|parcelas_entrega|produto_importado_id:|produto_acabado_id: produto|salvar_oc_p_acabado|salvar_oc_importado/);
    }
    expect(cardPA).toMatch(/criarOcProdutoAcabado\(produto, acessorio\)/);
    expect(cardPA).toMatch(/erroDoPedidoAcabado\(produto, conflitoPendente\)/);
    expect(cardPI).toMatch(/criarOcProdutoImportado\(draft, produtoId, acessorio\)/);
    expect(cardPI).toMatch(/erroDoPedidoImportado\(draft, conflitoPendente\)/);
    const sheetPA = ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
    const sheetPI = ler("src/components/produto-importado/ProdutoImportadoSheet.tsx");
    expect(sheetPA).toMatch(/criarOcProdutoAcabado\(p, /);
    expect(sheetPA).toMatch(/erroDoPedidoAcabado\(p, temConflitoRef\.current\)/);
    expect(sheetPI).toMatch(/criarOcProdutoImportado\(d, produtoId, /);
    expect(sheetPI).toMatch(/erroDoPedidoImportado\(d, temConflitoRef\.current\)/);
    expect(ler("src/components/produto-acabado/pedido.ts")).toMatch(/montarDadosOcAcabado\(produto, hojeISO\(\)\)/);
    expect(ler("src/components/produto-acabado/pedido.ts")).toMatch(/rpc\("salvar_oc_p_acabado"/);
    expect(ler("src/components/produto-importado/pedido.ts")).toMatch(/rpc\("salvar_oc_importado"/);
  });
  it("os 2 caminhos abrem o MESMO diálogo e o rodapé do Importado ganhou o botão", () => {
    const sheetPA = ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
    const sheetPI = ler("src/components/produto-importado/ProdutoImportadoSheet.tsx");
    for (const s of [sheetPA, sheetPI]) {
      expect(s).toMatch(/<PedidoEmLoteDialog/);
      expect(s).toMatch(/abrirPedidoLote\("rodape"\)/);
      expect(s).toMatch(/abrirPedidoLote\("selecionados"\)/);
      expect(s).toMatch(/Fazer pedido dos \{selecao\.size\} selecionado/);
    }
  });
});
