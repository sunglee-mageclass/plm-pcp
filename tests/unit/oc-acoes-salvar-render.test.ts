// @vitest-environment happy-dom
// [backend F2.2 fix, review m5] Render do rodape da OC de Tecido com o modo OC/Rolo ainda desconhecido (R7): Salvar e Marcar Recebido
// desabilitados + motivo em PT-BR + "Tentar de novo" quando a 1a carga falhou; com o modo conhecido tudo habilita.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { OcAcoesSalvar, MOTIVO_MODO_DESCONHECIDO } from "@/components/oc-tecido/OcAcoesSalvar";

type Props = Parameters<typeof OcAcoesSalvar>[0];
let root: Root | null = null;
let el: HTMLElement;

async function montar(over: Partial<Props>) {
  const props: Props = {
    modoPronto: true,
    modoErro: false,
    recarregarModo: vi.fn(),
    salvando: false,
    canShowRecebimento: true,
    somenteLeituraRecebimento: false,
    desmarcando: false,
    onSalvar: vi.fn(),
    onMarcarRecebido: vi.fn(),
    onDesmarcarRecebido: vi.fn(),
    ...over,
  };
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(OcAcoesSalvar, props)); });
  return props;
}
const botao = (txt: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(txt)) as HTMLButtonElement | undefined;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  el?.remove();
});

describe("OcAcoesSalvar — modo OC/Rolo desconhecido", () => {
  it("carregando (sem erro): Salvar e Marcar Recebido desabilitados, com o motivo; sem link de retry", async () => {
    const p = await montar({ modoPronto: false });
    expect(botao("Salvar")!.disabled).toBe(true);
    expect(botao("Marcar Recebido")!.disabled).toBe(true);
    expect(botao("Salvar")!.title).toBe(MOTIVO_MODO_DESCONHECIDO);
    expect(botao("Marcar Recebido")!.title).toBe(MOTIVO_MODO_DESCONHECIDO);
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Carregando o modo de trabalho da loja");
    expect(botao("Tentar de novo")).toBeUndefined();
    await act(async () => { botao("Salvar")!.click(); });
    expect(p.onSalvar).not.toHaveBeenCalled();
  });

  it("1ª carga com erro: aviso de erro + 'Tentar de novo' chama recarregarModo; Salvar segue desabilitado", async () => {
    const p = await montar({ modoPronto: false, modoErro: true });
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Não foi possível carregar o modo de trabalho da loja");
    expect(botao("Salvar")!.disabled).toBe(true);
    await act(async () => { botao("Tentar de novo")!.click(); });
    expect(p.recarregarModo).toHaveBeenCalledTimes(1);
  });

  it("modo conhecido: habilitado, sem aviso, e os cliques chegam", async () => {
    const p = await montar({ modoPronto: true });
    expect(botao("Salvar")!.disabled).toBe(false);
    expect(botao("Marcar Recebido")!.disabled).toBe(false);
    expect(el.querySelector('[role="status"]')).toBeNull();
    await act(async () => { botao("Salvar")!.click(); botao("Marcar Recebido")!.click(); });
    expect(p.onSalvar).toHaveBeenCalledTimes(1);
    expect(p.onMarcarRecebido).toHaveBeenCalledTimes(1);
  });

  it("OC recebida: Desmarcar Recebido não depende do modo; Salvar continua bloqueado sem o modo", async () => {
    const p = await montar({ modoPronto: false, somenteLeituraRecebimento: true });
    expect(botao("Marcar Recebido")).toBeUndefined();
    expect(botao("Desmarcar Recebido")!.disabled).toBe(false);
    expect(botao("Salvar")!.disabled).toBe(true);
    await act(async () => { botao("Desmarcar Recebido")!.click(); });
    expect(p.onDesmarcarRecebido).toHaveBeenCalledTimes(1);
  });
});
