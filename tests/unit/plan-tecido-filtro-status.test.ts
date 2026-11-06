import { describe, it, expect } from "vitest";
import { slotPassaFiltroStatus } from "@/lib/plan-tecido/calc";
import type { PtSlot } from "@/lib/plan-tecido/types";

const vaga = (o: Partial<PtSlot>): PtSlot => ({ modelo_id: null, materiais: [], ...o }) as PtSlot;

describe("slotPassaFiltroStatus (F2 D)", () => {
  it("default 'sem_reprovado' esconde reprovado (vaga sem card e card reprovado)", () => {
    expect(slotPassaFiltroStatus(vaga({ status: "reprovado" }), false, "sem_reprovado")).toBe(false);
    expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), true, "sem_reprovado")).toBe(false);
  });
  it("flagados/pendentes aparecem no default", () => {
    expect(slotPassaFiltroStatus(vaga({ status: "pendente" }), false, "sem_reprovado")).toBe(true);
    expect(slotPassaFiltroStatus(vaga({}), false, "sem_reprovado")).toBe(true);
    expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), false, "sem_reprovado")).toBe(true);
  });
  it("com card, o status do card manda (status gravado na vaga e ignorado)", () => {
    expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1", status: "reprovado" }), false, "sem_reprovado")).toBe(true);
    expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1", status: "pendente" }), true, "sem_reprovado")).toBe(false);
  });
  it("'todos' mostra tudo, inclusive reprovado", () => {
    expect(slotPassaFiltroStatus(vaga({ status: "reprovado" }), false, "todos")).toBe(true);
    expect(slotPassaFiltroStatus(vaga({ modelo_id: "m1" }), true, "todos")).toBe(true);
  });
});
