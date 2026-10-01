// LEVES L2 / kanban #14 (review M1): a "enviada" do Dev é `ordem_criacao_enviada` (não `enviado_cad`).
import { describe, it, expect } from "vitest";
import { modeloEnviadoAoKanban, refVisivelFicha } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";
import { derivarModelo, lerKanbanAutoConfig, statusParaGate } from "@/lib/kanban-auto";

const cfg = lerKanbanAutoConfig({
  kanban_automatico: true,
  status_kanban: [{ key: "stand_by", label: "Stand By" }, { key: "aprovado", label: "Aprovado" }, { key: "reprovado", label: "Reprovado" }],
  revenda_kanban_colunas: ["stand_by", "aprovado"],
  revenda_kanban_requisitos: { aprovado: ["data_aprovacao"] },
});

describe("modeloEnviadoAoKanban", () => {
  it("lê ordem_criacao_enviada do servidor, ignora enviado_cad", () => {
    expect(modeloEnviadoAoKanban({ ordem_criacao_enviada: true, enviado_cad: false })).toBe(true);
    expect(modeloEnviadoAoKanban({ ordem_criacao_enviada: false, enviado_cad: true })).toBe(false);
    expect(modeloEnviadoAoKanban(null)).toBe(false);
    expect(modeloEnviadoAoKanban(undefined)).toBe(false);
  });
  it("ordem enviada + sem Explosão: o card é derivável e o gate usa a posição derivada (alvo)", () => {
    const row = { origem: "revenda", status_desenvolvimento: "stand_by", ordem_criacao_enviada: true, enviado_cad: false };
    const d = derivarModelo({ origem: row.origem, status_desenvolvimento: row.status_desenvolvimento, ordem_criacao_enviada: modeloEnviadoAoKanban(row), lancado: false }, cfg, { data_aprovacao: true });
    expect(d.derivavel).toBe(true);
    expect(d.alvo).toBe("aprovado");
    expect(statusParaGate(cfg.kanban_automatico, d, "stand_by")).toBe("aprovado");
  });
  it("Reprovado: nada passa (null) e REF gravada continua visível", () => {
    expect(statusParaGate(true, null, "reprovado")).toBeNull();
    expect(refVisivelFicha({ cfg, refExibirStatus: "aprovado", statusEfetivo: "reprovado", derivacao: null, refSalva: "ABC1" })).toBe(true);
    expect(refVisivelFicha({ cfg, refExibirStatus: "aprovado", statusEfetivo: "reprovado", derivacao: null })).toBe(false);
  });
});
