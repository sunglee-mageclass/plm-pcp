// @vitest-environment happy-dom
// Preço anterior e Título por versão — fix round 1 (revisão front I1 + Minors 4/7): o hook `useVersaoAnterior` (RENDER de
// verdade com QueryClient) e a tela do Sheet (PrecoTabela, PrecoRevendaBloco, InfoGeraisSecao) com a versão anterior.
//   • PGRST202 (banco velho) = sem anterior, sem erro; lotes de 500; RB2 (linha só de NULLs ⇒ null);
//   • erro SEM dado ⇒ `erro` (com "Tentar de novo"), nunca "carregando" eterno; refetch que falha COM dado ⇒ segue o dado;
//   • sem loja resolvida ⇒ "carregando" (não cai na regra da v1 por engano).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const h = vi.hoisted(() => ({ tenant: "t1", rpc: vi.fn() }));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => h.tenant }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => h.rpc(...a) } }));

const { useVersaoAnterior } = await import("@/hooks/useVersaoAnterior");
const { PrecoTabela } = await import("@/components/planejamento/planejamento-detail/PrecoTabela");
const { InfoGeraisSecao } = await import("@/components/planejamento/planejamento-detail/InfoGeraisSecao");
const { emptyDraft } = await import("@/components/planejamento/modelo-shared");

type R = ReturnType<typeof useVersaoAnterior>;
function montar(el: ReactElement): { container: HTMLElement; root: Root; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return { container, root, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}
const espera = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("tempo esgotado esperando a condição");
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
};
function sonda(ids: string[], enabled = true) {
  const out: { atual: R | null } = { atual: null };
  function Sonda() { out.atual = useVersaoAnterior(ids, enabled); return null; }
  const qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Sonda)));
  return { out, view, qc };
}
const linha = (id: string, o: Record<string, unknown> = {}) => ({
  modelo_id: id, anterior_id: null, anterior_versao: null, anterior_preco: null, titulo_herdado: null, titulo_origem_versao: null, ...o,
});

beforeEach(() => { h.tenant = "t1"; h.rpc.mockReset(); });

describe("useVersaoAnterior (render)", () => {
  it("PGRST202 (banco velho) = sem anterior para todos, sem erro nem carregando", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    const { out, view } = sonda(["m1"]);
    await espera(() => h.rpc.mock.calls.length > 0 && out.atual!.carregando === false);
    expect(out.atual!.erro).toBe(false);
    expect(out.atual!.mapa.size).toBe(0);
    view.unmount();
  });
  it("lotes de 500 ids (601 ⇒ 2 chamadas) e RB2: linha só de NULLs ⇒ null; com anterior ⇒ info", async () => {
    const ids = Array.from({ length: 601 }, (_, i) => `m${String(i).padStart(3, "0")}`);
    h.rpc.mockImplementation(async (_nome: string, args: { _modelo_ids: string[] }) => ({
      data: args._modelo_ids.map((id) => (id === "m001" ? linha(id, { anterior_id: "a", anterior_versao: 1, anterior_preco: "200.00", titulo_herdado: "T", titulo_origem_versao: 1 }) : linha(id))),
      error: null,
    }));
    const { out, view } = sonda(ids);
    await espera(() => out.atual!.mapa.size === 601);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc.mock.calls.map((c) => (c[1] as { _modelo_ids: string[] })._modelo_ids.length)).toEqual([500, 101]);
    expect(h.rpc.mock.calls[0][0]).toBe("modelos_versao_anterior");
    expect(out.atual!.mapa.get("m000")).toBeNull(); // RB2
    expect(out.atual!.mapa.get("m001")).toEqual({ anterior_versao: 1, anterior_preco: 200, titulo_herdado: "T", titulo_origem_versao: 1 });
    view.unmount();
  });
  it("I1: erro SEM dado ⇒ erro (não 'carregando' eterno); Tentar de novo recupera", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const { out, view } = sonda(["m1"]);
    await espera(() => out.atual!.erro);
    expect(out.atual!.carregando).toBe(false);
    h.rpc.mockResolvedValue({ data: [linha("m1", { anterior_id: "a", anterior_versao: 1, anterior_preco: 10 })], error: null });
    await act(async () => { out.atual!.tentarDeNovo(); });
    await espera(() => !out.atual!.erro && out.atual!.mapa.size === 1);
    expect(out.atual!.mapa.get("m1")?.anterior_preco).toBe(10);
    view.unmount();
  });
  it("I1: refetch que FALHA com dado em cache NÃO vira erro — segue o dado anterior (campo continua editável)", async () => {
    h.rpc.mockResolvedValue({ data: [linha("m1", { anterior_id: "a", anterior_versao: 1, anterior_preco: 10 })], error: null });
    const { out, view } = sonda(["m1"]);
    await espera(() => out.atual!.mapa.size === 1);
    h.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "rede" } });
    await act(async () => { out.atual!.tentarDeNovo(); });
    await espera(() => h.rpc.mock.calls.length >= 3); // 1ª + refetch + 1 retry
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(out.atual!.erro).toBe(false);
    expect(out.atual!.carregando).toBe(false);
    expect(out.atual!.mapa.get("m1")?.anterior_preco).toBe(10);
    view.unmount();
  });
  it("Minor 4: sem loja resolvida ('') ⇒ carregando (não cai na regra da v1), sem chamar a RPC", async () => {
    h.tenant = "";
    const { out, view } = sonda(["m1"]);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(out.atual!.carregando).toBe(true);
    expect(h.rpc).not.toHaveBeenCalled();
    view.unmount();
  });
  it("desligado (v1 no Sheet) = nem carregando nem erro, sem RPC", async () => {
    const { out, view } = sonda(["m1"], false);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(out.atual!).toMatchObject({ carregando: false, erro: false });
    expect(h.rpc).not.toHaveBeenCalled();
    view.unmount();
  });
});

// ─────────────────────────── Sheet (render): PrecoTabela e InfoGeraisSecao com a versão anterior ───────────────────────────
const MO = { moMax: 0, atingivel: false };
function precoTabela(o: Record<string, unknown>) {
  return createElement(PrecoTabela, {
    markupReal: 0, precoSug: 0, precoBase: 0, precoDigitado: 0, draftPrecoVenda: null, onPrecoVenda: () => {},
    precoAnterior: null, onPrecoAnterior: () => {}, seloCusto: "estimado", custoBase: 0, consumo: null, consumoRealBOM: 0,
    precoTecidoM: 0, tecidoEstimado: 0, aviamento: null, maoObraDev: 0, onConsumo: () => {}, onAviamento: () => {},
    materiaisBase: 0, custoPrevisto: 0, linhaFaixas: null, moMin: MO, moIdeal: MO, moMax: MO, moStatusFaixa: "indef",
    podeVerCustos: false, podeEditarCustos: false, podeEditarPreco: true, markupFaixaOn: false, planBloqueado: false,
    ...o,
  } as never);
}
const inputAnterior = (c: HTMLElement) => c.querySelector('input[aria-label="Preço anterior"]') as HTMLInputElement;

describe("Sheet — PrecoTabela (render) com a versão anterior", () => {
  it("anterior com preço: mostra o preço da vN + 'acompanha o preço da versão anterior (v2)'", () => {
    const v = montar(precoTabela({ precoDigitado: 300, versaoAnterior: { anterior_versao: 2, anterior_preco: 250, titulo_herdado: "T", titulo_origem_versao: 1 } }));
    expect(inputAnterior(v.container).value).toMatch(/250,00/);
    expect(v.container.textContent).toContain("acompanha o preço da versão anterior (v2)");
    v.unmount();
  });
  it("P-158: anterior SEM preço ⇒ vazio, placeholder '—' e 'aguardando preço da v2' (nunca o próprio preço)", () => {
    const v = montar(precoTabela({ precoDigitado: 300, versaoAnterior: { anterior_versao: 2, anterior_preco: null, titulo_herdado: "T", titulo_origem_versao: 1 } }));
    expect(inputAnterior(v.container).value).toBe("");
    expect(inputAnterior(v.container).placeholder).toBe("—");
    expect(v.container.textContent).toContain("aguardando preço da v2");
    v.unmount();
  });
  it("M4: v1 sem preço DIGITADO (só o sugerido) ⇒ vazio + 'aguardando preço de venda' e a dica explica o sugerido", () => {
    const v = montar(precoTabela({ precoSug: 199, precoBase: 199, precoDigitado: 0 }));
    expect(inputAnterior(v.container).value).toBe("");
    expect(inputAnterior(v.container).placeholder).toBe("—");
    expect(v.container.textContent).toContain("aguardando preço de venda");
    expect(v.container.textContent).toContain("o sugerido não vai para a loja virtual");
    v.unmount();
  });
  it("Minor 2: editado ⇒ 'valor fixado à mão · ↺ volta ao automático'", () => {
    const v = montar(precoTabela({ precoAnterior: 150 }));
    expect(v.container.textContent).toContain("valor fixado à mão · ↺ volta ao automático");
    expect(v.container.textContent).toContain("editado");
    v.unmount();
  });
  it("I1: falha sem dado ⇒ '—' + 'Tentar de novo' (chama o refetch), sem selo", () => {
    const tentar = vi.fn();
    const v = montar(precoTabela({ precoDigitado: 300, versaoAnteriorErro: true, onTentarVersaoAnterior: tentar }));
    expect(inputAnterior(v.container).placeholder).toBe("—");
    expect(v.container.textContent).not.toMatch(/automático|aguardando/);
    const b = [...v.container.querySelectorAll("button")].find((x) => x.textContent === "Tentar de novo")!;
    act(() => { b.click(); });
    expect(tentar).toHaveBeenCalledTimes(1);
    v.unmount();
  });
});

describe("Sheet — InfoGeraisSecao (render): Título herdado", () => {
  const props = (o: Record<string, unknown>) => createElement(InfoGeraisSecao, {
    draft: { ...emptyDraft(), nome: "VESTIDO ANDREIA", titulo_pagina: null, versao: 2 },
    setDraftTracked: () => {}, grupoSel: null, setGrupoSel: () => {}, grupos: [], categorias: [], estilistas: [], sub1Opts: [],
    sub2Opts: [], fl: (k: string) => k, origemOpcoes: [], nomeLoja: "Loja Teste", planBloqueado: false, compartilhadoBloqueado: false,
    ...o,
  } as never);
  const titulo = (c: HTMLElement) => c.querySelector("#titulo-pagina") as HTMLInputElement;
  it("v2+: mostra o HERDADO + selo 'herdado da v1'", () => {
    const v = montar(props({ versaoAnterior: { anterior_versao: 1, anterior_preco: 1, titulo_herdado: "Vestido Gardenia | Loja Teste", titulo_origem_versao: 1 } }));
    expect(titulo(v.container).value).toBe("Vestido Gardenia | Loja Teste");
    expect(v.container.textContent).toContain("herdado da v1");
    v.unmount();
  });
  it("carregando ⇒ Título desabilitado (R4)", () => {
    const v = montar(props({ versaoAnteriorCarregando: true }));
    expect(titulo(v.container).closest("fieldset")!.disabled).toBe(true);
    v.unmount();
  });
  it("I1: falha sem dado ⇒ Título desabilitado + 'Tentar de novo' (fora do fieldset, clicável)", () => {
    const tentar = vi.fn();
    const v = montar(props({ versaoAnteriorErro: true, onTentarVersaoAnterior: tentar }));
    expect(titulo(v.container).closest("fieldset")!.disabled).toBe(true);
    const b = [...v.container.querySelectorAll("button")].find((x) => x.textContent === "Tentar de novo")!;
    expect(b.closest("fieldset[disabled]")).toBeNull();
    act(() => { b.click(); });
    expect(tentar).toHaveBeenCalledTimes(1);
    v.unmount();
  });
  it("v1 (sem versão anterior): o calculado do Nome + 'automático'", () => {
    const v = montar(props({}));
    expect(titulo(v.container).value).toBe("Vestido Andreia | Loja Teste");
    expect(v.container.textContent).toContain("automático");
    v.unmount();
  });
});
