// @vitest-environment happy-dom
// [camada C2 · P-265 A / 4.1] Etapas PL: escolher "Reprovado" na Aprovação da peça-teste (card do quadro) pede "Tem certeza?" — o card
// SAI do quadro. Card REAL (`EtapaCardView`) + hook real de gravação + Supabase falso: abrir o diálogo não grava; Cancelar não grava
// (o Select segue como estava); Confirmar grava UMA vez; "Aprovado" segue direto, sem diálogo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = { user: { id: "u1" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [], canView: () => true, canEdit: () => true, loading: false, signOut: async () => {} };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { EtapaCardView } from "@/components/producao/etapas/EtapaCardView";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.producao_terceirizados = [{ id: "b1", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 2, pt_aprovacao: null, pt_data_saida: null, pt_data_entrada: null }];
  FAKE.linhas.cad = [{ id: "c1", observacoes_molde: "" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const CARD: any = {
  blocoId: "b1", cadId: "c1", modeloId: "m1", ref: "R1", nome: "BLUSA", fotoFontes: [], empresa: "Oficina X", origem: "interno", etapa: "peca_teste",
  bloco: { id: "b1", categoria_terceirizado_id: "cat1", pt_data_saida: null, pt_data_entrada: null, pt_aprovacao: null },
};
const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_terceirizados");
const gatilho = () => document.querySelector<HTMLElement>('[role="combobox"]');
const opcao = (t: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => (o.textContent ?? "").trim() === t) ?? null;

async function escolher(rotulo: string) {
  await act(async () => { gatilho()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await aguardar(() => !!opcao(rotulo), `opção ${rotulo}`);
  await act(async () => { opcao(rotulo)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
async function abrir() {
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(EtapaCardView, { card: CARD, minimized: false, onToggleMin: () => {}, onAbrir: () => {} })));
  desmontar = m.desmontar;
  await aguardar(() => !!gatilho(), "Select de Aprovação");
}

describe("[camada C2 · 4.1] Etapas PL — Reprovado", () => {
  it("escolher Reprovado abre o diálogo aprovado sem gravar; Cancelar não grava e o Select continua vazio; Reprovar grava UMA vez", async () => {
    await abrir();
    await escolher("Reprovado");
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Reprovar a peça-teste de “BLUSA”?");
    expect(dialogo()!.textContent).toContain("O card R1 · Oficina X sai do quadro de Etapas. Para reabrir, abra o modelo em PCP › Serviços, vá em “PLs reprovadas na peça teste” e mude a Aprovação.");
    expect(botaoDialogo("Reprovar")!.className).toContain("destructive");
    expect(rpcs()).toHaveLength(0);

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "diálogo fechado");
    await esperar(80);
    expect(rpcs()).toHaveLength(0); // Cancelar não grava
    expect(gatilho()!.textContent).not.toContain("Reprovado"); // o Select continua como estava

    await escolher("Reprovado");
    await aguardar(() => !!dialogo(), "diálogo reaberto");
    await clicar(botaoDialogo("Reprovar")!);
    await aguardar(() => rpcs().length === 1, "salvar_terceirizados chamada");
    const bl = (rpcs()[0].payload as any)._blocos[0];
    expect(bl.pt_aprovacao).toBe("reprovado");
    await esperar(80);
    expect(rpcs()).toHaveLength(1);
  });

  it("escolher Aprovado segue DIRETO (sem diálogo)", async () => {
    await abrir();
    await escolher("Aprovado");
    await aguardar(() => rpcs().length === 1, "salvar_terceirizados chamada");
    expect(dialogo()).toBeNull();
    expect((rpcs()[0].payload as any)._blocos[0].pt_aprovacao).toBe("aprovado");
  });
});
