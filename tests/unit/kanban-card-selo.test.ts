import { describe, it, expect } from "vitest";
import type { KanbanAutoConfig } from "@/lib/kanban-auto";
import { etapaDoModelo } from "@/lib/kanban-auto-ui";
import { modeloKanbanDoEmbed, passaFiltroStatusCard, cardReprovado } from "@/lib/kanban-card-selo";

// F4a T1 — funções puras que PA/PI/PT usam para montar o selo do kanban no card.
const cfg = (over: Partial<KanbanAutoConfig> = {}): KanbanAutoConfig => ({
  kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: [], revenda_kanban_requisitos: {}, ...over,
});

describe("modeloKanbanDoEmbed", () => {
  it("embed ausente/nulo → tudo null/false (nunca 'assume enviado')", () => {
    for (const m of [null, undefined, {}]) {
      expect(modeloKanbanDoEmbed(m)).toEqual({
        origem: null, status_desenvolvimento: null, ordem_criacao_enviada: false, lancado: false,
      });
    }
  });
  it("só true literal vira true; null/undefined/outro viram false", () => {
    expect(modeloKanbanDoEmbed({ ordem_criacao_enviada: true, lancado: true })).toMatchObject({ ordem_criacao_enviada: true, lancado: true });
    expect(modeloKanbanDoEmbed({ ordem_criacao_enviada: null, lancado: null })).toMatchObject({ ordem_criacao_enviada: false, lancado: false });
    expect(modeloKanbanDoEmbed({ ordem_criacao_enviada: "true" as any, lancado: 1 as any })).toMatchObject({ ordem_criacao_enviada: false, lancado: false });
  });
  it("repassa origem e status_desenvolvimento", () => {
    expect(modeloKanbanDoEmbed({ origem: "revenda", status_desenvolvimento: "aprovado" }))
      .toMatchObject({ origem: "revenda", status_desenvolvimento: "aprovado" });
  });
});

describe("passaFiltroStatusCard / cardReprovado", () => {
  it("reprovado no dev OU no plan sai no sem_reprovado (sem diferenciar caixa)", () => {
    expect(passaFiltroStatusCard({ status_desenvolvimento: "reprovado" }, "sem_reprovado")).toBe(false);
    expect(passaFiltroStatusCard({ status_planejamento: "Reprovado" }, "sem_reprovado")).toBe(false);
    expect(passaFiltroStatusCard({ status_desenvolvimento: "aprovado", status_planejamento: "aprovado" }, "sem_reprovado")).toBe(true);
  });
  it("'todos' passa tudo, inclusive reprovado", () => {
    expect(passaFiltroStatusCard({ status_desenvolvimento: "reprovado" }, "todos")).toBe(true);
    expect(passaFiltroStatusCard(null, "todos")).toBe(true);
  });
  it("card sem modelo (null/undefined) não é reprovado", () => {
    expect(cardReprovado(null)).toBe(false);
    expect(cardReprovado(undefined)).toBe(false);
    expect(passaFiltroStatusCard(undefined, "sem_reprovado")).toBe(true);
  });
});

describe("anti-drift: etapaDoModelo(modeloKanbanDoEmbed(embed)) ≡ selo esperado", () => {
  it("sem Ordem de Criação → planejamento", () => {
    const s = etapaDoModelo(modeloKanbanDoEmbed({ status_desenvolvimento: "aprovado", ordem_criacao_enviada: false }), cfg());
    expect(s).toMatchObject({ fase: "planejamento", label: "Planejamento" });
  });
  it("embed vazio (campos ausentes) → planejamento, nunca kanban", () => {
    expect(etapaDoModelo(modeloKanbanDoEmbed({}), cfg()).fase).toBe("planejamento");
  });
  it("enviado → kanban na coluna do status", () => {
    const s = etapaDoModelo(modeloKanbanDoEmbed({ status_desenvolvimento: "stand_by", ordem_criacao_enviada: true }), cfg());
    expect(s).toMatchObject({ fase: "kanban", key: "stand_by" });
  });
  it("enviado com status nulo → 1ª coluna do board", () => {
    const s = etapaDoModelo(modeloKanbanDoEmbed({ ordem_criacao_enviada: true }), cfg());
    expect(s).toMatchObject({ fase: "kanban", key: "em_modelagem" });
  });
  it("lançado ganha de tudo", () => {
    const s = etapaDoModelo(modeloKanbanDoEmbed({ status_desenvolvimento: "aprovado", ordem_criacao_enviada: true, lancado: true }), cfg());
    expect(s).toMatchObject({ fase: "lancado", label: "Lançado" });
  });
  it("reprovado (enviado) → fase kanban na coluna reprovado", () => {
    const s = etapaDoModelo(modeloKanbanDoEmbed({ status_desenvolvimento: "reprovado", ordem_criacao_enviada: true }), cfg());
    expect(s.fase).toBe("kanban");
    expect(s.key).toBe("reprovado");
  });
});
