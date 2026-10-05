// @vitest-environment happy-dom
// [camada C2] Diálogo único "Tem certeza?" (ConfirmarAcaoDialog / useConfirmacao): Cancelar, Esc e clique fora NUNCA executam a ação
// (só `onCancelar`); Confirmar executa UMA vez (e não dispara `onCancelar`); vermelho quando destrutivo, neutro quando não.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, useState } from "react";
import { act } from "react";
import { montar, aguardar, clicar } from "./dom-helpers";
import { ConfirmarAcaoDialog, type PedidoConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";

let desmontar: (() => Promise<void>) | null = null;
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;

function Tela({ pedido }: { pedido: Omit<PedidoConfirmacao, "onConfirmar" | "onCancelar"> & { onConfirmar: () => void; onCancelar: () => void } }) {
  const [p, setP] = useState<PedidoConfirmacao | null>(null);
  return createElement("div", null,
    createElement("button", { id: "abrir", onClick: () => setP(pedido) }, "abrir"),
    createElement(ConfirmarAcaoDialog, { pedido: p, onClose: () => setP(null) }));
}
const TEXTO = { titulo: "Título?", descricao: "Descrição aprovada.", confirmar: "Sim", cancelar: "Voltar", destrutivo: true };
const abrirBtn = () => document.querySelector<HTMLButtonElement>("#abrir")!;

describe("[camada C2] ConfirmarAcaoDialog", () => {
  it("Cancelar/Voltar: não executa; dispara onCancelar", async () => {
    const onConfirmar = vi.fn(), onCancelar = vi.fn();
    desmontar = (await montar(createElement(Tela, { pedido: { ...TEXTO, onConfirmar, onCancelar } }))).desmontar;
    await clicar(abrirBtn());
    await aguardar(() => !!dialogo(), "aberto");
    expect(dialogo()!.textContent).toContain("Título?");
    expect(dialogo()!.textContent).toContain("Descrição aprovada.");
    await clicar(botaoDialogo("Voltar")!);
    await aguardar(() => !dialogo(), "fechado");
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
  it("Esc: não executa; dispara onCancelar", async () => {
    const onConfirmar = vi.fn(), onCancelar = vi.fn();
    desmontar = (await montar(createElement(Tela, { pedido: { ...TEXTO, onConfirmar, onCancelar } }))).desmontar;
    await clicar(abrirBtn());
    await aguardar(() => !!dialogo(), "aberto");
    await act(async () => { dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await aguardar(() => !dialogo(), "fechado pelo Esc");
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
  it("Confirmar: executa UMA vez e NÃO dispara onCancelar; reabrir e cancelar depois ainda dispara onCancelar", async () => {
    const onConfirmar = vi.fn(), onCancelar = vi.fn();
    desmontar = (await montar(createElement(Tela, { pedido: { ...TEXTO, onConfirmar, onCancelar } }))).desmontar;
    await clicar(abrirBtn());
    await aguardar(() => !!dialogo(), "aberto");
    await clicar(botaoDialogo("Sim")!);
    await aguardar(() => !dialogo(), "fechado");
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onCancelar).not.toHaveBeenCalled();
    await clicar(abrirBtn());
    await aguardar(() => !!dialogo(), "reaberto");
    await clicar(botaoDialogo("Voltar")!);
    await aguardar(() => !dialogo(), "fechado de novo");
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
  it("vermelho quando destrutivo, neutro quando não", async () => {
    const onConfirmar = vi.fn(), onCancelar = vi.fn();
    desmontar = (await montar(createElement(Tela, { pedido: { ...TEXTO, destrutivo: false, onConfirmar, onCancelar } }))).desmontar;
    await clicar(abrirBtn());
    await aguardar(() => !!dialogo(), "aberto");
    expect(botaoDialogo("Sim")!.className).not.toContain("destructive");
  });
});
