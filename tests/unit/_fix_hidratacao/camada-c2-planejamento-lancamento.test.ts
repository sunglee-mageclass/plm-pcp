// @vitest-environment happy-dom
// [camada C2 · P-263 A / 1.1] "Cancelar Lançamento" no Sheet do Planejamento desfaz o lançamento — pede "Tem certeza?".
// Sheet REAL (`PlanejamentoDetail`) + Supabase falso: clicar abre o diálogo aprovado e NÃO chama lancar_modelo; Voltar não chama;
// "Cancelar lançamento" chama lancar_modelo(_send:false) UMA vez. "Lançar" (Seção 2) NÃO ganhou diálogo.
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
    createFileRoute: () => (opts: any) => ({ options: opts }),
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
import { PlanejamentoDetail } from "@/components/planejamento/PlanejamentoDetail";
import { SidebarProvider } from "@/components/ui/sidebar";

const linhaModelo = (over: Record<string, unknown> = {}) => ({
  id: "m1", tenant_id: "t1", nome: "BLUSA TESTE", ref: "R1", origem: "interno", status_planejamento: "planejado", versao: 1,
  titulo_pagina: null, ncm: "0000.00.00", peso_kg: null, rev: 5, ordem_criacao_enviada: false, enviado_cad: false, lancado: true,
  data_lancamento: "2026-10-01", tamanho_tipo: "letra", tecidos_planejados: [], fotos_modelo: [], fotos_referencia: [], ...over,
});

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenants = [{ id: "t1", nome: "Loja Teste" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", status_kanban: ["Em Modelagem", "Aprovado"] }];
  FAKE.linhas.modelos = [linhaModelo()];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const botao = (t: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:lancar_modelo");
async function abrir() {
  const qc = new QueryClient();
  const m = await montar(createElement(QueryClientProvider, { client: qc },
    createElement(SidebarProvider, null,
      createElement(PlanejamentoDetail, { modeloId: "m1", onClose: () => {}, onSaved: () => {} }))));
  desmontar = m.desmontar;
}

describe("[camada C2 · 1.1] Sheet do Planejamento — Cancelar Lançamento", () => {
  it("abre o diálogo aprovado sem chamar a RPC; Voltar não chama; Cancelar lançamento chama lancar_modelo(_send:false) UMA vez", async () => {
    await abrir();
    // a seção "Lançamento" nasce recolhida: abre pelo cabeçalho
    const cabecalho = () => Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => /Lançamento/.test(b.textContent ?? "") && !/Cancelar|Lançar$/.test((b.textContent ?? "").trim()) && b.getAttribute("aria-expanded") === "false") ?? null;
    await aguardar(() => !!cabecalho() || !!botao("Cancelar Lançamento"), "cabeçalho da seção Lançamento", 4000);
    if (!botao("Cancelar Lançamento")) await clicar(cabecalho()!);
    await aguardar(() => !!botao("Cancelar Lançamento"), "botão Cancelar Lançamento", 4000);
    await clicar(botao("Cancelar Lançamento")!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Cancelar o lançamento de “BLUSA TESTE”?");
    expect(dialogo()!.textContent).toContain("O modelo R1 deixa de constar como lançado e sai da contagem de Lançados nos dashboards. A data de lançamento (01/10/2026) é mantida e dá para lançar de novo depois.");
    expect(rpcs()).toHaveLength(0);
    expect(botaoDialogo("Cancelar lançamento")!.className).toContain("destructive");

    await clicar(botaoDialogo("Voltar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(50);
    expect(rpcs()).toHaveLength(0); // Voltar não grava
    expect(botao("Cancelar Lançamento")).not.toBeNull(); // continua lançado

    await clicar(botao("Cancelar Lançamento")!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Cancelar lançamento")!);
    await aguardar(() => rpcs().length === 1, "lancar_modelo chamada");
    expect(rpcs()[0].payload).toMatchObject({ _modelo_id: "m1", _send: false });
    await esperar(50);
    expect(rpcs()).toHaveLength(1);
  });
});
