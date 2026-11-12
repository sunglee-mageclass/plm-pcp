// tests/unit/peca-teste-aba.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
const from = vi.fn(() => ({
  select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true, canEdit: () => true }) }));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PecaTesteAba } from "@/components/producao/servicos/PecaTesteAba";

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); });

describe("PecaTesteAba", () => {
  it("monta sem quebrar quando o modelo não tem trilha (estado null)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        createElement(QueryClientProvider, { client: qc }, createElement(PecaTesteAba, { modeloId: "m1", podeEditar: true })),
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // renderizou algo (seção vazia / "sem peça teste"), não lançou
    expect(container.textContent).toBeTruthy();
  });

  it("monta em modo leitura (podeEditar=false) sem quebrar", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        createElement(QueryClientProvider, { client: qc }, createElement(PecaTesteAba, { modeloId: "m1", podeEditar: false })),
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.textContent).toBeTruthy();
  });
});
