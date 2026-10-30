// @vitest-environment happy-dom
// [urg R13 T6] Canvas e cards de Produto Acabado e Produto Importado — RENDER real (react-dom/client + happy-dom) com o supabase mockado:
//   1. `OcChipProduto` / `OcVinculadaSecao`: chip "Na OC … (com N produtos)", seção 3 (status/pedida/recebida DO ITEM, "divide a OC com N",
//      identidade travada), vincular (lista só encomendadas do mesmo fornecedor; PI + mesma moeda) e desvincular (só OC de 1 produto),
//      R$ "—" sem permissão de ver custos.
//   2. Os CARDS (PA e PI): o chip fica FORA do botão do cabeçalho; "Fazer pedido deste produto" abre o assistente (callback) e respeita a
//      trava de conflito; a seção/bloco da OC usa o componente compartilhado.
//   3. Os SHEETS (canvas): rodapé "Fazer pedido" abre o `PedidoOcLoteWizard` com a subcoleção SEM OC; barra de selecionados; botão do card =
//      1 produto; ponta a ponta com `fazer_pedido_*` (payload `_pedidos`) e o chip aparecendo no card depois.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── mocks de infraestrutura (a lógica sob teste é 100% código de produção) ─────────────────────────────────────────────
const rpcMock = vi.hoisted(() => vi.fn());
const navegarMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const dados = vi.hoisted(() => ({ tabelas: {} as Record<string, any>, consultas: [] as Array<{ tabela: string; select: string; chamadas: string[][] }> }));
const permissao = vi.hoisted(() => ({ verCustos: true }));

// supabase: `from(tabela)` devolve um construtor encadeável (qualquer método devolve ele mesmo) que, ao ser aguardado, entrega
// `dados.tabelas[tabela]`; `maybeSingle()` entrega o 1º elemento (ou o objeto).
vi.mock("@/integrations/supabase/client", () => {
  const unico = (t: string) => { const v = dados.tabelas[t]; return Array.isArray(v) ? (v[0] ?? null) : (v ?? null); };
  const builder = (tabela: string) => {
    const reg = { tabela, select: "", chamadas: [] as string[][] };
    dados.consultas.push(reg);
    const b: any = new Proxy({}, {
      get(_, prop: string) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve({ data: dados.tabelas[tabela] ?? [], error: null }).then(res, rej);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: unico(tabela), error: null });
        return (...args: any[]) => { if (prop === "select") reg.select = String(args[0] ?? ""); reg.chamadas.push([prop, ...args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))]); return b; };
      },
    });
    return b;
  };
  return { supabase: { rpc: rpcMock, from: builder, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }), removeChannel: () => {} } };
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navegarMock };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canView: () => permissao.verCustos, canEdit: () => true, user: { id: "u1" }, session: null, loading: false }),
}));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("@/hooks/useMaoObraModelo", () => ({
  useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
}));
vi.mock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => null, useIntegracaoEstados: () => ({}) }));
vi.mock("@/hooks/useColabRegistro", () => ({ useColabRegistro: () => ({ presentes: [] }) }));
vi.mock("@/hooks/useAgrupamentoState", () => ({ useAgrupamentoState: () => ({ isOn: () => false, set: () => {} }) }));
vi.mock("@/components/otb/orcamento", () => ({ useOrcamento: () => ({ subcolecao: () => null }) }));
vi.mock("@/components/shared/UnsavedChangesGuard", () => ({
  useUnsavedGuard: () => ({ requestClose: () => {}, requestAction: (fn: () => void) => fn(), confirm: null }),
  UnsavedChangesGuard: () => null,
}));
vi.mock("@/components/shared/ColabBanner", () => ({ ColabBanner: () => null }));
vi.mock("@/components/shared/ColabPresenceOverlay", () => ({ ColabPresenceOverlay: () => null }));
vi.mock("@/components/planejamento/PlanejamentoDetail", () => ({ PlanejamentoDetail: () => null }));
vi.mock("@/components/plan-tecido/EditarMixDialog", () => ({ EditarMixDialog: () => null }));

const { OcChipProduto, OcVinculadaSecao } = await import("@/components/shared/OcVinculadaProduto");
const { ProdutoCard } = await import("@/components/produto-acabado/ProdutoCard");
const { ProdutoImportadoCard } = await import("@/components/produto-importado/ProdutoImportadoCard");
const { ProdutoAcabadoSheet } = await import("@/components/produto-acabado/ProdutoAcabadoSheet");
const { ProdutoImportadoSheet } = await import("@/components/produto-importado/ProdutoImportadoSheet");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
import { EMBED_OC_ITEM_PA, EMBED_OC_ITEM_PI } from "@/lib/oc-produto-vinculo";
import type { ProdutoDraft } from "@/components/produto-acabado/shared";
import { emptyDraft, type ProdutoImportadoDraft } from "@/components/produto-importado/shared";

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
const clicar = async (b: Element | null | undefined) => {
  if (!b) throw new Error("elemento não encontrado");
  await act(async () => { (b as HTMLElement).click(); });
};
const texto = () => document.body.textContent ?? "";
const digitar = async (el: HTMLInputElement, valor: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, valor);
    el.setSelectionRange(valor.length, valor.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  rpcMock.mockReset();
  navegarMock.mockReset();
  Object.values(toastMock).forEach((f) => f.mockReset());
  dados.tabelas = {};
  dados.consultas = [];
  permissao.verCustos = true;
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild); // portais dos diálogos
});

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
const gradeItem = { "1": { P: { pedida: 6, recebida: 2, defeito: 0 }, M: { pedida: 4, recebida: 1, defeito: 0 } } };
const ocBase = (over: Record<string, unknown> = {}) => ({
  id: "oc1", numero: "BELDIV-00123", status: "encomendado" as const, nProdutos: 3, qtd_total: 10, valor_unitario_real: 18, grade_detalhe: gradeItem,
  valor_unitario: 20, desconto_pct: 10, ...over,
});
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

// ── 1. O chip e a seção 3 (componentes compartilhados) ──────────────────────────────────────────────────────────────────
describe("OcChipProduto", () => {
  it("OC com vários produtos: 'Na OC BELDIV-00123 (com 3 produtos)'; clicar abre a OC", async () => {
    await montar(createElement(OcChipProduto, { oc: { id: "oc1", numero: "BELDIV-00123", nProdutos: 3 }, familia: "acabado" }));
    expect(document.querySelector('[data-testid="oc-chip-produto"]')!.textContent).toContain("Na OC BELDIV-00123 (com 3 produtos)");
    await clicar(document.querySelector('[data-testid="oc-chip-produto"]'));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-acabado", search: { oc: "oc1" } });
  });
  it("OC de 1 produto: '(1 produto)'; Importado abre a rota do Importado; sem OC não renderiza nada", async () => {
    await montar(createElement(OcChipProduto, { oc: { id: "oc9", numero: "CAS-9" }, familia: "importado" }));
    expect(texto()).toContain("Na OC CAS-9 (1 produto)");
    await clicar(document.querySelector('[data-testid="oc-chip-produto"]'));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-importado", search: { oc: "oc9" } });
  });
  it("sem OC: nada", async () => {
    await montar(createElement(OcChipProduto, { oc: null, familia: "acabado" }));
    expect(document.querySelector('[data-testid="oc-chip-produto"]')).toBeNull();
  });
});

function secao(over: Record<string, unknown> = {}) {
  const props = {
    familia: "acabado" as const,
    produto: { id: "p1", empresaId: "f1" },
    oc: ocBase(),
    podeVerValor: true,
    onFazerPedido: vi.fn(),
    onVinculada: vi.fn(),
    ...over,
  };
  return { props, el: createElement(OcVinculadaSecao, props as any) };
}

describe("OcVinculadaSecao — OC com vários produtos", () => {
  it("mostra status/pedida/recebida DO ITEM, nº de produtos, 'divide a OC com 2 outros' e 'Identidade travada'", async () => {
    await montar(secao().el);
    const t = document.querySelector('[data-testid="oc-vinculada-secao"]')!.textContent!;
    expect(t).toContain("BELDIV-00123");
    expect(t).toContain("Encomendado");
    expect(t).toContain("Produtos na OC3");
    expect(t).toContain("Pedida10");
    expect(t).toContain("Recebida3");
    expect(t).toContain("Este produto divide a OC com 2 outros.");
    expect(t).toContain("Identidade travada enquanto estiver na OC.");
    expect(t).toContain("Para tirar da OC, abra a OC");
  });
  it("2+ produtos: NÃO oferece desvincular — 'Abra a OC para tirar o produto' + 'Abrir a OC'", async () => {
    await montar(secao().el);
    expect(botao("Desvincular")).toBeUndefined();
    expect(document.querySelector('[data-testid="oc-vinculada-abra-a-oc"]')!.textContent).toBe("Abra a OC para tirar o produto.");
    await clicar(botao("Abrir a OC"));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-acabado", search: { oc: "oc1" } });
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("sem permissão de ver custos: o R$ do valor unitário real vira '—'; com permissão aparece", async () => {
    await montar(secao({ podeVerValor: false }).el);
    expect(document.querySelector('[data-testid="oc-vinculada-secao"]')!.textContent).toContain("V. unit. real—");
    expect(texto()).not.toContain("R$");
  });
  it("com permissão: R$ do valor unitário real", async () => {
    await montar(secao({ podeVerValor: true }).el);
    expect(texto()).toContain("R$");
  });
});

describe("OcVinculadaSecao — OC de 1 produto: desvincular", () => {
  it("chama vincular_oc_p_acabado com a OC e _produto_id NULL, relê a OC do produto e avisa o pai", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    dados.tabelas.produtos_acabados = [{ id: "p1", oc_item: [] }]; // depois de desvincular o produto não tem mais item
    const { props } = secao({ oc: ocBase({ nProdutos: 1 }) });
    await montar(createElement(OcVinculadaSecao, props as any));
    expect(texto()).not.toContain("divide a OC");
    expect(texto()).toContain("Identidade travada enquanto estiver na OC.");
    await clicar(botao("Desvincular OC"));
    await tick(10);
    expect(rpcMock).toHaveBeenCalledWith("vincular_oc_p_acabado", { _oc_id: "oc1", _produto_id: null });
    expect(props.onVinculada).toHaveBeenCalledWith(null);
    expect(toastMock.success).toHaveBeenCalledWith("OC desvinculada.");
  });
  it("Importado: vincular_oc_importado; sem 'Identidade travada' (o servidor só trava a identidade do Acabado)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    dados.tabelas.produtos_importados = [{ id: "i1", oc_item: [] }];
    const { props } = secao({ familia: "importado", produto: { id: "i1", empresaId: "f1", moedaCompra: "RMB", moedaIntermediaria: null }, oc: ocBase({ nProdutos: 1 }), mostrarIdentidadeTravada: false });
    await montar(createElement(OcVinculadaSecao, props as any));
    expect(texto()).not.toContain("Identidade travada");
    await clicar(botao("Desvincular OC"));
    await tick(10);
    expect(rpcMock).toHaveBeenCalledWith("vincular_oc_importado", { _oc_id: "oc1", _produto_id: null });
  });
  it("erro do servidor: toast de erro, sem avisar o pai", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "oc_varios_produtos: abra a OC para tirar o produto" } });
    const { props } = secao({ oc: ocBase({ nProdutos: 1 }) });
    await montar(createElement(OcVinculadaSecao, props as any));
    await clicar(botao("Desvincular OC"));
    await tick(10);
    expect(toastMock.error).toHaveBeenCalled();
    expect(props.onVinculada).not.toHaveBeenCalled();
  });
});

describe("OcVinculadaSecao — sem OC: vincular e fazer pedido", () => {
  const ocsDoBanco = [
    { id: "a", numero: "BEL-A", status: "encomendado", empresa_id: "f1", itens: [{ produto_acabado_id: "x", nome_produto: "Outro" }] },
    { id: "b", numero: "BEL-B", status: "recebido", empresa_id: "f1", itens: [{ produto_acabado_id: "y" }, { produto_acabado_id: "z" }] },
    { id: "c", numero: "AUR-C", status: "encomendado", empresa_id: "f2", itens: [{ produto_acabado_id: "w" }] },
    { id: "d", numero: "BEL-D", status: "encomendado", empresa_id: "f1", itens: [{ produto_acabado_id: "m" }, { produto_acabado_id: "n" }] },
  ];

  it("'Fazer pedido deste produto' abre o assistente (callback); trava de conflito desabilita com o motivo", async () => {
    const { props } = secao({ oc: null });
    await montar(createElement(OcVinculadaSecao, props as any));
    expect(texto()).toContain("Nenhuma OC vinculada ainda.");
    expect(texto()).toContain("Vincular só lista OCs encomendadas do mesmo fornecedor.");
    await clicar(botao("Fazer pedido deste produto"));
    expect(props.onFazerPedido).toHaveBeenCalledTimes(1);
  });
  it("conflito pendente: o botão fica desabilitado (a trava do card)", async () => {
    await montar(secao({ oc: null, conflitoPendente: true }).el);
    const b = botao("Fazer pedido deste produto")!;
    expect(b.disabled).toBe(true);
    expect(b.title).toContain("Resolva os conflitos de edição pendentes");
  });
  it("Vincular lista SÓ as encomendadas do MESMO fornecedor (com a contagem de produtos) e vincula a escolhida", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    dados.tabelas.ocs_p_acabado = ocsDoBanco;
    dados.tabelas.produtos_acabados = [{ id: "p1", oc_item: [{ id: "it", status: "encomendado", qtd_total: 10, valor_unitario_real: 20, grade_detalhe: {}, valor_unitario: 20, desconto_pct: 0, oc: { id: "d", numero: "BEL-D", status: "encomendado", empresa_id: "f1", itens: [{ count: 3 }] } }] }];
    const { props } = secao({ oc: null });
    await montar(createElement(OcVinculadaSecao, props as any));
    await clicar(botao("Vincular a uma OC existente"));
    await tick(10);
    const dlg = document.querySelector('[data-testid="oc-vincular-dialog"]')!;
    expect(document.querySelector('[data-testid="oc-vincular-a"]')).toBeTruthy(); // encomendada, mesmo fornecedor
    expect(document.querySelector('[data-testid="oc-vincular-d"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="oc-vincular-b"]')).toBeNull(); // recebida
    expect(document.querySelector('[data-testid="oc-vincular-c"]')).toBeNull(); // outro fornecedor
    expect(dlg.textContent).toContain("2 produtos"); // d
    expect(dlg.textContent).toContain("1 produto"); // a
    await clicar(document.querySelector('[data-testid="oc-vincular-d"]'));
    await tick(10);
    expect(rpcMock).toHaveBeenCalledWith("vincular_oc_p_acabado", { _oc_id: "d", _produto_id: "p1" });
    // a OC do produto é RELIDA (item + cabeçalho + nº de produtos) e vai para o pai
    expect(props.onVinculada).toHaveBeenCalledWith(expect.objectContaining({ id: "d", numero: "BEL-D", nProdutos: 3 }));
    expect(toastMock.success).toHaveBeenCalledWith("OC vinculada.");
  });
  it("sem nenhuma candidata: mensagem; produto sem fornecedor: pede o fornecedor e não consulta o banco", async () => {
    dados.tabelas.ocs_p_acabado = [ocsDoBanco[2]];
    await montar(secao({ oc: null }).el);
    await clicar(botao("Vincular a uma OC existente"));
    await tick(10);
    expect(document.querySelector('[data-testid="oc-vincular-vazio"]')!.textContent).toBe("Nenhuma OC encomendada deste fornecedor.");
  });
  it("sem fornecedor no produto: orienta a escolher o fornecedor (nenhuma consulta de OCs)", async () => {
    await montar(secao({ oc: null, produto: { id: "p1", empresaId: null } }).el);
    await clicar(botao("Vincular a uma OC existente"));
    expect(texto()).toContain("Escolha o fornecedor do produto para ver as OCs.");
    expect(dados.consultas.filter((c) => c.tabela === "ocs_p_acabado")).toHaveLength(0);
  });
  it("Importado: lista só a MESMA moeda; rascunho local (novo-…) não vincula", async () => {
    dados.tabelas.ocs_importado = [
      { id: "a", numero: "IMP-A", status: "encomendado", empresa_id: "f1", moeda_compra: "RMB", moeda_intermediaria: "USD", itens: [{ produto_importado_id: "x" }] },
      { id: "b", numero: "IMP-B", status: "encomendado", empresa_id: "f1", moeda_compra: "USD", moeda_intermediaria: null, itens: [{ produto_importado_id: "y" }] },
    ];
    const prod = { id: "i1", empresaId: "f1", moedaCompra: "RMB", moedaIntermediaria: "USD" };
    await montar(secao({ familia: "importado", oc: null, produto: prod }).el);
    expect(texto()).toContain("Vincular só lista OCs encomendadas do mesmo fornecedor e da mesma moeda.");
    await clicar(botao("Vincular a uma OC existente"));
    await tick(10);
    expect(document.querySelector('[data-testid="oc-vincular-a"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="oc-vincular-b"]')).toBeNull();
  });
  it("rascunho local do Importado ('novo-…'): 'Vincular' desabilitado até salvar", async () => {
    await montar(secao({ familia: "importado", oc: null, produto: { id: "novo-1", empresaId: "f1", moedaCompra: "RMB" } }).el);
    expect(botao("Vincular a uma OC existente")!.disabled).toBe(true);
  });
});

// ── 2. Os CARDS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function cardPA(props: Record<string, unknown> = {}) {
  const base = {
    produto: pa(),
    onChange: () => {}, open: true, onToggleOpen: () => {},
    grupos: [{ id: "g1", nome: "Camisas" }], categorias: [], subcats1: [], subcats2: [], categoriasTecido: [], materiaisAviamento: [],
    cores: [], coresApelido: [], empresas: [], tamanhos: ["P", "M", "G"], colecaoNome: null, linhasMarkup: {},
    onSalvarProduto: vi.fn(async () => {}), onCardCriado: () => {}, onOcVinculada: vi.fn(), onFazerPedido: vi.fn(), onExcluido: () => {}, onLimpo: () => {},
    ...props,
  };
  return { props: base, el: createElement(ProdutoCard, base as any) };
}

describe("ProdutoCard (PA)", () => {
  it("com OC de vários produtos: chip no cabeçalho (FORA do botão) e seção 3 do mockup", async () => {
    const { el } = cardPA({ produto: pa({ oc: ocBase() as any }) });
    await montar(el);
    const chip = document.querySelector('[data-testid="oc-chip-produto"]')!;
    expect(chip.textContent).toContain("Na OC BELDIV-00123 (com 3 produtos)");
    expect(chip.closest("button") === chip).toBe(true); // o chip é o próprio <button>…
    expect(chip.parentElement!.closest("button")).toBeNull(); // …e não está dentro de outro botão
    await clicar(botao("3 · OC vinculada"));
    expect(document.querySelector('[data-testid="oc-vinculada-secao"]')!.textContent).toContain("Este produto divide a OC com 2 outros.");
    expect(botao("Desvincular")).toBeUndefined();
  });
  it("sem OC: sem chip; 'Fazer pedido deste produto' chama onFazerPedido (o Sheet abre o assistente) — o card NÃO cria a OC", async () => {
    const { el, props } = cardPA();
    await montar(el);
    expect(document.querySelector('[data-testid="oc-chip-produto"]')).toBeNull();
    await clicar(botao("3 · OC vinculada"));
    await clicar(botao("Fazer pedido deste produto"));
    expect(props.onFazerPedido).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
    expect((props.onSalvarProduto as any)).not.toHaveBeenCalled(); // quem salva o produto sujo é o assistente
  });
  it("conflito pendente na coleção: o botão fica desabilitado", async () => {
    const { el } = cardPA({ conflitoPendente: true });
    await montar(el);
    await clicar(botao("3 · OC vinculada"));
    expect(botao("Fazer pedido deste produto")!.disabled).toBe(true);
  });
  it("sem permissão de ver custos: o V. unit. real da OC vira '—'", async () => {
    permissao.verCustos = false;
    const { el } = cardPA({ produto: pa({ oc: ocBase() as any }) });
    await montar(el);
    await clicar(botao("3 · OC vinculada"));
    expect(document.querySelector('[data-testid="oc-vinculada-secao"]')!.textContent).toContain("V. unit. real—");
  });
});

function cardPI(props: Record<string, unknown> = {}, draft: Partial<ProdutoImportadoDraft> = {}) {
  const d: ProdutoImportadoDraft = {
    ...emptyDraft("col1", "sub1"), id: "i1", rev: 1, nome: "Casaco", grupo_id: "g1", empresa_id: "f1", qtd_total: 5,
    valor_unitario_m1: 9, cotacao_ref: 0.14, cotacao_final: 5.5, grade_proporcao: { P: 1 },
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 5, _touched: false }],
    ...draft,
  };
  const base = {
    draft: d, onChange: vi.fn(), open: true, onToggleOpen: () => {},
    grupos: [{ id: "g1", nome: "Casacos" }], categorias: [], subcats1: [], subcats2: [], categoriasTecido: [], materiaisAviamento: [],
    cores: [], coresApelido: [], empresas: [], tamanhos: ["P", "M", "G"], onExcluir: () => {},
    onSalvarProduto: vi.fn(async () => "i1"), onFazerPedido: vi.fn(),
    ...props,
  };
  return { props: base, d, el: createElement(ProdutoImportadoCard, base as any) };
}
async function abrirPagamentos() { await clicar(botao("6 · Pagamentos")); }

describe("ProdutoImportadoCard (PI) — o mesmo bloco da OC do Acabado", () => {
  it("sem OC: 'Fazer pedido deste produto' chama onFazerPedido; 'Vincular' existe (PI ganha o bloco)", async () => {
    const { el, props } = cardPI();
    await montar(el);
    await abrirPagamentos();
    expect(botao("Vincular a uma OC existente")).toBeTruthy();
    await clicar(botao("Fazer pedido deste produto"));
    expect(props.onFazerPedido).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("com OC de vários produtos: chip FORA do botão do cabeçalho, 'divide a OC com 1 outro', sem desvincular", async () => {
    const { el } = cardPI({}, { oc: { id: "oci9", numero: "CAS-0009", status: "encomendado", ocStatus: "encomendado", nProdutos: 2, qtd_total: 5, valor_unitario_real: 30, grade_detalhe: gradeItem } as any });
    await montar(el);
    const chip = document.querySelector('[data-testid="oc-chip-produto"]')!;
    expect(chip.textContent).toContain("Na OC CAS-0009 (com 2 produtos)");
    expect(chip.parentElement!.closest("button")).toBeNull();
    await abrirPagamentos();
    expect(botao("Fazer pedido deste produto")).toBeUndefined();
    const t = document.querySelector('[data-testid="pi-oc-bloco"]')!.textContent!;
    expect(t).toContain("Este produto divide a OC com 1 outro.");
    expect(t).toContain("Abra a OC para tirar o produto.");
    expect(botao("Desvincular")).toBeUndefined();
    await clicar(botao("Abrir a OC"));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-importado", search: { oc: "oci9" } });
  });
  it("com OC de 1 produto: oferece Desvincular", async () => {
    const { el } = cardPI({}, { oc: { id: "oci9", numero: "CAS-0009", status: "encomendado", nProdutos: 1 } });
    await montar(el);
    await abrirPagamentos();
    expect(botao("Desvincular OC")).toBeTruthy();
  });
  it("conflito pendente: botão desabilitado", async () => {
    const { el } = cardPI({ conflitoPendente: true });
    await montar(el);
    await abrirPagamentos();
    expect(botao("Fazer pedido deste produto")!.disabled).toBe(true);
  });
});

// ── 3. Os SHEETS (canvas) ───────────────────────────────────────────────────────────────────────────────────────────────
const rowPA = (id: string, nome: string, over: Record<string, unknown> = {}) => ({
  id, rev: 1, nome, ref: `REF-${id}`, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  categoria_tecido_id: null, material_aviamento_id: null, colecao_id: "col1", subcolecao: "Resort", semana: null,
  empresa_id: "f1", representante_id: null, ref_fornecedor: null, composicao: null, grade_proporcao: { P: 1, M: 1 },
  qtd_total: 10, valor_unitario: 20, desconto_pct: 0, insumos_total: 0, markup_atacado: null, markup_varejo: null,
  preco_atacado_fixo: null, preco_varejo_fixo: null, modelo_id: null, mix_id: null, foto_url: null, tamanho_tipo: "letra",
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }], modelo: null, oc_item: [], ...over,
});
const itemOcPA = (over: Record<string, unknown> = {}) => ({
  id: "it", status: "encomendado", qtd_total: 10, valor_unitario_real: 20, grade_detalhe: {}, valor_unitario: 20, desconto_pct: 0,
  oc: { id: "oc1", numero: "BELDIV-00123", status: "encomendado", empresa_id: "f1", itens: [{ count: 3 }] }, ...over,
});
function bancoPA(produtos: any[]) {
  dados.tabelas = {
    colecoes: { id: "col1", nome: "Verão 2027" },
    colecao_subcolecoes: [{ id: "s1", nome: "Resort", ordem: 1 }],
    produtos_acabados: produtos,
    grupos_produto: [{ id: "g1", nome: "Feminino" }],
    categorias_produto: [{ id: "c1", nome: "Blusa", grupo_id: "g1" }],
    cores: [{ id: "azul", nome: "Azul" }],
    empresas: [{ id: "f1", nome_fantasia: "Bella Malhas", representantes: [] }, { id: "f2", nome_fantasia: "Aurora", representantes: [] }],
    ocs_p_acabado: [],
  };
  rpcMock.mockImplementation(async (nome: string) => (nome === "get_user_tenant_id" ? { data: "t1", error: null } : { data: null, error: null }));
}
async function abrirSheetPA() {
  await montar(createElement(ProdutoAcabadoSheet, { colecaoId: "col1", subInicial: "s1", onClose: () => {} }));
  await tick(20);
}

describe("ProdutoAcabadoSheet — o canvas liga o assistente", () => {
  it("o embed do produto é o `oc_item` do plano (nunca o ponteiro do cabeçalho)", async () => {
    bancoPA([rowPA("a", "Vestido")]);
    await abrirSheetPA();
    const q = dados.consultas.find((c) => c.tabela === "produtos_acabados" && c.select.includes("oc_item"));
    expect(q).toBeTruthy();
    expect(q!.select).toContain(EMBED_OC_ITEM_PA);
    expect(q!.select).not.toMatch(/ocs:\s*ocs_p_acabado\s*\(/);
  });
  it("RODAPÉ 'Fazer pedido': abre o assistente com a subcoleção SEM OC (quem já tem OC fica de fora, com o aviso)", async () => {
    bancoPA([rowPA("a", "Vestido Midi"), rowPA("b", "Blusa Lia", { empresa_id: "f2" }), rowPA("c", "Body Mia", { oc_item: [itemOcPA()] })]);
    await abrirSheetPA();
    expect(texto()).toContain("Na OC BELDIV-00123 (com 3 produtos)"); // o chip do card que já está na OC
    await clicar(botao("Fazer pedido"));
    await tick(10);
    const w = document.querySelector('[data-testid="pedido-oc-lote"]')!;
    expect(w).toBeTruthy();
    expect(w.textContent).toContain("Compra total da subcoleção: 2 produtos sem OC.");
    expect(w.textContent).toContain("1 produto desta subcoleção já tem OC e não entra aqui.");
    expect(w.textContent).toContain("Vestido Midi");
    expect(w.textContent).toContain("Blusa Lia");
    expect(w.textContent).not.toContain("Body Mia");
    expect(w.textContent).toContain("2 fornecedores → 2 OCs");
    expect(w.textContent).toContain("Nº gerado ao criar: BELFBL-NNNNN"); // Bella + F(eminino) + BL(usa)
  });
  it("BARRA DE SELECIONADOS: 'Fazer pedido dos N selecionados' abre o assistente só com os marcados", async () => {
    bancoPA([rowPA("a", "Vestido Midi"), rowPA("b", "Blusa Lia")]);
    await abrirSheetPA();
    const cb = document.querySelector('#produto-card-a button[role="checkbox"]');
    await clicar(cb);
    expect(texto()).toContain("1 selecionado(s)");
    await clicar(botao("Fazer pedido dos 1 selecionado"));
    await tick(10);
    const w = document.querySelector('[data-testid="pedido-oc-lote"]')!;
    expect(w.textContent).toContain("Fazer pedido dos 1 selecionado — prévia");
    expect(w.textContent).toContain("Vestido Midi");
    expect(w.textContent).not.toContain("Blusa Lia");
  });
  it("sem permissão de ver custos: o assistente não mostra R$ em lugar nenhum", async () => {
    permissao.verCustos = false;
    bancoPA([rowPA("a", "Vestido Midi")]);
    await abrirSheetPA();
    await clicar(botao("Fazer pedido"));
    await tick(10);
    const w = document.querySelector('[data-testid="pedido-oc-lote"]')!;
    expect(w.textContent).toContain("Seu perfil não vê custos");
    expect(w.textContent).not.toMatch(/R\$\s?\d/); // nenhum valor em R$ (o aviso fala "R$" sem número)
  });
  it("CARD → 'Fazer pedido deste produto': assistente com 1 produto; ponta a ponta com `fazer_pedido_p_acabado` e o chip aparece no card", async () => {
    bancoPA([rowPA("a", "Vestido Midi"), rowPA("b", "Blusa Lia")]);
    rpcMock.mockImplementation(async (nome: string, args: any) => {
      if (nome === "get_user_tenant_id") return { data: "t1", error: null };
      if (nome === "fazer_pedido_p_acabado") {
        // o servidor vincula o produto: a releitura do produto traz o item + cabeçalho (OC de 1 produto)
        dados.tabelas.produtos_acabados = dados.tabelas.produtos_acabados.map((r: any) =>
          r.id === "a" ? { ...r, rev: 2, oc_item: [itemOcPA({ oc: { id: "ocN", numero: "BELFBL-00001", status: "encomendado", empresa_id: "f1", itens: [{ count: 1 }] } })] } : r);
        return { data: [{ oc_id: "ocN", numero: "BELFBL-00001", produto_ids: args._pedidos[0].produto_ids }], error: null };
      }
      return { data: null, error: null };
    });
    await abrirSheetPA();
    // abre o card "a" e a seção 3
    await clicar(document.querySelector("#produto-card-a button.flex.w-full"));
    await clicar(botao("3 · OC vinculada"));
    await clicar(botao("Fazer pedido deste produto"));
    await tick(10);
    const w = document.querySelector('[data-testid="pedido-oc-lote"]')!;
    expect(w.textContent).toContain("Pedido de 1 produto.");
    expect(w.textContent).toContain("Vestido Midi");
    expect(w.textContent).not.toContain("Blusa Lia");
    // OC 1 de 1: data prevista obrigatória
    await clicar(botao("Próxima: OC 1"));
    // os 2 DateField da página: [0] = data do pedido, [1] = data prevista (o prazo tem o placeholder 30/60/90)
    const datas = (Array.from(document.querySelectorAll('[data-testid="pedido-oc-lote-pagina"] input')) as HTMLInputElement[]).filter((i) => i.placeholder !== "30/60/90");
    await digitar(datas[1], "01/11/2026");
    await act(async () => { datas[1].dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await clicar(botao("Criar 1 pedido"));
    await clicar(Array.from(document.querySelectorAll('[data-testid="pedido-oc-lote-confirmar"] button')).find((b) => b.textContent?.includes("Criar 1 pedido")));
    await tick(30);
    const chamada = rpcMock.mock.calls.find((c) => c[0] === "fazer_pedido_p_acabado");
    expect(chamada).toBeTruthy();
    expect(chamada![1]._pedidos).toHaveLength(1);
    expect(chamada![1]._pedidos[0]).toMatchObject({ empresa_id: "f1", representante_id: null, data_prevista: "2026-11-01", produto_ids: ["a"] });
    expect(document.querySelector('[data-testid="pedido-oc-lote-resultado"]')!.textContent).toContain("BELFBL-00001");
    // o card do produto passa a mostrar o chip (relido do servidor)
    expect(document.querySelector("#produto-card-a")!.textContent).toContain("Na OC BELFBL-00001 (1 produto)");
    expect(document.querySelector("#produto-card-b")!.textContent).not.toContain("Na OC");
    // "Abrir OC" do resultado navega para a OC criada
    await clicar(botao("Abrir OC"));
    expect(navegarMock).toHaveBeenCalledWith({ to: "/entrada-saida/oc-p-acabado", search: { oc: "ocN" } });
  });
});

const rowPI = (id: string, nome: string, over: Record<string, unknown> = {}) => ({
  id, rev: 1, nome, ref: `IMP-${id}`, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  categoria_tecido_id: null, material_aviamento_id: null, colecao_id: "col1", subcolecao: "Resort", semana: null,
  empresa_id: "f1", representante_id: null, ref_fornecedor: null, composicao: null, foto_url: null,
  data_pedido: null, data_prevista: null, data_entrega: null, grade_proporcao: { P: 1 }, qtd_total: 5,
  moeda_compra: "RMB", moeda_intermediaria: "USD", valor_unitario_m1: 9, cotacao_ref: 0.14, peso_kg: 0, transporte_m2: 0, desconto_pct: 0,
  cotacao_final: 5.5, markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
  modelo_id: null, mix_id: null, tamanho_tipo: "letra", modelo: null, oc_item: [],
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 5 }],
  etapas: [
    { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: null, cotacao: 0.14 },
    { ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: null, cotacao: 0.14 },
    { ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, data_vencimento: null, cotacao: 1 },
  ],
  ...over,
});
function bancoPI(produtos: any[]) {
  dados.tabelas = {
    colecoes: { id: "col1", nome: "Verão 2027" },
    colecao_subcolecoes: [{ id: "s1", nome: "Resort", ordem: 1 }],
    produtos_importados: produtos,
    grupos_produto: [{ id: "g1", nome: "Casacos" }],
    categorias_produto: [{ id: "c1", nome: "Jaqueta", grupo_id: "g1" }],
    cores: [{ id: "azul", nome: "Azul" }],
    empresas: [{ id: "f1", nome_fantasia: "Yiwu", representantes: [] }],
    ocs_importado: [],
  };
  rpcMock.mockImplementation(async (nome: string) => (nome === "get_user_tenant_id" ? { data: "t1", error: null } : { data: null, error: null }));
}
async function abrirSheetPI() {
  await montar(createElement(ProdutoImportadoSheet, { colecaoId: "col1", subInicial: "s1", onClose: () => {} }));
  await tick(20);
}

describe("ProdutoImportadoSheet — o canvas liga o assistente", () => {
  it("o embed do produto é o `oc_item` do Importado", async () => {
    bancoPI([rowPI("a", "Casaco A")]);
    await abrirSheetPI();
    const q = dados.consultas.find((c) => c.tabela === "produtos_importados" && c.select.includes("oc_item"));
    expect(q).toBeTruthy();
    expect(q!.select).toContain(EMBED_OC_ITEM_PI);
    expect(q!.select).not.toMatch(/ocs:\s*ocs_importado\s*\(/);
  });
  it("RODAPÉ: assistente do Importado com a subcoleção SEM OC; moedas diferentes = OCs separadas", async () => {
    bancoPI([
      rowPI("a", "Casaco A"),
      rowPI("b", "Casaco B"),
      rowPI("c", "Casaco C", { moeda_compra: "USD", moeda_intermediaria: null }),
      rowPI("d", "Casaco D", { oc_item: [{ id: "it", status: "encomendado", qtd_total: 5, valor_unitario_real: 9, grade_detalhe: {}, valor_unitario_m1: 9, desconto_pct: 0, oc: { id: "oc7", numero: "YIWFCA-00007", status: "encomendado", empresa_id: "f1", itens: [{ count: 2 }] } }] }),
    ]);
    await abrirSheetPI();
    expect(texto()).toContain("Na OC YIWFCA-00007 (com 2 produtos)");
    await clicar(botao("Fazer pedido"));
    await tick(10);
    const w = document.querySelector('[data-testid="pedido-oc-lote"]')!;
    expect(w.textContent).toContain("Compra total da subcoleção: 3 produtos sem OC.");
    expect(w.textContent).toContain("2 fornecedores → 2 OCs"); // mesma empresa, 2 moedas
    expect(w.textContent).toContain("Um pedido (OC) por fornecedor e moeda");
    expect(w.textContent).not.toContain("Casaco D");
  });
  it("BARRA DE SELECIONADOS do Importado", async () => {
    bancoPI([rowPI("a", "Casaco A"), rowPI("b", "Casaco B")]);
    await abrirSheetPI();
    await clicar(document.querySelector('button[role="checkbox"]'));
    await clicar(Array.from(document.querySelectorAll("button")).find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Fazer pedido dos 1 selecionado")));
    await tick(10);
    expect(document.querySelector('[data-testid="pedido-oc-lote"]')!.textContent).toContain("Fazer pedido dos 1 selecionado — prévia");
  });
});
