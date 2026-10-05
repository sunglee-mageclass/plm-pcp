// @vitest-environment happy-dom
// [backend F1, review m4] Home (HomeLogado) e SectionHub com a 1ª carga da loja/módulos FALHA: mostram <LojaErroAviso>
// (com "Tentar de novo"/"Tentando…"), sem cards/atalhos/blocos vazios como se a loja não tivesse nada.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ mods: { erro: true, tentando: false, tentarDeNovo: () => {} } }));

vi.mock("@tanstack/react-router", () => ({
  Link: (p: any) => createElement("a", { href: String(p.to ?? "") }, p.children),
  Navigate: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", user_metadata: {} }, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true,
    canView: () => true, canEdit: () => true, loading: false,
  }),
}));
vi.mock("@/hooks/useTenantModules", () => ({
  useTenantModules: () => ({
    modules: {}, isModuleEnabled: () => false, isStockOnly: false, isLoading: true, pronto: false,
    erro: h.mods.erro, tentando: h.mods.tentando, tentarDeNovo: () => h.mods.tentarDeNovo(),
  }),
}));
vi.mock("@/hooks/useSidebarBadges", () => ({ useSidebarBadges: () => ({ data: {}, isLoading: false, isError: false }) }));
vi.mock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja", logo: null }) }));
vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
vi.mock("@/hooks/useTabLabels", () => ({ useTabLabels: () => ({}) }));
vi.mock("@/components/home/TecelagemAnimacao", () => ({ TecelagemAnimacao: () => null }));

import { HomeLogado } from "@/components/home/HomeLogado";
import { SectionHub } from "@/components/SectionHub";

async function montar(el: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, el)); });
  return { container, desmontar: () => act(() => root.unmount()) };
}
const botao = (c: HTMLElement) => c.querySelector("button") as HTMLButtonElement;

beforeEach(() => {
  h.mods = { erro: true, tentando: false, tentarDeNovo: () => {} };
});

describe.each([
  ["HomeLogado", () => createElement(HomeLogado)],
  ["SectionHub", () => createElement(SectionHub, { module: "pcp" })],
])("%s — 1ª carga da loja falhou", (_nome, tela) => {
  it("mostra o aviso com 'Tentar de novo' (chama tentarDeNovo) e nada da tela normal", async () => {
    const tentar = vi.fn();
    h.mods.tentarDeNovo = tentar;
    const { container, desmontar } = await montar(tela());
    expect(container.textContent).toContain("Não foi possível carregar a sua loja");
    expect(container.textContent).not.toContain("Precisa da sua atenção");
    expect(botao(container).textContent).toBe("Tentar de novo");
    await act(async () => { botao(container).click(); });
    expect(tentar).toHaveBeenCalledTimes(1);
    desmontar();
  });

  it("tentando: o aviso fica com o botão 'Tentando…' desabilitado", async () => {
    h.mods.tentando = true;
    const { container, desmontar } = await montar(tela());
    expect(botao(container).textContent).toBe("Tentando…");
    expect(botao(container).disabled).toBe(true);
    desmontar();
  });
});
