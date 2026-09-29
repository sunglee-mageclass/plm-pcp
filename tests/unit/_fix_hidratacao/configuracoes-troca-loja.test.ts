// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — revisão final, achado C3, review-final.md).
// Trazido do probe do revisor `p3-config-troca-loja.test.ts`. REGRESSÃO desta branch: o merge
// 3-vias novo (`cfgBaseRef`) não era chaveado pela loja — um super_admin com edição não salva na
// loja A que troca para a loja B (o `invalidateQueries()` do `TenantSwitcher` refaz esta query, já
// trazendo a B) fazia o merge tratar o campo tocado na A como "meu" e sobreviver por cima do
// `next` da B: o Salvar então upserta a edição da A na loja ERRADA (B). Antes desta branch a tela
// era sobrescrita pela B (perdia a edição, mas não gravava na loja errada).
// T3 da Config colaborativa (29/set): o Salvar grava pela RPC `salvar_config_loja` (só colunas
// mudadas + base crua). Trocar de loja ZERA a base crua (`baseRawRef`) — a base da A nunca vai numa
// RPC da B. Sem edição na B, o Salvar nem chama a RPC ("Nenhuma alteração para salvar.").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, etapas_pl: false };
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
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, digitar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/admin/configuracoes";
import { SidebarProvider } from "@/components/ui/sidebar";

const ORIGINAL = "Moda, Atum, Queijo";
const linhaServidor = () => ({
  tenant_id: "t1", keywords: ORIGINAL, timezone: "America/Sao_Paulo", kanban_automatico: false,
  modules: {}, tab_labels: {}, campos_editaveis: {}, status_kanban: ["Em Modelagem", "Aprovado"],
});

const kw = () => document.querySelector<HTMLTextAreaElement>("#cfg-keywords");
const rpcsSalvar = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja").map((c) => c.payload as any);
const escritasDiretas = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && (c.op === "upsert" || c.op === "update"));

async function salvarComoAQa(toastEsperado: { tipo: "success" | "info"; texto: string }) {
  await clicar(botaoPorTexto("Salvar alterações")!);
  await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "AlertDialog de confirmação");
  await clicar(botaoPorTexto("Salvar mesmo assim")!);
  await aguardar(() => toastMock[toastEsperado.tipo].mock.calls.some((c) => c[0] === toastEsperado.texto), `toast "${toastEsperado.texto}"`);
}

let desmontar: (() => Promise<void>) | null = null;
let qcRef: QueryClient | null = null;
async function abrirPagina() {
  const qc = new QueryClient();
  qcRef = qc;
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
  return qc;
}
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [linhaServidor(), { ...linhaServidor(), tenant_id: "t2", keywords: "LOJA B ORIGINAL", timezone: "America/Manaus" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação revisão final] C3 — Config: super admin troca de loja com edição não salva", () => {
  it("a edição da loja A NÃO sobrevive ao refetch que já traz a loja B — o Salvar NÃO grava a edição de A na B", async () => {
    const qc = await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação (loja t1)");
    await digitar(kw()!, "EDITADO NA LOJA A");
    // outra aba: TenantSwitcher troca users.tenant_id → t2 e invalida tudo; esta aba refaz no foco
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries({ queryKey: ["tenant-config"] });
    await aguardar(() => document.body.textContent?.includes("Manaus / Amazonas (GMT-4)") ?? false, "form já mostra a loja t2", 2000);
    await aguardar(() => kw()?.value === "LOJA B ORIGINAL", "form mostra as keywords da loja t2", 2000);
    // Fix C3 + T3: a tela adotou o cru da B (a edição da A se perde, como antes desta branch — não
    // ideal, mas nunca grava dado da loja errada). Nada mudou na B ⇒ o Salvar nem chama a RPC.
    await salvarComoAQa({ tipo: "info", texto: "Nenhuma alteração para salvar." });
    expect(rpcsSalvar()).toHaveLength(0);
    expect(escritasDiretas()).toHaveLength(0);
    expect(FAKE.linhas.tenant_config.find((r) => r.tenant_id === "t2")!.keywords).toBe("LOJA B ORIGINAL");
    expect(FAKE.linhas.tenant_config.find((r) => r.tenant_id === "t1")!.keywords).toBe(ORIGINAL);
  });

  it("T3: trocar de loja ZERA a base crua — editar na B manda a base DA B (nunca a da A) e grava só na B", async () => {
    const qc = await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação (loja t1)");
    await digitar(kw()!, "EDITADO NA LOJA A");
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries({ queryKey: ["tenant-config"] });
    await aguardar(() => kw()?.value === "LOJA B ORIGINAL", "form mostra a loja t2", 2000);
    await digitar(kw()!, "EDITADO NA LOJA B");
    await salvarComoAQa({ tipo: "success", texto: "Configurações salvas" });
    const rpcs = rpcsSalvar();
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]._tenant_id).toBe("t2");
    expect(rpcs[0]._mudancas).toEqual({ keywords: "EDITADO NA LOJA B" });
    expect(rpcs[0]._base).toEqual({ keywords: "LOJA B ORIGINAL" }); // base crua DA B
    expect(FAKE.linhas.tenant_config.find((r) => r.tenant_id === "t2")!.keywords).toBe("EDITADO NA LOJA B");
    expect(FAKE.linhas.tenant_config.find((r) => r.tenant_id === "t1")!.keywords).toBe(ORIGINAL);
  });
});
