// @vitest-environment happy-dom
// [backend F1, review m4] Fiação do TenantSwitcher: depois da troca no servidor ele chama `recarregarLojaAtiva(qc, user.id,
// tenant_id)` e, se a releitura falhou, EXCLUI `active-tenant-id` da invalidação global (sem 3ª rodada de retries).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  recarregar: vi.fn(),
  navigate: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, isSuperAdmin: true }) }));
vi.mock("@/hooks/useActiveTenantId", () => ({ recarregarLojaAtiva: (...a: unknown[]) => h.recarregar(...a) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => (arg: unknown) => h.setActive(arg) }));
vi.mock("@/lib/admin.functions", () => ({ setActiveTenant: {} }));
vi.mock("@/lib/storage-tenant", () => ({ clearTenantPrefixCache: () => {} }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q,
        order: () => Promise.resolve({ data: [{ id: "A", nome: "Loja A" }, { id: "B", nome: "Loja B" }], error: null }),
        eq: () => q,
        maybeSingle: () => Promise.resolve({ data: tabela === "users" ? { tenant_id: "A" } : null, error: null }),
      };
      return q;
    },
  },
}));
// Select nativo simplificado (o Radix não abre em happy-dom): cada item vira um botão que dispara onValueChange.
vi.mock("@/components/ui/select", () => {
  const Ctx = (globalThis as any).__selCtx ?? ((globalThis as any).__selCtx = { onValueChange: (_: string) => {} });
  return {
    Select: (p: any) => { Ctx.onValueChange = p.onValueChange; return createElement("div", null, p.children); },
    SelectTrigger: (p: any) => createElement("div", null, p.children),
    SelectValue: () => null,
    SelectContent: (p: any) => createElement("div", null, p.children),
    SelectItem: (p: any) => createElement("button", { "data-loja": p.value, onClick: () => Ctx.onValueChange(p.value) }, p.children),
  };
});

import { TenantSwitcher } from "@/components/admin/TenantSwitcher";

let qc: QueryClient;
async function montar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(TenantSwitcher))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { container, desmontar: () => act(() => root.unmount()) };
}

beforeEach(() => {
  h.recarregar.mockReset();
  h.navigate.mockReset();
  h.setActive.mockReset().mockResolvedValue({ ok: true });
});

async function trocarParaB(container: HTMLElement) {
  const botao = container.querySelector('button[data-loja="B"]') as HTMLButtonElement;
  expect(botao).toBeTruthy();
  await act(async () => { botao.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

describe("TenantSwitcher — releitura da loja depois da troca", () => {
  it("releitura ok: chama recarregarLojaAtiva(qc, userId, loja escolhida), invalida TUDO e vai para /home", async () => {
    h.recarregar.mockResolvedValue(true);
    const { container, desmontar } = await montar();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await trocarParaB(container);
    expect(h.recarregar).toHaveBeenCalledWith(qc, "u1", "B");
    expect(spy).toHaveBeenCalledWith(undefined);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/home" });
    desmontar();
  });

  it("releitura FALHOU: a invalidação global exclui `active-tenant-id` (nada de 3ª rodada de retries), mas segue para /home", async () => {
    h.recarregar.mockResolvedValue(false);
    const { container, desmontar } = await montar();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await trocarParaB(container);
    const filtro = spy.mock.calls.map((c) => c[0] as { predicate?: (q: any) => boolean } | undefined).find((f) => f?.predicate);
    expect(filtro).toBeTruthy();
    expect(filtro!.predicate!({ queryKey: ["active-tenant-id", "u1"] })).toBe(false);
    expect(filtro!.predicate!({ queryKey: ["tenant_config", "modules", "B"] })).toBe(true);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/home" });
    desmontar();
  });
});
