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
  it("o filtro de módulo visível não deixa isTenantAdmin/isAdmin mostrarem o módulo 'integracao' sem canView", () => {
    const s = ler("src/components/app-sidebar.tsx");
    const filtroModulo = s.slice(s.indexOf("const visibleMainItems"), s.indexOf("const visibleMainItems") + 700);
    expect(filtroModulo).toMatch(/m\.module === "integracao"/);
  });
  // L-1 (fix round 1): o filtro de SUB-página (dentro de um módulo já visível) nunca chega a rodar
  // pra "integracao" porque `PAGE_URLS.integracao` não existe (ela é link direto, não um
  // Collapsible) — `PAGE_URLS[p.key]` já corta antes do bypass importar. A proteção real é só o
  // filtro de MÓDULO acima. Removido o ramo morto (achado L-1); este teste prova a premissa que o
  // torna morto: se algum dia `PAGE_URLS.integracao` for adicionada, este teste falha e avisa que o
  // filtro de sub-página passa a valer de verdade (precisando do mesmo tratamento sem-bypass).
  it("PAGE_URLS não tem entrada para 'integracao' — é a premissa que torna o filtro de sub-página irrelevante para ela", () => {
    const s = ler("src/lib/nav.ts");
    expect(s).not.toMatch(/\bintegracao:\s*"/);
  });
  it("o filtro de sub-página não tem ramo morto (comentário explica a proteção real)", () => {
    const s = ler("src/components/app-sidebar.tsx");
    const i = s.indexOf(".filter((p) => PAGE_URLS[p.key]");
    const filtroSubs = s.slice(i - 900, i + 100); // comentário fica ANTES da linha do filtro
    expect(filtroSubs).toMatch(/L-1/);
    expect(s.slice(i, i + 400)).not.toMatch(/p\.key === "integracao"/);
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
      useTenantModules: () => ({ isStockOnly: false, isModuleEnabled: () => true, firstActiveModulePath: "/home", isLoading: false }),
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
  async function montarPapelEditor(opts: { existing?: { pagina: string; pode_ver: boolean; pode_editar: boolean }[] } = {}) {
    vi.resetModules();
    const salvarSpy = vi.fn(async () => ({ id: "p1" }));
    vi.doMock("@tanstack/react-start", () => ({ ...tanstackReactStartStub(), useServerFn: () => salvarSpy }));
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: opts.existing ?? [], error: null }) }) }) },
    }));
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PapelEditor } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PapelEditor, {
          papel: { id: "papel1", nome: "Existente", descricao: null, tenant_id: "t1" },
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

  // M-1: clica em Salvar de verdade e confere o PAYLOAD (não só o texto na tela). `existing` traz
  // uma linha `integracao` (cenário legado/defesa) — o payload de salvar_papel NUNCA pode levá-la.
  it("M-1: Salvar com existing trazendo uma linha 'integracao' legada — o payload nunca leva integracao*", async () => {
    const view = await montarPapelEditor({
      existing: [
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false },
      ],
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
    expect(view.salvarSpy).toHaveBeenCalledTimes(1);
    const payload = view.salvarSpy.mock.calls[0][0].data.perms as { pagina: string }[];
    expect(payload.some((p) => p.pagina === "integracao" || p.pagina.startsWith("integracao:"))).toBe(false);
    // O resto do papel grava normal (a linha não-integracao sobrevive no payload).
    expect(payload.some((p) => p.pagina === "cadastro_tecidos")).toBe(true);
    view.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) PermissoesModal (editor de USUÁRIO) — linha Integração só no mode="super"; payload do
//    admin da loja (mode="tenant") nunca leva integracao.
// ─────────────────────────────────────────────────────────────────────────────
describe("PermissoesModal (usuário) — linha Integração só para super admin", () => {
  async function montarPermissoesModal(opts: {
    mode: "tenant" | "super";
    role?: string;
    existing?: { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
  }) {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: opts.existing ?? [], error: null }) }) }) },
    }));
    const callTenantSpy = vi.fn(async () => undefined);
    const callSuperSpy = vi.fn(async () => undefined);
    vi.doMock("@tanstack/react-start", () => ({
      ...tanstackReactStartStub(),
      // `useServerFn(savePermissions)`/`useServerFn(savePermissionsAsSuperAdmin)` — distingue pela
      // REFERÊNCIA da função recebida (import real dos módulos .functions.ts, que o stub de
      // createServerFn devolve como a MESMA `chain` para os dois — precisa dos dois specific imports
      // pra apontar cada spy pro `fn` certo).
      useServerFn: (fn: unknown) => (fn === savePermissionsRef.current ? callTenantSpy : callSuperSpy),
    }));
    const tenantAdminFns = await import("@/lib/tenant-admin.functions");
    const savePermissionsRef = { current: tenantAdminFns.savePermissions };
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PermissoesModal } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PermissoesModal, {
          user: { id: "u1", nome: "Fulano", tenant_id: "t1", role: opts.role ?? "user", papel_id: null },
          mode: opts.mode,
          onClose: () => {},
        }),
      ),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return { ...view, callTenantSpy, callSuperSpy };
  }

  it("mode=tenant (admin da loja editando): a linha Integração NÃO aparece", async () => {
    const view = await montarPermissoesModal({ mode: "tenant" });
    expect(document.body.textContent).not.toContain("Integração");
    view.unmount();
  });

  it("mode=super (super admin editando): a linha Integração aparece", async () => {
    const view = await montarPermissoesModal({ mode: "super" });
    expect(document.body.textContent).toContain("Integração");
    view.unmount();
  });

  // M-1: Salvar de verdade (não só olhar o texto). `existing` traz uma linha `integracao` legada —
  // no modo tenant, ela nunca deve entrar no payload de `savePermissions`, mesmo pré-existindo no banco.
  it("M-1 mode=tenant: Salvar com existing trazendo integracao legada — payload nunca leva integracao*", async () => {
    const view = await montarPermissoesModal({
      mode: "tenant",
      existing: [
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false },
      ],
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
    expect(view.callTenantSpy).toHaveBeenCalledTimes(1);
    const payload = view.callTenantSpy.mock.calls[0][0].data.perms as { pagina: string }[];
    expect(payload.some((p) => p.pagina === "integracao" || p.pagina.startsWith("integracao:"))).toBe(false);
    expect(payload.some((p) => p.pagina === "cadastro_tecidos")).toBe(true);
    view.unmount();
  });

  // I-1: o super admin PRECISA conseguir conceder a Integração a um admin da loja (tenant_admin) —
  // esse é o caso principal da P-107 A. Hoje a linha vem marcada/travada com a faixa "acesso total"
  // (bug do achado I-1). Depois do fix: linha desmarcada, habilitada, e o Salvar funciona.
  it("I-1: mode=super + alvo tenant_admin + existing=[] — a caixa da Integração vem DESMARCADA e HABILITADA", async () => {
    const view = await montarPermissoesModal({ mode: "super", role: "tenant_admin", existing: [] });
    try {
      // Acha o checkbox "Leitor" da linha Integração: procuramos pelo texto da label e navegamos até o
      // checkbox correspondente (mesma estrutura de grid da grade real).
      const linhaIntegracao = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === "Integração")?.closest("div.grid");
      expect(linhaIntegracao, "linha Integração deveria existir no DOM").toBeTruthy();
      const checkboxes = Array.from(linhaIntegracao!.querySelectorAll('button[role="checkbox"]'));
      expect(checkboxes.length).toBe(2); // Leitor, Editor
      for (const cb of checkboxes) {
        expect(cb.getAttribute("aria-checked"), "deveria vir DESMARCADA (existing=[])").toBe("false");
        expect(cb.hasAttribute("disabled"), "deveria vir HABILITADA para o super admin conceder").toBe(false);
      }
    } finally {
      view.unmount();
    }
  });

  // Fix round 2 (M-2a): payload EXATO com toEqual (não `find`) — pega a regressão H-1 (67 linhas,
  // 66 delas true/true) que um `find` isolado nunca detectaria.
  it("M-2a: mode=super + alvo tenant_admin SEM linhas — marcar Integração e Salvar manda EXATAMENTE [integracao] (callSuper)", async () => {
    const view = await montarPermissoesModal({ mode: "super", role: "tenant_admin", existing: [] });
    try {
      const linhaIntegracao = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === "Integração")?.closest("div.grid");
      const checkboxes = Array.from(linhaIntegracao!.querySelectorAll('button[role="checkbox"]')) as HTMLButtonElement[];
      const [checkboxVer, checkboxEditar] = checkboxes;
      await act(async () => { checkboxVer.click(); });
      await act(async () => { checkboxEditar.click(); });
      const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      expect(botaoSalvar().hasAttribute("disabled"), "Salvar precisa estar habilitado pro super admin conceder").toBe(false);
      await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
      expect(view.callSuperSpy).toHaveBeenCalledTimes(1);
      const payload = view.callSuperSpy.mock.calls[0][0].data.perms as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
      expect(payload).toEqual([{ pagina: "integracao", pode_ver: true, pode_editar: true }]);
    } finally {
      view.unmount();
    }
  });

  // Fix round 2 (M-2b): REVOGAR (C-1) — existing já tem integracao marcada + uma linha
  // cadastro_tecidos não-integração; desmarcar a Integração e salvar. O payload exato precisa ser
  // só [cadastro_tecidos], SEM integracao (a ausência é o que revoga, via DELETE+INSERT).
  it("M-2b: mode=super + alvo tenant_admin COM integracao marcada — desmarcar e Salvar manda EXATAMENTE [cadastro_tecidos] (revoga)", async () => {
    const view = await montarPermissoesModal({
      mode: "super",
      role: "tenant_admin",
      existing: [
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false },
      ],
    });
    try {
      const linhaIntegracao = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === "Integração")?.closest("div.grid");
      const checkboxes = Array.from(linhaIntegracao!.querySelectorAll('button[role="checkbox"]')) as HTMLButtonElement[];
      const [checkboxVer, checkboxEditar] = checkboxes;
      expect(checkboxVer.getAttribute("aria-checked")).toBe("true");
      expect(checkboxEditar.getAttribute("aria-checked")).toBe("true");
      // Desmarcar Editor primeiro (pode_editar=true força pode_ver=true — desmarcar só Ver com
      // Editor ainda marcado reforçaria Ver de volta); desmarcar os dois revoga por completo.
      await act(async () => { checkboxEditar.click(); });
      await act(async () => { checkboxVer.click(); });
      expect(checkboxVer.getAttribute("aria-checked")).toBe("false");
      expect(checkboxEditar.getAttribute("aria-checked")).toBe("false");
      const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
      expect(view.callSuperSpy).toHaveBeenCalledTimes(1);
      const payload = view.callSuperSpy.mock.calls[0][0].data.perms as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
      expect(payload).toEqual([{ pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false }]);
    } finally {
      view.unmount();
    }
  });

  // Fix round 2 (M-2c): CONCEDER preservando existing — existing já tem cadastro_tecidos (não
  // integração); marcar só "Leitor" da Integração e salvar. Payload exato: a linha existente
  // verbatim + a nova linha da Integração, nunca as ~66 páginas do bypass visual.
  it("M-2c: mode=super + alvo tenant_admin COM cadastro_tecidos — conceder Integração preserva a linha existente verbatim", async () => {
    const view = await montarPermissoesModal({
      mode: "super",
      role: "tenant_admin",
      existing: [{ pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false }],
    });
    try {
      const linhaIntegracao = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === "Integração")?.closest("div.grid");
      const checkboxes = Array.from(linhaIntegracao!.querySelectorAll('button[role="checkbox"]')) as HTMLButtonElement[];
      const [checkboxVer] = checkboxes;
      await act(async () => { checkboxVer.click(); });
      const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
      const payload = view.callSuperSpy.mock.calls[0][0].data.perms as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
      expect(payload).toEqual([
        { pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false },
        { pagina: "integracao", pode_ver: true, pode_editar: false },
      ]);
    } finally {
      view.unmount();
    }
  });

  // Fix round 2 (M-2d): Salvar desabilitado enquanto `existing` ainda carrega (P-57, "salvar
  // rápido"). A query de `existing` nunca resolve neste teste (Promise que não resolve), então o
  // modal fica permanentemente em "Carregando…" — o Salvar precisa estar disabled o tempo todo.
  it("M-2d: Salvar fica DESABILITADO enquanto existing ainda está carregando (P-57)", async () => {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      // eq() nunca resolve — simula a query pendente pra sempre (basta pro teste síncrono de disabled).
      supabase: { from: () => ({ select: () => ({ eq: () => new Promise(() => {}) }) }) },
    }));
    vi.doMock("@tanstack/react-start", () => tanstackReactStartStub());
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PermissoesModal } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PermissoesModal, {
          user: { id: "u1", nome: "Fulano", tenant_id: "t1", role: "tenant_admin", papel_id: null },
          mode: "super",
          onClose: () => {},
        }),
      ),
    );
    try {
      expect(document.body.textContent).toContain("Carregando…");
      const botaoSalvar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      expect(botaoSalvar.hasAttribute("disabled"), "Salvar não pode habilitar antes de existing carregar").toBe(true);
    } finally {
      view.unmount();
    }
  });

  // Re-review round 2 (L, controlador): usuário COM papel — Salvar espera o papel carregar. `existing` resolve na hora
  // (vazio), `papel_permissoes` nunca resolve: o Salvar tem de continuar desabilitado (salvar antes gravaria o delta
  // contra um papel "vazio" e perderia o que o papel concedia — classe P-57).
  it("usuário com papel: Salvar DESABILITADO enquanto o papel ainda carrega", async () => {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        from: (t: string) => ({
          select: () => ({
            eq: () => (t === "papel_permissoes" ? new Promise(() => {}) : Promise.resolve({ data: [], error: null })),
          }),
        }),
      },
    }));
    vi.doMock("@tanstack/react-start", () => tanstackReactStartStub());
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PermissoesModal } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(
      createElement(QueryClientProvider, { client: qc },
        createElement(PermissoesModal, {
          user: { id: "u1", nome: "Fulano", tenant_id: "t1", role: "user", papel_id: "p1" },
          mode: "tenant",
          onClose: () => {},
        }),
      ),
    );
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const botaoSalvar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      expect(botaoSalvar, "o botão Salvar existe").toBeTruthy();
      expect(botaoSalvar.hasAttribute("disabled"), "Salvar não pode habilitar antes do papel carregar").toBe(true);
    } finally {
      view.unmount();
      vi.doUnmock("@/integrations/supabase/client");
    }
  });

  // Fix round 2 (M-2e): regressão — usuário COMUM (não-admin) no modo super, e admin no modo
  // tenant, continuam com o MESMO payload de antes desta correção (snapshot de um caso cada).
  it("M-2e regressão: mode=super + usuário COMUM — payload continua íntegro (snapshot)", async () => {
    const view = await montarPermissoesModal({
      mode: "super",
      role: "user",
      existing: [{ pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false }],
    });
    try {
      const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
      const payload = view.callSuperSpy.mock.calls[0][0].data.perms as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
      // Usuário comum: perms vem direto de `pageKeys × state`, sem o ramo `isAdminRole` — o loop
      // de `existing` popula o `state` inicial 1:1 (nenhuma expansão de bypass aqui).
      expect(payload).toEqual([{ pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false }]);
    } finally {
      view.unmount();
    }
  });

  it("M-2e regressão: mode=tenant + alvo admin — payload continua vazio (Salvar habilitado só p/ super, não altera nada)", async () => {
    const view = await montarPermissoesModal({
      mode: "tenant",
      role: "tenant_admin",
      existing: [{ pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false }],
    });
    try {
      // mode=tenant + isAdminRole: Salvar segue desabilitado (regra da rodada 1, inalterada) —
      // não há ação possível aqui; a prova de regressão é justamente que o botão CONTINUA travado.
      const botaoSalvar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      expect(botaoSalvar.hasAttribute("disabled")).toBe(true);
      expect(view.callTenantSpy).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it("I-1: mode=tenant + alvo admin (admin da loja editando outro admin) — a linha Integração continua ESCONDIDA (só a faixa MENCIONA a Integração em texto)", async () => {
    const view = await montarPermissoesModal({ mode: "tenant", role: "tenant_admin", existing: [] });
    // A faixa âmbar de admin agora MENCIONA "Integração" em prosa (I-1, item 4 do achado) — a
    // asserção real é que não existe uma LINHA/checkbox de Integração na grade (mesma checagem
    // estrutural usada no teste "a caixa da Integração vem DESMARCADA" acima).
    const linhaIntegracao = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === "Integração");
    expect(linhaIntegracao, "não deveria existir uma linha/checkbox própria da Integração").toBeUndefined();
    view.unmount();
  });

  it("I-1: mode=super + alvo admin — as OUTRAS páginas continuam marcadas/travadas (só a Integração muda)", async () => {
    const view = await montarPermissoesModal({ mode: "super", role: "tenant_admin", existing: [] });
    try {
      const linhaCadastro = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === "Tecidos")?.closest("div.grid");
      expect(linhaCadastro, "linha de outra página deveria existir").toBeTruthy();
      const checkboxes = Array.from(linhaCadastro!.querySelectorAll('button[role="checkbox"]'));
      for (const cb of checkboxes) {
        expect(cb.getAttribute("aria-checked"), "outras páginas seguem marcadas (bypass de admin)").toBe("true");
        expect(cb.hasAttribute("disabled"), "outras páginas seguem travadas").toBe(true);
      }
    } finally {
      view.unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M-1 (segunda parte): um teste que FALHARIA se o bypass de admin voltasse pra "integracao", usando
// o AuthContext REAL (não um mock do próprio gate) — RequirePermission acima usa useAuth MOCKADO, o
// que não pegaria uma regressão no próprio useAuth. Aqui reaproveitamos a sonda real de
// AuthProvider (mesmo padrão do describe 1) e verificamos RequirePermission montado por cima dela.
// ─────────────────────────────────────────────────────────────────────────────
describe("RequirePermission + AuthProvider REAL — bloqueia /integracao sem mockar o próprio gate", () => {
  async function montarComAuthReal(opts: { roles: string[]; permissoes: { pagina: string; pode_ver: boolean; pode_editar: boolean }[] }) {
    vi.resetModules();
    // O describe "RequirePermission — bloqueia..." (acima) registrou `vi.doMock("@/hooks/useAuth", ...)`
    // — isso persiste para o resto do ARQUIVO (não é escopado por describe/it), então precisamos
    // desfazer aqui para importar o `AuthProvider`/`useAuth` DE VERDADE (mesmo padrão documentado em
    // integracao-tela-fonte.test.ts sobre vi.doMock vazar entre describes).
    vi.doUnmock("@/hooks/useAuth");
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
    vi.doMock("@/hooks/useTenantModules", () => ({
      useTenantModules: () => ({ isStockOnly: false, isModuleEnabled: () => true, firstActiveModulePath: "/home", isLoading: false }),
    }));
    const { createElement } = await import("react");
    const { AuthProvider } = await import("@/hooks/useAuth");
    const { RequirePermission } = await import("@/components/RequirePermission");
    const view = await montar(
      createElement(AuthProvider, null, createElement(RequirePermission, { page: "integracao" }, createElement("div", null, "CONTEUDO-INTEGRACAO"))),
    );
    // Dispara a sessão autenticada (simula login já feito) e aguarda o loadProfile.
    await act(async () => {
      authStateCb.current?.("SIGNED_IN", { user: { id: "u1" } });
      await new Promise((r) => setTimeout(r, 30));
    });
    return view;
  }

  it("tenant_admin sem a permissão explícita: 'Acesso negado' de verdade (useAuth real, sem mock do gate)", async () => {
    const view = await montarComAuthReal({ roles: ["tenant_admin"], permissoes: [] });
    expect(view.container.textContent).toContain("Acesso negado");
    expect(view.container.textContent).not.toContain("CONTEUDO-INTEGRACAO");
    view.unmount();
  });

  it("tenant_admin COM a permissão explícita: conteúdo aparece (useAuth real)", async () => {
    const view = await montarComAuthReal({ roles: ["tenant_admin"], permissoes: [{ pagina: "integracao", pode_ver: true, pode_editar: true }] });
    expect(view.container.textContent).toContain("CONTEUDO-INTEGRACAO");
    view.unmount();
  });
});
