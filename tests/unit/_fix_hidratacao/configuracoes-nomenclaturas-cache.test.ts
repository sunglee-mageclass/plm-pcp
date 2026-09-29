// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — re-revisão final, achado N7, review-final-2.md).
// Trazido do probe do revisor `p7-nomenclaturas-cache.test.ts`. Pré-existente, idêntico em
// a8d2fdb6/a8d2fa41 — NÃO é regressão desta branch. O diálogo "Nomenclaturas" hidratava do CACHE
// velho ao REABRIR (a key `["tenant_config","nomenclaturas_edit"]` não incluía o `tenantId`, e o
// gate de hidratação não esperava a leitura NOVA assentar — só `open && current && !hydrated`).
// Efeitos provados:
// (a) mesma loja: outro admin muda as nomenclaturas entre duas aberturas — reabrir mostra o valor
//     velho e o Salvar apaga a mudança alheia.
// (b) super admin troca de loja: abre o diálogo na loja A, troca para a B, reabre — o diálogo
//     mostra as nomenclaturas DA A e o Salvar grava a A NA B.
// T3 da Config colaborativa (29/set): SÓ o Salvar da PÁGINA foi para a RPC `salvar_config_loja`; o
// diálogo "Nomenclaturas" continua com o upsert próprio até a T5 (RPC com base por mapa + merge por
// nome) — por isso estas asserções seguem lendo o upsert do diálogo. Conferimos também que salvar o
// diálogo nunca dispara a RPC da página.
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
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/admin/configuracoes";
import { SidebarProvider } from "@/components/ui/sidebar";

const ORIGINAL = "Moda, Atum, Queijo";
const linhaServidor = () => ({
  tenant_id: "t1", keywords: ORIGINAL, timezone: "America/Sao_Paulo", kanban_automatico: false,
  modules: {}, tab_labels: { producao: "Fábrica", cadastro: "Cadastros da Loja" }, campos_editaveis: { ref: "Código" },
  status_kanban: ["Em Modelagem", "Aprovado"],
});

const kw = () => document.querySelector<HTMLTextAreaElement>("#cfg-keywords");
const dlgInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')).map((i) => i.value);

let desmontar: (() => Promise<void>) | null = null;
async function abrirPagina() {
  const qc = new QueryClient();
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
  return qc;
}
async function abrirDlg() {
  await clicar(botaoPorTexto("Editar nomenclaturas por módulo")!);
  await aguardar(() => !!document.querySelector('[role="dialog"]'), "diálogo aberto");
}
async function fecharDlg() {
  await clicar(botaoPorTexto("Voltar")!);
  await aguardar(() => !document.querySelector('[role="dialog"]'), "diálogo fechado");
}
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [linhaServidor(), { ...linhaServidor(), tenant_id: "t2", tab_labels: { producao: "PRODUCAO-DA-B" }, campos_editaveis: { ref: "REF-DA-B" } }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação re-revisão final] N7 — diálogo Nomenclaturas hidrata do cache velho", () => {
  it("(a) mesma loja: outro admin muda as nomenclaturas entre 2 aberturas — reabrir e Salvar NÃO deve apagar a mudança alheia", async () => {
    const qc = await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "página hidratou");
    await abrirDlg();
    await aguardar(() => botaoPorTexto("Salvar")?.disabled === false, "diálogo hidratou 1ª vez");
    await fecharDlg();
    // outro admin muda as nomenclaturas (Realtime invalida as keys com "tenant")
    FAKE.linhas.tenant_config[0].tab_labels = { producao: "Fábrica", cadastro: "Cadastros da Loja", financeiro: "FINANCEIRO-DO-OUTRO-ADMIN" };
    await qc.invalidateQueries({ predicate: (q) => String(q.queryKey?.[0]).includes("tenant") });
    await abrirDlg();
    await aguardar(() => botaoPorTexto("Salvar")?.disabled === false, "Salvar habilitado na reabertura");
    await esperar(200); // a leitura nova já voltou
    await clicar(botaoPorTexto("Salvar")!);
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas"), "salvo");
    const up = FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert").at(-1)!.payload as any;
    expect(FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja")).toHaveLength(0);
    // Fix N7: o diálogo, ao reabrir, espera a leitura NOVA (não o cache velho) — a mudança do
    // outro admin (financeiro) sobrevive no upsert.
    expect(up.tab_labels.financeiro).toBe("FINANCEIRO-DO-OUTRO-ADMIN");
  });

  it("(b) troca de loja: diálogo aberto na A, depois a tela troca para a B — reabrir NÃO deve mostrar/gravar as nomenclaturas da A na B", async () => {
    const qc = await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "página hidratou");
    await abrirDlg();
    await aguardar(() => botaoPorTexto("Salvar")?.disabled === false, "diálogo hidratou (loja A)");
    await fecharDlg();
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries();
    await aguardar(() => kw()?.value === ORIGINAL && (document.body.textContent ?? "").length > 0, "página recarregou", 2000);
    await esperar(200);
    await abrirDlg();
    await aguardar(() => botaoPorTexto("Salvar")?.disabled === false, "Salvar habilitado");
    await esperar(200);
    await clicar(botaoPorTexto("Salvar")!);
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas"), "salvo");
    const up = FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert").at(-1)!.payload as any;
    expect(FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja")).toHaveLength(0);
    // Fix N7: a key inclui o tenantId (cache por loja) e o gate espera `currentOk && !currentFetching`
    // — o upsert vai para a t2 com as nomenclaturas DA B (nunca "Cadastros da Loja", que é da A).
    expect(up.tenant_id === "t2" && up.tab_labels.cadastro === "Cadastros da Loja").toBe(false);
  });
});
