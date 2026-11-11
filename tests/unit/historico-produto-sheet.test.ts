// @vitest-environment happy-dom
// Render/unit — "Histórico" do produto (F5-3 Task 6): `HistoricoProdutoSheet` + hook `useHistoricoModelo`
// (queryKey ["historico-modelo", modeloId]) + helpers puros (fuso, quem, campos visíveis).
// Sem JSX (o vitest do repo só pega `*.test.ts`): `createElement`, como `extrato-estoque-sheet.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() } }));
vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import {
  HistoricoProdutoSheet, fmtQuandoHistorico, quemDoEvento, camposVisiveis,
} from "@/components/planejamento/HistoricoProdutoSheet";
import type { EventoHistorico } from "@/hooks/useHistoricoModelo";

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

/** O Sheet (Radix) renderiza em portal no body. */
const corpo = () => document.body.textContent ?? "";
const itens = () => Array.from(document.body.querySelectorAll('[data-testid="historico-item"]'));

beforeEach(() => {
  rpc.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  for (const r of roots) { act(() => { r.root.unmount(); }); r.el.remove(); }
  roots = [];
  document.body.innerHTML = "";
});

const UUID_COR = "11111111-2222-3333-4444-555555555555";

// Já na ordem DESC que a RPC devolve.
const EVENTOS: EventoHistorico[] = [
  { tipo: "etapa", entidade: "Etapa", acao: "mover", quem: null, quando: "2026-03-13T15:00:00Z", dados: { status: "Em Desenvolvimento", origem: "auto" } },
  {
    tipo: "audit", entidade: "Tecidos", acao: "editar", quem: "Ana Souza", quando: "2026-03-12T15:00:00Z",
    dados: { "Tecido 1 · consumo": { de: 1.5, para: 2 }, rev: { de: 3, para: 4 }, updated_at: { de: "a", para: "b" } },
  },
  {
    tipo: "audit", entidade: "Modelo", acao: "editar", quem: "Bia", quando: "2026-03-10T15:00:00Z",
    dados: { cor_id: { de: null, para: UUID_COR } },
  },
];

function rpcPadrao(eventos: EventoHistorico[]) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "historico_modelo") return { data: eventos, error: null };
    if (fn === "audit_resolver_referencias") return { data: { [UUID_COR]: "Azul Petróleo" }, error: null };
    return { data: null, error: { message: `rpc inesperada ${fn}` } };
  });
}

async function abrir(eventos: EventoHistorico[] = EVENTOS) {
  rpcPadrao(eventos);
  const onOpenChange = vi.fn();
  montar(createElement(HistoricoProdutoSheet, { modeloId: "m1", open: true, onOpenChange }));
  await esperar(() => !corpo().includes("Carregando histórico"));
  return onOpenChange;
}

describe("helpers puros", () => {
  it("fmtQuandoHistorico: dd/mm/aaaa hh:mm no fuso da loja (15:00Z em São Paulo = 12:00)", () => {
    expect(fmtQuandoHistorico("2026-03-12T15:00:00Z", "America/Sao_Paulo")).toBe("12/03/2026 12:00");
    expect(fmtQuandoHistorico("2026-03-12T15:00:00Z", "UTC")).toBe("12/03/2026 15:00");
    expect(fmtQuandoHistorico("lixo", "UTC")).toBe("");
  });

  it("quemDoEvento: nome; etapa sem usuário mostra a origem; senão 'Sistema'", () => {
    expect(quemDoEvento(EVENTOS[1])).toBe("Ana Souza");
    expect(quemDoEvento(EVENTOS[0])).toBe("Sistema (automático)");
    expect(quemDoEvento({ ...EVENTOS[0], dados: { status: "x", origem: "manual" } })).toBe("Manual");
    expect(quemDoEvento({ ...EVENTOS[0], dados: { status: "x", origem: "nova" } })).toBe("Sistema");
    expect(quemDoEvento({ ...EVENTOS[1], quem: null })).toBe("Sistema");
  });

  it("camposVisiveis: tira o ruído técnico (rev, *_at); etapa não tem diff", () => {
    expect(camposVisiveis(EVENTOS[1]).map(([k]) => k)).toEqual(["Tecido 1 · consumo"]);
    expect(camposVisiveis(EVENTOS[0])).toEqual([]);
    expect(camposVisiveis({ ...EVENTOS[1], dados: null })).toEqual([]);
  });
});

describe("HistoricoProdutoSheet", () => {
  it("chama a RPC com o modelo, queryKey certa, e lista os eventos NA ORDEM da RPC", async () => {
    await abrir();
    expect(rpc).toHaveBeenCalledWith("historico_modelo", { _modelo_id: "m1" });
    expect(qc.getQueryData(["historico-modelo", "m1"])).toBeTruthy();
    const c = corpo();
    expect(c).toContain("Histórico do produto");
    const ls = itens().map((li) => li.textContent ?? "");
    expect(ls).toHaveLength(3);
    expect(ls[0]).toContain("Etapa");
    expect(ls[1]).toContain("Tecidos");
    expect(ls[2]).toContain("Modelo");
  });

  it("etapa: badge Moveu, '→ status', origem no lugar de quem, data no fuso da loja", async () => {
    await abrir();
    const li = itens()[0].textContent ?? "";
    expect(li).toContain("Moveu");
    expect(li).toContain("→ Em Desenvolvimento");
    expect(li).toContain("Sistema (automático)");
    expect(li).toContain("13/03/2026 12:00");
  });

  it("auditoria: badge da ação, quem e data; só o campo útil conta como alteração", async () => {
    await abrir();
    const li = itens()[1].textContent ?? "";
    expect(li).toContain("Editou");
    expect(li).toContain("Ana Souza");
    expect(li).toContain("12/03/2026 12:00");
    expect(li).toContain("1 alteração");
  });

  it("expandir mostra o de→para (sem os campos ocultos) e resolve UUID→nome", async () => {
    await abrir();
    expect(corpo()).not.toContain("Tecido 1 · consumo"); // fechado
    const gatilhos = Array.from(document.body.querySelectorAll('[data-testid="historico-item"] button'));
    await act(async () => { (gatilhos[0] as HTMLElement).click(); }); // Tecidos
    const li1 = itens()[1].textContent ?? "";
    expect(li1).toContain("Tecido 1 · consumo:");
    expect(li1).toContain("1.5");
    expect(li1).toContain("2");
    expect(li1).not.toContain("Rev");
    expect(itens()[1].querySelector(".line-through")?.textContent).toBe("1.5");

    await act(async () => { (gatilhos[1] as HTMLElement).click(); }); // Modelo (cor)
    await esperar(() => (itens()[2].textContent ?? "").includes("Azul Petróleo"));
    const li2 = itens()[2].textContent ?? "";
    expect(li2).toContain("Cor:");
    expect(li2).toContain("—"); // de: null
    expect(li2).not.toContain(UUID_COR);
    expect(rpc).toHaveBeenCalledWith("audit_resolver_referencias", { _pares: [{ campo: "cor_id", id: UUID_COR }] });
  });

  it("vazio = 'Sem histórico ainda'", async () => {
    await abrir([]);
    expect(corpo()).toContain("Sem histórico ainda");
    expect(corpo()).not.toContain("Tentar de novo");
  });

  it("erro = 'Não foi possível carregar o histórico' + Tentar de novo (relê; nunca vira 'sem histórico')", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    montar(createElement(HistoricoProdutoSheet, { modeloId: "m1", open: true, onOpenChange: vi.fn() }));
    await esperar(() => corpo().includes("Não foi possível carregar o histórico"));
    expect(corpo()).not.toContain("Sem histórico ainda");
    const botao = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Tentar de novo") as HTMLElement;
    expect(botao).toBeTruthy();

    rpcPadrao(EVENTOS);
    await act(async () => { botao.click(); });
    await esperar(() => itens().length === 3);
    expect(corpo()).not.toContain("Não foi possível carregar o histórico");
  });
});
