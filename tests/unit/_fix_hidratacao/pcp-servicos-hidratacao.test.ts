// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — PCP Serviços (metade 1, §4.3 da investigação).
// A tela já tinha `hydrated`/`moldeHydrated` (merge 3-vias no refetch), mas o botão Salvar não
// olhava para eles: um clique antes da 1ª carga terminar (query `producao_terceirizados` em voo)
// gravaria por cima do estado ainda vazio. Prova só o lado do cliente: o Salvar fica desabilitado
// enquanto `!hydrated || !moldeHydrated`.
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
    createFileRoute: () => (opts: any) => ({ options: opts, useParams: () => ({ modeloId: "m1" }), useSearch: () => ({}) }),
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
import { montar, esperar, aguardar } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/pcp.servicos.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", origem: "interno", tenant_id: "t1" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", observacoes_molde: "", sem_acabamento: false }];
  FAKE.linhas.producao_terceirizados = [
    { id: "pt1", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 1, grade_detalhe: {} },
  ];
  FAKE.linhas.categorias_terceirizado = [{ id: "cat1", tenant_id: "t1", nome: "Estamparia", ativo: true, etapa: "pre" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] PCP Serviços — Salvar trava ANTES da hidratação (P-57 A)", () => {
  it("com o cad carregado e producao_terceirizados ainda em voo, o Salvar fica DESABILITADO", async () => {
    const soltar = FAKE.segurar("producao_terceirizados");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    await aguardar(() => !!salvar(), "botão Salvar na tela");
    await esperar(50);
    expect(salvar()!.disabled).toBe(true); // ← fix: travado enquanto producao_terceirizados não hidratou

    soltar();
    await aguardar(() => salvar()!.disabled === false, "destrava após hidratar", 2000);
  });
});
