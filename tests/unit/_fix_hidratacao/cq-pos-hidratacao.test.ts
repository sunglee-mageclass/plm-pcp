// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — CQ Pós (metade 1 + achado C1/I1 da rodada de
// correção). Auditoria de RPC conferida em `.superpowers/fix-hidratacao/review.md`:
// `_salvar_cq_pos_core` (supabase/migrations/20260720290000_cq_pos_datas_conserto.sql:57-66) trata
// o payload como "estado completo" — `DELETE FROM cq_pos_variantes WHERE
// controle_qualidade_id=...` incondicional antes de reinserir, sem rev-check nenhum. `CqPosView`
// já tinha `hydrated` interno, mas não o reportava ao pai (que renderiza os botões
// Salvar/Confirmar/Desmarcar do Pós). Prova: com a aba Pós aberta e `cq_pos_variantes`/
// `controle_qualidade` ainda em voo, os botões do Pós ficam desabilitados.
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
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/expedicao.cq.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C", subcolecao: "", semana: 1, origem: "interno" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1" }];
  FAKE.linhas.cad_tecidos = [{ cad_id: "c1", tipo: "tecido", numero: 1 }];
  FAKE.linhas.modelo_grades = [{ modelo_id: "m1", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"] }];
  FAKE.linhas.producao_terceirizados = [
    { id: "pt1", cad_id: "c1", categoria_terceirizado_id: "catpos", ativo: true, data_enviado: null, data_prevista: null, data_entregue: null },
  ];
  FAKE.linhas.categorias_terceirizado = [{ id: "catpos", tenant_id: "t1", nome: "Lavanderia", ativo: true, etapa: "pos_costura" }];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "pendente" }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grade_total_real: 20 }];
  FAKE.linhas.cq_pos_variantes = [];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] CQ Pós — Salvar/Confirmar/Desmarcar travam ANTES da hidratação (P-57 A)", () => {
  it("aba Pós aberta com controle_qualidade/cq_pos_variantes ainda em voo: botões do Pós ficam DESABILITADOS", async () => {
    const soltar = FAKE.segurar("cq_pos_variantes");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós na tela");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    const salvarPos = () => botaoPorTexto("Salvar");
    await aguardar(() => !!salvarPos(), "botão Salvar do Pós na tela");
    await esperar(50);
    expect(salvarPos()!.disabled).toBe(true); // ← fix: travado enquanto o Pós não hidratou

    soltar();
    await aguardar(() => salvarPos()?.disabled === false, "destrava após hidratar", 2000);
  });

  // Achado C1 da revisão (review.md): `hydrated` do CqPosView subia mesmo com a query de
  // SERVIÇOS (producao_terceirizados) ainda em voo — ela é a única que `buildItens()` percorre
  // pra montar o payload do Salvar. `cq_pos_variantes` já tinha 1 linha confirmada; segurando só
  // `producao_terceirizados` (não `cq_pos_variantes`), o teste original acima não detectava isso.
  it("C1: com `producao_terceirizados` (serviços) em voo e cq_pos_variantes já carregado, Salvar do Pós fica DESABILITADO e não manda _itens:[]", async () => {
    const soltar = FAKE.segurar("producao_terceirizados");
    FAKE.linhas.cq_pos_variantes = [
      { id: "pv1", controle_qualidade_id: "cq1", producao_terceirizado_id: "pt1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 },
    ];
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós na tela");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    const salvarPos = () => botaoPorTexto("Salvar");
    await aguardar(() => !!salvarPos(), "botão Salvar do Pós na tela");
    await esperar(50);
    expect(salvarPos()!.disabled).toBe(true); // ← C1: travado enquanto `servicos` não hidratou

    // Mesmo clicando (defesa em profundidade — o disabled já deveria impedir), nenhuma RPC
    // salvar_cq_pos deve ter sido chamada com o payload vazio enquanto travado.
    const chamouSalvarVazio = FAKE.chamadas.some((c) => c.tabela === "rpc:salvar_cq_pos");
    expect(chamouSalvarVazio).toBe(false);

    soltar();
    await aguardar(() => salvarPos()?.disabled === false, "destrava após hidratar", 2000);
  });

  // Achado I1 da revisão: `cqpos-cq`/`cqpos-itens`/`cqpos-servicos` engoliam o erro
  // (`CqPosView.tsx`). Uma falha ao carregar o CQ Pós virava "sem dado" e o Pós hidratava vazio.
  it("I1: controle_qualidade (cqpos-cq) falha ao carregar — Salvar do Pós continua DESABILITADO e aparece 'Tentar de novo'", async () => {
    FAKE.falhar("controle_qualidade", 4);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós na tela");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    await esperar(80);
    const salvarPos = () => botaoPorTexto("Salvar");
    // O botão pode nem existir ainda (a barra de ações do Pré é que renderiza "Salvar" via
    // posBtn.hydrated); em qualquer caso, nenhum Salvar do Pós pode ficar habilitado.
    expect(salvarPos()?.disabled ?? true).toBe(true);
    expect(document.body.textContent).toContain("Não foi possível carregar");
    expect(document.body.textContent).toContain("Tentar de novo");

    await esperar(200);
    expect(salvarPos()?.disabled ?? true).toBe(true);
  });

  // Achado N1 da re-revisão (regressão da rodada 1): o corpo era renderizado por
  // `!hasLoadError && hydrated` — uma vez hidratado, se um REFETCH posterior falhasse (foco de
  // janela, invalidate de outra tela), `hasLoadError` virava true e o corpo SUMIA (nem banner nem
  // "Carregando…" — os 3 ramos de render davam falso), mas os botões (que só olham `hydrated`)
  // continuavam habilitados. Prova: hidrata com sucesso (a "Grade real" e a "Observações do CQ
  // Pós" aparecem — parte do corpo FORA do card por-serviço), depois um refetch de
  // `producao_terceirizados` falha — o corpo continua visível, sem "Carregando…" nem sumir.
  it("N1: refetch falha DEPOIS de hidratado — o corpo do Pós CONTINUA visível (não vira banner/vazio)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await aguardar(() => !!botaoPorTexto("Pós (acabamento)"), "aba Pós na tela");
    await clicar(botaoPorTexto("Pós (acabamento)")!);
    await aguardar(() => document.body.textContent?.includes("Observações do CQ Pós") ?? false, "hidratou (corpo do Pós aparece)");
    expect(document.body.textContent).not.toContain("Carregando…");

    // Refetch de `producao_terceirizados` falha (ex.: eco de Realtime, foco de janela).
    FAKE.falhar("producao_terceirizados", 4);
    await qc.invalidateQueries({ queryKey: ["cqpos-servicos", "c1"] });
    await esperar(150);

    // O corpo continua na tela — NÃO sumiu, NÃO virou "Carregando…" nem banner de erro.
    expect(document.body.textContent).toContain("Observações do CQ Pós");
    expect(document.body.textContent).toContain("Grade real (do CQ Pré)");
    expect(document.body.textContent).not.toContain("Carregando…");
  });
});
