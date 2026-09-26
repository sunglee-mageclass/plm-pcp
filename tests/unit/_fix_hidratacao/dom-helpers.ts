// REPRO de investigação (26/set) — utilitários mínimos de DOM p/ montar a TELA REAL em happy-dom sem @testing-library.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export async function montar(el: ReactNode): Promise<{ root: Root; container: HTMLElement; desmontar: () => Promise<void> }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  return {
    root, container,
    desmontar: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

/** Deixa promessas/efeitos/timers pendentes rodarem (dentro de act). */
export async function esperar(ms = 0) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/** Repete até `cond()` ser verdade ou estourar o prazo (equivalente ao waitFor). */
export async function aguardar(cond: () => boolean, rotulo: string, prazoMs = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > prazoMs) throw new Error(`timeout esperando: ${rotulo}`);
    await esperar(10);
  }
}

/** Digita num input/textarea CONTROLADO do React (setter nativo + evento input — o que o React ouve). */
export async function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function clicar(el: HTMLElement) {
  await act(async () => { el.click(); });
}

export function botaoPorTexto(texto: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => (b.textContent ?? "").trim() === texto) ?? null;
}

export { createElement };
