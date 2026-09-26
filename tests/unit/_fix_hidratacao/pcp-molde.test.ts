// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — revisão final, achado C2, review-final.md). Trazido
// do probe do revisor `p2-pcp-molde.test.ts`. O `queryFn` de `["terc-cad", modeloId]` engolia o
// erro (`const { data } = ...; return data;`) — uma falha única virava sucesso com `data=null`,
// sem retry. O efeito de "Observação de Partes do Molde" (`moldeHydrated`) só testava
// `cad === undefined`; com `null`, semeava `observacoesMolde=""` e nunca mais re-hidratava. O
// Salvar então mandava `_observacoes_molde: null`, e o servidor grava `NULLIF(...)` — apaga
// "Partes do Molde" (`cad.observacoes_molde`, campo compartilhado com CAD/Ficha de Corte/Oficina).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, produto_importado: false, etapas_pl: false };
  return { useTenantModules: () => ({ modules, isModuleEnabled: (k: string) => !!(modules as any)[k], isStockOnly: false, firstActiveModulePath: "/", isLoading: false }) };
});
vi.mock("@tanstack/react-router", async (orig) => {
  const m: any = await orig();
  const { createElement } = await import("react");
  return {
    ...m,
    createFileRoute: () => (opts: any) => ({ options: opts, useParams: () => ({ modeloId: "m1" }), useSearch: () => ({}) }),
    Link: (p: any) => createElement("a", { href: String(p.to ?? "") }, p.children),
    Navigate: () => null,
    useNavigate: () => () => {},
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/pcp.servicos.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", origem: "interno", tenant_id: "t1" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", observacoes_molde: "MOLDE REAL: frente, costas, manga", sem_acabamento: false }];
  FAKE.linhas.producao_terceirizados = [
    { id: "pt1", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 1, grade_detalhe: {} },
  ];
  FAKE.linhas.categorias_terceirizado = [{ id: "cat1", tenant_id: "t1", nome: "Estamparia", ativo: true, etapa: "pre" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação revisão final] C2 — PCP Serviços: 1ª leitura de cad (terc-cad) falha e é ENGOLIDA", () => {
  it("cad volta num refetch posterior — Salvar NÃO deve gravar observacoes_molde vazio por cima do molde real", async () => {
    // falha SÓ a 1ª leitura de cad com select("*") (a do terc-cad do PCP), não outras leituras de "cad"
    const origFrom = FAKE.supabase.from;
    let falhou = false;
    FAKE.supabase.from = (t: string) => {
      const b = origFrom(t);
      if (t !== "cad") return b;
      const origSelect = b.select;
      b.select = (cols?: string) => {
        if (cols === "*" && !falhou) {
          falhou = true;
          b.then = (ok: any, err: any) => Promise.resolve({ data: null, error: { message: "erro simulado", code: "FAKE" } }).then(ok, err);
        }
        return origSelect(cols);
      };
      return b;
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(100);
    // simula o refetch de foco de janela que resolve com sucesso desta vez
    await qc.invalidateQueries({ queryKey: ["terc-cad", "m1"] });
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    await aguardar(() => !!salvar() && salvar()!.disabled === false, "Salvar habilitado", 2000);
    // Fix C2: agora que cad hidratou com sucesso (não mais o null engolido), o campo mostra o
    // molde REAL — a textarea não fica vazia.
    const molde = document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='olde'], textarea");
    await clicar(salvar()!);
    await esperar(50);
    const call = FAKE.chamadas.find((c) => c.tabela === "rpc:salvar_terceirizados");
    expect((call?.payload as any)?._observacoes_molde).toBe("MOLDE REAL: frente, costas, manga");
  });

  it("cad falha e NUNCA se recupera — Salvar continua travado por !moldeHydrated (não grava null)", async () => {
    FAKE.falhar("cad", 10);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(150);
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    expect(salvar()?.disabled ?? true).toBe(true);
    await esperar(150);
    expect(FAKE.chamadas.some((c) => c.tabela === "rpc:salvar_terceirizados")).toBe(false);
  });
});
