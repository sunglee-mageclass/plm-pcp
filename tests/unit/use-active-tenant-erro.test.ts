// @vitest-environment happy-dom
// [backend F1] `useActiveTenant`: o erro da leitura da loja SOBE (antes `data` null virava "" e o React Query via sucesso).
// REFETCH com erro mantém o último `tenantId`; 1ª carga com erro => `erro`, `tenantId ""`, `resolvido`; `tentarDeNovo` refaz.
// `recarregarLojaAtiva` (TenantSwitcher): releitura que falha depois da troca não deixa a tela na loja ANTERIOR.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const h = vi.hoisted(() => ({
  state: { user: null as null | { id: string }, loading: false, users: null as null | { promise: Promise<any> } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.state.user, loading: h.state.loading }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: () => h.state.users!.promise };
      return q;
    },
  },
}));

import { useActiveTenant, recarregarLojaAtiva } from "@/hooks/useActiveTenantId";

type Visto = { tenantId: string; resolvido: boolean; erro: boolean; tentando: boolean };
let vistos: Visto[] = [];
let retentar: () => void = () => {};
function Sonda() {
  const t = useActiveTenant();
  vistos.push({ tenantId: t.tenantId, resolvido: t.resolvido, erro: t.erro, tentando: t.tentando });
  retentar = t.tentarDeNovo;
  return null;
}
const ultimo = () => vistos[vistos.length - 1];

let root: Root;
let qc: QueryClient;
async function montar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))); });
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
// `retry: 1` (~1 s): a falha só assenta depois do retry
const assentarErro = () => act(async () => { await new Promise((r) => setTimeout(r, 1150)); });
const ok = (tenant_id: string | null) => ({ data: tenant_id === null ? null : { tenant_id }, error: null });
const falha = { data: null, error: { message: "rede" } };

beforeEach(() => {
  vistos = [];
  h.state.user = { id: "u1" };
  h.state.loading = false;
  h.state.users = null;
});

describe("useActiveTenant — erro da loja ativa", () => {
  it("sucesso: tenantId, resolvido, sem erro (caminho de sempre)", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    expect(ultimo()).toEqual({ tenantId: "", resolvido: false, erro: false, tentando: false });
    await act(async () => { u.resolve(ok("T1")); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "T1", resolvido: true, erro: false, tentando: false });
  });

  it("usuário sem linha em users (data null, sem erro) = sucesso com '' (sem loja), não erro", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(ok(null)); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: false, tentando: false });
  });

  it("1ª carga com erro → erro, tenantId '' e resolvido; tentarDeNovo refaz mantendo o erro visível (tentando) até chegar", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(falha); });
    await assentarErro();
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: true, tentando: false });

    const u2 = deferred<any>();
    h.state.users = u2;
    vistos = [];
    await act(async () => { retentar(); });
    await assentar();
    // [review I1] refazendo: o erro NÃO some (o aviso fica com "Tentando…")
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: true, tentando: true });
    expect(vistos.filter((v) => !v.erro)).toEqual([]);
    await act(async () => { u2.resolve(ok("T1")); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "T1", resolvido: true, erro: false, tentando: false });
  });

  it("REFETCH com erro mantém o último tenantId (nunca '') e não vira erro", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(ok("T1")); });
    await assentar();
    vistos = [];

    const u2 = deferred<any>();
    h.state.users = u2;
    await act(async () => { void qc.refetchQueries({ queryKey: ["active-tenant-id"] }); });
    await act(async () => { u2.resolve(falha); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "T1", resolvido: true, erro: false, tentando: false });
    expect(vistos.filter((v) => v.tenantId !== "T1" || v.erro)).toEqual([]);
  });
});

describe("recarregarLojaAtiva (TenantSwitcher)", () => {
  async function comLojaA() {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(ok("A")); });
    await assentar();
  }

  it("releitura traz a loja escolhida: devolve true e nada é zerado", async () => {
    await comLojaA();
    const u2 = deferred<any>();
    h.state.users = u2;
    let res: boolean | null = null;
    await act(async () => { void recarregarLojaAtiva(qc, "u1", "B").then((r) => { res = r; }); });
    await act(async () => { u2.resolve(ok("B")); });
    await assentar();
    expect(res).toBe(true);
    expect(ultimo()).toEqual({ tenantId: "B", resolvido: true, erro: false, tentando: false });
  });

  it("releitura que FALHA: não fica na loja anterior — zera, devolve false e mostra erro se falhar de novo", async () => {
    await comLojaA();
    const u2 = deferred<any>();
    h.state.users = u2;
    let res: boolean | null = null;
    await act(async () => { void recarregarLojaAtiva(qc, "u1", "B").then((r) => { res = r; }); });
    await act(async () => { u2.resolve(falha); }); // a promise já resolvida serve ao refetch, ao retry e ao reset
    await act(async () => { await new Promise((r) => setTimeout(r, 2600)); }); // refetch+retry, depois reset+retry (~1 s cada)
    expect(res).toBe(false);
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: true, tentando: false });
  });

  it("[review m1] releitura PAUSADA (offline) devolve a loja ANTIGA em cache: compara com a escolhida e zera", async () => {
    await comLojaA();
    // simula a pausa: refetchQueries resolve na hora com o cache da loja A
    vi.spyOn(qc, "refetchQueries").mockImplementationOnce(async () => {});
    const u2 = deferred<any>();
    h.state.users = u2;
    let res: boolean | null = null;
    await act(async () => { void recarregarLojaAtiva(qc, "u1", "B").then((r) => { res = r; }); });
    await assentar();
    expect(ultimo().tenantId).toBe(""); // zerada (sem valor), refazendo
    await act(async () => { u2.resolve(ok("B")); });
    await assentar();
    expect(res).toBe(false);
    expect(ultimo()).toEqual({ tenantId: "B", resolvido: true, erro: false, tentando: false });
  });

  it("só olha a query do usuário atual (a de outro usuário em erro no cache não zera a dele)", async () => {
    await comLojaA();
    qc.setQueryData(["active-tenant-id", "u-outro"], "X");
    const u2 = deferred<any>();
    h.state.users = u2;
    let res: boolean | null = null;
    await act(async () => { void recarregarLojaAtiva(qc, "u1", "B").then((r) => { res = r; }); });
    await act(async () => { u2.resolve(ok("B")); });
    await assentar();
    expect(res).toBe(true);
    expect(qc.getQueryData(["active-tenant-id", "u-outro"])).toBe("X");
  });
});
