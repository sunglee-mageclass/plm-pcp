// @vitest-environment happy-dom
// [camada C3 · B8a / B8c / m-A] "Carregar sem enganar": uma carga que FALHOU nunca vira o estado vazio ("Sem registro de CAD",
// "Este modelo ainda não tem CAD", "Grade Total Geral 0,00"). A tela distingue carregando / erro (aviso + "Tentar de novo") /
// vazio de verdade; o Salvar fica travado no erro; uma falha de REFETCH depois do sucesso mantém o último dado (sem aviso).
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
import { montar, esperar, aguardar, clicar, digitar } from "./dom-helpers";
import { Route as RouteDir } from "@/routes/_authenticated/expedicao.direcionamento.$modeloId";
import { Route as RouteOficina } from "@/routes/_authenticated/pcp.oficina.$modeloId";
import { Route as RouteServicos } from "@/routes/_authenticated/pcp.servicos.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C", origem: "interno", tenant_id: "t1" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", direcionamento_status: "pendente", observacoes_molde: "molde real", sem_acabamento: false }];
  FAKE.linhas.direcionamento_controle = [{ cad_id: "c1", rev: 3 }];
  FAKE.linhas.lojas_direcionamento = [{ id: "l1", tenant_id: "t1", nome: "E-commerce", ativo: true, ordem: 1 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grades_planejadas: { P: 10, M: 10 }, grade_total_planejada: 20, grade_total_real: 20 }];
  FAKE.linhas.direcionamento_lojas = [{ id: "d1", cad_id: "c1", loja_id: "l1", variante_numero: 1, grades: { P: 10, M: 10 } }];
  FAKE.linhas.empresas = [{ id: "e1", nome_fantasia: "Oficina X", tipo: "servico" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["P", "M"], oficina_interna: false }];
  FAKE.linhas.producao_oficina = [{ id: "po1", cad_id: "c1", preco_por_peca: 12.5, quantidade_enviada: 100 }];
  FAKE.linhas.producao_terceirizados = [{ id: "pt1", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 1, grade_detalhe: {} }];
  FAKE.linhas.categorias_terceirizado = [{ id: "cat1", tenant_id: "t1", nome: "Estamparia", ativo: true, etapa: "pre" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const texto = () => document.body.textContent ?? "";
const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
const tentarDeNovo = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Tentar de novo")) ?? null;
async function abrir(Route: any, qc: QueryClient) {
  const C = Route.options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
}
const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const TELAS = [
  { nome: "Direcionamento", Route: RouteDir, chaveCad: ["dir-cad", "m1"], falhasCad: 2, semCad: "Sem registro de CAD" },
  { nome: "PCP Oficina", Route: RouteOficina, chaveCad: ["oficina-cad", "m1"], falhasCad: 2, semCad: "ainda não tem registro de CAD" },
  { nome: "PCP Serviços", Route: RouteServicos, chaveCad: ["terc-cad", "m1"], falhasCad: 4 /* a Ficha Técnica impressa (useFichaData) também lê `cad` */, semCad: "ainda não possui um registro de CAD" },
] as const;

for (const T of TELAS) {
  describe(`[camada C3] ${T.nome} — falha ao carregar o CAD não vira "sem CAD"`, () => {
    it("CAD falha: aviso + 'Tentar de novo', SEM texto de 'sem CAD', Salvar travado; clicar recupera", async () => {
      FAKE.falhar("cad", T.falhasCad);
      await abrir(T.Route, novoQc());
      await aguardar(() => !!tentarDeNovo(), "aviso com Tentar de novo", 5000);
      expect(texto()).toContain("Não foi possível carregar os dados");
      expect(texto()).not.toContain(T.semCad);
      await aguardar(() => !!salvar(), "botão Salvar na tela");
      expect(salvar()!.disabled).toBe(true);
      await esperar(100);
      expect(salvar()!.disabled).toBe(true);
      // nenhuma gravação foi disparada
      expect(FAKE.chamadas.some((c) => c.op === "rpc" && /^rpc:salvar_/.test(c.tabela))).toBe(false);
      expect(FAKE.chamadas.some((c) => c.tabela === "producao_oficina" && c.op !== "select")).toBe(false);

      await clicar(tentarDeNovo()!);
      await aguardar(() => salvar()?.disabled === false, "hidrata após o retry recuperar o CAD", 3000);
      expect(texto()).not.toContain("Não foi possível carregar os dados");
      expect(texto()).not.toContain(T.semCad);
    });

    it("CAD realmente inexistente (sucesso sem linha): mostra o estado vazio, sem 'Tentar de novo'", async () => {
      FAKE.linhas.cad = [];
      await abrir(T.Route, novoQc());
      await aguardar(() => texto().includes(T.semCad), "estado vazio de verdade", 3000);
      expect(tentarDeNovo()).toBeNull();
      expect(texto()).not.toContain("Não foi possível carregar os dados");
      expect(salvar()!.disabled).toBe(true); // sem CAD não há o que salvar
    });

    it("refetch do CAD falha DEPOIS de hidratar: mantém o último dado, sem aviso, Salvar continua habilitado", async () => {
      const qc = novoQc();
      await abrir(T.Route, qc);
      await aguardar(() => !!salvar() && salvar()!.disabled === false, "hidratou (Salvar habilitado)", 3000);
      FAKE.falhar("cad", 4);
      await qc.invalidateQueries({ queryKey: T.chaveCad as unknown as string[] });
      await esperar(150);
      expect(texto()).not.toContain("Não foi possível carregar os dados");
      expect(texto()).not.toContain(T.semCad);
      expect(salvar()!.disabled).toBe(false);
    });
  });
}

describe("[camada C3] PCP Oficina — grade da ficha", () => {
  it("cad_grades falha: aviso da grade com 'Tentar de novo'; clicar recupera; o formulário segue utilizável", async () => {
    FAKE.falhar("cad_grades", 2); // a query tem retry: 1 (B1) = 2 tentativas
    await abrir(RouteOficina, novoQc());
    await aguardar(() => texto().includes("Não foi possível carregar a grade"), "aviso da grade", 5000);
    expect(tentarDeNovo()).not.toBeNull();
    await clicar(tentarDeNovo()!);
    await aguardar(() => !texto().includes("Não foi possível carregar a grade"), "grade recuperada", 3000);
  });
});

describe("[camada C3] PCP Serviços — cabeçalho (Grade Total Geral / custo)", () => {
  it("cad_grades falha: cabeçalho mostra '—' (não '0,00') + aviso; clicar recupera e mostra o total", async () => {
    FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grade_total_real: 20, grade_total_planejada: 20 }];
    FAKE.falhar("cad_grades", 2); // retry: 1 (B1) = 2 tentativas
    await abrir(RouteServicos, novoQc());
    await aguardar(() => texto().includes("Não foi possível carregar a grade e o custo do CAD"), "aviso do cabeçalho", 5000);
    expect(texto()).toContain("Grade Total Geral—");
    expect(texto()).not.toContain("Grade Total Geral0,00");
    await clicar(tentarDeNovo()!);
    await aguardar(() => !texto().includes("Não foi possível carregar a grade e o custo do CAD"), "recuperou", 3000);
    expect(texto()).toContain("Grade Total Geral20");
  });
});

// ---- fix round 1 ----------------------------------------------------------------------------------------------------
const molde = () => Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find((t) => t.value.startsWith("molde"));
const updatesCad = () => FAKE.chamadas.filter((c) => c.tabela === "cad" && c.op === "update");

describe("[camada C3 fix1 · I1] PCP Oficina — refetch do CAD que falha DEPOIS do Salvar não re-semeia o molde VELHO", () => {
  it("Salvar (molde NOVO) -> refetch do cad falha: aviso + Tentar de novo, Salvar TRAVADO, nenhum UPDATE com o molde velho; retry hidrata o molde NOVO", async () => {
    await abrir(RouteOficina, novoQc());
    await aguardar(() => !!salvar() && salvar()!.disabled === false && !!molde(), "hidratou", 3000);
    await digitar(molde()!, "molde NOVO");

    FAKE.falhar("cad", 8); // o refetch pós-Salvar (e o retry:1) falham
    await clicar(salvar()!);
    await aguardar(() => updatesCad().length === 1, "UPDATE do cad com o molde NOVO");
    expect((updatesCad()[0].payload as any).observacoes_molde).toBe("molde NOVO");
    expect(FAKE.linhas.cad[0].observacoes_molde).toBe("molde NOVO");

    await aguardar(() => !!tentarDeNovo(), "aviso depois do refetch falho", 5000);
    expect(texto()).toContain("Não foi possível carregar os dados");
    expect(salvar()!.disabled).toBe(true);
    expect(molde()).toBeUndefined(); // o formulário (e o molde velho semeado) não volta
    await esperar(200);
    expect(salvar()!.disabled).toBe(true);
    expect(updatesCad().length).toBe(1); // nada gravou o molde velho por cima
    expect(texto()).not.toContain("alterações não salvas"); // [fix2 L1] o que foi salvo não deixa o selo aceso

    FAKE.falhar("cad", 0);
    await clicar(tentarDeNovo()!);
    await aguardar(() => salvar()?.disabled === false && !!molde(), "carga NOVA com sucesso libera o Salvar", 3000);
    expect(molde()!.value).toBe("molde NOVO");
  });
});

describe("[camada C3 fix1 · M1] PCP Serviços — refetch do CAD que falha DEPOIS do Salvar mostra aviso (não trava mudo)", () => {
  it("Salvar -> refetch do terc-cad falha: aviso + Tentar de novo + Salvar travado; retry libera", async () => {
    await abrir(RouteServicos, novoQc());
    await aguardar(() => !!salvar() && salvar()!.disabled === false && !!molde(), "hidratou", 3000);
    await digitar(molde()!, "molde NOVO");
    FAKE.falhar("cad", 8);
    await clicar(salvar()!);
    await aguardar(() => !!tentarDeNovo(), "aviso depois do refetch falho", 6000);
    expect(texto()).toContain("Não foi possível carregar os dados");
    expect(salvar()!.disabled).toBe(true);
    // [fix2 L2] corpo somente leitura enquanto o aviso está na tela (o que se digitasse seria sobrescrito no retry)
    expect(molde()!.closest("fieldset")!.disabled).toBe(true);
    FAKE.falhar("cad", 0);
    await clicar(tentarDeNovo()!);
    await aguardar(() => salvar()?.disabled === false, "libera após carga NOVA", 3000);
    expect(texto()).not.toContain("Não foi possível carregar os dados");
  });
});

describe("[camada C3 fix1 · B2/B3/B4] carregando não vira vazio/0,00", () => {
  it("Oficina: imprimir desabilitado e Serviços: cabeçalho '—' enquanto cad_grades carrega", async () => {
    const soltar = FAKE.segurar("cad_grades");
    await abrir(RouteServicos, novoQc());
    await aguardar(() => texto().includes("Grade Total Geral"), "cabeçalho");
    await esperar(60);
    expect(texto()).toContain("Grade Total Geral—");
    expect(texto()).not.toContain("Grade Total Geral0,00");
    soltar();
    await aguardar(() => texto().includes("Grade Total Geral20"), "total chega", 3000);
  });

  it("Oficina: botão de imprimir desabilitado enquanto a grade carrega", async () => {
    const soltar = FAKE.segurar("cad_grades");
    await abrir(RouteOficina, novoQc());
    const imprimir = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Imprimir Ficha de Oficina"))!;
    await aguardar(() => !!imprimir(), "botão de imprimir");
    await esperar(60);
    expect(imprimir().disabled).toBe(true);
    soltar();
    await aguardar(() => imprimir().disabled === false, "habilita quando a grade chega", 3000);
  });
});

describe("[camada C3 fix1 · M2] Direcionamento — carregando não vira 'Nenhuma variante'", () => {
  it("com o CAD lido e cad_grades em voo: 'Carregando…', sem 'Nenhuma variante com grade real'", async () => {
    const soltar = FAKE.segurar("cad_grades");
    await abrir(RouteDir, novoQc());
    await aguardar(() => !!salvar(), "tela");
    await esperar(80);
    expect(texto()).toContain("Carregando…");
    expect(texto()).not.toContain("Nenhuma variante com grade real");
    soltar();
    await aguardar(() => salvar()?.disabled === false, "hidrata", 3000);
    expect(texto()).not.toContain("Carregando…");
  });
});

describe("[camada C3 fix2 · L4] PCP Oficina — imprimir desabilitado enquanto o CAD carrega", () => {
  it("com o `cad` em voo o botão de imprimir fica desabilitado", async () => {
    const soltar = FAKE.segurar("cad");
    await abrir(RouteOficina, novoQc());
    const imprimir = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Imprimir Ficha de Oficina"))!;
    await aguardar(() => !!imprimir(), "botão de imprimir");
    await esperar(60);
    expect(imprimir().disabled).toBe(true);
    soltar();
    await aguardar(() => imprimir().disabled === false, "habilita quando o CAD e a grade chegam", 3000);
  });
});
