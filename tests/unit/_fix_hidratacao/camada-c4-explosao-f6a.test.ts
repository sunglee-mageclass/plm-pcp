// @vitest-environment happy-dom
// [camada C4 · F6a + RULING R1] ExplosaoDetail REAL em happy-dom.
// F6a (MANTIDO): uma carga que falhou nunca vira o estado inteiro gravável — erro + "Tentar de novo", Salvar/Enviar travados
// e os dois `mutationFn` recusam.
// R1 (05/out): a lógica de merge/eco da Explosão VOLTOU ao comportamento de antes da C4 (5f2a0e3d^). O aviso falso
// "atualizada por outra pessoa" depois do PRÓPRIO Salvar é o comportamento conhecido (cosmético, já em produção) e só sai na
// Onda 2 (Explosão numa RPC única + _rev_base em tudo). Os testes abaixo fixam esse comportamento — se um deles quebrar porque
// o aviso sumiu, é a correção da Onda 2 chegando: atualize o teste junto.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

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
import { montar, esperar, aguardar, digitar, clicar } from "./dom-helpers";
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
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_planejadas: { P: 2 }, grade_total_planejada: 2 }];
  FAKE.linhas.modelo_aviamentos = [{ id: "ma1", modelo_id: "m1", numero: 1, consumo: 1, aviamento_id: "av1", variante_aviamento_id: null, aviamentos: { codigo_nome: "Botao" } }];
  FAKE.linhas.cad_aviamentos = [{ id: "ca1", cad_id: "c1", aviamento_id: "av1", variante_aviamento_id: null, quantidade_separar: 3 }];
  FAKE.linhas.cad_etiquetas = [{ id: "ce1", cad_id: "c1", etiqueta_id: "e1", consumo: 1, quantidade_planejada: 4, quantidade_enviar: 4, etiquetas: { nome: "Marca" } }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", tamanhos_grade: ["P"] }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const SRC = readFileSync("src/components/producao/explosao/ExplosaoDetail.tsx", "utf8");
const texto = () => document.body.textContent ?? "";
const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const OUTRA_PESSOA = "A Explosão foi atualizada por outra pessoa.";
const aviso = () => toastMock.message.mock.calls.filter((c) => c[0] === OUTRA_PESSOA).length;
const btn = (rot: string) => (Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.getAttribute("aria-label") === rot || (b.textContent ?? "").includes(rot)) ?? null);
const salvarBtn = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((b) => (b.textContent ?? "").includes("Salvar rascunho") || b.getAttribute("aria-label") === "Salvar rascunho");
const enviarBtn = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((b) => (b.textContent ?? "").includes("para PCP"));
const campoMetragem = () => document.querySelector<HTMLInputElement>('input[data-colab-path="expl-metragem:v1"]');
const valorTela = (sel: string) => {
  const el = document.querySelector<HTMLElement>(sel);
  const v = el?.querySelector("input")?.value ?? el?.textContent ?? "";
  return Number(v.replace(/\./g, "").replace(",", "."));
};
/** Valor mostrado na coluna "Metr. a Separar/Enviar" (input em edição ou texto travado), em número. */
const metragemTela = () => valorTela('td[data-label="Metr. a Separar/Enviar"]');
const aviTela = () => valorTela('td[data-label="A separar/enviar"]');
const rpcs = (nome: string) => FAKE.chamadas.filter((c) => c.tabela === `rpc:${nome}`);

async function abrir(qc = novoQc()) {
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null,
    createElement(ExplosaoDetail, { modeloId: "m1", onEnviado: () => {}, onClose: () => {} }))));
  desmontar = m.desmontar;
  await aguardar(() => !!campoMetragem() && !salvarBtn().every((b) => b.disabled), "Explosão carregada e editável", 4000);
  return qc;
}
async function salvar() { await clicar(salvarBtn().find((b) => !b.disabled)!); }
/** Quando OUTRA pessoa grava: muda a linha, sobe o `rev` e o Realtime avisa. */
async function outraPessoaGrava(mut: () => void) {
  mut();
  FAKE.linhas.cad[0].rev += 1;
  FAKE.emitirRealtime("cad");
  await esperar(150);
}

describe("[camada C4 · F6a] Explosão — carga que falhou nunca vira o estado inteiro gravável", () => {
  for (const tabela of ["cad_tecidos", "cad_aviamentos", "cad_etiquetas", "cad_grades", "modelo_aviamentos", "cad"]) {
    it(`${tabela} falha: aviso + 'Tentar de novo', Salvar/Enviar travados, nenhuma RPC; clicar recupera`, async () => {
      FAKE.falhar(tabela, 1);
      const m = await montar(createElement(QueryClientProvider, { client: novoQc() }, createElement(SidebarProvider, null,
        createElement(ExplosaoDetail, { modeloId: "m1", onEnviado: () => {}, onClose: () => {} }))));
      desmontar = m.desmontar;
      const tentar = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes("Tentar de novo")) ?? null;
      await aguardar(() => !!tentar(), "aviso com Tentar de novo", 4000);
      expect(texto()).toContain("Não foi possível carregar os dados");
      expect(campoMetragem()).toBeNull();
      expect(enviarBtn().length).toBeGreaterThan(0);
      expect(enviarBtn().every((b) => b.disabled)).toBe(true);
      expect(salvarBtn().every((b) => b.disabled)).toBe(true);
      await esperar(100);
      expect(FAKE.chamadas.some((c) => c.op === "rpc" && /^rpc:salvar_explosao_|baixar_estoque/.test(c.tabela))).toBe(false);

      await clicar(tentar()!);
      await aguardar(() => !!campoMetragem() && !salvarBtn().every((b) => b.disabled), "recuperou e liberou o Salvar", 4000);
      expect(texto()).not.toContain("Não foi possível carregar os dados");
      expect(metragemTela()).toBe(3);
    });
  }

  it("os dois mutationFn (Salvar e Enviar) recusam com carga incompleta ANTES da 1ª RPC (o botão travado não é a única guarda)", () => {
    const guarda = "if (!podeGravarRef.current) throw erroValidacao(";
    for (const def of ["const salvarMut = useMutation", "const enviarCorte = useMutation"]) {
      const corpo = SRC.slice(SRC.indexOf(def));
      const fn = corpo.slice(corpo.indexOf("mutationFn:"), corpo.indexOf("supabase.rpc("));
      expect(fn, def).toContain(guarda);
    }
    expect(SRC).toContain("const podeGravar = seededAll && !falhaCarga;");
    expect(SRC).toContain("podeGravarRef.current = podeGravar;");
  });
});

describe("[RULING R1] Explosão — merge/eco de volta ao comportamento de antes da C4 (5f2a0e3d^)", () => {
  it("fonte: nada da janela de assentamento da C4 sobrou; o onSuccess do Salvar é o de antes (markClean + zera tocados + invalida)", () => {
    for (const c4 of ["assentandoRef", "enviadoRef", "mergeNonce", "avaliarEAplicar", "releituraFalhou", "assentarPosSalvar", "tocadosAntesRef", "explosao-colab"]) {
      expect(SRC, c4).not.toContain(c4);
    }
    const onSuccess = SRC.slice(SRC.indexOf("const salvarMut = useMutation")).split("onSuccess:")[1].split("onError:")[0];
    expect(onSuccess).toContain("markClean();");
    expect(onSuccess).toContain("tocouMetragemRef.current = false;");
    expect(onSuccess).toContain('qc.invalidateQueries({ queryKey: ["explosao-cad-tecidos", cadRow?.id] });');
    expect(SRC).toContain("const m = mergeDraft({ base: base as any, draft: draftBlob as any, fresh: fresh as any, touched });");
  });

  it("Salvar próprio: volta o aviso conhecido 'atualizada por outra pessoa' (cosmético, pré-existente — Onda 2); a tela fica com o salvo", async () => {
    await abrir();
    await digitar(campoMetragem()!, "10");
    await salvar();
    await aguardar(() => toastMock.success.mock.calls.length > 0, "toast Salvo");
    await esperar(200);
    expect(FAKE.linhas.cad_tecidos[0].cad_tecido_variantes[0].metragem_enviada).toBe(10);
    expect(metragemTela()).toBe(10);
    expect(aviso()).toBe(1); // o eco do próprio Salvar (comportamento de 5f2a0e3d^)
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("depois do meu Salvar, OUTRA pessoa grava em seção NÃO tocada: avisa de novo e a tela adota o dado", async () => {
    await abrir();
    await digitar(campoMetragem()!, "10");
    await salvar();
    await aguardar(() => toastMock.success.mock.calls.length > 0, "toast Salvo");
    await esperar(200);
    const antes = aviso();
    await outraPessoaGrava(() => { FAKE.linhas.cad_aviamentos[0].quantidade_separar = 7; });
    await aguardar(() => aviTela() === 7, "tela adotou o aviamento alheio");
    expect(aviso()).toBe(antes + 1);
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("depois do meu Salvar, OUTRA pessoa grava na seção que estou editando: banner de conflito, toast, Salvar travado, meu valor fica", async () => {
    await abrir();
    await digitar(campoMetragem()!, "10");
    await salvar();
    await aguardar(() => toastMock.success.mock.calls.length > 0, "toast Salvo");
    await esperar(200);
    await clicar(btn("Editar")!);
    await digitar(campoMetragem()!, "20");
    await outraPessoaGrava(() => { FAKE.linhas.cad_tecidos[0].cad_tecido_variantes[0].metragem_enviada = 30; });
    await aguardar(() => toastMock.warning.mock.calls.length > 0, "toast de conflito");
    expect(toastMock.warning.mock.calls[0][0]).toContain("Alguém salvou esta Explosão agora");
    expect(texto()).toContain("em conflito");
    expect(texto()).toContain("1 conflito a resolver");
    expect(metragemTela()).toBe(20);
    expect(salvarBtn().every((b) => b.disabled)).toBe(true);
  });

  it("P0409: alguém salvou antes do meu Salvar — toast de conflito, nenhum 'Salvo', as RPCs 2 e 3 nem rodam", async () => {
    await abrir();
    await digitar(campoMetragem()!, "10");
    FAKE.linhas.cad[0].rev += 5; // outra pessoa salvou antes de mim
    await salvar();
    await aguardar(() => toastMock.warning.mock.calls.length > 0, "toast de P0409", 3000);
    expect(toastMock.warning.mock.calls[0][0]).toContain("Alguém salvou esta Explosão agora");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(rpcs("salvar_explosao_aviamento_separar")).toHaveLength(0);
  });
});
