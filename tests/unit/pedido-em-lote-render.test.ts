// @vitest-environment happy-dom
// [urg R13] Pedido em lote — RENDER real (react-dom/client + happy-dom) com o supabase mockado:
//   1. `PedidoEmLoteDialog`: lista, de-fora com motivo, resumo/R$ (e sem R$ sem permissão), AlertDialog de confirmação, sequência
//      com falha parcial, botão bloqueado enquanto cria, resultado no próprio diálogo (não navega).
//   2. a MESMA cadeia que o Sheet monta (`criarOcProdutoAcabado`/`criarOcProdutoImportado`) chama a RPC com o payload do card.
//   3. PROVA de que o "Fazer pedido" do CARD segue igual (PA e PI): mesma ordem (guardas → salvar → RPC → patch/navegar), mesmo payload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── mocks de infraestrutura (a lógica sob teste é 100% código de produção) ─────────────────────────────────────────────
const rpcMock = vi.hoisted(() => vi.fn());
const ocRowMock = vi.hoisted(() => ({ current: null as any }));
const navegarMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: (tabela: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: ocRowMock.current?.[tabela] ?? null, error: null }) }) }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navegarMock };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canView: () => true, canEdit: () => true, user: { id: "u1" }, session: null, loading: false }),
}));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("@/hooks/useMaoObraModelo", () => ({
  useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
}));
vi.mock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => null }));

const { PedidoEmLoteDialog } = await import("@/components/shared/PedidoEmLoteDialog");
const { ProdutoCard } = await import("@/components/produto-acabado/ProdutoCard");
const { ProdutoImportadoCard } = await import("@/components/produto-importado/ProdutoImportadoCard");
const { toastResultadoLote } = await import("@/lib/pedido-em-lote-toast");
const { criarOcProdutoAcabado } = await import("@/components/produto-acabado/pedido");
const { criarOcProdutoImportado } = await import("@/components/produto-importado/pedido");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
import type { ItemPedidoLote } from "@/lib/pedido-em-lote";
import { gradePedidaDeVariantes, montarDadosOcAcabado, ocInfoDeRow, type ProdutoDraft } from "@/components/produto-acabado/shared";
import { emptyDraft, montarDadosOcImportado, type ProdutoImportadoDraft } from "@/components/produto-importado/shared";

// ── utilitários ─────────────────────────────────────────────────────────────────────────────────────────────────────
let root: Root | null = null;
let host: HTMLElement | null = null;
async function montar(el: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, el)); });
  return host;
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const botao = (txt: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().includes(txt)) as HTMLButtonElement | undefined;
const clicar = async (b: Element | undefined) => {
  if (!b) throw new Error("botão não encontrado");
  await act(async () => { (b as HTMLElement).click(); });
};
const texto = () => document.body.textContent ?? "";

beforeEach(() => {
  rpcMock.mockReset();
  navegarMock.mockReset();
  Object.values(toastMock).forEach((f) => f.mockReset());
  ocRowMock.current = null;
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild); // portais dos diálogos
});

// ── 1. O diálogo ────────────────────────────────────────────────────────────────────────────────────────────────────
const it1 = (id: string, valor: number | null, motivo?: string): ItemPedidoLote => ({
  id, nome: `Produto ${id}`, ref: `REF-${id}`, pecas: 10, valor,
  motivos: motivo ? [{ codigo: "sem_fornecedor", texto: motivo }] : [],
});

function dialogo(over: Record<string, unknown> = {}) {
  const props = {
    familia: "acabado" as const,
    origem: "rodape" as const,
    contexto: "Verão",
    itens: [it1("a", 100), it1("b", 250.5), it1("c", 80, "Falta escolher o fornecedor.")],
    jaTemOc: 2,
    mostrarValor: true,
    criar: vi.fn(async (i: { id: string }) => ({ ocId: `oc-${i.id}`, ocNumero: `N-${i.id}` })),
    onFechar: vi.fn(),
    onConcluido: vi.fn(),
    ...over,
  };
  return { props, el: createElement(PedidoEmLoteDialog, props as any) };
}

describe("PedidoEmLoteDialog — revisão", () => {
  it("rodapé: elegíveis marcados, o de fora desabilitado COM o motivo, resumo com nº e R$, aviso de quem já tem OC", async () => {
    const { el } = dialogo();
    await montar(el);
    expect(texto()).toContain("Fazer pedido");
    expect(texto()).toContain("2 pedidos");
    expect(texto()).toContain("R$"); // total 350,50
    expect(document.querySelector('[data-testid="pedido-lote-resumo"]')!.textContent).toContain("350,50");
    expect(texto()).toContain("2 produtos desta subcoleção já têm OC");
    const a = document.querySelector('[data-testid="pedido-lote-item-a"] button[role="checkbox"]') as HTMLElement;
    const c = document.querySelector('[data-testid="pedido-lote-item-c"] button[role="checkbox"]') as HTMLButtonElement;
    expect(a.getAttribute("data-state")).toBe("checked");
    expect(c.getAttribute("data-state")).toBe("unchecked");
    expect(c.disabled).toBe(true);
    expect(document.querySelector('[data-testid="pedido-lote-motivo-c"]')!.textContent).toBe("Falta escolher o fornecedor.");
    expect(document.querySelector('[data-testid="pedido-lote-fora"]')!.textContent).toContain("Ficam de fora (1)");
    expect(botao("Criar 2 pedidos")!.disabled).toBe(false);
  });

  it("sem permissão de ver custos: nenhum R$ em lugar nenhum (nem no resumo, nem na linha, nem na confirmação)", async () => {
    const { el } = dialogo({ mostrarValor: false });
    await montar(el);
    expect(texto()).not.toContain("R$");
    expect(texto()).toContain("2 pedidos");
    await clicar(botao("Criar 2 pedidos"));
    expect(document.querySelector('[data-testid="pedido-lote-confirmar"]')!.textContent).not.toContain("R$");
  });

  it("desmarcar um produto atualiza o resumo e o botão; desmarcar todos desabilita o 'Criar'", async () => {
    const { el } = dialogo();
    await montar(el);
    await clicar(document.querySelector('[data-testid="pedido-lote-item-b"] button[role="checkbox"]')!);
    expect(botao("Criar 1 pedido")).toBeTruthy();
    expect(document.querySelector('[data-testid="pedido-lote-resumo"]')!.textContent).toContain("100,00");
    await clicar(document.querySelector('[data-testid="pedido-lote-item-a"] button[role="checkbox"]')!);
    expect(botao("Criar pedidos")!.disabled).toBe(true);
  });

  it("rodapé sem nada a pedir: mensagem, botão desabilitado", async () => {
    const { el } = dialogo({ itens: [] });
    await montar(el);
    expect(document.querySelector('[data-testid="pedido-lote-vazio"]')!.textContent).toContain("já têm OC vinculada");
    expect(botao("Criar pedidos")!.disabled).toBe(true);
  });

  it("selecionados: título com a contagem", async () => {
    const { el } = dialogo({ origem: "selecionados", itens: [it1("a", 1), it1("b", 2)], jaTemOc: 0 });
    await montar(el);
    expect(texto()).toContain("Fazer pedido dos 2 selecionados");
  });
});

describe("PedidoEmLoteDialog — criação", () => {
  it("pede confirmação (AlertDialog): Voltar NÃO cria nada", async () => {
    const { el, props } = dialogo();
    await montar(el);
    await clicar(botao("Criar 2 pedidos"));
    const conf = document.querySelector('[data-testid="pedido-lote-confirmar"]')!;
    expect(conf.textContent).toContain("Criar 2 pedidos?");
    expect(conf.textContent).toContain("350,50");
    await clicar(botao("Voltar"));
    await tick();
    expect(props.criar).not.toHaveBeenCalled();
    expect(props.onConcluido).not.toHaveBeenCalled();
  });

  it("confirmar cria UM POR VEZ, na ordem, mostra o resultado NO diálogo e não fecha nem navega", async () => {
    let emVoo = 0, maxEmVoo = 0;
    const ordem: string[] = [];
    const criar = vi.fn(async (i: { id: string }) => {
      emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      ordem.push(i.id); emVoo--;
      return { ocId: `oc-${i.id}`, ocNumero: `N-${i.id}` };
    });
    const { el, props } = dialogo({ criar });
    await montar(el);
    await clicar(botao("Criar 2 pedidos"));
    await clicar(botao("Criar 2 pedidos") && Array.from(document.querySelectorAll('[data-testid="pedido-lote-confirmar"] button')).find((b) => b.textContent?.includes("Criar 2 pedidos")));
    await tick(60);
    expect(ordem).toEqual(["a", "b"]);
    expect(maxEmVoo).toBe(1);
    const res = document.querySelector('[data-testid="pedido-lote-resultado"]')!;
    expect(res.textContent).toContain("2 pedidos criados");
    expect(res.textContent).toContain("OC N-a criada.");
    expect(props.onConcluido).toHaveBeenCalledTimes(1);
    expect(props.onConcluido.mock.calls[0][0]).toMatchObject({ criados: 2, falhas: 0 });
    expect(props.onFechar).not.toHaveBeenCalled(); // fica na tela até o "Fechar"
    expect(navegarMock).not.toHaveBeenCalled(); // NÃO navega para a OC
    await clicar(botao("Fechar"));
    expect(props.onFechar).toHaveBeenCalledTimes(1);
  });

  it("falha num produto NÃO para os outros: '2 pedidos criados · 1 falhou' + o motivo da falha no resultado", async () => {
    const criar = vi.fn(async (i: { id: string }) => {
      if (i.id === "b") throw Object.assign(new Error("Há conflitos de edição pendentes nesta coleção — resolva-os antes de fazer o pedido."), { code: "P0001" });
      return { ocId: `oc-${i.id}`, ocNumero: null };
    });
    const itens = [it1("a", 10), it1("b", 20), it1("d", 30)];
    const { el, props } = dialogo({ criar, itens, jaTemOc: 0 });
    await montar(el);
    await clicar(botao("Criar 3 pedidos"));
    await clicar(Array.from(document.querySelectorAll('[data-testid="pedido-lote-confirmar"] button')).find((b) => b.textContent?.includes("Criar 3 pedidos")));
    await tick(20);
    expect(criar.mock.calls.map((c) => c[0].id)).toEqual(["a", "b", "d"]);
    const res = document.querySelector('[data-testid="pedido-lote-resultado"]')!;
    expect(res.textContent).toContain("2 pedidos criados · 1 falhou");
    const falha = res.querySelector('[data-resultado="falha"]')!;
    expect(falha.textContent).toContain("Produto b");
    expect(falha.textContent).toContain("Há conflitos de edição pendentes nesta coleção");
    expect(props.onConcluido.mock.calls[0][0]).toMatchObject({ criados: 2, falhas: 1 });
  });

  it("enquanto cria: 'Criar' e 'Cancelar' bloqueados, Esc não fecha, progresso visível; depois libera o 'Fechar'", async () => {
    let liberar!: () => void;
    const trava = new Promise<void>((r) => { liberar = r; });
    const criar = vi.fn(async (i: { id: string }) => { await trava; return { ocId: i.id, ocNumero: null }; });
    const { el, props } = dialogo({ criar });
    await montar(el);
    await clicar(botao("Criar 2 pedidos"));
    await clicar(Array.from(document.querySelectorAll('[data-testid="pedido-lote-confirmar"] button')).find((b) => b.textContent?.includes("Criar 2 pedidos")));
    await tick();
    expect(document.querySelector('[data-testid="pedido-lote-progresso"]')!.textContent).toContain("Criando pedido 1 de 2");
    expect(botao("Criando…")!.disabled).toBe(true);
    expect(botao("Cancelar")!.disabled).toBe(true);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(props.onFechar).not.toHaveBeenCalled();
    expect(criar).toHaveBeenCalledTimes(1); // o 2º só começa depois do 1º
    await act(async () => { liberar(); });
    await tick(20);
    expect(botao("Fechar")).toBeTruthy();
    expect(criar).toHaveBeenCalledTimes(2);
  });

  it("2 cliques seguidos em 'Criar' (confirmação) não duplicam o lote", async () => {
    const criar = vi.fn(async (i: { id: string }) => ({ ocId: i.id, ocNumero: null }));
    const { el } = dialogo({ criar });
    await montar(el);
    await clicar(botao("Criar 2 pedidos"));
    const confirmar = Array.from(document.querySelectorAll('[data-testid="pedido-lote-confirmar"] button')).find((b) => b.textContent?.includes("Criar 2 pedidos")) as HTMLElement;
    await act(async () => { confirmar.click(); confirmar.click(); });
    await tick(20);
    expect(criar).toHaveBeenCalledTimes(2); // a e b, uma vez cada
  });
});

describe("toastResultadoLote", () => {
  it("verde quando nada falhou; âmbar quando algum falhou; vermelho quando nenhum foi criado", () => {
    toastResultadoLote({ criados: 3, falhas: 0 });
    expect(toastMock.success).toHaveBeenCalledWith("3 pedidos criados");
    toastResultadoLote({ criados: 2, falhas: 1 });
    expect(toastMock.warning).toHaveBeenCalledWith("2 pedidos criados · 1 falhou");
    toastResultadoLote({ criados: 0, falhas: 2 });
    expect(toastMock.error).toHaveBeenCalledWith("Nenhum pedido criado · 2 falharam");
  });
});

// ── 2. A cadeia do Sheet: salvar o produto + criar a OC com o payload do card ─────────────────────────────────────────
const pa = (over: Partial<ProdutoDraft> = {}): ProdutoDraft => ({
  id: "p1", rev: 1, nome: "Blusa", ref: "BLU1", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  categoria_tecido_id: null, material_aviamento_id: null, colecao_id: "col1", subcolecao: "Verão", semana: null,
  empresa_id: "f1", representante_id: null, ref_fornecedor: "", composicao: "",
  grade_proporcao: { P: 1, M: 1 }, qtd_total: 10, valor_unitario: 20, desconto_pct: 0, insumos_total: 0,
  markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
  foto_url: null, modelo_id: null, mix_id: null, tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null, modeloThumbFontes: [null, null, null], oc: null,
  ...over,
});
const OC_ROW = { id: "oc1", numero: "BLU-0001", status: "encomendado", qtd_total: 10, valor_unitario_real: 20, grade_detalhe: {}, valor_unitario: 20, desconto_pct: 0 };

describe("criarOcProdutoAcabado / criarOcProdutoImportado — a chamada do card e do lote", () => {
  it("PA: salvar_oc_p_acabado com _id null, o payload do card e a grade; relê a OC (nº/status)", async () => {
    rpcMock.mockResolvedValue({ data: "oc1", error: null });
    ocRowMock.current = { ocs_p_acabado: OC_ROW };
    const p = pa();
    const row = await criarOcProdutoAcabado(p, false);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [nome, args] = rpcMock.mock.calls[0];
    expect(nome).toBe("salvar_oc_p_acabado");
    expect(args._id).toBeNull();
    expect(args._dados).toEqual(montarDadosOcAcabado(p, args._dados.data_pedido));
    expect(args._dados.data_pedido).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args._grade).toEqual(gradePedidaDeVariantes(p.variantes, p.grade_proporcao, false));
    expect(row).toEqual(OC_ROW);
  });
  it("PA: erro da RPC sobe (o lote o transforma em 'falhou'); acessório manda a grade 'UN'", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "Este produto já tem a OC X vinculada — desvincule antes." } });
    await expect(criarOcProdutoAcabado(pa(), true)).rejects.toMatchObject({ code: "P0001" });
    expect(rpcMock.mock.calls[0][1]._grade).toEqual({ "1": { UN: { pedida: 10, recebida: 0, defeito: 0 } } });
  });
  it("PI: salvar_oc_importado com _etapas [] e o payload do card; devolve o id da OC", async () => {
    rpcMock.mockResolvedValue({ data: "oci1", error: null });
    const d: ProdutoImportadoDraft = {
      ...emptyDraft("col1", null), id: "i1", nome: "Casaco", empresa_id: "f1", qtd_total: 5, valor_unitario_m1: 9,
      grade_proporcao: { P: 1 }, variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 5, _touched: false }],
    };
    const id = await criarOcProdutoImportado(d, "i1", false);
    expect(id).toBe("oci1");
    const [nome, args] = rpcMock.mock.calls[0];
    expect(nome).toBe("salvar_oc_importado");
    expect(args._id).toBeNull();
    expect(args._etapas).toEqual([]);
    expect(args._dados).toEqual(montarDadosOcImportado(d, "i1", args._dados.data_pedido));
    expect(args._grade).toEqual(gradePedidaDeVariantes(d.variantes, d.grade_proporcao, false));
  });
});

// ── 3. O "Fazer pedido" do CARD segue igual ─────────────────────────────────────────────────────────────────────────
function cardPA(props: Record<string, unknown> = {}) {
  const base = {
    produto: pa(),
    onChange: () => {}, open: true, onToggleOpen: () => {},
    grupos: [{ id: "g1", nome: "Camisas" }], categorias: [], subcats1: [], subcats2: [], categoriasTecido: [], materiaisAviamento: [],
    cores: [], coresApelido: [], empresas: [], tamanhos: ["P", "M", "G"], colecaoNome: null, linhasMarkup: {},
    onSalvarProduto: vi.fn(async () => {}), onCardCriado: () => {}, onOcVinculada: vi.fn(), onExcluido: () => {}, onLimpo: () => {},
    ...props,
  };
  return { props: base, el: createElement(ProdutoCard, base as any) };
}
async function abrirSecaoOcEPedir() {
  await clicar(botao("3 · OC vinculada"));
  return botao("Fazer pedido");
}

describe("ProdutoCard (PA) — 'Fazer pedido' segue igual (R13 só extraiu as funções)", () => {
  it("fluxo feliz: salva o produto ANTES, cria a OC com o payload de sempre, patcheia o card e navega pra OC", async () => {
    const ordem: string[] = [];
    rpcMock.mockImplementation(async (nome: string) => { ordem.push(`rpc:${nome}`); return { data: "oc1", error: null }; });
    ocRowMock.current = { ocs_p_acabado: OC_ROW };
    const onSalvarProduto = vi.fn(async () => { ordem.push("salvar"); });
    const { el, props } = cardPA({ onSalvarProduto });
    await montar(el);
    const b = await abrirSecaoOcEPedir();
    expect(b).toBeTruthy();
    await clicar(b);
    await tick(10);
    expect(ordem).toEqual(["salvar", "rpc:salvar_oc_p_acabado"]);
    expect(onSalvarProduto).toHaveBeenCalledWith(props.produto);
    const args = rpcMock.mock.calls[0][1];
    expect(args._id).toBeNull();
    expect(args._dados).toEqual(montarDadosOcAcabado(props.produto as ProdutoDraft, args._dados.data_pedido));
    expect(args._grade).toEqual(gradePedidaDeVariantes((props.produto as ProdutoDraft).variantes, (props.produto as ProdutoDraft).grade_proporcao, false));
    expect(props.onOcVinculada).toHaveBeenCalledWith(ocInfoDeRow(OC_ROW as any));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-acabado", search: { oc: "oc1" } });
    expect(toastMock.success).toHaveBeenCalledWith("Pedido criado e vinculado.");
  });

  it("soma das variantes ≠ Qtd total: recusa com o texto de sempre, NÃO salva e NÃO chama a RPC", async () => {
    const onSalvarProduto = vi.fn(async () => {});
    const { el } = cardPA({ onSalvarProduto, produto: pa({ qtd_total: 12 }) });
    await montar(el);
    await clicar(await abrirSecaoOcEPedir());
    await tick(10);
    expect(onSalvarProduto).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      'A soma das variantes (10) precisa bater com a Qtd total (12) antes de fazer o pedido — use "Redistribuir por peso" ou ajuste manualmente.',
    );
    expect(navegarMock).not.toHaveBeenCalled();
  });

  it("conflito pendente na coleção: o botão fica desabilitado (a trava do card continua valendo)", async () => {
    const { el } = cardPA({ conflitoPendente: true });
    await montar(el);
    const b = await abrirSecaoOcEPedir();
    expect(b!.disabled).toBe(true);
    expect(b!.title).toContain("Resolva os conflitos de edição pendentes");
  });

  it("erro da RPC: toast de erro, sem patch e sem navegar", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "Este produto já tem a OC BLU-1 vinculada — desvincule antes." } });
    const { el, props } = cardPA();
    await montar(el);
    await clicar(await abrirSecaoOcEPedir());
    await tick(10);
    expect(toastMock.error).toHaveBeenCalled();
    expect(props.onOcVinculada).not.toHaveBeenCalled();
    expect(navegarMock).not.toHaveBeenCalled();
  });
});

function cardPI(props: Record<string, unknown> = {}, draft: Partial<ProdutoImportadoDraft> = {}) {
  const d: ProdutoImportadoDraft = {
    ...emptyDraft("col1", "sub1"), id: "i1", rev: 1, nome: "Casaco", grupo_id: "g1", empresa_id: "f1", qtd_total: 5,
    valor_unitario_m1: 9, cotacao_ref: 0.14, cotacao_final: 5.5, grade_proporcao: { P: 1 },
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 5, _touched: false }],
    etapas: [
      { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: null, cotacao: 0.14 },
      { ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: null, cotacao: 0.14 },
      { ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, data_vencimento: null, cotacao: 1 },
    ],
    ...draft,
  };
  const base = {
    draft: d, onChange: () => {}, open: true, onToggleOpen: () => {},
    grupos: [{ id: "g1", nome: "Casacos" }], categorias: [], subcats1: [], subcats2: [], categoriasTecido: [], materiaisAviamento: [],
    cores: [], coresApelido: [], empresas: [], tamanhos: ["P", "M", "G"], onExcluir: () => {},
    onSalvarProduto: vi.fn(async () => "i1"), onPedidoCriado: vi.fn(),
    ...props,
  };
  return { props: base, d, el: createElement(ProdutoImportadoCard, base as any) };
}
async function abrirPagamentosEPedir() {
  await clicar(botao("6 · Pagamentos"));
  return botao("Fazer pedido");
}

describe("ProdutoImportadoCard (PI) — 'Fazer pedido' segue igual; com OC mostra o vínculo", () => {
  it("fluxo feliz: salva o produto ANTES, cria a OC com o payload de sempre e navega pra OC", async () => {
    const ordem: string[] = [];
    rpcMock.mockImplementation(async (nome: string) => { ordem.push(`rpc:${nome}`); return { data: "oci1", error: null }; });
    const onSalvarProduto = vi.fn(async () => { ordem.push("salvar"); return "i1"; });
    const { el, props, d } = cardPI({ onSalvarProduto });
    await montar(el);
    await clicar(await abrirPagamentosEPedir());
    await tick(10);
    expect(ordem).toEqual(["salvar", "rpc:salvar_oc_importado"]);
    expect(onSalvarProduto).toHaveBeenCalledWith(d);
    const [nome, args] = rpcMock.mock.calls[0];
    expect(nome).toBe("salvar_oc_importado");
    expect(args._id).toBeNull();
    expect(args._etapas).toEqual([]);
    expect(args._dados).toEqual(montarDadosOcImportado(d, "i1", args._dados.data_pedido));
    expect(props.onPedidoCriado).toHaveBeenCalledWith("i1", "oci1");
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-importado", search: { oc: "oci1" } });
    expect(toastMock.success).toHaveBeenCalledWith("Pedido criado.");
  });

  it("soma ≠ Qtd total: recusa com o texto de sempre, NÃO salva e NÃO chama a RPC", async () => {
    const onSalvarProduto = vi.fn(async () => "i1");
    const { el } = cardPI({ onSalvarProduto }, { qtd_total: 7 });
    await montar(el);
    await clicar(await abrirPagamentosEPedir());
    await tick(10);
    expect(onSalvarProduto).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "A soma das variantes (5) precisa bater com a Qtd total (7) antes de fazer o pedido — use o rateio por peso ou ajuste manualmente.",
    );
  });

  it("conflito pendente: botão desabilitado", async () => {
    const { el } = cardPI({ conflitoPendente: true });
    await montar(el);
    const b = await abrirPagamentosEPedir();
    expect(b!.disabled).toBe(true);
  });

  it("produto COM OC (criada no lote ou na tela da OC): mostra o nº e o status no lugar do botão", async () => {
    const { el } = cardPI({}, { oc: { id: "oci9", numero: "CAS-0009", status: "encomendado" } });
    await montar(el);
    await clicar(botao("6 · Pagamentos"));
    expect(botao("Fazer pedido")).toBeUndefined();
    expect(texto()).toContain("OC vinculada");
    expect(texto()).toContain("CAS-0009");
    await clicar(botao("CAS-0009"));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-importado", search: { oc: "oci9" } });
  });
});
