import { describe, it, expect } from "vitest";
import { achatarSlotsVisiveis, slotPassaFiltroLinha, slotPassaFiltroStatus } from "@/lib/plan-tecido/calc";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

const slot = (id: string, o: Partial<PtSlot> = {}): PtSlot => ({ id, modelo_id: null, materiais: [], ...o }) as PtSlot;
const sel = (...ids: (string | null)[]) => new Set<string | null>(ids);

describe("slotPassaFiltroLinha (F2 filtro por linha)", () => {
  it("filtro vazio = todas as linhas (inclusive sem linha)", () => {
    expect(slotPassaFiltroLinha(slot("a", { linha_id: "L1" }), sel())).toBe(true);
    expect(slotPassaFiltroLinha(slot("b", { linha_id: null }), sel())).toBe(true);
    expect(slotPassaFiltroLinha(slot("c"), sel())).toBe(true);
  });
  it("marca 1 linha = so ela", () => {
    expect(slotPassaFiltroLinha(slot("a", { linha_id: "L1" }), sel("L1"))).toBe(true);
    expect(slotPassaFiltroLinha(slot("b", { linha_id: "L2" }), sel("L1"))).toBe(false);
  });
  it("marca 2 linhas = as duas", () => {
    const f = sel("L1", "L2");
    expect(slotPassaFiltroLinha(slot("a", { linha_id: "L1" }), f)).toBe(true);
    expect(slotPassaFiltroLinha(slot("b", { linha_id: "L2" }), f)).toBe(true);
    expect(slotPassaFiltroLinha(slot("c", { linha_id: "L3" }), f)).toBe(false);
  });
  it("card sem linha: escondido quando ha linha marcada, a menos que 'Sem linha' (null) esteja marcado", () => {
    expect(slotPassaFiltroLinha(slot("a", { linha_id: null }), sel("L1"))).toBe(false);
    expect(slotPassaFiltroLinha(slot("b"), sel("L1"))).toBe(false);
    expect(slotPassaFiltroLinha(slot("c", { linha_id: null }), sel(null))).toBe(true);
    expect(slotPassaFiltroLinha(slot("d"), sel(null, "L1"))).toBe(true);
    expect(slotPassaFiltroLinha(slot("e", { linha_id: "L1" }), sel(null))).toBe(false);
  });
});

describe("filtro por linha NAO desloca indices (mesmo padrao do C1)", () => {
  // Linha 0: [A L2(oculto), B L1, C L1]; Linha 1: [D L1, E L2(oculto), F L1 reprovado(oculto por status)]
  const arvore = {
    subcolecoes: [{ linhas: [
      { slots: [slot("A", { linha_id: "L2" }), slot("B", { linha_id: "L1" }), slot("C", { linha_id: "L1" })] },
      { slots: [slot("D", { linha_id: "L1" }), slot("E", { linha_id: "L2" }), slot("F", { linha_id: "L1", status: "reprovado" })] },
    ] }],
  } as unknown as PtArvore;

  it("card visivel apos oculto mantem li/sli originais", () => {
    const f = achatarSlotsVisiveis(arvore, (s) => slotPassaFiltroLinha(s, sel("L1")));
    expect(f.map((x) => x.slot.id)).toEqual(["B", "C", "D", "F"]);
    expect(f.map((x) => [x.li, x.sli])).toEqual([[0, 1], [0, 2], [1, 0], [1, 2]]);
    for (const x of f) expect(arvore.subcolecoes[0].linhas[x.li].slots[x.sli]).toBe(x.slot);
  });
  it("combina com o filtro de status na MESMA poda (E logico), indices intactos", () => {
    const f = achatarSlotsVisiveis(arvore, (s) => slotPassaFiltroStatus(s, false, "sem_reprovado") && slotPassaFiltroLinha(s, sel("L1")));
    expect(f.map((x) => x.slot.id)).toEqual(["B", "C", "D"]);
    expect(f.map((x) => [x.li, x.sli])).toEqual([[0, 1], [0, 2], [1, 0]]);
  });
  it("filtro vazio nao poda nada", () => {
    expect(achatarSlotsVisiveis(arvore, (s) => slotPassaFiltroLinha(s, sel()))).toHaveLength(6);
  });
});
