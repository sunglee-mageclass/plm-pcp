// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — caso GRAVE da investigação 26/set (§3, achado
// colateral fora do Achado 1): com o CAD e a âncora de rev (`direcionamento_controle`) já
// carregados mas a grade real (`cad_grades`) ainda em voo, o botão Salvar ficava HABILITADO e
// mandava `_rows: []` com um `_rev_base` VÁLIDO — no SQL (`_salvar_direcionamento_core`, payload
// "estado completo") isso apaga TODAS as linhas de loja do CAD. Aqui prova só o lado do cliente
// (o botão trava antes de hidratar); o lado SQL é auditoria de leitura (banco proibido nesta tarefa).
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
import { Route } from "@/routes/_authenticated/expedicao.direcionamento.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
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

describe("[fix hidratação] Direcionamento — Salvar trava ANTES da hidratação (P-57 A)", () => {
  it("com CAD + rev carregados e a grade ainda em voo, o Salvar fica DESABILITADO (não manda _rows: [] com _rev_base válido)", async () => {
    const soltarGrade = FAKE.segurar("cad_grades"); // a hidratação espera a grade real
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    await aguardar(() => !!salvar(), "botão Salvar na tela");
    await aguardar(() => FAKE.chamadas.some((c) => c.tabela === "direcionamento_controle"), "rev (âncora) lido");
    await esperar(50);
    expect(salvar()!.disabled).toBe(true); // ← fix: travado enquanto a grade não hidratou

    soltarGrade(); // libera a grade — hidrata
    await aguardar(() => salvar()!.disabled === false, "destrava após hidratar", 2000);
    // Nenhuma chamada de salvar_direcionamento foi feita enquanto estava travado.
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_direcionamento")).toBe(false);

    // Achado M5 da revisão: o `expect` acima nunca clica — sem uma prova positiva, ele passaria
    // até se o Salvar nunca disparasse a RPC (falso-positivo). Clica DEPOIS de destravar e prova
    // que o payload leva as linhas de loja REAIS (não `_rows: []`, o payload vazio do bug).
    await clicar(salvar()!);
    await aguardar(() => FAKE.chamadas.some((c) => c.tabela === "rpc:salvar_direcionamento"), "rpc:salvar_direcionamento chamada");
    const chamada = FAKE.chamadas.find((c) => c.tabela === "rpc:salvar_direcionamento")!;
    expect((chamada.payload as any)?._rows?.length).toBeGreaterThan(0);
  });

  // Achado I1 da revisão: `cad_grades`/`direcionamento_lojas`/`lojas_direcionamento` engoliam o
  // erro (`return data ?? []` sem checar) — uma falha de rede virava "sem linhas" e o Salvar
  // mandaria `_rows:[]` com `_rev_base` válido (caso GRAVE, apaga TUDO — invariante #10).
  it("I1: cad_grades falha ao carregar — Salvar continua DESABILITADO e aparece 'Tentar de novo'", async () => {
    FAKE.falhar("cad_grades", 4);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    await aguardar(() => !!salvar(), "botão Salvar na tela");
    await esperar(80);
    expect(salvar()!.disabled).toBe(true); // ← I1: nunca hidrata a partir de um erro
    expect(document.body.textContent).toContain("Não foi possível carregar");
    expect(document.body.textContent).toContain("Tentar de novo");

    await esperar(200);
    expect(salvar()!.disabled).toBe(true);
    expect(FAKE.chamadas.some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_direcionamento")).toBe(false);
  });

  // Achado M4 da revisão: a âncora de rev (`direcionamento_controle`) não entrava no gate de
  // hidratação. Com o CAD e a grade real já carregados mas a âncora ainda em voo, `hydrated`
  // virava true (não depende dela) e `revRef` ficava 0 — o Salvar mandaria `_rev_base=0`, que
  // pode dar um P0409 falso ("Alguém salvou…") mesmo sem ninguém ter salvo.
  it("M4: com CAD + grade carregados e a âncora de rev (direcionamento_controle) ainda em voo, o Salvar fica DESABILITADO", async () => {
    const soltarControle = FAKE.segurar("direcionamento_controle");
    const qc = new QueryClient();
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    await aguardar(() => !!salvar(), "botão Salvar na tela");
    await aguardar(() => FAKE.chamadas.some((c) => c.tabela === "cad_grades"), "grade real lida");
    await esperar(80);
    expect(salvar()!.disabled).toBe(true); // ← M4: travado enquanto a âncora de rev não chegou

    soltarControle();
    await aguardar(() => salvar()!.disabled === false, "destrava após a âncora chegar", 2000);
  });

  // Achado N2 da re-revisão: "Tentar de novo" só refazia `direcionamento-lojas` (a query
  // `existing`). Uma falha em `cad_grades` (ou `lojas_direcionamento`/`dir-controle`) deixava a
  // tela presa no aviso PARA SEMPRE, mesmo clicando "Tentar de novo" — só um refetch por foco de
  // janela recuperava.
  it("N2: 'Tentar de novo' refaz cad_grades também (não só direcionamento-lojas) — clicar recupera de um erro em cad_grades", async () => {
    FAKE.falhar("cad_grades", 1); // só a 1ª falha — o retry (via "Tentar de novo") deve suceder
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(120);
    expect(document.body.textContent).toContain("Não foi possível carregar");
    const salvar = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Salvar"]')).at(-1) ?? null;
    expect(salvar()?.disabled ?? true).toBe(true);

    const tentarDeNovo = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Tentar de novo"))!;
    await clicar(tentarDeNovo);
    await aguardar(() => salvar()?.disabled === false, "hidrata após o retry recuperar cad_grades", 2000);
  });

  // Achado N4 da re-revisão: erro em `dir-controle` (a âncora de rev, achado M4) travava o Salvar
  // MUDO — sem banner nem "Tentar de novo", indistinguível de "ainda carregando".
  it("N4: dir-controle falha ao carregar — aparece o banner de erro (não trava mudo)", async () => {
    FAKE.falhar("direcionamento_controle", 4);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const C = (Route as any).options.component;
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
    desmontar = m.desmontar;
    await esperar(120);
    expect(document.body.textContent).toContain("Não foi possível carregar");
    expect(document.body.textContent).toContain("Tentar de novo");
  });
});
