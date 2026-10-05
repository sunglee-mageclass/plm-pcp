// @vitest-environment happy-dom
// [urg R1 T8 · fix round 1] Impressão da ficha com a leitura dos tamanhos vinculados: falha => erro visível (toast com
// "Tentar de novo") e NUNCA imprime sozinho quando a leitura se recupera (só no clique do usuário, com dado pronto);
// o botão "Ficha Técnica" do PCP Serviços espera os vínculos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("@/integrations/supabase/client", async () => {
  const { FAKE } = await import("./fake-supabase");
  return { supabase: FAKE.supabase };
});
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { PrintFicha } from "@/components/producao/PrintFicha";
import { BotaoFichaTecnica } from "@/components/producao/cad/BotaoFichaTecnica";

let desmontar: (() => Promise<void>) | null = null;
const imprimir = vi.fn();
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", tenant_id: "t1" }];
  FAKE.linhas.etiquetas = [{ id: "e1", tenant_id: "t1", formato_tamanho: "nenhum", tamanho_vinculado: "P", variantes_etiqueta: [] }];
  imprimir.mockClear();
  (window as any).print = imprimir;
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const btns = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
const porTexto = (t: string) => btns().find((b) => (b.textContent ?? "").includes(t)) ?? null;
const erroComRetry = () => toastMock.error.mock.calls.find((c) => c[1]?.action?.label === "Tentar de novo");

describe("PrintFicha — falha da leitura dos tamanhos vinculados", () => {
  const el = (qc: QueryClient, token: number) =>
    createElement(QueryClientProvider, { client: qc }, createElement(PrintFicha, { modeloId: "m1", kind: "tecnica", token }));

  it("F1: pedido de impressão + leitura falhou => erro com 'Tentar de novo'; ao recuperar NÃO imprime sozinho; novo clique imprime", async () => {
    FAKE.falhar("etiquetas", 3); // o hook tem retry:1 (2 leituras) + a leitura antiga ft-etiquetas-semtamanho (1)
    const qc = novoQc();
    const m = await montar(el(qc, 1)); // o clique (token 1) vem ANTES da falha chegar
    desmontar = m.desmontar;
    await aguardar(() => !!erroComRetry(), "toast de erro com Tentar de novo", 6000);
    expect(imprimir).not.toHaveBeenCalled();

    // recupera (a ação do toast refaz a leitura)
    await act(async () => { erroComRetry()![1].action.onClick(); });
    await esperar(1200); // > piso de 400ms do disparo antigo
    expect(imprimir).not.toHaveBeenCalled();

    // clique novo do usuário, com o dado pronto => imprime
    await act(async () => { m.root.render(el(qc, 2)); });
    await aguardar(() => imprimir.mock.calls.length === 1, "impressão no novo clique", 6000);
  });

  it("F1: erro já presente quando o usuário clica => mesmo aviso, sem imprimir", async () => {
    FAKE.falhar("etiquetas", 3);
    const qc = novoQc();
    const m = await montar(el(qc, 0));
    desmontar = m.desmontar;
    await esperar(1500); // a leitura já falhou
    await act(async () => { m.root.render(el(qc, 1)); });
    await aguardar(() => !!erroComRetry(), "toast de erro", 3000);
    expect(imprimir).not.toHaveBeenCalled();
  });
});

describe("PrintFicha — re-render durante a espera das imagens", () => {
  it("fix round 2: um re-render do pai na janela de 'settle' NAO cancela a impressao em curso — exatamente 1 window.print", async () => {
    const qc = novoQc();
    const el = (n: number) =>
      createElement(QueryClientProvider, { client: qc }, createElement("div", { "data-n": n }, createElement(PrintFicha, { modeloId: "m1", kind: "tecnica", token: 1 })));
    const m = await montar(el(0));
    desmontar = m.desmontar;
    await esperar(150); // dado pronto, dentro da janela de 400ms do disparo
    expect(imprimir).not.toHaveBeenCalled();
    for (let i = 1; i <= 3; i++) { // re-renders do pai (PrintFicha re-renderiza, useFichaData devolve funcoes novas)
      await act(async () => { m.root.render(el(i)); });
      await esperar(40);
    }
    await aguardar(() => imprimir.mock.calls.length >= 1, "impressao", 6000);
    await esperar(600);
    expect(imprimir).toHaveBeenCalledTimes(1);
  });
});

describe("BotaoFichaTecnica (PCP Serviços)", () => {
  it("F2: desabilitado enquanto carrega; falha => erro + 'Tentar de novo' (continua desabilitado); recuperou => habilita sem imprimir sozinho", async () => {
    const soltar = FAKE.segurar("etiquetas");
    const onImprimir = vi.fn();
    const m = await montar(createElement(QueryClientProvider, { client: novoQc() }, createElement(BotaoFichaTecnica, { onImprimir, disabled: false })));
    desmontar = m.desmontar;
    expect(porTexto("Ficha Técnica")!.disabled).toBe(true);
    soltar();
    await aguardar(() => porTexto("Ficha Técnica")?.disabled === false, "habilitou com os vínculos", 4000);
    expect(onImprimir).not.toHaveBeenCalled();
  });

  it("F2: falha na leitura => texto de erro + Tentar de novo; botão travado até recuperar", async () => {
    FAKE.falhar("etiquetas", 2);
    const onImprimir = vi.fn();
    const m = await montar(createElement(QueryClientProvider, { client: novoQc() }, createElement(BotaoFichaTecnica, { onImprimir, disabled: false })));
    desmontar = m.desmontar;
    await aguardar(() => !!porTexto("Tentar de novo"), "erro com retry", 6000);
    expect(document.body.textContent).toContain("Não foi possível carregar os dados");
    expect(porTexto("Ficha Técnica")!.disabled).toBe(true);
    await clicar(porTexto("Tentar de novo")!);
    await aguardar(() => porTexto("Ficha Técnica")?.disabled === false, "recuperou", 4000);
    expect(document.body.textContent).not.toContain("Não foi possível carregar os dados");
    expect(onImprimir).not.toHaveBeenCalled();
  });

  it("respeita o disabled do chamador (sem CAD)", async () => {
    const m = await montar(createElement(QueryClientProvider, { client: novoQc() }, createElement(BotaoFichaTecnica, { onImprimir: () => {}, disabled: true })));
    desmontar = m.desmontar;
    await esperar(100);
    expect(porTexto("Ficha Técnica")!.disabled).toBe(true);
  });
});
