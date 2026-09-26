// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — CQ Pré + CQ Pós (metade 1, §4.3 da investigação).
// Auditoria de RPC conferida em `.superpowers/fix-hidratacao/review.md` (tabela "Auditoria das
// RPCs" + achado I1): `_salvar_cq_core` (supabase/migrations/20260807120000_salvar_cq_rev_base.sql
// :136-183) faz UPDATE do cabeçalho + `DELETE FROM cq_variantes WHERE controle_qualidade_id=...`
// incondicional antes de reinserir — "estado completo". Se o CQ já está confirmado, ainda faz
// upsert de `cad_grades.grades_reais` (sem bloco-fonte) — Grade Real pode ser zerada. `_salvar_cq_
// pos_core` (20260720290000_cq_pos_datas_conserto.sql:57-66) faz o mesmo em `cq_pos_variantes`,
// sem rev-check nenhum. Ambos os Salvar/Confirmar já existiam SEM olhar `hydrated`. Prova só o
// lado do cliente: os botões ficam desabilitados enquanto a query do CQ (`["cq", cad?.id]`) ainda
// não assentou.
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
  FAKE.linhas.producao_terceirizados = [];
  FAKE.linhas.categorias_terceirizado = [];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "pendente", status_pos: "pendente" }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] CQ Pré — Salvar/Confirmar travam ANTES da hidratação (P-57 A)", () => {
  it("com o CAD carregado e controle_qualidade ainda em voo, Salvar e Confirmar ficam DESABILITADOS", async () => {
    const soltar = FAKE.segurar("controle_qualidade");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    const confirmar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Controle de Qualidade"]');
    await aguardar(() => !!salvar() && !!confirmar(), "botões na tela");
    await esperar(50);
    expect(salvar()!.disabled).toBe(true); // ← fix: travado enquanto controle_qualidade não hidratou
    expect(confirmar()!.disabled).toBe(true);

    soltar();
    await aguardar(() => salvar()!.disabled === false, "destrava após hidratar", 2000);
    expect(confirmar()!.disabled).toBe(false);
  });

  // Achado I1 da revisão (review.md): o queryFn de `["cq", cad?.id]` ENGOLIA o erro (`const {
  // data } = ...; return data;`) — uma falha de rede fazia `cqRow=null` (tela semeia "sem CQ"),
  // `cqRevRef=null` (pula o rev-check, `_rev_base.cq=null`) e o Salvar gravaria por cima do
  // cabeçalho + apagaria `cq_variantes`. Prova: com a leitura de `controle_qualidade` falhando,
  // Salvar/Confirmar NUNCA destravam (hydrated nunca vira true) e aparece o aviso de erro.
  it("I1: controle_qualidade falha ao carregar — Salvar/Confirmar continuam DESABILITADOS e aparece 'Tentar de novo'", async () => {
    FAKE.falhar("controle_qualidade", 4); // sobrevive aos retries default do TanStack Query
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    const confirmar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Controle de Qualidade"]');
    await aguardar(() => !!salvar() && !!confirmar(), "botões na tela");
    await esperar(80);
    expect(salvar()!.disabled).toBe(true); // ← I1: nunca hidrata a partir de um erro
    expect(confirmar()!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Não foi possível carregar");
    expect(document.body.textContent).toContain("Tentar de novo");

    // Ainda desabilitado depois de esperar mais (não é só um atraso transitório).
    await esperar(200);
    expect(salvar()!.disabled).toBe(true);
  });

  // Achado N1 da re-revisão (regressão da rodada 1): o corpo era renderizado por `(!cad?.id ||
  // (!cqLoadError && hydrated))` — uma vez hidratado, se um REFETCH posterior falhasse, o corpo
  // sumia (nem banner nem fieldset renderizavam), mas Salvar/Confirmar (que só olham `hydrated`)
  // continuavam habilitados. Prova: hidrata com sucesso, depois um refetch de
  // `controle_qualidade` falha — o formulário continua visível.
  it("N1: refetch falha DEPOIS de hidratado — o corpo do CQ Pré CONTINUA visível", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    await aguardar(() => !!salvar() && salvar()!.disabled === false, "hidratou (Salvar habilitado)");
    expect(document.body.textContent).toContain("Observações do Controle de Qualidade");
    expect(document.body.textContent).not.toContain("Não foi possível carregar");

    FAKE.falhar("controle_qualidade", 4);
    await qc.invalidateQueries({ queryKey: ["cq", "c1"] });
    await esperar(150);

    // O corpo continua na tela e o Salvar continua HABILITADO (hydrated não regride).
    expect(document.body.textContent).toContain("Observações do Controle de Qualidade");
    expect(document.body.textContent).not.toContain("Não foi possível carregar");
    expect(salvar()!.disabled).toBe(false);
  });

  // Achado R1 da re-revisão: as queries auxiliares (`cq-main-fabric`, `cq-blocos-fonte`,
  // `cq-cats-servico`, `cq-confeccao-prioridade`) ainda engoliam erro e `fonteSettled` usava só
  // `isFetched` — uma falha nelas fazia a tela hidratar "sem fonte" e o `_rev_base.fonte` ia
  // `null`, pulando o rev-check da grade compartilhada com o PCP no servidor.
  it("R1: cq-blocos-fonte (bloco-fonte da grade cortada) falha ao carregar — Salvar continua DESABILITADO e aparece 'Tentar de novo'", async () => {
    FAKE.falhar("producao_terceirizados", 4); // cq-blocos-fonte lê producao_terceirizados
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    await aguardar(() => !!salvar(), "botão Salvar na tela");
    await esperar(120);
    expect(salvar()!.disabled).toBe(true); // ← R1: nunca hidrata com a fonte em erro
    expect(document.body.textContent).toContain("Não foi possível carregar");
    expect(document.body.textContent).toContain("Tentar de novo");

    await esperar(200);
    expect(salvar()!.disabled).toBe(true);
  });

  // Achado R1-resto da re-revisão (PERDA DE DADO comprovada): `cq-modelo-grades` e
  // `["tenant_config","tamanhos"]` ainda engoliam erro e ficavam FORA do gate. As duas alimentam
  // `tamanhos` → `realByNum` → `_reais` do payload de Salvar. Num CQ CONFIRMADO sem bloco-fonte,
  // `_salvar_cq_core` faz UPSERT de `cad_grades.grades_reais ← _reais` em TODO save (não só ao
  // confirmar) — uma falha única em `modelo_grades` faria o Salvar mandar `_reais` com os tokens
  // DEFAULT_TAMANHOS (zerados) em vez dos tokens reais do modelo (P/M), e o servidor sobrescreve
  // a Grade Real com zero.
  it("R1-resto: modelo_grades falha ao carregar — Salvar continua DESABILITADO e aparece 'Tentar de novo' (mesmo em CQ CONFIRMADO)", async () => {
    // Reproduz o cenário exato da revisão: CQ confirmado, sem bloco-fonte. Com `modelo_grades` em
    // erro, a tela nunca hidrata — `status` fica no default "pendente" (o seed nunca roda), então
    // nem o botão "Editar" do modo confirmado aparece (ele só existe quando `confirmado=true`,
    // que só é setado dentro do seed) — prova indireta de que a hidratação está bloqueada de
    // verdade, sem depender de qual ramo de botões a tela mostraria depois de hidratada.
    FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "pendente" }];
    FAKE.falhar("modelo_grades", 4);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(150);
    expect(document.body.textContent).toContain("Não foi possível carregar");
    expect(document.body.textContent).toContain("Tentar de novo");
    // O Salvar (do ramo default "pendente", já que o seed do status "confirmado" real nunca
    // rodou) fica DESABILITADO, e o botão "Editar" do modo confirmado nem aparece — a tela nunca
    // hidratou (o `status` real "confirmado" nunca chegou ao componente).
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Editar"]')).toBeNull();

    await esperar(200);
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_cq")).toBe(false);
  });

  // Mesma classe, pela outra query compartilhada (`["tenant_config","tamanhos"]`). O fake supabase
  // segura falhas por TABELA (não por query/coluna) e `tenant_config` também é lida por
  // `cq-confeccao-prioridade` (já gated desde a rodada 2) — `FAKE.falhar("tenant_config", n)` não
  // isola cirurgicamente qual das duas queries "causou" o efeito. Registrado pela re-revisão da
  // rodada 3 (review-fix3.md): interceptamos só o `select("tamanhos_grade")` no `FAKE.supabase.from`
  // (trazido do probe do revisor, `rr3-probe.test.ts`/`instalarFalhaTamanhos`) para provar
  // fail→pass genuíno sem depender da ordem das leituras.
  function instalarFalhaTamanhos(n: number) {
    const origFrom = FAKE.supabase.from;
    let restante = n;
    FAKE.supabase.from = (t: string) => {
      const b = origFrom(t);
      if (t !== "tenant_config") return b;
      const origSelect = b.select;
      const wrapped: any = { ...b };
      wrapped.select = (cols?: string) => {
        if (cols === "tamanhos_grade" && restante > 0) {
          restante--;
          const f: any = { then: (ok: any, err: any) => Promise.resolve({ data: null, error: { message: "falha tamanhos (fake)", code: "FAKE_ERR" } }).then(ok, err) };
          for (const m of ["eq", "maybeSingle", "single", "order", "limit", "in", "neq", "is"]) f[m] = () => f;
          return f;
        }
        return origSelect(cols);
      };
      return wrapped;
    };
    return () => { FAKE.supabase.from = origFrom; };
  }

  it("R1-resto: tenant_config.select('tamanhos_grade') falha ao carregar (modelo_grades vazio) — Salvar continua DESABILITADO e aparece 'Tentar de novo'", async () => {
    // CQ confirmado, sem bloco-fonte, `modelo_grades` VAZIO — os tamanhos só existem via
    // `tenant_config.tamanhos_grade`. Falha seletiva só nessa leitura (a de `confeccao_prioridade`
    // segue OK), reproduzindo o cenário exato da revisão sem depender da ordem dos selects.
    FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "confirmado", status_pos: "pendente" }];
    FAKE.linhas.modelo_grades = [];
    FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["P", "M"] }];
    const restaurar = instalarFalhaTamanhos(4);
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const C = (Route as any).options.component;
      const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
      desmontar = m.desmontar;
      await esperar(150);
      expect(document.body.textContent).toContain("Não foi possível carregar");
      expect(document.body.textContent).toContain("Tentar de novo");
      expect(document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]')?.disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>('button[aria-label="Editar"]')).toBeNull();

      await esperar(200);
      expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_cq")).toBe(false);
    } finally {
      restaurar();
    }
  });

  // Prova do retry: liberar a falha e clicar "Tentar de novo" recupera e hidrata.
  it("R1-resto: 'Tentar de novo' recupera de modelo_grades falhando e hidrata", async () => {
    FAKE.falhar("modelo_grades", 1); // só a 1ª falha — o retry deve suceder
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(120);
    expect(document.body.textContent).toContain("Não foi possível carregar");
    const tentarDeNovo = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Tentar de novo"))!;
    await clicar(tentarDeNovo);
    const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
    await aguardar(() => salvar()?.disabled === false, "hidrata após o retry recuperar modelo_grades", 2000);
  });

  // Nit da re-revisão (não é perda de dado — texto enganoso): com `cq-cad` em erro, `cad` fica
  // `undefined` (igual a "ainda carregando"), e a tela mostrava "Este modelo ainda não tem
  // registro de CAD" sem "Tentar de novo" — confunde "sem CAD" (dado real) com "falha ao
  // carregar" (erro de rede).
  it("cq-cad falha ao carregar — mostra o banner padrão + 'Tentar de novo' (não a mensagem de 'sem CAD')", async () => {
    FAKE.falhar("cad", 4);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(120);
    expect(document.body.textContent).toContain("Não foi possível carregar os dados.");
    expect(document.body.textContent).toContain("Tentar de novo");
    expect(document.body.textContent).not.toContain("Este modelo ainda não tem registro de CAD");
  });
});
