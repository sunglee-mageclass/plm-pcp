import { describe, it, expect } from "vitest";
import { difVariantes, aplicarDifNoMaterial, indiceMaterialCorrespondente, replicarAdicaoNosSlots, slotTemCard } from "@/lib/plan-tecido/replicar-variantes";
import type { PtLinha, PtMaterial, PtSlot, PtVariante } from "@/lib/plan-tecido/types";

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
    it("com removidas vazias (política F1), NÃO tira a cor do alvo — só adiciona", () => {
      const alvo = mat({ variantes: [v("x", { grade_total: 30 }), v("y", { grade_total: 40 })] });
      // o chamador (replicarAdicaoNosSlots) zera `removidas`: a dif chega só com adicionadas
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [v("z", { grade_total: 99 })], removidas: [] });
      expect(out.variantes.map((r) => r.variante_tecido_id)).toEqual(["x", "y", "z"]); // x,y preservados; z entra
      expect(out.variantes.find((r) => r.variante_tecido_id === "z")!.grade_total).toBe(0);
    });
    it("cor OCULTA no alvo não é re-adicionada pela réplica (continua oculta, sem duplicar)", () => {
      const alvo = mat({ variantes: [v("x", { oculta: true })] });
      const out = aplicarDifNoMaterial(alvo, { adicionadas: [v("x")], removidas: [] });
      expect(out).toBe(alvo);
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

describe("replicarAdicaoNosSlots (política F1: só adição, nunca em vaga vazia)", () => {
  const nomeDe = (s: PtSlot) => s.materiais.find((m) => m.tipo === "tecido" && m.artigo_id)?.artigo_nome ?? "Sem tecido";
  const slot = (id: string, modelo: string | null, vars: PtVariante[], artigo_nome = "Linho"): PtSlot =>
    ({ id, modelo_id: modelo, materiais: [mat({ artigo_id: "A", artigo_nome, variantes: vars })] });
  const linhas = (...slots: PtSlot[]): PtLinha[] => [{ linha_id: null, categoria_id: null, ordem: 0, slots }];
  const cores = (s: PtSlot) => s.materiais[0].variantes.map((x) => x.variante_tecido_id);

  it("ADIÇÃO replica (grade 0) nos outros cards COM card do mesmo tecido", () => {
    const antes = slot("o", "m1", [v("x", { grade_total: 5 })]);
    const depois = slot("o", "m1", [v("x", { grade_total: 5 }), v("y", { grade_total: 77 })]);
    const outro = slot("b", "m2", [v("x", { grade_total: 9 })]);
    const ls = linhas(depois, outro);
    expect(replicarAdicaoNosSlots(ls, depois, antes, depois, nomeDe)).toBe(1);
    expect(cores(ls[0].slots[1])).toEqual(["x", "y"]);
    expect(ls[0].slots[1].materiais[0].variantes.find((r) => r.variante_tecido_id === "y")!.grade_total).toBe(0);
    expect(ls[0].slots[1].materiais[0].variantes.find((r) => r.variante_tecido_id === "x")!.grade_total).toBe(9); // peças intactas
  });

  it("REMOÇÃO num card NÃO tira a cor dos outros (o bug das cores que somem)", () => {
    const antes = slot("o", "m1", [v("x"), v("y")]);
    const depois = slot("o", "m1", [v("x")]); // removeu y
    const outro = slot("b", "m2", [v("x"), v("y", { grade_total: 40 })]);
    const ls = linhas(depois, outro);
    expect(replicarAdicaoNosSlots(ls, depois, antes, depois, nomeDe)).toBe(0);
    expect(cores(ls[0].slots[1])).toEqual(["x", "y"]);
    expect(ls[0].slots[1].materiais[0].variantes[1].grade_total).toBe(40);
  });

  it("OCULTAR uma cor (flag, o array não muda) não replica nada", () => {
    const antes = slot("o", "m1", [v("x"), v("y")]);
    const depois = slot("o", "m1", [v("x"), v("y", { oculta: true })]);
    const outro = slot("b", "m2", [v("x"), v("y", { grade_total: 12 })]);
    const ls = linhas(depois, outro);
    expect(replicarAdicaoNosSlots(ls, depois, antes, depois, nomeDe)).toBe(0);
    expect(ls[0].slots[1].materiais[0].variantes[1].oculta).toBeFalsy();
    expect(ls[0].slots[1].materiais[0].variantes[1].grade_total).toBe(12);
  });

  it("VAGA VAZIA (modelo_id null) do grupo NUNCA recebe a réplica (vagas-fantasma)", () => {
    const antes = slot("o", "m1", [v("x")]);
    const depois = slot("o", "m1", [v("x"), v("y")]);
    const vaga = slot("vaga", null, [v("x")]);
    const vagaSemMat: PtSlot = { id: "vaga2", modelo_id: null, materiais: [] };
    const real = slot("b", "m2", [v("x")]);
    const ls = linhas(depois, vaga, vagaSemMat, real);
    expect(replicarAdicaoNosSlots(ls, depois, antes, depois, nomeDe)).toBe(1); // só o real mudou
    expect(cores(ls[0].slots[1])).toEqual(["x"]);           // vaga intacta
    expect(ls[0].slots[2].materiais).toEqual([]);           // vaga sem material intacta
    expect(cores(ls[0].slots[3])).toEqual(["x", "y"]);      // real recebeu
  });

  it("origem sendo VAGA VAZIA também não replica", () => {
    const antes = slot("o", null, [v("x")]);
    const depois = slot("o", null, [v("x"), v("y")]);
    const real = slot("b", "m2", [v("x")]);
    const ls = linhas(depois, real);
    expect(replicarAdicaoNosSlots(ls, depois, antes, depois, nomeDe)).toBe(0);
    expect(cores(ls[0].slots[1])).toEqual(["x"]);
  });

  it("outro tecido (nome diferente) e troca de tecido do card de origem não replicam", () => {
    const antes = slot("o", "m1", [v("x")], "Linho");
    const depois = slot("o", "m1", [v("x"), v("y")], "Linho");
    const outroTecido = slot("b", "m2", [v("x")], "Seda");
    const ls = linhas(depois, outroTecido);
    expect(replicarAdicaoNosSlots(ls, depois, antes, depois, nomeDe)).toBe(0);
    expect(cores(ls[0].slots[1])).toEqual(["x"]);
    // trocou o nome do tecido na própria edição => grupo novo, não replica
    const trocou = slot("o", "m1", [v("x"), v("y")], "Seda");
    const ls2 = linhas(trocou, slot("c", "m3", [v("x")], "Seda"));
    expect(replicarAdicaoNosSlots(ls2, trocou, antes, trocou, nomeDe)).toBe(0);
  });

  it("slotTemCard: só modelo_id não-nulo", () => {
    expect(slotTemCard(slot("a", "m", []))).toBe(true);
    expect(slotTemCard(slot("a", null, []))).toBe(false);
  });
});
