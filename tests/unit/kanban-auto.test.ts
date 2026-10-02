import { describe, it, expect } from "vitest";
import {
  boardDaLoja, colunaManual, derivarModelo, destinoDrop, entradaParaDerivacao, faltandoPara, fluxoDoModelo,
  lerKanbanAutoConfig, mensagemDrop, reqsDoModelo, statusDerivado, statusParaGate,
} from "@/lib/kanban-auto";
import { CASOS, FLUXO_A, FLUXO_GATE, GATE_CASOS, REQS_A, REQS_GATE } from "../fixtures/kanban-auto-casos";
import { podeEnviarExplosao, refCampoVisivel } from "@/lib/kanban-status";

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

describe("kanban-auto — destinoDrop (tabela única de arraste, fixtures compartilhadas)", () => {
  for (const c of CASOS) {
    for (const a of c.arrastes) {
      it(`${c.nome} → arrastar para "${a.para}" = ${a.acao}`, () => {
        expect(destinoDrop(c.input, a.para)).toEqual({ acao: a.acao, status: a.status, faltando: a.faltando });
      });
    }
  }

  it("faltandoPara: com exceção, junta o que falta nas colunas anteriores (não pula etapa)", () => {
    const input = { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a", derivavel: true };
    expect(faltandoPara(input, "c")).toEqual(["y"]);
    expect(faltandoPara(input, "a")).toEqual([]); // antes da 1ª falha
    expect(faltandoPara({ ...input, cond: { x: true, y: true, z: true } }, "c")).toEqual([]); // nada falha
  });

  it("faltandoPara dedup e ordem de aparição", () => {
    const input = { fluxo: FLUXO_A, reqs: { ...REQS_A, c: ["z", "x"] }, exc: {}, cond: {}, status: null, derivavel: true };
    expect(faltandoPara(input, "c")).toEqual(["x", "y", "z"]);
  });
});

describe("kanban-auto — mensagemDrop (labels do catálogo, plural PT-BR)", () => {
  const fluxo = [{ key: "em_modelagem", label: "Em Modelagem" }, { key: "aprovado", label: "Aprovado" }];
  it("1 dado → singular com o label do catálogo", () => {
    expect(mensagemDrop({ acao: "bloquear_faltando", status: null, faltando: ["data_piloto1"] }, "aprovado", fluxo))
      .toBe("Falta 1 dado para completar: Data de Piloto I preenchida");
  });
  it("N dados → plural, labels na ordem", () => {
    expect(mensagemDrop({ acao: "bloquear_faltando", status: null, faltando: ["data_piloto1", "modelista_definido"] }, "aprovado", fluxo))
      .toBe("Faltam 2 dados para completar: Data de Piloto I preenchida, Modelista definido");
  });
  it("key desconhecida cai na própria key", () => {
    expect(mensagemDrop({ acao: "bloquear_faltando", status: null, faltando: ["xyz"] }, "aprovado", fluxo)).toBe("Falta 1 dado para completar: xyz");
  });
  it("já cumpre usa o label da coluna; fora do fluxo usa a key; demais ações → null", () => {
    expect(mensagemDrop({ acao: "bloquear_ja_cumprida", status: "x", faltando: [] }, "em_modelagem", fluxo))
      .toBe('O card já cumpre "Em Modelagem". Para segurá-lo numa etapa, use uma coluna manual.');
    expect(mensagemDrop({ acao: "fora_do_fluxo", status: "x", faltando: [] }, "zzz", fluxo)).toBe('A etapa "zzz" não faz parte do fluxo deste modelo.');
    expect(mensagemDrop({ acao: "fixar", status: "x", faltando: [] }, "em_modelagem", fluxo)).toBeNull();
    expect(mensagemDrop({ acao: "soltar", status: "x", faltando: [] }, "em_modelagem", fluxo)).toBeNull();
    expect(mensagemDrop({ acao: "nada", status: "x", faltando: [] }, "em_modelagem", fluxo)).toBeNull();
  });
});

describe("kanban-auto — statusParaGate (≡ _kanban_status_gate)", () => {
  const d = { derivavel: true, entrada: "a", alvo: "c", resultado: "stand_by", fixado: true, primeiraFalha: null, faltando: [] };
  it("chave desligada → status gravado", () => expect(statusParaGate(false, d, "stand_by")).toBe("stand_by"));
  it("chave ligada + derivável → alvo (posição derivada)", () => expect(statusParaGate(true, d, "stand_by")).toBe("c"));
  it("não derivável / sem derivação → status gravado", () => {
    expect(statusParaGate(true, { ...d, derivavel: false, alvo: null }, "stand_by")).toBe("stand_by");
    expect(statusParaGate(true, null, "stand_by")).toBe("stand_by");
    expect(statusParaGate(true, null, undefined)).toBeNull();
  });
  // medios R14 kanban #7 (P-190 A): Reprovado é exceção à decisão 10 — com a chave ligada, sem posição para os gates.
  it("chave ligada + reprovado → null (sem posição), mesmo derivável com alvo adiante; normaliza maiúsculas/espaços", () => {
    expect(statusParaGate(true, d, "reprovado")).toBeNull();
    expect(statusParaGate(true, d, " Reprovado ")).toBeNull();
    expect(statusParaGate(true, { ...d, derivavel: false, alvo: null }, "reprovado")).toBeNull();
    expect(statusParaGate(true, null, "REPROVADO")).toBeNull();
    expect(statusParaGate(false, d, "reprovado")).toBe("reprovado");
  });
});

describe("kanban-auto — GATE_CASOS (fixtures compartilhadas com o SQL _kanban_status_gate)", () => {
  for (const g of GATE_CASOS) {
    it(g.nome, () => {
      const der = statusDerivado({ fluxo: FLUXO_GATE, reqs: REQS_GATE, exc: {}, cond: g.cond, status: g.status, derivavel: true });
      expect(statusParaGate(g.ligado, der, g.status)).toBe(g.esperado);
    });
  }
  it("fixture não está vazia e cobre reprovado com alvo ≥ etapa (anti-calado)", () => {
    expect(GATE_CASOS.length).toBeGreaterThanOrEqual(7);
    expect(GATE_CASOS.some((g) => g.ligado && g.status === "reprovado" && g.esperado === null)).toBe(true);
  });
});

describe("kanban-status — statusGate null = sem posição (P-190 A)", () => {
  // board com 'reprovado' DEPOIS da etapa exigida: pelo status gravado a régua passaria
  const board = ["Entrada", "Etapa A", "Etapa C", "Reprovado", "Aprovado"];
  it("podeEnviarExplosao/refCampoVisivel: statusGate null → nada passa; undefined → status gravado (histórico)", () => {
    expect(podeEnviarExplosao(board, "etapa_c", "reprovado").ok).toBe(true);
    expect(podeEnviarExplosao(board, "etapa_c", "reprovado", { statusGate: undefined }).ok).toBe(true);
    expect(podeEnviarExplosao(board, "etapa_c", "reprovado", { statusGate: null }).ok).toBe(false);
    expect(refCampoVisivel(board, "etapa_c", "reprovado", { statusGate: null })).toBe(false);
    expect(podeEnviarExplosao(board, "etapa_c", "reprovado", { statusGate: "aprovado" }).ok).toBe(true);
  });
  it("cadeia statusParaGate → gate: reprovado com chave ligada nunca libera; desligada segue a régua do status", () => {
    const der = statusDerivado({ fluxo: FLUXO_GATE, reqs: REQS_GATE, exc: {}, cond: { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true, data_aprovacao: true }, status: "reprovado", derivavel: true });
    expect(der.fixado).toBe(true);
    expect(der.alvo).toBe("aprovado");
    const fluxoLabels = ["Entrada", "Etapa A", "Etapa B", "Stand By", "Etapa C", "Reprovado", "Aprovado"];
    expect(podeEnviarExplosao(fluxoLabels, "etapa_c", "reprovado", { statusGate: statusParaGate(true, der, "reprovado") }).ok).toBe(false);
    expect(refCampoVisivel(fluxoLabels, "etapa_c", "reprovado", { statusGate: statusParaGate(true, der, "reprovado") })).toBe(false);
    expect(podeEnviarExplosao(fluxoLabels, "etapa_c", "reprovado", { statusGate: statusParaGate(false, der, "reprovado") }).ok).toBe(true);
  });
});
