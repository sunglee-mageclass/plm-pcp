// @vitest-environment happy-dom
// F5c (P-112 A, 28/set) — RED scratch copy: Dashboard permissões organizadas (dados agrupados
// por aba, com InfoHover) + Financeiro por aba (nova `financeiro_servicos`, aba padrão =
// 1ª permitida, `?tab=` só respeitado se permitido). Roda a MESMA suíte que depois vai para
// tests/unit/permissoes-dash-fin.test.ts (cópia idêntica — RED aqui, GREEN lá).
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function montar(el: ReturnType<typeof import("react").createElement>): Promise<{ container: HTMLElement; root: Root; unmount: () => void }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(el); });
  return { container, root, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

function tanstackReactStartStub() {
  const chain: any = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => ({ __handler: fn }) };
  return {
    createServerFn: () => chain,
    createMiddleware: () => ({ server: (fn: unknown) => ({ __middleware: fn }) }),
    useServerFn: (fn: unknown) => fn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) PermissoesModal (usuário) — Dashboard: as 6 chaves de DADOS aparecem AGRUPADAS sob uma
//    sub-legenda "Dados por aba" com InfoHover, e o payload de Salvar continua EXATO (mesmas
//    keys de antes, nada renomeado/removido).
// ─────────────────────────────────────────────────────────────────────────────
describe("PermissoesModal (usuário) — Dashboard organizado (F5c)", () => {
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

  it("as 6 chaves de dados aparecem sob a sub-legenda 'Dados por aba', com InfoHover", async () => {
    const view = await montarPermissoesModal({ mode: "tenant" });
    try {
      expect(document.body.textContent).toContain("Dados por aba");
      // As 6 chaves de dados, com o rótulo novo "Dados: X" (display only — key intacta).
      for (const rotulo of ["Dados: Coleção", "Dados: Estoque", "Dados: Produção", "Dados: Financeiro", "Dados: Custos", "Dados: Comercial"]) {
        expect(document.body.textContent).toContain(rotulo);
      }
      // InfoHover: o botão "i" com aria-label específico da sub-legenda existe.
      const infoBtn = document.body.querySelector('button[aria-label="O que são as permissões de Dados por aba"]');
      expect(infoBtn, "botão do InfoHover deveria existir").toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  it("a sub-legenda 'Dados por aba' aparece DEPOIS das 5 abas (Desenvolvimento…Leadtime) no DOM", async () => {
    const view = await montarPermissoesModal({ mode: "tenant" });
    try {
      const texto = document.body.textContent ?? "";
      // "Custo & Financeiro" é a última das 5 ABAS (rótulo único — não colide com nenhuma das
      // 6 linhas "Dados: X"); a sub-legenda precisa vir DEPOIS dela no DOM.
      const idxUltimaAba = texto.indexOf("Custo & Financeiro");
      const idxSubLegenda = texto.indexOf("Dados por aba");
      expect(idxUltimaAba).toBeGreaterThan(-1);
      expect(idxSubLegenda).toBeGreaterThan(idxUltimaAba);
    } finally {
      view.unmount();
    }
  });

  it("payload de Salvar continua EXATO — mesmas 6 chaves de dados, sem renomear/remover (mode=tenant, alvo comum)", async () => {
    const view = await montarPermissoesModal({
      mode: "tenant",
      role: "user",
      existing: [
        { pagina: "dashboard_colecao", pode_ver: true, pode_editar: false },
        { pagina: "dashboard_custos", pode_ver: true, pode_editar: true },
      ],
    });
    try {
      const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
      expect(view.callTenantSpy).toHaveBeenCalledTimes(1);
      const payload = view.callTenantSpy.mock.calls[0][0].data.perms as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
      expect(payload).toEqual([
        { pagina: "dashboard_colecao", pode_ver: true, pode_editar: false },
        { pagina: "dashboard_custos", pode_ver: true, pode_editar: true },
      ]);
    } finally {
      view.unmount();
    }
  });

  it("'marcar todos' do módulo Dashboard continua marcando TODAS as 12 keys (5 abas + 6 dados... 11 páginas), inclusive as agrupadas", async () => {
    const view = await montarPermissoesModal({ mode: "super", role: "tenant_admin", existing: [] });
    try {
      // Acha o cabeçalho do módulo Dashboard e o checkbox "Leitor" do topo (marcar todos).
      const headerDashboard = Array.from(document.body.querySelectorAll("h3")).find((h) => h.textContent === "Dashboard");
      expect(headerDashboard, "cabeçalho do módulo Dashboard deveria existir").toBeTruthy();
      const bloco = headerDashboard!.nextElementSibling as HTMLElement;
      const headerRow = bloco.querySelector("div.grid") as HTMLElement;
      const marcarTodosLeitor = headerRow.querySelector('button[aria-label="Marcar todos como leitor em Dashboard"]') as HTMLButtonElement;
      expect(marcarTodosLeitor).toBeTruthy();
      await act(async () => { marcarTodosLeitor.click(); });
      // Confere que TODAS as linhas de dados (Dados: Coleção…Leadtime) ficaram marcadas também.
      for (const rotulo of ["Dados: Coleção", "Dados: Estoque", "Dados: Produção", "Dados: Financeiro", "Dados: Custos", "Dados: Comercial"]) {
        const label = Array.from(bloco.querySelectorAll("label")).find((l) => (l.textContent ?? "").includes(rotulo));
        expect(label, `linha ${rotulo} deveria existir`).toBeTruthy();
        const checkbox = label!.closest("div.grid")!.querySelector('button[role="checkbox"]') as HTMLButtonElement;
        expect(checkbox.getAttribute("aria-checked"), `${rotulo} deveria estar marcada por 'marcar todos'`).toBe("true");
      }
    } finally {
      view.unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) PapelEditor — mesma organização do editor de papel.
// ─────────────────────────────────────────────────────────────────────────────
describe("PapelEditor — Dashboard organizado (F5c)", () => {
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
        createElement(PapelEditor, { papel: { id: "papel1", nome: "Existente", descricao: null, tenant_id: "t1" }, onClose: () => {} }),
      ),
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return { ...view, salvarSpy };
  }

  it("a grade do papel também mostra 'Dados por aba' + InfoHover", async () => {
    const view = await montarPapelEditor();
    try {
      expect(document.body.textContent).toContain("Dados por aba");
      expect(document.body.querySelector('button[aria-label="O que são as permissões de Dados por aba"]')).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  it("Salvar do papel manda o payload EXATO das chaves de dados marcadas, sem renomear", async () => {
    const view = await montarPapelEditor({
      existing: [{ pagina: "dashboard_leadtime", pode_ver: true, pode_editar: false }],
    });
    try {
      const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Salvar") as HTMLButtonElement;
      await act(async () => { botaoSalvar().click(); await new Promise((r) => setTimeout(r, 10)); });
      const payload = view.salvarSpy.mock.calls[0][0].data.perms as { pagina: string }[];
      expect(payload.some((p) => p.pagina === "dashboard_leadtime")).toBe(true);
    } finally {
      view.unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) Financeiro por aba — nova `financeiro_servicos`, aba padrão = 1ª permitida, `?tab=`
//    só respeitado se permitido, admin vê as 4.
// ─────────────────────────────────────────────────────────────────────────────
describe("Financeiro por aba (F5c, P-112 A)", () => {
  async function montarFinanceiro(opts: {
    canView: (k: string) => boolean;
    isAdmin?: boolean;
    tab?: string;
    status?: string;
  }) {
    vi.resetModules();
    const { FAKE } = await import("./_fix_hidratacao/fake-supabase");
    FAKE.reset();
    FAKE.linhas.parcelas = [];
    FAKE.linhas.tenant_config = [{ tenant_id: "t1", timezone: "America/Sao_Paulo", modules: { financeiro: true } }];
    FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
    vi.doMock("@/integrations/supabase/client", async () => ({ supabase: (await import("./_fix_hidratacao/fake-supabase")).FAKE.supabase }));
    vi.doMock("@/hooks/useAuth", () => ({
      useAuth: () => ({
        user: { id: "u1", email: "qa@teste" }, session: null,
        isAdmin: !!opts.isAdmin, isSuperAdmin: false, isTenantAdmin: !!opts.isAdmin, permissions: [],
        canView: opts.canView, canEdit: () => false, loading: false, signOut: async () => {},
      }),
    }));
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    vi.doMock("@/hooks/useTenantModules", () => {
      const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, produto_importado: false, etapas_pl: false };
      return { useTenantModules: () => ({ modules, isModuleEnabled: (k: string) => !!(modules as any)[k], isStockOnly: false, firstActiveModulePath: "/", isLoading: false }) };
    });
    vi.doMock("@tanstack/react-router", () => ({
      createFileRoute: () => (routeOpts: any) => ({
        options: routeOpts,
        useSearch: () => ({ tab: opts.tab, status: opts.status }),
      }),
      useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }),
      useNavigate: () => vi.fn(),
      Link: (p: any) => require("react").createElement("a", { href: String(p.to ?? "") }, p.children),
    }));
    const { createElement } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const mod = await import("@/routes/_authenticated/financeiro");
    const C = (mod.Route as any).options.component;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(createElement(QueryClientProvider, { client: qc }, createElement(C)));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return view;
  }

  const abaAtiva = () => document.body.querySelector('[role="tab"][data-state="active"]')?.textContent?.trim();
  const abasVisiveis = () => Array.from(document.body.querySelectorAll('.hidden.md\\:inline-flex [role="tab"]')).map((b) => (b.textContent ?? "").trim());

  it("usuário com só financeiro_resumo: só a aba Resumo aparece e é a ativa", async () => {
    const view = await montarFinanceiro({ canView: (k) => k === "financeiro_resumo" });
    try {
      expect(abasVisiveis()).toEqual(["Resumo"]);
      expect(abaAtiva()).toBe("Resumo");
    } finally {
      view.unmount();
    }
  });

  it("usuário com só financeiro_servicos: só a aba Serviços aparece e é a ativa", async () => {
    const view = await montarFinanceiro({ canView: (k) => k === "financeiro_servicos" });
    try {
      expect(abasVisiveis()).toEqual(["Serviços"]);
      expect(abaAtiva()).toBe("Serviços");
    } finally {
      view.unmount();
    }
  });

  it("?tab=lista SEM financeiro_parcelas cai para a 1ª aba permitida (fallback)", async () => {
    const view = await montarFinanceiro({ canView: (k) => k === "financeiro_calendario" || k === "financeiro_resumo", tab: "lista" });
    try {
      expect(abasVisiveis()).toEqual(["Calendário", "Resumo"]);
      // fallback = 1ª PERMITIDA na ordem fixa (Calendário, OCs, Serviços, Resumo) → Calendário.
      expect(abaAtiva()).toBe("Calendário");
    } finally {
      view.unmount();
    }
  });

  it("?tab=lista COM financeiro_parcelas é respeitado (não cai no fallback)", async () => {
    const view = await montarFinanceiro({ canView: (k) => k === "financeiro_calendario" || k === "financeiro_parcelas", tab: "lista" });
    try {
      expect(abaAtiva()).toBe("OCs");
    } finally {
      view.unmount();
    }
  });

  it("admin vê as 4 abas (Calendário, OCs, Serviços, Resumo)", async () => {
    const view = await montarFinanceiro({ canView: () => true, isAdmin: true });
    try {
      expect(abasVisiveis()).toEqual(["Calendário", "OCs", "Serviços", "Resumo"]);
    } finally {
      view.unmount();
    }
  });
});
