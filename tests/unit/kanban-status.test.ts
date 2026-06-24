import { describe, it, expect } from "vitest";
import {
  resolveStatusKey,
  normalizeKanbanStatuses,
  DEFAULT_STATUSES,
  APROVADO_KEY,
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
