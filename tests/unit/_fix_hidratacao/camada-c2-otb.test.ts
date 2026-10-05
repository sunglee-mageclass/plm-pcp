// @vitest-environment happy-dom
// [camada C2 · P-263 A / 1.5 e 1.6] OTB: "Desconfirmar" a coleção (orçamento e Poder de Venda) desfaz a confirmação — pede "Tem certeza?".
// Sheets REAIS + Supabase falso: abrir o diálogo não chama a RPC; Cancelar não chama; Confirmar chama otb_desconfirmar UMA vez.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = { user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [], canView: () => true, canEdit: () => true, loading: false, signOut: async () => {} };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: true, produto_acabado: false, produto_importado: false, etapas_pl: false };
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
import { ColecaoSheet } from "@/components/otb/ColecaoSheet";
import { ColecaoPVSheet } from "@/components/otb/ColecaoPVSheet";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.colecoes = [{ id: "col1", tenant_id: "t1", nome: "Verão 27", status: "confirmada", otb_rev: 2, tipo: "orcamento" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const desconfirmar = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.getAttribute("aria-label") === "Desconfirmar" || (b.textContent ?? "").trim() === "Desconfirmar") ?? null;
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:otb_desconfirmar");
async function abrir(el: ReturnType<typeof createElement>) {
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, el));
  desmontar = m.desmontar;
  await aguardar(() => !!desconfirmar(), "botão Desconfirmar", 4000);
}
async function percorrer(textoCorpo: string) {
  await clicar(desconfirmar()!);
  await aguardar(() => !!dialogo(), "diálogo aberto");
  expect(dialogo()!.textContent).toContain("Desconfirmar a coleção “Verão 27”?");
  expect(dialogo()!.textContent).toContain(textoCorpo);
  expect(rpcs()).toHaveLength(0); // abrir o diálogo não chama a RPC
  expect(botaoDialogo("Desconfirmar")!.className).toContain("destructive");

  await clicar(botaoDialogo("Cancelar")!);
  await aguardar(() => !dialogo(), "diálogo fechado");
  await esperar(50);
  expect(rpcs()).toHaveLength(0); // Cancelar não chama

  await clicar(desconfirmar()!);
  await aguardar(() => !!dialogo(), "diálogo reaberto");
  await clicar(botaoDialogo("Desconfirmar")!);
  await aguardar(() => rpcs().length === 1, "otb_desconfirmar chamada");
  expect((rpcs()[0].payload as any)._colecao_id).toBe("col1");
  await esperar(50);
  expect(rpcs()).toHaveLength(1);
}

describe("[camada C2 · 1.5] OTB — Desconfirmar coleção (orçamento)", () => {
  it("pede confirmação antes de voltar a rascunho", async () => {
    await abrir(createElement(ColecaoSheet, { colecaoId: "col1", meses: [], anos: [], onClose: () => {}, onSaved: () => {} }));
    await percorrer("A coleção volta para rascunho e pode ser editada de novo. Os cards já criados no Planejamento continuam como estão.");
  });
});

describe("[camada C2 · 1.6] OTB — Desconfirmar coleção (Poder de Venda)", () => {
  it("pede confirmação antes de voltar a rascunho", async () => {
    FAKE.linhas.colecoes = [{ id: "col1", tenant_id: "t1", nome: "Verão 27", status: "confirmada", otb_rev: 2, tipo: "poder_venda", subcolecoes: [], itens: [] }];
    await abrir(createElement(ColecaoPVSheet, { colecaoId: "col1", onClose: () => {}, onSaved: () => {} }));
    await percorrer("A coleção volta para rascunho e pode ser editada de novo. Os cards já criados no Planejamento continuam como estão; ao confirmar outra vez, os cards em branco são conferidos com o plano.");
  });
});
