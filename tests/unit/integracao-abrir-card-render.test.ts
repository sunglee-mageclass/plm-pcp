// @vitest-environment happy-dom
// R14 (L9): render de verdade de IntegracaoPage + LogAba com o "abrir card" em Sheet.
import { describe, it, expect, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function montarPagina(tenantIdRef: { current: string }) {
  vi.resetModules();
  vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => tenantIdRef.current }));
  vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ isSuperAdmin: true, user: { id: "u1" }, canView: () => true }) }));
  vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
  vi.doMock("@tanstack/react-router", () => ({
    useBlocker: () => ({ status: "idle" as const, proceed: vi.fn(), reset: vi.fn() }),
  }));
  const props: { onClose?: () => void; onSaved?: () => void } = {};
  vi.doMock("@/components/planejamento/PlanejamentoDetail", () => ({
    PlanejamentoDetail: (p: { modeloId: string; contexto: string; onClose: () => void; onSaved: () => void }) => {
      props.onClose = p.onClose; props.onSaved = p.onSaved;
      return createElement("div", null, `sheet:${p.modeloId}:${p.contexto}`);
    },
  }));
  const { createElement } = await import("react");
  const { act } = await import("react");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { useAbrirCard } = await import("@/components/integracao/abrir-card");
  function ProdutosAbaStub() {
    const abrir = useAbrirCard();
    return createElement("button", { onClick: () => abrir?.("m1") }, "abrir-m1");
  }
  vi.doMock("@/components/integracao/ProdutosAba", () => ({ ProdutosAba: ProdutosAbaStub }));
  vi.doMock("@/components/integracao/CamposAba", () => ({ CamposAba: () => null }));
  vi.doMock("@/components/integracao/ApiAba", () => ({ ApiAba: () => null }));
  const { createRoot } = await import("react-dom/client");
  const { SidebarProvider } = await import("@/components/ui/sidebar");
  const { IntegracaoPage } = await import("@/components/integracao/IntegracaoPage");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const arvore = () => createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(IntegracaoPage)));
  await act(async () => { root.render(arvore()); });
  return {
    container, qc, props, act,
    rerender: () => act(async () => { root.render(arvore()); }),
    abrir: () => act(async () => { (Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "abrir-m1") as HTMLButtonElement).click(); }),
    desmontar: () => act(async () => { root.unmount(); container.remove(); }),
  };
}

describe("IntegracaoPage — abrir card em Sheet (R14, P-199 A)", () => {
  it("abre UMA instância do Sheet com contexto 'integracao'; onClose fecha e invalida a Integração (M-B)", async () => {
    const t = { current: "lojaA" };
    const v = await montarPagina(t);
    expect(v.container.textContent).not.toContain("sheet:");
    await v.abrir();
    expect(v.container.textContent).toContain("sheet:m1:integracao");
    const spy = vi.spyOn(v.qc, "invalidateQueries");
    await v.act(async () => { v.props.onClose!(); });
    const chaves = spy.mock.calls.map((c) => JSON.stringify((c[0] as any).queryKey));
    expect(chaves).toContain(JSON.stringify(["integracao-lista", "lojaA"]));
    expect(chaves).toContain(JSON.stringify(["pa-produto-modelo", "m1"]));
    expect(chaves).toContain(JSON.stringify(["integracao-sku-previa", "lojaA", "m1"]));
    expect(v.container.textContent).not.toContain("sheet:");
    await v.desmontar();
  });
  it("onSaved relista a Integração (lista + log) e o Sheet continua aberto", async () => {
    const t = { current: "lojaA" };
    const v = await montarPagina(t);
    await v.abrir();
    const spy = vi.spyOn(v.qc, "invalidateQueries");
    await v.act(async () => { v.props.onSaved!(); });
    const chaves = spy.mock.calls.map((c) => JSON.stringify((c[0] as any).queryKey));
    expect(chaves).toContain(JSON.stringify(["integracao-lista", "lojaA"]));
    expect(chaves).toContain(JSON.stringify(["integracao-log", "lojaA"]));
    expect(v.container.textContent).toContain("sheet:m1:integracao");
    await v.desmontar();
  });
  it("trocar de loja com o Sheet aberto fecha, e NÃO reabre ao voltar (X→Y→X, L1)", async () => {
    const t = { current: "lojaA" };
    const v = await montarPagina(t);
    await v.abrir();
    expect(v.container.textContent).toContain("sheet:m1");
    t.current = "lojaB";
    await v.rerender();
    expect(v.container.textContent).not.toContain("sheet:");
    t.current = "lojaA";
    await v.rerender();
    expect(v.container.textContent).not.toContain("sheet:");
    await v.desmontar();
  });
});

describe("LogAba — nome do produto (R14, P-199 A)", () => {
  async function montarLog(ver: boolean, comProvider: boolean) {
    vi.resetModules();
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "lojaA" }));
    vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => ver }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { rpc: async () => ({ error: null, data: {
        pagina: 1, por_pagina: 50, total: 1, super: false,
        linhas: [{ id: "1", acao: "integrar", quem: "Ana", quando: "2026-10-01T12:00:00Z", modelo_id: "m1", modelo_nome: "Vestido Rosa", detalhe: {} }],
      } }) },
    }));
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { createRoot } = await import("react-dom/client");
    const { AbrirCardContext } = await import("@/components/integracao/abrir-card");
    const { LogAba } = await import("@/components/integracao/LogAba");
    const abrir = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const log = createElement(LogAba);
    const arvore = createElement(QueryClientProvider, { client: qc }, comProvider ? createElement(AbrirCardContext.Provider, { value: abrir }, log) : log);
    await act(async () => { root.render(arvore); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    return { container, abrir, act, desmontar: () => act(async () => { root.unmount(); container.remove(); }) };
  }
  it("com permissão: botão que chama abrirCard(modeloId)", async () => {
    const v = await montarLog(true, true);
    const btn = v.container.querySelector("button[aria-label='Abrir card de Vestido Rosa']") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await v.act(async () => { btn.click(); });
    expect(v.abrir).toHaveBeenCalledWith("m1");
    await v.desmontar();
  });
  it("sem permissão: nome em texto puro, sem botão nem link", async () => {
    const v = await montarLog(false, true);
    expect(v.container.textContent).toContain("Vestido Rosa");
    expect(v.container.querySelector("button[aria-label^='Abrir card']")).toBeNull();
    expect(v.container.querySelector("a")).toBeNull();
    await v.desmontar();
  });
});
