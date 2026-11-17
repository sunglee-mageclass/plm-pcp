// @vitest-environment happy-dom
// Exportar dados como item próprio da sidebar (nov/2026): mesma regra SEM bypass de admin da Integração.
//  - sidebar: o módulo `exportar_dados` está no conjunto sem-bypass e o `max-md:hidden` segue SÓ na Integração;
//  - useAuth REAL: tenant_admin sem a key NÃO vê; com a key vê; super admin vê;
//  - PermissoesModal: a linha some do editor de admin da loja (mode="tenant") e aparece para o super admin.
// Sem JSX (arquivo .ts). Espelha tests/unit/integracao-permissao-super.test.ts.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ler = (p: string) => readFileSync(p, "utf8");

async function montar(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(el); });
  return { container, root, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

describe("app-sidebar — item 'Exportar dados' sem bypass de admin", () => {
  const s = ler("src/components/app-sidebar.tsx");

  it("MODULOS_SEM_BYPASS_ADMIN contém integracao E exportar_dados e o filtro de módulo usa o conjunto", () => {
    expect(s).toMatch(/MODULOS_SEM_BYPASS_ADMIN = new Set\(\["integracao", "exportar_dados"\]\)/);
    // A cadeia `visibleMainItems` pode ganhar filtros novos no meio (ex.: `.filter((m) => m.module !== "manual")`
    // do Manual universal) — a janela vai até o `.map(` que fecha a cadeia de `.filter(...)`, não um offset fixo.
    const i = s.indexOf("const visibleMainItems");
    const filtro = s.slice(i, s.indexOf(".map(", i));
    expect(filtro).toMatch(/MODULOS_SEM_BYPASS_ADMIN\.has\(m\.module\)\s*\?\s*m\.pages\.some\(.*canView\(p\.key\)/);
  });

  it("o item vem do catálogo: módulo 'exportar_dados', /exportar-dados, página única, sem PAGE_URLS (link direto)", () => {
    const m = PAGES_CATALOG.find((x) => x.module === "exportar_dados");
    expect(m).toMatchObject({ basePath: "/exportar-dados" });
    expect(m!.pages.map((p) => p.key)).toEqual(["exportar_dados"]);
    expect(ler("src/lib/nav.ts")).not.toMatch(/\bexportar_dados:\s*"/); // só MODULE_META (objeto), nunca string de URL
    expect(ler("src/lib/nav.ts")).toMatch(/exportar_dados:\s*\{ title: "Exportar dados"/);
  });

  it("max-md:hidden fica SÓ no item /integracao (Exportar dados funciona no celular)", () => {
    expect(s).toMatch(/item\.url === "\/integracao" \? "max-md:hidden"/);
    expect(s).not.toMatch(/\/exportar-dados"\s*\?\s*"max-md:hidden"/);
    // nenhuma ocorrência de max-md:hidden perto de "exportar" (item, atalho do Admin Mestre ou comentário)
    for (const m of s.matchAll(/max-md:hidden/g)) {
      expect(s.slice(Math.max(0, m.index! - 200), m.index! + 200).toLowerCase()).not.toContain("exportar");
    }
  });
});

describe("useAuth.canView — exportar_dados sem bypass de tenant_admin", () => {
  async function montarSonda(opts: { roles: string[]; permissoes: { pagina: string; pode_ver: boolean; pode_editar: boolean }[] }) {
    vi.resetModules();
    const authStateCb: { current: ((event: string, session: unknown) => void) | null } = { current: null };
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        auth: {
          onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
            authStateCb.current = cb;
            return { data: { subscription: { unsubscribe: () => {} } } };
          },
          getSession: async () => ({ data: { session: null } }),
        },
        from: (table: string) => {
          if (table === "user_roles") return { select: () => ({ eq: async () => ({ data: opts.roles.map((role) => ({ role })) }) }) };
          throw new Error(`tabela não mockada: ${table}`);
        },
        rpc: async (name: string) => {
          if (name === "minhas_permissoes_efetivas") return { data: opts.permissoes };
          throw new Error(`rpc não mockada: ${name}`);
        },
      },
    }));
    vi.doMock("@/lib/storage-tenant", () => ({ clearTenantPrefixCache: () => {} }));
    const { AuthProvider, useAuth } = await import("@/hooks/useAuth");
    const ref: { current: { canView: (p: string) => boolean; canEdit: (p: string) => boolean; loading: boolean } | null } = { current: null };
    function Sonda() {
      const a = useAuth();
      ref.current = { canView: a.canView, canEdit: a.canEdit, loading: a.loading };
      return null;
    }
    const view = await montar(createElement(AuthProvider, null, createElement(Sonda)));
    await act(async () => {
      authStateCb.current?.("SIGNED_IN", { user: { id: "u1" } });
      await new Promise((r) => setTimeout(r, 10));
      view.root.render(createElement(AuthProvider, null, createElement(Sonda)));
    });
    for (let i = 0; i < 20 && ref.current?.loading; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return { ref, unmount: view.unmount };
  }

  it("tenant_admin SEM a key: não vê nem edita (o item não aparece na sidebar)", async () => {
    const { ref, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [] });
    expect(ref.current?.canView("exportar_dados")).toBe(false);
    expect(ref.current?.canEdit("exportar_dados")).toBe(false);
    unmount();
  });

  it("tenant_admin COM a key concedida pelo super: vê", async () => {
    const { ref, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [{ pagina: "exportar_dados", pode_ver: true, pode_editar: true }] });
    expect(ref.current?.canView("exportar_dados")).toBe(true);
    unmount();
  });

  it("super admin vê direto, sem linha em permissions", async () => {
    const { ref, unmount } = await montarSonda({ roles: ["super_admin"], permissoes: [] });
    expect(ref.current?.canView("exportar_dados")).toBe(true);
    unmount();
  });

  it("nenhuma regressão: tenant_admin segue com bypass nas outras páginas", async () => {
    const { ref, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [] });
    expect(ref.current?.canView("criacao_planejamento")).toBe(true);
    unmount();
  });
});

function tanstackReactStartStub() {
  const chain: any = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => ({ __handler: fn }) };
  return {
    createServerFn: () => chain,
    createMiddleware: () => ({ server: (fn: unknown) => ({ __middleware: fn }) }),
    useServerFn: (fn: unknown) => fn,
  };
}

describe("PermissoesModal — linha 'Exportar dados' só para super admin", () => {
  async function montarModal(mode: "tenant" | "super") {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
    }));
    vi.doMock("@tanstack/react-start", () => ({ ...tanstackReactStartStub(), useServerFn: () => vi.fn(async () => undefined) }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PermissoesModal } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PermissoesModal, { user: { id: "u1", nome: "Fulano", tenant_id: "t1", role: "user", papel_id: null }, mode, onClose: () => {} }),
      ),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return view;
  }

  it("mode=tenant (admin da loja editando): a linha Exportar dados NÃO aparece (e a Integração também não)", async () => {
    const view = await montarModal("tenant");
    expect(document.body.textContent).not.toContain("Exportar dados");
    expect(document.body.textContent).not.toContain("Integração");
    view.unmount();
  });

  it("mode=super (super admin editando): a linha Exportar dados aparece", async () => {
    const view = await montarModal("super");
    expect(document.body.textContent).toContain("Exportar dados");
    view.unmount();
  });

  it("o helper do modal não deixa literal órfão de 'integracao' fora da lista só-super", () => {
    const s = ler("src/components/admin/PermissoesModal.tsx");
    expect(s).toMatch(/KEYS_SO_SUPER = \["integracao", "exportar_dados"\] as const/);
    expect(s).not.toMatch(/ehChaveIntegracao|SEM_INTEGRACAO|catalogoSemIntegracao|paginasSemIntegracao/);
  });
});
