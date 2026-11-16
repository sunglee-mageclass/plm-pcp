// @vitest-environment happy-dom
// "Regerar REF" por card - o estado "REF a gravar" (useRegerarRef) + a gravacao atomica (useSkusModelo.aplicarRegerarRef). RENDER de verdade (react-dom/client +
// happy-dom), supabase.rpc mockado. Pinos: a previa NAO grava (so o Salvar); entra no "nao salvo" (aGravar.regerar); REF manual so inicia com a confirmacao;
// digitar a REF/categoria/sub1 cancela; exclusao mutua; o Salvar chama a RPC atomica NO LUGAR de aplicar_skus_modelo, com a assinatura da previa vista.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { nadaAGravar } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { useSkusAGravar, useSkusModelo } from "@/components/planejamento/planejamento-detail/codigos/useSkusModelo";
import { useRegerarRef } from "@/components/planejamento/planejamento-detail/codigos/useRegerarRef";
import { MSG_REF_DESATUALIZADA, MSG_REF_PREVIA_CALCULANDO, TEXTO_MOTIVO_REF, TEXTO_REF_JA_NO_FORMATO, TEXTO_REF_PREVIA_CANCELADA } from "@/lib/ref-regerar";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ASS = "b".repeat(32);
const matrizOk = { status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "numero", linhas: [], faltas: [], avisos: [] };
const previaCrua = (p: Record<string, unknown> = {}) => ({
  pode: true, motivo: null, ref_atual: "ANTIGA", ref_auto_atual: "ANTIGA", ref_nova: "NOVA", tipo_ref: "automatica", muda: true, irmaos: 0, ...p,
});
const mock = vi.hoisted(() => ({ respostas: {} as Record<string, () => Promise<{ data: unknown; error: unknown }>> }));
const rpcSpy = vi.hoisted(() => vi.fn((nome: string, _args: unknown) => mock.respostas[nome]?.() ?? Promise.resolve({ data: null, error: null })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) } }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

type Api = { aGravar: ReturnType<typeof useSkusAGravar>; regerarRef: ReturnType<typeof useRegerarRef>; skus: ReturnType<typeof useSkusModelo> };
let api: Api;
const entrada0 = { ref: "ANTIGA", categoria: "c1", sub1: "s1" };
function Harness({ entrada }: { entrada: { ref: string; categoria: string | null; sub1: string | null } }) {
  const aGravar = useSkusAGravar();
  const regerarRef = useRegerarRef({ modeloId: "m1", aGravar, entrada });
  const skus = useSkusModelo("m1", true, true, { refPrevia: regerarRef.pendente?.refNova ?? entrada.ref, tamanhoTipo: "numero", aGravar });
  api = { aGravar, regerarRef, skus };
  return null;
}
const limpezas: (() => void)[] = [];
afterEach(() => { for (const f of limpezas.splice(0)) { try { f(); } catch { /* ja desmontado */ } } }); // um teste que falha no meio nao deixa o componente vivo
function montar(entrada = entrada0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = (e: typeof entrada) => act(() => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { entrada: e }))); });
  render(entrada);
  const unmount = () => { act(() => { root.unmount(); }); container.remove(); };
  limpezas.push(unmount);
  return { render, unmount };
}
const espera = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** Espera a previa de SKUs da REF NOVA chegar: o `useSkusModelo` atrasa a troca da entrada em 300 ms (a REF e digitada letra a letra) e a RPC vem depois. */
const esperaPreviaAtual = async () => { for (let i = 0; i < 40 && !api.skus.previaAtual; i++) await espera(50); await espera(50); };
const chamadas = (nome: string) => rpcSpy.mock.calls.filter(([n]) => n === nome);

beforeEach(() => {
  rpcSpy.mockClear();
  Object.values(toastMock).forEach((f) => f.mockClear());
  mock.respostas = {
    skus_modelo: async () => ({ data: matrizOk, error: null }),
    skus_previa: async () => ({ data: { ...matrizOk, modo: "regerar", assinatura: ASS, erros: [], conflitos: [] }, error: null }),
    ref_regerar_previa: async () => ({ data: previaCrua(), error: null }),
    regerar_ref_card: async () => ({ data: { ref: "NOVA", ref_auto: "NOVA", rev: 5, skus: matrizOk, criados: 0, atualizados: 4, removidos: 0, manuais: 0, conflitos: [] }, error: null }),
  };
});

describe("useRegerarRef - a REF a gravar e a previa (nada grava antes do Salvar)", () => {
  it("REF automatica: consulta o servidor, entra 'a gravar' (liga o Regerar da previa de SKUs = 'nao salvo') e NAO chama a gravacao", async () => {
    const v = montar();
    let r: any;
    await act(async () => { r = await api.regerarRef.consultar(); });
    expect(r).toEqual({ tipo: "iniciado" });
    expect(chamadas("ref_regerar_previa")[0][1]).toEqual({ _modelo_id: "m1" });
    expect(api.regerarRef.pendente).toMatchObject({ refNova: "NOVA", refAntes: "ANTIGA", confirmaManual: false, irmaos: 0, capturado: entrada0 });
    expect(api.aGravar.aGravar.regerar).toBe(true);
    expect(nadaAGravar(api.aGravar.aGravar)).toBe(false); // = o "dirty" do Sheet (selo ambar) vem de graca
    expect(chamadas("regerar_ref_card")).toHaveLength(0);
    await esperaPreviaAtual(); // a previa de SKUs sobe com a REF NOVA (e o modo regerar)
    const p = chamadas("skus_previa").map(([, a]) => a as any).at(-1);
    expect(p).toMatchObject({ _modelo_id: "m1", _ref: "NOVA", _tamanho_tipo: "numero", _modo: "regerar" });
    v.unmount();
  });

  it("REF MANUAL: a consulta devolve 'confirmar' e NAO inicia; so iniciar(previa, true) (apos o AlertDialog) liga a previa, com o flag de confirmacao", async () => {
    mock.respostas.ref_regerar_previa = async () => ({ data: previaCrua({ tipo_ref: "manual", ref_atual: "MEU-REF", irmaos: 2 }), error: null });
    const v = montar();
    let r: any;
    await act(async () => { r = await api.regerarRef.consultar(); });
    expect(r.tipo).toBe("confirmar");
    expect(r.previa).toMatchObject({ tipoRef: "manual", refAtual: "MEU-REF", refNova: "NOVA" });
    expect(api.regerarRef.pendente).toBeNull();
    expect(api.aGravar.aGravar.regerar).toBe(false);
    act(() => { api.regerarRef.iniciar(r.previa, true); });
    expect(api.regerarRef.pendente).toMatchObject({ confirmaManual: true, refAntes: "MEU-REF", irmaos: 2 });
    expect(api.aGravar.aGravar.regerar).toBe(true);
    v.unmount();
  });

  it("recusa do servidor (ex.: sem numero) e 'ja no Formato' viram toast e nada fica pendente; erro de rede tambem", async () => {
    const v = montar();
    mock.respostas.ref_regerar_previa = async () => ({ data: previaCrua({ pode: false, motivo: "sem_numero", ref_nova: null, muda: false }), error: null });
    await act(async () => { await api.regerarRef.consultar(); });
    expect(toastMock.error).toHaveBeenLastCalledWith(TEXTO_MOTIVO_REF.sem_numero);
    mock.respostas.ref_regerar_previa = async () => ({ data: previaCrua({ muda: false, ref_nova: "ANTIGA" }), error: null });
    await act(async () => { await api.regerarRef.consultar(); });
    expect(toastMock.info).toHaveBeenLastCalledWith(TEXTO_REF_JA_NO_FORMATO);
    mock.respostas.ref_regerar_previa = async () => ({ data: null, error: { code: "42501", message: "sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento" } });
    await act(async () => { await api.regerarRef.consultar(); });
    expect(toastMock.error).toHaveBeenCalledTimes(2);
    expect(api.regerarRef.pendente).toBeNull();
    expect(api.aGravar.aGravar.regerar).toBe(false);
    v.unmount();
  });

  it("digitar a REF, ou mudar categoria/sub1, no rascunho CANCELA a previa (toast) e desliga o Regerar de SKUs; mudar um campo de fora nao cancela", async () => {
    const v = montar();
    await act(async () => { await api.regerarRef.consultar(); });
    expect(api.regerarRef.pendente).not.toBeNull();
    v.render({ ...entrada0 }); // mesma entrada em objeto novo: nao cancela
    expect(api.regerarRef.pendente).not.toBeNull();
    v.render({ ref: "ANTIGA2", categoria: "c1", sub1: "s1" });
    expect(api.regerarRef.pendente).toBeNull();
    expect(api.aGravar.aGravar.regerar).toBe(false);
    expect(toastMock.info).toHaveBeenCalledWith(TEXTO_REF_PREVIA_CANCELADA);
    v.render(entrada0);
    await act(async () => { await api.regerarRef.consultar(); });
    v.render({ ...entrada0, categoria: "c2" });
    expect(api.regerarRef.pendente).toBeNull();
    v.render(entrada0);
    await act(async () => { await api.regerarRef.consultar(); });
    v.render({ ...entrada0, sub1: null });
    expect(api.regerarRef.pendente).toBeNull();
    v.unmount();
  });

  it("durante a gravacao (marcarGravando) o eco do Realtime que troca a REF do rascunho NAO cancela a previa", async () => {
    const v = montar();
    await act(async () => { await api.regerarRef.consultar(); });
    act(() => { api.regerarRef.marcarGravando(true); });
    v.render({ ...entrada0, ref: "NOVA" });
    expect(api.regerarRef.pendente).not.toBeNull();
    expect(toastMock.info).not.toHaveBeenCalledWith(TEXTO_REF_PREVIA_CANCELADA);
    v.unmount();
  });

  it("'Desfazer previa' pelo botao do banner dos SKUs (aGravar.desfazerPrevia) leva a REF a gravar junto; desfazer() faz o mesmo pelo lado da REF", async () => {
    const v = montar();
    await act(async () => { await api.regerarRef.consultar(); });
    act(() => { api.aGravar.desfazerPrevia(); });
    expect(api.regerarRef.pendente).toBeNull();
    await act(async () => { await api.regerarRef.consultar(); });
    act(() => { api.regerarRef.desfazer(); });
    expect(api.regerarRef.pendente).toBeNull();
    expect(api.aGravar.aGravar.regerar).toBe(false);
    v.unmount();
  });
});

describe("useSkusModelo.aplicarRegerarRef - o Salvar grava a REF + SKUs numa RPC ATOMICA (no lugar de aplicar_skus_modelo)", () => {
  it("com a previa de SKUs vista: chama regerar_ref_card com a REF esperada, a confirmacao e a ASSINATURA da previa; limpa o 'a gravar'; nunca chama aplicar_skus_modelo", async () => {
    const v = montar();
    await act(async () => { await api.regerarRef.consultar(); });
    await esperaPreviaAtual();
    let r: "ok" | "falhou" = "falhou";
    await act(async () => { r = await api.skus.aplicarRegerarRef({ refNova: "NOVA", confirmaManual: true }); });
    expect(r).toBe("ok");
    expect(chamadas("regerar_ref_card")).toHaveLength(1);
    expect(chamadas("regerar_ref_card")[0][1]).toEqual({ _modelo_id: "m1", _ref_esperada: "NOVA", _confirma_manual: true, _assinatura: ASS });
    expect(chamadas("aplicar_skus_modelo")).toHaveLength(0);
    expect(nadaAGravar(api.aGravar.aGravar)).toBe(true);
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("REF regerada: NOVA."));
    v.unmount();
  });

  it("previa de SKUs ainda calculando (entrada diferente da atual): 'falhou', texto proprio e NENHUMA RPC de gravacao", async () => {
    const v = montar();
    await act(async () => { await api.regerarRef.consultar(); }); // sem esperar o debounce: a previa da REF nova ainda nao chegou
    let r: "ok" | "falhou" = "ok";
    await act(async () => { r = await api.skus.aplicarRegerarRef({ refNova: "NOVA", confirmaManual: false }); });
    expect(r).toBe("falhou");
    expect(toastMock.error).toHaveBeenCalledWith(MSG_REF_PREVIA_CALCULANDO);
    expect(chamadas("regerar_ref_card")).toHaveLength(0);
    v.unmount();
  });

  it("P0409 do servidor (REF/Formato/SKUs mudaram desde a previa): 'falhou' com o texto da previa desatualizada; o pendente PERMANECE (a previa e refeita)", async () => {
    mock.respostas.regerar_ref_card = async () => ({ data: null, error: { code: "P0409", message: "previa_desatualizada: ref" } });
    const v = montar();
    await act(async () => { await api.regerarRef.consultar(); });
    await esperaPreviaAtual();
    let r: "ok" | "falhou" = "ok";
    await act(async () => { r = await api.skus.aplicarRegerarRef({ refNova: "NOVA", confirmaManual: false }); });
    expect(r).toBe("falhou");
    expect(toastMock.error).toHaveBeenCalledWith(MSG_REF_DESATUALIZADA);
    expect(api.regerarRef.pendente).not.toBeNull();
    expect(api.aGravar.aGravar.regerar).toBe(true);
    v.unmount();
  });
});
