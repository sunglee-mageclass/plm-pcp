// @vitest-environment happy-dom
// R14 fix round 5 (T1) — render do retry automático do P0409 no CQ Pré (QA cenário 19: o retry reenviava o form
// VELHO com o rev novo e apagava a edição da outra pessoa). Harness: tests/unit/_fix_hidratacao.
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
import { Route } from "@/routes/_authenticated/expedicao.cq.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";


let desmontar: (() => Promise<void>) | null = null;
const rpcOriginal = FAKE.supabase.rpc;
type ChamadaSalvar = { _cq: Record<string, any>; _rev_base: { cq: number | null }; _confirmar: boolean };
let salvares: ChamadaSalvar[] = [];
/** `falhasP0409` = quantas chamadas seguidas de `salvar_cq` voltam P0409. Em cada P0409 o "outro usuário" (B) já tinha salvado:
 *  a linha do fake vira obs "B novo" com rev subindo (o refetch do reconcile lê isso). */
function instalarSalvarCq(falhasP0409: number) {
  let restantes = falhasP0409;
  FAKE.supabase.rpc = (nome: string, args?: any) => {
    if (nome !== "salvar_cq") return rpcOriginal(nome, args);
    salvares.push(JSON.parse(JSON.stringify({ _cq: args._cq, _rev_base: args._rev_base, _confirmar: args._confirmar })));
    if (restantes > 0) {
      restantes -= 1;
      const row = FAKE.linhas.controle_qualidade[0];
      row.observacoes_cq = "B novo"; row.rev = Number(row.rev) + 1;
      return Promise.resolve({ data: null, error: { code: "P0409", message: "conflito_versao: cq" } });
    }
    return Promise.resolve({ data: null, error: null });
  };
}
beforeEach(() => {
  FAKE.reset();
  salvares = [];
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C", subcolecao: "", semana: 1, origem: "interno" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1" }];
  FAKE.linhas.cad_tecidos = [{ cad_id: "c1", tipo: "tecido", numero: 1 }];
  FAKE.linhas.modelo_grades = [{ modelo_id: "m1", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"] }];
  FAKE.linhas.producao_terceirizados = [];
  FAKE.linhas.categorias_terceirizado = [];
  FAKE.linhas.controle_qualidade = [{ id: "cq1", cad_id: "c1", status: "pendente", status_pos: "pendente", rev: 1, observacoes_cq: "B velho", pecas_incompletas: 0 }];
  FAKE.linhas.cq_variantes = [{ id: "v1", controle_qualidade_id: "cq1", etapa: "recebimento", variante_numero: 1, grades: { P: 10, M: 10 }, grade_total: 20 }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { FAKE.supabase.rpc = rpcOriginal; await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

async function abrirEDigitarPecas() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
  const salvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');
  await aguardar(() => !!salvar() && salvar()!.disabled === false, "hidratou");
  const campo = document.querySelector<HTMLInputElement>('[data-colab-path="pecas_incompletas"]')!;
  await digitar(campo, "7"); // A só mexe nas peças incompletas; a obs ("B velho") A não tocou
  return { salvar };
}

describe("[R14 round 5 / QA 19] retry do P0409 manda o form MESCLADO (não o state velho)", () => {
  it("Salvar: 1ª chamada P0409 (B salvou a obs, rev 2) -> 2ª chamada leva obs 'B novo', peças 7 (de A) e _rev_base.cq = 2", async () => {
    instalarSalvarCq(1);
    const { salvar } = await abrirEDigitarPecas();
    await clicar(salvar()!);
    await aguardar(() => salvares.length >= 2, "retry do P0409", 3000);
    expect(salvares).toHaveLength(2);
    expect(salvares[0]._cq.observacoes_cq).toBe("B velho");
    expect(salvares[0]._rev_base.cq).toBe(1);
    expect(salvares[1]._cq.observacoes_cq).toBe("B novo"); // antes do fix: "B velho" (apagava a edição do B)
    expect(salvares[1]._cq.pecas_incompletas).toBe(7);
    expect(salvares[1]._rev_base.cq).toBe(2);
  });

  it("Confirmar: mesmo cenário pelo botão Confirmar (_confirmar = true nas 2 chamadas)", async () => {
    instalarSalvarCq(1);
    await abrirEDigitarPecas();
    const confirmar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Confirmar Controle de Qualidade"]')!;
    await clicar(confirmar());
    // o Confirmar pode abrir um diálogo de confirmação — confirma se aparecer
    await esperar(30);
    const ok = Array.from(document.querySelectorAll("button")).find((b) => /^(Confirmar|Sim)/.test((b.textContent ?? "").trim()) && b !== confirmar());
    if (salvares.length === 0 && ok) await clicar(ok as HTMLButtonElement);
    await aguardar(() => salvares.length >= 2, "retry do P0409 (Confirmar)", 3000);
    expect(salvares[0]._confirmar).toBe(true);
    expect(salvares[1]._confirmar).toBe(true);
    expect(salvares[1]._cq.observacoes_cq).toBe("B novo");
    expect(salvares[1]._cq.pecas_incompletas).toBe(7);
    expect(salvares[1]._rev_base.cq).toBe(2);
  });

  it("2º P0409 seguido: NÃO há 3ª tentativa automática, o erro aparece e um Salvar manual seguinte manda o state atual (ref limpa)", async () => {
    instalarSalvarCq(2);
    const { salvar } = await abrirEDigitarPecas();
    await clicar(salvar()!);
    await aguardar(() => salvares.length >= 2, "2 tentativas", 3000);
    await esperar(200);
    expect(salvares).toHaveLength(2); // sem 3ª tentativa automática
    expect(toastMock.error).toHaveBeenCalled();
    // Salvar manual: o fake já devolve sucesso. Se a ref do retry ficasse presa, mandaria o estado mesclado da tentativa antiga.
    await aguardar(() => salvar()!.disabled === false, "Salvar liberado");
    const campo = document.querySelector<HTMLInputElement>('[data-colab-path="pecas_incompletas"]')!;
    await digitar(campo, "9");
    await clicar(salvar()!);
    await aguardar(() => salvares.length >= 3, "salvar manual", 3000);
    expect(salvares[2]._cq.pecas_incompletas).toBe(9); // state atual, não o 7 retido pela ref
  });
});
