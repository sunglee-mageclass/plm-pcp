// @vitest-environment happy-dom
// Config da Loja › card "Etapas PL": salvar e o selo "alterações não salvas" APAGAR. Monta a TELA REAL com o Supabase falso.
// Causa (bug do dono): o Postgres `jsonb` REORDENA as chaves de objeto ao gravar (`etapas_pl_requisitos` volta em ordem jsonb:
// chave mais curta primeiro) e o baseline do dirty comparava `JSON.stringify` cru ⇒ mesmo valor, texto diferente ⇒ sujo para sempre.
// Aqui o "servidor" devolve o requisito na ordem do jsonb e o eco chega pelo Realtime, como em produção.
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

const linhaServidor = () => ({
  tenant_id: "t1", timezone: "America/Sao_Paulo", kanban_automatico: false, modules: {}, tab_labels: {}, campos_editaveis: {},
  status_kanban: ["Em Modelagem", "Aprovado"],
  etapas_pl_kanban: ["Peça Teste"], etapas_pl_requisitos: { peca_teste: ["tem_peca_teste"] }, etapas_pl_automatico: false,
});

function Pagina() {
  useRealtimeInvalidation();
  const C = (Route as any).options.component;
  return createElement(SidebarProvider, null, createElement(C));
}

const texto = () => document.body.textContent ?? "";
const sujo = () => texto().includes("alterações não salvas");
const salvar = () => botaoPorTexto("Salvar alterações")!;
const card = () => document.querySelector<HTMLElement>('[data-colab-path="cfg:etapas_pl"]')!;
const getsTenantConfig = () => FAKE.chamadas.filter((c) => c.tabela === "tenant_config" && c.op === "select").length;
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_config_loja").map((c) => c.payload as any);

/** Ordem de chaves do `jsonb`: a mais CURTA primeiro, empate por ordem de bytes. */
function ordemJsonb<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))) out[k] = o[k];
  return out;
}

async function adicionarColuna(nome: string) {
  const entrada = card().querySelector<HTMLInputElement>('input[placeholder="Ex: Em Produção"]')!;
  await digitar(entrada, nome);
  await clicar(Array.from(card().querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Adicionar") as HTMLElement);
}

async function salvarEEcoar() {
  await clicar(salvar());
  const confirmar = () => botaoPorTexto("Salvar mesmo assim");
  await esperar(50);
  if (confirmar()) await clicar(confirmar()!);
  await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Configurações salvas"), "toast de sucesso");
  // o eco do Realtime (de um save do outro admin ou o do próprio) relê a linha
  const antes = getsTenantConfig();
  FAKE.emitirRealtime("tenant_config");
  await aguardar(() => getsTenantConfig() > antes, "refetch disparado pelo eco", 2000);
  await esperar(300);
}

let desmontar: (() => Promise<void>) | null = null;
async function abrirPagina() {
  const qc = new QueryClient();
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(Pagina)));
  desmontar = m.desmontar;
  await aguardar(() => !!card() && salvar()?.disabled === false, "página hidratada");
}

beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  // O "banco" grava `etapas_pl_requisitos` como o jsonb: chaves reordenadas (mais curta primeiro) JÁ na resposta de leitura.
  const linha: Record<string, any> = linhaServidor();
  let reqs = linha.etapas_pl_requisitos;
  Object.defineProperty(linha, "etapas_pl_requisitos", {
    enumerable: true, configurable: true,
    get: () => reqs, set: (v) => { reqs = v && typeof v === "object" ? ordemJsonb(v) : v; },
  });
  FAKE.linhas.tenant_config = [linha];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { vi.restoreAllMocks(); await desmontar?.(); desmontar = null; document.body.replaceChildren(); });

describe("Config da Loja › Etapas PL — o selo 'não salvo' apaga depois de salvar", () => {
  it("só ADICIONAR colunas (sem requisito): suja, salva, e depois do eco fica limpo", async () => {
    await abrirPagina();
    expect(sujo()).toBe(false);
    await adicionarColuna("Costura");
    await adicionarColuna("Embalagem");
    expect(sujo()).toBe(true);
    await salvarEEcoar();
    expect(rpcs().at(-1)._mudancas).toEqual({ etapas_pl_kanban: ["Peça Teste", "Costura", "Embalagem"] });
    expect(FAKE.linhas.tenant_config[0].etapas_pl_kanban).toEqual(["Peça Teste", "Costura", "Embalagem"]);
    expect(sujo()).toBe(false);
  });

  it("coluna + requisito: o servidor devolve as chaves em ordem jsonb e o selo apaga mesmo assim", async () => {
    await abrirPagina();
    await adicionarColuna("Corte");
    // requisito da coluna nova (índice 1 → o botão `2*1` é o do layout desktop; ver `extra` duplicado)
    const reqs = Array.from(card().querySelectorAll("button")).filter((b) => /^Requisitos/.test((b.textContent ?? "").trim()));
    await clicar(reqs[2]);
    const linha = Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").includes("CQ liberado"))!;
    await clicar(linha.querySelector("button[role=checkbox]") as HTMLElement);
    await clicar(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Fechar") as HTMLElement);
    expect(sujo()).toBe(true);
    await salvarEEcoar();
    // rascunho: { peca_teste, corte }; jsonb devolve { corte, peca_teste } — mesmo valor, outra ordem
    expect(Object.keys(FAKE.linhas.tenant_config[0].etapas_pl_requisitos)).toEqual(["corte", "peca_teste"]);
    expect(FAKE.linhas.tenant_config[0].etapas_pl_requisitos.corte).toEqual(["cq_liberado"]);
    expect(sujo()).toBe(false);
  });

  it("mudança real DEPOIS de salvar volta a sujar (o guard não ficou mudo)", async () => {
    await abrirPagina();
    await adicionarColuna("Corte");
    await salvarEEcoar();
    expect(sujo()).toBe(false);
    await adicionarColuna("Embalagem");
    expect(sujo()).toBe(true);
  });
});
