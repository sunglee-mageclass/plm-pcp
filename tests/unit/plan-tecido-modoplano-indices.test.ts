import { describe, it, expect } from "vitest";
import { achatarSlotsVisiveis, slotPassaFiltroStatus } from "@/lib/plan-tecido/calc";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

const slot = (id: string, o: Partial<PtSlot> = {}): PtSlot => ({ id, modelo_id: null, materiais: [], ...o }) as PtSlot;
// Linha 0: [A reprovado(oculto), B visivel, C visivel]; Linha 1: [D visivel, E reprovado(oculto), F visivel]
const arvore = {
  subcolecoes: [{ linhas: [
    { slots: [slot("A", { status: "reprovado" }), slot("B"), slot("C")] },
    { slots: [slot("D"), slot("E", { status: "reprovado" }), slot("F")] },
  ] }],
} as unknown as PtArvore;
const visivel = (s: PtSlot) => slotPassaFiltroStatus(s, false, "sem_reprovado");

describe("achatarSlotsVisiveis (F2 D fix C1)", () => {
  it("slot visivel apos um oculto mantem o sli/li ORIGINAIS (nao o deslocado)", () => {
    const f = achatarSlotsVisiveis(arvore, visivel);
    expect(f.map((x) => x.slot.id)).toEqual(["B", "C", "D", "F"]);
    expect(f.map((x) => [x.li, x.sli])).toEqual([[0, 1], [0, 2], [1, 0], [1, 2]]);
    // gravar via (li, sli) na arvore COMPLETA acerta o MESMO slot que foi renderizado
    for (const x of f) expect(arvore.subcolecoes[0].linhas[x.li].slots[x.sli]).toBe(x.slot);
  });
  it("sem filtro: tudo, com indices originais", () => {
    const f = achatarSlotsVisiveis(arvore);
    expect(f).toHaveLength(6);
    expect(f.map((x) => [x.subI, x.li, x.sli])[4]).toEqual([0, 1, 1]);
  });
  it("filtro por familia tambem preserva indices", () => {
    const t = { subcolecoes: [{ linhas: [{ slots: [slot("A", { categoria_tecido_id: "x" }), slot("B", { categoria_tecido_id: "y" })] }] }] } as unknown as PtArvore;
    const f = achatarSlotsVisiveis(t, (s) => s.categoria_tecido_id === "y");
    expect(f).toHaveLength(1);
    expect([f[0].li, f[0].sli]).toEqual([0, 1]);
  });
});
