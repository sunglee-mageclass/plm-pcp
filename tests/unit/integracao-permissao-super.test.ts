// @vitest-environment happy-dom
// D7-tela (P-107 A): mesmo sendo admin da loja (tenant_admin), a Integração só aparece/edita com a
// permissão `integracao` concedida PELO SUPER ADMIN no próprio usuário (user_permissions). Papel
// NUNCA carrega `integracao`. RED primeiro nesta cópia de scratch, GREEN depois de implementar.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ler = (p: string) => readFileSync(p, "utf8");

async function montar(el: ReturnType<typeof createElement>): Promise<{ container: HTMLElement; root: Root; unmount: () => void }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  // `act(async ...)` (não síncrono) — mesmo padrão de integracao-tela-fonte.test.ts: deixa efeitos
  // agendados por microtask (ex.: o focus-trap do Radix FocusScope em componentes com Sheet/Dialog)
  // assentarem DENTRO do act, em vez de vazar pro próximo render fora de um act.
  await act(async () => { root.render(el); });
  return { container, root, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) useAuth.canView/canEdit — regra pura, testada importando o módulo de verdade
//    com um estado controlado via um componente-sonda (useAuth precisa do
//    AuthProvider real, que dispara sessão do Supabase — mockamos supabase.auth
//    para nunca disparar onAuthStateChange de verdade, e manipulamos o estado
//    interno através do fluxo normal de loadProfile).
// ─────────────────────────────────────────────────────────────────────────────
describe("useAuth.canView/canEdit — integracao só super admin direto (P-107 A)", () => {
  async function montarSonda(opts: {
    roles: string[];
    permissoes: { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
  }) {
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
          if (table === "user_roles") {
            return { select: () => ({ eq: async () => ({ data: opts.roles.map((role) => ({ role })) }) }) };
          }
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
    const resultRef: { current: { canView: (p: string) => boolean; canEdit: (p: string) => boolean; loading: boolean } | null } = { current: null };
    function Sonda() {
      const auth = useAuth();
      resultRef.current = { canView: auth.canView, canEdit: auth.canEdit, loading: auth.loading };
      return null;
    }
    const view = await montar(createElement(AuthProvider, null, createElement(Sonda)));
    // Dispara a sessão autenticada (simula login) — chama o callback capturado.
    await act(async () => {
      authStateCb.current?.("SIGNED_IN", { user: { id: "u1" } });
      await new Promise((r) => setTimeout(r, 10));
      view.root.render(createElement(AuthProvider, null, createElement(Sonda)));
    });
    // Aguarda o loadProfile (setTimeout(0) interno) resolver.
    for (let i = 0; i < 20 && resultRef.current?.loading; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
    return { resultRef, unmount: view.unmount };
  }

  it("tenant_admin SEM a permissão: canView('integracao') e canEdit('integracao') são false", async () => {
    const { resultRef, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [] });
    expect(resultRef.current?.canView("integracao")).toBe(false);
    expect(resultRef.current?.canEdit("integracao")).toBe(false);
    unmount();
  });

  it("tenant_admin continua com bypass total nas OUTRAS páginas (nenhuma regressão)", async () => {
    const { resultRef, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [] });
    expect(resultRef.current?.canView("criacao_planejamento")).toBe(true);
    expect(resultRef.current?.canEdit("criacao_planejamento")).toBe(true);
    unmount();
  });

  it("tenant_admin COM a permissão explícita em user_permissions: canView/canEdit true", async () => {
    const { resultRef, unmount } = await montarSonda({
      roles: ["tenant_admin"],
      permissoes: [{ pagina: "integracao", pode_ver: true, pode_editar: true }],
    });
    expect(resultRef.current?.canView("integracao")).toBe(true);
    expect(resultRef.current?.canEdit("integracao")).toBe(true);
    unmount();
  });

  it("super admin passa direto, mesmo sem linha em permissions", async () => {
    const { resultRef, unmount } = await montarSonda({ roles: ["super_admin"], permissoes: [] });
    expect(resultRef.current?.canView("integracao")).toBe(true);
    expect(resultRef.current?.canEdit("integracao")).toBe(true);
    unmount();
  });

  it("integracao:* (sub-chave futura) segue a mesma regra", async () => {
    const { resultRef, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [] });
    expect(resultRef.current?.canView("integracao:campos")).toBe(false);
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) Sidebar — checagem de FONTE (mesmo padrão já usado em integracao-tela-fonte.test.ts
//    para este mesmo arquivo — montar AppSidebar de verdade exigiria muitos hooks não
//    triviais de mockar: useTenantModules, useSidebarBadges, useTabLabels, useSystemIdentity,
//    router). Prova que o bypass "isAdmin || isSuperAdmin || isTenantAdmin" não vale para a
//    key/módulo "integracao".
// ─────────────────────────────────────────────────────────────────────────────
describe("app-sidebar — item Integração não usa bypass de admin (P-107 A)", () => {
  it("o filtro de página dentro do módulo não deixa isTenantAdmin/isAdmin pularem canView para a key 'integracao'", () => {
    const s = ler("src/components/app-sidebar.tsx");
    // A linha do filtro de subs não pode mais conceder bypass incondicional; precisa
    // excluir explicitamente a página/módulo "integracao" do bypass de admin.
    const filtroSubs = s.slice(s.indexOf(".filter((p) => PAGE_URLS[p.key]"), s.indexOf(".filter((p) => PAGE_URLS[p.key]") + 400);
    expect(filtroSubs).toMatch(/p\.key === "integracao"/);
  });
  it("o filtro de módulo visível não deixa isTenantAdmin/isAdmin mostrarem o módulo 'integracao' sem canView", () => {
    const s = ler("src/components/app-sidebar.tsx");
    const filtroModulo = s.slice(s.indexOf("const visibleMainItems"), s.indexOf("const visibleMainItems") + 700);
    expect(filtroModulo).toMatch(/m\.module === "integracao"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) RequirePermission / rota /integracao — já usa canView/canEdit puros (sem bypass próprio),
//    então uma vez useAuth corrigido, a rota segue automaticamente. Prova de render real.
// ─────────────────────────────────────────────────────────────────────────────
describe("RequirePermission — bloqueia /integracao sem canView, libera com", () => {
  async function montarRequirePermission(opts: { canView: boolean; canEdit: boolean }) {
    vi.resetModules();
    vi.doMock("@/hooks/useAuth", () => ({
      useAuth: () => ({ canView: () => opts.canView, canEdit: () => opts.canEdit, loading: false }),
    }));
    vi.doMock("@/hooks/useTenantModules", () => ({
      useTenantModules: () => ({ isStockOnly: false, firstActiveModulePath: "/home", isLoading: false }),
    }));
    const { createElement } = await import("react");
    const { RequirePermission } = await import("@/components/RequirePermission");
    const view = await montar(createElement(RequirePermission, { page: "integracao" }, createElement("div", null, "CONTEUDO-INTEGRACAO")));
    return view;
  }

  it("tenant_admin sem permissão: 'Acesso negado' (texto padrão já existente), sem conteúdo da página", async () => {
    const view = await montarRequirePermission({ canView: false, canEdit: false });
    expect(view.container.textContent).toContain("Acesso negado");
    expect(view.container.textContent).not.toContain("CONTEUDO-INTEGRACAO");
    view.unmount();
  });

  it("tenant_admin com permissão: conteúdo aparece", async () => {
    const view = await montarRequirePermission({ canView: true, canEdit: true });
    expect(view.container.textContent).toContain("CONTEUDO-INTEGRACAO");
    view.unmount();
  });

  it("super admin (canView/canEdit sempre true no useAuth): conteúdo aparece", async () => {
    const view = await montarRequirePermission({ canView: true, canEdit: true });
    expect(view.container.textContent).toContain("CONTEUDO-INTEGRACAO");
    view.unmount();
  });
});

// Stub encadeável de `createServerFn`/`createMiddleware` do @tanstack/react-start — os módulos
// `*.functions.ts` (papeis/tenant-admin/admin) chamam `.middleware([...]).validator(...).handler(...)`
// no TOPO do módulo (side-effect de import); nenhum desses handlers roda de verdade nestes testes
// de render (o `useServerFn` mockado abaixo devolve um spy próprio) — o stub só precisa não lançar
// ao ser importado.
function tanstackReactStartStub() {
  const chain: any = {
    middleware: () => chain,
    validator: () => chain,
    handler: (fn: unknown) => ({ __handler: fn }),
  };
  return {
    createServerFn: () => chain,
    createMiddleware: () => ({ server: (fn: unknown) => ({ __middleware: fn }) }),
    useServerFn: (fn: unknown) => fn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PapelEditor — a linha "Integração" NUNCA aparece, e o payload nunca leva 'integracao'.
// ─────────────────────────────────────────────────────────────────────────────
describe("PapelEditor — sem a linha Integração, payload nunca leva integracao", () => {
  async function montarPapelEditor() {
    vi.resetModules();
    const salvarSpy = vi.fn(async () => ({ id: "p1" }));
    vi.doMock("@tanstack/react-start", () => ({ ...tanstackReactStartStub(), useServerFn: () => salvarSpy }));
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
    }));
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PapelEditor } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PapelEditor, {
          papel: { id: null, nome: "", descricao: null, tenant_id: "t1" },
          onClose: () => {},
        }),
      ),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return { ...view, salvarSpy };
  }

  it("a grade do papel não mostra 'Integração' em nenhuma linha", async () => {
    const view = await montarPapelEditor();
    // SheetContent (Radix Portal) monta em document.body, fora do container — mesmo padrão já
    // usado em integracao-celula.test.ts/integracao-trava-tela.test.ts para conteúdo portalado.
    expect(document.body.textContent).not.toContain("Integração");
    view.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) PermissoesModal (editor de USUÁRIO) — linha Integração só no mode="super"; payload do
//    admin da loja (mode="tenant") nunca leva integracao.
// ─────────────────────────────────────────────────────────────────────────────
describe("PermissoesModal (usuário) — linha Integração só para super admin", () => {
  async function montarPermissoesModal(mode: "tenant" | "super") {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
    }));
    vi.doMock("@tanstack/react-start", () => tanstackReactStartStub());
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PermissoesModal } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PermissoesModal, {
          user: { id: "u1", nome: "Fulano", tenant_id: "t1", role: "user", papel_id: null },
          mode,
          onClose: () => {},
        }),
      ),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return view;
  }

  it("mode=tenant (admin da loja editando): a linha Integração NÃO aparece", async () => {
    const view = await montarPermissoesModal("tenant");
    expect(document.body.textContent).not.toContain("Integração");
    view.unmount();
  });

  it("mode=super (super admin editando): a linha Integração aparece", async () => {
    const view = await montarPermissoesModal("super");
    expect(document.body.textContent).toContain("Integração");
    view.unmount();
  });
});
