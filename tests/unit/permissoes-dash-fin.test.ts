// @vitest-environment happy-dom
// F5c (P-112 A, 28/set) — RED scratch copy: Dashboard permissões organizadas (dados agrupados
// por aba, com InfoHover) + Financeiro por aba (nova `financeiro_servicos`, aba padrão =
// 1ª permitida, `?tab=` só respeitado se permitido). Roda a MESMA suíte que depois vai para
// tests/unit/permissoes-dash-fin.test.ts (cópia idêntica — RED aqui, GREEN lá).
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Repete até `cond()` ser verdade ou estourar o prazo (mesmo padrão de tests/unit/_fix_hidratacao/dom-helpers.ts). */
async function aguardar(cond: () => boolean, rotulo: string, prazoMs = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > prazoMs) throw new Error(`timeout esperando: ${rotulo}`);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

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

  // F5c review (I-1): `dashboard_leadtime` é a permissão da PRÓPRIA aba Leadtime (não uma chave
  // de dado) — a grade precisa mostrar as 5 linhas-aba (Desenvolvimento…Leadtime) COMO ABAS,
  // seguidas da sub-legenda "Dados por aba" com EXATAMENTE 6 linhas de dado (sem Leadtime nela).
  it("mostra as 5 linhas-aba (incl. Leadtime) seguidas da sub-legenda 'Dados por aba' com EXATAMENTE 6 linhas de dado, com InfoHover", async () => {
    const view = await montarPermissoesModal({ mode: "tenant" });
    try {
      const headerDashboard = Array.from(document.body.querySelectorAll("h3")).find((h) => h.textContent === "Dashboard");
      expect(headerDashboard, "cabeçalho do módulo Dashboard deveria existir").toBeTruthy();
      const bloco = headerDashboard!.nextElementSibling as HTMLElement;
      const texto = bloco.textContent ?? "";

      // As 5 ABAS aparecem com o rótulo LIMPO (sem prefixo "Dados:"), inclusive Leadtime.
      const ABAS = ["Desenvolvimento", "Produção & Qualidade", "Comercial & Coleção", "Custo & Financeiro", "Leadtime"];
      for (const aba of ABAS) expect(texto).toContain(aba);
      // "Leadtime" não pode aparecer como "Dados: Leadtime" — a chave de dado dele foi removida.
      expect(texto).not.toContain("Dados: Leadtime");

      // Sub-legenda + InfoHover.
      expect(texto).toContain("Dados por aba");
      const infoBtn = bloco.querySelector('button[aria-label="O que são as permissões de Dados por aba"]');
      expect(infoBtn, "botão do InfoHover deveria existir").toBeTruthy();

      // EXATAMENTE 6 linhas de dado, cada uma com o rótulo "Dados: X".
      const DADOS = ["Dados: Coleção", "Dados: Estoque", "Dados: Produção", "Dados: Financeiro", "Dados: Custos", "Dados: Comercial"];
      for (const rotulo of DADOS) expect(texto).toContain(rotulo);
      const linhasDeDado = Array.from(bloco.querySelectorAll("label")).filter((l) => (l.textContent ?? "").includes("Dados: "));
      expect(linhasDeDado.length, "deveriam existir exatamente 6 linhas 'Dados: X'").toBe(6);

      // Ordem no DOM: a sub-legenda vem DEPOIS da última aba (Leadtime), ANTES da 1ª linha de dado.
      const idxLeadtime = texto.indexOf("Leadtime"); // 1ª ocorrência = a linha-aba (Dados: Leadtime não existe mais)
      const idxSubLegenda = texto.indexOf("Dados por aba");
      const idxPrimeiroDado = texto.indexOf("Dados: Coleção");
      expect(idxLeadtime).toBeGreaterThan(-1);
      expect(idxSubLegenda).toBeGreaterThan(idxLeadtime);
      expect(idxPrimeiroDado).toBeGreaterThan(idxSubLegenda);
    } finally {
      view.unmount();
    }
  });

  it("a linha-aba Leadtime mostra o hint de que também libera os números de leadtime da aba Desenvolvimento", async () => {
    const view = await montarPermissoesModal({ mode: "tenant" });
    try {
      expect(document.body.textContent).toContain("também libera os números de leadtime da aba Desenvolvimento");
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

  // F5c review (I-1/M-4): título e contagem corrigidos — o módulo Dashboard tem 11 páginas no
  // catálogo (5 abas, incl. Leadtime, + 6 chaves de dado), NUNCA 12. "marcar todos" precisa
  // continuar cobrindo as 11, inclusive a linha-aba Leadtime (que NÃO é mais uma linha de dado).
  it("'marcar todos' do módulo Dashboard marca as 11 páginas (5 abas incl. Leadtime + 6 dados), inclusive as agrupadas", async () => {
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
      // Confere a linha-aba Leadtime (fora do grupo "Dados por aba" agora).
      const labelLeadtime = Array.from(bloco.querySelectorAll("label")).find((l) => (l.textContent ?? "").trim().startsWith("Leadtime"));
      expect(labelLeadtime, "linha-aba Leadtime deveria existir").toBeTruthy();
      const checkboxLeadtime = labelLeadtime!.closest("div.grid")!.querySelector('button[role="checkbox"]') as HTMLButtonElement;
      expect(checkboxLeadtime.getAttribute("aria-checked"), "Leadtime deveria estar marcada por 'marcar todos'").toBe("true");
      // Confere que TODAS as 6 linhas de dados ficaram marcadas também.
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
    canEdit?: (k: string) => boolean;
    isAdmin?: boolean;
    tab?: string;
    status?: string;
    // F5c (controller ruling): 1 linha de servicos_financeiro pra poder ver o sinal de
    // edição da aba Serviços (botão "Marcar pago" + DateField de vencimento habilitado/
    // desabilitado) — o fake supabase.rpc genérico devolve null pra qualquer nome, então
    // sobrepomos SÓ "servicos_financeiro" aqui, sem tocar no fake compartilhado.
    servicosRows?: any[];
  }) {
    vi.resetModules();
    const { FAKE } = await import("./_fix_hidratacao/fake-supabase");
    FAKE.reset();
    FAKE.linhas.parcelas = [];
    FAKE.linhas.tenant_config = [{ tenant_id: "t1", timezone: "America/Sao_Paulo", modules: { financeiro: true } }];
    FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
    vi.doMock("@/integrations/supabase/client", async () => {
      const { FAKE: F } = await import("./_fix_hidratacao/fake-supabase");
      const supabase = {
        ...F.supabase,
        rpc: (nome: string, args?: unknown) =>
          nome === "servicos_financeiro"
            ? Promise.resolve({ data: opts.servicosRows ?? [], error: null })
            : F.supabase.rpc(nome, args),
      };
      return { supabase };
    });
    vi.doMock("@/hooks/useAuth", () => ({
      useAuth: () => ({
        user: { id: "u1", email: "qa@teste" }, session: null,
        isAdmin: !!opts.isAdmin, isSuperAdmin: false, isTenantAdmin: !!opts.isAdmin, permissions: [],
        canView: opts.canView, canEdit: opts.canEdit ?? (() => false), loading: false, signOut: async () => {},
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
    const { createElement, useState: useStateReact } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const mod = await import("@/routes/_authenticated/financeiro");
    const C = (mod.Route as any).options.component;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Wrapper com estado PRÓPRIO — permite forçar um re-render de <C/> (sem remontar: mesma
    // posição/tipo na árvore, React só re-executa o corpo da função) chamando `bumpRef.current()`
    // depois do mount, pra simular um recheck de permissão (foco, RPC minhas_permissoes_efetivas)
    // sem esperar o React Query "adivinhar" que precisa re-renderizar por conta própria.
    const bumpRef: { current: () => void } = { current: () => {} };
    function Wrapper() {
      const [, setTick] = useStateReact(0);
      bumpRef.current = () => setTick((n: number) => n + 1);
      return createElement(C);
    }
    const view = await montar(createElement(QueryClientProvider, { client: qc }, createElement(Wrapper)));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    return { ...view, qc, bump: () => bumpRef.current() };
  }

  /** Força um re-render da árvore SEM remontar — usado pra observar `abaAtiva`/`abasPermitidas`
   * recalcularem contra um `canView` cujo COMPORTAMENTO (não a referência) mudou depois do mount,
   * simulando um recheck de permissão (foco da janela, refetch de `minhas_permissoes_efetivas`). */
  async function forcarRerender(bump: () => void) {
    await act(async () => { bump(); await new Promise((r) => setTimeout(r, 10)); });
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

  // F5c review (I-2), item 1: sem financeiro_servicos, o Calendário NÃO oferece o salto pra
  // Serviços — clicar num item de serviço não deve setar `tab="servicos"` (que ficaria em
  // branco, sem TabsTrigger/TabsContent correspondente). A aba ativa continua Calendário.
  it("I-2: sem financeiro_servicos, clicar um item de serviço no Calendário NÃO pula pra aba Serviços (fica em Calendário)", async () => {
    const SERVICO_CAL = {
      parcela_id: "svcal1", servico: "Bordado", numero_parcela: 1, numero_parcelas: 1,
      valor_parcela: 50, data_vencimento: "2026-10-05", data_pagamento: null, status: "a_pagar",
      empresa_nome: "Fornecedor Y", representante_nome: null, responsavel: null,
    };
    const view = await montarFinanceiro({
      canView: (k) => k === "financeiro_calendario", // SEM financeiro_servicos
      servicosRows: [SERVICO_CAL],
    });
    try {
      expect(abasVisiveis()).toEqual(["Calendário"]); // Serviços nem aparece na TabsList
      // Acha a linha do serviço na agenda mobile (renderiza sempre no DOM, escondida só por CSS
      // no happy-dom) e clica — antes do fix isso chamava onServico() e setava tab="servicos".
      await aguardar(() => (document.body.textContent ?? "").includes("Bordado"), "item de serviço no calendário");
      const linhaServico = Array.from(document.body.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("Bordado"));
      expect(linhaServico, "linha do serviço deveria existir no DOM (agenda mobile)").toBeTruthy();
      await act(async () => { linhaServico!.click(); });
      // Continua em Calendário — nunca "servicos" (que não tem TabsTrigger/TabsContent aqui).
      expect(abaAtiva()).toBe("Calendário");
      expect(document.body.querySelector('[role="tab"][value="servicos"]')).toBeNull();
    } finally {
      view.unmount();
    }
  });

  // F5c review (I-2), item 2: a aba ATIVA é derivada em TODO render (como dashboard.tsx:70) — se
  // a permissão da aba corrente for revogada enquanto a página está montada (recheck do useAuth),
  // cai pra 1ª permitida em vez de deixar o Radix com um value sem Trigger/Content (tela em branco).
  it("I-2: revogar a permissão da aba ativa em tempo real recalcula abaAtiva para a 1ª permitida (sem tela em branco)", async () => {
    const permitidas = { atual: ["financeiro_calendario", "financeiro_parcelas"] as string[] };
    const view = await montarFinanceiro({
      canView: (k) => permitidas.atual.includes(k),
      tab: "lista", // abre em OCs (financeiro_parcelas)
    });
    try {
      expect(abaAtiva()).toBe("OCs");
      // Revoga financeiro_parcelas (só sobra financeiro_calendario) e força um re-render —
      // simula um recheck de permissão (foco da janela, RPC minhas_permissoes_efetivas) sem
      // remontar a página (o `tab` em estado ainda guarda "lista").
      permitidas.atual = ["financeiro_calendario"];
      await forcarRerender((view as any).bump);
      await aguardar(() => abasVisiveis().length === 1, "abasVisiveis recalculada após revogar financeiro_parcelas", 3000);
      // abaAtiva precisa ter caído pra Calendário (única permitida) — NUNCA "OCs" (não existe
      // mais na TabsList) nem um valor sem Trigger/Content correspondente.
      expect(abasVisiveis()).toEqual(["Calendário"]);
      expect(abaAtiva()).toBe("Calendário");
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

  // Controller ruling (28/set): a aba Serviços obedece à SUA PRÓPRIA permissão de edição
  // (financeiro_servicos), independente de Calendário/OCs — FinanceiroEditContext.Provider
  // aninhado em torno do TabsContent de "servicos" sobrescreve o valor do provider externo.
  // Sinal de edição: o botão "Marcar pago" (só aparece com podeEditar) e o DateField de
  // Vencimento (VencimentoCell, disabled={!podeEditar || status==='pago'}).
  const SERVICO_ROW = {
    parcela_id: "sv1", servico: "Costura", ref: "REF1", numero_parcela: 1, numero_parcelas: 1,
    valor_parcela: 100, data_vencimento: "2026-10-01", data_pagamento: null, status: "a_pagar",
    empresa_nome: "Fornecedor X", representante_nome: null, responsavel: null, comprovante_url: null,
  };
  const marcarPagoBtn = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Marcar pago") as HTMLButtonElement | undefined;
  const vencimentoInput = () => document.body.querySelector('input[inputmode="numeric"]') as HTMLInputElement | null;

  it("usuário com financeiro_parcelas editar E financeiro_servicos editar: Serviços fica editável ('Marcar pago' aparece)", async () => {
    const view = await montarFinanceiro({
      canView: (k) => k === "financeiro_calendario" || k === "financeiro_servicos",
      canEdit: (k) => k === "financeiro_parcelas" || k === "financeiro_servicos",
      tab: "servicos",
      servicosRows: [SERVICO_ROW],
    });
    try {
      await aguardar(() => !!marcarPagoBtn(), "linha de serviço com Marcar pago");
      expect(marcarPagoBtn()).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  it("usuário com financeiro_parcelas editar mas financeiro_servicos SÓ VER: Serviços fica somente-leitura ('Marcar pago' não aparece)", async () => {
    const view = await montarFinanceiro({
      canView: (k) => k === "financeiro_calendario" || k === "financeiro_parcelas" || k === "financeiro_servicos",
      canEdit: (k) => k === "financeiro_parcelas" || k === "financeiro_calendario", // servicos NÃO está aqui — só ver
      tab: "servicos",
      servicosRows: [SERVICO_ROW],
    });
    try {
      await aguardar(() => document.body.textContent?.includes("Costura") ?? false, "linha de serviço renderizada");
      expect(marcarPagoBtn()).toBeUndefined();
      // O DateField de vencimento também some/desabilita sem podeEditar — reforça o sinal.
      const venc = vencimentoInput();
      if (venc) expect(venc.disabled).toBe(true);
    } finally {
      view.unmount();
    }
  });
});
