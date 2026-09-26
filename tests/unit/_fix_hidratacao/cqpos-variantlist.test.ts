// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — revisão final, achado C1, review-final.md). Trazido
// do probe do revisor `p1-cqpos-variantlist.test.ts`. `CqPosView.buildItens()` itera o
// `variantList` que vem do PAI (`expedicao.cq.$modeloId.tsx`, via `mainFabric`/`modeloGrades`),
// mas o gate interno do Pós (`posBtn.hydrated`) só espera as PRÓPRIAS queries do Pós — nunca
// esperou o Pré (que resolve o `variantList`) assentar. Com `cad_tecidos`/`modelo_grades` em voo
// OU em erro, `variantList=[]`; o Pós hidrata mesmo assim (suas próprias queries respondem):
// Salvar/Confirmar do Pós ficavam HABILITADOS e mandavam `_itens: []`. `_salvar_cq_pos_core`
// (supabase/migrations/20260720290000_cq_pos_datas_conserto.sql:57-66) trata o payload como
// "estado completo" — DELETE incondicional de `cq_pos_variantes` antes de reinserir, sem
// rev-check — apaga TODA a contagem do Pós.
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
  FAKE.linhas.cad_tecidos = [{ cad_id: "c1", tipo: "tecido", numero: 1, cad_tecido_variantes: [{ ordem: 1, variante_tecido_id: "vt1", variantes_tecido: { nome_variante: "AZUL" } }] }];
  FAKE.linhas.modelo_grades = [{ modelo_id: "m1", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["P", "M"] }];
  FAKE.linhas.producao_terceirizados = [
    { id: "pt1", cad_id: "c1", categoria_terceirizado_id: "catpos", ativo: true, data_enviado: null, data_prevista: null, data_entregue: null, categorias_terceirizado: { nome: "Lavanderia", etapa: "pos_costura" } },
  ];
  FAKE.linhas.categorias_terceirizado = [{ id: "catpos", tenant_id: "t1", nome: "Lavanderia", ativo: true, etapa: "pos_costura" }];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "pendente", observacoes_cq_pos: "obs" }];
  FAKE.linhas.cq_variantes = [];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grade_total_real: 20 }];
  FAKE.linhas.cq_pos_variantes = [
    { id: "pv1", controle_qualidade_id: "cq1", producao_terceirizado_id: "pt1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 },
  ];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação revisão final] C1 — CQ Pós com variantList do pai ainda vazio", () => {
  it("controle: tudo carregado ⇒ Salvar do Pós manda _itens com a linha existente", async () => {
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    await aguardar(() => botaoPorTexto("Salvar")?.disabled === false, "Salvar Pós habilitado");
    await esperar(50);
    await clicar(botaoPorTexto("Salvar")!);
    await esperar(50);
    const call = FAKE.chamadas.find((c) => c.tabela === "rpc:salvar_cq_pos");
    expect(((call?.payload as any)?._itens ?? []).length).toBe(1);
  });

  it("cad_tecidos + modelo_grades em voo (variantList=[]) — Salvar do Pós fica TRAVADO, sem chamar salvar_cq_pos", async () => {
    const soltarTec = FAKE.segurar("cad_tecidos");
    const soltarMg = FAKE.segurar("modelo_grades");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    await aguardar(() => document.body.textContent?.includes("Observações do CQ Pós") ?? false, "Pós hidratou");
    await esperar(50);
    const btn = botaoPorTexto("Salvar");
    // Fix C1: Salvar do Pós agora exige `hydrated` do Pré (que precisa de mainFabric/modeloGrades).
    expect(btn?.disabled).toBe(true);
    soltarTec(); soltarMg();
    await esperar(100);
    expect(FAKE.chamadas.some((c) => c.tabela === "rpc:salvar_cq_pos")).toBe(false);
  });

  it("cad_tecidos + modelo_grades FALHAM (Pré mostra banner) e a aba Pós é aberta — Salvar do Pós fica TRAVADO", async () => {
    FAKE.falhar("cad_tecidos", 10);
    FAKE.falhar("modelo_grades", 10);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => document.body.textContent?.includes("Não foi possível carregar") ?? false, "banner do Pré");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    await aguardar(() => document.body.textContent?.includes("Observações do CQ Pós") ?? false, "Pós hidratou");
    await esperar(50);
    const btn = botaoPorTexto("Salvar");
    expect(btn?.disabled).toBe(true);
    const call = FAKE.chamadas.find((c) => c.tabela === "rpc:salvar_cq_pos");
    expect(call).toBeUndefined();
  });
});
