import { describe, it, expect } from "vitest";
import { necessidadeVariante, necessidadePorTecido, metrosParaKg, abaterEstoque, custoMateriaisPrevisto, distribuirGrade, detalheOc, contabilizarOc, rateioDeficitSub } from "@/lib/plan-tecido/calc";
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

  it("contabilizarOc: usado (max comprometido/baixa) sai da reservada; baixaDomina decide a cor", () => {
    // comprometido domina (500 comp, 100 baixa): usada 500, âmbar, reservada 300, sobra 1000-800=200
    let r = contabilizarOc(800, 500, 100, 1000);
    expect(r.usada).toBe(500); expect(r.reservadaLivre).toBe(300); expect(r.baixaDomina).toBe(false); expect(r.sobra).toBe(200);
    // baixa domina (sobre-corte 300 vs comp 100): usada 300, vermelho, reservada 0, sobra 500-300=200
    r = contabilizarOc(200, 100, 300, 500);
    expect(r.usada).toBe(300); expect(r.baixaDomina).toBe(true); expect(r.reservadaLivre).toBe(0); expect(r.sobra).toBe(200);
    // só baixa (comp 0, baixa 100): vermelho
    r = contabilizarOc(100, 0, 100, 100);
    expect(r.baixaDomina).toBe(true); expect(r.usada).toBe(100); expect(r.reservadaLivre).toBe(0); expect(r.sobra).toBe(0);
    // nada usado: cinza, reservada cheia
    r = contabilizarOc(100, 0, 0, 120);
    expect(r.usada).toBe(0); expect(r.baixaDomina).toBe(false); expect(r.reservadaLivre).toBe(100); expect(r.sobra).toBe(20);
    // comprometido > pedida → sobra negativa
    r = contabilizarOc(50, 80, 0, 60);
    expect(r.usada).toBe(80); expect(r.reservadaLivre).toBe(0); expect(r.sobra).toBe(-20);
  });

  it("detalheOc: variante SEM variante_tecido_id conta no total por-OC mas não no por-variante", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { id: "s1", modelo_id: "m1", materiais: [{ artigo_id: "A", artigo_nome: "V", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: null, cor_id: "cor1", label: "planejada", ordem: 1, multiplicador: 1, grades: {}, grade_total: 10 }] }] } as unknown as PtSlot,
    ] }] }] };
    const d = detalheOc(arv, { m1: ["oc1"] }, {}, new Set());
    expect(d.reservPorOc.get("oc1")).toBeCloseTo(10, 5); // total (slotMetros) inclui a cor planejada
    expect(d.reservPorOcVar.size).toBe(0);              // por-variante descarta (sem id) — divergência documentada
  });

  it("detalheOc: mesmo slot em 2 OCs soma o slot inteiro em CADA OC (comportamento documentado)", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { id: "s1", modelo_id: "m1", materiais: [{ artigo_id: "A", artigo_nome: "V", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: "v1", label: "x", ordem: 1, multiplicador: 1, grades: {}, grade_total: 10 }] }] } as unknown as PtSlot,
    ] }] }] };
    const d = detalheOc(arv, { m1: ["oc1", "oc2"] }, {}, new Set());
    expect(d.reservPorOc.get("oc1")).toBe(10);
    expect(d.reservPorOc.get("oc2")).toBe(10);
    expect(d.reservPorOcVar.get("oc1|v1")).toBe(10);
    expect(d.reservPorOcVar.get("oc2|v1")).toBe(10);
  });

  it("detalheOc: forro entra no total por-OC (slotMetros não filtra papel)", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { id: "s1", modelo_id: "m1", materiais: [
        { artigo_id: "A", artigo_nome: "Tec", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [{ variante_tecido_id: "v1", label: "x", ordem: 1, multiplicador: 1, grades: {}, grade_total: 10 }] },
        { artigo_id: "F", artigo_nome: "Forro", unidade_medida: "metro", rendimento: null, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [{ variante_tecido_id: "vf", label: "y", ordem: 1, multiplicador: 1, grades: {}, grade_total: 5 }] },
      ] } as unknown as PtSlot,
    ] }] }] };
    const d = detalheOc(arv, { m1: ["oc1"] }, {}, new Set());
    expect(d.reservPorOc.get("oc1")).toBeCloseTo(15, 5);        // tecido 10 + forro 5
    expect(d.reservPorOcVar.get("oc1|v1")).toBeCloseTo(10, 5);
    expect(d.reservPorOcVar.get("oc1|vf")).toBeCloseTo(5, 5);
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

describe("plan-tecido/calc — auditoria jul/2026 (Ave Rara)", () => {
  // 1 slot: TECIDO A (100 m em VA) + FORRO F (40 m em VF); M1 vinculado (Dev) à OC1; OC1 só tem A.
  const arvAud = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
    slots: [{ id: "slot1", modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [
      { artigo_id: "A", tipo: "tecido", numero: 1, consumo: 2, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: "VA", ordem: 1, multiplicador: 1, grades: {}, grade_total: 50 }] },
      { artigo_id: "F", tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1,
        variantes: [{ variante_tecido_id: "VF", ordem: 1, multiplicador: 1, grades: {}, grade_total: 40 }] },
    ] }] }] }] } as any;

  it("detalheOc COM ocArtigos: a OC reserva SÓ os metros do artigo dela (forro fica fora)", () => {
    const ocArtigos = new Map([["OC1", new Set(["A"])]]);
    const det = detalheOc(arvAud, { M1: ["OC1"] }, {}, new Set(["M1"]), ocArtigos);
    expect(det.reservPorOc.get("OC1")).toBe(100);             // era 140 (card inteiro) antes do fix
    expect(det.comprometidoPorOc.get("OC1")).toBe(100);
    expect(det.reservPorOcVar.get("OC1|VA")).toBe(100);
    expect(det.reservPorOcVar.get("OC1|VF")).toBeUndefined(); // forro não pertence à OC1
  });

  it("detalheOc SEM ocArtigos (compat): comportamento antigo — card inteiro", () => {
    const det = detalheOc(arvAud, { M1: ["OC1"] }, {}, undefined);
    expect(det.reservPorOc.get("OC1")).toBe(140);
    expect(det.reservPorOcVar.get("OC1|VF")).toBe(40);
  });

  it("contabilizarOc: sobra = pedida − reserva total (caso Marrom ANGELIM·Café)", () => {
    // reserva total 362,56 (livre 76,8 + comprometido 285,76), baixa 0, pedida 1000
    const r = contabilizarOc(362.56, 285.76, 0, 1000);
    expect(r.usada).toBeCloseTo(285.76, 2);
    expect(r.reservadaLivre).toBeCloseTo(76.8, 2);
    expect(r.sobra).toBeCloseTo(637.44, 2);                   // a conta do dono, confirmada
    expect(r.baixaDomina).toBe(false);
  });

  it("rateioDeficitSub: nec 0 → 0 (mata o 'nec 0 · a comprar 1.591,68')", () => {
    expect(rateioDeficitSub(1591.68, 0, 1591.68)).toBe(0);
  });

  it("rateioDeficitSub: proporcional, limitado à nec da sub, Σ das subs = déficit", () => {
    const deficit = 900, necCol = 1200;
    const r1 = rateioDeficitSub(deficit, 800, necCol);        // 600
    const r2 = rateioDeficitSub(deficit, 400, necCol);        // 300
    expect(r1).toBeCloseTo(600, 6);
    expect(r2).toBeCloseTo(300, 6);
    expect(r1 + r2).toBeCloseTo(deficit, 6);
    expect(rateioDeficitSub(2000, 100, 100)).toBe(100);       // nunca acima da nec da sub
  });

  // 1 slot do artigo A: cor VA (100 m) + cor VB (30 m) + parcela SEM cor (20 m); OC1 só tem a cor VA.
  const arvVar = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
    slots: [{ id: "slot1", modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [
      { artigo_id: "A", tipo: "tecido", numero: 1, consumo: 2, loss_percent: 0, ordem: 0,
        variantes: [
          { variante_tecido_id: "VA", ordem: 1, multiplicador: 1, grades: {}, grade_total: 50 },
          { variante_tecido_id: "VB", ordem: 2, multiplicador: 1, grades: {}, grade_total: 15 },
          { variante_tecido_id: null, ordem: 3, multiplicador: 1, grades: {}, grade_total: 10 },
        ] },
    ] }] }] }] } as any;

  it("detalheOc COM ocVariantes: cor que a OC não tem fica fora do total E do por-variante (576 vs 567,04)", () => {
    const ocArtigos = new Map([["OC1", new Set(["A"])]]);
    const ocVariantes = new Map([["OC1", new Set(["VA"])]]);
    const det = detalheOc(arvVar, { M1: ["OC1"] }, {}, new Set(["M1"]), ocArtigos, ocVariantes);
    expect(det.reservPorOc.get("OC1")).toBe(120);              // VA 100 + sem-cor 20; VB (30) fora
    expect(det.comprometidoPorOc.get("OC1")).toBe(120);
    expect(det.reservPorOcVar.get("OC1|VA")).toBe(100);
    expect(det.reservPorOcVar.get("OC1|VB")).toBeUndefined();  // a OC não pode servir essa cor
  });

  it("detalheOc SEM ocVariantes (compat): filtro só por artigo — todas as cores do artigo contam", () => {
    const ocArtigos = new Map([["OC1", new Set(["A"])]]);
    const det = detalheOc(arvVar, { M1: ["OC1"] }, {}, new Set(["M1"]), ocArtigos);
    expect(det.reservPorOc.get("OC1")).toBe(150);              // 100 + 30 + 20
    expect(det.reservPorOcVar.get("OC1|VB")).toBe(30);
  });
});
