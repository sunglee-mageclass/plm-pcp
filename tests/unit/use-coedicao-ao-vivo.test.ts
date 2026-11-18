// @vitest-environment happy-dom
// useCoedicaoAoVivo (co-edicao ao vivo, Onda 3, Task 3): NAO abre canal - usa o que o useColabRegistro ja abriu (`realtime:${chave}`).
// RENDER de verdade (react-dom/client + happy-dom, padrao do projeto - sem testing-library), supabase.getChannels() mockado com um canal falso.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Canal Supabase falso: captura os handlers de "broadcast" por evento e registra os sends.
const mock = vi.hoisted(() => ({ canais: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { getChannels: () => mock.canais },
}));

import { useCoedicaoAoVivo } from "@/hooks/useCoedicaoAoVivo";
import { EXPIRACAO_LOCK_MS } from "@/lib/colab/coedicao";

const sends: any[] = [];
let handlers: Record<string, (msg: any) => void> = {};
const fakeChannel = {
  topic: "realtime:colab:modelo:M1",
  on(_type: string, filter: { event: string }, cb: (msg: any) => void) { handlers[filter.event] = cb; return this; },
  send(msg: any) { sends.push(msg); return Promise.resolve("ok"); },
};

type Api = ReturnType<typeof useCoedicaoAoVivo>;
let api: Api;
function Probe({ chave, meuKey }: { chave: string | null; meuKey: string }) {
  api = useCoedicaoAoVivo({ chave, meuKey });
  return null;
}
const limpezas: (() => void)[] = [];
function montar(chave: string | null = "colab:modelo:M1", meuKey = "a::1") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(createElement(Probe, { chave, meuKey })); });
  limpezas.push(() => { act(() => { root.unmount(); }); container.remove(); });
}
function receber(event: string, payload: any) {
  act(() => { handlers[event]?.({ payload }); });
}
const avancar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { sends.length = 0; handlers = {}; mock.canais = [fakeChannel]; vi.useFakeTimers(); });
afterEach(() => {
  for (const f of limpezas.splice(0)) { try { f(); } catch { /* ja desmontado */ } }
  vi.useRealTimers();
});

describe("useCoedicaoAoVivo", () => {
  it("sem chave -> mapas vazios e no-op (degradacao graciosa)", () => {
    montar(null);
    expect(api.locks).toEqual([]);
    expect(api.valorAoVivoPorPath).toEqual({});
    act(() => api.anunciarLock("lbl:nome")); // nao lanca
    act(() => api.emitirValor("lbl:nome", "x"));
    expect(sends.length).toBe(0);
  });

  it("chave sem canal aberto -> vazio e no-op, sem lancar", () => {
    mock.canais = [];
    montar();
    expect(api.locks).toEqual([]);
    act(() => api.anunciarLock("lbl:nome"));
    act(() => api.emitirValor("lbl:nome", "x"));
    avancar(5_000);
    expect(sends.length).toBe(0);
  });

  it("anunciarLock envia broadcast campoLock com minha key/path/ts", () => {
    montar();
    act(() => api.anunciarLock("lbl:nome"));
    const msg = sends.find((s) => s.event === "campoLock");
    expect(msg.type).toBe("broadcast");
    expect(msg.payload).toMatchObject({ key: "a::1", path: "lbl:nome" });
    expect(typeof msg.payload.ts).toBe("number");
  });

  it("transporta o path como veio (id:/name:/lbl:) sem assumir prefixo", () => {
    montar();
    act(() => api.anunciarLock("id:campo-x"));
    expect(sends.find((s) => s.event === "campoLock").payload.path).toBe("id:campo-x");
  });

  it("anunciarLock(null) solta o lock e para o heartbeat", () => {
    montar();
    act(() => api.anunciarLock("lbl:nome"));
    act(() => api.anunciarLock(null));
    expect(sends.at(-1).payload).toMatchObject({ key: "a::1", path: null });
    sends.length = 0;
    avancar(9_000);
    expect(sends.length).toBe(0);
  });

  it("recebe campoLock de um par -> entra em locks", () => {
    montar();
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    expect(api.locks.some((l) => l.key === "z::9" && l.path === "lbl:nome")).toBe(true);
  });

  it("ignora meus proprios eventos (key == meuKey)", () => {
    montar();
    receber("campoLock", { key: "a::1", path: "lbl:nome", ts: Date.now() });
    receber("valorAoVivo", { key: "a::1", path: "lbl:nome", valor: "eco" });
    expect(api.locks).toEqual([]);
    expect(api.valorAoVivoPorPath).toEqual({});
  });

  it("novo campoLock do mesmo par substitui o anterior", () => {
    montar();
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    receber("campoLock", { key: "z::9", path: "lbl:ref", ts: Date.now() });
    expect(api.locks.map((l) => l.path)).toEqual(["lbl:ref"]);
  });

  it("campoLock com path:null remove o lock daquele par", () => {
    montar();
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    receber("campoLock", { key: "z::9", path: null, ts: Date.now() });
    expect(api.locks.some((l) => l.key === "z::9")).toBe(false);
  });

  it("valorAoVivo de um par entra em valorAoVivoPorPath", () => {
    montar();
    receber("valorAoVivo", { key: "z::9", path: "lbl:nome", valor: "Vestido" });
    expect(api.valorAoVivoPorPath["lbl:nome"]).toBe("Vestido");
  });

  it("emitirValor envia valorAoVivo com throttle por path (1o ja, rajada agrupada, ultimo valor entregue)", () => {
    montar();
    act(() => api.emitirValor("lbl:nome", "a"));
    act(() => api.emitirValor("lbl:nome", "ab"));
    act(() => api.emitirValor("lbl:nome", "abc"));
    const envios = () => sends.filter((s) => s.event === "valorAoVivo").map((s) => s.payload);
    expect(envios()).toEqual([{ key: "a::1", path: "lbl:nome", valor: "a" }]);
    avancar(150);
    expect(envios().at(-1)).toEqual({ key: "a::1", path: "lbl:nome", valor: "abc" });
    // outro path tem throttle proprio: sai na hora
    act(() => api.emitirValor("lbl:ref", "x"));
    expect(envios().at(-1)).toEqual({ key: "a::1", path: "lbl:ref", valor: "x" });
  });

  it("heartbeat re-anuncia meu lock enquanto houver path ativo", () => {
    montar();
    act(() => api.anunciarLock("lbl:nome"));
    sends.length = 0;
    avancar(4_100);
    expect(sends.some((s) => s.event === "campoLock" && s.payload.path === "lbl:nome")).toBe(true);
  });

  it("lock de outro expira sozinho apos ~10s mesmo sem novo evento", () => {
    montar();
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() });
    expect(api.locks.length).toBe(1);
    avancar(EXPIRACAO_LOCK_MS - 500);
    expect(api.locks.length).toBe(1); // ainda vivo antes do limite
    avancar(500 + 2_000 + 500); // limite + latencia do varredor (2 s) + folga
    expect(api.locks.some((l) => l.key === "z::9")).toBe(false);
  });

  it("clock skew: o ts do remetente e ignorado, vale o relogio local do receptor", () => {
    montar();
    receber("campoLock", { key: "z::9", path: "lbl:nome", ts: Date.now() - 60_000 }); // remetente 60 s atrasado
    expect(api.locks[0].ts).toBe(Date.now());
    avancar(2_500);
    expect(api.locks.length).toBe(1); // nao nasce expirado
    receber("campoLock", { key: "y::8", path: "lbl:ref", ts: Date.now() + 60_000 }); // remetente 60 s adiantado
    avancar(EXPIRACAO_LOCK_MS + 2_500);
    expect(api.locks.length).toBe(0); // e expira (nao fica eterno)
  });

  it("handlers viram no-op depois do unmount (sem setState zumbi)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    montar();
    const h = handlers["campoLock"];
    limpezas.splice(0).forEach((f) => f());
    expect(() => h({ payload: { key: "z::9", path: "lbl:nome", ts: Date.now() } })).not.toThrow();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("desmontar com path ativo avisa os pares (campoLock path:null)", () => {
    montar();
    act(() => api.anunciarLock("lbl:nome"));
    sends.length = 0;
    limpezas.splice(0).forEach((f) => f());
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ event: "campoLock", payload: { key: "a::1", path: null } });
  });

  it("desmontar SEM path ativo nao envia nada", () => {
    montar();
    sends.length = 0;
    limpezas.splice(0).forEach((f) => f());
    expect(sends).toHaveLength(0);
  });

  it("canal que sobe DEPOIS do 1o render (corrida com o useColabRegistro) passa a funcionar", () => {
    mock.canais = [];
    montar();
    act(() => api.anunciarLock("lbl:nome"));
    expect(sends.length).toBe(0); // no-op sem canal
    mock.canais = [fakeChannel];
    avancar(4_100); // o heartbeat re-tenta getChannels() e o efeito anexa os handlers
    expect(sends.some((s) => s.event === "campoLock" && s.payload.path === "lbl:nome")).toBe(true);
    receber("campoLock", { key: "z::9", path: "lbl:ref", ts: Date.now() });
    expect(api.locks.some((l) => l.key === "z::9")).toBe(true);
  });
});
