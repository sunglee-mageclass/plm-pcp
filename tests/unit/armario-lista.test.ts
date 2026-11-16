// @vitest-environment happy-dom
// F7 Armário · D2 — tela de LISTA: render real (react-dom + happy-dom) com supabase mockado.
//   lista aparece (nome/status/nº de itens/colunas) · menu ⋯ · publicado trava Renomear/Excluir · reordenar chama `armario_reordenar`
//   com a lista INTEIRA · estado vazio sem subcoleção · abrir muda a URL · erros P0001 traduzidos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const dados = vi.hoisted(() => ({ tabelas: {} as Record<string, any> }));
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((ev: any) => void) }));
const permissao = vi.hoisted(() => ({ readOnly: false }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    const b: any = new Proxy({}, {
      get(_, prop: string) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve({ data: dados.tabelas[tabela] ?? [], error: null }).then(res, rej);
        return () => b;
      },
    });
    return b;
  };
  return { supabase: { rpc: rpcMock, from: builder } };
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/RequirePermission", () => ({ useReadOnly: () => permissao.readOnly }));
vi.mock("@/components/shared/Breadcrumb", () => ({ Breadcrumb: () => null })); // usa <Link> (exige RouterProvider)
// A montagem (D4) tem teste próprio (armario-montagem.test.ts); aqui só interessa que a lista a renderiza com ?armario=.
vi.mock("@/components/armario/ArmarioMontagem", () => ({
  ArmarioMontagem: (p: { armarioId: string; onVoltar: () => void }) =>
    createElement("div", { "data-testid": "montagem-stub", "data-id": p.armarioId }, createElement("button", { onClick: p.onVoltar }, "Voltar à lista")),
}));
// Captura o onDragEnd do DndContext p/ simular o "soltar" (jsdom não faz drag real de ponteiro).
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return { ...actual, DndContext: (p: any) => { dnd.onDragEnd = p.onDragEnd; return createElement(actual.DndContext, p); } };
});

const { ArmarioListPage } = await import("@/components/armario/ArmarioListPage");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { mensagemArmario } = await import("@/lib/armario/mensagem");

let root: Root | null = null;
let host: HTMLElement | null = null;
async function montar(search: Record<string, string | undefined>, onSearch = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, createElement(ArmarioListPage, { search, onSearch }))); });
  await tick(10);
  return onSearch;
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const texto = () => document.body.textContent ?? "";
const botoes = () => Array.from(document.querySelectorAll("button"));
const botao = (txt: string) => botoes().find((b) => b.textContent?.trim().includes(txt)) as HTMLButtonElement | undefined;
const clicar = async (b: Element | null | undefined) => {
  if (!b) throw new Error("elemento não encontrado");
  await act(async () => { (b as HTMLElement).click(); });
  await tick(5);
};
const abrirMenu = async (linha: number) => {
  const gatilhos = Array.from(document.querySelectorAll('button[aria-label="Mais ações"]'));
  await clicar(gatilhos[linha]);
};

const ARMARIOS = [
  { id: "a1", nome: "Vitrine Verão", status: "rascunho", colunas: 5, ordem: 1, armario_itens: [{ count: 3 }] },
  { id: "a2", nome: "Destaques", status: "publicado", colunas: 4, ordem: 2, armario_itens: [{ count: 1 }] },
  { id: "a3", nome: "Promo", status: "pronto", colunas: 6, ordem: 3, armario_itens: [{ count: 0 }] },
];
const URL_OK = { colecao: "c1", sub: "Verão" };

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  Object.values(toastMock).forEach((f) => f.mockReset());
  dados.tabelas = {
    colecoes: [{ id: "c1", nome: "Coleção 2027" }],
    colecao_subcolecoes: [{ id: "s1", nome: "Verão", ordem: 1 }],
    armarios: ARMARIOS,
  };
  dnd.onDragEnd = null;
  permissao.readOnly = false;
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; host?.remove(); host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("ArmarioListPage — lista", () => {
  it("sem subcoleção escolhida mostra o estado vazio e não lista nada", async () => {
    await montar({ colecao: "c1" });
    expect(texto()).toContain("Escolha uma coleção e uma subcoleção");
    expect(document.querySelectorAll('[data-testid="armario-linha"]').length).toBe(0);
    expect(botao("Novo armário")?.disabled).toBe(true);
  });

  it("renderiza os armários com nome, status, nº de variantes e de colunas", async () => {
    await montar(URL_OK);
    const linhas = Array.from(document.querySelectorAll('[data-testid="armario-linha"]'));
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Vitrine Verão"), expect.stringContaining("Destaques"), expect.stringContaining("Promo"),
    ]);
    expect(linhas[0].textContent).toContain("Rascunho");
    expect(linhas[0].textContent).toContain("3 variantes");
    expect(linhas[0].textContent).toContain("5 colunas");
    expect(linhas[1].textContent).toContain("Publicado");
    expect(linhas[1].textContent).toContain("1 variante ·");
    expect(linhas[2].textContent).toContain("Pronto");
  });

  it("clicar no nome abre o armário (muda ?armario=) preservando coleção e sub", async () => {
    const onSearch = await montar(URL_OK);
    await clicar(botao("Destaques"));
    expect(onSearch).toHaveBeenCalledWith({ colecao: "c1", sub: "Verão", armario: "a2" });
  });

  it("com ?armario= renderiza a montagem (D4) do armário e volta à lista", async () => {
    const onSearch = await montar({ ...URL_OK, armario: "a1" });
    expect(document.querySelector('[data-testid="montagem-stub"]')?.getAttribute("data-id")).toBe("a1");
    expect(document.querySelectorAll('[data-testid="armario-linha"]').length).toBe(0);
    await clicar(botao("Voltar à lista"));
    expect(onSearch).toHaveBeenCalledWith({ colecao: "c1", sub: "Verão" });
  });
});

describe("ArmarioListPage — menu ⋯ e trava de publicado", () => {
  it("menu ⋯ oferece Renomear, Duplicar, a transição de status válida e Excluir", async () => {
    await montar(URL_OK);
    await abrirMenu(0); // rascunho → só "Marcar como pronto"
    for (const t of ["Renomear", "Duplicar", "Marcar como pronto", "Excluir"]) expect(botao(t), t).toBeTruthy();
    expect(botao("Publicar")).toBeFalsy();
    expect(botao("Renomear")?.disabled).toBe(false);
    expect(botao("Excluir")?.disabled).toBe(false);
  });

  it("pronto oferece Publicar e Voltar para rascunho", async () => {
    await montar(URL_OK);
    await abrirMenu(2);
    expect(botao("Publicar")).toBeTruthy();
    expect(botao("Voltar para rascunho")).toBeTruthy();
    await clicar(botao("Publicar"));
    expect(rpcMock).toHaveBeenCalledWith("armario_status", { _id: "a3", _novo: "publicado" });
  });

  it("publicado trava Renomear e Excluir; só Despublicar (e Duplicar) ficam disponíveis", async () => {
    await montar(URL_OK);
    await abrirMenu(1);
    expect(botao("Renomear")?.disabled).toBe(true);
    expect(botao("Excluir")?.disabled).toBe(true);
    expect(botao("Duplicar")?.disabled).toBe(false);
    expect(botao("Despublicar")).toBeTruthy();
    expect(botao("Publicar")).toBeFalsy();
    await clicar(botao("Despublicar"));
    expect(rpcMock).toHaveBeenCalledWith("armario_status", { _id: "a2", _novo: "pronto" });
  });

  it("Excluir pede confirmação (AlertDialog) antes de chamar a RPC", async () => {
    await montar(URL_OK);
    await abrirMenu(0);
    await clicar(botao("Excluir"));
    expect(texto()).toContain("Excluir armário?");
    expect(rpcMock).not.toHaveBeenCalled();
    const confirmar = botoes().filter((b) => b.textContent?.trim() === "Excluir").pop();
    await clicar(confirmar);
    expect(rpcMock).toHaveBeenCalledWith("armario_excluir", { _id: "a1" });
  });

  it("Duplicar sugere «nome (cópia)» e chama armario_duplicar", async () => {
    await montar(URL_OK);
    await abrirMenu(0);
    await clicar(botao("Duplicar"));
    const input = document.getElementById("armario-nome") as HTMLInputElement;
    expect(input.value).toBe("Vitrine Verão (cópia)");
    await clicar(botoes().filter((b) => b.textContent?.trim() === "Duplicar").pop());
    expect(rpcMock).toHaveBeenCalledWith("armario_duplicar", { _id: "a1", _novo_nome: "Vitrine Verão (cópia)" });
  });

  it("somente leitura: sem Novo, sem transição de status, ações travadas", async () => {
    permissao.readOnly = true;
    await montar(URL_OK);
    expect(botao("Novo armário")?.disabled).toBe(true);
    await abrirMenu(2);
    expect(botao("Publicar")).toBeFalsy();
    expect(botao("Excluir")?.disabled).toBe(true);
    expect(botao("Renomear")?.disabled).toBe(true);
  });

  it("Novo armário pede o nome e chama armario_criar com coleção/subcoleção", async () => {
    await montar(URL_OK);
    await clicar(botao("Novo armário"));
    const input = document.getElementById("armario-nome") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Novo A");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicar(botoes().filter((b) => b.textContent?.trim() === "Criar").pop());
    expect(rpcMock).toHaveBeenCalledWith("armario_criar", { _colecao_id: "c1", _colecao: "Coleção 2027", _subcolecao: "Verão", _nome: "Novo A" });
  });
});

describe("ArmarioListPage — reordenar", () => {
  it("soltar um armário chama armario_reordenar com a lista INTEIRA de ids na nova ordem", async () => {
    rpcMock.mockImplementation(() => new Promise(() => {})); // RPC em voo: o que se vê é o update otimista
    await montar(URL_OK);
    expect(dnd.onDragEnd).toBeTruthy();
    await act(async () => { dnd.onDragEnd!({ active: { id: "a3" }, over: { id: "a1" } }); });
    await tick(5);
    expect(rpcMock).toHaveBeenCalledWith("armario_reordenar", { _subcolecao_ids: ["a3", "a1", "a2"] });
    // otimista: a lista já mostra a nova ordem
    const nomes = Array.from(document.querySelectorAll('[data-testid="armario-linha"]')).map((l) => l.querySelector("button[title='Abrir armário']")?.textContent);
    expect(nomes[0]).toBe("Promo");
  });

  it("soltar no mesmo lugar não chama a RPC", async () => {
    await montar(URL_OK);
    await act(async () => { dnd.onDragEnd!({ active: { id: "a1" }, over: { id: "a1" } }); });
    expect(rpcMock).not.toHaveBeenCalledWith("armario_reordenar", expect.anything());
  });

  it("erro da RPC de reordenar vira toast em PT-BR", async () => {
    rpcMock.mockImplementation(async (nome: string) =>
      nome === "armario_reordenar" ? { data: null, error: { code: "P0001", message: "armario_ids_invalido: id malformado na lista" } } : { data: null, error: null });
    await montar(URL_OK);
    await act(async () => { dnd.onDragEnd!({ active: { id: "a3" }, over: { id: "a1" } }); });
    await tick(10);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Atualize a tela"));
  });
});

describe("mensagemArmario", () => {
  it("traduz os prefixos do backend e cai no genérico quando desconhecido", () => {
    expect(mensagemArmario({ code: "P0001", message: "armario_publicado_travado: armario publicado e so-leitura" })).toContain("Despublique");
    expect(mensagemArmario({ code: "42501", message: "modulo_desligado: criacao" })).toContain("desligado");
    expect(mensagemArmario({ code: "P0001", message: "armario_nome_obrigatorio: informe o nome" })).toContain("nome");
    expect(typeof mensagemArmario(new Error("xyz"), "Erro tal")).toBe("string");
  });
});
