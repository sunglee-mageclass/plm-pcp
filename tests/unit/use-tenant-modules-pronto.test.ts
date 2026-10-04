// @vitest-environment happy-dom
// [modularidade F1, parte 1] `useTenantModules().pronto`: a loja E a config dela já chegaram (sucesso OU erro). Antes disso o hook
// devolve os DEFAULTS e quem decidia por eles (ModuleGuard/RequirePermission/sidebar) redirecionava por engano numa URL direta.
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

type Visto = { pronto: boolean; isLoading: boolean; otb: boolean };
let vistos: Visto[] = [];
function Sonda() {
  const m = useTenantModules();
  vistos.push({ pronto: m.pronto, isLoading: m.isLoading, otb: m.isModuleEnabled("otb") });
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
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: false });
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
    expect(ultimo()).toEqual({ pronto: false, isLoading: true, otb: false });

    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    expect(ultimo().pronto).toBe(false); // tenantId já existe, config ainda não

    await act(async () => { cfg.resolve({ data: { modules: { otb: true } }, error: null }); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true });
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

  it("erro na config da loja → pronto (cai nos DEFAULTS), nunca 'Carregando' eterno", async () => {
    const users = deferred<any>();
    const cfg = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    h.state.cfg = { T1: cfg };
    await montar();
    await act(async () => { users.resolve({ data: { tenant_id: "T1" }, error: null }); });
    await assentar();
    cfg.promise.catch(() => {});
    await act(async () => { cfg.reject(new Error("rede")); });
    await assentar();
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: false });
  });

  it("erro ao descobrir a loja → pronto (sem loja, como hoje)", async () => {
    const users = deferred<any>();
    h.state.user = { id: "u1" };
    h.state.users = users;
    await montar();
    expect(ultimo().pronto).toBe(false);
    users.promise.catch(() => {});
    await act(async () => { users.reject(new Error("rede")); });
    await assentar();
    expect(ultimo().pronto).toBe(true);
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
    expect(ultimo()).toEqual({ pronto: true, isLoading: false, otb: true });
  });
});
