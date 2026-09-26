// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — rodada 4, achado N5 da re-revisão da rodada 3,
// review-fix3.md). `useActiveTenantId` (src/hooks/useActiveTenantId.ts) ENGOLE o próprio erro e
// devolve `""` sem retry (`data?.tenant_id ?? ""`, sem throw) — uma falha de rede única no
// `select users.tenant_id` grava `""` como "sucesso" no cache até o próximo refetch. No CQ Pré,
// o atalho `!tenantId ||` em `fonteSettled` e `tamanhosSettled` tratava esse tenant vazio como
// "settled" (retrocompat com o caso legítimo de usuário sem tenant) — mas com um CQ CONFIRMADO
// sem bloco-fonte e `modelo_grades` vazio, isso deixava a tela hidratar com `tamanhos` caindo em
// DEFAULT_TAMANHOS (a config real da loja nunca foi lida) e o Salvar mandava `_reais` ZERADO,
// que `_salvar_cq_core` grava direto em `cad_grades.grades_reais` (perda de dado provada).
//
// Fix desta rodada: os dois gates exigem `!!tenantId` (loja não resolvida = NÃO hidratado) — com
// tenant vazio, aparece o banner padrão + "Tentar de novo" (que também refaz a query do tenant) e
// Salvar/Confirmar ficam travados, em vez do escape silencioso.
//
// NÃO mexemos em `useActiveTenantId` (32 consumidores, fora de escopo — ver fix4-brief.md). Este
// arquivo mocka o hook fixo em `""` (o estado "loja nunca resolveu" que o hook de fato produz
// tanto em erro quanto durante o loading) para provar só o lado do CQ Pré.
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
// N5: tenantId nunca resolve — o cenário exato que `useActiveTenantId` produz quando engole o erro.
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "" }));
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
import { Route } from "@/routes/_authenticated/expedicao.cq.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  // N5: cenário exato da re-revisão — CQ já CONFIRMADO, sem bloco-fonte, `modelo_grades` VAZIO
  // (os tamanhos só existiriam via `tenant_config.tamanhos_grade`, que o escape `!tenantId ||`
  // pula por completo).
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C", subcolecao: "", semana: 1, origem: "interno" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1" }];
  FAKE.linhas.cad_tecidos = [{ cad_id: "c1", tipo: "tecido", numero: 1,
    cad_tecido_variantes: [{ ordem: 1, variante_tecido_id: "vt1", variantes_tecido: { nome_variante: "Azul", cor: { nome: "Azul" }, apelido: null } }] }];
  FAKE.linhas.modelo_grades = [];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["P", "M"] }];
  FAKE.linhas.producao_terceirizados = [];
  FAKE.linhas.categorias_terceirizado = [];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "pendente", rev: 1 }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grade_total_real: 20 }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
const txt = () => document.body.textContent ?? "";

describe("[fix hidratação rodada 4] N5 — CQ Pré não salva sem a loja identificada (tenantId vazio)", () => {
  it("tenantId '' + CQ confirmado sem fonte + modelo_grades vazio ⇒ banner + Salvar/Confirmar travados (NÃO hidrata sem a loja)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(200);

    // Antes do fix: hidratava direto (escape `!tenantId ||`), Editar aparecia, Salvar habilitado.
    // Depois do fix: banner padrão + Salvar/Confirmar travados (`!hydrated`); o botão "Editar" do
    // modo confirmado nem aparece (só existe quando `confirmado=true`, setado dentro do seed —
    // que nunca roda sem a loja resolvida, prova indireta de que a tela nunca hidratou de verdade).
    expect(txt()).toContain("Não foi possível carregar");
    expect(txt()).toContain("Tentar de novo");
    expect(salvar()?.disabled ?? true).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Controle de Qualidade"]')?.disabled ?? true).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Editar"]')).toBeNull();

    // Nunca chama o RPC de salvar com esse estado.
    await esperar(200);
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_cq")).toBe(false);
  });

  it("'Tentar de novo' também refaz a query do tenant (active-tenant-id) além das demais", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(150);
    expect(txt()).toContain("Tentar de novo");

    const tentarDeNovo = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Tentar de novo"))!;
    await clicar(tentarDeNovo);
    await esperar(80);

    // A key do useActiveTenantId é ["active-tenant-id", user?.id] (src/hooks/useActiveTenantId.ts).
    // Como o tenantId nunca resolve neste teste (mock fixo em ""), o "Tentar de novo" precisa ao
    // menos ter tentado invalidar/refazer essa key (não só as queries já gated por !!tenantId,
    // que ficam desabilitadas para sempre enquanto o tenant não resolver).
    const chamouKeyTenant = invalidateSpy.mock.calls.some((args) => {
      const key = (args[0] as any)?.queryKey;
      return Array.isArray(key) && key[0] === "active-tenant-id";
    });
    expect(chamouKeyTenant).toBe(true);
  });
});

// Achado do CONTROLADOR sobre o fix de N5 acima: `tenantIdErrored = !tenantId` sozinho também é
// verdadeiro DURANTE uma carga normal — `useActiveTenantId` devolve `""` enquanto sua query ainda
// está em voo (data/user ainda não resolveram), o que é o estado comum logo após abrir a tela, não
// um erro. Sem distinguir os dois, o banner vermelho piscava em TODA abertura do CQ Pré.
//
// Correção: `tenantIdLoading` (no componente) usa `useIsFetching({queryKey:["active-tenant-id",
// user?.id]})` para saber se a query do tenant está REALMENTE em voo agora — sem tocar no hook
// (fora de escopo) e sem duplicar seu queryFn. Só quando `!tenantIdLoading` (nada em voo) E
// `tenantId` continua vazio é que conta como erro (`tenantIdErrored`).
//
// Este teste simula o estado "em voo" de verdade: dispara um `qc.fetchQuery` que NUNCA resolve na
// MESMA queryKey que `useActiveTenantId` usaria (`["active-tenant-id", "u1"]`) — o `useIsFetching`
// do componente enxerga esse fetch pendente (é a mesma key, TanStack Query não distingue "quem"
// disparou), reproduzindo fielmente "a query do tenant ainda não assentou" mesmo com o hook
// mockado retornando `""` (o mock não cria essa entrada sozinho).
describe("[fix hidratação rodada 4] N5 — controlador: tenant AINDA CARREGANDO não é erro", () => {
  it("query de active-tenant-id em voo (pending) ⇒ 'Carregando…', SEM banner, Salvar travado", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Fetch que nunca resolve — simula a janela normal entre "tela montou" e "o tenant resolveu".
    qc.fetchQuery({ queryKey: ["active-tenant-id", "u1"], queryFn: () => new Promise(() => {}) }).catch(() => {});
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(200);

    // "Carregando…" (a mensagem SEM erro de `!hydrated`), NUNCA o banner vermelho.
    expect(txt()).toContain("Carregando");
    expect(txt()).not.toContain("Não foi possível carregar");
    expect(txt()).not.toContain("Tentar de novo");
    expect(salvar()?.disabled ?? true).toBe(true);

    await esperar(200);
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_cq")).toBe(false);
  });
});
