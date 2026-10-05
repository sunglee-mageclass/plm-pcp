// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — rodada 6, achado N5c da re-revisão da rodada 5,
// review-fix5.md). Mesma classe do N5b do CQ Pré, mas no Direcionamento — e aqui o efeito é o
// caso GRAVE original da investigação P-57: `_rows: []` com um `_rev_base` VÁLIDO faz o
// `_salvar_direcionamento_core` (estado COMPLETO) apagar TODAS as linhas de `direcionamento_lojas`
// do CAD.
//
// Mecânica:
// 1. `["active-tenant-id", uid]` tem `staleTime` 0 e refaz a busca a cada foco de janela; uma
//    falha nesse refetch vira `""` como SUCESSO (o hook engole o erro, sem throw — fora de
//    escopo mexer, 32 consumidores).
// 2. No Direcionamento JÁ HIDRATADO, `["dir-lojas", tenantId]` (`enabled: !!tenantId`) troca para
//    a key `""`, fica `disabled` e SEM DADO — `lojasVisiveis` esvazia.
// 3. `buildRows()` só itera `lojasVisiveis`, então o payload vira `_rows: []`.
// 4. Como o corpo/botões só olhavam `hydrated` (que não regride — por design, um refetch com
//    erro não deve esconder o formulário), o Salvar ficava HABILITADO e mandava esse payload com
//    `_rev_base` válido — o servidor apaga TODAS as linhas de loja do CAD.
//
// Fix desta rodada: os 3 botões de ação (Salvar fora de edição, Confirmar, Salvar em edição)
// ganham `|| !tenantId` no `disabled`. O corpo continua visível (mesmo padrão do N5b); num
// refetch NORMAL o `tenantId` antigo permanece em cache, sem flicker.
//
// Importante: este arquivo usa o hook REAL `useActiveTenantId` (não mockado) — só `useAuth` é
// mockado — porque N5c depende do CICLO DE VIDA de verdade da query `["active-tenant-id", uid]`
// (precisa existir e ser invalidável/refazível de fato; um mock por valor fixo não reproduz
// "hidratou com sucesso, depois um refetch falha"). Baseado no probe do revisor
// (`rr5-dir.test.ts`).
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
// N5c: `useActiveTenantId` NÃO é mockado — precisa do hook real rodando contra o FAKE.supabase
// pra reproduzir "sucesso, depois refetch que falha" (o próprio ciclo de vida da query).
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
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/expedicao.direcionamento.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
let QC: QueryClient;

beforeEach(() => {
  FAKE.reset();
  // Fixture padrão do direcionamento-hidratacao.test.ts (mesma usada pelo probe do revisor).
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", origem: "interno" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", direcionamento_status: "pendente" }];
  FAKE.linhas.direcionamento_controle = [{ cad_id: "c1", rev: 3 }];
  FAKE.linhas.lojas_direcionamento = [{ id: "l1", tenant_id: "t1", nome: "E-commerce", ativo: true, ordem: 1 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grades_planejadas: { P: 10, M: 10 } }];
  FAKE.linhas.direcionamento_lojas = [{ id: "d1", cad_id: "c1", loja_id: "l1", variante_numero: 1, grades: { P: 10, M: 10 } }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
const confirmar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Direcionamento"]');
const txt = () => document.body.textContent ?? "";

async function abrir() {
  QC = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: QC }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
  return QC;
}

describe("[fix hidratação rodada 6] N5c — Direcionamento: tenant some DEPOIS de hidratado", () => {
  it("hidrata com 'E-commerce' na tela; tenant SOME (linha de users some, refetch com sucesso vazio) ⇒ Salvar/Confirmar travam, sem chamar salvar_direcionamento (não apaga as lojas)", async () => {
    await abrir();
    await aguardar(() => salvar()?.disabled === false, "hidratou", 3000);
    expect(txt()).toContain("E-commerce");

    // [backend F1] Falha de REDE no refetch NÃO tira mais a loja (o hook lança o erro e o RQ mantém o `tenantId` — ver
    // o último teste deste arquivo). A defesa `|| !tenantId` segue valendo para o `tenantId` realmente vazio: aqui a
    // linha do usuário some (refetch com SUCESSO sem linha => "").
    FAKE.linhas.users = [];
    await act(async () => { await QC.invalidateQueries({ queryKey: ["active-tenant-id"] }); });
    await esperar(150);

    // Sem banner (N1 não pega esse caso — não há isError, só ausência silenciosa de dado).
    expect(txt()).not.toContain("Não foi possível carregar");
    // Fix N5c: Salvar/Confirmar travam — antes desta rodada ficavam habilitados e mandavam
    // `_rows: []` com `_rev_base` válido, apagando todas as linhas de loja no servidor.
    expect(salvar()?.disabled).toBe(true);
    expect(confirmar()?.disabled ?? true).toBe(true);

    await esperar(150);
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_direcionamento")).toBe(false);
  });

  it("refetch NORMAL do tenant (sem falha) não pisca os botões — o tenantId antigo continua em cache", async () => {
    await abrir();
    await aguardar(() => salvar()?.disabled === false, "hidratou", 3000);

    // 12 amostras durante um refetch bem-sucedido (sem FAKE.falhar) — o botão nunca deve desabilitar.
    const amostras: boolean[] = [];
    await act(async () => { QC.invalidateQueries({ queryKey: ["active-tenant-id"] }); });
    for (let i = 0; i < 12; i++) {
      await esperar(15);
      amostras.push(salvar()?.disabled ?? true);
    }
    expect(amostras.every((disabled) => disabled === false)).toBe(true);
  });
});

describe("[backend F1] refetch de foco do tenant FALHA (rede) — a loja anterior continua valendo", () => {
  it("hidratado: o refetch do tenant falha ⇒ tenantId mantido, lojas na tela e Salvar habilitado, nada travou", async () => {
    await abrir();
    await aguardar(() => salvar()?.disabled === false, "hidratou", 3000);

    FAKE.falhar("users", 1);
    await act(async () => { await QC.invalidateQueries({ queryKey: ["active-tenant-id"] }); });
    await esperar(150);

    expect(txt()).toContain("E-commerce");
    expect(txt()).not.toContain("Não foi possível carregar a sua loja");
    expect(salvar()?.disabled).toBe(false);
  });
});
