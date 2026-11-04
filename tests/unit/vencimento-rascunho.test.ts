// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
// VencimentoCell = RASCUNHO por linha (camada intermediária, fatia 3): editar o vencimento NÃO grava;
// ✓ Salvar / ↺ Desfazer aparecem só quando difere do salvo; ✓ chama onSave; ↺ volta ao salvo.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VencimentoCell } from "@/components/financeiro/VencimentoCell";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function montar(props: any) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(VencimentoCell, props));
  });
  return container.querySelector("input") as HTMLInputElement;
}
async function remontar(props: any) {
  await act(async () => {
    root!.render(createElement(VencimentoCell, props));
  });
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
const salvarBtn = () => container!.querySelector('[data-testid="venc-salvar"]') as HTMLButtonElement | null;
const desfazerBtn = () => container!.querySelector('[data-testid="venc-desfazer"]') as HTMLButtonElement | null;
const clicar = (b: HTMLElement | null) =>
  act(async () => {
    b!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

const base = { value: "2026-07-15", podeEditar: true };

describe("VencimentoCell — rascunho por linha", () => {
  it("editar (digitar, Enter, blur) NÃO chama onSave; aparecem ✓/↺", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
    await digitar(el, "16/07/2026", 10);
    await enter(el);
    await blur(el);
    expect(onSave).not.toHaveBeenCalled();
    expect(el.value).toBe("16/07/2026");
    expect(salvarBtn()).not.toBeNull();
    expect(desfazerBtn()).not.toBeNull();
  });

  it("✓ chama onSave com a data nova, uma vez (clique duplo não duplica)", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(salvarBtn());
    await clicar(salvarBtn());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe("2026-07-16");
  });

  it("no erro do onSave o rascunho fica e o ✓ tenta de novo", async () => {
    const onSave = vi.fn((_v: string, h?: { onError: () => void }) => h?.onError());
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(salvarBtn());
    expect(el.value).toBe("16/07/2026");
    expect(salvarBtn()).not.toBeNull();
    await clicar(salvarBtn());
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("OCs (otimista): A -> B -> rollback A no erro mantém o rascunho B e o ✓ volta", async () => {
    let h: { onError: () => void } | undefined;
    const onSave = vi.fn((_v: string, hh?: { onError: () => void }) => {
      h = hh;
    });
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(salvarBtn());
    expect(onSave).toHaveBeenCalledTimes(1);
    await remontar({ ...base, value: "2026-07-16", onSave }); // onMutate otimista
    expect(salvarBtn()).toBeNull();
    await remontar({ ...base, value: "2026-07-15", onSave }); // onError do mutation reverte o cache
    await act(async () => h!.onError());
    expect(el.value).toBe("16/07/2026");
    expect(salvarBtn()).not.toBeNull();
    expect(desfazerBtn()).not.toBeNull();
    await clicar(salvarBtn()); // tenta de novo
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toBe("2026-07-16");
  });

  it("OCs (otimista): A -> B e sucesso (value fica em B) = sem rascunho, sem ✓", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(salvarBtn());
    await remontar({ ...base, value: "2026-07-16", onSave });
    await remontar({ ...base, value: "2026-07-16", onSave }); // refetch confirma
    expect(el.value).toBe("16/07/2026");
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
  });

  it("mudança externa legítima (value != valor de antes da tentativa) segue o comportamento normal", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(salvarBtn());
    await remontar({ ...base, value: "2026-07-16", onSave });
    await remontar({ ...base, value: "2026-07-20", onSave }); // outro usuário
    expect(el.value).toBe("20/07/2026");
    expect(salvarBtn()).toBeNull();
  });

  it("disabled (parcela virou paga) com rascunho pendente mostra o salvo, não o rascunho", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await remontar({ ...base, disabled: true, onSave });
    expect(el.value).toBe("15/07/2026");
    expect(salvarBtn()).toBeNull();
  });

  it("↺ volta ao salvo e os ícones somem, sem chamar onSave", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(desfazerBtn());
    expect(el.value).toBe("15/07/2026");
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("digitar de volta o valor salvo = sem ✓/↺", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    expect(salvarBtn()).not.toBeNull();
    await digitar(el, "15/07/2026", 10);
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
  });

  it("depois de gravar (value vira o rascunho) os ícones somem", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "16/07/2026", 10);
    await clicar(salvarBtn());
    await remontar({ ...base, value: "2026-07-16", onSave });
    expect(el.value).toBe("16/07/2026");
    expect(salvarBtn()).toBeNull();
  });

  it("value muda de fora SEM rascunho: o campo acompanha; COM rascunho: preserva", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await remontar({ ...base, value: "2026-08-01", onSave });
    expect(el.value).toBe("01/08/2026");
    await digitar(el, "05/08/2026", 10);
    await remontar({ ...base, value: "2026-08-02", onSave });
    expect(el.value).toBe("05/08/2026");
    await clicar(desfazerBtn());
    expect(el.value).toBe("02/08/2026");
  });

  it("limpar e sair volta à data guardada com aviso (obrigatório), sem onSave nem ✓", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "", 0);
    await blur(el);
    expect(onSave).not.toHaveBeenCalled();
    expect(el.value).toBe("15/07/2026");
    expect(container!.textContent).toContain("Vencimento obrigatório");
    expect(salvarBtn()).toBeNull();
  });

  it("podeEditar=false não mostra ✓/↺ (campo desabilitado)", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, podeEditar: false, onSave });
    expect(el.disabled).toBe(true);
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
  });

  it("disabled (parcela paga) não mostra ✓/↺", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, disabled: true, onSave });
    expect(el.disabled).toBe(true);
    expect(salvarBtn()).toBeNull();
  });
});
