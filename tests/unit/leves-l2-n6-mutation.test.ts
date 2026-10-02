// @vitest-environment happy-dom
// LEVES L2 / N6: mutation que falha => reaplicarStatusCqAposErro invalida ["cq", cad] salvo P0409.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { reaplicarStatusCqAposErro } from "@/lib/cq-status-tela";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLElement | null = null;

async function falhaCom(err: unknown) {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  function Tela() {
    const mut = useMutation({
      mutationFn: async () => { throw err; },
      onError: (e) => reaplicarStatusCqAposErro(e, qc, ["cq", "cad-1"]),
    });
    return createElement("button", { onClick: () => mut.mutate() }, "ir");
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Tela))); });
  await act(async () => { container!.querySelector("button")!.click(); await new Promise((r) => setTimeout(r, 20)); });
  return spy;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = null; container = null; document.body.innerHTML = "";
});

describe("N6 — onError de ação local do CQ", () => {
  it("42501 invalida ['cq', cad]", async () => {
    const spy = await falhaCom({ code: "42501" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cq", "cad-1"] });
  });
  it("P0409 não invalida (o reconcile cuida)", async () => {
    const spy = await falhaCom({ code: "P0409" });
    expect(spy).not.toHaveBeenCalled();
  });
});
