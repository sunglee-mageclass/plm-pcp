// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Preço do card do Planejamento = RASCUNHO por card (camada intermediária, fatia 5): digitar/Enter/blur NÃO
// gravam; ✓ / ↺ aparecem só quando difere do salvo; ✓ chama onSave (o onPrecoVenda do mount, que escolhe a
// mutation por origem); ↺ volta ao salvo.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { PrecoVendaCell, precoDoRascunho } from "@/components/planejamento/PrecoVendaCell";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function montar(props: any) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(PrecoVendaCell, props));
  });
  return container.querySelector("input") as HTMLInputElement;
}
async function remontar(props: any) {
  await act(async () => {
    root!.render(createElement(PrecoVendaCell, props));
  });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

async function digitar(el: HTMLInputElement, valor: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, valor);
    el.setSelectionRange(valor.length, valor.length);
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
const salvarBtn = () => container!.querySelector('[data-testid="preco-salvar"]') as HTMLButtonElement | null;
const desfazerBtn = () => container!.querySelector('[data-testid="preco-desfazer"]') as HTMLButtonElement | null;
const clicar = (b: HTMLElement | null) =>
  act(async () => {
    b!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

const base = { precoVenda: 100, placeholder: "0,00" };

describe("PrecoVendaCell — rascunho de preço por card", () => {
  it("editar NÃO grava (nem Enter, nem blur) e mostra ✓/↺", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    expect(salvarBtn()).toBeNull();
    await digitar(el, "150,50");
    await enter(el);
    await blur(el);
    expect(onSave).not.toHaveBeenCalled();
    expect(salvarBtn()).not.toBeNull();
    expect(desfazerBtn()).not.toBeNull();
    expect(el.value).toBe("150,50");
  });

  it("✓ chama onSave com o número canônico (vírgula/milhar NÃO viram NaN)", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "1.234,50");
    await clicar(salvarBtn());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(1234.5);
  });

  it("↺ volta ao salvo, some ✓/↺ e não chama onSave", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "150,50");
    await clicar(desfazerBtn());
    expect(el.value).toBe("100,00");
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("valor igual ao salvo = sem ✓/↺ (inclusive digitar de volta)", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    expect(el.value).toBe("100,00");
    await digitar(el, "150");
    expect(salvarBtn()).not.toBeNull();
    await digitar(el, "100");
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
  });

  it("limpar o campo (sem preço) é rascunho e ✓ envia null", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "");
    await clicar(salvarBtn());
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("sem preço salvo: digitar mostra ✓; campo vazio = sem ✓", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, precoVenda: null, onSave });
    expect(salvarBtn()).toBeNull();
    await digitar(el, "89,90");
    expect(salvarBtn()).not.toBeNull();
    await clicar(salvarBtn());
    expect(onSave).toHaveBeenCalledWith(89.9);
  });

  it("selo âmbar no campo só enquanto há rascunho", async () => {
    const el = await montar({ ...base, onSave: vi.fn() });
    expect(el.className).not.toContain("border-warning");
    await digitar(el, "150");
    expect(el.className).toContain("border-warning");
    await clicar(desfazerBtn());
    expect(el.className).not.toContain("border-warning");
  });

  it("servidor muda SEM rascunho: o campo acompanha; COM rascunho: preserva e ↺ volta ao novo salvo", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await remontar({ ...base, precoVenda: 120, onSave });
    expect(el.value).toBe("120,00");
    await digitar(el, "200");
    await remontar({ ...base, precoVenda: 130, onSave });
    expect(el.value).toBe("200,00");
    await clicar(desfazerBtn());
    expect(el.value).toBe("130,00");
  });

  it("depois de gravar (salvo vira o rascunho) os ícones somem", async () => {
    const onSave = vi.fn();
    const el = await montar({ ...base, onSave });
    await digitar(el, "150");
    await clicar(salvarBtn());
    await remontar({ ...base, precoVenda: 150, onSave });
    expect(salvarBtn()).toBeNull();
    expect(desfazerBtn()).toBeNull();
  });
});

describe("precoDoRascunho", () => {
  it("canônico -> número; vazio/zero/lixo -> null", () => {
    expect(precoDoRascunho("1234.5")).toBe(1234.5);
    expect(precoDoRascunho("")).toBeNull();
    expect(precoDoRascunho("0")).toBeNull();
    expect(precoDoRascunho("abc")).toBeNull();
  });
});

// O mount (página) e o ModeloCard moram num arquivo de rota enorme, não montável em unit: conferimos pela fonte
// que (a) a célula é o único caminho de edição do preço, ligada ao `onPrecoVenda`, sem grava-no-blur; (b) o
// `onPrecoVenda` segue escolhendo a mutation certa por origem; (c) permissão e trava da Integração intactas.
describe("ligação no ModeloCard / mount (fonte)", () => {
  const src = readFileSync("src/routes/_authenticated/criacao.planejamento.tsx", "utf8");
  it("ModeloCard usa PrecoVendaCell com onSave={onPrecoVenda}, só sob podeEditarPreco && !precoTravado", () => {
    expect(src).toMatch(/podeEditarPreco && !precoTravado \? \(\s*(\/\/[^\n]*\n\s*)*<PrecoVendaCell[^>]*onSave=\{onPrecoVenda\}/);
  });
  it("não sobrou grava-no-blur do preço nem commitPreco/precoDraft no ModeloCard", () => {
    expect(src).not.toMatch(/onBlur=\{commitPreco\}/);
    expect(src).not.toMatch(/commitPreco|precoDraft/);
  });
  it("onPrecoVenda escolhe a mutation por origem (importado / revenda / interno)", () => {
    const i = src.indexOf("onPrecoVenda={(preco) => {");
    const trecho = src.slice(i, i + 3500);
    expect(trecho).toMatch(/m\.origem === "importado"[\s\S]*salvarPrecoVarejoImportado\.mutate/);
    expect(trecho).toMatch(/ehOrigemComprada\(m\.origem\)[\s\S]*salvarPrecoVarejoRevenda\.mutate/);
    expect(trecho).toMatch(/salvarPrecoVenda\.mutate\(\{ id: m\.id, preco \}\)/);
  });
  it("trava da Integração segue ligada ao preço de venda", () => {
    expect(src).toMatch(/precoTravado=\{colunasTravadas\(estadosIntegracao\[m\.id\]\)\.has\("preco_venda"\)/);
  });
});
