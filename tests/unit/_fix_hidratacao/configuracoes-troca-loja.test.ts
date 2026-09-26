// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — revisão final, achado C3, review-final.md).
// Trazido do probe do revisor `p3-config-troca-loja.test.ts`. REGRESSÃO desta branch: o merge
// 3-vias novo (`cfgBaseRef`) não era chaveado pela loja — um super_admin com edição não salva na
// loja A que troca para a loja B (o `invalidateQueries()` do `TenantSwitcher` refaz esta query, já
// trazendo a B) fazia o merge tratar o campo tocado na A como "meu" e sobreviver por cima do
// `next` da B: o Salvar então upserta a edição da A na loja ERRADA (B). Antes desta branch a tela
// era sobrescrita pela B (perdia a edição, mas não gravava na loja errada).
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
const upsertTenantConfig = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert").at(-1);

async function salvarComoAQa() {
  await clicar(botaoPorTexto("Salvar alterações")!);
  await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "AlertDialog de confirmação");
  await clicar(botaoPorTexto("Salvar mesmo assim")!);
  await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Configurações salvas"), "toast de sucesso");
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
    await salvarComoAQa();
    const up = upsertTenantConfig()!.payload as any;
    // Fix C3: nem o tenant_id vira t2 com o conteúdo da A, nem a keywords da A vaza para a B.
    expect(up.tenant_id === "t2" && up.keywords === "EDITADO NA LOJA A").toBe(false);
    // Mais especificamente: o upsert vai para a loja t2 (a que está na tela), e a keywords NUNCA é
    // "EDITADO NA LOJA A" — ou está ausente do payload (a tela já adotou o valor cru da B, que é
    // igual ao servidor, então `keywordsParaPayload` corretamente não manda nada) ou é o valor
    // original da B. A edição da A se perde (como acontecia ANTES desta branch — não ideal, mas
    // não é a REGRESSÃO grave de gravar dado da loja errada).
    expect(up.tenant_id).toBe("t2");
    expect(up.keywords).not.toBe("EDITADO NA LOJA A");
    if (up.keywords !== undefined) expect(up.keywords).toBe("LOJA B ORIGINAL");
  });
});
