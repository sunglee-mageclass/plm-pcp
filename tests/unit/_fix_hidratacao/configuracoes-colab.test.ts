// @vitest-environment happy-dom
// Config da Loja colaborativa — T4 (presença + banner + merge). Monta a TELA REAL com o Supabase falso
// (que já faz o compare-and-set da RPC `salvar_config_loja`, T3) e prova:
// - eco com mudança alheia em campo NÃO tocado → adotada + banner "N campo(s) atualizado(s)";
// - mudança alheia em campo que EU mexi → conflito no banner, anel âmbar no bloco, Salvar travado (P-122 A);
// - "manter meu" → grava o meu sobre o novo (base = servidor, sem P0409); "usar o novo" → a tela adota;
// - P0409 da RPC (sem eco) → relê + conflito no banner;
// - conflito no KANBAN (régua própria) → banner + "usar o novo";
// - trocar de loja limpa conflitos/banner e troca o canal de presença (`colab:config-loja:<loja>`);
// - cada bloco tem o seu `data-colab-path` (P-124 A — anel por bloco).
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

describe("Config da Loja colaborativa — T4 (banner, merge, resolução, presença)", () => {
  it("mudança alheia em campo NÃO tocado: adotada + banner 'campo(s) atualizado(s)', sem conflito", async () => {
    await abrirPagina();
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    FAKE.linhas.tenant_config[0].timezone = "America/Manaus";
    await ecoDoOutroAdmin();
    expect(texto()).toContain("Manaus / Amazonas (GMT-4)");
    expect(texto()).toContain("Alguém salvou agora — 1 campo(s) atualizado(s)");
    expect(texto()).not.toContain("a resolver");
    expect(salvar().disabled).toBe(false);
  });

  it("mudança alheia no campo que EU mexi: conflito no banner, anel âmbar no bloco e Salvar travado", async () => {
    await abrirPagina();
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    await ecoDoOutroAdmin();
    expect(kw()!.value).toBe(`${ORIGINAL}, Sardinha`); // a minha edição fica na tela
    expect(texto()).toContain("1 conflito a resolver antes de salvar");
    expect(texto()).toContain("Keywords:");
    expect(bloco("cfg:keywords")!.className).toContain("ring-amber-500");
    expect(bloco("cfg:timezone")!.className).not.toContain("ring-amber-500");
    expect(salvar().disabled).toBe(true);
  });

  it("'manter meu': destrava e grava o MEU sobre o novo (base = valor do servidor, sem P0409)", async () => {
    await abrirPagina();
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    await ecoDoOutroAdmin();
    await clicar(botaoPorTexto("manter meu")!);
    expect(texto()).not.toContain("a resolver");
    expect(bloco("cfg:keywords")!.className).not.toContain("ring-amber-500");
    expect(salvar().disabled).toBe(false);
    await salvarComoAQa();
    const r = rpcs().at(-1)!;
    expect(r._mudancas).toEqual({ keywords: `${ORIGINAL}, Sardinha` });
    expect(r._base).toEqual({ keywords: "DO OUTRO ADMIN" });
    expect(FAKE.linhas.tenant_config[0].keywords).toBe(`${ORIGINAL}, Sardinha`);
  });

  it("'usar o novo': a tela adota o valor do outro e não sobra nada a salvar", async () => {
    await abrirPagina();
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    await ecoDoOutroAdmin();
    await clicar(botaoPorTexto("usar o novo")!);
    expect(kw()!.value).toBe("DO OUTRO ADMIN");
    expect(salvar().disabled).toBe(false);
    await clicar(salvar());
    await aguardar(() => toastMock.info.mock.calls.some((c) => c[0] === "Nenhuma alteração para salvar."), "nada a salvar");
    expect(rpcs()).toHaveLength(0);
    expect(FAKE.linhas.tenant_config[0].keywords).toBe("DO OUTRO ADMIN");
  });

  it("P0409 da RPC (outra aba gravou, eco não chegou): relê, mostra o conflito no banner e resolve com 'manter meu'", async () => {
    await abrirPagina(true);
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    await clicar(salvar());
    await aguardar(() => !!botaoPorTexto("Salvar mesmo assim"), "AlertDialog de confirmação");
    await clicar(botaoPorTexto("Salvar mesmo assim")!);
    await aguardar(() => texto().includes("1 conflito a resolver antes de salvar"), "banner do conflito");
    expect(botaoPorTexto("Salvar mesmo assim")).toBeNull(); // o diálogo fechou
    expect(salvar().disabled).toBe(true);
    await clicar(botaoPorTexto("manter meu")!);
    await salvarComoAQa();
    expect(FAKE.linhas.tenant_config[0].keywords).toBe(`${ORIGINAL}, Sardinha`);
  });

  it("conflito no KANBAN (Status do Kanban): banner com o rótulo e 'usar o novo' adota as colunas do outro", async () => {
    await abrirPagina();
    const draftStatus = () => document.querySelector<HTMLInputElement>('input[placeholder="Ex: Em Modelagem"]');
    await digitar(draftStatus()!, "MINHA COLUNA");
    await clicar(botaoPorTexto("Adicionar")!);
    await aguardar(() => texto().includes("MINHA COLUNA"), "coluna nova na lista");
    FAKE.linhas.tenant_config[0].status_kanban = ["Em Modelagem", "COLUNA DO OUTRO", "Aprovado"];
    await ecoDoOutroAdmin();
    expect(texto()).toContain("Colunas do kanban:");
    expect(bloco("cfg:status_kanban")!.className).toContain("ring-amber-500");
    expect(salvar().disabled).toBe(true);
    await clicar(botaoPorTexto("usar o novo")!);
    expect(texto()).toContain("COLUNA DO OUTRO");
    expect(texto()).not.toContain("MINHA COLUNA");
    expect(salvar().disabled).toBe(false);
    await clicar(salvar());
    await aguardar(() => toastMock.info.mock.calls.some((c) => c[0] === "Nenhuma alteração para salvar."), "nada a salvar");
    expect(rpcs()).toHaveLength(0);
  });

  it("trocar de loja limpa conflitos/banner e troca o canal de presença", async () => {
    const canais: string[] = [];
    const orig = FAKE.supabase.channel;
    vi.spyOn(FAKE.supabase, "channel").mockImplementation((...a: any[]) => { canais.push(String(a[0])); return orig(...a); });
    const qc = await abrirPagina();
    await aguardar(() => canais.includes("colab:config-loja:t1"), "canal de presença da loja t1");
    await digitar(kw()!, `${ORIGINAL}, Sardinha`);
    FAKE.linhas.tenant_config[0].keywords = "DO OUTRO ADMIN";
    await ecoDoOutroAdmin();
    expect(texto()).toContain("1 conflito a resolver");
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries({ queryKey: ["tenant-config"] });
    await aguardar(() => kw()?.value === "LOJA B", "tela mostra a loja t2", 2000);
    expect(texto()).not.toContain("a resolver");
    expect(texto()).not.toContain("Alguém salvou agora");
    expect(salvar().disabled).toBe(false);
    await aguardar(() => canais.includes("colab:config-loja:t2"), "canal de presença da loja t2");
  });

  it("cada bloco tem o seu data-colab-path (P-124 A) e o diálogo de Requisitos anuncia o seu", async () => {
    await abrirPagina(true);
    for (const p of [
      "cfg:timezone", "cfg:status_kanban", "cfg:ref_config", "cfg:sku_config", "cfg:revenda_kanban_colunas",
      "cfg:revenda_campos", "cfg:leadtime", "cfg:pcp_etapas", "cfg:modo_oc_rolo", "cfg:modo_baixa_estoque",
      "cfg:markup_analise_faixa", "cfg:keywords", "cfg:nomenclaturas",
    ]) {
      expect(bloco(p), p).not.toBeNull();
    }
    expect(bloco("cfg:status_kanban")!.querySelector('[data-colab-path="cfg:explosao_envio_status"]')).not.toBeNull();
    expect(bloco("cfg:status_kanban")!.querySelector('[data-colab-path="cfg:ref_exibir_status"]')).not.toBeNull();
    // Abre o diálogo de Requisitos da 1ª coluna: o conteúdo (portal) carrega o caminho próprio.
    const btnReq = Array.from(bloco("cfg:status_kanban")!.querySelectorAll("button")).find((b) => (b.textContent ?? "").startsWith("Requisitos"))!;
    await clicar(btnReq);
    await aguardar(() => !!document.querySelector('[role="dialog"][data-colab-path="cfg:kanban_requisitos"]'), "diálogo com data-colab-path");
  });
});
