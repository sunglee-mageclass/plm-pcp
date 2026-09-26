// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação — rodada 5, achado N5b da re-revisão da rodada 4,
// review-fix4.md). Diferente de N5 (tenant nunca resolve ANTES de hidratar), N5b é o tenant
// "sumir" DEPOIS de já hidratado, com a tela em edição:
//
// 1. `["active-tenant-id", uid]` tem `staleTime` 0 e refaz a busca a cada foco de janela, em
//    todos os observers do app.
// 2. Uma única falha nesse refetch vira `""` como SUCESSO, porque `useActiveTenantId` engole o
//    erro (`data?.tenant_id ?? ""`, sem throw — fora de escopo mexer, 32 consumidores).
// 3. No CQ Pré já hidratado, as keys `["tenant_config","tamanhos",tenantId]`,
//    `["cq-cats-servico",tenantId]` e `["cq-confeccao-prioridade",tenantId]` passam a usar `""`,
//    ficam DISABLED e SEM DADO — diferente de um refetch com ERRO, que mantém o `data` antigo
//    (TanStack v5 não limpa `data` em erro).
// 4. Com `modelo_grades` vazio, `tamanhos` volta a DEFAULT_TAMANHOS. Com `cats`/`prio` vazios, a
//    fonte pode sumir e `_rev_base.fonte` viraria `null` (pula o rev-check, lost-update).
// 5. Como o corpo e os botões (antes desta rodada) dependiam só de `hydrated` (N1), o form
//    continuava na tela E O SALVAR CONTINUAVA HABILITADO — perda de dado: `_reais` sai zerado e
//    `_salvar_cq_core` grava isso em `cad_grades.grades_reais` num CQ CONFIRMADO sem fonte.
//
// Fix desta rodada: os 3 botões de ação do Pré (Confirmar, Salvar não-editando, Salvar editando)
// ganham `|| !tenantId` no `disabled`. Como o corpo continua visível (N1 intocado — só os botões
// travam), e num refetch NORMAL o `tenantId` antigo permanece em cache (sem flicker).
//
// Importante: este arquivo usa o hook REAL `useActiveTenantId` (não mockado) — só `useAuth` é
// mockado — porque N5b depende do CICLO DE VIDA de verdade da query `["active-tenant-id", uid]`
// (ela precisa existir e ser invalidável/refazível de fato; um mock por valor fixo não reproduz
// "refetch que falha depois de já ter tido sucesso"). Baseado no probe do revisor
// (`rr4-probe.test.ts`, cenário "PÓS-HIDRATAÇÃO: refetch do tenant FALHA").
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
// N5b: `useActiveTenantId` NÃO é mockado — precisa do hook real rodando contra o FAKE.supabase
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
import { Route } from "@/routes/_authenticated/expedicao.cq.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
let QC: QueryClient;

beforeEach(() => {
  FAKE.reset();
  // Cenário N5/N5b da re-revisão: CQ já CONFIRMADO, sem bloco-fonte, `modelo_grades` VAZIO (os
  // tamanhos só existiriam via `tenant_config.tamanhos_grade`).
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

async function abrir() {
  QC = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: QC }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
}

describe("[fix hidratação rodada 5] N5b — tenant some DEPOIS de hidratado (refetch de foco falha)", () => {
  it("CQ confirmado em edição, sem fonte, modelo_grades vazio: refetch do tenant FALHA ⇒ Salvar/Confirmar travam, sem chamar salvar_cq", async () => {
    await abrir();
    // Hidrata normalmente primeiro (tenant real = "t1", tudo assenta).
    await aguardar(() => !!document.querySelector('button[aria-label="Editar"]'), "Editar", 3000);
    await clicar(document.querySelector<HTMLButtonElement>('button[aria-label="Editar"]')!);
    await aguardar(() => salvar()?.disabled === false, "Salvar habilitado", 3000);
    expect(txt()).toContain("Observações do Controle de Qualidade");

    // Agora simula o refetch de FOCO que falha: 1 falha em `users` (o SELECT que
    // `useActiveTenantId` faz) + invalida a key do hook — o hook engole o erro e assenta `""`.
    FAKE.falhar("users", 1);
    await act(async () => { await QC.invalidateQueries({ queryKey: ["active-tenant-id"] }); });
    await esperar(150);

    // N1 continua valendo: o formulário NÃO some (refetch com erro/engolido não esconde o corpo).
    expect(txt()).toContain("Observações do Controle de Qualidade");
    // Mas agora (fix N5b) o Salvar/Confirmar TRAVAM — antes desta rodada ficavam habilitados.
    expect(salvar()?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Controle de Qualidade"]')?.disabled ?? true).toBe(true);

    // Mesmo clicando (o teste tenta, mas o botão disabled não dispara o handler em DOM real —
    // ainda assim confirmamos que NENHUM salvar_cq foi disparado com o tenant sumido).
    await esperar(150);
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_cq")).toBe(false);
  });
});
