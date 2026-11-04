// @vitest-environment happy-dom
// M1 (Salvar por card — Cadastro de tecido): o aviso NATIVO de F5/fechar aba (`beforeunload`) vale sempre que há
// alteração não salva, INDEPENDENTE de `blockNav` (que só gateia a navegação de ROTA). Antes, em Sheet embutido
// (`blockNav:false`) fechar a aba com uma cor suja perdia o rascunho sem avisar.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let opts: { shouldBlockFn: (a?: any) => boolean; enableBeforeUnload: () => boolean } | null = null;
vi.mock("@tanstack/react-router", () => ({
  useBlocker: (o: any) => { opts = o; return { status: "idle", reset: () => {}, proceed: () => {} }; },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

async function montar(p: { dirty: boolean; blockNav?: boolean }) {
  const { useUnsavedGuard } = await import("@/components/shared/UnsavedChangesGuard");
  function Tela() { useUnsavedGuard({ dirty: p.dirty, blockNav: p.blockNav }); return null; }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(Tela)); });
  return opts!;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = null; container = null; opts = null;
});

describe("useUnsavedGuard — beforeunload (F5 / fechar aba)", () => {
  it("sujo + blockNav:false (Sheet embutido): AVISA no F5/fechar aba — mas a rota NÃO é bloqueada", async () => {
    const o = await montar({ dirty: true, blockNav: false });
    expect(o.enableBeforeUnload()).toBe(true);
    expect(o.shouldBlockFn()).toBe(false); // navegação de rota continua gated por blockNav
  });
  it("sujo + blockNav omitido (modais comuns): avisa", async () => {
    const o = await montar({ dirty: true });
    expect(o.enableBeforeUnload()).toBe(true);
    expect(o.shouldBlockFn()).toBe(false);
  });
  it("sujo + blockNav:true (full-page): avisa e bloqueia a rota (como antes)", async () => {
    const o = await montar({ dirty: true, blockNav: true });
    expect(o.enableBeforeUnload()).toBe(true);
    expect(o.shouldBlockFn()).toBe(true);
  });
  it("limpo: NUNCA avisa (nem com blockNav)", async () => {
    expect((await montar({ dirty: false, blockNav: false })).enableBeforeUnload()).toBe(false);
    await act(async () => root!.unmount()); container?.remove(); root = null;
    expect((await montar({ dirty: false, blockNav: true })).enableBeforeUnload()).toBe(false);
  });
});
