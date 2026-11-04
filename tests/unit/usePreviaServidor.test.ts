// @vitest-environment happy-dom
// usePreviaServidor (Salvar por card, Onda 2 da Camada intermediária) — Tarefa 4 do plano `2026-11-04-salvar-por-card-tecido`.
// Sem @testing-library/react: mini-harness com react-dom/client + act (mesmo padrão de `card-drafts.test.ts`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { usePreviaServidor } from "@/hooks/usePreviaServidor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Res = { afetados: number; assinatura: string };
type Props = { args: Record<string, unknown>; habilitado: boolean };

function montar(inicial: Props) {
  const out: { current: ReturnType<typeof usePreviaServidor<Res>> | undefined } = { current: undefined };
  function Probe(p: Props) {
    out.current = usePreviaServidor<Res>({ rpc: "variante_tecido_preco_previa", args: p.args, habilitado: p.habilitado, atrasoMs: 300 });
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (p: Props) => act(() => { root.render(createElement(Probe, p)); });
  render(inicial);
  return {
    r: out as { current: NonNullable<typeof out.current> },
    render,
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

const avancar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("usePreviaServidor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { afetados: 3, assinatura: "abc" }, error: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("após o atraso chama a RPC e expõe resultado + assinatura", async () => {
    const { r, unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    expect(rpc).not.toHaveBeenCalled(); // ainda no atraso
    expect(r.current.resultado).toBeNull();
    await avancar(299);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("variante_tecido_preco_previa", { _id: "v1", _preco: 10 });
    expect(r.current.resultado?.afetados).toBe(3);
    expect(r.current.assinatura).toBe("abc");
    expect(r.current.carregando).toBe(false);
    unmount();
  });

  it("mudar os args cancela a chamada pendente e dispara uma nova (só a última vale)", async () => {
    const { r, render, unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(200);
    render({ args: { _id: "v1", _preco: 11 }, habilitado: true }); // reinicia o atraso
    await avancar(200);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(100);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith("variante_tecido_preco_previa", { _id: "v1", _preco: 11 });

    rpc.mockResolvedValue({ data: { afetados: 5, assinatura: "xyz" }, error: null });
    render({ args: { _id: "v1", _preco: 12 }, habilitado: true });
    await avancar(300);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r.current.resultado?.afetados).toBe(5);
    expect(r.current.assinatura).toBe("xyz");
    unmount();
  });

  it("args novos com o MESMO conteúdo (objeto recriado) não disparam nova chamada", async () => {
    const { render, unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(300);
    expect(rpc).toHaveBeenCalledTimes(1);
    render({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(1000);
    expect(rpc).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("resposta de uma chamada já substituída é ignorada", async () => {
    let soltar!: (v: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((res) => { soltar = res; }));
    const { r, render, unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(300); // 1ª chamada em voo
    rpc.mockResolvedValue({ data: { afetados: 7, assinatura: "nova" }, error: null });
    render({ args: { _id: "v1", _preco: 20 }, habilitado: true });
    await avancar(300);
    expect(r.current.assinatura).toBe("nova");
    await act(async () => { soltar({ data: { afetados: 1, assinatura: "velha" }, error: null }); });
    expect(r.current.assinatura).toBe("nova"); // a velha não sobrescreve
    unmount();
  });

  it("habilitado:false não chama a RPC e zera o resultado", async () => {
    const { r, render, unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: false });
    await avancar(1000);
    expect(rpc).not.toHaveBeenCalled();
    expect(r.current.resultado).toBeNull();
    expect(r.current.carregando).toBe(false);

    render({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(300);
    expect(r.current.assinatura).toBe("abc");
    render({ args: { _id: "v1", _preco: 10 }, habilitado: false });
    await avancar(0);
    expect(r.current.resultado).toBeNull();
    expect(r.current.assinatura).toBeNull();
    unmount();
  });

  it("erro da RPC (ou exceção) não quebra: resultado null", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { r, render, unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(300);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r.current.resultado).toBeNull();
    expect(r.current.assinatura).toBeNull();
    expect(r.current.carregando).toBe(false);

    rpc.mockRejectedValue(new Error("rede"));
    render({ args: { _id: "v1", _preco: 99 }, habilitado: true });
    await avancar(300);
    expect(r.current.resultado).toBeNull();
    expect(r.current.carregando).toBe(false);
    unmount();
  });

  it("desmontar cancela o timer pendente", async () => {
    const { unmount } = montar({ args: { _id: "v1", _preco: 10 }, habilitado: true });
    await avancar(100);
    unmount();
    await avancar(1000);
    expect(rpc).not.toHaveBeenCalled();
  });
});
