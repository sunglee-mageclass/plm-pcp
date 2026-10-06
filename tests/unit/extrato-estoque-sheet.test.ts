// @vitest-environment happy-dom
// Render/unit — "Histórico" do estoque (urgentes R3, plano-a Task 16): Sheet do extrato (`ExtratoEstoqueSheet`), hook
// `useExtratoEstoque` (queryKey ["estoque-extrato", familia, itemId]) e o botão "Histórico" por linha das abas de estoque.
// Sem JSX (o vitest do repo só pega `*.test.ts`): `createElement`, como `modelo-grade-section.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() } }));
vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { ExtratoEstoqueSheet, rodapeDoExtrato, periodoParaDias } from "@/components/estoque/ExtratoEstoqueSheet";
import { montarExtrato, movDeLinhaRpc } from "@/lib/estoque-extrato";
import { mensagemErro } from "@/lib/erro-mensagem";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────── infra de render ─────────────────────────

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
const linhasTabela = () => Array.from(document.body.querySelectorAll("table tbody tr")).map((tr) => tr.textContent ?? "");

beforeEach(() => {
  rpc.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
// limpa portais/árvores entre os testes
afterEach(() => {
  for (const r of roots) { act(() => { r.root.unmount(); }); r.el.remove(); }
  roots = [];
  document.body.innerHTML = "";
});

// ───────────────────────── dados falsos (linhas SNAKE da RPC) ─────────────────────────

type Linha = Record<string, unknown>;
const base = (extra: Linha): Linha => ({
  bucket_variante_id: "v1", bucket_tamanho: null, bucket_cor_id: null, bucket_cor_nome: null,
  quando: null, quando_fonte: "sem_data", tipo: "entrada", origem: "oc", quantidade: 0,
  quem: null, ref_oc: null, ref_modelo: null, ref_id: null, detalhe: null,
  core_recebido: 15, core_baixa: 5, core_fisico: 10,
  ...extra,
});

// 15 entradas − 5 saídas = 10 (= físico). Ordem esperada na tela: sem data → 05/03 → 10/03 → 12/03 → 13/03.
const TECIDO_OK: Linha[] = [
  base({ quando: "2026-03-13T15:00:00Z", quando_fonte: "registro", tipo: "saida", origem: "ajuste", quantidade: -1, quem: "Carla", detalhe: "perda" }),
  base({ quando: "2026-03-10T15:00:00Z", quando_fonte: "registro", tipo: "entrada", origem: "oc", quantidade: 10, quem: "Ana", ref_oc: "101" }),
  base({ quando: "2026-03-12T15:00:00Z", quando_fonte: "registro", tipo: "saida", origem: "corte", quantidade: -4, quem: "Bia", ref_modelo: "REF-77" }),
  base({ quando: null, quando_fonte: "sem_data", tipo: "entrada", origem: "oc", quantidade: 2, ref_oc: "100" }),
  base({ quando: "2026-03-05T03:00:00Z", quando_fonte: "data_oc", tipo: "entrada", origem: "oc", quantidade: 3, ref_oc: "99" }),
];

function props(extra: Record<string, unknown> = {}) {
  return {
    familia: "tecido" as const, itemId: "v1", bucket: { varianteId: "v1" }, titulo: "Malha Suplex — Preto",
    onClose: vi.fn(), ...extra,
  };
}

async function abrir(rows: Linha[], extra: Record<string, unknown> = {}) {
  rpc.mockResolvedValue({ data: rows, error: null });
  const p = props(extra);
  montar(createElement(ExtratoEstoqueSheet, p as any));
  await esperar(() => !corpo().includes("Carregando"));
  return p;
}

// ───────────────────────── Sheet ─────────────────────────

describe("ExtratoEstoqueSheet — cabeçalho e linhas", () => {
  it("título, subtítulo e breadcrumb literais; chama a RPC da família com o id do item", async () => {
    await abrir(TECIDO_OK);
    expect(rpc).toHaveBeenCalledWith("estoque_extrato_tecido", { _variante_tecido_id: "v1" });
    const c = corpo();
    expect(c).toContain("Histórico — Malha Suplex — Preto");
    expect(c).toContain("Extrato de entradas e saídas. O saldo final é o físico da tela de estoque.");
    expect(c).toContain("Entrada e Saída");
    expect(c).toContain("Estoque Tecido");
  });

  it("a queryKey é [estoque-extrato, familia, itemId]", async () => {
    await abrir(TECIDO_OK);
    expect(qc.getQueryData(["estoque-extrato", "tecido", "v1"])).toBeTruthy();
  });

  it("linhas na ordem (sem data primeiro), saldo corrente e datas no fuso da loja", async () => {
    await abrir(TECIDO_OK);
    const ls = linhasTabela();
    expect(ls).toHaveLength(5);
    expect(ls[0]).toContain("sem data");
    expect(ls[0]).toContain("2,00"); // saldo
    expect(ls[1]).toContain("05/03/2026");
    expect(ls[1]).toContain("(data da OC)");
    expect(ls[1]).toContain("5,00");
    expect(ls[2]).toContain("10/03/2026 12:00"); // 15:00Z em São Paulo
    expect(ls[2]).toContain("Ana");
    expect(ls[2]).toContain("OC 101");
    expect(ls[2]).toContain("15,00");
    expect(ls[3]).toContain("REF-77");
    expect(ls[3]).toContain("Bia");
    expect(ls[3]).toContain("11,00");
    expect(ls[4]).toContain("perda");
    expect(ls[4]).toContain("10,00");
    // movimento: StatusBadge entrada/saída
    expect(ls[2]).toContain("Entrada");
    expect(ls[3]).toContain("Saída");
  });

  it("rodapé 'confere' quando o saldo final é o físico da tela", async () => {
    await abrir(TECIDO_OK);
    expect(corpo()).toContain("Saldo final 10,00 m = físico na tela de estoque.");
  });

  it("tecido mostra 'm' e '(kg→m)' só quando o artigo é kg; aviamento/insumo não mostram unidade", async () => {
    await abrir(TECIDO_OK, { kg: true });
    expect(corpo()).toContain("kg→m");
    expect(linhasTabela()[2]).toContain("10,00 m");
  });

  it("aviamento: sem unidade extra", async () => {
    rpc.mockResolvedValue({ data: TECIDO_OK, error: null });
    montar(createElement(ExtratoEstoqueSheet, props({ familia: "aviamento", itemId: "a1", bucket: { varianteId: "v1" } }) as any));
    await esperar(() => !corpo().includes("Carregando"));
    expect(rpc).toHaveBeenCalledWith("estoque_extrato_aviamento", { _aviamento_id: "a1" });
    expect(corpo()).toContain("Estoque Aviamento");
    expect(linhasTabela()[2]).not.toContain(" m");
    expect(corpo()).not.toContain("kg→m");
  });

  it("insumo: filtra o bucket (tamanho, cor) e chama a RPC do insumo", async () => {
    const rows = [
      base({ bucket_variante_id: null, bucket_tamanho: "40|M", bucket_cor_nome: "Azul", quando_fonte: "data_oc", quando: "2026-03-05T03:00:00Z", quantidade: 8, core_recebido: 8, core_baixa: 0, core_fisico: 8 }),
      base({ bucket_variante_id: null, bucket_tamanho: "42|G", bucket_cor_nome: "Azul", quando_fonte: "data_oc", quando: "2026-03-06T03:00:00Z", quantidade: 99, core_recebido: 99, core_baixa: 0, core_fisico: 99 }),
    ];
    rpc.mockResolvedValue({ data: rows, error: null });
    montar(createElement(ExtratoEstoqueSheet, props({ familia: "insumo", itemId: "e1", bucket: { tamanho: "40|M", corNome: "Azul" } }) as any));
    await esperar(() => !corpo().includes("Carregando"));
    expect(rpc).toHaveBeenCalledWith("estoque_extrato_insumo", { _etiqueta_id: "e1" });
    expect(linhasTabela()).toHaveLength(1);
    expect(corpo()).toContain("Saldo final 8,00 = físico na tela de estoque.");
  });
});

describe("ExtratoEstoqueSheet — rodapé (saldo negativo, divergência) e estados", () => {
  it("saldo negativo: explica que a tela mostra 0 (Ruling A17)", async () => {
    await abrir([
      base({ quando: "2026-03-05T03:00:00Z", quando_fonte: "data_oc", quantidade: 2, core_recebido: 2, core_baixa: 5, core_fisico: 0 }),
      base({ quando: "2026-03-06T15:00:00Z", quando_fonte: "registro", tipo: "saida", origem: "corte", quantidade: -5, core_recebido: 2, core_baixa: 5, core_fisico: 0 }),
    ]);
    expect(corpo()).toContain("Saldo calculado -3,00 m (negativo): a tela de estoque mostra 0 — saiu mais do que entrou.");
  });

  it("não confere: 'Diferença de {d} … avise o suporte.' em destructive", async () => {
    await abrir([
      base({ quando: "2026-03-05T03:00:00Z", quando_fonte: "data_oc", quantidade: 4, core_recebido: 10, core_baixa: 0, core_fisico: 10 }),
    ]);
    expect(corpo()).toContain("Diferença de 6,00 m entre o extrato e o estoque — avise o suporte.");
    const el = Array.from(document.body.querySelectorAll("p,div")).find((e) => (e.textContent ?? "").startsWith("Diferença de 6,00"));
    expect(el?.className).toContain("text-destructive");
  });

  it("vazio: 'Nenhum movimento para este item.'", async () => {
    await abrir([]);
    expect(corpo()).toContain("Nenhum movimento para este item.");
    expect(corpo()).not.toContain("Saldo final");
  });

  it("erro de carga: aviso + 'Tentar de novo' (nunca um extrato vazio) e o botão refaz a chamada", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "falhou" } });
    montar(createElement(ExtratoEstoqueSheet, props() as any));
    await esperar(() => corpo().includes("Tentar de novo"), 5000); // 1 retry automático (~1 s) antes do aviso
    expect(corpo()).not.toContain("Nenhum movimento para este item.");
    const antes = rpc.mock.calls.length;
    rpc.mockResolvedValue({ data: TECIDO_OK, error: null });
    const btn = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("Tentar de novo"))!;
    await act(async () => { btn.click(); });
    await esperar(() => corpo().includes("Saldo final 10,00 m"));
    expect(rpc.mock.calls.length).toBeGreaterThan(antes);
  });

  it("erro 42501 sem_permissao_ver: texto PT (não o código cru)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "sem_permissao_ver: entrada_oc_tecido" } });
    montar(createElement(ExtratoEstoqueSheet, props() as any));
    await esperar(() => corpo().includes("Tentar de novo"));
    expect(corpo()).toContain("Você não tem permissão para ver este estoque.");
    expect(corpo()).not.toContain("sem_permissao_ver");
  });

  it("filtro de Origem esconde linhas sem mudar o saldo corrente das visíveis", async () => {
    await abrir(TECIDO_OK);
    // abre "Filtros" (FilterButton multi) e marca só "Corte (Explosão)"
    const filtros = document.body.querySelector('button[aria-label="Filtros"]') as HTMLButtonElement;
    expect(filtros).toBeTruthy();
    await act(async () => { filtros.click(); });
    // dentro do popover há 1 dropdown multi por filtro (aqui só "Origem"): o gatilho mostra "Todos" até marcar algo
    const gatilho = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Todos") as HTMLButtonElement;
    expect(gatilho).toBeTruthy();
    await act(async () => { gatilho.click(); });
    const label = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === "Corte (Explosão)") as HTMLElement;
    expect(label).toBeTruthy();
    await act(async () => { label.click(); });
    const ls = linhasTabela();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toContain("REF-77");
    expect(ls[0]).toContain("11,00"); // saldo corrente sobre TUDO
  });

  it("período vigente mostra a linha 'Saldo anterior'", async () => {
    await abrir(TECIDO_OK, { periodoInicial: { from: new Date(2026, 2, 10), to: new Date(2026, 2, 31) } });
    const ls = linhasTabela();
    expect(ls[0]).toContain("Saldo anterior");
    expect(ls[0]).toContain("5,00"); // sem data (2) + 05/03 (3)
    expect(ls).toHaveLength(4);
  });
});

// ───────────────────────── puros ─────────────────────────

describe("rodapeDoExtrato / periodoParaDias", () => {
  const ext = (rows: Linha[]) => {
    const movs = rows.map(movDeLinhaRpc);
    return { movs, extrato: montarExtrato(movs, { fuso: "America/Sao_Paulo" }) };
  };
  it("ok / negativo / diferença", () => {
    const a = ext(TECIDO_OK);
    expect(rodapeDoExtrato(a.extrato, a.movs, "")).toEqual({ tipo: "ok", texto: "Saldo final 10,00 = físico na tela de estoque." });
    const b = ext([base({ quantidade: 2, core_recebido: 2, core_baixa: 5, core_fisico: 0 }), base({ tipo: "saida", quantidade: -5, core_recebido: 2, core_baixa: 5, core_fisico: 0 })]);
    expect(rodapeDoExtrato(b.extrato, b.movs, "").tipo).toBe("negativo");
    const c = ext([base({ quantidade: 4, core_recebido: 10, core_baixa: 0, core_fisico: 10 })]);
    expect(rodapeDoExtrato(c.extrato, c.movs, "").tipo).toBe("diferenca");
  });
  it("unidade vai junto dos números (tecido: ' m')", () => {
    const a = ext(TECIDO_OK);
    expect(rodapeDoExtrato(a.extrato, a.movs, " m").texto).toBe("Saldo final 10,00 m = físico na tela de estoque.");
  });
  it("Date local do PeriodoPicker → dias YYYY-MM-DD (sem passar pelo UTC)", () => {
    expect(periodoParaDias({ from: new Date(2026, 2, 1), to: new Date(2026, 2, 31) })).toEqual({ de: "2026-03-01", ate: "2026-03-31" });
    expect(periodoParaDias({ from: new Date(2026, 0, 5) })).toEqual({ de: "2026-01-05", ate: undefined });
    expect(periodoParaDias(undefined)).toEqual({ de: undefined, ate: undefined });
  });
});

describe("erro-mensagem — sem_permissao_ver (42501 ASCII da RPC do extrato)", () => {
  it("vira texto PT", () => {
    expect(mensagemErro({ code: "42501", message: "sem_permissao_ver: entrada_oc_aviamento" }, "fb")).toBe(
      "Você não tem permissão para ver este estoque. Peça ao administrador da loja.",
    );
  });
});

// ───────────────────────── botão "Histórico" nas abas ─────────────────────────

vi.mock("@/components/estoque/ExtratoEstoqueSheet", async (orig) => {
  const real = await orig<typeof import("@/components/estoque/ExtratoEstoqueSheet")>();
  // Só nos testes das abas (flag) o Sheet vira um carimbo com o que a aba mandou; nos demais é o REAL.
  return {
    ...real,
    ExtratoEstoqueSheet: (p: any) => (globalThis as any).__STUB_SHEET
      ? createElement("div", { "data-testid": "sheet-stub" }, `HIST:${p.familia}:${p.itemId}:${p.titulo}`)
      : createElement(real.ExtratoEstoqueSheet, p),
  };
});

describe("botão Histórico por linha (abas de estoque)", () => {
  beforeEach(() => { (globalThis as any).__STUB_SHEET = true; });
  afterEach(() => { (globalThis as any).__STUB_SHEET = false; });
  it("aviamento: o botão abre o Sheet com o item certo e NÃO abre/fecha o detalhe da linha (stopPropagation)", async () => {
    const { EstoqueAviamentosTable } = await import("@/components/oc-aviamento/EstoqueAviamentosTab");
    const row = {
      aviamentoId: "av1", aviamentoNome: "Botão", fornecedor: "F", categoria: "C", variId: "var1", varianteLabel: "Preto",
      prevReceb: 0, recebido: 5, baixa: 0, reservado: 0, fisico: 5, previsto: 5,
    };
    const state: any = {
      filtered: [row], grouped: [{ aviamentoId: "av1", aviamentoNome: "Botão", fornecedor: "F", categoria: "C", rows: [row] }],
      sortKey: "varianteLabel", sortState: { sortKey: "varianteLabel", sortDir: "asc", toggle: vi.fn() }, toggle: vi.fn(), isLoading: false, error: null,
    };
    montar(createElement(EstoqueAviamentosTable, { state }));
    const botoes = Array.from(document.body.querySelectorAll('button[aria-label="Histórico"]')) as HTMLButtonElement[];
    expect(botoes.length).toBeGreaterThan(0);
    expect(botoes[0].getAttribute("title")).toBe("Histórico");
    await act(async () => { botoes[0].click(); });
    expect(corpo()).toContain("HIST:aviamento:av1:Botão — Preto");
    // o detalhe da linha ("OCs Recebidas") não abriu
    expect(corpo()).not.toContain("OCs Recebidas");
  });

  it("tecido: linha e card trazem o botão; abre o Sheet da variante (kg→m) sem abrir o detalhe 'Estoque por OC'", async () => {
    const { EstoqueTecidosTable } = await import("@/components/oc-tecido/EstoqueTecidosTab");
    const row = {
      varId: "var9", nomeVariante: "Preto", artigoId: "art1", artigoNome: "Malha Suplex", isKg: true,
      prevRecebKg: 0, prevRecebM: 0, recebidoKg: 5, recebidoM: 10, baixa: 0, reservado: 0, fisico: 10, previsto: 10,
    };
    const state: any = {
      grouped: [{ artigoId: "art1", artigoNome: "Malha Suplex", rows: [row] }], rollup: new Map(),
      sortKey: "nomeVariante", sortState: { sortKey: "nomeVariante", sortDir: "asc", toggle: vi.fn() }, toggle: vi.fn(), isLoading: false, error: null,
    };
    montar(createElement(EstoqueTecidosTable, { state }));
    const botoes = Array.from(document.body.querySelectorAll('button[aria-label="Histórico"]')) as HTMLButtonElement[];
    expect(botoes.length).toBe(2); // 1 na tabela (desktop) + 1 no card (mobile)
    await act(async () => { botoes[0].click(); });
    expect(corpo()).toContain("HIST:tecido:var9:Malha Suplex — Preto");
    expect(corpo()).not.toContain("Estoque por OC");
  });

  it("insumo: um botão por linha de tamanho, com a chave (insumo, tamanho, cor)", async () => {
    const { EstoqueInsumosTable } = await import("@/components/oc-insumo/EstoqueInsumosTab");
    const r = { etiquetaId: "e1", etiquetaNome: "Etiqueta X", tamanho: "40|M", corNome: "Azul", recebido: 8, prevReceb: 0, baixa: 0, fisico: 8 };
    const state: any = { grouped: [{ id: "e1", nome: "Etiqueta X", cores: [{ cor: "Azul", rows: [r] }] }], isLoading: false };
    montar(createElement(EstoqueInsumosTable, { state }));
    const b = document.body.querySelector('button[aria-label="Histórico"]') as HTMLButtonElement;
    expect(b).toBeTruthy();
    await act(async () => { b.click(); });
    expect(corpo()).toContain("HIST:insumo:e1:Etiqueta X — Azul — M · 40");
  });
});
