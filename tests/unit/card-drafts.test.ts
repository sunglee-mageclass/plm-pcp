// @vitest-environment happy-dom
// Infra de rascunho por card (Salvar por card, Onda 2 da Camada intermediária) — Tarefa 1 do plano
// `2026-11-04-salvar-por-card-tecido`. `@testing-library/react` NÃO está instalado: o harness abaixo monta o hook
// com react-dom/client + act (mesmo padrão de `modelo-grade-section.test.ts`). O arquivo é `.ts`, então sem JSX.
import { describe, it, expect, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CardDraftsProvider, useCardDrafts } from "@/components/shared/card-drafts/CardDraftsProvider";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type V = { nome: string; preco: number | null };

function renderHooks<R extends Record<string, () => unknown>>(hooks: R) {
  const out: Record<string, { current: any }> = {};
  for (const k of Object.keys(hooks)) out[k] = { current: undefined };
  function Probe() {
    for (const k of Object.keys(hooks)) out[k].current = hooks[k]();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(createElement(CardDraftsProvider, null, createElement(Probe) as ReactNode)); });
  return {
    r: out as { [K in keyof R]: { current: ReturnType<R[K]> } },
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

describe("useCardDraft + CardDraftsProvider", () => {
  it("patch marca dirty só no campo tocado; salvar manda só os tocados; descartar volta à base", async () => {
    const salvarFn = vi.fn().mockResolvedValue(undefined);
    const base: V = { nome: "Azul", preco: 10 };
    const { r, unmount } = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });

    expect(r.c.current.dirty).toBe(false);
    act(() => r.c.current.patch("preco", 12));
    expect(r.c.current.dirty).toBe(true);
    expect(r.c.current.valor.preco).toBe(12);

    await act(async () => { await r.c.current.salvar(); });
    expect(salvarFn).toHaveBeenCalledWith({ preco: 12 }, base); // só o campo tocado
    expect(r.c.current.dirty).toBe(false); // limpo após salvar

    act(() => r.c.current.patch("nome", "Marinho"));
    act(() => r.c.current.descartar());
    expect(r.c.current.valor.nome).toBe("Azul"); // voltou à base
    expect(r.c.current.dirty).toBe(false);
    unmount();
  });

  it("voltar ao valor da base tira o campo dos tocados (dirty some)", () => {
    const base: V = { nome: "Azul", preco: 10 };
    const salvarFn = vi.fn().mockResolvedValue(undefined);
    const { r, unmount } = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });
    act(() => r.c.current.patch("preco", 11));
    expect(r.c.current.dirty).toBe(true);
    act(() => r.c.current.patch("preco", 10));
    expect(r.c.current.dirty).toBe(false);
    unmount();
  });

  it("2º card: nSujos acompanha os cards sujos; salvarTodos salva só os sujos; descartarTodos limpa", async () => {
    const baseA: V = { nome: "A", preco: 1 };
    const baseB: V = { nome: "B", preco: 2 };
    const fnA = vi.fn().mockResolvedValue(undefined);
    const fnB = vi.fn().mockResolvedValue(undefined);
    const { r, unmount } = renderHooks({
      a: () => useCardDraft<V>({ id: "a", base: baseA, salvarFn: fnA }),
      b: () => useCardDraft<V>({ id: "b", base: baseB, salvarFn: fnB }),
      ctx: () => useCardDrafts(),
    });

    expect(r.ctx.current.nSujos).toBe(0);
    act(() => r.a.current.patch("preco", 5));
    expect(r.ctx.current.nSujos).toBe(1);
    act(() => r.b.current.patch("nome", "BB"));
    expect(r.ctx.current.nSujos).toBe(2);

    // salvarTodos: ambos sujos -> ok 2; depois zera
    let res: { ok: number; erro: number } | undefined;
    await act(async () => { res = await r.ctx.current.salvarTodos(); });
    expect(res).toEqual({ ok: 2, erro: 0 });
    expect(fnA).toHaveBeenCalledWith({ preco: 5 }, baseA);
    expect(fnB).toHaveBeenCalledWith({ nome: "BB" }, baseB);
    expect(r.ctx.current.nSujos).toBe(0);

    // descartarTodos: suja de novo e descarta
    act(() => r.a.current.patch("nome", "AA"));
    act(() => r.b.current.patch("preco", 9));
    expect(r.ctx.current.nSujos).toBe(2);
    act(() => r.ctx.current.descartarTodos());
    expect(r.ctx.current.nSujos).toBe(0);
    expect(r.a.current.valor.nome).toBe("A");
    expect(r.b.current.valor.preco).toBe(2);
    unmount();
  });

  it("salvarTodos conta erro quando um card falha e mantém o card sujo", async () => {
    const baseA: V = { nome: "A", preco: 1 };
    const baseB: V = { nome: "B", preco: 2 };
    const fnA = vi.fn().mockResolvedValue(undefined);
    const fnB = vi.fn().mockRejectedValue(new Error("falhou"));
    const { r, unmount } = renderHooks({
      a: () => useCardDraft<V>({ id: "a", base: baseA, salvarFn: fnA }),
      b: () => useCardDraft<V>({ id: "b", base: baseB, salvarFn: fnB }),
      ctx: () => useCardDrafts(),
    });
    act(() => r.a.current.patch("preco", 5));
    act(() => r.b.current.patch("preco", 7));
    let res: { ok: number; erro: number } | undefined;
    await act(async () => { res = await r.ctx.current.salvarTodos(); });
    expect(res).toEqual({ ok: 1, erro: 1 });
    expect(r.ctx.current.nSujos).toBe(1);
    expect(r.b.current.dirty).toBe(true);
    unmount();
  });

  // ---- Regressões da revisão (round 1) ----

  it("I1: salvarTodos com salvarFn INLINE salva cada card UMA vez e conta certo", async () => {
    const baseA: V = { nome: "A", preco: 1 };
    const baseB: V = { nome: "B", preco: 2 };
    const chamadas: string[] = [];
    const { r, unmount } = renderHooks({
      // salvarFn nova a cada render (como na tela) — antes duplicava A e B e devolvia {ok:2, erro:2}
      a: () => useCardDraft<V>({ id: "a", base: baseA, salvarFn: async () => { await new Promise((ok) => setTimeout(ok, 0)); chamadas.push("a"); } }),
      b: () => useCardDraft<V>({ id: "b", base: baseB, salvarFn: async () => { await new Promise((ok) => setTimeout(ok, 0)); chamadas.push("b"); } }),
      ctx: () => useCardDrafts(),
    });
    act(() => r.a.current.patch("preco", 5));
    act(() => r.b.current.patch("preco", 7));
    // FORA do act de propósito: o React re-renderiza (e os efeitos re-registram os cards) NO MEIO do laço do
    // salvarTodos, como na tela real — dentro de um único act() as atualizações ficam represadas e o bug não aparece.
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    let res: { ok: number; erro: number } | undefined;
    try { res = await r.ctx.current.salvarTodos(); } finally { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; }
    await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
    expect(chamadas.sort()).toEqual(["a", "b"]);
    expect(res).toEqual({ ok: 2, erro: 0 });
    expect(r.ctx.current.nSujos).toBe(0);
    unmount();
  });

  it("I1: descartarTodos com cards sujos descarta cada um e zera nSujos", () => {
    const baseA: V = { nome: "A", preco: 1 }; // base ESTÁVEL (contrato do hook)
    const { r, unmount } = renderHooks({
      a: () => useCardDraft<V>({ id: "a", base: baseA, salvarFn: async () => {} }),
      ctx: () => useCardDrafts(),
    });
    act(() => r.a.current.patch("preco", 5));
    expect(r.ctx.current.nSujos).toBe(1);
    act(() => r.ctx.current.descartarTodos());
    expect(r.ctx.current.nSujos).toBe(0);
    unmount();
  });

  it("I2: edição feita com o salvar EM VOO continua tocada (não é descartada em silêncio)", async () => {
    const base: V = { nome: "Azul", preco: 10 };
    const enviados: Array<Partial<V>> = [];
    let resolve!: () => void;
    const salvarFn = vi.fn((m: Partial<V>) => { enviados.push(m); return new Promise<void>((res) => { resolve = res; }); });
    const { r, unmount } = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });

    act(() => r.c.current.patch("preco", 12));
    let p!: Promise<void>;
    act(() => { p = r.c.current.salvar(); });
    expect(r.c.current.salvando).toBe(true);
    act(() => r.c.current.patch("nome", "Marinho")); // em voo
    resolve();
    await act(async () => { await p; });

    expect(r.c.current.dirty).toBe(true); // nome segue tocado
    expect(r.c.current.valor.nome).toBe("Marinho");
    // o próximo salvar manda SÓ o que ficou pendente
    const salvarFn2Promise = r.c.current.salvar();
    resolve();
    await act(async () => { await salvarFn2Promise; });
    expect(enviados).toEqual([{ preco: 12 }, { nome: "Marinho" }]);
    expect(r.c.current.dirty).toBe(false);
    unmount();
  });

  it("I2: campo enviado que voltou ao valor ANTIGO da base em voo fica tocado (difere da base nova)", async () => {
    const base: V = { nome: "Azul", preco: 10 };
    let resolve!: () => void;
    const salvarFn = vi.fn(() => new Promise<void>((res) => { resolve = res; }));
    const { r, unmount } = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });
    act(() => r.c.current.patch("preco", 12));
    let p!: Promise<void>;
    act(() => { p = r.c.current.salvar(); });
    act(() => r.c.current.patch("preco", 10)); // desfez em voo
    resolve();
    await act(async () => { await p; });
    expect(r.c.current.dirty).toBe(true);
    expect(r.c.current.valor.preco).toBe(10);
    unmount();
  });

  it("I3: depois de salvar, a base local é o valor salvo (voltar ao 10 suja; voltar ao 12 limpa; descartar volta ao 12)", async () => {
    const base: V = { nome: "Azul", preco: 10 };
    const salvarFn = vi.fn().mockResolvedValue(undefined);
    const { r, unmount } = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });
    act(() => r.c.current.patch("preco", 12));
    await act(async () => { await r.c.current.salvar(); });
    expect(r.c.current.dirty).toBe(false);

    act(() => r.c.current.patch("preco", 10)); // base agora é 12: 10 é mudança
    expect(r.c.current.dirty).toBe(true);
    act(() => r.c.current.patch("preco", 12));
    expect(r.c.current.dirty).toBe(false);

    act(() => r.c.current.patch("preco", 3));
    act(() => r.c.current.descartar());
    expect(r.c.current.valor.preco).toBe(12); // não volta ao 10 antigo
    expect(salvarFn).toHaveBeenCalledWith({ preco: 12 }, base);
    unmount();
  });

  it("I3: base NOVA vinda da tela (refetch) re-ancora o card limpo", () => {
    const salvarFn = vi.fn().mockResolvedValue(undefined);
    let base: V = { nome: "Azul", preco: 10 };
    const { r, unmount } = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });
    expect(r.c.current.valor.preco).toBe(10);
    base = { nome: "Azul", preco: 99 };
    // força re-render do Probe
    unmount();
    const again = renderHooks({ c: () => useCardDraft<V>({ id: "v1", base, salvarFn }) });
    expect(again.r.c.current.valor.preco).toBe(99);
    again.unmount();
  });
});
