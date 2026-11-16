// @vitest-environment happy-dom
// Kanban PL — Onda 3, Task 7: card "Etapas PL" da Config da Loja (colunas + requisitos + chave).
// (1) regras puras da edição (`etapas-pl-edicao`): renomear MIGRA o requisito, ordem/remoção/porta de entrada;
// (2) render de verdade do card (react-dom/client + act; sem @testing-library — o vitest só inclui `*.test.ts`, por isso sem JSX):
//     lista as colunas, abre o diálogo de requisitos com as condições PL, a 1ª coluna (porta de entrada) aceita TODAS as condições (dono liberou 13/11),
//     as demais o catálogo inteiro, e o switch da chave usa as RPCs PL (sem prévia de ligar);
// (3) o uso do Dev segue intacto (defaults do contrato `KANBAN_CHAVE_API_DEV`).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { EtapasPlConfigCard, type EtapasPlConfigCardProps } from "@/components/admin/EtapasPlConfigCard";
import { KANBAN_CHAVE_API_DEV } from "@/components/admin/KanbanAutomaticoDialog";
import { CONDICOES_PL } from "@/lib/etapas-pl-condicoes";
import {
  CONDICOES_ENTRADA_PL, aplicarMudancaBoardPl, condicoesIndisponiveisPl, fecharEdicaoBoardPl, rotulosComChaveRepetidaPl,
  type EdicoesBoardPl,
} from "@/lib/etapas-pl-edicao";
import { serializarColuna } from "@/lib/config-loja-colab";

const ROOT = process.cwd() + "/"; // (em happy-dom `import.meta.url` não é file:)
const KEYS = CONDICOES_PL.map((c) => c.key);

describe("etapas-pl-edicao (regras puras)", () => {
  it("porta de entrada LIBERADA (dono 13/11): a 1ª coluna aceita QUALQUER condição, como as demais", () => {
    // CONDICOES_ENTRADA_PL segue existindo só como sugestão/texto, não como restrição.
    expect([...CONDICOES_ENTRADA_PL]).toEqual(["tem_peca_teste", "enviado_a_servicos"]);
    expect(condicoesIndisponiveisPl(true, KEYS, [])).toEqual([]);  // 1ª coluna: nada bloqueado
    expect(condicoesIndisponiveisPl(false, KEYS, [])).toEqual([]); // demais: nada bloqueado
    expect(condicoesIndisponiveisPl(true, KEYS, ["cq_liberado"])).toEqual([]);
  });

  it("renomear MIGRA o requisito para a key nova (a porta de entrada não perde a condição)", () => {
    const r = aplicarMudancaBoardPl(["Peça Teste", "Costura"], ["Peça Teste X", "Costura"], { peca_teste: ["tem_peca_teste"], costura: ["materiais_separados"] });
    expect(r.requisitos).toEqual({ peca_teste_x: ["tem_peca_teste"], costura: ["materiais_separados"] });
  });

  it("digitação tecla a tecla: o label vazio no meio NÃO perde o requisito", () => {
    let board = ["Entrada", "Fim"];
    let reqs: Record<string, string[]> = { entrada: ["tem_peca_teste"] };
    let origem: EdicoesBoardPl = {};
    for (const novo of ["Entrad", "", "N", "Ne", "Novo"]) {
      const depois = [novo, "Fim"];
      const r = aplicarMudancaBoardPl(board, depois, reqs, origem);
      board = depois; reqs = r.requisitos; origem = r.origem;
    }
    expect(reqs).toEqual({ novo: ["tem_peca_teste"] });
    expect(fecharEdicaoBoardPl(origem, 0)).toEqual({}); // blur: a edição acabou
  });

  /** Digita `textos` na coluna `i`, tecla a tecla, e devolve o estado final (sem blur). */
  const digitar = (board: string[], reqs: Record<string, string[]>, i: number, textos: string[]) => {
    let origem: EdicoesBoardPl = {};
    for (const t of textos) {
      const depois = board.map((l, j) => (j === i ? t : l));
      const r = aplicarMudancaBoardPl(board, depois, reqs, origem);
      board = depois; reqs = r.requisitos; origem = r.origem;
    }
    return { board, reqs, origem };
  };

  it("M1: renomear passando por nome de OUTRA coluna não herda o requisito dela (e o da outra fica intacto)", () => {
    const r = digitar(["Pronto", "Pront"], { pronto: ["cq_liberado"], pront: ["tem_peca_teste"] }, 1, ["Pronto", "Pronto2"]);
    expect(r.reqs).toEqual({ pronto: ["cq_liberado"], pronto2: ["tem_peca_teste"] });
  });

  it("M1: cenário real — 'Costura' (col 1) e a col 2 vira 'Costura Final' digitando por cima, passando por 'Costura'", () => {
    const r = digitar(["Costura", "Cost"], { costura: ["materiais_separados"], cost: ["cq_liberado"] }, 1,
      ["Costu", "Costur", "Costura", "Costura ", "Costura F", "Costura Final"]);
    expect(r.reqs).toEqual({ costura: ["materiais_separados"], costura_final: ["cq_liberado"] });
  });

  it("M1: renomear direto (sem colisão transitória) segue migrando certo", () => {
    const r = digitar(["A", "B"], { a: ["tem_peca_teste"], b: ["cq_liberado"] }, 1, ["B2"]);
    expect(r.reqs).toEqual({ a: ["tem_peca_teste"], b2: ["cq_liberado"] });
    // e voltar ao nome original restaura exatamente o estado de antes
    expect(digitar(["A", "B"], { a: ["tem_peca_teste"], b: ["cq_liberado"] }, 1, ["B2", "B"]).reqs).toEqual({ a: ["tem_peca_teste"], b: ["cq_liberado"] });
  });

  it("M1: depois do blur a próxima edição parte do salvo (foto nova da key original)", () => {
    let e = digitar(["A", "B"], { a: ["tem_peca_teste"], b: ["cq_liberado"] }, 1, ["B2"]);
    e = { ...e, origem: fecharEdicaoBoardPl(e.origem, 1) };
    const r = digitar(e.board, e.reqs, 1, ["B3"]);
    expect(r.reqs).toEqual({ a: ["tem_peca_teste"], b3: ["cq_liberado"] });
  });

  it("arrastar zera a edição em curso (índices mudaram) e não mexe nos requisitos", () => {
    const e = digitar(["A", "B"], { a: ["tem_peca_teste"], b: ["cq_liberado"] }, 1, ["B2"]);
    const r = aplicarMudancaBoardPl(e.board, ["B2", "A"], e.reqs, e.origem);
    expect(r.requisitos).toEqual(e.reqs);
    expect(r.origem).toEqual({});
  });

  it("reordenar não mexe nos requisitos; remover apaga o da coluna (e só dela); adicionar não inventa", () => {
    const reqs = { a: ["tem_peca_teste"], b: ["cq_liberado"] };
    expect(aplicarMudancaBoardPl(["A", "B"], ["B", "A"], reqs).requisitos).toEqual(reqs);
    expect(aplicarMudancaBoardPl(["A", "B"], ["A"], reqs).requisitos).toEqual({ a: ["tem_peca_teste"] });
    expect(aplicarMudancaBoardPl(["A", "B"], ["A", "B", "C"], reqs).requisitos).toEqual(reqs);
  });

  it("renomear para um nome que outra coluna já usa não sobrescreve o requisito dela", () => {
    const r = aplicarMudancaBoardPl(["A", "B"], ["A", "A"], { a: ["tem_peca_teste"], b: ["cq_liberado"] });
    expect(r.requisitos.a).toEqual(["tem_peca_teste"]);
    expect(rotulosComChaveRepetidaPl(["A", "a", "B"])).toEqual(["a"]);
  });

  it("serialização: coluna em branco não vai para o banco (nem conta como mudança)", () => {
    expect(serializarColuna("etapas_pl_kanban", ["Entrada", "  ", "", "Fim"])).toEqual(["Entrada", "Fim"]);
    expect(serializarColuna("etapas_pl_requisitos", { a: ["x"] })).toEqual({ a: ["x"] });
  });
});

// ── render ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let raiz: Root | null = null;
let el: HTMLDivElement;

function montar(over: Partial<EtapasPlConfigCardProps> = {}) {
  const props: EtapasPlConfigCardProps = {
    board: ["Peça Teste", "Costura", "Acabamento"],
    requisitos: { peca_teste: ["tem_peca_teste"], costura: ["materiais_separados"] },
    onChange: vi.fn(),
    onRequisitosChange: vi.fn(),
    ligado: false,
    boardSalvo: ["Peça Teste", "Costura", "Acabamento"],
    disponivel: true,
    dirty: false,
    timezone: "America/Sao_Paulo",
    onMudou: vi.fn(),
    ...over,
  };
  el = document.createElement("div");
  document.body.appendChild(el);
  raiz = createRoot(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => { raiz!.render(h(QueryClientProvider, { client: qc }, h(EtapasPlConfigCard, props))); });
  return props;
}

const botoes = (raizEl: ParentNode = document.body) => Array.from(raizEl.querySelectorAll("button"));
// O `extra` de cada linha é renderizado 2× (layout desktop + mobile): a coluna `i` é o botão `2*i` (desktop).
const botaoRequisitos = (i: number) => botoes(el).filter((b) => /^Requisitos/.test((b.textContent ?? "").trim()))[2 * i]!;
const clicar = (b: Element) => act(() => { (b as HTMLElement).click(); });
/** Linha de checkbox (label) do diálogo aberto pelo rótulo da condição. */
const linhaCond = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => (l.textContent ?? "").includes(label))!;
const desabilitada = (label: string) => {
  const cb = linhaCond(label).querySelector("button[role=checkbox]")!;
  return cb.hasAttribute("disabled") || cb.getAttribute("data-disabled") !== null;
};

beforeEach(() => {
  rpc.mockReset();
  act(() => { raiz?.unmount(); });
  raiz = null;
  document.body.replaceChildren();
});

describe("EtapasPlConfigCard (render)", () => {
  it("lista as colunas (labels), marca a 1ª como porta de entrada e leva o anel de presença do bloco", () => {
    montar();
    const inputs = Array.from(el.querySelectorAll("input")).map((i) => (i as HTMLInputElement).value);
    expect(inputs).toEqual(expect.arrayContaining(["Peça Teste", "Costura", "Acabamento"]));
    expect(el.querySelectorAll("[data-testid=etapas-pl-porta-entrada]")).toHaveLength(2); // desktop + mobile (mesmo extra, 2 layouts)
    expect(el.firstElementChild!.getAttribute("data-colab-path")).toBe("cfg:etapas_pl");
    expect(botaoRequisitos(0).textContent).toContain("(1)"); // Peça Teste: tem_peca_teste
  });

  it("abre os requisitos de uma coluna comum: mostra TODAS as condições PL (inclui M.O. aprovada e Grade preenchida); só a HERDADA da porta de entrada fica travada", () => {
    montar();
    clicar(botaoRequisitos(1)); // Costura
    const diag = document.body.querySelector("[role=dialog]")!;
    expect(diag).toBeTruthy();
    expect(diag.getAttribute("data-colab-path")).toBe("cfg:etapas_pl_requisitos");
    for (const c of CONDICOES_PL) expect(diag.textContent).toContain(c.label);
    expect(diag.textContent).toContain("M.O. aprovada");
    expect(diag.textContent).toContain("Grade preenchida");
    // cascata: `tem_peca_teste` é requisito da 1ª coluna ⇒ herdado aqui (marcado e travado, selo com a origem); as demais selecionáveis
    expect(linhaCond("Tem peça teste").textContent).toContain("herdado de Peça Teste");
    for (const c of CONDICOES_PL) expect(desabilitada(c.label), c.key).toBe(c.key === "tem_peca_teste");
    expect(linhaCond("Enviado a Serviços").textContent).not.toContain("só entrada"); // restrição é SÓ da 1ª coluna
  });

  it("1ª coluna (porta de entrada) LIBERADA: TODAS as condições PL selecionáveis, nenhuma esmaecida (dono 13/11)", () => {
    montar();
    clicar(botaoRequisitos(0));
    expect(document.body.querySelector("[role=dialog]")).toBeTruthy();
    const porKey = Object.fromEntries(CONDICOES_PL.map((c) => [c.key, c.label]));
    for (const k of KEYS) {
      expect(desabilitada(porKey[k]), k).toBe(false);
      expect(linhaCond(porKey[k]).textContent).not.toContain("só entrada");
    }
  });

  it("marcar um requisito grava no mapa pela key da coluna (e desmarcar o último remove a chave)", () => {
    const props = montar();
    clicar(botaoRequisitos(1)); // Costura
    const cb = linhaCond("Lançado").querySelector("button[role=checkbox]")!;
    clicar(cb);
    expect(props.onRequisitosChange).toHaveBeenCalledWith({ peca_teste: ["tem_peca_teste"], costura: ["materiais_separados", "lancado"] });
  });

  it("board vazio: avisa, e ligar fica travado com o motivo (ligar é recusado sem colunas)", () => {
    montar({ board: [], boardSalvo: [], requisitos: {} });
    expect(el.querySelector("[data-testid=etapas-pl-aviso-vazio]")).toBeTruthy();
    const sw = el.querySelector("button[role=switch]")!;
    expect(sw.hasAttribute("disabled") || sw.getAttribute("data-disabled") !== null).toBe(true);
    expect(el.textContent).toContain("Adicione as colunas e salve antes de ligar");
  });

  it("página suja trava a chave (a RPC age sobre o que está GRAVADO)", () => {
    montar({ dirty: true });
    const sw = el.querySelector("button[role=switch]")!;
    expect(sw.hasAttribute("disabled") || sw.getAttribute("data-disabled") !== null).toBe(true);
    expect(el.textContent).toContain("Salve ou descarte");
  });

  it("ligar usa a RPC do PL, SEM prévia (o número de cards vem no retorno) e avisa o resultado", async () => {
    rpc.mockResolvedValue({ data: { ligado: true, mudou: true, lote_id: "L1", snapshot: 3, cards_movidos: 2 }, error: null });
    const props = montar();
    clicar(el.querySelector("button[role=switch]")!);
    const diag = document.body.querySelector("[data-testid=kanban-dialogo-ligar]")!;
    expect(diag.textContent).toContain("Ligar o kanban automático das etapas?");
    expect(diag.textContent).not.toContain("Calculando a prévia");
    expect(rpc).not.toHaveBeenCalled(); // nenhuma prévia de ligar
    const confirmar = diag.querySelector("[data-testid=kanban-dialogo-confirmar]") as HTMLButtonElement;
    expect(confirmar.disabled).toBe(false);
    await act(async () => { confirmar.click(); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("etapas_pl_definir_automatico", { _ligar: true });
    expect(props.onMudou).toHaveBeenCalled();
  });

  it("desligar pede a prévia de restauração do PL (lote null = o último de ligar)", async () => {
    rpc.mockResolvedValue({ data: { lote_id: null, chave_ligada: true, total: 0, voltam: 0, movidos_depois: 0, lotes_superados: 0, cards: [], avisos: [] }, error: null });
    montar({ ligado: true });
    expect(el.querySelector("[data-testid=etapas-pl-aviso-ligado]")).toBeTruthy();
    await act(async () => { clicar(el.querySelector("button[role=switch]")!); });
    expect(rpc).toHaveBeenCalledWith("etapas_pl_previa_restauracao", { _lote_id: null });
  });

  it("renomear a coluna chama onChange com o requisito já migrado (um único setCfg)", () => {
    const props = montar();
    const input = Array.from(el.querySelectorAll("input")).find((i) => (i as HTMLInputElement).value === "Peça Teste") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "Entrada"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(props.onChange).toHaveBeenCalledWith({
      board: ["Entrada", "Costura", "Acabamento"],
      requisitos: { entrada: ["tem_peca_teste"], costura: ["materiais_separados"] },
    });
  });
});

describe("contrato do diálogo da chave (Dev intocado)", () => {
  it("sem `api`/`textos` o Dev segue nas RPCs e nas queryKeys de sempre", () => {
    expect(KANBAN_CHAVE_API_DEV.prefixoQuery).toBe("kanban");
    expect(KANBAN_CHAVE_API_DEV.previaLigar).toBeTypeOf("function"); // o Dev TEM prévia de ligar
    const src = readFileSync(ROOT + "src/components/admin/KanbanAutomaticoDialog.tsx", "utf8");
    expect(src).toMatch(/previaLigar: \(\) => kanbanPreviaRecalculo\(\{ kanban_automatico: true \}\)/);
    expect(src).toMatch(/definir: kanbanDefinirAutomatico/);
    expect(src).toMatch(/previaRestauracao: \(\) => kanbanPreviaRestauracao\(null\)/);
    expect(src).toMatch(/api = KANBAN_CHAVE_API_DEV/);
    const rota = readFileSync(ROOT + "src/routes/_authenticated/admin/configuracoes.tsx", "utf8");
    expect(rota).not.toMatch(/<KanbanAutomaticoBloco[^>]*api=/); // o card "Status do Kanban" não passa `api`: usa o default do Dev
  });

  it("a página monta o card novo no bloco etapasPl e o EtapasPLCard antigo saiu", () => {
    const rota = readFileSync(ROOT + "src/routes/_authenticated/admin/configuracoes.tsx", "utf8");
    expect(rota).toMatch(/\{blocos\.etapasPl && \(\s*<EtapasPlConfigCard/);
    expect(rota).not.toContain("EtapasPLCard");
    expect(rota).not.toContain("cfg:pcp_etapas\" className"); // o wrapper antigo do anel
    // a chave `etapas_pl_automatico` NÃO entra no estado da tela (só pela RPC)
    expect(rota).not.toMatch(/etapas_pl_automatico: (false|true)/);
  });
});
