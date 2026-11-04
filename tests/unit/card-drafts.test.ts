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
});
