// @vitest-environment happy-dom
// [urg R1 T8 · fix round 1] Explosão com o hook de tamanhos vinculados: falha (F5), "—" enquanto carrega (F4) e sem semear de
// mapa velho do cache (F6). ExplosaoDetail REAL em happy-dom (mesmo harness do camada-c4-explosao-f6a).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => {
  const { FAKE } = await import("./fake-supabase");
  const { rpcExplosao } = await import("./explosao-fake");
  return { supabase: { ...FAKE.supabase, rpc: (nome: string, args: unknown) => rpcExplosao(nome, args) } };
});
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
import { resetCtl } from "./explosao-fake";
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { ExplosaoDetail } from "@/components/producao/explosao/ExplosaoDetail";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  resetCtl();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", colecao: "C", origem: "interno", tenant_id: "t1" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", rev: 1, enviado_corte: false }];
  FAKE.linhas.cad_tecidos = [{
    id: "t1", cad_id: "c1", numero: 1, tipo: "tecido", artigo_id: "a1", consumo_cad: 1, loss_percent_cad: 0, tamanho_folha: 1,
    artigos: { nome: "Linho", preco_por_metro: 5, unidade_medida: "m" },
    cad_tecido_variantes: [{ id: "v1", variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, quantidade_folhas: 2, metragem_planejada: 10, metragem_enviada: 3 }],
  }];
  // P = 2 peças, M = 6: grade total 8. O insumo vinculado a "P" precisa de necessária 2 (e não 8).
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_planejadas: { P: 2, M: 6 }, grade_total_planejada: 8 }];
  FAKE.linhas.modelo_aviamentos = [];
  FAKE.linhas.cad_aviamentos = [];
  FAKE.linhas.cad_etiquetas = [{ id: "ce1", cad_id: "c1", etiqueta_id: "e1", consumo: 1, quantidade_planejada: 8, quantidade_enviar: null, etiquetas: { nome: "Marca" } }];
  FAKE.linhas.etiquetas = [{ id: "e1", tenant_id: "t1", formato_tamanho: "nenhum", tamanho_vinculado: "P", variantes_etiqueta: [] }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["P", "M"] }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const texto = () => document.body.textContent ?? "";
const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const btns = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
const tentar = () => btns().find((b) => (b.textContent ?? "").includes("Tentar de novo")) ?? null;
const salvarBtn = () => btns().filter((b) => (b.textContent ?? "").includes("Salvar rascunho") || b.getAttribute("aria-label") === "Salvar rascunho");
const enviarBtn = () => btns().filter((b) => (b.textContent ?? "").includes("para PCP"));
/** Células da seção de Insumos (a última tabela da tela): necessária e "a enviar". */
const ultima = (rot: string) => {
  const t = document.querySelectorAll<HTMLElement>(`td[data-label="${rot}"]`);
  const td = t[t.length - 1];
  if (!td) return null;
  const v = td.querySelector("input")?.value ?? td.textContent ?? ""; // em edição o valor está no input
  return v.trim().replace(/,00$/, "");
};
const necessaria = () => ultima("Qtd necessária");
const aEnviar = () => ultima("A separar/enviar");
const rpcs = (nome: string) => FAKE.chamadas.filter((c) => c.tabela === `rpc:${nome}`);

async function abrir(qc = novoQc()) {
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null,
    createElement(ExplosaoDetail, { modeloId: "m1", onEnviado: () => {}, onClose: () => {} }))));
  desmontar = m.desmontar;
  return qc;
}

describe("[urg R1 T8] Explosão — leitura dos tamanhos vinculados", () => {
  it("F5: a leitura falha (retry:1 => 2 falhas): banner + 'Tentar de novo', Salvar/Enviar travados, nenhuma RPC; clicar recupera com a necessária do tamanho", async () => {
    FAKE.falhar("etiquetas", 2);
    await abrir();
    await aguardar(() => !!tentar(), "aviso com Tentar de novo", 6000);
    expect(texto()).toContain("Não foi possível carregar os dados");
    expect(salvarBtn().every((b) => b.disabled)).toBe(true);
    expect(enviarBtn().every((b) => b.disabled)).toBe(true);
    expect(rpcs("salvar_explosao_etiqueta_enviar")).toHaveLength(0);

    await clicar(tentar()!);
    await aguardar(() => !texto().includes("Não foi possível carregar os dados") && necessaria() === "2", "recuperou", 6000);
    expect(texto()).toContain("Só tam. P");
    await aguardar(() => salvarBtn().some((b) => !b.disabled), "Salvar liberado", 4000);
  });

  it("F4: enquanto os vínculos carregam, necessária E 'a enviar' mostram '—' (não 0); Salvar travado; depois 2 e 2", async () => {
    const soltar = FAKE.segurar("etiquetas");
    await abrir();
    await aguardar(() => necessaria() !== null, "seção de insumos", 4000);
    await esperar(50);
    expect(necessaria()).toBe("—");
    expect(aEnviar()).toBe("—");
    expect(salvarBtn().every((b) => b.disabled)).toBe(true);
    soltar();
    await aguardar(() => necessaria() === "2" && aEnviar() === "2", "valores com o vínculo", 4000);
  });

  it("F6: não semeia o 'a enviar' de um mapa velho do cache — espera a leitura nova", async () => {
    const qc = novoQc();
    qc.setQueryData(["insumos-tamanho-vinculado", "t1"], { e1: null }); // cache velho: "sem vínculo" (necessária seria 8)
    const soltar = FAKE.segurar("etiquetas");
    await abrir(qc);
    await aguardar(() => necessaria() !== null, "seção de insumos", 4000);
    await esperar(80);
    expect(salvarBtn().every((b) => b.disabled)).toBe(true); // não semeou ainda
    soltar();
    await aguardar(() => necessaria() === "2" && aEnviar() === "2", "semeou do mapa novo", 4000);
    expect(aEnviar()).toBe("2");
  });
});
