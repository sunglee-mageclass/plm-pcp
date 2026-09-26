// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — CQ Pós (metade 1). `_salvar_cq_pos_core` audita
// como "estado completo": `DELETE FROM cq_pos_variantes WHERE controle_qualidade_id=...` antes de
// reinserir o payload (subagente, 26/set). `CqPosView` já tinha `hydrated` interno, mas não o
// reportava ao pai (que renderiza os botões Salvar/Confirmar/Desmarcar do Pós). Prova: com a aba
// Pós aberta e `cq_pos_variantes`/`controle_qualidade` ainda em voo, os botões do Pós ficam
// desabilitados.
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
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
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
  FAKE.linhas.producao_terceirizados = [
    { id: "pt1", cad_id: "c1", categoria_terceirizado_id: "catpos", ativo: true, data_enviado: null, data_prevista: null, data_entregue: null },
  ];
  FAKE.linhas.categorias_terceirizado = [{ id: "catpos", tenant_id: "t1", nome: "Lavanderia", ativo: true, etapa: "pos_costura" }];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "pendente" }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grade_total_real: 20 }];
  FAKE.linhas.cq_pos_variantes = [];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] CQ Pós — Salvar/Confirmar/Desmarcar travam ANTES da hidratação (P-57 A)", () => {
  it("aba Pós aberta com controle_qualidade/cq_pos_variantes ainda em voo: botões do Pós ficam DESABILITADOS", async () => {
    const soltar = FAKE.segurar("cq_pos_variantes");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós na tela");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    const salvarPos = () => botaoPorTexto("Salvar");
    await aguardar(() => !!salvarPos(), "botão Salvar do Pós na tela");
    await esperar(50);
    expect(salvarPos()!.disabled).toBe(true); // ← fix: travado enquanto o Pós não hidratou

    soltar();
    await aguardar(() => salvarPos()?.disabled === false, "destrava após hidratar", 2000);
  });
});
