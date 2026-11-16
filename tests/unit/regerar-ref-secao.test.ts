// @vitest-environment happy-dom
// "Regerar REF" - a tela (CodigosSecao): botao, selo "REF a gravar", AlertDialog da REF MANUAL (Review Focus 3), aviso de replicas (Review Focus 4),
// aviso de conflitos e as regras de habilitacao (so interno, so card editavel, rascunho limpo, exclusao mutua com o Regerar SKUs). RENDER de verdade.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emptyDraft } from "@/components/planejamento/modelo-shared";
import { CodigosSecao } from "@/components/planejamento/planejamento-detail/codigos/CodigosSecao";
import { useSkusAGravar, useSkusModelo } from "@/components/planejamento/planejamento-detail/codigos/useSkusModelo";
import { useRegerarRef } from "@/components/planejamento/planejamento-detail/codigos/useRegerarRef";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ASS = "c".repeat(32);
const matrizOk = { status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "numero", linhas: [], faltas: [], avisos: [] };
const previaCrua = (p: Record<string, unknown> = {}) => ({
  pode: true, motivo: null, ref_atual: "ANTIGA", ref_auto_atual: "ANTIGA", ref_nova: "NOVA", tipo_ref: "automatica", muda: true, irmaos: 0, ...p,
});
const mock = vi.hoisted(() => ({ respostas: {} as Record<string, () => Promise<{ data: unknown; error: unknown }>> }));
const rpcSpy = vi.hoisted(() => vi.fn((nome: string, _args: unknown) => mock.respostas[nome]?.() ?? Promise.resolve({ data: null, error: null })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) } }));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

type Props = { refEditavel: boolean; podeEditarSkus: boolean; origemInterno: boolean; rascunhoLimpo: boolean; refVisivel: boolean };
const PADRAO: Props = { refEditavel: true, podeEditarSkus: true, origemInterno: true, rascunhoLimpo: true, refVisivel: true };
let aGravarApi: ReturnType<typeof useSkusAGravar>;

function Harness(p: Props) {
  const aGravar = useSkusAGravar();
  aGravarApi = aGravar;
  const regerarRef = useRegerarRef({ modeloId: "m1", aGravar, entrada: { ref: "ANTIGA", categoria: "c1", sub1: "s1" } });
  const skus = useSkusModelo("m1", true, p.podeEditarSkus, { refPrevia: regerarRef.pendente?.refNova ?? "ANTIGA", tamanhoTipo: "numero", aGravar });
  return createElement(CodigosSecao, {
    draft: { ...emptyDraft(), ref: "ANTIGA" }, setDraftTracked: () => {}, rotuloRef: "REF", refVisivel: p.refVisivel, refEditavel: p.refEditavel,
    refPrevia: regerarRef.pendente?.refNova ?? "ANTIGA", skus, aGravar, bomSujo: false, podeVerSkus: true, podeEditarSkus: p.podeEditarSkus,
    regerarRef, origemInterno: p.origemInterno, rascunhoLimpo: p.rascunhoLimpo,
  });
}
const limpezas: (() => void)[] = [];
afterEach(() => { for (const f of limpezas.splice(0)) { try { f(); } catch { /* ja desmontado */ } } });
function montar(p: Partial<Props> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { ...PADRAO, ...p }))); });
  limpezas.push(() => { act(() => { root.unmount(); }); container.remove(); });
  return container;
}
const espera = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const botao = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === texto) as HTMLButtonElement | undefined;
const clicar = (b: HTMLButtonElement) => act(async () => { b.click(); await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  rpcSpy.mockClear();
  Object.values(toastMock).forEach((f) => f.mockClear());
  mock.respostas = {
    skus_modelo: async () => ({ data: matrizOk, error: null }),
    skus_previa: async () => ({ data: { ...matrizOk, modo: "regerar", assinatura: ASS, erros: [], conflitos: [] }, error: null }),
    ref_regerar_previa: async () => ({ data: previaCrua(), error: null }),
  };
});

describe("CodigosSecao - botao Regerar REF", () => {
  it("interno + card editavel + rascunho limpo: botao habilitado; clicar mostra 'REF a gravar: NOVA (era ANTIGA)' e 'Desfazer previa'; NAO grava nada", async () => {
    montar();
    await espera(50);
    const b = botao("Regerar REF")!;
    expect(b.disabled).toBe(false);
    await clicar(b);
    expect(document.querySelector('[data-testid="regerar-ref-selo"]')?.textContent).toBe("REF a gravar: NOVA (era ANTIGA)");
    expect(botao("Desfazer prévia")).toBeTruthy();
    expect(botao("Regerar REF")!.disabled).toBe(true); // ja pendente
    expect(botao("Regerar SKUs")!.disabled).toBe(true); // exclusao mutua: o Regerar REF ja faz o plano 'regerar' dos SKUs
    expect(rpcSpy.mock.calls.some(([n]) => n === "regerar_ref_card" || n === "aplicar_skus_modelo")).toBe(false);
    await clicar(botao("Desfazer prévia")!);
    expect(document.querySelector('[data-testid="regerar-ref-selo"]')).toBeNull();
    expect(botao("Regerar REF")!.disabled).toBe(false);
  });

  it("REF MANUAL: abre o AlertDialog 'A REF atual (X) foi digitada a mao. Substituir por Y?'; Cancelar NAO inicia; Substituir inicia (com a confirmacao)", async () => {
    mock.respostas.ref_regerar_previa = async () => ({ data: previaCrua({ tipo_ref: "manual", ref_atual: "MEU-REF-1" }), error: null });
    montar();
    await espera(50);
    await clicar(botao("Regerar REF")!);
    expect(document.body.textContent).toContain("A REF atual (MEU-REF-1) foi digitada à mão. Substituir por NOVA?");
    expect(document.querySelector('[data-testid="regerar-ref-selo"]')).toBeNull(); // so depois de confirmar
    await clicar(botao("Cancelar")!);
    expect(document.querySelector('[data-testid="regerar-ref-selo"]')).toBeNull();
    expect(aGravarApi.atual().regerar).toBe(false);
    await clicar(botao("Regerar REF")!);
    await clicar(botao("Substituir REF")!);
    expect(document.querySelector('[data-testid="regerar-ref-selo"]')?.textContent).toBe("REF a gravar: NOVA (era MEU-REF-1)");
    expect(aGravarApi.atual().regerar).toBe(true);
  });

  it("REPLICA so avisa: com irmaos o aviso 'familia de N cards; os irmaos mantem a REF atual' aparece na previa", async () => {
    mock.respostas.ref_regerar_previa = async () => ({ data: previaCrua({ irmaos: 2 }), error: null });
    montar();
    await espera(50);
    await clicar(botao("Regerar REF")!);
    expect(document.querySelector('[data-testid="regerar-ref-irmaos"]')?.textContent).toBe("Este card faz parte de uma família de 3 cards; os irmãos mantêm a REF atual.");
  });

  it("previa de SKUs com conflitos: aviso 'N SKUs ficarao em conflito e nao serao regerados'", async () => {
    mock.respostas.skus_previa = async () => ({
      data: { ...matrizOk, modo: "regerar", assinatura: ASS, erros: [], conflitos: [{ mensagem: "SKU repetido" }, { mensagem: "SKU repetido" }] }, error: null,
    });
    montar();
    await espera(50);
    await clicar(botao("Regerar REF")!);
    for (let i = 0; i < 30 && !document.querySelector('[data-testid="regerar-ref-conflitos"]'); i++) await espera(50);
    expect(document.querySelector('[data-testid="regerar-ref-conflitos"]')?.textContent).toBe("2 SKUs ficarão em conflito e não serão regerados.");
  });

  it.each([
    ["rascunho sujo (categoria/sub1/REF diferentes das salvas)", { rascunhoLimpo: false }, /Salve a categoria, a subcategoria ou a REF/],
    ["so interno: revenda/importado nem mostram o botao", { origemInterno: false }, null],
    ["REF ainda nao visivel (etapa da REF)", { refVisivel: false }, null],
    ["card nao editavel (Explosao/Dev travado/trava da Integracao): botao desabilitado, sem texto de ajuda", { refEditavel: false }, "desabilitado"],
    ["sem permissao de SKU (Planejamento)/SKUs travados: botao desabilitado", { podeEditarSkus: false }, "desabilitado"],
  ])("%s", async (_nome, props, esperado) => {
    montar(props as Partial<Props>);
    await espera(50);
    const b = botao("Regerar REF");
    if (esperado === null) {
      expect(b).toBeUndefined();
      expect(document.querySelector('[data-testid="regerar-ref"]')).toBeNull();
    } else if (esperado === "desabilitado") {
      expect(b!.disabled).toBe(true);
      expect(b!.title).toMatch(/\S/);
    } else {
      expect(b!.disabled).toBe(true);
      expect(document.querySelector('[data-testid="regerar-ref"]')?.textContent).toMatch(esperado);
    }
  });

  it("falha na consulta (recusa do servidor) vira toast e nada fica pendente", async () => {
    mock.respostas.ref_regerar_previa = async () => ({ data: previaCrua({ pode: false, motivo: "pulado_integracao", ref_nova: null, muda: false }), error: null });
    montar();
    await espera(50);
    await clicar(botao("Regerar REF")!);
    expect(toastMock.error).toHaveBeenCalledWith("Produto Integrável/Integrado na Integração: a REF e os SKUs ficam travados.");
    expect(document.querySelector('[data-testid="regerar-ref-selo"]')).toBeNull();
  });
});
