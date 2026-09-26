// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — baseado na investigação 26/set (Achado 1 da QA
// pós "Dev oculto", .superpowers/investigacao-corrida-salvar-2026-09-26.md §2/§4.1).
// Monta a TELA REAL `ConfiguracoesLojaPage` (src/routes/_authenticated/admin/configuracoes.tsx)
// com o QueryClient de produção (defaults) e um Supabase falso em memória, e prova que a edição
// de Keywords SOBREVIVE: (A) antes da 1ª carga o formulário não aparece (nada pra digitar em
// cima); (B) eco do Realtime com a linha MUDADA por outro admin funde por campo tocado; (C)
// controle — linha idêntica não muda nada; (D) salvar o diálogo "Nomenclaturas" da mesma tela
// não apaga a Keyword digitada.
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
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { SidebarProvider } from "@/components/ui/sidebar";

const ORIGINAL = "Moda, Atum, Queijo";
const linhaServidor = () => ({
  tenant_id: "t1", keywords: ORIGINAL, timezone: "America/Sao_Paulo", kanban_automatico: false,
  modules: {}, tab_labels: {}, campos_editaveis: {}, status_kanban: ["Em Modelagem", "Aprovado"],
});

// A página como ela vive no app: o layout `_authenticated` monta `useRealtimeInvalidation()` (1 canal por sessão).
function PaginaComRealtime({ semRealtime = false }: { semRealtime?: boolean }) {
  if (!semRealtime) useRealtimeInvalidation(); // (condição fixa por montagem — não muda entre renders)
  const C = (Route as any).options.component;
  return createElement(SidebarProvider, null, createElement(C)); // o layout real também envolve a página no SidebarProvider
}

const kw = () => document.querySelector<HTMLTextAreaElement>("#cfg-keywords");
const seloNaoSalvo = () => document.body.textContent?.includes("alterações não salvas") ?? false;
const getsTenantConfig = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "select").length;
const upsertTenantConfig = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert").at(-1);

async function salvarComoAQa() {
  // igual ao spec E2E: "Salvar alterações" → AlertDialog → "Salvar mesmo assim"
  await clicar(botaoPorTexto("Salvar alterações")!);
  await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "AlertDialog de confirmação");
  await clicar(botaoPorTexto("Salvar mesmo assim")!);
  await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Configurações salvas"), "toast de sucesso");
}

let desmontar: (() => Promise<void>) | null = null;
async function abrirPagina(semRealtime = false) {
  const qc = new QueryClient(); // MESMO default do app (src/router.tsx: staleTime 0, refetchOnWindowFocus true, structuralSharing true)
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(PaginaComRealtime, { semRealtime })));
  desmontar = m.desmontar;
  return qc;
}

beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [linhaServidor()];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] Config da Loja — Keywords: a edição sobrevive (P-57 A)", () => {
  it("A' antes da 1ª carga o formulário NÃO aparece (nada para digitar); depois, digitar+Salvar grava", async () => {
    const soltar = FAKE.segurar("tenant_config"); // rede lenta
    await abrirPagina();
    await esperar(50);
    expect(kw()).toBeNull(); // "Carregando…" no lugar dos DEFAULTS — nada para digitar em cima
    soltar(); // a resposta do GET tenant_config chega
    await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação");
    await digitar(kw()!, `${ORIGINAL}\nQA keywords (restaurar)`);
    await salvarComoAQa();
    const up = upsertTenantConfig()!;
    expect((up.payload as any).keywords).toBe(`${ORIGINAL}\nQA keywords (restaurar)`);
    expect(FAKE.linhas.tenant_config[0].keywords).toBe(`${ORIGINAL}\nQA keywords (restaurar)`);
  });

  it("B' eco do Realtime com a linha MUDADA (outro admin trocou tab_labels): a Keyword digitada FICA", async () => {
    await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação");
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    expect(seloNaoSalvo()).toBe(true);

    // Outra escrita em tenant_config (ex.: o diálogo "Nomenclaturas" desta MESMA tela, ou outro admin) — muda OUTRA coluna.
    FAKE.linhas.tenant_config[0].tab_labels = { criacao: "Estilo" };
    const antes = getsTenantConfig();
    FAKE.emitirRealtime("tenant_config"); // postgres_changes → debounce 250ms → invalidateQueries(matchesTable('tenant_config'))
    await aguardar(() => getsTenantConfig() > antes, "refetch disparado pelo eco", 2000);
    await esperar(300);
    expect(kw()!.value).toBe(`${ORIGINAL}, Sardinha`); // NÃO apagado — campo tocado sobrevive ao merge
    expect(seloNaoSalvo()).toBe(true); // selo continua aceso

    await salvarComoAQa();
    expect((upsertTenantConfig()!.payload as any).keywords).toBe(`${ORIGINAL}, Sardinha`);
  });

  it("C' controle — o MESMO eco com a linha IDÊNTICA não muda nada", async () => {
    await abrirPagina();
    await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação");
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);

    const antes = getsTenantConfig();
    FAKE.emitirRealtime("tenant_config"); // refetch acontece, mas o conteúdo é o mesmo
    await aguardar(() => getsTenantConfig() > antes, "refetch disparado pelo eco", 2000);
    await esperar(300);
    expect(kw()!.value).toBe(`${ORIGINAL}, Sardinha`); // preservado
    expect(seloNaoSalvo()).toBe(true);

    await salvarComoAQa();
    expect((upsertTenantConfig()!.payload as any).keywords).toBe(`${ORIGINAL}, Sardinha`);
  });

  it("D' salvar o diálogo 'Nomenclaturas' da mesma tela NÃO apaga as Keywords digitadas", async () => {
    await abrirPagina(true);
    await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação");
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    expect(seloNaoSalvo()).toBe(true);
    await clicar(botaoPorTexto("Editar nomenclaturas por módulo")!);
    await aguardar(() => !!document.querySelector('[role="dialog"] input'), "diálogo Nomenclaturas aberto");
    await esperar(50); // o PRÓPRIO diálogo hidrata do servidor ao abrir
    await digitar(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, "Estilo");
    const antes = getsTenantConfig();
    await clicar(botaoPorTexto("Salvar")!); // o Salvar DO DIÁLOGO (o da página é "Salvar alterações")
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas"), "Nomenclaturas salvas");
    await aguardar(() => getsTenantConfig() > antes, "refetch pós-Nomenclaturas", 2000);
    await esperar(300);
    expect(kw()!.value).toBe(`${ORIGINAL}, Sardinha`); // NÃO apagado pela re-hidratação
    await salvarComoAQa();
    expect((upsertTenantConfig()!.payload as any).keywords).toBe(`${ORIGINAL}, Sardinha`);
  });
});
