// @vitest-environment happy-dom
// [camada C2 · P-262 A / Seção 3] OC de Insumo: remover TODOS os insumos e Salvar pede "Apagar todos os N itens da OC …?" — janela REAL da OC
// (`OcDialog`) com o Supabase falso. Cancelar => a RPC NÃO é chamada; Confirmar => salvar_oc_etiqueta com a marca explícita de "apagar tudo".
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
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
import { OcDialog } from "@/routes/_authenticated/entrada-saida.oc-insumo";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1" }];
  FAKE.linhas.ocs_etiqueta = [{
    id: "oc1", tenant_id: "t1", numero_pedido: "I-0001", empresa_id: "e1", status: "encomendado", rev: 3,
    data_pedido: "2026-10-01", data_prevista_entrega: "2026-10-20", prazo_pagamento: "30", quantidade_prazos: 1, nfs: [],
    parcelas_recebimento: [{ data: "2026-10-20", recebido: false }],
  }];
  FAKE.linhas.ocs_etiqueta_itens = [
    { id: "it1", oc_etiqueta_id: "oc1", etiqueta_id: "et1", variante_etiqueta_id: null, quantidade_pedida: 5, quantidade_recebida: null, cancelado: false, preco: 1 },
    { id: "it2", oc_etiqueta_id: "oc1", etiqueta_id: "et2", variante_etiqueta_id: null, quantidade_pedida: 7, quantidade_recebida: null, cancelado: false, preco: 1 },
  ];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const ETIQUETAS: any[] = [
  { id: "et1", nome: "Etiqueta A", preco: 1, formato_tamanho: "letra", variantes: [] },
  { id: "et2", nome: "Etiqueta B", preco: 1, formato_tamanho: "letra", variantes: [] },
];
const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "Salvar") ?? null;
const remover = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Remover insumo"]'));
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_oc_etiqueta");
const EMPRESAS: any[] = [{ id: "e1", nome_fantasia: "Fornecedor X" }, { id: "e2", nome_fantasia: "Fornecedor Y" }];
const gatilho = () => document.querySelector<HTMLElement>('[role="combobox"]');
const opcao = (t: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => (o.textContent ?? "").trim() === t) ?? null;
async function escolherFornecedor(rotulo: string) {
  await act(async () => { gatilho()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await aguardar(() => !!opcao(rotulo), `opção ${rotulo}`);
  await act(async () => { opcao(rotulo)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
async function abrir() {
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(SidebarProvider, null, createElement(OcDialog, { ocId: "oc1", empresas: EMPRESAS, etiquetas: ETIQUETAS, onClose: () => {}, onSaved: () => {}, onDelete: () => {} }))));
  desmontar = m.desmontar;
  await aguardar(() => remover().length === 2, "2 insumos da OC na tela", 5000);
}

describe("[camada C2 · P-262 A] OC de Insumo — Apagar todos os itens", () => {
  it("remover só UM insumo e Salvar NÃO pergunta nada (grava direto, sem marca)", async () => {
    await abrir();
    await clicar(remover()[0]);
    await clicar(salvar()!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_etiqueta chamada");
    expect(dialogo()).toBeNull();
    const p = rpcs()[0].payload as any;
    expect(p._itens).toHaveLength(1);
    expect(p._oc._apagar_itens).toBeUndefined();
  });

  it("remover TODOS e Salvar: abre o diálogo com N e NÃO chama a RPC; Cancelar não grava; Confirmar manda a marca UMA vez", async () => {
    await abrir();
    await clicar(remover()[0]);
    await clicar(remover()[0]);
    expect(remover()).toHaveLength(0);
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar todos os 2 itens da OC I-0001?");
    expect(dialogo()!.textContent).toContain("Você removeu todos os insumos desta OC. Ao salvar, os 2 itens serão apagados e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(botaoDialogo("Apagar todos")!.className).toContain("destructive");
    expect(rpcs()).toHaveLength(0);

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(80);
    expect(rpcs()).toHaveLength(0); // Cancelar: o Salvar não acontece
    expect(remover()).toHaveLength(0); // as linhas continuam removidas no rascunho

    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_etiqueta chamada após confirmar");
    const p = rpcs()[0].payload as any;
    expect(p._itens).toEqual([]);
    expect(p._oc._apagar_itens).toBe(true);
    await esperar(80);
    expect(rpcs()).toHaveLength(1);
  });

  it("'Marcar Recebido' com todos os insumos removidos também abre o diálogo; Confirmar salva COM a marca e COMO recebido", async () => {
    FAKE.linhas.ocs_etiqueta[0].parcelas_recebimento = [{ data: "2026-10-20", recebido: true }];
    await abrir();
    await clicar(remover()[0]);
    await clicar(remover()[0]);
    await clicar(botaoPorTexto("Marcar Recebido")!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar todos os 2 itens da OC I-0001?");
    expect(rpcs()).toHaveLength(0);
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_etiqueta chamada após confirmar");
    const p = rpcs()[0].payload as any;
    expect(p._itens).toEqual([]);
    expect(p._oc._apagar_itens).toBe(true);
    expect(p._oc.status).toBe("recebido"); // o clique original era 'Marcar Recebido': o retry mantém
  });

  it("trocar o fornecedor esvazia os insumos sem clicar em remover: o diálogo não diz 'Você removeu' e Cancelar não grava", async () => {
    await abrir();
    await escolherFornecedor("Fornecedor Y");
    await aguardar(() => remover().length === 0, "insumos esvaziados pela troca de fornecedor");
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar todos os 2 itens da OC I-0001?");
    expect(dialogo()!.textContent).toContain("A OC ficou sem itens (ao trocar o fornecedor). Ao salvar, os 2 itens serão apagados e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(dialogo()!.textContent).not.toContain("Você removeu");
    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(80);
    expect(rpcs()).toHaveLength(0);
  });

  it("Servidor JÁ sem itens e rascunho vazio: Salvar NÃO abre o 'Apagar todos' (nada seria apagado)", async () => {
    FAKE.linhas.ocs_etiqueta_itens = [];
    const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      createElement(SidebarProvider, null, createElement(OcDialog, { ocId: "oc1", empresas: EMPRESAS, etiquetas: ETIQUETAS, onClose: () => {}, onSaved: () => {}, onDelete: () => {} }))));
    desmontar = m.desmontar;
    await aguardar(() => !!salvar() && salvar()!.disabled === false, "Salvar habilitado", 5000);
    await clicar(salvar()!);
    await aguardar(() => rpcs().length === 1, "salvar_oc_etiqueta chamada");
    expect(dialogo()).toBeNull();
    expect((rpcs()[0].payload as any)._oc._apagar_itens).toBeUndefined();
  });
});
