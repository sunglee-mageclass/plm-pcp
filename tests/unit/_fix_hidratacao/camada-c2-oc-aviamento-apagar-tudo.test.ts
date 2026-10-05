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

import { createElement, act } from "react";
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
afterEach(async () => { vi.restoreAllMocks(); await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "Salvar") ?? null;
const lixeiras = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.querySelector("svg.lucide-trash-2") && !b.hasAttribute("aria-label"));
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_oc_aviamento");
/** Faz a 1ª chamada da RPC voltar P0409 (conflito de versão); `aoConflitar` simula o que a outra pessoa gravou no meio. */
function p0409NaPrimeira(nome: string, aoConflitar?: () => void) {
  const orig = FAKE.supabase.rpc;
  let n = 0;
  vi.spyOn(FAKE.supabase, "rpc").mockImplementation(((rpc: string, args?: unknown) => {
    if (rpc === nome && n++ === 0) {
      aoConflitar?.();
      FAKE.chamadas.push({ tabela: `rpc:${rpc}`, op: "rpc", filtros: [], payload: args });
      return Promise.resolve({ data: null, error: { code: "P0409", message: `conflito_versao: ${nome}`, details: "" } });
    }
    return orig(rpc, args);
  }) as never);
}
let qcAtual: QueryClient | null = null;
async function abrir() {
  qcAtual = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const m = await montar(createElement(QueryClientProvider, { client: qcAtual },
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

describe("[camada C2] OC de Aviamento — item REMOVIDO e P0409 (merge não ressuscita o item)", () => {
  const ids = (c: { payload?: unknown }) => ((c.payload as any)._itens as { id: string }[]).map((i) => i.id);
  it("remover um item e P0409 (servidor NÃO mexeu nele): o item segue removido e o novo Salvar manda só o outro", async () => {
    await abrir();
    await clicar(lixeiras()[0]); // it1
    p0409NaPrimeira("salvar_oc_aviamento", () => { FAKE.linhas.ocs_aviamento[0].rev = 4; });
    await clicar(salvar()!);
    await aguardar(() => rpcs().length === 1, "1º envio (P0409)");
    await esperar(150);
    expect(lixeiras()).toHaveLength(1); // o merge não trouxe o it1 de volta
    expect(document.body.textContent).not.toContain("conflito a resolver");
    await clicar(salvar()!);
    await aguardar(() => rpcs().length === 2, "novo Salvar", 5000);
    expect(ids(rpcs()[1])).toEqual(["it2"]);
  });

  it("remover um item que OUTRA sessão editou no meio: CONFLITO (não restaura nem apaga em silêncio); 'usar o novo' o traz de volta", async () => {
    await abrir();
    await clicar(lixeiras()[0]);
    p0409NaPrimeira("salvar_oc_aviamento", () => { FAKE.linhas.ocs_aviamento[0].rev = 4; FAKE.linhas.ocs_aviamento_itens[0].quantidade_pedida = 99; });
    await clicar(salvar()!);
    await aguardar(() => document.body.textContent!.includes("1 conflito a resolver"), "conflito mostrado", 5000);
    expect(document.body.textContent).toContain("Item (aviamento)");
    expect(lixeiras()).toHaveLength(1); // segue removido até a pessoa decidir
    const usarNovo = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "usar o novo")!;
    await clicar(usarNovo);
    await aguardar(() => lixeiras().length === 2, "item do servidor de volta na tela");
    expect(document.body.textContent).not.toContain("conflito a resolver");
  });
});

describe("[camada C2] OC de Aviamento — conflito de item REMOVIDO sobrevive ao eco do Realtime (I1)", () => {
  const eco = async () => { await act(async () => { await qcAtual!.invalidateQueries({ queryKey: ["oc-avi"] }); }); await esperar(200); };
  it("removo it1 → o outro edita it1 (conflito) → o eco de OUTRO item NÃO derruba o conflito e o Salvar segue travado", async () => {
    await abrir();
    await clicar(lixeiras()[0]); // it1
    FAKE.linhas.ocs_aviamento[0].rev = 4; FAKE.linhas.ocs_aviamento_itens[0].quantidade_pedida = 99;
    await eco();
    await aguardar(() => document.body.textContent!.includes("1 conflito a resolver"), "conflito mostrado");
    FAKE.linhas.ocs_aviamento[0].rev = 5; FAKE.linhas.ocs_aviamento_itens[1].quantidade_pedida = 33; // mexem no it2
    await eco();
    expect(document.body.textContent).toContain("1 conflito a resolver");
    await clicar(salvar()!);
    await esperar(150);
    expect(rpcs()).toHaveLength(0);
    expect(lixeiras()).toHaveLength(1);
  });

  it("'usar o novo' NÃO duplica: o item re-adicionado do MESMO aviamento (linha nova, sem id) vira o do servidor", async () => {
    await abrir();
    await clicar(lixeiras()[0]); // remove it1 (av1)
    const add = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => /Adicionar/.test(b.textContent ?? ""))!;
    await clicar(add); // linha nova (sem id)
    await aguardar(() => lixeiras().length === 2, "linha nova adicionada");
    // escolhe o MESMO aviamento (av1 "Botão") na linha nova: é a duplicata do it1 removido
    const combos = () => Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]'));
    const opcao = (t: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => (o.textContent ?? "").includes(t)) ?? null;
    const trigger = combos().filter((c) => !(c.textContent ?? "").includes("Fornecedor")).at(-1)!;
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await aguardar(() => !!opcao("Botão"), "opção Botão");
    await act(async () => { opcao("Botão")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await esperar(80);
    FAKE.linhas.ocs_aviamento[0].rev = 4; FAKE.linhas.ocs_aviamento_itens[0].quantidade_pedida = 99; // o outro edita o it1
    await eco();
    await aguardar(() => document.body.textContent!.includes("1 conflito a resolver"), "conflito mostrado");
    const usarNovo = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "usar o novo")!;
    await clicar(usarNovo);
    await aguardar(() => !document.body.textContent!.includes("conflito a resolver"), "conflito resolvido");
    expect(lixeiras()).toHaveLength(2); // it2 + o it1 do servidor (a linha nova do mesmo aviamento foi SUBSTITUÍDA, não somada)
    await clicar(salvar()!);
    await aguardar(() => rpcs().length === 1, "Salvar após resolver", 5000);
    const itens = (rpcs()[0].payload as any)._itens as { id: string | null; aviamento_id: string }[];
    expect(itens.map((i) => i.id).sort()).toEqual(["it1", "it2"]);
  });
});
