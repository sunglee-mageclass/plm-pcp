// @vitest-environment happy-dom
// LEVES L2 / L3: useUnsavedGuard com blockNav num router real (memory history) — 1 diálogo por navegação suja,
// 0 com `navPermitida` (fechamento do próprio Sheet) e 0 com dirty=false.
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLElement | null = null;

async function montar(opts: { dirty: boolean; permitir?: () => boolean }) {
  function Tela() {
    const { confirm } = useUnsavedGuard({ dirty: opts.dirty, blockNav: true, navPermitida: opts.permitir ? () => opts.permitir!() : undefined });
    return createElement(UnsavedChangesGuard, { confirm });
  }
  const rootRoute = createRootRoute({ component: Tela });
  const a = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null });
  const b = createRoute({ getParentRoute: () => rootRoute, path: "/b", component: () => null });
  const router = createRouter({ routeTree: rootRoute.addChildren([a, b]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(RouterProvider, { router })); });
  await act(async () => { await router.load(); });
  return router;
}
const dialogos = () => document.body.querySelectorAll('[role="alertdialog"]').length;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = null; container = null; document.body.innerHTML = "";
});

describe("useUnsavedGuard blockNav (L3)", () => {
  it("sujo: navegar abre 1 diálogo", async () => {
    const router = await montar({ dirty: true });
    // o navigate só resolve depois do resolver do blocker — não se dá await aqui
    await act(async () => { void router.navigate({ to: "/b" }); await new Promise((r) => setTimeout(r, 50)); });
    expect(dialogos()).toBe(1);
    expect(router.state.location.pathname).toBe("/");
  });
  it("limpo: navega sem diálogo", async () => {
    const router = await montar({ dirty: false });
    await act(async () => { await router.navigate({ to: "/b" }); });
    expect(dialogos()).toBe(0);
    expect(router.state.location.pathname).toBe("/b");
  });
  it("navPermitida (fechamento do próprio Sheet): passa sem diálogo", async () => {
    const router = await montar({ dirty: true, permitir: () => true });
    await act(async () => { await router.navigate({ to: "/b" }); });
    expect(dialogos()).toBe(0);
    expect(router.state.location.pathname).toBe("/b");
  });
});
