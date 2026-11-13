// @vitest-environment happy-dom
// Config da Loja › card "Etapas PL": salvar, SAIR da Config e VOLTAR — o card tem de mostrar as colunas gravadas.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "a@b.c" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: true, etapas_pl: true };
  return { useTenantModules: () => ({ modules, isModuleEnabled: (k: string) => !!(modules as any)[k], isStockOnly: false, firstActiveModulePath: "/", isLoading: false }) };
});
vi.mock("@tanstack/react-router", async (orig) => {
  const m: any = await orig();
  const { createElement } = await import("react");
  return {
    ...m,
    createFileRoute: () => (opts: any) => ({ options: opts }),
    Link: (p: any) => createElement("a", { href: String(p.to ?? "") }, p.children),
    Navigate: () => null,
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { createElement, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, digitar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/admin/configuracoes";
import { SidebarProvider } from "@/components/ui/sidebar";

const linhaServidor = () => ({
  tenant_id: "t1", timezone: "America/Sao_Paulo", kanban_automatico: false, modules: {}, tab_labels: {}, campos_editaveis: {},
  status_kanban: ["Em Modelagem", "Aprovado"],
  etapas_pl_kanban: [], etapas_pl_requisitos: {}, etapas_pl_automatico: false,
});

function Pagina() {
  const C = (Route as any).options.component;
  return createElement(SidebarProvider, null, createElement(C));
}

const salvar = () => botaoPorTexto("Salvar alterações")!;
const card = () => document.querySelector<HTMLElement>('[data-colab-path="cfg:etapas_pl"]')!;
// Os rótulos das colunas vivem em <input value>, não em textContent.
const textoCard = () => (card()?.textContent ?? "") + " " + Array.from(card()?.querySelectorAll("input") ?? []).map((i) => (i as HTMLInputElement).value).join("|");

async function adicionarColuna(nome: string) {
  const entrada = card().querySelector<HTMLInputElement>('input[placeholder="Ex: Em Produção"]')!;
  await digitar(entrada, nome);
  await clicar(Array.from(card().querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Adicionar") as HTMLElement);
}

let desmontar: (() => Promise<void>) | null = null;
// StrictMode como o app em dev (TanStack Start envolve o root): o efeito de hidratação roda 2x no mount quando o cache já tem dado.
async function abrirPagina(qc: QueryClient) {
  const m = await montar(createElement(StrictMode, null, createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
  desmontar = m.desmontar;
  await aguardar(() => !!card() && salvar()?.disabled === false, "página hidratada");
}

beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [linhaServidor()];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { vi.restoreAllMocks(); await desmontar?.(); desmontar = null; document.body.replaceChildren(); });

describe("Config da Loja › Etapas PL — salvar, sair e VOLTAR", () => {
  async function salvarColunas() {
    await adicionarColuna("Peça Teste");
    await adicionarColuna("asd");
    await clicar(salvar());
    await esperar(50);
    const confirmar = botaoPorTexto("Salvar mesmo assim");
    if (confirmar) await clicar(confirmar);
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Configurações salvas"), "toast de sucesso");
    await esperar(300);
  }

  it("mesmo QueryClient (navegação do app): ao voltar o card mostra as colunas", async () => {
    const qc = new QueryClient();
    await abrirPagina(qc);
    await salvarColunas();
    expect(FAKE.linhas.tenant_config[0].etapas_pl_kanban).toEqual(["Peça Teste", "asd"]);
    await desmontar!(); desmontar = null;          // sai da Config
    await abrirPagina(qc);                          // volta
    await esperar(300);
    expect(textoCard()).toContain("Peça Teste");
    expect(textoCard()).toContain("asd");
    expect(textoCard()).not.toContain("Nenhum item ainda");
  });

  it("QueryClient novo (F5): ao voltar o card mostra as colunas", async () => {
    const qc = new QueryClient();
    await abrirPagina(qc);
    await salvarColunas();
    await desmontar!(); desmontar = null;
    await abrirPagina(new QueryClient());
    await esperar(300);
    expect(textoCard()).toContain("Peça Teste");
    expect(textoCard()).not.toContain("Nenhum item ainda");
  });

  it("volta com o CACHE VELHO (saiu antes do refetch pós-save chegar): o refetch traz as colunas e o card as mostra", async () => {
    const qc = new QueryClient();
    await abrirPagina(qc);
    await salvarColunas();
    await desmontar!(); desmontar = null;
    // o cache ficou com a linha de ANTES do save (refetch pós-save ainda em voo quando saiu)
    qc.setQueryData(["tenant-config", "u1"], { tenantId: "t1", cfg: linhaServidor() });
    await abrirPagina(qc);
    await esperar(400);
    expect(textoCard()).toContain("Peça Teste");
    expect(textoCard()).toContain("asd");
  });
});
