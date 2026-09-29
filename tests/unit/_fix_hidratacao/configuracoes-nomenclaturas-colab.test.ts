// @vitest-environment happy-dom
// Config da Loja colaborativa — T5 (janela "Nomenclaturas", P-123 A). A janela grava pela RPC
// `salvar_config_loja` (só o mapa que mudou + a base crua), funde POR NOME com a janela aberta e, num P0409,
// relê e junta nomes diferentes sozinha (1 retentativa) ou lista o conflito do MESMO nome na própria janela.
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
import { montar, esperar, aguardar, clicar, digitar, botaoPorTexto } from "./dom-helpers";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { Route } from "@/routes/_authenticated/admin/configuracoes";
import { SidebarProvider } from "@/components/ui/sidebar";

const ORIGINAL = "Moda, Atum, Queijo";
const linhaServidor = () => ({
  tenant_id: "t1", keywords: ORIGINAL, timezone: "America/Sao_Paulo", kanban_automatico: false,
  modules: {}, tab_labels: { producao: "Fábrica", cadastro: "Cadastros da Loja" }, campos_editaveis: { ref: "Código" },
  status_kanban: ["Em Modelagem", "Aprovado"],
});

const kw = () => document.querySelector<HTMLTextAreaElement>("#cfg-keywords");

let desmontar: (() => Promise<void>) | null = null;
function PaginaComRealtime({ comRealtime }: { comRealtime: boolean }) {
  if (comRealtime) useRealtimeInvalidation(); // condição fixa por montagem
  const C = (Route as any).options.component;
  return createElement(SidebarProvider, null, createElement(C));
}
async function abrirPagina(comRealtime = false) {
  const qc = new QueryClient();
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(PaginaComRealtime, { comRealtime })));
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

const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja").map((c) => c.payload as any);
const upserts = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "upsert");
const inp = (path: string) => document.querySelector<HTMLInputElement>(`[role="dialog"] input[data-colab-path="${path}"]`)!;
const salvarDlg = () => botaoPorTexto("Salvar")!;
const dlgTexto = () => document.querySelector('[role="dialog"]')?.textContent ?? "";

async function abrirDialogo() {
  await aguardar(() => kw()?.value === ORIGINAL, "página hidratou");
  await clicar(botaoPorTexto("Editar nomenclaturas por módulo")!);
  await aguardar(() => salvarDlg()?.disabled === false, "diálogo hidratou");
}

describe("Config colaborativa T5 — Nomenclaturas: merge POR NOME, conflito, presença", () => {
  it("2 admins em nomes DIFERENTES do mesmo mapa (sem eco): P0409 → relê, junta os dois e grava — ambos ficam", async () => {
    await abrirPagina();
    await abrirDialogo();
    await digitar(inp("nom:tab:cadastro"), "MEU CADASTRO");
    // Outro admin grava OUTRO nome do mesmo mapa (tab_labels) depois que a janela carregou.
    FAKE.linhas.tenant_config[0].tab_labels = { ...FAKE.linhas.tenant_config[0].tab_labels, financeiro: "FIN DO OUTRO" };
    await clicar(salvarDlg());
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas"), "salvo");
    expect(rpcs()).toHaveLength(2); // 1ª recusada (P0409), 2ª com a base nova
    expect(FAKE.linhas.tenant_config[0].tab_labels).toEqual({ producao: "Fábrica", cadastro: "MEU CADASTRO", financeiro: "FIN DO OUTRO" });
    expect(upserts()).toHaveLength(0);
  });

  it("2 admins no MESMO nome: conflito na janela (Salvar travado, anel âmbar); 'manter meu' grava o meu", async () => {
    await abrirPagina();
    await abrirDialogo();
    await digitar(inp("nom:tab:cadastro"), "MEU CADASTRO");
    FAKE.linhas.tenant_config[0].tab_labels = { ...FAKE.linhas.tenant_config[0].tab_labels, cadastro: "CADASTRO DO OUTRO" };
    await clicar(salvarDlg());
    await aguardar(() => dlgTexto().includes("1 conflito a resolver antes de salvar"), "conflito na janela");
    expect(dlgTexto()).toContain("Nomes das abas — Cadastro:");
    expect(toastMock.error.mock.calls.at(-1)![0]).toBe("Outra pessoa mudou o mesmo nome agora há pouco. Escolha em cada item destacado e salve de novo.");
    expect(inp("nom:tab:cadastro").className).toContain("ring-amber-500");
    expect(inp("nom:tab:cadastro").value).toBe("MEU CADASTRO");
    expect(salvarDlg().disabled).toBe(true);
    expect(FAKE.linhas.tenant_config[0].tab_labels.cadastro).toBe("CADASTRO DO OUTRO"); // nada gravado
    await clicar(botaoPorTexto("manter meu")!);
    expect(salvarDlg().disabled).toBe(false);
    await clicar(salvarDlg());
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas"), "salvo");
    expect(FAKE.linhas.tenant_config[0].tab_labels.cadastro).toBe("MEU CADASTRO");
  });

  it("MESMO nome + 'usar o novo': a janela adota o nome do outro e não sobra nada a salvar", async () => {
    await abrirPagina();
    await abrirDialogo();
    await digitar(inp("nom:tab:cadastro"), "MEU CADASTRO");
    FAKE.linhas.tenant_config[0].tab_labels = { ...FAKE.linhas.tenant_config[0].tab_labels, cadastro: "CADASTRO DO OUTRO" };
    await clicar(salvarDlg());
    await aguardar(() => dlgTexto().includes("a resolver"), "conflito na janela");
    await clicar(botaoPorTexto("usar o novo")!);
    expect(inp("nom:tab:cadastro").value).toBe("CADASTRO DO OUTRO");
    await clicar(salvarDlg());
    await aguardar(() => toastMock.info.mock.calls.some((c) => c[0] === "Nenhuma alteração para salvar."), "nada a salvar");
    expect(rpcs()).toHaveLength(1); // só a 1ª (recusada)
  });

  it("merge POR NOME com a janela aberta (eco do Realtime): nome alheio adotado na hora; o Salvar grava sem P0409", async () => {
    await abrirPagina(true);
    await abrirDialogo();
    await digitar(inp("nom:tab:cadastro"), "MEU CADASTRO");
    FAKE.linhas.tenant_config[0].campos_editaveis = { ref: "REF DO OUTRO" };
    FAKE.emitirRealtime("tenant_config");
    await aguardar(() => inp("nom:campo:ref")?.value === "REF DO OUTRO", "nome alheio adotado na janela", 2000);
    expect(inp("nom:tab:cadastro").value).toBe("MEU CADASTRO");
    await clicar(salvarDlg());
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas"), "salvo");
    expect(rpcs()).toHaveLength(1);
    expect(rpcs()[0]._mudancas).toEqual({ tab_labels: { producao: "Fábrica", cadastro: "MEU CADASTRO" } }); // só o mapa que eu mudei
    expect(FAKE.linhas.tenant_config[0].campos_editaveis).toEqual({ ref: "REF DO OUTRO" });
  });

  it("cada nome tem o seu data-colab-path (presença por nome) e o 2º overlay mora no diálogo", async () => {
    await abrirPagina();
    await abrirDialogo();
    expect(inp("nom:tab:cadastro")).not.toBeNull();
    expect(inp("nom:campo:ref")).not.toBeNull();
    expect(inp("nom:campo:colecao")).not.toBeNull();
    await esperar(10);
  });

  it("revisão (I1): troca de loja com o Salvar da janela em voo — a resposta da loja A não fecha nem limpa a janela da B", async () => {
    FAKE.linhas.tenant_config.push({ ...FAKE.linhas.tenant_config[0], tenant_id: "t2", tab_labels: { producao: "PRODUCAO-DA-B" }, campos_editaveis: {} });
    const qc = await abrirPagina();
    await abrirDialogo();
    await digitar(inp("nom:tab:cadastro"), "MEU CADASTRO NA A");
    const soltar = FAKE.segurar("rpc:salvar_config_loja");
    await clicar(salvarDlg());
    FAKE.linhas.users[0].tenant_id = "t2";
    await qc.invalidateQueries();
    await aguardar(() => inp("nom:tab:cadastro")?.value === "", "janela re-semeada com a loja B", 3000);
    soltar();
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Nomenclaturas salvas (na loja anterior)."), "sucesso da loja A");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(); // a janela (agora da B) continua aberta
    expect(FAKE.linhas.tenant_config[0].tab_labels.cadastro).toBe("MEU CADASTRO NA A");
    expect(FAKE.linhas.tenant_config[1].tab_labels).toEqual({ producao: "PRODUCAO-DA-B" });
  });
});

