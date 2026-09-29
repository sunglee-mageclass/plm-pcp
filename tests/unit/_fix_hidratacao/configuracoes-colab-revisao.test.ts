// @vitest-environment happy-dom
// Config da Loja colaborativa — fix round da revisão T3+T4 (review-t3-t4.md: I1, I2, M1–M4 + testes que faltavam).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "a@b.c" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: true, etapas_pl: true };
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

function PaginaComRealtime({ semRealtime = false }: { semRealtime?: boolean }) {
  if (!semRealtime) useRealtimeInvalidation();
  const C = (Route as any).options.component;
  return createElement(SidebarProvider, null, createElement(C));
}

const kw = () => document.querySelector<HTMLTextAreaElement>("#cfg-keywords");
const texto = () => document.body.textContent ?? "";
const getsTenantConfig = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "select").length;
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja").map((c) => c.payload as any);
const salvar = () => botaoPorTexto("Salvar alterações")!;
const bloco = (path: string) => document.querySelector<HTMLElement>(`[data-colab-path="${path}"]`);

async function salvarComoAQa() {
  await clicar(salvar());
  await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "AlertDialog de confirmação");
  await clicar(botaoPorTexto("Salvar mesmo assim")!);
  await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Configurações salvas"), "toast de sucesso");
}

async function ecoDoOutroAdmin() {
  const antes = getsTenantConfig();
  FAKE.emitirRealtime("tenant_config");
  await aguardar(() => getsTenantConfig() > antes, "refetch disparado pelo eco", 2000);
  await esperar(300);
}

let desmontar: (() => Promise<void>) | null = null;
async function abrirPagina(semRealtime = false) {
  const qc = new QueryClient();
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(PaginaComRealtime, { semRealtime })));
  desmontar = m.desmontar;
  await aguardar(() => kw()?.value === ORIGINAL, "1ª hidratação");
  await aguardar(() => salvar()?.disabled === false, "Salvar habilitado (hidratou)");
  return qc;
}

beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [linhaServidor(), { ...linhaServidor(), tenant_id: "t2", keywords: "LOJA B" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { vi.restoreAllMocks(); await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const markup = () => document.querySelector<HTMLButtonElement>('button[aria-label="Análise de markup por faixa"]')!;

describe("Config da Loja colaborativa — fix round da revisão T3+T4", () => {
  it("I2: keywords com espaço no fim, save próprio → vai aparado e NÃO acende o banner 'Alguém salvou agora'", async () => {
    await abrirPagina(true);
    await digitar(kw()!, `${ORIGINAL}, Sardinha `);
    await salvarComoAQa();
    expect(rpcs().at(-1)!._mudancas).toEqual({ keywords: `${ORIGINAL}, Sardinha` });
    await aguardar(() => kw()?.value === `${ORIGINAL}, Sardinha`, "tela adota o valor aparado do servidor", 2000);
    await esperar(200);
    expect(texto()).not.toContain("Alguém salvou agora");
    expect(texto()).not.toContain("a resolver");
  });

  it("kanban 'manter meu' + Salvar: a base do status_kanban vai com o valor do SERVIDOR (sem P0409) e o meu grava", async () => {
    await abrirPagina();
    const draftStatus = () => document.querySelector<HTMLInputElement>('input[placeholder="Ex: Em Modelagem"]');
    await digitar(draftStatus()!, "MINHA COLUNA");
    await clicar(botaoPorTexto("Adicionar")!);
    const doOutro = ["Em Modelagem", "COLUNA DO OUTRO", "Aprovado"];
    FAKE.linhas.tenant_config[0].status_kanban = doOutro;
    await ecoDoOutroAdmin();
    await clicar(botaoPorTexto("manter meu")!);
    await salvarComoAQa();
    const r = rpcs().at(-1)!;
    expect(r._base.status_kanban).toEqual(doOutro);
    expect(r._mudancas.status_kanban).toContain("MINHA COLUNA");
    expect(FAKE.linhas.tenant_config[0].status_kanban).toContain("MINHA COLUNA");
  });

  it("M1: eco DURANTE o save (RPC atrasada) — coluna fora do voo é adotada; a em voo não vira conflito falso e a RPC decide (P0409)", async () => {
    await abrirPagina();
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    const soltar = FAKE.segurar("rpc:salvar_config_loja");
    await clicar(salvar());
    await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "confirmação");
    await clicar(botaoPorTexto("Salvar mesmo assim")!);
    // Outro admin grava Fuso (fora do voo) E Keywords (em voo) enquanto a RPC está parada.
    FAKE.linhas.tenant_config[0].timezone = "America/Manaus";
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    await ecoDoOutroAdmin();
    expect(texto()).toContain("Manaus / Amazonas (GMT-4)");
    expect(texto()).toContain("1 campo(s) atualizado(s)"); // o Fuso — não foi suprimido pelo voo
    expect(texto()).not.toContain("a resolver"); // Keywords em voo: sem conflito falso
    soltar();
    await aguardar(() => texto().includes("1 conflito a resolver antes de salvar"), "P0409 vira conflito");
    expect(FAKE.linhas.tenant_config[0].keywords).toBe("DO OUTRO ADMIN"); // nada gravado por cima
    expect(FAKE.linhas.tenant_config[0].timezone).toBe("America/Manaus");
  });

  it("I1: troca de loja com a RPC pendente — o sucesso da loja A não mexe na tela da loja B", async () => {
    const qc = await abrirPagina(true);
    await digitar(kw()!, "EDITADO NA A");
    const soltar = FAKE.segurar("rpc:salvar_config_loja");
    await clicar(salvar());
    await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "confirmação");
    await clicar(botaoPorTexto("Salvar mesmo assim")!);
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries({ queryKey: ["tenant-config"] });
    await aguardar(() => kw()?.value === "LOJA B", "tela mostra a loja t2", 2000);
    soltar();
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Configurações salvas (na loja anterior)."), "sucesso da loja A");
    expect(FAKE.linhas.tenant_config[0].keywords).toBe("EDITADO NA A");
    expect(texto()).not.toContain("Alguém salvou agora");
    expect(texto()).not.toContain("a resolver");
    // A tela da B segue com a base DA B: editar e salvar manda a base da B e grava só na B.
    await digitar(kw()!, "EDITADO NA B");
    await aguardar(() => salvar().disabled === false, "Salvar habilitado");
    await salvarComoAQa();
    const r = rpcs().at(-1)!;
    expect(r._tenant_id).toBe("t2");
    expect(r._base).toEqual({ keywords: "LOJA B" });
    expect(FAKE.linhas.tenant_config[1].keywords).toBe("EDITADO NA B");
  });

  it("I1: troca de loja com a RPC pendente que dá P0409 — só avisa; a tela da B não herda conflito", async () => {
    const qc = await abrirPagina(true);
    await digitar(kw()!, "EDITADO NA A");
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO NA A";
    const soltar = FAKE.segurar("rpc:salvar_config_loja");
    await clicar(salvar());
    await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "confirmação");
    await clicar(botaoPorTexto("Salvar mesmo assim")!);
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries({ queryKey: ["tenant-config"] });
    await aguardar(() => kw()?.value === "LOJA B", "tela mostra a loja t2", 2000);
    soltar();
    await aguardar(() => toastMock.error.mock.calls.some((c) => String(c[0]).startsWith("A loja mudou durante o salvamento")), "aviso da loja anterior");
    await esperar(100);
    expect(texto()).not.toContain("a resolver");
    expect(salvar().disabled).toBe(false);
  });

  it("P0409 com DETAIL listando as DUAS colunas enviadas → as duas em conflito", async () => {
    await abrirPagina(true);
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    // Envio à Explosão a partir de "Em Modelagem" (marcador por linha do bloco Status do Kanban).
    await clicar(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.getAttribute("aria-label") ?? "").startsWith('Envio à Explosão a partir de "Em Modelagem"'))!);
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    FAKE.linhas.tenant_config[0].explosao_envio_status = "aprovado";
    await clicar(salvar());
    await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "confirmação");
    await clicar(botaoPorTexto("Salvar mesmo assim")!);
    await aguardar(() => texto().includes("2 conflitos a resolver antes de salvar"), "2 conflitos");
    expect(texto()).toContain("Envio à Explosão:");
    expect(bloco("cfg:keywords")!.className).toContain("ring-amber-500");
    expect(bloco("cfg:status_kanban")!.className).toContain("ring-amber-500");
  });

  it("M4: P0409 com DETAIL VAZIO → TODAS as colunas enviadas viram conflito", async () => {
    FAKE.linhas.tenant_config[0].markup_analise_faixa = true;
    FAKE.p0409SemDetalhe();
    await abrirPagina(true);
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    await clicar(markup());
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN"; // só uma mudou de verdade
    await clicar(salvar());
    await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "confirmação");
    await clicar(botaoPorTexto("Salvar mesmo assim")!);
    await aguardar(() => texto().includes("2 conflitos a resolver antes de salvar"), "todas as enviadas em conflito");
    expect(salvar().disabled).toBe(true);
  });
});
