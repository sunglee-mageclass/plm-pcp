// @vitest-environment happy-dom
// Render/unit — Manual "Requisitos das fases" (`RequisitosFasesPanel`). Foco: montar, por coluna do
// board da loja, a lista de requisitos de ENTRADA (cascata) traduzida em PT pelo catálogo
// (`CONDICAO_BY_KEY`), reusando `requisitosEfetivos`/`colunaManual` do motor (anti-drift TS×SQL).
// A regra é PURA (`fasesComRequisitos`) — aqui mockamos só o `tenant_config`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let tenantConfigRow: Record<string, unknown> | null = null;
let tenantConfigError: unknown = null;
let tenantConfigPendente = false;

function fromMock() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      tenantConfigPendente
        ? new Promise(() => {})
        : Promise.resolve({ data: tenantConfigError ? null : tenantConfigRow, error: tenantConfigError }),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => fromMock() },
}));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));

import { RequisitosFasesPanel, fasesComRequisitos } from "@/components/manual/RequisitosFasesPanel";
import { CONDICAO_BY_KEY } from "@/lib/kanban-condicoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
  tenantConfigError = null;
  tenantConfigPendente = false;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Board de 3 colunas; "prova" exige data_piloto1 + data_desenho_tecnico; "aprovado" exige
  // data_aprovacao (cascata ⇒ aprovado herda os 3). "desenho" (1ª) sem requisito = entra livremente.
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
});
afterEach(() => {
  for (const r of roots) { act(() => { r.root.unmount(); }); r.el.remove(); }
  roots = [];
  document.body.innerHTML = "";
});

async function abrir() {
  montar(createElement(RequisitosFasesPanel));
  await esperar(() => !corpo().includes("Carregando"));
}

// ── regra pura ──
describe("fasesComRequisitos — por coluna, requisitos PT na cascata", () => {
  it("2 colunas com requisitos: lista PT correta (com herança); coluna sem requisito = entra livremente", () => {
    const fases = fasesComRequisitos(tenantConfigRow);
    expect(fases.map((f) => f.key)).toEqual(["desenho", "prova", "aprovado"]);
    // 1ª coluna sem requisito próprio e sem herança = manual.
    expect(fases[0].manual).toBe(true);
    expect(fases[0].requisitos).toHaveLength(0);
    // "prova" exige os 2 próprios.
    expect(fases[1].requisitos.map((r) => r.key).sort()).toEqual(["data_desenho_tecnico", "data_piloto1"]);
    expect(fases[1].requisitos.map((r) => r.label)).toContain(CONDICAO_BY_KEY.get("data_piloto1")!.label);
    // "aprovado" HERDA os 2 de "prova" + o próprio (cascata).
    expect(fases[2].requisitos.map((r) => r.key).sort()).toEqual([
      "data_aprovacao", "data_desenho_tecnico", "data_piloto1",
    ]);
  });

  it("Reprovado é SEMPRE manual mesmo com requisito configurado", () => {
    const tc = {
      ...tenantConfigRow,
      status_kanban: [
        { key: "desenho", label: "Desenho" },
        { key: "reprovado", label: "Reprovado" },
      ],
      kanban_requisitos: { reprovado: ["data_aprovacao"] },
    };
    const fases = fasesComRequisitos(tc);
    const reprovado = fases.find((f) => f.key === "reprovado")!;
    expect(reprovado.manual).toBe(true);
    expect(reprovado.requisitos).toHaveLength(0);
  });
});

// ── render ──
describe("RequisitosFasesPanel — estados", () => {
  it("lista as colunas com 'Para entrar em <Coluna>' e os requisitos PT", async () => {
    await abrir();
    const c = corpo();
    expect(c).toContain("Para entrar em");
    expect(c).toContain("Prova de Roupa");
    expect(c).toContain("Aprovado");
    expect(c).toContain(CONDICAO_BY_KEY.get("data_piloto1")!.label);
    expect(c).toContain(CONDICAO_BY_KEY.get("data_aprovacao")!.label);
    // coluna sem requisito = "entra livremente"
    expect(c).toContain("Entra livremente");
  });

  it("loja SEM requisito em nenhuma coluna: aviso de fases manuais", async () => {
    tenantConfigRow = {
      tenant_id: "t1",
      kanban_automatico: false,
      status_kanban: [
        { key: "desenho", label: "Desenho" },
        { key: "aprovado", label: "Aprovado" },
      ],
      kanban_requisitos: {},
      kanban_requisitos_excecoes: {},
    };
    await abrir();
    expect(corpo()).toContain("não exige nada para avançar");
    expect(corpo()).not.toContain("Para entrar em");
  });

  it("carregando: mostra 'Carregando…'", async () => {
    tenantConfigPendente = true;
    montar(createElement(RequisitosFasesPanel));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(corpo()).toContain("Carregando");
  });

  it("erro de carga: aviso + 'Tentar de novo'", async () => {
    tenantConfigError = { code: "XX000", message: "falhou" };
    montar(createElement(RequisitosFasesPanel));
    await esperar(() => corpo().includes("Tentar de novo"));
    expect(corpo()).toContain("Não foi possível carregar os requisitos das fases");
  });
});
