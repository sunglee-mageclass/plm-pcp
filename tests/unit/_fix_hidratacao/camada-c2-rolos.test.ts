// @vitest-environment happy-dom
// [camada C2 · P-263 A / 1.9–1.11] Recebimento da OC de Tecido (modo rolo): Cancelar rolo, Reabrir rolo e Ajustar a quantidade pedem
// "Tem certeza?" — componente REAL `OcTecidoCalculos`. Cancelar não chama nada (e a caixa/campo ficam como estavam); Confirmar chama UMA vez.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = { user: { id: "u1" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [], canView: () => true, canEdit: () => true, loading: false, signOut: async () => {} };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/components/tecido/EnderecoEditor", () => ({ EnderecoPopover: () => null, RoloEnderecoPopover: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { montar, esperar, aguardar, clicar, digitar } from "./dom-helpers";
import { OcTecidoCalculos } from "@/components/oc-tecido/OcTecidoCalculos";

let desmontar: (() => Promise<void>) | null = null;
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;

const ITEM: any = { tempId: "i1", id: "it1", artigo_numero: 1, artigo_id: "a1", variante_tecido_id: "v1", quantidade_pedida: 20, quantidade_recebida: 10, rendimento: null, cancelado: false, preco: 5 };
const ARTIGO: any = { id: "a1", nome: "Malha", empresa_id: null, preco: 5, rendimento: null, unidade_medida: "metro" };
const VARIANTE: any = { id: "v1", artigo_id: "a1", nome_variante: null, codigo_variante: null, cor: { nome: "Azul" }, apelido: null };

async function abrir(rolo: Record<string, unknown>, handlers: { cancelar: ReturnType<typeof vi.fn>; ajuste: ReturnType<typeof vi.fn> }) {
  const props = {
    items: [ITEM], artigoMap: { a1: ARTIGO }, varianteMap: { v1: VARIANTE }, setQtd: () => {},
    totalPrevisto: 100, totalReal: 50, dataPrevista: "2026-10-10", dataEntrega: "", status: "recebido", readOnly: false,
    modoRolo: true, rolos: { i1: [{ qtd: "10", codigo: "R-001", roloId: "ro1", roloItemId: "ri1", cancelado: false, usado: false, ...rolo }] },
    setRolos: () => {}, onRoloCq: () => {}, onRoloCancelar: handlers.cancelar, onRoloAjuste: handlers.ajuste, ocNumero: "OC-9",
  };
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(OcTecidoCalculos, props as any)));
  desmontar = m.desmontar;
}
const caixaCancelarRolo = () => {
  const label = Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").includes("Cancelar rolo"));
  return label?.querySelector<HTMLElement>('button[role="checkbox"]') ?? null;
};
const campoQtd = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')).find((i) => i.className.includes("w-24")) ?? null;

describe("[camada C2 · 1.9] Cancelar rolo", () => {
  it("marcar a caixa abre o diálogo aprovado e NÃO chama nada; Voltar não chama; Cancelar rolo chama onRoloCancelar(id, true) UMA vez", async () => {
    const h = { cancelar: vi.fn(), ajuste: vi.fn() };
    await abrir({}, h);
    await aguardar(() => !!caixaCancelarRolo(), "caixa Cancelar rolo");
    await clicar(caixaCancelarRolo()!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Cancelar este rolo?");
    expect(dialogo()!.textContent).toContain("O rolo R-001 (Azul) da OC OC-9 sai do estoque e do consumo, e o valor da OC é recalculado. Dá para reverter reabrindo o rolo nesta mesma tela.");
    expect(h.cancelar).not.toHaveBeenCalled();
    expect(botaoDialogo("Cancelar rolo")!.className).toContain("destructive");
    expect(caixaCancelarRolo()!.getAttribute("aria-checked")).toBe("false"); // a caixa só marca depois de confirmar

    await clicar(botaoDialogo("Voltar")!);
    await aguardar(() => !dialogo(), "fechou");
    await esperar(30);
    expect(h.cancelar).not.toHaveBeenCalled();
    expect(caixaCancelarRolo()!.getAttribute("aria-checked")).toBe("false");

    await clicar(caixaCancelarRolo()!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Cancelar rolo")!);
    await aguardar(() => h.cancelar.mock.calls.length === 1, "cancelar chamado");
    expect(h.cancelar).toHaveBeenCalledWith("ro1", true);
    await esperar(30);
    expect(h.cancelar).toHaveBeenCalledTimes(1);
  });
});

describe("[camada C2 · 1.10] Reabrir rolo", () => {
  it("desmarcar a caixa abre o diálogo aprovado; Cancelar não chama; Reabrir rolo chama onRoloCancelar(id, false) UMA vez", async () => {
    const h = { cancelar: vi.fn(), ajuste: vi.fn() };
    await abrir({ cancelado: true }, h);
    // item não cancelado, rolo cancelado: a caixa vem marcada
    await aguardar(() => !!caixaCancelarRolo(), "caixa Cancelar rolo");
    expect(caixaCancelarRolo()!.getAttribute("aria-checked")).toBe("true");
    await clicar(caixaCancelarRolo()!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Reabrir este rolo?");
    expect(dialogo()!.textContent).toContain("O rolo R-001 (Azul) da OC OC-9 volta ao estoque e ao consumo, e o valor da OC é recalculado.");
    expect(h.cancelar).not.toHaveBeenCalled();
    expect(botaoDialogo("Reabrir rolo")!.className).not.toContain("destructive"); // reabre = neutro

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    await esperar(30);
    expect(h.cancelar).not.toHaveBeenCalled();
    expect(caixaCancelarRolo()!.getAttribute("aria-checked")).toBe("true");

    await clicar(caixaCancelarRolo()!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Reabrir rolo")!);
    await aguardar(() => h.cancelar.mock.calls.length === 1, "reabrir chamado");
    expect(h.cancelar).toHaveBeenCalledWith("ro1", false);
    await esperar(30);
    expect(h.cancelar).toHaveBeenCalledTimes(1);
  });
});

describe("[camada C2 · 1.11] Ajustar a quantidade de um rolo", () => {
  async function digitarEsair(valor: string) {
    const c = campoQtd()!;
    await act(async () => { c.focus(); });
    await digitar(c, valor);
    await act(async () => { c.blur(); c.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  }
  it("mudar a quantidade e sair do campo abre o diálogo aprovado e NÃO ajusta; Cancelar devolve o valor e não ajusta; Ajustar quantidade chama UMA vez", async () => {
    const h = { cancelar: vi.fn(), ajuste: vi.fn() };
    await abrir({}, h);
    await aguardar(() => !!campoQtd(), "campo de quantidade do rolo");
    await digitarEsair("12,5");
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Ajustar a quantidade do rolo?");
    expect(dialogo()!.textContent).toContain("A quantidade do rolo R-001 muda de 10 para 12,5 m. O estoque do lote de origem e o valor da OC são recalculados.");
    expect(h.ajuste).not.toHaveBeenCalled();
    expect(botaoDialogo("Ajustar quantidade")!.className).not.toContain("destructive");

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    await esperar(30);
    expect(h.ajuste).not.toHaveBeenCalled();
    expect(campoQtd()!.value).toBe("10,00"); // o campo volta ao valor anterior (formato em repouso)

    await digitarEsair("12,5");
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Ajustar quantidade")!);
    await aguardar(() => h.ajuste.mock.calls.length === 1, "ajuste chamado");
    expect(h.ajuste).toHaveBeenCalledWith("ro1", 12.5);
    await esperar(30);
    expect(h.ajuste).toHaveBeenCalledTimes(1);
  });
  it("sair do campo SEM mudar o valor não abre diálogo nem ajusta", async () => {
    const h = { cancelar: vi.fn(), ajuste: vi.fn() };
    await abrir({}, h);
    await aguardar(() => !!campoQtd(), "campo");
    await digitarEsair("10,00");
    await esperar(50);
    expect(dialogo()).toBeNull();
    expect(h.ajuste).not.toHaveBeenCalled();
  });
});
