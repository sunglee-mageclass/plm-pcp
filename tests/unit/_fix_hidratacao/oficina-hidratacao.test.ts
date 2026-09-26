// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — Oficina (metade 1, §4.3 da investigação).
// Auditoria confirmou (subagente, 26/set): `producao_oficina` NÃO tem RPC própria — o Salvar faz
// `.update()`/`.insert()` direto via PostgREST com TODO o `form` local (payload sempre "estado
// completo" da linha). Um clique cedo demais grava zeros por cima de um registro já existente
// (mesma classe de dano do Direcionamento, sem ser um DELETE). Prova só o lado do cliente: o
// Salvar fica desabilitado enquanto `producao_oficina`/`cad` ainda não hidrataram.
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
import { Route } from "@/routes/_authenticated/pcp.oficina.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", observacoes_molde: "molde real" }];
  FAKE.linhas.empresas = [{ id: "e1", nome_fantasia: "Oficina X", tipo: "servico" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["34|PPP", "36|PP"], oficina_interna: false }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_planejadas: { PPP: 5 }, grades_reais: { PPP: 5 }, grade_total_planejada: 5, grade_total_real: 5 }];
  FAKE.linhas.producao_oficina = [
    { id: "po1", cad_id: "c1", preco_por_peca: 12.5, quantidade_enviada: 100, quantidade_recebida: 90, quantidade_defeito: 2, observacao: "obs real" },
  ];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] Oficina — Salvar trava ANTES da hidratação (P-57 A)", () => {
  it("com o cad carregado e producao_oficina ainda em voo, o Salvar fica DESABILITADO", async () => {
    const soltar = FAKE.segurar("producao_oficina");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    await aguardar(() => !!salvar(), "botão Salvar na tela");
    await esperar(50);
    expect(salvar()!.disabled).toBe(true); // ← fix: travado enquanto producao_oficina não hidratou

    soltar();
    await aguardar(() => salvar()!.disabled === false, "destrava após hidratar", 2000);
  });
});
