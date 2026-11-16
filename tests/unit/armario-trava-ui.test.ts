// @vitest-environment happy-dom
// F7 Armário · D5 — confirmações (Publicar/Despublicar/Excluir) + trava de UI + mensagens traduzidas na LISTA.
// Harness igual ao do D2 (react-dom + happy-dom, supabase mockado).
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


const statusChamadas = () => rpcMock.mock.calls.filter((c) => c[0] === "armario_status");
const confirmar = (rotulo: string) => botoes().filter((b) => b.textContent?.trim() === rotulo).pop();

describe("Armário (lista) — confirmação em Publicar / Despublicar", () => {
  it("Publicar pede confirmação; Cancelar NÃO executa", async () => {
    await montar(URL_OK);
    await abrirMenu(2); // pronto
    await clicar(botao("Publicar"));
    expect(texto()).toContain("Publicar “Promo”?");
    expect(texto()).toContain("API do e-commerce");
    expect(statusChamadas().length).toBe(0);
    await clicar(botao("Cancelar"));
    expect(statusChamadas().length).toBe(0);
  });

  it("Publicar: Confirmar executa UMA vez (pronto → publicado)", async () => {
    await montar(URL_OK);
    await abrirMenu(2);
    await clicar(botao("Publicar"));
    await clicar(confirmar("Publicar"));
    expect(statusChamadas()).toEqual([["armario_status", { _id: "a3", _novo: "publicado" }]]);
  });

  it("Despublicar pede confirmação; Cancelar não executa, Confirmar executa UMA vez (publicado → pronto)", async () => {
    await montar(URL_OK);
    await abrirMenu(1); // publicado
    await clicar(botao("Despublicar"));
    expect(texto()).toContain("Despublicar “Destaques”?");
    expect(texto()).toContain("Volta para Pronto");
    await clicar(botao("Cancelar"));
    expect(statusChamadas().length).toBe(0);
    await abrirMenu(1);
    await clicar(botao("Despublicar"));
    await clicar(confirmar("Despublicar"));
    expect(statusChamadas()).toEqual([["armario_status", { _id: "a2", _novo: "pronto" }]]);
  });

  it("Marcar como pronto e Voltar para rascunho são transições leves: executam direto, sem confirmação", async () => {
    await montar(URL_OK);
    await abrirMenu(0); // rascunho
    await clicar(botao("Marcar como pronto"));
    expect(statusChamadas()).toEqual([["armario_status", { _id: "a1", _novo: "pronto" }]]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await abrirMenu(2); // pronto
    await clicar(botao("Voltar para rascunho"));
    expect(statusChamadas()).toContainEqual(["armario_status", { _id: "a3", _novo: "rascunho" }]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("Armário (lista) — Excluir e trava de publicado", () => {
  it("Excluir de publicado fica desabilitado com a dica «despublique antes»; clicar não abre nada", async () => {
    await montar(URL_OK);
    await abrirMenu(1);
    const b = botao("Excluir")!;
    expect(b.disabled).toBe(true);
    expect(b.title).toContain("despublique antes");
    await clicar(b);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("Excluir de não-publicado mantém o AlertDialog: Cancelar não executa, Excluir executa UMA vez", async () => {
    await montar(URL_OK);
    await abrirMenu(0);
    await clicar(botao("Excluir"));
    expect(texto()).toContain("Excluir armário?");
    await clicar(botao("Cancelar"));
    expect(rpcMock).not.toHaveBeenCalled();
    await abrirMenu(0);
    await clicar(botao("Excluir"));
    await clicar(confirmar("Excluir"));
    expect(rpcMock.mock.calls.filter((c) => c[0] === "armario_excluir")).toEqual([["armario_excluir", { _id: "a1" }]]);
  });

  it("publicado: Renomear também trava com dica, e só Despublicar sobra de status", async () => {
    await montar(URL_OK);
    await abrirMenu(1);
    expect(botao("Renomear")?.disabled).toBe(true);
    expect(botao("Renomear")?.title).toContain("despublique antes");
    expect(botao("Despublicar")).toBeTruthy();
    expect(botao("Marcar como pronto")).toBeFalsy();
  });
});

describe("Armário (lista) — erros das RPCs traduzidos por mensagemArmario", () => {
  const erroRpc = (nome: string, code: string, message: string) =>
    rpcMock.mockImplementation(async (n: string) => (n === nome ? { data: null, error: { code, message } } : { data: null, error: null }));

  it("status inválido (P0001 armario_status_invalido) vira PT-BR no toast", async () => {
    erroRpc("armario_status", "P0001", "armario_status_invalido: transicao nao permitida");
    await montar(URL_OK);
    await abrirMenu(0);
    await clicar(botao("Marcar como pronto"));
    await tick(10);
    expect(toastMock.error).toHaveBeenCalledWith(mensagemArmario({ message: "armario_status_invalido: x" }));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("não é permitida"));
  });

  it("Publicar confirmado com armario_nao_encontrado: toast traduzido (não o texto técnico)", async () => {
    erroRpc("armario_status", "P0001", "armario_nao_encontrado: id inexistente");
    await montar(URL_OK);
    await abrirMenu(2);
    await clicar(botao("Publicar"));
    await clicar(confirmar("Publicar"));
    await tick(10);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Atualize a tela"));
    expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringContaining("armario_nao_encontrado"));
  });

  it("Excluir recusado pelo backend (armario_publicado_travado) vira PT-BR no toast", async () => {
    erroRpc("armario_excluir", "P0001", "armario_publicado_travado: armario publicado e so-leitura");
    await montar(URL_OK);
    await abrirMenu(0);
    await clicar(botao("Excluir"));
    await clicar(confirmar("Excluir"));
    await tick(10);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("Despublique"));
  });

  it("42501 sem permissão (modulo_desligado) é traduzido", async () => {
    erroRpc("armario_status", "42501", "modulo_desligado: criacao");
    await montar(URL_OK);
    await abrirMenu(0);
    await clicar(botao("Marcar como pronto"));
    await tick(10);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("desligado"));
  });
});
