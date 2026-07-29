import { describe, it, expect } from "vitest";
import { necessidadeVariante, necessidadePorTecido, metrosParaKg, abaterEstoque, custoMateriaisPrevisto, distribuirGrade, detalheOc } from "@/lib/plan-tecido/calc";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

describe("plan-tecido/calc", () => {
  it("necessidadeVariante = consumo × grade_total × mult (sem perda)", () => {
    expect(necessidadeVariante(1.4, 90, 1)).toBeCloseTo(126, 5);
    expect(necessidadeVariante(0.8, 90, 1)).toBeCloseTo(72, 5);
    expect(necessidadeVariante(1, 10, 0.5)).toBeCloseTo(5, 5);
  });

  it("metrosParaKg divide por rendimento; rendimento 0/null → 0", () => {
    expect(metrosParaKg(180, 3)).toBeCloseTo(60, 5);
    expect(metrosParaKg(180, 0)).toBe(0);
    expect(metrosParaKg(180, null)).toBe(0);
  });

  it("abaterEstoque nunca fica negativo", () => {
    expect(abaterEstoque(264, 90)).toBe(174);
    expect(abaterEstoque(210, 340)).toBe(0);
  });

  it("necessidadePorTecido soma por artigo/variante em toda a árvore", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
      ] },
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 35 }] },
      ] },
    ] }] }] };
    const r = necessidadePorTecido(arv);
    expect(r).toHaveLength(1);
    expect(r[0].artigo_id).toBe("A");
    // v1: 1.4×90 + 1.2×35 = 126 + 42 = 168
    expect(r[0].variantes[0].metros).toBeCloseTo(168, 5);
    expect(r[0].totalMetros).toBeCloseTo(168, 5);
  });

  it("necessidadePorTecido com filtroSlot filtra apenas slots que passam no predicado", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: "m1", usar_estoque: false, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
      ] },
      { modelo_id: "m2", usar_estoque: true, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 35 }] },
      ] },
    ] }] }] };

    // sem filtro: ambos (126 + 42 = 168)
    const tudo = necessidadePorTecido(arv);
    expect(tudo[0].totalMetros).toBeCloseTo(168, 5);

    // só encomenda (usar_estoque=false): só m1 → 1.4×90 = 126
    const encomenda = necessidadePorTecido(arv, (s) => !(s.usar_estoque ?? false));
    expect(encomenda).toHaveLength(1);
    expect(encomenda[0].totalMetros).toBeCloseTo(126, 5);

    // só estoque (usar_estoque=true): só m2 → 1.2×35 = 42
    const estoque = necessidadePorTecido(arv, (s) => !!(s.usar_estoque ?? false));
    expect(estoque).toHaveLength(1);
    expect(estoque[0].totalMetros).toBeCloseTo(42, 5);

    // filtro vazio → array vazio
    const nenhum = necessidadePorTecido(arv, () => false);
    expect(nenhum).toHaveLength(0);
  });

  it("custoMateriaisPrevisto = Σ consumo × preco_por_metro (ignora sem preço)", () => {
    const slot: PtSlot = { modelo_id: null, materiais: [
      { artigo_id: "A", tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0, variantes: [], preco_por_metro: 25 },
      { artigo_id: "B", tipo: "forro", numero: 1, consumo: 0.8, loss_percent: 0, ordem: 1, variantes: [], preco_por_metro: null },
    ] };
    expect(custoMateriaisPrevisto(slot)).toBeCloseTo(35, 5); // 1.4 × 25 = 35
  });

  it("forro usa a grade PRÓPRIA da variante (não mais o Tecido 1 / D8)", () => {
    // Slot: Tecido 1 (grade_total=90, consumo=1.4) + Forro (grade PRÓPRIA=50, consumo=0.8)
    // Forro usa a SUA grade → 0.8 × 50 × 1 = 40 (jul/2026: forro tem grade própria, não herda do Tecido 1)
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "TEC1", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 1,
          variantes: [{ variante_tecido_id: "vt1", label: "Branco", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
        { artigo_id: "FOR1", artigo_nome: "Forro Acetato", unidade_medida: "metro", rendimento: null, tipo: "forro", numero: 1, consumo: 0.8, loss_percent: 0, ordem: 2,
          variantes: [{ variante_tecido_id: "vf1", label: "Natural", ordem: 1, multiplicador: 1, grades: {}, grade_total: 50 }] },
      ] },
    ] }] }] };
    const r = necessidadePorTecido(arv);
    // Must have 2 artigos: TEC1 and FOR1
    expect(r).toHaveLength(2);
    const tec = r.find((x) => x.artigo_id === "TEC1")!;
    const forro = r.find((x) => x.artigo_id === "FOR1")!;
    // Tecido: 1.4 × 90 × 1 = 126
    expect(tec.variantes[0].metros).toBeCloseTo(126, 5);
    expect(tec.totalMetros).toBeCloseTo(126, 5);
    // Forro: 0.8 × 50 × 1 = 40 (grade PRÓPRIA do forro)
    expect(forro.variantes[0].metros).toBeCloseTo(40, 5);
    expect(forro.totalMetros).toBeCloseTo(40, 5);
  });
});

describe("distribuirGrade", () => {
  it("distribui proporcionalmente, soma = gradeTotal", () => {
    const r = distribuirGrade(100, { PP: 1, M: 2, G: 1 });
    // PP=25, M=50, G=25
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(100);
    expect(r["M"]).toBe(50);
    expect(r["PP"]).toBe(25);
    expect(r["G"]).toBe(25);
  });

  it("resto de arredondamento vai pro tamanho de maior peso", () => {
    // PP:1, M:2, G:1 → pesos=[1,2,1] soma=4; 10÷4=2,5 → PP=2, M=5, G=2 + resto=1 → M (maior peso)
    const r = distribuirGrade(10, { PP: 1, M: 2, G: 1 });
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(10);
    expect(r["M"]).toBe(6); // 5 + resto 1
    expect(r["PP"]).toBe(2);
    expect(r["G"]).toBe(2);
  });

  it("proporcoes null → {}", () => {
    expect(distribuirGrade(100, null)).toEqual({});
  });

  it("proporcoes undefined → {}", () => {
    expect(distribuirGrade(100, undefined)).toEqual({});
  });

  it("proporcoes vazio → {}", () => {
    expect(distribuirGrade(100, {})).toEqual({});
  });

  it("gradeTotal 0 → todos 0", () => {
    const r = distribuirGrade(0, { PP: 1, M: 2, G: 1 });
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(0);
  });

  it("tamanho com peso 0 fica 0", () => {
    const r = distribuirGrade(10, { PP: 0, M: 1 });
    expect(r["PP"]).toBe(0);
    expect(r["M"]).toBe(10);
  });

  it("detalheOc: comprometido (enviado_cad) sai da reservada; por OC e por OC×variante", () => {
    const mat = (consumo: number, grade: number) => ({
      artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo, loss_percent: 0, ordem: 0,
      variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: grade }],
    });
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { id: "sA", modelo_id: "mA", materiais: [mat(1, 100)] } as unknown as PtSlot, // enviado_cad → 100m
      { id: "sB", modelo_id: "mB", materiais: [mat(1, 50)] } as unknown as PtSlot,  // não enviado → 50m
    ] }] }] };
    const d = detalheOc(arv, { mA: ["oc1"], mB: ["oc1"] }, {}, new Set(["mA"]));
    expect(d.reservPorOc.get("oc1")).toBeCloseTo(150, 5);     // 100 + 50
    expect(d.comprometidoPorOc.get("oc1")).toBeCloseTo(100, 5); // só mA (enviado_cad)
    expect(d.nPorOc.get("oc1")).toBe(2);
    expect(d.reservPorOcVar.get("oc1|v1")).toBeCloseTo(150, 5);
    expect(d.comprometidoPorOcVar.get("oc1|v1")).toBeCloseTo(100, 5);
    // Contabilidade: reservada exibida = total − usada = 150 − 100 = 50
    const usada = Math.max(d.comprometidoPorOc.get("oc1")!, 0);
    expect(Math.max(0, d.reservPorOc.get("oc1")! - usada)).toBeCloseTo(50, 5);
  });

  it("detalheOc: vínculo do Dev (vinculoOcMap) vence o hint do plano (slotOcMap)", () => {
    const mat = { artigo_id: "A", artigo_nome: "V", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
      variantes: [{ variante_tecido_id: "v1", label: "x", ordem: 1, multiplicador: 1, grades: {}, grade_total: 10 }] };
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { id: "s1", modelo_id: "m1", materiais: [mat] } as unknown as PtSlot,
    ] }] }] };
    // hint aponta oc-hint, mas o Dev vinculou em oc-dev → vale o oc-dev
    const d = detalheOc(arv, { m1: ["oc-dev"] }, { s1: ["oc-hint"] }, new Set());
    expect(d.reservPorOc.get("oc-dev")).toBeCloseTo(10, 5);
    expect(d.reservPorOc.has("oc-hint")).toBe(false);
  });
});
