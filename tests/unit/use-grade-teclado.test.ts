// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useGradeTeclado } from "@/lib/grade-teclado";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Monta uma grade 2x2 de <input data-grade-cel>, liga o hook e expoe o controlador.
function montar(bloqueados: string[] = [], ligarGridRef = true) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let api: ReturnType<typeof useGradeTeclado> | null = null;
  function Grade() {
    const h = useGradeTeclado({ nLinhas: 2, nColunas: 2 });
    api = h;
    return createElement("table", ligarGridRef ? { ref: (el: HTMLTableElement | null) => { (h.gridRef as any).current = el; } } : {},
      createElement("tbody", null,
        [0, 1].map((l) => createElement("tr", { key: l },
          [0, 1].map((c) => {
            const p = h.propsDaCelula(l, c);
            return createElement("td", { key: c },
              createElement("input", { ...p, disabled: bloqueados.includes(`${l}:${c}`), "data-test": `${l}:${c}` }));
          })))));
  }
  const root = createRoot(host);
  act(() => root.render(createElement(Grade)));
  return { host, api: api!, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

function tecla(host: HTMLElement, cel: string, key: string, shift = false) {
  const el = host.querySelector<HTMLInputElement>(`[data-grade-cel="${cel}"]`)!;
  el.focus();
  const ev = new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

describe("useGradeTeclado", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Enter foca a celula de baixo (mesma coluna)", () => {
    const { host, cleanup } = montar();
    tecla(host, "0:1", "Enter");
    act(() => { vi.runAllTimers(); }); // resolve o requestAnimationFrame
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("1:1");
    cleanup();
  });
  it("Tab foca a celula a direita", () => {
    const { host, cleanup } = montar();
    tecla(host, "0:0", "Tab");
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("0:1");
    cleanup();
  });
  it("pula a celula desabilitada", () => {
    const { host, cleanup } = montar(["0:1"]); // a da direita esta disabled
    tecla(host, "0:0", "Tab");
    act(() => { vi.runAllTimers(); });
    // 0:1 disabled -> estoura p/ 1:0
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("1:0");
    cleanup();
  });
  it("Enter na borda faz preventDefault e nao foca fora", () => {
    const { host, cleanup } = montar();
    const ev = tecla(host, "1:0", "Enter"); // ultima linha
    act(() => { vi.runAllTimers(); });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("1:0");
    cleanup();
  });
  it("Tab na borda NAO faz preventDefault (fluxo nativo)", () => {
    const { host, cleanup } = montar();
    const ev = tecla(host, "1:1", "Tab"); // ultima celula
    expect(ev.defaultPrevented).toBe(false);
    cleanup();
  });
  it("Shift+Tab volta a celula anterior", () => {
    const { host, cleanup } = montar();
    tecla(host, "1:0", "Tab", true);
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("0:1");
    cleanup();
  });
  it("Ctrl+Enter e outras teclas passam sem tratamento", () => {
    const { host, cleanup } = montar();
    const el = host.querySelector<HTMLInputElement>('[data-grade-cel="0:0"]')!;
    el.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { el.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
    cleanup();
  });
  it("sem gridRef ligado o hook fica inerte: Enter sem preventDefault e foco intacto", () => {
    const { host, cleanup } = montar([], false);
    const ev = tecla(host, "0:1", "Enter");
    act(() => { vi.runAllTimers(); });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("0:1");
    cleanup();
  });
  it("sem gridRef ligado, a celula homonima de OUTRA grade nao recebe foco", () => {
    const outra = document.createElement("input");
    outra.setAttribute("data-grade-cel", "1:1");
    document.body.appendChild(outra);
    const { host, cleanup } = montar([], false);
    tecla(host, "0:1", "Enter");
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement).not.toBe(outra);
    outra.remove();
    cleanup();
  });
});
