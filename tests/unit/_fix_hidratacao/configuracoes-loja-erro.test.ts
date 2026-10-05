// @vitest-environment happy-dom
// [backend F1, review m4] Config da Loja com a 1ª carga da loja/módulos FALHA: mostra <LojaErroAviso> (não fica em "Carregando…"
// para sempre) e o botão chama `tentarDeNovo`; durante a nova tentativa fica "Tentando…".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ mods: { erro: true, tentando: false, tentarDeNovo: () => {} } }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "" }));
vi.mock("@/hooks/useTenantModules", () => ({
  useTenantModules: () => ({
    modules: {}, isModuleEnabled: () => false, isStockOnly: false, firstActiveModulePath: "/",
    isLoading: true, pronto: false, erro: h.mods.erro, tentando: h.mods.tentando, tentarDeNovo: () => h.mods.tentarDeNovo(),
  }),
}));
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
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, { success() {}, error() {}, info() {}, warning() {}, message() {} }), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/admin/configuracoes";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
async function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
}

beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", keywords: "x", timezone: "America/Sao_Paulo", modules: {}, tab_labels: {}, campos_editaveis: {}, status_kanban: [] }];
  h.mods = { erro: true, tentando: false, tentarDeNovo: () => {} };
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("Config da Loja — 1ª carga da loja/módulos falhou", () => {
  it("mostra o aviso (não 'Carregando…') e 'Tentar de novo' chama tentarDeNovo", async () => {
    const tentar = vi.fn();
    h.mods.tentarDeNovo = tentar;
    await abrir();
    await esperar(100);
    expect(document.body.textContent).toContain("Não foi possível carregar a sua loja");
    expect(document.body.textContent).not.toContain("Carregando…");
    await clicar(botaoPorTexto("Tentar de novo")!);
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("durante a nova tentativa o aviso fica com o botão 'Tentando…' desabilitado", async () => {
    h.mods.tentando = true;
    await abrir();
    await esperar(100);
    const b = botaoPorTexto("Tentando…");
    expect(b).toBeTruthy();
    expect(b!.disabled).toBe(true);
  });
});
