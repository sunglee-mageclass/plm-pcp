// @vitest-environment happy-dom
// [camada C2 · P-262 A / Seção 3] PCP Serviços: remover TODOS os serviços e Salvar pede "Apagar todos os N serviços de …?" — tela REAL
// com o Supabase falso. Cancelar => a RPC NÃO é chamada; Confirmar => salvar_terceirizados com a marca explícita de "apagar tudo".
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
import { Route } from "@/routes/_authenticated/pcp.servicos.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", origem: "interno", tenant_id: "t1" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", observacoes_molde: "", sem_acabamento: false }];
  FAKE.linhas.producao_terceirizados = [
    { id: "pt1", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 1, grade_detalhe: {} },
    { id: "pt2", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 4, grade_detalhe: {} },
  ];
  FAKE.linhas.categorias_terceirizado = [{ id: "cat1", tenant_id: "t1", nome: "Estamparia", ativo: true, etapa: "ate_costura" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { vi.restoreAllMocks(); await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

/** C1 M1: a marca de "apagar tudo" dos serviços leva a contagem confirmada (os 2 blocos da base: pt1, pt2). */
const N_SERVIDOR = 2;
const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
const remover = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Remover bloco"]'));
const rpcSalvar = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_terceirizados");
const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
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
let qcAtual: QueryClient | null = null;
async function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qcAtual = qc;
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
}
async function prepararEditando() {
  await aguardar(() => !!salvar() && salvar()!.disabled === false, "Salvar habilitado (hidratou)");
  await aguardar(() => remover().length > 0, "botões Remover bloco", 4000);
}

describe("[camada C2 · P-262 A] PCP Serviços — Apagar todos os serviços", () => {
  it("remover só UM serviço e Salvar NÃO pergunta nada (grava direto, sem marca)", async () => {
    await abrir();
    await prepararEditando();
    await clicar(remover()[0]);
    await clicar(salvar()!);
    await aguardar(() => rpcSalvar().length === 1, "salvar_terceirizados chamada");
    expect(dialogo()).toBeNull();
    const rb = (rpcSalvar()[0].payload as any)._rev_base;
    expect(rb._apagar_tudo).toBeUndefined();
    expect((rpcSalvar()[0].payload as any)._blocos).toHaveLength(1);
  });

  it("remover TODOS e Salvar: abre o diálogo com N e NÃO chama a RPC; Cancelar não grava; Confirmar manda a marca de apagar tudo UMA vez", async () => {
    await abrir();
    await prepararEditando();
    for (let i = 0; i < 2; i++) { await clicar(remover()[0]); await esperar(10); }
    expect(remover()).toHaveLength(0);

    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    expect(dialogo()!.textContent).toContain("Apagar todos os 2 serviços de “BLUSA”?");
    expect(dialogo()!.textContent).toContain("Você removeu todos os serviços deste modelo. Ao salvar, os 2 serviços (datas, quantidades, valores e as contas a pagar ligadas a eles) serão apagados. Isso não pode ser desfeito.");
    expect(botaoDialogo("Apagar todos")!.className).toContain("destructive");
    expect(rpcSalvar()).toHaveLength(0); // o Salvar ainda NÃO foi ao servidor

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(80);
    expect(rpcSalvar()).toHaveLength(0); // Cancelar: o Salvar não acontece
    expect(remover()).toHaveLength(0); // as linhas continuam removidas no rascunho

    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcSalvar().length === 1, "salvar_terceirizados chamada após confirmar");
    const p = rpcSalvar()[0].payload as any;
    expect(p._blocos).toEqual([]);
    expect(p._rev_base._apagar_tudo).toBe(N_SERVIDOR); // a marca (contagem confirmada, C1 M1) vai SÓ depois de confirmar
    await esperar(80);
    expect(rpcSalvar()).toHaveLength(1);
  });

  it("Confirmar -> P0409 no 1º envio -> o retry automático TAMBÉM leva a marca de apagar tudo (sem perguntar de novo)", async () => {
    await abrir();
    await prepararEditando();
    for (let i = 0; i < 2; i++) { await clicar(remover()[0]); await esperar(10); }
    await clicar(salvar()!);
    await aguardar(() => !!dialogo(), "diálogo Apagar todos");
    p0409NaPrimeira("salvar_terceirizados");
    await clicar(botaoDialogo("Apagar todos")!);
    await aguardar(() => rpcSalvar().length === 2, "1º envio (P0409) + retry automático", 5000);
    for (const c of rpcSalvar()) {
      const p = c.payload as any;
      expect(p._blocos).toEqual([]);
      expect(p._rev_base._apagar_tudo).toBe(N_SERVIDOR); // a confirmação sobrevive ao retry
    }
    await esperar(150);
    expect(rpcSalvar()).toHaveLength(2);
    expect(dialogo()).toBeNull(); // o retry não reabre o diálogo
  });

  it("servidor JÁ vazio e rascunho vazio: não pergunta (nada seria apagado)", async () => {
    FAKE.linhas.producao_terceirizados = [];
    await abrir();
    await aguardar(() => !!salvar() && salvar()!.disabled === false, "Salvar habilitado (hidratou)");
    await clicar(salvar()!);
    await aguardar(() => rpcSalvar().length === 1, "salvar_terceirizados chamada");
    expect(dialogo()).toBeNull();
    expect((rpcSalvar()[0].payload as any)._rev_base._apagar_tudo).toBeUndefined();
  });
});

describe("[camada C2] PCP Serviços — serviço REMOVIDO e merge (não ressuscita o bloco)", () => {
  const usarNovo = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "usar o novo")!;

  it("remover um serviço e o servidor mudar OUTRO (refetch/realtime): o removido NÃO volta e não há conflito", async () => {
    await abrir();
    await prepararEditando();
    await clicar(remover()[0]); // pt1
    expect(remover()).toHaveLength(1);
    FAKE.linhas.producao_terceirizados[1].observacao = "alteração da outra pessoa"; // pt2 mudou no servidor; pt1 NÃO
    await act(async () => { await qcAtual!.invalidateQueries({ queryKey: ["producao-terc"] }); });
    await esperar(200);
    expect(remover()).toHaveLength(1); // pt1 segue removido (antes: ressuscitava como "linha nova do servidor")
    expect(document.body.textContent).not.toContain("conflito a resolver");
  });

  it("remover um serviço que OUTRA sessão editou no meio (P0409): CONFLITO, o Salvar não segue; 'usar o novo' o traz de volta", async () => {
    await abrir();
    await prepararEditando();
    await clicar(remover()[0]); // pt1
    p0409NaPrimeira("salvar_terceirizados", () => { FAKE.linhas.producao_terceirizados[0].observacao = "editado pela outra pessoa"; });
    await clicar(salvar()!);
    await aguardar(() => document.body.textContent!.includes("1 conflito a resolver"), "conflito mostrado", 5000);
    await esperar(150);
    expect(rpcSalvar()).toHaveLength(1); // sem retry: parou no conflito (nem apagou nem restaurou em silêncio)
    expect(document.body.textContent).toContain("Bloco de serviço");
    expect(remover()).toHaveLength(1);
    await clicar(usarNovo());
    await aguardar(() => remover().length === 2, "serviço do servidor de volta na tela");
    expect(document.body.textContent).not.toContain("conflito a resolver");
  });

  it("LOST UPDATE: outra sessão muda um campo de um serviço que eu NÃO toquei, meu Salvar leva P0409 => o retry manda o valor DELA (não o rascunho velho)", async () => {
    await abrir();
    await prepararEditando();
    await clicar(remover()[0]); // só toco o pt1 (removo); o pt2 fica como carreguei
    p0409NaPrimeira("salvar_terceirizados", () => {
      FAKE.linhas.producao_terceirizados[1].observacao = "valor da outra pessoa";
      FAKE.linhas.producao_terceirizados[1].rev = 5;
    });
    await clicar(salvar()!);
    await aguardar(() => rpcSalvar().length === 2, "1º envio (P0409) + retry automático", 5000);
    const obs = (c: { payload?: unknown }) => ((c.payload as any)._blocos as any[]).map((b) => [b.id, b.observacao]);
    expect(obs(rpcSalvar()[0])).toEqual([["pt2", expect.not.stringContaining("outra pessoa")]]); // 1º envio: rascunho antigo
    expect(obs(rpcSalvar()[1])).toEqual([["pt2", "valor da outra pessoa"]]); // retry: o MESCLADO (antes: sobrescrevia com o velho)
    expect((rpcSalvar()[1].payload as any)._rev_base.pt2).toBe(5); // e com a rev nova
    expect(document.body.textContent).not.toContain("conflito a resolver");
  });

  it("remover um serviço e P0409 SEM mudança alheia nele: segue removido (retry manda só o outro), sem conflito", async () => {
    await abrir();
    await prepararEditando();
    await clicar(remover()[0]);
    p0409NaPrimeira("salvar_terceirizados", () => { FAKE.linhas.producao_terceirizados[1].rev = 5; });
    await clicar(salvar()!);
    await aguardar(() => rpcSalvar().length === 2, "1º envio (P0409) + retry", 5000);
    expect((rpcSalvar()[1].payload as any)._blocos.map((b: any) => b.id)).toEqual(["pt2"]);
    expect(document.body.textContent).not.toContain("conflito a resolver");
  });
});

describe("[camada C2] PCP Serviços — conflito de serviço REMOVIDO sobrevive ao eco do Realtime (I1)", () => {
  const eco = async () => { await act(async () => { await qcAtual!.invalidateQueries({ queryKey: ["producao-terc"] }); }); await esperar(200); };
  it("removo o pt1 → o outro edita o pt1 (conflito) → o eco de OUTRO serviço NÃO derruba o conflito e o Salvar segue travado", async () => {
    await abrir();
    await prepararEditando();
    await clicar(remover()[0]); // pt1
    FAKE.linhas.producao_terceirizados[0].observacao = "editado pela outra pessoa";
    await eco();
    await aguardar(() => document.body.textContent!.includes("1 conflito a resolver"), "conflito mostrado");
    FAKE.linhas.producao_terceirizados[1].observacao = "mexeram em outro serviço"; // eco de OUTRO bloco (pt2)
    await eco();
    expect(document.body.textContent).toContain("1 conflito a resolver"); // antes: sumia e o Salvar apagava a edição alheia
    await clicar(salvar()!);
    await esperar(150);
    expect(rpcSalvar()).toHaveLength(0); // Salvar travado
    expect(remover()).toHaveLength(1);
  });
});
