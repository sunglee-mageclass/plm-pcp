// @vitest-environment happy-dom
// Render/unit — Manual (A4) "O que falta para avançar" (`OQueFaltaPanel`). O foco é a tradução
// keys→PT (via o catálogo `CONDICAO_BY_KEY`) e os ESTADOS (não derivável / com pendências / sem
// pendência / carregando / erro). As 3 peças (`derivarModelo`/`faltandoPara`/`CONDICAO_BY_KEY`) são
// puras — aqui só mockamos os DADOS (tenant_config, RPC de condições, linha do modelo).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── supabase mockado: from(...).select(...).eq(...).maybeSingle() e rpc(...) ──
let tenantConfigRow: Record<string, unknown> | null = null;
let modeloRow: Record<string, unknown> | null = null;
let condMap: Record<string, Record<string, boolean>> = {};
let tenantConfigError: unknown = null;
let condError: unknown = null;
let modeloError: unknown = null;

function fromMock(table: string) {
  const row = table === "tenant_config" ? tenantConfigRow : modeloRow;
  const err = table === "tenant_config" ? tenantConfigError : modeloError;
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: err ? null : row, error: err }),
  };
  return chain;
}
const rpc = vi.fn(async () => ({ data: condError ? null : condMap, error: condError }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => fromMock(t), rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));

import { OQueFaltaPanel, pendenciasEmPt } from "@/components/manual/OQueFaltaPanel";
import { CONDICAO_BY_KEY } from "@/lib/kanban-condicoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── infra de render ──
let roots: Array<{ root: Root; el: HTMLElement }> = [];
let qc: QueryClient;

function montar(el: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(createElement(QueryClientProvider, { client: qc }, el)); });
  roots.push({ root, el: container });
  return container;
}
async function esperar(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout esperando a condição");
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}
const corpo = () => document.body.textContent ?? "";

beforeEach(() => {
  rpc.mockClear();
  tenantConfigError = condError = modeloError = null;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Board de 3 colunas; a 2ª (prova) exige data_piloto1 E data_desenho_tecnico.
  tenantConfigRow = {
    tenant_id: "t1",
    kanban_automatico: true,
    status_kanban: [
      { key: "desenho", label: "Desenho" },
      { key: "prova", label: "Prova de Roupa" },
      { key: "aprovado", label: "Aprovado" },
    ],
    kanban_requisitos: { prova: ["data_piloto1", "data_desenho_tecnico"], aprovado: ["data_aprovacao"] },
    kanban_requisitos_excecoes: {},
  };
  modeloRow = { origem: null, status_desenvolvimento: "desenho", ordem_criacao_enviada: true, lancado: false };
  condMap = { m1: {} };
});
afterEach(() => {
  for (const r of roots) { act(() => { r.root.unmount(); }); r.el.remove(); }
  roots = [];
  document.body.innerHTML = "";
});

async function abrir() {
  montar(createElement(OQueFaltaPanel, { modeloId: "m1" }));
  await esperar(() => !corpo().includes("Carregando"));
}

// ── tradução pura keys→PT ──
describe("pendenciasEmPt — tradução pelo catálogo", () => {
  it("usa o label PT do catálogo (CONDICAO_BY_KEY) e carrega descrição/aviso", () => {
    const out = pendenciasEmPt(["data_piloto1"]);
    expect(out[0].label).toBe(CONDICAO_BY_KEY.get("data_piloto1")!.label);
    expect(out[0].descricao).toBe(CONDICAO_BY_KEY.get("data_piloto1")!.descricao);
  });
});

// ── estados ──
describe("OQueFaltaPanel — estados", () => {
  it("card NÃO derivável (ordem não enviada): mensagem adequada, sem lista", async () => {
    modeloRow = { origem: null, status_desenvolvimento: null, ordem_criacao_enviada: false, lancado: false };
    await abrir();
    expect(corpo()).toContain("ainda não entrou no fluxo automático");
    expect(corpo()).not.toContain("Data de Piloto I preenchida");
    expect(corpo()).not.toContain("atende aos requisitos");
  });

  it("card já lançado: mensagem de lançado, sem lista", async () => {
    modeloRow = { origem: null, status_desenvolvimento: "aprovado", ordem_criacao_enviada: true, lancado: true };
    await abrir();
    expect(corpo()).toContain("Card já lançado");
    expect(corpo()).not.toContain("atende aos requisitos");
  });

  it("2 condições faltando: lista os 2 labels PT (+ etapa atual e próxima)", async () => {
    // cond vazio ⇒ data_piloto1 e data_desenho_tecnico faltam para entrar em "Prova de Roupa".
    await abrir();
    const c = corpo();
    expect(c).toContain(CONDICAO_BY_KEY.get("data_piloto1")!.label); // "Data de Piloto I preenchida"
    expect(c).toContain(CONDICAO_BY_KEY.get("data_desenho_tecnico")!.label); // "Data do Desenho Técnico preenchida"
    expect(c).toContain("Prova de Roupa"); // próxima coluna
    expect(c).not.toContain("atende aos requisitos");
    const itens = Array.from(document.body.querySelectorAll("ul li"));
    expect(itens).toHaveLength(2);
  });

  it("sem pendência: mensagem 'atende aos requisitos ✓'", async () => {
    // todas as condições do fluxo satisfeitas ⇒ nada falta.
    condMap = { m1: { data_piloto1: true, data_desenho_tecnico: true, data_aprovacao: true } };
    await abrir();
    expect(corpo()).toContain("atende aos requisitos da próxima fase ✓");
    expect(document.body.querySelectorAll("ul li")).toHaveLength(0);
  });

  it("carregando: mostra 'Carregando…' e NUNCA 'atende aos requisitos'", async () => {
    // segura a RPC de condições pendente
    let resolver: (v: unknown) => void = () => {};
    rpc.mockImplementationOnce(() => new Promise((r) => { resolver = r; }));
    montar(createElement(OQueFaltaPanel, { modeloId: "m1" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(corpo()).toContain("Carregando");
    expect(corpo()).not.toContain("atende aos requisitos");
    resolver({ data: { m1: {} }, error: null });
    await esperar(() => !corpo().includes("Carregando"));
  });

  it("erro de carga: aviso + 'Tentar de novo' (nunca 'nada falta')", async () => {
    condError = { code: "XX000", message: "falhou" };
    montar(createElement(OQueFaltaPanel, { modeloId: "m1" }));
    await esperar(() => corpo().includes("Tentar de novo"));
    expect(corpo()).not.toContain("atende aos requisitos");
    expect(corpo()).not.toContain("Data de Piloto I");
    // o botão refaz a chamada e, em sucesso, mostra a lista
    condError = null;
    const btn = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("Tentar de novo"))!;
    await act(async () => { btn.click(); });
    await esperar(() => corpo().includes(CONDICAO_BY_KEY.get("data_piloto1")!.label));
  });
});
