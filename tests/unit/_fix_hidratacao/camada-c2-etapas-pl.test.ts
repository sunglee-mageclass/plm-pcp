// @vitest-environment happy-dom
// [camada C2 · P-265 A / 4.1 → R9] Etapas PL: o card do quadro NÃO edita mais a peça teste (Saída/Entrada/Aprovação saíram — a peça teste
// vive no card do produto, seção "Peça Teste" do Planejamento, onde "Reprovado" pede "Tem certeza?"). Card REAL (`EtapaCardView`) + Supabase
// falso: o card da coluna Peça Teste não tem campo nem grava nada e só abre o card do produto (com acesso); o card de bloco em Separação
// segue com a Data Enviado e NUNCA oferece Aprovação.
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

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, clicar } from "./dom-helpers";
import { EtapaCardView } from "@/components/producao/etapas/EtapaCardView";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.producao_terceirizados = [{ id: "b1", cad_id: "c1", categoria_terceirizado_id: "cat1", ativo: true, rev: 2, pt_aprovacao: null, pt_data_saida: null, pt_data_entrada: null }];
  FAKE.linhas.cad = [{ id: "c1", observacoes_molde: "" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const CARD_PT: any = {
  tipo: "peca_teste", blocoId: "pt:m1", modeloId: "m1", ref: "R1", nome: "BLUSA", fotoFontes: [], empresa: "Oficina X", origem: "interno", etapa: "peca_teste",
  pecaTeste: { status: "em_teste", dataSaida: "2026-10-05", servicos: ["PL · Oficina X"] },
};
const CARD_BLOCO: any = {
  tipo: "bloco", blocoId: "b1", cadId: "c1", modeloId: "m1", ref: "R1", nome: "BLUSA", fotoFontes: [], empresa: "Oficina X", origem: "interno", etapa: "separacao",
  bloco: { categoria_terceirizado_id: "cat1", data_enviado: null, data_entregue: null, qtd_recebida: null, grade_detalhe: null },
  prazos: { data_prevista: null, data_entregue: null, peca_foto: false, peca_foto_previsao: null, peca_foto_data: null },
};
const rpcs = () => FAKE.chamadas.filter((c) => c.tabela === "rpc:salvar_terceirizados");

async function abrir(card: any, props: Record<string, unknown> = {}) {
  const m = await montar(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(EtapaCardView, { card, minimized: false, onToggleMin: () => {}, onAbrir: () => {}, ...props })));
  desmontar = m.desmontar;
  await esperar(20);
}

describe("[R9] Etapas PL — card da coluna Peça Teste", () => {
  it("em teste: mostra 'em teste · saída dd/mm' + o serviço; NENHUM campo de edição (sem Select, sem data), nada grava", async () => {
    await abrir(CARD_PT, { onAbrirProduto: () => {} });
    const txt = document.body.textContent ?? "";
    expect(txt).toMatch(/Em teste · saída 05\/10/i);
    expect(txt).toContain("PL · Oficina X");
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    expect(txt).not.toContain("Aprovação");
    expect(rpcs()).toHaveLength(0);
  });
  it("aprovada: selo 'Aprovada — aguardando Explosão'", async () => {
    await abrir({ ...CARD_PT, pecaTeste: { status: "aprovada", dataSaida: null, servicos: ["PL · Oficina X"] } }, { onAbrirProduto: () => {} });
    expect(document.body.textContent).toMatch(/Aprovada — aguardando Explosão/i);
  });
  it("com acesso: clicar abre o card do PRODUTO (Planejamento), não o de Serviços", async () => {
    const produto = vi.fn(); const servicos = vi.fn();
    await abrir(CARD_PT, { onAbrirProduto: produto, onAbrir: servicos });
    await clicar(document.querySelector<HTMLElement>("button.block")!);
    expect(produto).toHaveBeenCalledWith("m1");
    expect(servicos).not.toHaveBeenCalled();
  });
  it("sem acesso ao Sheet do Planejamento: não clicável e explica no title", async () => {
    const servicos = vi.fn();
    await abrir(CARD_PT, { onAbrir: servicos });
    expect(document.querySelector("button.block")).toBeNull();
    expect(document.querySelector('[title="Abra pelo Planejamento de Produto (sem acesso ao card)"]')).not.toBeNull();
    expect(servicos).not.toHaveBeenCalled();
  });
});

describe("[R9] Etapas PL — card de bloco", () => {
  it("em Separação: só a Data Enviado; sem Aprovação nem Peça Teste", async () => {
    await abrir(CARD_BLOCO);
    const txt = document.body.textContent ?? "";
    expect(txt).toContain("Data Enviado");
    expect(txt).not.toContain("Aprovação");
    expect(txt).not.toContain("Peça Teste");
    expect(document.querySelector('[role="combobox"]')).toBeNull();
  });
});
