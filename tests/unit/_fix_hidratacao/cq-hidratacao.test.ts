// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — CQ Pré + CQ Pós (metade 1, §4.3 da investigação).
// Auditoria confirmou (subagente, 26/set): `_salvar_cq_core` faz `DELETE FROM cq_variantes WHERE
// controle_qualidade_id=...` incondicional antes de reinserir o payload — "estado completo".
// `_salvar_cq_pos_core` faz o mesmo em `cq_pos_variantes`. Ambos os Salvar/Confirmar já existiam
// SEM olhar `hydrated`. Prova só o lado do cliente: os botões ficam desabilitados enquanto a
// query do CQ (`["cq", cad?.id]`) ainda não assentou.
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
import { Route } from "@/routes/_authenticated/expedicao.cq.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C", subcolecao: "", semana: 1, origem: "interno" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1" }];
  FAKE.linhas.cad_tecidos = [{ cad_id: "c1", tipo: "tecido", numero: 1 }];
  FAKE.linhas.modelo_grades = [{ modelo_id: "m1", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"] }];
  FAKE.linhas.producao_terceirizados = [];
  FAKE.linhas.categorias_terceirizado = [];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "pendente", status_pos: "pendente" }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] CQ Pré — Salvar/Confirmar travam ANTES da hidratação (P-57 A)", () => {
  it("com o CAD carregado e controle_qualidade ainda em voo, Salvar e Confirmar ficam DESABILITADOS", async () => {
    const soltar = FAKE.segurar("controle_qualidade");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    const confirmar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Controle de Qualidade"]');
    await aguardar(() => !!salvar() && !!confirmar(), "botões na tela");
    await esperar(50);
    expect(salvar()!.disabled).toBe(true); // ← fix: travado enquanto controle_qualidade não hidratou
    expect(confirmar()!.disabled).toBe(true);

    soltar();
    await aguardar(() => salvar()!.disabled === false, "destrava após hidratar", 2000);
    expect(confirmar()!.disabled).toBe(false);
  });
});
