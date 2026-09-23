import { describe, it, expect } from "vitest";
import {
  boardDaLoja, colunaManual, derivarModelo, entradaParaDerivacao, fluxoDoModelo, lerKanbanAutoConfig,
  reqsDoModelo, statusDerivado,
} from "@/lib/kanban-auto";
import { CASOS } from "../fixtures/kanban-auto-casos";

describe("kanban-auto — statusDerivado (fixtures compartilhadas com o SQL)", () => {
  for (const c of CASOS) {
    it(c.nome, () => {
      expect(statusDerivado(c.input)).toEqual(c.esperado);
    });
  }
});

describe("kanban-auto — config e fluxo", () => {
  const cfgRaw = {
    kanban_automatico: true,
    status_kanban: ["Em Modelagem", "Stand By", "Em Modelagem", { key: "aprovado", label: "Aprovado" }, 42],
    kanban_requisitos: { em_modelagem: ["modelista_definido"], lixo: "nao-e-array" },
    kanban_requisitos_excecoes: { aprovado: ["modelista_definido"] },
    revenda_kanban_colunas: ["stand_by", "aprovado", 7],
    revenda_kanban_requisitos: { aprovado: ["data_aprovacao"] },
  };

  it("lerKanbanAutoConfig é robusto a lixo e tipos errados", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    expect(cfg.kanban_automatico).toBe(true);
    expect(cfg.kanban_requisitos).toEqual({ em_modelagem: ["modelista_definido"] });
    expect(cfg.kanban_requisitos_excecoes).toEqual({ aprovado: ["modelista_definido"] });
    expect(cfg.revenda_kanban_colunas).toEqual(["stand_by", "aprovado"]);
    expect(lerKanbanAutoConfig(null).kanban_automatico).toBe(false);
    expect(lerKanbanAutoConfig({ kanban_automatico: "true" }).kanban_automatico).toBe(false);
  });

  it("boardDaLoja normaliza e DEDUP por key (fica a 1ª ocorrência)", () => {
    const board = boardDaLoja(lerKanbanAutoConfig(cfgRaw)).map((c) => c.key);
    expect(board).toEqual(["em_modelagem", "stand_by", "aprovado"]);
  });

  it("board vazio → DEFAULT_STATUSES (14 colunas)", () => {
    expect(boardDaLoja(lerKanbanAutoConfig({ status_kanban: [] })).length).toBe(14);
    expect(boardDaLoja(lerKanbanAutoConfig({})).length).toBe(14);
  });

  it("fluxoDoModelo: interno = board; comprado = board ∩ revenda_kanban_colunas ([] = todas)", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    expect(fluxoDoModelo("interno", cfg).map((c) => c.key)).toEqual(["em_modelagem", "stand_by", "aprovado"]);
    expect(fluxoDoModelo("revenda", cfg).map((c) => c.key)).toEqual(["stand_by", "aprovado"]);
    expect(fluxoDoModelo("importado", cfg).map((c) => c.key)).toEqual(["stand_by", "aprovado"]);
    const todas = lerKanbanAutoConfig({ ...cfgRaw, revenda_kanban_colunas: [] });
    expect(fluxoDoModelo("revenda", todas).map((c) => c.key)).toEqual(["em_modelagem", "stand_by", "aprovado"]);
  });

  it("reqsDoModelo: comprado usa revenda_kanban_requisitos e NÃO tem exceções", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    expect(reqsDoModelo("interno", cfg)).toEqual({ reqs: cfg.kanban_requisitos, exc: cfg.kanban_requisitos_excecoes });
    expect(reqsDoModelo("revenda", cfg)).toEqual({ reqs: cfg.revenda_kanban_requisitos, exc: {} });
  });

  it("colunaManual: sem requisito = manual; reprovado SEMPRE manual", () => {
    expect(colunaManual("stand_by", { a: ["x"] })).toBe(true);
    expect(colunaManual("a", { a: ["x"] })).toBe(false);
    expect(colunaManual("reprovado", { reprovado: ["x"] })).toBe(true);
    expect(colunaManual("Reprovado", { reprovado: ["x"] })).toBe(true);
  });

  it("entradaParaDerivacao + derivarModelo montam o input a partir do modelo e da config", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    const modelo = { origem: "revenda", status_desenvolvimento: "stand_by", ordem_criacao_enviada: true, lancado: false };
    const input = entradaParaDerivacao(modelo, cfg, { data_aprovacao: true });
    expect(input).toEqual({
      fluxo: ["stand_by", "aprovado"], reqs: { aprovado: ["data_aprovacao"] }, exc: {}, cond: { data_aprovacao: true },
      status: "stand_by", derivavel: true,
    });
    // stand_by é a ENTRADA do fluxo de comprado → não fixa → vai para aprovado
    expect(derivarModelo(modelo, cfg, { data_aprovacao: true }).resultado).toBe("aprovado");
    expect(derivarModelo({ ...modelo, lancado: true }, cfg, {}).derivavel).toBe(false);
    expect(derivarModelo({ ...modelo, ordem_criacao_enviada: false }, cfg, {}).derivavel).toBe(false);
  });
});
