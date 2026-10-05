// @vitest-environment happy-dom
// [camada C2 · P-263 A] Desmarcar a confirmação do CQ (Pré e Pós) pede "Tem certeza?" — telas REAIS montadas com o Supabase falso:
// clicar => abre o diálogo com o texto aprovado e NADA é gravado; Cancelar => nada é gravado; Confirmar => chama a RPC UMA vez.
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
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "confirmado" }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grade_total_real: 20 }];
  FAKE.linhas.cq_pos_variantes = [
    { id: "pv1", controle_qualidade_id: "cq1", producao_terceirizado_id: "pt1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 },
  ];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const texto = () => document.body.textContent ?? "";
const rpcs = (nome: string) => FAKE.chamadas.filter((c) => c.tabela === `rpc:${nome}`);
const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
async function abrir() {
  const qc = new QueryClient();
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
}

describe("[camada C2 · 1.2] CQ Pré — Desmarcar confirmação", () => {
  it("clicar abre o diálogo aprovado e NÃO chama a RPC; Cancelar não grava; Confirmar chama desmarcar_cq UMA vez", async () => {
    await abrir();
    const desmarcar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Desmarcar confirmação"]');
    await aguardar(() => !!desmarcar() && desmarcar()!.disabled === false, "botão Desmarcar confirmação habilitado");

    await clicar(desmarcar()!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Desmarcar a confirmação do CQ de “BLUSA”?");
    expect(dialogo()!.textContent).toContain("O CQ volta para pendente e pode ser editado. Junto com ele, voltam para pendente o CQ Pós e o Direcionamento (se já estavam confirmados), e a Grade Real volta ao valor planejado.");
    expect(dialogo()!.textContent).toContain("Serviços e contas a pagar não são apagados.");
    expect(rpcs("desmarcar_cq")).toHaveLength(0); // abrir o diálogo não grava
    // confirmar é vermelho (destrutivo) e cancelar = "Cancelar"
    expect(botaoDialogo("Desmarcar CQ")!.className).toContain("destructive");
    expect(botaoDialogo("Cancelar")).not.toBeNull();

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(50);
    expect(rpcs("desmarcar_cq")).toHaveLength(0); // Cancelar NÃO grava

    await clicar(desmarcar()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Desmarcar CQ")!);
    await aguardar(() => rpcs("desmarcar_cq").length === 1, "RPC desmarcar_cq chamada");
    expect((rpcs("desmarcar_cq")[0].payload as any)._cad_id).toBe("c1");
    await esperar(50);
    expect(rpcs("desmarcar_cq")).toHaveLength(1);
  });
});

describe("[camada C2 · 1.3] CQ Pós — Desmarcar confirmação", () => {
  it("clicar abre o diálogo aprovado e NÃO chama a RPC; Cancelar não grava; Confirmar chama desmarcar_cq_pos UMA vez", async () => {
    await abrir();
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós na tela");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    const desmarcar = () => botaoPorTexto("Desmarcar confirmação");
    await aguardar(() => !!desmarcar() && desmarcar()!.disabled === false, "botão Desmarcar confirmação (Pós) habilitado", 4000);

    await clicar(desmarcar()!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Desmarcar a confirmação do CQ Pós de “BLUSA”?");
    expect(dialogo()!.textContent).toContain("O CQ Pós volta para pendente e pode ser editado. O modelo deixa de estar liberado para Direcionamento e Lançar.");
    expect(dialogo()!.textContent).toContain("O CQ Pré não muda.");
    expect(rpcs("desmarcar_cq_pos")).toHaveLength(0);
    expect(botaoDialogo("Desmarcar CQ Pós")!.className).toContain("destructive");

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(50);
    expect(rpcs("desmarcar_cq_pos")).toHaveLength(0);

    await clicar(desmarcar()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Desmarcar CQ Pós")!);
    await aguardar(() => rpcs("desmarcar_cq_pos").length === 1, "RPC desmarcar_cq_pos chamada");
    await esperar(50);
    expect(rpcs("desmarcar_cq_pos")).toHaveLength(1);
    expect(texto()).toBeTruthy();
  });
});
