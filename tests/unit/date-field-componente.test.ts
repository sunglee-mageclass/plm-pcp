// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
// DateField (L1 fix round 1): blur/Enter/calendário confirmam, vazio vira onCommit(""), texto
// inválido não confirma, estouro de dígitos é rejeitado (tela = estado), cursor no backspace da "/".
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DateField } from "@/components/shared/DateField";
import { VencimentoCell } from "@/components/financeiro/VencimentoCell";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function montar(el: any) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
  return container.querySelector("input") as HTMLInputElement;
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

async function digitar(el: HTMLInputElement, valor: string, cursor: number) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, valor);
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const blur = (el: HTMLInputElement) =>
  act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
const enter = (el: HTMLInputElement) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

// Pai controlado (como os formulários): guarda o valor emitido num ref visível ao teste.
function Pai({ inicial, onCommit, emitidos, min, max }: any) {
  const [v, setV] = useState(inicial);
  return createElement(DateField, {
    value: v,
    min,
    max,
    onChange: (e: any) => {
      emitidos.push(e.target.value);
      setV(e.target.value);
    },
    onCommit,
  });
}

describe("DateField (componente)", () => {
  it("blur com data válida emite (se diferente) e confirma", async () => {
    const onCommit = vi.fn(),
      emitidos: string[] = [];
    const el = await montar(createElement(Pai, { inicial: "", onCommit, emitidos }));
    await digitar(el, "15072026", 8);
    expect(el.value).toBe("15/07/2026");
    await blur(el);
    expect(onCommit).toHaveBeenCalledWith("2026-07-15");
    expect(emitidos).toContain("2026-07-15");
  });

  it("Enter confirma", async () => {
    const onCommit = vi.fn();
    const el = await montar(createElement(Pai, { inicial: "2026-07-15", onCommit, emitidos: [] }));
    await digitar(el, "16/07/2026", 10);
    await enter(el);
    expect(onCommit).toHaveBeenCalledWith("2026-07-16");
  });

  it("limpar e sair dá onCommit('')", async () => {
    const onCommit = vi.fn();
    const el = await montar(createElement(Pai, { inicial: "2026-07-15", onCommit, emitidos: [] }));
    await digitar(el, "", 0);
    await blur(el);
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("texto inválido/incompleto não confirma e volta ao valor", async () => {
    const onCommit = vi.fn();
    const el = await montar(createElement(Pai, { inicial: "2026-07-15", onCommit, emitidos: [] }));
    await digitar(el, "31/02/2026", 10);
    await blur(el);
    expect(onCommit).not.toHaveBeenCalled();
    expect(el.value).toBe("15/07/2026");
  });

  it("A1: estouro de dígitos é rejeitado — tela = estado", async () => {
    const onCommit = vi.fn(),
      emitidos: string[] = [];
    const el = await montar(createElement(Pai, { inicial: "2026-07-15", onCommit, emitidos }));
    await digitar(el, "15/07/20256", 10);
    expect(el.value).toBe("15/07/2026");
    await blur(el);
    expect(el.value).toBe("15/07/2026");
    expect(emitidos).toEqual([]); // nada divergente emitido
  });

  it("A1: colar 15/08/2026 no início de campo cheio mantém tela e estado iguais", async () => {
    const emitidos: string[] = [];
    const el = await montar(
      createElement(Pai, { inicial: "2026-07-15", onCommit: vi.fn(), emitidos }),
    );
    await digitar(el, "15/08/202615/07/2026", 10);
    await blur(el);
    expect(el.value).toBe("15/07/2026");
    expect(emitidos).toEqual([]);
  });

  it("M2: fora de max mostra mensagem e reverte", async () => {
    const onCommit = vi.fn();
    const el = await montar(
      createElement(Pai, { inicial: "2026-07-15", onCommit, emitidos: [], max: "2026-07-20" }),
    );
    await digitar(el, "25/07/2026", 10);
    await blur(el);
    expect(onCommit).not.toHaveBeenCalled();
    expect(el.value).toBe("15/07/2026");
    expect(container!.querySelector('[role="alert"]')?.textContent).toMatch(/posterior ao máximo/);
  });

  it("B1: backspace sobre a '/' devolve o cursor ao lugar (não pula pro fim)", async () => {
    const el = await montar(
      createElement(Pai, { inicial: "2026-07-15", onCommit: vi.fn(), emitidos: [] }),
    );
    el.focus();
    await digitar(el, "1507/2026", 2); // apagou a "/" depois de "15"
    expect(el.value).toBe("15/07/2026");
    expect(el.selectionStart).toBe(2);
  });

  it("calendário: escolher o dia confirma", async () => {
    const onCommit = vi.fn();
    await montar(createElement(Pai, { inicial: "2026-07-15", onCommit, emitidos: [] }));
    const gatilho = document.querySelector(
      'button[aria-label="Abrir calendário"]',
    ) as HTMLButtonElement;
    await act(async () => {
      gatilho.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dia = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "20" && b.closest("[role=grid], table"),
    ) as HTMLButtonElement | undefined;
    expect(dia).toBeTruthy();
    await act(async () => {
      dia!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("2026-07-20");
  });
});

describe("VencimentoCell", () => {
  it("Enter seguido de blur salva UMA vez", async () => {
    const onSave = vi.fn();
    const el = await montar(
      createElement(VencimentoCell, { value: "2026-07-15", onSave, podeEditar: true }),
    );
    await digitar(el, "16/07/2026", 10);
    await enter(el);
    await blur(el);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe("2026-07-16");
  });

  it("após erro, redigitar a mesma data tenta de novo", async () => {
    const onSave = vi.fn((_v: string, h?: { onError: () => void }) => h?.onError());
    const el = await montar(
      createElement(VencimentoCell, { value: "2026-07-15", onSave, podeEditar: true }),
    );
    await digitar(el, "16/07/2026", 10);
    await blur(el);
    await blur(el);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("B4: limpar e sair volta à data guardada com aviso", async () => {
    const onSave = vi.fn();
    const el = await montar(
      createElement(VencimentoCell, { value: "2026-07-15", onSave, podeEditar: true }),
    );
    await digitar(el, "", 0);
    await blur(el);
    expect(onSave).not.toHaveBeenCalled();
    expect(el.value).toBe("15/07/2026");
    expect(container!.textContent).toContain("Vencimento obrigatório");
  });
});
