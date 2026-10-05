// @vitest-environment happy-dom
// [modularidade F1, parte 1] `useTenantModules().pronto`: a loja E a config dela já chegaram. Antes disso o hook
// devolve os DEFAULTS e quem decidia por eles (ModuleGuard/RequirePermission/sidebar) redirecionava por engano numa URL direta.
// [backend F1, R3] REVERTE a regra "erro conta como pronto": 1ª carga com erro => `erro`, `!pronto`, nunca os DEFAULTS, com
// `tentarDeNovo`; erro de REFETCH com valor guardado => segue `pronto` com os módulos de antes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const h = vi.hoisted(() => ({
  state: {
    user: null as null | { id: string },
    loading: false,
    users: null as null | { promise: Promise<any> },
    cfg: {} as Record<string, { promise: Promise<any> }>,
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.state.user, loading: h.state.loading }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { q.v = v; return q; },
        maybeSingle: () => (tabela === "users" ? h.state.users!.promise : h.state.cfg[q.v].promise),
      };
      return q;
    },
  },
}));

import { useTenantModules } from "@/hooks/useTenantModules";

type Visto = { pronto: boolean; isLoading: boolean; otb: boolean; erro: boolean };
let retentar: () => void = () => {};
let vistos: Visto[] = [];
function Sonda() {
  const m = useTenantModules();
  vistos.push({ pronto: m.pronto, isLoading: m.isLoading, otb: m.isModuleEnabled("otb"), erro: m.erro });
  retentar = m.tentarDeNovo;
  return null;
}
const ultimo = () => vistos[vistos.length - 1];

let root: Root;
let qc: QueryClient;
async function montar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))); });
}
async function rerender() {
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))); });
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  vistos = [];
  h.state.user = null;
  h.state.loading = false;
  h.state.users = null;
  h.state.cfg = {};
});

describe("useTenantModules().pronto", () => {
  it("sem usuário (auth já carregada) → pronto, módulos nos DEFAULTS", async () => {
    await montar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: false, erro: false });
  });

  it("auth ainda carregando → NÃO pronto (mesmo sem usuário ainda)", async () => {
    h.state.loading = true;
    await montar();
    expect(ultimo().pronto).toBe(false);
    h.state.loading = false;
    await rerender();
    expect(ultimo().pronto).toBe(true);
  });

  it("loja pendente → não pronto; loja chegou e config pendente → não pronto; config chegou → pronto com os módulos da loja", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    expect(ultimo()).toEqual({ pronto: false, isLoading: true, otb: false, erro: false });

    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    expect(ultimo().pronto).toBe(false); // tenantId já existe, config ainda não

    await act(async () => { cfg.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true, erro: false });
  });

  it("nunca fica pronto com os DEFAULTS de uma loja que TEM o módulo ligado (a corrida da URL direta)", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    await act(async () => { cfg.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    // todo render em que `otb` aparece desligado tem de ser um render NÃO pronto
    expect(vistos.filter((v) => v.pronto && !v.otb)).toEqual([]);
  });

  it("1ª carga: erro na config da loja → `erro`, NÃO pronto, nada de DEFAULTS; tentarDeNovo refaz e fecha", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    await act(async () => { cfg.resolve({ data: null, error: { message: "rede" } }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: false, isLoading: true, otb: false, erro: true });
    // nunca um render "pronto" com DEFAULTS no caminho
    expect(vistos.filter((v) => v.pronto)).toEqual([]);

    const cfg2 = deferred<any>();
    h.state.cfg = { T1: cfg2 };
    await act(async () => { retentar(); });
    await assentar();
    expect(ultimo().erro).toBe(false); // refazendo: volta a "Carregando"
    expect(ultimo().pronto).toBe(false);
    await act(async () => { cfg2.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true, erro: false });
  });

  it("1ª carga: erro ao descobrir a loja → `erro`, NÃO pronto; tentarDeNovo refaz a loja e depois a config", async () => {
    const users = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    await montar();
    expect(ultimo().pronto).toBe(false);
    await act(async () => { users.resolve({ data: null, error: { message: "rede" } }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: false, isLoading: true, otb: false, erro: true });

    const users2 = deferred<any>();
    const cfg = deferred<any>();
    h.state.users = users2;
    h.state.cfg = { T1: cfg };
    await act(async () => { retentar(); });
    await act(async () => { users2.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    await act(async () => { cfg.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true, erro: false });
  });

  it("REFETCH com erro na config (dado guardado) → segue pronto com os módulos de ANTES, nunca DEFAULTS", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    await act(async () => { cfg.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    expect(ultimo().otb).toBe(true);
    vistos = [];

    const cfgFalha = deferred<any>();
    h.state.cfg = { T1: cfgFalha };
    await act(async () => { void qc.refetchQueries({ queryKey: ["tenant_config", "modules"] }); });
    await act(async () => { cfgFalha.resolve({ data: null, error: { message: "rede" } }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true, erro: false });
    // em nenhum render do refetch os módulos viraram DEFAULTS ou "não pronto"
    expect(vistos.filter((v) => !v.pronto || !v.otb || v.erro)).toEqual([]);
  });

  it("REFETCH com erro ao reler a loja (dado guardado) → mesma loja, módulos de antes, sem erro", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    await act(async () => { cfg.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    vistos = [];

    const usersFalha = deferred<any>();
    h.state.users = usersFalha;
    await act(async () => { void qc.refetchQueries({ queryKey: ["active-tenant-id"] }); });
    await act(async () => { usersFalha.resolve({ data: null, error: { message: "rede" } }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true, erro: false });
    expect(vistos.filter((v) => !v.pronto || !v.otb || v.erro)).toEqual([]);
  });

  it("loja SEM linha de config (data null, sem erro) continua sendo sucesso = DEFAULTS pronto", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    await act(async () => { cfg.resolve({ data: null, error: null }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: false, erro: false });
  });

  it("troca de loja/usuário → volta a NÃO pronto até a loja nova e a config nova chegarem", async () => {
    const u1 = deferred<any>();
    const cfgA = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = u1;
    h.state.cfg = { A: cfgA };
    await montar();
    await act(async () => { u1.resolve({ data: { tenant_id: "A" }, error: null }); });
    await assentar();
    await act(async () => { cfgA.resolve({ data: { modules: {} }, error: null }); });
    await assentar();
    expect(ultimo().pronto).toBe(true);

    const u2 = deferred<any>();
    const cfgB = deferred<any>();
    h.state.user = { id: "u2" };
    h.state.users = u2;
    h.state.cfg = { A: cfgA, B: cfgB };
    await rerender();
    expect(ultimo().pronto).toBe(false);
    await act(async () => { u2.resolve({ data: { tenant_id: "B" }, error: null }); });
    await assentar();
    expect(ultimo().pronto).toBe(false);
    await act(async () => { cfgB.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true, erro: false });
  });
});
