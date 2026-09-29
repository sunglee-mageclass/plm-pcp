// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — revisão final, achado F1, review-final.md).
// Trazido do probe do revisor `p4-nomenclaturas.test.ts`. O diálogo "Nomenclaturas" (Config da
// Loja) engolia o erro na leitura de `tenant_config` (`nomenclaturas_edit`), e o Salvar do
// diálogo só olhava `saveMut.isPending` — nunca esperou a leitura assentar. Clicar Salvar com a
// leitura ainda em voo, OU depois de uma falha (que nunca hidrata), fazia o upsert gravar
// `tab_labels`/`campos_editaveis` VAZIOS por cima das nomenclaturas reais da loja.
// T3 da Config colaborativa (29/set): o diálogo segue com o upsert PRÓPRIO até a T5 (RPC com base por
// mapa); o Salvar da PÁGINA foi para a RPC `salvar_config_loja` — as asserções abaixo conferem que
// NENHUM dos dois caminhos grava (nem upsert do diálogo, nem RPC da página).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, etapas_pl: false };
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

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/admin/configuracoes";
import { SidebarProvider } from "@/components/ui/sidebar";

const ORIGINAL = "Moda, Atum, Queijo";
const linhaServidor = () => ({
  tenant_id: "t1", keywords: ORIGINAL, timezone: "America/Sao_Paulo", kanban_automatico: false,
  modules: {}, tab_labels: { producao: "Fábrica", cadastro: "Cadastros da Loja" }, campos_editaveis: { ref: "Código" },
  status_kanban: ["Em Modelagem", "Aprovado"],
});

const kw = () => document.querySelector<HTMLTextAreaElement>("#cfg-keywords");

let desmontar: (() => Promise<void>) | null = null;
async function abrirPagina() {
  const qc = new QueryClient();
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
  return qc;
}
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [linhaServidor()];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação revisão final] F1 — diálogo Nomenclaturas (Config da Loja)", () => {
  it("Salvar do diálogo com a leitura ainda em voo — fica TRAVADO, sem upsert de tab_labels/campos_editaveis vazios", async () => {
    await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "página hidratou");
    const soltar = FAKE.segurar("tenant_config"); // a leitura DO DIÁLOGO (enabled só com open) fica em voo
    await clicar(botaoPorTexto("Editar nomenclaturas por módulo")!);
    await aguardar(() => !!document.querySelector('[role="dialog"]'), "diálogo aberto");
    const salvarDlg = botaoPorTexto("Salvar");
    // Fix F1: Salvar do diálogo trava enquanto a leitura não assentou.
    expect(salvarDlg?.disabled).toBe(true);
    soltar();
    await esperar(80);
    const up = FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert").at(-1);
    expect(up).toBeUndefined();
    expect(FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja")).toHaveLength(0);
  });

  it("leitura do diálogo FALHA (erro engolido antes; agora lança) — Salvar fica TRAVADO, nunca upserta vazio", async () => {
    await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "página hidratou");
    FAKE.falhar("tenant_config", 1);
    await clicar(botaoPorTexto("Editar nomenclaturas por módulo")!);
    await aguardar(() => !!document.querySelector('[role="dialog"]'), "diálogo aberto");
    await esperar(100);
    const salvarDlg = botaoPorTexto("Salvar");
    expect(salvarDlg?.disabled).toBe(true);
    const up = FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert").at(-1);
    expect(up).toBeUndefined();
    expect(FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja")).toHaveLength(0);
  });
});
