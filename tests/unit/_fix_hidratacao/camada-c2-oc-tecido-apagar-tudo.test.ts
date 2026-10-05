// @vitest-environment happy-dom
// [camada C2 · P-262 A / Seção 3] OC de Tecido: remover TODOS os tecidos e Salvar pede "Apagar todos os N itens da OC …?" — janela REAL da OC
// (`OcDialog`) com o Supabase falso. Cancelar => a RPC NÃO é chamada; Confirmar => salvar_oc_tecido com a marca explícita de "apagar tudo".
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

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
import { OcDialog } from "@/routes/_authenticated/entrada-saida.oc-tecido";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", modo_oc_rolo: "oc" }];
  FAKE.linhas.ocs_tecido = [{
    id: "oc1", tenant_id: "t1", numero_pedido: "T-0001", empresa_id: "e1", status: "encomendado", rev: 3, is_rolo: false,
    data_pedido: "2026-10-01", data_prevista_entrega: "2026-10-20", prazo_pagamento: "30", quantidade_prazos: 1, nfs: [],
    parcelas_recebimento: [{ data: "2026-10-20", recebido: false }],
  }];
  FAKE.linhas.ocs_tecido_itens = [
    { id: "it1", oc_tecido_id: "oc1", artigo_id: "a1", artigo_numero: 1, variante_tecido_id: "v1", quantidade_pedida: 10, quantidade_recebida: null, rendimento: null, cancelado: false, preco: 5 },
  ];
  FAKE.linhas.artigos = [{ id: "a1", nome: "Malha", empresa_id: "e1", preco: 5, rendimento: null, unidade_medida: "metro" }];
  FAKE.linhas.variantes_tecido = [{ id: "v1", artigo_id: "a1", nome_variante: null, codigo_variante: null, preco: 5, cor: { nome: "Azul" }, apelido: null }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { vi.restoreAllMocks(); await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "Salvar") ?? null;
const caixaVariante = () => Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find((l) => (l.textContent ?? "").trim() === "Azul")?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_oc_tecido");
/** Faz a 1ª chamada da RPC voltar P0409 (conflito de versão) e deixa as demais seguirem o fake normal. */
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
async function abrir() {
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(SidebarProvider, null, createElement(OcDialog, { ocId: "oc1", empresas: [{ id: "e1", nome_fantasia: "Fornecedor X" } as any], onClose: () => {}, onSaved: () => {} }))));
  desmontar = m.desmontar;
  await aguardar(() => !!caixaVariante() && caixaVariante()!.checked, "variante marcada na tela", 5000);
  await aguardar(() => !!salvar() && salvar()!.disabled === false, "Salvar habilitado", 5000);
}

describe("[camada C2 · P-262 A] OC de Tecido — Apagar todos os itens", () => {
  it("remover TODOS os tecidos e Salvar: abre o diálogo com N e NÃO chama a RPC; Cancelar não grava; Confirmar manda a marca UMA vez", async () => {
    await abrir();
    await clicar(caixaVariante()!); // desmarca a única variante => nenhum item
    await aguardar(() => !caixaVariante(), "lista de variantes some (nenhum tecido na OC)");
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar o único item da OC T-0001?");
    expect(dialogo()!.textContent).toContain("Você removeu todos os tecidos desta OC. Ao salvar, o item (quantidades, preços e conferência de CQ) será apagado e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(botaoDialogo("Apagar todos")!.className).toContain("destructive");
    expect(rpcs()).toHaveLength(0);

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(80);
    expect(rpcs()).toHaveLength(0); // Cancelar: o Salvar não acontece
    expect(caixaVariante()).toBeNull(); // os tecidos continuam removidos no rascunho

    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_tecido chamada após confirmar");
    const p = rpcs()[0].payload as any;
    expect(p._itens).toEqual([]);
    expect(p._oc._apagar_itens).toBe(true);
    await esperar(80);
    expect(rpcs()).toHaveLength(1);
  });

  it("OC com 2 itens: mensagem no plural com N (\"Apagar todos os 2 itens da OC …\")", async () => {
    FAKE.linhas.ocs_tecido_itens.push({ id: "it2", oc_tecido_id: "oc1", artigo_id: "a1", artigo_numero: 1, variante_tecido_id: "v2", quantidade_pedida: 4, quantidade_recebida: null, rendimento: null, cancelado: false, preco: 5 });
    FAKE.linhas.variantes_tecido.push({ id: "v2", artigo_id: "a1", nome_variante: null, codigo_variante: null, preco: 5, cor: { nome: "Verde" }, apelido: null });
    await abrir();
    // desmarcar a 1ª variante (ordem alfabética: Azul) cascateia as seguintes: abre o diálogo de cascata JÁ EXISTENTE (não é o nosso)
    await clicar(caixaVariante()!);
    await aguardar(() => !!dialogo(), "diálogo da cascata (já existente)");
    expect(dialogo()!.textContent).not.toContain("Apagar todos");
    const confirmar = Array.from(dialogo()!.querySelectorAll<HTMLButtonElement>("button")).find((b) => !(b.textContent ?? "").includes("Cancelar"))!;
    await clicar(confirmar);
    await aguardar(() => !dialogo(), "cascata confirmada");
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar todos os 2 itens da OC T-0001?");
    expect(rpcs()).toHaveLength(0);
  });

  it("Confirmar -> P0409 no 1º envio -> o retry automático TAMBÉM leva a marca de apagar tudo (sem perguntar de novo)", async () => {
    await abrir();
    await clicar(caixaVariante()!);
    await aguardar(() => !caixaVariante(), "lista de variantes some (nenhum tecido na OC)");
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    // "outra pessoa salvou no meio": o item que sobra no servidor segue sem variante (incompleto) => o payload do retry continua VAZIO
    // e o servidor ainda tem linha => o retry precisa da marca de novo (sem perguntar outra vez).
    p0409NaPrimeira("salvar_oc_tecido", () => { FAKE.linhas.ocs_tecido[0].rev = 4; FAKE.linhas.ocs_tecido_itens[0].variante_tecido_id = null; });
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcs().length === 2, "1º envio (P0409) + retry automático", 5000);
    for (const c of rpcs()) {
      const p = c.payload as any;
      expect(p._itens).toEqual([]);
      expect(p._oc._apagar_itens).toBe(true); // a confirmação sobrevive ao retry
    }
    await esperar(150);
    expect(rpcs()).toHaveLength(2);
    expect(dialogo()).toBeNull(); // o retry não reabre o diálogo
  });
});
