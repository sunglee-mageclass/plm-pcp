// @vitest-environment happy-dom
// Camada intermediária (P-393, nov/2026) — Produto Acabado: MARKUP e PREÇO FIXO deixam de gravar no blur (RPC solta) e entram no Salvar em LOTE
// do `ProdutoAcabadoSheet`, igual ao Produto Importado:
//   1. Editar markup / preço fixo NÃO chama RPC na hora (fica no rascunho) e o produto vira "editado" (Salvar acende).
//   2. O Salvar manda o markup em `salvar_produto_acabado` (`_dados`, com o `_rev_base`) e o preço fixo em `salvar_precos_fixo_produto_acabado`
//      logo DEPOIS, só dos canais que mudaram; produto NÃO editado não é reenviado; `salvar_markups_produto_acabado` não é mais usada aqui.
//   3. P0409 no lote = o preço fixo nem roda (herda o CAS). Falha só do preço fixo: o rev/baseline refletem o servidor (sem P0409 falso no
//      próximo Salvar) e o produto segue "editado".
//   4. Varejo travado pela Integração: o valor travado é revertido ao do servidor e NÃO é mandado; o atacado (livre) grava normalmente.
//   + as funções puras `planejarPrecosFixo` / `precosAposSalvar` (shared.ts).
// RENDER real (react-dom/client + happy-dom) com o supabase mockado — a lógica sob teste é 100% código de produção.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = vi.hoisted(() => vi.fn());
const navegarMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const dados = vi.hoisted(() => ({ tabelas: {} as Record<string, any> }));
const integ = vi.hoisted(() => ({ mapa: {} as Record<string, any> }));

vi.mock("@/integrations/supabase/client", () => {
  const unico = (t: string) => { const v = dados.tabelas[t]; return Array.isArray(v) ? (v[0] ?? null) : (v ?? null); };
  const builder = (tabela: string) => {
    const b: any = new Proxy({}, {
      get(_, prop: string) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve({ data: dados.tabelas[tabela] ?? [], error: null }).then(res, rej);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: unico(tabela), error: null });
        return () => b;
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
  useAuth: () => ({ canView: () => true, canEdit: () => true, user: { id: "u1" }, session: null, loading: false }),
}));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("@/hooks/useMaoObraModelo", () => ({
  useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
}));
vi.mock("@/hooks/useIntegracaoEstado", () => ({
  useIntegracaoEstado: (modeloId: string | null) => (modeloId ? integ.mapa[modeloId] ?? null : null),
  useIntegracaoEstados: () => integ.mapa,
}));
// `estadoIntegracaoFresco` (refetch do estado da Integração no erro) lê o cache do React Query — aqui devolve o mesmo mapa do teste.
vi.mock("@/lib/integracao/trava", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integracao/trava")>();
  return { ...actual, estadoIntegracaoFresco: async () => integ.mapa };
});
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

const { ProdutoAcabadoSheet } = await import("@/components/produto-acabado/ProdutoAcabadoSheet");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
import { planejarPrecosFixo, precosAposSalvar } from "@/components/produto-acabado/shared";

// ── utilitários ──
let root: Root | null = null;
let host: HTMLElement | null = null;
async function montar(el: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, el)); });
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const botao = (txt: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().includes(txt)) as HTMLButtonElement | undefined;
const botaoExato = (txt: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === txt) as HTMLButtonElement | undefined;
const clicar = async (b: Element | null | undefined) => {
  if (!b) throw new Error("elemento não encontrado");
  await act(async () => { (b as HTMLElement).click(); });
};
const digitar = async (el: HTMLInputElement, valor: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, valor);
    el.setSelectionRange(valor.length, valor.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const chamadas = (nome: string) => rpcMock.mock.calls.filter((c) => c[0] === nome);
const ordemDasChamadas = () => rpcMock.mock.calls.map((c) => c[0] as string).filter((n) => n !== "get_user_tenant_id");

beforeEach(() => {
  rpcMock.mockReset();
  navegarMock.mockReset();
  Object.values(toastMock).forEach((f) => f.mockReset());
  dados.tabelas = {};
  integ.mapa = {};
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

// ── fixtures: 2 produtos COM card no Planejamento (modelo_id) — a seção "2 · Preço" só aparece assim ──
const modeloEmbed = { preco_venda: null, preco_atacado: null, linha_id: null, fotos_modelo: [], desenho_tecnico_url: null, croqui_url: null, tamanho_tipo: "letra", modelo_skus: [{ count: 0 }] };
const rowPA = (id: string, nome: string, over: Record<string, unknown> = {}) => ({
  id, rev: 1, nome, ref: `REF-${id}`, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  categoria_tecido_id: null, material_aviamento_id: null, colecao_id: "col1", subcolecao: "Resort", semana: null,
  empresa_id: "f1", representante_id: null, ref_fornecedor: null, composicao: null, grade_proporcao: { P: 1, M: 1 },
  qtd_total: 10, valor_unitario: 20, desconto_pct: 0, insumos_total: 0, markup_atacado: null, markup_varejo: null,
  preco_atacado_fixo: null, preco_varejo_fixo: null, modelo_id: `m-${id}`, mix_id: null, foto_url: null, tamanho_tipo: "letra",
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }], modelo: modeloEmbed, oc_item: [], ...over,
});
function banco(produtos: any[]) {
  dados.tabelas = {
    colecoes: { id: "col1", nome: "Verão 2027" },
    colecao_subcolecoes: [{ id: "s1", nome: "Resort", ordem: 1 }],
    produtos_acabados: produtos,
    grupos_produto: [{ id: "g1", nome: "Feminino" }],
    categorias_produto: [{ id: "c1", nome: "Blusa", grupo_id: "g1" }],
    cores: [{ id: "azul", nome: "Azul" }],
    empresas: [{ id: "f1", nome_fantasia: "Bella Malhas", representantes: [] }],
    ocs_p_acabado: [],
  };
  rpcMock.mockImplementation(async (nome: string, args: any) => {
    if (nome === "get_user_tenant_id") return { data: "t1", error: null };
    // o servidor bumpa o rev a CADA UPDATE (trigger `trg_colab_rev_prod_acabado`): lote +1, preço fixo +1
    if (nome === "salvar_produto_acabado" || nome === "salvar_precos_fixo_produto_acabado") {
      const id = args._id ?? args._produto_id;
      dados.tabelas.produtos_acabados = dados.tabelas.produtos_acabados.map((r: any) => (r.id === id ? { ...r, rev: r.rev + 1 } : r));
      return { data: nome === "salvar_produto_acabado" ? id : null, error: null };
    }
    return { data: null, error: null };
  });
}
async function abrirCardA() {
  await montar(createElement(ProdutoAcabadoSheet, { colecaoId: "col1", subInicial: "s1", onClose: () => {} }));
  await tick(20);
  await clicar(document.querySelector("#produto-card-a button.flex.w-full"));
  await clicar(botao("2 · Preço"));
}
const campoMarkup = (canal: "atac" | "var") => document.querySelector(`input[data-colab-path="card:a:markup-${canal}"]`) as HTMLInputElement;
const campoPreco = (rotulo: "Preço atacado" | "Preço varejo") =>
  Array.from(document.querySelectorAll("#produto-card-a label")).find((l) => l.textContent?.trim() === rotulo)!.parentElement!.querySelector("input") as HTMLInputElement;

// ── 1. editar NÃO grava na hora ──
describe("Produto Acabado — markup e preço fixo são RASCUNHO (nada grava no blur)", () => {
  it("digitar + sair do campo (blur) em markup e preço: NENHUMA RPC; o produto vira 'editado' (Salvar acende)", async () => {
    banco([rowPA("a", "Vestido"), rowPA("b", "Blusa")]);
    await abrirCardA();
    expect(botaoExato("Salvo")).toBeTruthy(); // limpo
    expect(botaoExato("Salvo")!.disabled).toBe(true);

    for (const el of [campoMarkup("atac"), campoMarkup("var"), campoPreco("Preço atacado"), campoPreco("Preço varejo")]) {
      await act(async () => { el.focus(); });
      await digitar(el, "3,5");
      await act(async () => { el.blur(); });
    }
    expect(ordemDasChamadas()).toEqual([]); // zero RPC (nem as soltas `salvar_markups_*`/`salvar_precos_fixo_*`)
    const salvar = botaoExato("Salvar");
    expect(salvar).toBeTruthy();
    expect(salvar!.disabled).toBe(false);
  });

  it("só o PREÇO FIXO mudou (markup intocado): o produto conta como editado — o preço fixo entrou no chaveDirty", async () => {
    banco([rowPA("a", "Vestido")]);
    await abrirCardA();
    await digitar(campoPreco("Preço varejo"), "199,90");
    expect(ordemDasChamadas()).toEqual([]);
    expect(botaoExato("Salvar")!.disabled).toBe(false);
  });
});

// ── 2. o Salvar em lote leva markup e preço fixo ──
describe("Produto Acabado — o Salvar em lote grava markup (salvar_produto_acabado) e preço fixo (salvar_precos_fixo_produto_acabado)", () => {
  it("preço fixo atacado 'R$ 1.234,56': lote primeiro (com _rev_base), depois SÓ o canal atacado no preço fixo, valor 1234.56 (parser do MoneyInput, nunca NaN)", async () => {
    banco([rowPA("a", "Vestido"), rowPA("b", "Blusa")]);
    await abrirCardA();
    await digitar(campoPreco("Preço atacado"), "1234,56");
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(ordemDasChamadas()).toEqual(["salvar_produto_acabado", "salvar_precos_fixo_produto_acabado"]);
    const lote = chamadas("salvar_produto_acabado")[0][1];
    expect(lote._id).toBe("a");
    expect(lote._rev_base).toBe(1);
    expect(lote._dados.markup_atacado).toBeNull(); // digitar preço limpa o markup do canal no rascunho
    const fixo = chamadas("salvar_precos_fixo_produto_acabado")[0][1];
    expect(fixo).toEqual({
      _produto_id: "a", _tocar_atacado: true, _preco_atacado_fixo: 1234.56, _tocar_varejo: false, _preco_varejo_fixo: null,
    });
    expect(Number.isNaN(fixo._preco_atacado_fixo)).toBe(false);
    expect(chamadas("salvar_markups_produto_acabado")).toHaveLength(0);
    // o produto B (não editado) NÃO foi reenviado
    expect(chamadas("salvar_produto_acabado").every((c) => c[1]._id === "a")).toBe(true);
    // limpo depois do Salvar (rev relido DEPOIS do preço fixo: 1 → lote 2 → preço fixo 3)
    expect(botaoExato("Salvo")).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith("Produtos salvos.");
  });

  it("2º Salvar depois de editar outro campo manda o rev ATUAL (3), sem P0409 falso do próprio preço fixo, e NÃO reenvia o preço fixo já gravado", async () => {
    banco([rowPA("a", "Vestido")]);
    await abrirCardA();
    await digitar(campoPreco("Preço atacado"), "100,00");
    await clicar(botaoExato("Salvar"));
    await tick(30);
    rpcMock.mockClear();
    // agora edita só o markup VAREJO
    await digitar(campoMarkup("var"), "2,5");
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(ordemDasChamadas()).toEqual(["salvar_produto_acabado"]); // markup viaja no lote; o preço fixo atacado já está no servidor → sem RPC de preço
    const lote = chamadas("salvar_produto_acabado")[0][1];
    expect(lote._rev_base).toBe(3);
    expect(lote._dados.markup_varejo).toBe(2.5);
    expect(lote._dados.markup_atacado).toBeNull();
  });

  it("só MARKUP editado: viaja em `_dados` do lote (e o servidor limpa o fixo do canal); nenhuma RPC de preço fixo", async () => {
    banco([rowPA("a", "Vestido")]);
    await abrirCardA();
    await digitar(campoMarkup("atac"), "3,5");
    expect(ordemDasChamadas()).toEqual([]);
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(ordemDasChamadas()).toEqual(["salvar_produto_acabado"]);
    expect(chamadas("salvar_produto_acabado")[0][1]._dados.markup_atacado).toBe(3.5);
  });

  it("produto com preço fixo no servidor e NADA editado: não vira dirty e não é reenviado", async () => {
    banco([rowPA("a", "Vestido", { preco_atacado_fixo: 150, preco_varejo_fixo: 300 })]);
    await abrirCardA();
    expect(botaoExato("Salvo")!.disabled).toBe(true);
    expect(ordemDasChamadas()).toEqual([]);
  });

  it("editar markup num canal que TINHA preço fixo: o lote leva o markup (o servidor limpa o fixo); nenhuma RPC de preço fixo", async () => {
    banco([rowPA("a", "Vestido", { preco_atacado_fixo: 150 })]);
    await abrirCardA();
    await digitar(campoMarkup("atac"), "2,5");
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(ordemDasChamadas()).toEqual(["salvar_produto_acabado"]);
    expect(chamadas("salvar_produto_acabado")[0][1]._dados.markup_atacado).toBe(2.5);
  });
});

// ── 3. P0409 e falha do preço fixo ──
describe("Produto Acabado — conflito e falha parcial", () => {
  it("P0409 no lote: o preço fixo NÃO roda (herda o CAS do _rev_base)", async () => {
    banco([rowPA("a", "Vestido")]);
    const base = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation(async (nome: string, args: any) =>
      nome === "salvar_produto_acabado" ? { data: null, error: { code: "P0409", message: "conflito_versao" } } : base(nome, args));
    await abrirCardA();
    await digitar(campoPreco("Preço atacado"), "100,00");
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(chamadas("salvar_produto_acabado")).toHaveLength(1);
    expect(chamadas("salvar_precos_fixo_produto_acabado")).toHaveLength(0);
  });

  it("falha SÓ do preço fixo (lote já comitou): avisa em PT, o produto segue 'editado' e o próximo Salvar manda o rev novo (sem P0409 falso)", async () => {
    banco([rowPA("a", "Vestido")]);
    const base = rpcMock.getMockImplementation()!;
    let falhar = true;
    rpcMock.mockImplementation(async (nome: string, args: any) => {
      if (nome === "salvar_precos_fixo_produto_acabado" && falhar) return { data: null, error: { code: "P0001", message: "O preço precisa ser maior que zero." } };
      return base(nome, args);
    });
    await abrirCardA();
    await digitar(campoPreco("Preço atacado"), "100,00");
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(botaoExato("Salvar")).toBeTruthy(); // continua editado (o preço digitado ficou no rascunho)
    expect(campoPreco("Preço atacado").value).toBe("100,00");
    // tenta de novo: o lote carrega o rev que o servidor tem agora (2: o lote do 1º Salvar bumpou)
    falhar = false;
    rpcMock.mockClear();
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(chamadas("salvar_produto_acabado")[0][1]._rev_base).toBe(2);
    expect(chamadas("salvar_precos_fixo_produto_acabado")).toHaveLength(1);
    expect(botaoExato("Salvo")).toBeTruthy();
  });
});

// ── 4. Trava da Integração (só o VAREJO) ──
describe("Produto Acabado — trava da Integração no Salvar em lote (cobre só o varejo)", () => {
  const travaPreco = { estado: "integravel", campos: ["preco_venda"], marcadoEm: "2026-11-01T00:00:00Z", integradoEm: null };

  it("card já travado: Markup varejo e Preço varejo desabilitados; atacado livre", async () => {
    integ.mapa = { "m-a": travaPreco };
    banco([rowPA("a", "Vestido")]);
    await abrirCardA();
    expect(campoMarkup("var").disabled).toBe(true);
    expect(campoPreco("Preço varejo").disabled).toBe(true);
    expect(campoMarkup("atac").disabled).toBe(false);
    expect(campoPreco("Preço atacado").disabled).toBe(false);
  });

  it("travou DEPOIS de editar o preço varejo: o varejo é revertido ao do servidor (nem lote nem preço fixo o levam) e avisa; o atacado grava", async () => {
    banco([rowPA("a", "Vestido")]);
    await abrirCardA();
    await digitar(campoPreco("Preço varejo"), "399,90"); // editou o varejo ainda livre
    integ.mapa = { "m-a": travaPreco };                   // …e a Integração marcou o produto
    await digitar(campoPreco("Preço atacado"), "199,90"); // re-render (o Sheet relê o estado) + edição do atacado
    await clicar(botaoExato("Salvar"));
    await tick(30);
    const fixo = chamadas("salvar_precos_fixo_produto_acabado");
    expect(fixo).toHaveLength(1);
    expect(fixo[0][1]).toEqual({ _produto_id: "a", _tocar_atacado: true, _preco_atacado_fixo: 199.9, _tocar_varejo: false, _preco_varejo_fixo: null });
    expect(chamadas("salvar_produto_acabado")[0][1]._dados.markup_varejo).toBeNull();
    expect(toastMock.warning).toHaveBeenCalled();
    expect(String(toastMock.warning.mock.calls[0][0])).toMatch(/Valor varejo foi travado pela Integração/);
    expect(campoPreco("Preço varejo").value).toBe(""); // voltou ao servidor (sem preço fixo)
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("a RPC do preço fixo recusa por trava (42501 integracao_travado) depois do lote: reverte o varejo, avisa UMA vez e o produto segue editado só no que sobrou", async () => {
    banco([rowPA("a", "Vestido")]);
    const base = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation(async (nome: string, args: any) =>
      nome === "salvar_precos_fixo_produto_acabado"
        ? { data: null, error: { code: "42501", message: "integracao_travado: preco_venda" } }
        : base(nome, args));
    await abrirCardA();
    await digitar(campoPreco("Preço varejo"), "399,90");
    // a trava só chega quando o servidor recusa (o estado local ainda é velho): o fresco vem do refetch do cache do React Query
    integ.mapa = { "m-a": travaPreco };
    await clicar(botaoExato("Salvar"));
    await tick(30);
    expect(chamadas("salvar_precos_fixo_produto_acabado")).toHaveLength(1);
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(String(toastMock.warning.mock.calls[0][0])).toMatch(/Valor varejo foi travado pela Integração/);
    expect(toastMock.error).not.toHaveBeenCalled(); // o toast de trava já avisou (sem 2º toast genérico)
    expect(campoPreco("Preço varejo").value).toBe(""); // revertido ao servidor
    expect(botaoExato("Salvo")).toBeTruthy(); // o lote gravou o resto e não sobrou edição pendente
  });
});

// ── funções puras ──
describe("planejarPrecosFixo / precosAposSalvar (shared.ts)", () => {
  const p = (o: Partial<Parameters<typeof planejarPrecosFixo>[0]> = {}) => ({ preco_atacado_fixo: null, preco_varejo_fixo: null, markup_atacado: null, markup_varejo: null, ...o });

  it("nada mudou → sem RPC", () => {
    expect(planejarPrecosFixo(p(), { preco_atacado_fixo: null, preco_varejo_fixo: null })).toBeNull();
    expect(planejarPrecosFixo(p({ preco_atacado_fixo: 10 }), { preco_atacado_fixo: 10, preco_varejo_fixo: null })).toBeNull();
  });
  it("só o canal que mudou entra", () => {
    expect(planejarPrecosFixo(p({ preco_varejo_fixo: 99 }), { preco_atacado_fixo: null, preco_varejo_fixo: null }))
      .toEqual({ tocarAtacado: false, precoAtacado: null, tocarVarejo: true, precoVarejo: 99 });
  });
  it("fixo vazio com markup digitado: o lote já limpa o fixo → não entra", () => {
    expect(planejarPrecosFixo(p({ markup_atacado: 2.5 }), { preco_atacado_fixo: 150, preco_varejo_fixo: null })).toBeNull();
  });
  it("fixo vazio E markup vazio onde havia fixo: destrava o canal (preço NULL)", () => {
    expect(planejarPrecosFixo(p(), { preco_atacado_fixo: 150, preco_varejo_fixo: null }))
      .toEqual({ tocarAtacado: true, precoAtacado: null, tocarVarejo: false, precoVarejo: null });
  });
  it("campo travado já revertido ao servidor (igual) → fora do plano", () => {
    expect(planejarPrecosFixo(p({ preco_varejo_fixo: 300 }), { preco_atacado_fixo: null, preco_varejo_fixo: 300 })).toBeNull();
  });
  it("sem leitura do servidor: fixo preenchido entra", () => {
    expect(planejarPrecosFixo(p({ preco_atacado_fixo: 10 }), undefined)?.tocarAtacado).toBe(true);
  });

  it("precosAposSalvar: fixo gravado vira o do servidor e limpa o markup do canal", () => {
    const plano = planejarPrecosFixo(p({ preco_atacado_fixo: 10 }), { preco_atacado_fixo: null, preco_varejo_fixo: null });
    expect(precosAposSalvar(p({ preco_atacado_fixo: 10 }), { preco_atacado_fixo: null, preco_varejo_fixo: null }, plano, true))
      .toEqual({ preco_atacado_fixo: 10, markup_atacado: null, preco_varejo_fixo: null, markup_varejo: null });
  });
  it("precosAposSalvar: RPC do preço falhou → o servidor segue com o fixo antigo (o digitado fica só no rascunho)", () => {
    const serv = { preco_atacado_fixo: 5, preco_varejo_fixo: null };
    const plano = planejarPrecosFixo(p({ preco_atacado_fixo: 10 }), serv);
    expect(precosAposSalvar(p({ preco_atacado_fixo: 10 }), serv, plano, false).preco_atacado_fixo).toBe(5);
  });
  it("precosAposSalvar: markup do lote não-nulo limpa o fixo do canal no servidor", () => {
    const serv = { preco_atacado_fixo: 150, preco_varejo_fixo: null };
    expect(precosAposSalvar(p({ markup_atacado: 2.5 }), serv, null, true))
      .toEqual({ preco_atacado_fixo: null, markup_atacado: 2.5, preco_varejo_fixo: null, markup_varejo: null });
  });
  it("precosAposSalvar: sem nada tocado o fixo do servidor permanece", () => {
    const serv = { preco_atacado_fixo: 150, preco_varejo_fixo: 300 };
    expect(precosAposSalvar(p({ preco_atacado_fixo: 150, preco_varejo_fixo: 300 }), serv, null, true))
      .toEqual({ preco_atacado_fixo: 150, markup_atacado: null, preco_varejo_fixo: 300, markup_varejo: null });
  });
});
