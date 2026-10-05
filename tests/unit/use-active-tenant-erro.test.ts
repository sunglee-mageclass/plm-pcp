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

type Visto = { tenantId: string; resolvido: boolean; erro: boolean };
let vistos: Visto[] = [];
let retentar: () => void = () => {};
function Sonda() {
  const t = useActiveTenant();
  vistos.push({ tenantId: t.tenantId, resolvido: t.resolvido, erro: t.erro });
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
    expect(ultimo()).toEqual({ tenantId: "", resolvido: false, erro: false });
    await act(async () => { u.resolve(ok("T1")); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "T1", resolvido: true, erro: false });
  });

  it("usuário sem linha em users (data null, sem erro) = sucesso com '' (sem loja), não erro", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(ok(null)); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: false });
  });

  it("1ª carga com erro → erro, tenantId '' e resolvido; tentarDeNovo refaz e limpa o erro", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(falha); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: true });

    const u2 = deferred<any>();
    h.state.users = u2;
    await act(async () => { retentar(); });
    await assentar();
    expect(ultimo().erro).toBe(false); // refazendo = "Carregando"
    expect(ultimo().resolvido).toBe(false);
    await act(async () => { u2.resolve(ok("T1")); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "T1", resolvido: true, erro: false });
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
    expect(ultimo()).toEqual({ tenantId: "T1", resolvido: true, erro: false });
    expect(vistos.filter((v) => v.tenantId !== "T1" || v.erro)).toEqual([]);
  });
});

describe("recarregarLojaAtiva (TenantSwitcher)", () => {
  it("releitura com sucesso: a loja nova vale e nada é zerado", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(ok("A")); });
    await assentar();

    const u2 = deferred<any>();
    h.state.users = u2;
    let fim = false;
    await act(async () => { void recarregarLojaAtiva(qc).then(() => { fim = true; }); });
    await act(async () => { u2.resolve(ok("B")); });
    await assentar();
    expect(fim).toBe(true);
    expect(ultimo()).toEqual({ tenantId: "B", resolvido: true, erro: false });
  });

  it("releitura que FALHA depois da troca: não fica na loja anterior — zera, refaz e mostra erro se falhar de novo", async () => {
    const u = deferred<any>();
    h.state.users = u;
    await montar();
    await act(async () => { u.resolve(ok("A")); });
    await assentar();

    const u2 = deferred<any>();
    h.state.users = u2;
    await act(async () => { void recarregarLojaAtiva(qc); });
    // a releitura (e a nova 1ª carga depois do reset) falham: a promise já resolvida serve às duas
    await act(async () => { u2.resolve(falha); });
    await assentar();
    expect(ultimo()).toEqual({ tenantId: "", resolvido: true, erro: true });
  });
});
