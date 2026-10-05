// @vitest-environment happy-dom
// [camada C2 · P-263 A / 1.1] O foguete verde do card (lista do Planejamento) desfaz o lançamento — pede "Tem certeza?".
// Página REAL do Planejamento + Supabase falso: clicar abre o diálogo aprovado e NÃO chama lancar_modelo; Voltar não chama;
// "Cancelar lançamento" chama lancar_modelo(_send:false) UMA vez.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, produto_importado: false, etapas_pl: false };
  return { useTenantModules: () => ({ modules, isModuleEnabled: (k: string) => !!(modules as any)[k], isStockOnly: false, firstActiveModulePath: "/", isLoading: false }) };
});
vi.mock("@tanstack/react-router", async (orig) => {
  const m: any = await orig();
  const { createElement } = await import("react");
  return {
    ...m,
    createFileRoute: () => (opts: any) => ({ options: opts, useSearch: () => ({}), useParams: () => ({}) }),
    Link: (p: any) => createElement("a", { href: String(p.to ?? "") }, p.children),
    Navigate: () => null,
    useNavigate: () => () => {},
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/criacao.planejamento";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenants = [{ id: "t1", nome: "Loja Teste" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", status_kanban: ["Em Modelagem", "Aprovado"] }];
  FAKE.linhas.modelos = [{
    id: "m1", tenant_id: "t1", nome: "BLUSA TESTE", ref: "R1", origem: "interno", status_planejamento: "planejado", versao: 1,
    lancado: true, data_lancamento: "2026-10-01", ordem_criacao_enviada: false, enviado_cad: false, created_at: "2026-09-01T00:00:00Z",
  }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const foguete = () => document.querySelector<HTMLButtonElement>('button[aria-label="Cancelar lançamento"]');
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:lancar_modelo");

describe("[camada C2 · 1.1] Lista do Planejamento — foguete verde (Cancelar lançamento)", () => {
  it("abre o diálogo aprovado sem chamar a RPC; Voltar não chama; Cancelar lançamento chama lancar_modelo(_send:false) UMA vez", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    // os cards nascem recolhidos: "Expandir todos" mostra a linha de Lançamento com o foguete
    await aguardar(() => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent ?? "").includes("Expandir todos")), "botão Expandir todos", 4000);
    await clicar(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Expandir todos"))!);
    await aguardar(() => !!foguete(), "foguete do card lançado", 5000);
    await clicar(foguete()!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Cancelar o lançamento de “BLUSA TESTE”?");
    expect(dialogo()!.textContent).toContain("O modelo R1 deixa de constar como lançado e sai da contagem de Lançados nos dashboards. A data de lançamento (01/10/2026) é mantida e dá para lançar de novo depois.");
    expect(rpcs()).toHaveLength(0);

    await clicar(botaoDialogo("Voltar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(50);
    expect(rpcs()).toHaveLength(0);

    await clicar(foguete()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Cancelar lançamento")!);
    await aguardar(() => rpcs().length === 1, "lancar_modelo chamada");
    expect(rpcs()[0].payload).toMatchObject({ _modelo_id: "m1", _send: false });
    await esperar(50);
    expect(rpcs()).toHaveLength(1);
  });
});
