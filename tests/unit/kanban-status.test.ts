import { describe, it, expect } from "vitest";
import {
  resolveStatusKey,
  normalizeKanbanStatuses,
  DEFAULT_STATUSES,
  APROVADO_KEY,
  podeEnviarExplosao,
} from "@/lib/kanban-status";

describe("resolveStatusKey", () => {
  it("label vira a chave snake canônica", () => {
    expect(resolveStatusKey("Aprovado")).toBe("aprovado");
    expect(resolveStatusKey("Corte de Piloto II")).toBe("corte_piloto_2");
    expect(resolveStatusKey("Em Modelagem")).toBe("em_modelagem");
  });
  it("chave já canônica volta igual", () => {
    expect(resolveStatusKey("aprovado")).toBe("aprovado");
    expect(resolveStatusKey("corte_piloto_2")).toBe("corte_piloto_2");
  });
  it("label customizado cai no slugify", () => {
    expect(resolveStatusKey("Algo Custom!")).toBe("algo_custom");
    expect(resolveStatusKey("Acentuação É")).toBe("acentuacao_e");
  });
});

describe("normalizeKanbanStatuses", () => {
  it("vazio/nulo → DEFAULT_STATUSES", () => {
    expect(normalizeKanbanStatuses([])).toBe(DEFAULT_STATUSES);
    expect(normalizeKanbanStatuses(null)).toBe(DEFAULT_STATUSES);
    expect(normalizeKanbanStatuses(undefined)).toBe(DEFAULT_STATUSES);
  });
  it("array de labels (strings) → objetos {key,label,color}", () => {
    const r = normalizeKanbanStatuses(["Em Modelagem", "Aprovado"]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ key: "em_modelagem", label: "Em Modelagem" });
    expect(r[1].key).toBe("aprovado");
    expect(r[0].color).toBeTruthy();
  });
  it("array de objetos preserva key/label", () => {
    const r = normalizeKanbanStatuses([{ key: "stand_by", label: "Stand By" }]);
    expect(r[0]).toMatchObject({ key: "stand_by", label: "Stand By" });
  });
});

describe("APROVADO_KEY", () => {
  it("é fixo em 'aprovado' (gatilho de Enviar ao CAD)", () => {
    expect(APROVADO_KEY).toBe("aprovado");
    expect(DEFAULT_STATUSES.some((s) => s.key === APROVADO_KEY)).toBe(true);
  });
});

describe("podeEnviarExplosao", () => {
  // Board default (14 colunas, aprovado no fim).
  const boardDefault = DEFAULT_STATUSES.map((s) => s.label);

  it("config AUSENTE ⇒ só 'aprovado' libera (comportamento histórico)", () => {
    expect(podeEnviarExplosao(boardDefault, null, "aprovado").ok).toBe(true);
    expect(podeEnviarExplosao(boardDefault, "", "em_modelagem").ok).toBe(false);
    expect(podeEnviarExplosao(boardDefault, undefined, "reprovado").ok).toBe(false);
    // reqLabel resolve para "Aprovado".
    expect(podeEnviarExplosao(boardDefault, null, "aprovado").reqLabel).toBe("Aprovado");
  });

  it("'a partir da etapa': na etapa OU em qualquer posterior libera; antes bloqueia", () => {
    const cfg = "em_pilotagem";
    expect(podeEnviarExplosao(boardDefault, cfg, "em_modelagem").ok).toBe(false); // antes
    expect(podeEnviarExplosao(boardDefault, cfg, "em_pilotagem").ok).toBe(true); // na etapa
    expect(podeEnviarExplosao(boardDefault, cfg, "prova_roupa_1").ok).toBe(true); // posterior
    expect(podeEnviarExplosao(boardDefault, cfg, "aprovado").ok).toBe(true); // posterior
    expect(podeEnviarExplosao(boardDefault, cfg, "em_modelagem").reqLabel).toBe("Em Pilotagem");
  });

  it("config ÓRFÃ (etapa fora do board) ⇒ fallback 'aprovado'", () => {
    const g = podeEnviarExplosao(boardDefault, "nao_existe_xyz", "aprovado");
    expect(g.ok).toBe(true);
    expect(g.reqKey).toBe("aprovado");
    expect(podeEnviarExplosao(boardDefault, "nao_existe_xyz", "em_modelagem").ok).toBe(false);
  });

  it("board sem 'Aprovado' + config ausente ⇒ conservador (nada libera até configurar)", () => {
    const board = ["Em Modelagem", "Aprovação da CAD", "Explosão", "PCP"];
    // 'aprovado' default não existe no board → cfgIdx < 0 → só igualdade exata (nunca 'aprovado').
    expect(podeEnviarExplosao(board, null, "aprovacao_da_cad").ok).toBe(false);
    // Configurando uma etapa real do board → passa a liberar dela em diante.
    expect(podeEnviarExplosao(board, "aprovacao_da_cad", "em_modelagem").ok).toBe(false);
    expect(podeEnviarExplosao(board, "aprovacao_da_cad", "aprovacao_da_cad").ok).toBe(true);
    expect(podeEnviarExplosao(board, "aprovacao_da_cad", "explosao").ok).toBe(true);
    expect(podeEnviarExplosao(board, "aprovacao_da_cad", "em_modelagem").reqLabel).toBe("Aprovação da CAD");
  });
});
