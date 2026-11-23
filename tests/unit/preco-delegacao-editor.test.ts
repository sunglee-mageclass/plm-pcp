// @vitest-environment happy-dom
// Preço de venda/atacado: admin NÃO fura (useAuth) e DELEGAÇÃO CONDICIONAL no editor de permissões ("não dá o que não tem").
//  - useAuth REAL: tenant_admin sem a chave NÃO vê/edita preço; com a chave (Editor) vê/edita; só Leitor vê; super admin sempre; o resto segue furando.
//  - precoTravadoNoEditor: célula de preço travada p/ quem não tem a permissão (ver→canView, editar→canEdit); outras chaves nunca travam.
//  - PermissoesModal/PapelEditor: a célula de preço usa o helper (UX); a trava real é do banco (testes de integração).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  precoTravadoNoEditor, ehChavePreco, mensagemPrecoSemDelegacao, TEXTO_PRECO_SEM_DELEGACAO,
  CHAVE_EDITAR_PRECO_VAREJO as PV, CHAVE_EDITAR_PRECO_ATACADO as PA,
} from "@/lib/preco-permissao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const ler = (p: string) => readFileSync(p, "utf8");

async function montar(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(el); });
  return { container, root, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

async function montarSonda(opts: { roles: string[]; permissoes: { pagina: string; pode_ver: boolean; pode_editar: boolean }[] }) {
  vi.resetModules();
  const authStateCb: { current: ((event: string, session: unknown) => void) | null } = { current: null };
  vi.doMock("@/integrations/supabase/client", () => ({
    supabase: {
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => { authStateCb.current = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
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
  function Sonda() { const a = useAuth(); ref.current = { canView: a.canView, canEdit: a.canEdit, loading: a.loading }; return null; }
  const view = await montar(createElement(AuthProvider, null, createElement(Sonda)));
  await act(async () => {
    authStateCb.current?.("SIGNED_IN", { user: { id: "u1" } });
    await new Promise((r) => setTimeout(r, 10));
    view.root.render(createElement(AuthProvider, null, createElement(Sonda)));
  });
  for (let i = 0; i < 20 && ref.current?.loading; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return { ref, unmount: view.unmount };
}

describe("useAuth — preço de venda/atacado sem bypass de admin", () => {
  it("tenant_admin SEM a chave: não vê nem edita preço; segue furando as outras páginas", async () => {
    const { ref, unmount } = await montarSonda({ roles: ["tenant_admin"], permissoes: [] });
    for (const k of [PV, PA]) { expect(ref.current?.canView(k)).toBe(false); expect(ref.current?.canEdit(k)).toBe(false); }
    expect(ref.current?.canView("criacao_planejamento")).toBe(true);
    unmount();
  });
  it("tenant_admin COM Editor vê/edita; só Leitor vê e não edita; a chave de um preço não libera o outro", async () => {
    const a = await montarSonda({ roles: ["tenant_admin"], permissoes: [{ pagina: PV, pode_ver: true, pode_editar: true }, { pagina: PA, pode_ver: true, pode_editar: false }] });
    expect(a.ref.current?.canEdit(PV)).toBe(true);
    expect(a.ref.current?.canView(PA)).toBe(true);
    expect(a.ref.current?.canEdit(PA)).toBe(false);
    a.unmount();
    const b = await montarSonda({ roles: ["tenant_admin"], permissoes: [{ pagina: PV, pode_ver: true, pode_editar: true }] });
    expect(b.ref.current?.canView(PA)).toBe(false);
    b.unmount();
  });
  it("super admin vê/edita direto, sem linha", async () => {
    const { ref, unmount } = await montarSonda({ roles: ["super_admin"], permissoes: [] });
    expect(ref.current?.canView(PV)).toBe(true);
    expect(ref.current?.canEdit(PA)).toBe(true);
    unmount();
  });
});

describe("editor de permissões — delegação condicional do preço", () => {
  const tem = (...ks: string[]) => (k: string) => ks.includes(k);
  it("precoTravadoNoEditor: trava a célula que quem edita NÃO tem; super (tudo true) nunca trava; chave que não é de preço nunca trava", () => {
    expect(precoTravadoNoEditor(PV, "pode_ver", tem(), tem())).toBe(true);
    expect(precoTravadoNoEditor(PV, "pode_editar", tem(), tem())).toBe(true);
    expect(precoTravadoNoEditor(PV, "pode_ver", tem(PV), tem())).toBe(false);   // Leitor: concede ver
    expect(precoTravadoNoEditor(PV, "pode_editar", tem(PV), tem())).toBe(true); // ...mas não editar
    expect(precoTravadoNoEditor(PV, "pode_editar", tem(PV), tem(PV))).toBe(false);
    expect(precoTravadoNoEditor(PA, "pode_ver", tem(PV), tem(PV))).toBe(true);  // a chave de um não libera o outro
    expect(precoTravadoNoEditor(PA, "pode_editar", () => true, () => true)).toBe(false); // super
    expect(precoTravadoNoEditor("criacao_planejamento", "pode_editar", tem(), tem())).toBe(false);
    expect(ehChavePreco(PV) && ehChavePreco(PA) && !ehChavePreco("criacao_planejamento:custos")).toBe(true);
  });
  it("PermissoesModal e PapelEditor usam o helper nas células de seção; 'voltar ao papel' preserva a chave travada", () => {
    const s = ler("src/components/admin/PermissoesModal.tsx");
    expect(s.match(/precoTrava\(s\.key, "pode_ver"\)/g)?.length).toBeGreaterThanOrEqual(2 * 1); // usuário + papel (ver)
    expect(s.match(/precoTrava\(s\.key, "pode_editar"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/voltarAoPapelEstado\(s, papelBase, pageKeys, \(k\) => desligada\(k\) \|\| precoTravaAlguma\(k\)\)/);
  });
  async function montarEditor(canTudo: boolean | string[]) {
    vi.resetModules();
    const tem = (k: string) => (Array.isArray(canTudo) ? canTudo.includes(k) : canTudo);
    vi.doMock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }) }));
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: tem, canEdit: tem }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) },
    }));
    const chain: any = { middleware: () => chain, validator: () => chain, handler: (fn: unknown) => ({ __handler: fn }) };
    vi.doMock("@tanstack/react-start", () => ({ createServerFn: () => chain, createMiddleware: () => ({ server: (fn: unknown) => ({ __middleware: fn }) }), useServerFn: () => vi.fn(async () => undefined) }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PermissoesModal } = await import("@/components/admin/PermissoesModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await montar(createElement(QueryClientProvider, { client: qc },
      createElement(PermissoesModal, { user: { id: "u1", nome: "Fulano", tenant_id: "t1", role: "user", papel_id: null }, mode: "tenant", onClose: () => {} })));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    return view;
  }
  const cel = (id: string) => document.getElementById(id) as HTMLButtonElement | null;

  it("render: admin da loja SEM preço vê as células de preço DESABILITADAS (e a outra seção habilitada); COM preço habilitadas", async () => {
    const sem = await montarEditor(false);
    expect(cel(`${PV}-ver`)).not.toBeNull();
    expect(cel(`${PV}-ver`)!.disabled).toBe(true);
    expect(cel(`${PA}-ver`)!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Você não tem esta permissão de preço");
    sem.unmount();
    const com = await montarEditor([PV, PA]);
    expect(cel(`${PV}-ver`)!.disabled).toBe(false);
    expect(cel(`${PA}-ver`)!.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Você não tem esta permissão de preço");
    com.unmount();
  });

  it("a recusa preco_sem_delegacao do banco vira texto PT nas 2 server functions", () => {
    expect(mensagemPrecoSemDelegacao("preco_sem_delegacao: criacao_planejamento:preco_venda")).toBe(TEXTO_PRECO_SEM_DELEGACAO);
    expect(mensagemPrecoSemDelegacao("outra coisa")).toBeNull();
    expect(ler("src/lib/tenant-admin.functions.ts")).toMatch(/mensagemPrecoSemDelegacao\(error\.message\)/);
    expect(ler("src/lib/papeis.functions.ts")).toMatch(/mensagemPrecoSemDelegacao\(error\.message\)/);
  });
});
