// @vitest-environment happy-dom
// Kanban PL — Onda 3, Task 8: board (EtapasPlKanban) + card (EtapaPlCard).
// (1) distribuição por coluna (puro): status órfão/nulo → 1ª coluna; lançado → terminal "Finalizado"; fluxo vazio = inércia;
// (2) decisão de mover (puro): chave desligada = a pessoa decide; ligada = tabela única (`destinoDropPl`), só os `bloquear_*` travam;
// (3) render real (react-dom + act; vitest só inclui `*.test.ts`, por isso sem JSX): card com selo/foto/atraso, arraste → onMover.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));

import { EtapaPlCard, type ProdutoPlBoard } from "@/components/producao/etapas/EtapaPlCard";
import {
  EtapasPlKanban, colunaEfetivaPl, decidirMoverPl, distribuirPorColunaPl, type EtapasPlKanbanProps,
} from "@/components/producao/etapas/EtapasPlKanban";
import { fluxoEtapasPl, lerEtapasPlConfig } from "@/lib/etapas-pl-config";
import { etapaDoProduto } from "@/lib/etapas-pl-ui";

const cfg = lerEtapasPlConfig({
  etapas_pl_automatico: true,
  etapas_pl_kanban: ["Em Modelagem", "Em Pilotagem", "Stand By", "Aprovado"],
  etapas_pl_requisitos: { em_modelagem: ["tem_peca_teste"], em_pilotagem: ["enviado_a_servicos"], aprovado: ["peca_teste_aprovada", "cq_liberado"] },
});
const fluxo = fluxoEtapasPl(cfg); // em_modelagem, em_pilotagem, stand_by, aprovado

const prod = (id: string, status: string | null, extra: Partial<ProdutoPlBoard> = {}): ProdutoPlBoard => ({
  id, nome: `Produto ${id}`, ref: `REF-${id}`, status_etapa_pl: status, fotoFontes: [], ...extra,
});

describe("distribuirPorColunaPl", () => {
  it("cada produto na sua coluna; órfão e nulo caem na 1ª; lançado vai SÓ para a terminal", () => {
    const m = distribuirPorColunaPl([
      prod("a", "em_pilotagem"), prod("b", "status_que_nao_existe"), prod("c", null),
      prod("d", "aprovado", { lancado: true }), prod("e", "stand_by"),
    ], fluxo);
    expect(m.get("em_modelagem")!.map((p) => p.id)).toEqual(["b", "c"]);
    expect(m.get("em_pilotagem")!.map((p) => p.id)).toEqual(["a"]);
    expect(m.get("stand_by")!.map((p) => p.id)).toEqual(["e"]);
    expect(m.get("aprovado")!).toEqual([]);
    expect(m.get("__lancado")!.map((p) => p.id)).toEqual(["d"]);
  });
  it("fluxo vazio (inércia): só os lançados aparecem; os demais ficam fora", () => {
    const m = distribuirPorColunaPl([prod("a", "em_modelagem"), prod("d", null, { lancado: true })], []);
    expect([...m.keys()]).toEqual(["__lancado"]);
    expect(m.get("__lancado")!.map((p) => p.id)).toEqual(["d"]);
  });
  it("colunaEfetivaPl: status do fluxo = ele; nulo/órfão = 1ª; fluxo vazio = null", () => {
    expect(colunaEfetivaPl("stand_by", fluxo)).toBe("stand_by");
    expect(colunaEfetivaPl("xyz", fluxo)).toBe("em_modelagem");
    expect(colunaEfetivaPl(null, fluxo)).toBe("em_modelagem");
    expect(colunaEfetivaPl("a", [])).toBeNull();
  });
});

describe("decidirMoverPl", () => {
  const base = { cfg, statusAtual: "em_modelagem" as string | null, satisfeitas: {} as Record<string, boolean> };
  it("chave DESLIGADA: a pessoa decide (nada bloqueia por requisito); sem prévia", () => {
    expect(decidirMoverPl({ ...base, ligado: false, para: "aprovado" })).toEqual({ tipo: "mover", destino: null });
  });
  it("ligada + requisito faltando = bloqueia (bloquear_faltando com o que falta)", () => {
    const d = decidirMoverPl({ ...base, ligado: true, para: "aprovado" });
    expect(d.tipo).toBe("bloquear");
    if (d.tipo === "bloquear") {
      expect(d.destino.acao).toBe("bloquear_faltando");
      expect(d.destino.faltando.length).toBeGreaterThan(0);
    }
  });
  it("ligada + coluna manual = permite (fixar), com a prévia da tabela única", () => {
    const d = decidirMoverPl({ ...base, ligado: true, para: "stand_by" });
    expect(d).toEqual({ tipo: "mover", destino: { acao: "fixar", status: "stand_by", faltando: [] } });
  });
  it("mesma coluna, fora do fluxo e terminal = ignora (não chama ninguém)", () => {
    expect(decidirMoverPl({ ...base, ligado: true, para: "em_modelagem" }).tipo).toBe("ignorar");
    expect(decidirMoverPl({ ...base, ligado: false, para: "em_modelagem" }).tipo).toBe("ignorar");
    expect(decidirMoverPl({ ...base, ligado: false, para: "nao_existe" }).tipo).toBe("ignorar");
    expect(decidirMoverPl({ ...base, ligado: true, para: "__lancado" }).tipo).toBe("ignorar");
  });
});

let root: Root | null = null;
let host: HTMLElement;
beforeEach(() => {
  for (const f of Object.values(toastMock)) f.mockClear();
  if (root) { act(() => root!.unmount()); root = null; }
  host?.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
});
const render = (el: any) => { root = createRoot(host); act(() => { root!.render(el); }); };

describe("EtapaPlCard", () => {
  it("mostra nome, REF, selo da etapa e o selo de atraso; clique chama onAbrir(id); sem input editável", () => {
    const onAbrir = vi.fn();
    const p = prod("p1", "em_pilotagem", { atrasoServico: { estado: "atrasado", dias: 3 } });
    render(h(EtapaPlCard, { produto: p, selo: etapaDoProduto(cfg, "em_pilotagem", {}, true), onAbrir }));
    expect(host.textContent).toContain("Produto p1");
    expect(host.textContent).toContain("REF-p1");
    const selo = host.querySelector('[data-testid="etapa-pl-selo"]')!;
    expect(selo.textContent).toContain("Em Pilotagem");
    expect(selo.textContent).toContain("automática" === "x" ? "" : ""); // compacto: modo vira ícone (aria-label)
    expect(selo.querySelector('[aria-label="automática"]')).not.toBeNull();
    expect(selo.getAttribute("title")).toMatch(/^Etapa PL: Em Pilotagem/);
    expect(host.textContent).toMatch(/atrasad/i);
    expect(host.querySelector("input")).toBeNull();
    act(() => { (host.querySelector('[role="button"]') as HTMLElement).click(); });
    expect(onAbrir).toHaveBeenCalledWith("p1");
  });
  it("draggable só quando pedido; lançado mostra o selo Finalizado", () => {
    const p = prod("p2", "aprovado", { lancado: true });
    render(h(EtapaPlCard, { produto: p, selo: etapaDoProduto(cfg, "aprovado", { lancado: true }, true), onAbrir: vi.fn() }));
    expect(host.querySelector('[data-testid="etapa-pl-card"]')!.getAttribute("draggable")).toBe("false");
    expect(host.querySelector('[data-testid="etapa-pl-selo"]')!.textContent).toContain("Finalizado");
  });
  it("'Mover para…' só aparece quando há moverOpts", () => {
    const sel = etapaDoProduto(cfg, "em_modelagem", {}, false);
    render(h(EtapaPlCard, { produto: prod("p3", "em_modelagem"), selo: sel, onAbrir: vi.fn() }));
    expect(host.querySelector('[data-testid="etapa-pl-mover"]')).toBeNull();
    act(() => root!.unmount()); root = null;
    render(h(EtapaPlCard, {
      produto: prod("p3", "em_modelagem"), selo: sel, onAbrir: vi.fn(), onMover: vi.fn(),
      moverOpts: [{ key: "stand_by", label: "Stand By" }],
    }));
    expect(host.querySelector('[data-testid="etapa-pl-mover"]')).not.toBeNull();
  });
});

function drag(el: Element, tipo: "dragstart" | "dragover" | "drop", id: string) {
  const ev: any = new Event(tipo, { bubbles: true, cancelable: true });
  ev.dataTransfer = { getData: () => id, setData: vi.fn(), effectAllowed: "" };
  act(() => { el.dispatchEvent(ev); });
}

describe("EtapasPlKanban (arraste → onMover)", () => {
  const produtos = [
    prod("a", "em_modelagem"), prod("o", "orfao_xyz"), prod("f", "aprovado", { lancado: true }),
  ];
  const montar = (extra: Partial<EtapasPlKanbanProps> = {}) => {
    const onMover = vi.fn();
    render(h(EtapasPlKanban, {
      produtos, cfg, ligado: true, podeMover: true, collapsedCols: new Set<string>(), onToggleCol: vi.fn(),
      onAbrir: vi.fn(), onMover, satisfeitasPorProduto: {}, ...extra,
    }));
    return onMover;
  };
  const coluna = (k: string) => host.querySelector(`[data-testid="etapas-pl-coluna-${k}"]`)!;

  it("renderiza as colunas do board PL na ordem + terminal; órfão na 1ª; lançado só na terminal", () => {
    montar();
    const ids = [...host.querySelectorAll('[data-testid^="etapas-pl-coluna-"]')].map((e) => e.getAttribute("data-testid"));
    expect(ids).toEqual(["em_modelagem", "em_pilotagem", "stand_by", "aprovado", "finalizado"].map((k) => `etapas-pl-coluna-${k}`));
    const naPrimeira = [...coluna("em_modelagem").querySelectorAll("[data-produto-id]")].map((e) => e.getAttribute("data-produto-id"));
    expect(naPrimeira).toEqual(["a", "o"]);
    expect(coluna("aprovado").querySelectorAll("[data-produto-id]")).toHaveLength(0);
    // terminal recolhida por padrão: o card "f" só aparece no mobile (aba) — não vaza em nenhuma coluna do fluxo
    expect(host.querySelectorAll('.hidden [data-produto-id="f"]')).toHaveLength(0);
  });

  it("solta em coluna MANUAL (ligada) → chama onMover(id, coluna, prévia 'fixar')", () => {
    const onMover = montar();
    drag(coluna("stand_by"), "drop", "a");
    expect(onMover).toHaveBeenCalledTimes(1);
    expect(onMover).toHaveBeenCalledWith("a", "stand_by", { acao: "fixar", status: "stand_by", faltando: [] });
  });

  it("L2: soltar o card ÓRFÃO na própria coluna efetiva (a 1ª) NÃO chama onMover; o órfão vai a outra coluna normalmente", () => {
    const onMover = montar({ ligado: false });
    drag(coluna("em_modelagem"), "drop", "o");
    expect(onMover).not.toHaveBeenCalled();
    drag(coluna("stand_by"), "drop", "o");
    expect(onMover).toHaveBeenCalledWith("o", "stand_by", null);
  });

  it("solta em coluna BLOQUEADA (ligada, falta requisito) → NÃO chama onMover; avisa com o que falta", () => {
    const onMover = montar();
    drag(coluna("aprovado"), "drop", "a");
    expect(onMover).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error.mock.calls[0][0]).toMatch(/Faltam:/);
  });

  it("com as condições satisfeitas a mesma coluna deixa de ser bloqueada", () => {
    const onMover = montar({
      satisfeitasPorProduto: { a: { tem_peca_teste: true, enviado_a_servicos: true, peca_teste_aprovada: true, cq_liberado: true } },
    });
    drag(coluna("aprovado"), "drop", "a");
    expect(onMover).toHaveBeenCalledTimes(1);
    expect(onMover.mock.calls[0][1]).toBe("aprovado");
  });

  it("chave DESLIGADA: solta onde quiser (sem bloqueio) e a prévia é null", () => {
    const onMover = montar({ ligado: false });
    drag(coluna("aprovado"), "drop", "a");
    expect(onMover).toHaveBeenCalledWith("a", "aprovado", null);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("podeMover=false: card não é arrastável e o drop não faz nada", () => {
    const onMover = montar({ podeMover: false });
    expect(host.querySelector('[data-produto-id="a"]')!.getAttribute("draggable")).toBe("false");
    drag(coluna("stand_by"), "drop", "a");
    expect(onMover).not.toHaveBeenCalled();
  });

  it("arrastando: destino bloqueado mostra a faixa 'Faltam: …'; a coluna de origem fica neutra", () => {
    montar();
    drag(host.querySelector('[data-produto-id="a"]')!, "dragstart", "a");
    const aprov = coluna("aprovado");
    expect(aprov.getAttribute("data-bloqueada")).toBe("true");
    expect(aprov.textContent).toMatch(/Faltam:/);
    expect(coluna("em_modelagem").getAttribute("data-bloqueada")).toBeNull();
    expect(coluna("stand_by").getAttribute("data-bloqueada")).toBeNull();
  });

  it("soltar na terminal 'Finalizado' não move (ela não aceita drop)", () => {
    const onMover = montar();
    drag(coluna("finalizado"), "drop", "a");
    expect(onMover).not.toHaveBeenCalled();
  });

  it("board vazio = inércia: mensagem, sem colunas do Dev", () => {
    montar({ cfg: lerEtapasPlConfig({ etapas_pl_kanban: [] }), produtos: [prod("a", "em_modelagem")] });
    expect(host.querySelector('[data-testid="etapas-pl-vazio"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid^="etapas-pl-coluna-"]')).toHaveLength(0);
  });
});
