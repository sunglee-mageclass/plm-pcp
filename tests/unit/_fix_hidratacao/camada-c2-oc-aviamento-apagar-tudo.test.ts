// @vitest-environment happy-dom
// [camada C2 · P-262 A / Seção 3] OC de Aviamento: remover TODOS os itens e Salvar pede "Apagar todos os N itens da OC …?" — janela REAL da OC
// (`OcDialog`) com o Supabase falso. Cancelar => a RPC NÃO é chamada; Confirmar => salvar_oc_aviamento com a marca explícita de "apagar tudo".
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
import { OcDialog } from "@/routes/_authenticated/entrada-saida.oc-aviamento";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1" }];
  FAKE.linhas.ocs_aviamento = [{
    id: "oc1", tenant_id: "t1", numero_pedido: "A-0001", empresa_id: "e1", status: "encomendado", rev: 3,
    data_pedido: "2026-10-01", data_prevista_entrega: "2026-10-20", prazo_pagamento: "30", quantidade_prazos: 1, nfs: [],
    parcelas_recebimento: [{ data: "2026-10-20", recebido: false }],
  }];
  FAKE.linhas.ocs_aviamento_itens = [
    { id: "it1", oc_aviamento_id: "oc1", aviamento_id: "av1", variante_aviamento_id: null, quantidade_pedida: 5, quantidade_recebida: null, cancelado: false, preco: 2 },
    { id: "it2", oc_aviamento_id: "oc1", aviamento_id: "av1", variante_aviamento_id: null, quantidade_pedida: 7, quantidade_recebida: null, cancelado: false, preco: 2 },
  ];
  FAKE.linhas.aviamentos = [{ id: "av1", codigo_nome: "Botão", empresa_id: "e1", preco: 2, variantes: [] }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "Salvar") ?? null;
const lixeiras = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.querySelector("svg.lucide-trash-2") && !b.hasAttribute("aria-label"));
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_oc_aviamento");
async function abrir() {
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(SidebarProvider, null, createElement(OcDialog, { ocId: "oc1", empresas: [{ id: "e1", nome_fantasia: "Fornecedor X" } as any], onClose: () => {}, onSaved: () => {} }))));
  desmontar = m.desmontar;
  await aguardar(() => lixeiras().length === 2, "2 itens da OC na tela", 5000);
}

describe("[camada C2 · P-262 A] OC de Aviamento — Apagar todos os itens", () => {
  it("remover só UM item e Salvar NÃO pergunta nada (grava direto, sem marca)", async () => {
    await abrir();
    await clicar(lixeiras()[0]);
    await clicar(salvar()!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_aviamento chamada");
    expect(dialogo()).toBeNull();
    const p = rpcs()[0].payload as any;
    expect(p._itens).toHaveLength(1);
    expect(p._oc._apagar_itens).toBeUndefined();
  });

  it("remover TODOS e Salvar: abre o diálogo com N e NÃO chama a RPC; Cancelar não grava; Confirmar manda a marca UMA vez", async () => {
    await abrir();
    await clicar(lixeiras()[0]);
    await clicar(lixeiras()[0]);
    expect(lixeiras()).toHaveLength(0);
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar todos os 2 itens da OC A-0001?");
    expect(dialogo()!.textContent).toContain("Você removeu todos os aviamentos desta OC. Ao salvar, os 2 itens (quantidades e preços) serão apagados e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(botaoDialogo("Apagar todos")!.className).toContain("destructive");
    expect(rpcs()).toHaveLength(0);

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(80);
    expect(rpcs()).toHaveLength(0); // Cancelar: o Salvar não acontece
    expect(lixeiras()).toHaveLength(0); // as linhas continuam removidas no rascunho

    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_aviamento chamada após confirmar");
    const p = rpcs()[0].payload as any;
    expect(p._itens).toEqual([]);
    expect(p._oc._apagar_itens).toBe(true);
    await esperar(80);
    expect(rpcs()).toHaveLength(1);
  });
});
