import { describe, it, expect } from "vitest";
import { difVariantes, aplicarDifNoMaterial, indiceMaterialCorrespondente } from "@/lib/plan-tecido/replicar-variantes";
import type { PtMaterial, PtVariante } from "@/lib/plan-tecido/types";

const v = (id: string, over: Partial<PtVariante> = {}): PtVariante =>
  ({ variante_tecido_id: id, ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, ...over });
const mat = (over: Partial<PtMaterial> = {}): PtMaterial =>
  ({ artigo_id: "A", tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [], ...over });

describe("plan-tecido/replicar-variantes", () => {
  describe("difVariantes", () => {
    it("detecta cor adicionada", () => {
      const d = difVariantes(mat({ variantes: [v("x")] }), mat({ variantes: [v("x"), v("y")] }));
      expect(d.adicionadas.map((a) => a.variante_tecido_id)).toEqual(["y"]);
      expect(d.removidas).toEqual([]);
    });
    it("detecta cor removida", () => {
      const d = difVariantes(mat({ variantes: [v("x"), v("y")] }), mat({ variantes: [v("x")] }));
      expect(d.adicionadas).toEqual([]);
      expect(d.removidas).toEqual(["y"]);
    });
    it("editar só a quantidade (grade_total) NÃO é add nem remove", () => {
      const d = difVariantes(mat({ variantes: [v("x", { grade_total: 0 })] }), mat({ variantes: [v("x", { grade_total: 50 })] }));
      expect(d.adicionadas).toEqual([]);
      expect(d.removidas).toEqual([]);
    });
    it("cor planejada (sem variante real) usa a chave cor_id|apelido", () => {
      const p = v("", { variante_tecido_id: null, cor_id: "c1", cor_apelido_id: "a1" });
      const d = difVariantes(mat({ variantes: [] }), mat({ variantes: [p] }));
      expect(d.adicionadas.length).toBe(1);
    });
  });

  describe("aplicarDifNoMaterial", () => {
    it("adiciona a cor nova com grade ZERADA (peças por card) e renumera", () => {
      const alvo = mat({ variantes: [v("x", { grade_total: 30, ordem: 1 })] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [v("y", { grade_total: 99 })], removidas: [] });
      expect(out.variantes.map((z) => [z.variante_tecido_id, z.grade_total, z.ordem]))
        .toEqual([["x", 30, 1], ["y", 0, 2]]); // x preserva suas peças; y entra com 0
    });
    it("remove a cor no alvo, preservando as demais e suas peças", () => {
      const alvo = mat({ variantes: [v("x", { grade_total: 30 }), v("y", { grade_total: 40 })] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [], removidas: ["x"] });
      expect(out.variantes.map((z) => [z.variante_tecido_id, z.grade_total, z.ordem])).toEqual([["y", 40, 1]]);
    });
    it("não duplica cor que o alvo já tem", () => {
      const alvo = mat({ variantes: [v("x", { grade_total: 30 })] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [v("x", { grade_total: 99 })], removidas: [] });
      expect(out.variantes.length).toBe(1);
      expect(out.variantes[0].grade_total).toBe(30); // não sobrescreve as peças do alvo
    });
    it("retorna o MESMO material (referência) quando nada muda (evita dirty falso)", () => {
      const alvo = mat({ variantes: [v("x")] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [], removidas: ["inexistente"] });
      expect(out).toBe(alvo);
    });
    it("NÃO replica cor real de artigo que não está no pool do alvo (evita divergente alheio)", () => {
      // alvo é do artigo A; a cor nova é do artigo Z (variante_artigo_id) → não entra
      const alvo = mat({ artigo_id: "A", variantes: [v("a1", { variante_artigo_id: "A", grade_total: 10 })] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [v("z1", { variante_artigo_id: "Z" })], removidas: [] });
      expect(out.variantes.map((z) => z.variante_tecido_id)).toEqual(["a1"]); // z1 filtrado
    });
    it("replica cor real quando o artigo está no pool (principal ou substituto) do alvo", () => {
      const alvo = mat({ artigo_id: "A", artigo_ids_extra: ["B"], variantes: [] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [v("b1", { variante_artigo_id: "B" })], removidas: [] });
      expect(out.variantes.map((z) => z.variante_tecido_id)).toEqual(["b1"]); // B está no pool → entra
    });
    it("cor PLANEJADA (sem artigo) replica sempre, independe do pool", () => {
      const plan = v("", { variante_tecido_id: null, cor_id: "c9", cor_apelido_id: "a9" });
      const alvo = mat({ artigo_id: "A", variantes: [] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [plan], removidas: [] });
      expect(out.variantes.length).toBe(1);
    });
  });

  describe("indiceMaterialCorrespondente", () => {
    it("casa por (tipo, numero)", () => {
      const alvo = [mat({ tipo: "tecido", numero: 1 }), mat({ tipo: "forro", numero: 1 }), mat({ tipo: "tecido", numero: 2 })];
      expect(indiceMaterialCorrespondente(alvo, mat({ tipo: "forro", numero: 1 }))).toBe(1);
      expect(indiceMaterialCorrespondente(alvo, mat({ tipo: "tecido", numero: 2 }))).toBe(2);
      expect(indiceMaterialCorrespondente(alvo, mat({ tipo: "forro", numero: 9 }))).toBe(-1);
    });
  });
});
