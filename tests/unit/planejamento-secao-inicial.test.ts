// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks do banco/DOM nos testes (mesmo padrão do harness da grade) */
// PR-GRADE-2 — o Sheet do Planejamento abre JÁ NA SEÇÃO pedida (botão "Editar a grade no Sheet" da Lista): o mecanismo de "abrir a seção X por
// pedido" (links do "Para enviar, falta…") ganhou o pedido INICIAL — a seção com o `id` pedido abre e rola até si 1× ao montar. Abertura normal intacta.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Secao } from "@/components/planejamento/planejamento-detail/campos";
import {
  PedidoSecaoContext,
  pedidoInicial,
  proximoPedido,
  type PedidoSecao,
} from "@/components/planejamento/planejamento-detail/secoes-abertas";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});

async function montar(pedido: PedidoSecao, secoes = ["grade_revenda", "outra"]) {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  const render = (p: PedidoSecao) =>
    root!.render(
      createElement(
        PedidoSecaoContext.Provider,
        { value: p },
        ...secoes.map((id) =>
          createElement(
            Secao,
            { key: id, id, titulo: id, defaultOpen: false },
            createElement("p", { "data-conteudo": id }, `conteudo ${id}`),
          ),
        ),
      ),
    );
  await act(async () => render(pedido));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return render;
}
const aberta = (id: string) => !!el!.querySelector(`[data-conteudo="${id}"]`);

describe("seção inicial do Sheet", () => {
  it("o pedido INICIAL abre SÓ a seção pedida e rola até ela", async () => {
    const rolar = vi.fn();
    (Element.prototype as any).scrollIntoView = rolar;
    await montar(pedidoInicial("grade_revenda"));
    expect(aberta("grade_revenda")).toBe(true);
    expect(aberta("outra")).toBe(false);
    expect(rolar).toHaveBeenCalledTimes(1);
  });

  it("sem pedido a abertura é a normal (tudo recolhido)", async () => {
    await montar(null);
    expect(aberta("grade_revenda")).toBe(false);
    expect(aberta("outra")).toBe(false);
    expect(pedidoInicial(null)).toBeNull();
    expect(pedidoInicial(undefined)).toBeNull();
  });

  it("vale 1× por abertura: a seção remontada depois NÃO reabre sozinha", async () => {
    (Element.prototype as any).scrollIntoView = vi.fn();
    const pedido = pedidoInicial("grade_revenda");
    await montar(pedido);
    expect(aberta("grade_revenda")).toBe(true);
    await act(async () => root!.unmount());
    el!.remove();
    root = null;
    await montar(pedido); // mesmo pedido (já usado), seção nova
    expect(aberta("grade_revenda")).toBe(false);
  });

  it("os pedidos de sempre (links 'Para enviar, falta…') continuam funcionando depois do inicial", async () => {
    (Element.prototype as any).scrollIntoView = vi.fn();
    const render = await montar(pedidoInicial("grade_revenda"));
    expect(aberta("outra")).toBe(false);
    await act(async () => render(proximoPedido(pedidoInicial("grade_revenda"), "outra")));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(aberta("outra")).toBe(true);
  });
});
