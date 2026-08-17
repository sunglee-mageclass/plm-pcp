import { describe, it, expect } from "vitest";
import { necessidadeVariante, necessidadePorTecido, metrosParaKg, abaterEstoque, custoMateriaisPrevisto, distribuirGrade, detalheOc, contabilizarOc, rateioDeficitSub, dedupVariantes, buildMateriaisAplicar, coberturaVar, aComprarVivoVar, aComprarVivoPorArtigo, necVivoPorVariante, type CoberturaVarRow } from "@/lib/plan-tecido/calc";
import type { PtArvore, PtSlot, PtVariante } from "@/lib/plan-tecido/types";

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
    // filtroSlot é um predicado GENÉRICO (usado em produção pelo Drawer p/ o `fisico`=vínculo, régua
    // única pós-aposentadoria do flag usar_estoque). Aqui discrimina por modelo_id só p/ exercitá-lo.
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: "m1", materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 }] },
      ] },
      { modelo_id: "m2", materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1.2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "Off-white", ordem: 1, multiplicador: 1, grades: {}, grade_total: 35 }] },
      ] },
    ] }] }] };

    // sem filtro: ambos (126 + 42 = 168)
    const tudo = necessidadePorTecido(arv);
    expect(tudo[0].totalMetros).toBeCloseTo(168, 5);

    // só m1 → 1.4×90 = 126
    const soM1 = necessidadePorTecido(arv, (s) => s.modelo_id === "m1");
    expect(soM1).toHaveLength(1);
    expect(soM1[0].totalMetros).toBeCloseTo(126, 5);

    // só m2 → 1.2×35 = 42
    const soM2 = necessidadePorTecido(arv, (s) => s.modelo_id === "m2");
    expect(soM2).toHaveLength(1);
    expect(soM2[0].totalMetros).toBeCloseTo(42, 5);

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

  it("contabilizarOc: sobra = ENTREGUE − demanda (Marrom ANGELIM·Café, OC entregue por completo)", () => {
    // demanda 362,56 (livre 76,8 + comprometido 285,76), baixa 0, ENTREGUE 1000 (chegou tudo)
    const r = contabilizarOc(362.56, 285.76, 0, 1000);
    expect(r.usada).toBeCloseTo(285.76, 2);
    expect(r.reservadaLivre).toBeCloseTo(76.8, 2);
    expect(r.sobra).toBeCloseTo(637.44, 2);                   // 1000 − 362,56 (OC toda entregue)
    expect(r.baixaDomina).toBe(false);
  });

  it("contabilizarOc: entregue PARCIAL < demanda → Sobra NEGATIVA (déficit físico, jul/2026)", () => {
    // mesma demanda 362,56, mas só 300 entregue (falta chegar) → sobra 300 − 362,56 = −62,56
    const r = contabilizarOc(362.56, 285.76, 0, 300);
    expect(r.usada).toBeCloseTo(285.76, 2);
    expect(r.reservadaLivre).toBeCloseTo(76.8, 2);            // reservada/usada NÃO dependem do entregue
    expect(r.sobra).toBeCloseTo(-62.56, 2);                   // trava a nova semântica (entregue, não pedida)
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

// RÉGUA ÚNICA por VÍNCULO (decisão do dono 17/ago/2026 — flag "usar estoque existente" APOSENTADO):
// a Demanda que ABATE a Sobra do físico = cards VINCULADOS a OC/rolo; card SEM vínculo = "a comprar"
// (intenção de compra), à parte, NÃO abate. O split "do estoque" (que dependia do flag) foi REMOVIDO.
describe("plan-tecido/calc — régua única por vínculo (flag usar_estoque aposentado 17/ago)", () => {
  const mat = (consumo: number, grade: number, vid = "VBEGO") => ({
    artigo_id: "MALHA", artigo_nome: "MALHA BEGÔNIA", unidade_medida: "metro", rendimento: null,
    tipo: "tecido", numero: 1, consumo, loss_percent: 0, ordem: 0,
    variantes: [{ variante_tecido_id: vid, label: "VERMELHO - BORDO", ordem: 1, multiplicador: 1, grades: {}, grade_total: grade }],
  });
  // 1 card VESTIDO: 60 pç × 3,05 m = 183 m em VBEGO.
  const arv = () => ({ colecao_id: "c", subcolecoes: [{ subcolecao_id: "R1", ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
    slots: [{ id: "sVest", modelo_id: "mVest", slot_index: 0, custos_adicionais: [], materiais: [mat(3.05, 60)] }] }] }] }) as any;
  const ocArtigos = new Map([["OC3093", new Set(["MALHA"])]]);
  const ocVariantes = new Map([["OC3093", new Set(["VBEGO"])]]);

  it("detalheOc: reservPorOc conta o card vinculado à OC (183); sem split 'do estoque' no retorno", () => {
    const det = detalheOc(arv(), { mVest: ["OC3093"] }, {}, new Set(), ocArtigos, ocVariantes);
    expect(det.reservPorOc.get("OC3093")).toBeCloseTo(183, 2);
    expect(det.reservPorOcVar.get("OC3093|VBEGO")).toBeCloseTo(183, 2);
    // O split "do estoque" foi removido junto com o flag — as chaves não existem mais.
    expect("estoquePorOc" in det).toBe(false);
    expect("estoquePorOcVar" in det).toBe(false);
  });

  // RÉGUA do drawer 'oc' (Detalhe por variante): Demanda FÍSICA (abate Sobra) = cards VINCULADOS a
  // OC/rolo; card SEM vínculo = "a comprar", à parte. `fisico` = SÓ vínculo (sem mais o flag).
  const somaVBEGO = (a: any, filtro?: (s: any) => boolean) =>
    necessidadePorTecido(a, filtro).flatMap((t) => t.variantes).filter((v) => v.variante_tecido_id === "VBEGO").reduce((s, v) => s + v.metros, 0);
  const fisico = (vinc: Record<string, string[]>) => (s: any) => (!!s.modelo_id && (vinc[s.modelo_id]?.length ?? 0) > 0);
  const naoFisico = (vinc: Record<string, string[]>) => (s: any) => !fisico(vinc)(s);

  it("cenários da régua única (Entregue 555,55; card VESTIDO 60pç=183m) — vínculo abate, sem vínculo é compra", () => {
    const ENTREGUE = 555.55;
    const vincOC = { mVest: ["OC3093"] };              // vinculado à OC 3093
    const vincNENHUM = {} as Record<string, string[]>; // sem vínculo (ex-flagado inclusive)
    const cell = (vinc: Record<string, string[]>, pecas = 60) => {
      const a = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "R1", ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ id: "sVest", modelo_id: "mVest", slot_index: 0, custos_adicionais: [], materiais: [mat(3.05, pecas)] }] }] }] } as any;
      const demanda = Math.max(somaVBEGO(a, fisico(vinc)), 0);   // usada=0 no exemplo
      const aComprar = somaVBEGO(a, naoFisico(vinc));
      return { demanda, aComprar, sobra: contabilizarOc(demanda, 0, 0, ENTREGUE).sobra };
    };
    // 1) VINCULADO → Demanda 183 · a comprar 0 · Sobra +372,55 (abate o físico)
    expect(cell(vincOC)).toEqual({ demanda: 183, aComprar: 0, sobra: expect.closeTo(372.55, 2) });
    // 2) card 0 pç → Demanda 0 · Sobra +555,55 (baseline)
    expect(cell(vincOC, 0)).toEqual({ demanda: 0, aComprar: 0, sobra: expect.closeTo(555.55, 2) });
    // 3) SEM vínculo (mesmo card que ANTES seria "usar estoque") → Demanda 0 · a comprar 183 (à parte)
    //    · Sobra +555,55 (NÃO abate — vira COMPRA, sem sub-compra silenciosa)
    expect(cell(vincNENHUM)).toEqual({ demanda: 0, aComprar: 183, sobra: expect.closeTo(555.55, 2) });
  });
});

describe("plan-tecido/calc dedupVariantes (espelho do dedup do servidor)", () => {
  const v = (o: Partial<PtVariante>): PtVariante => ({ variante_tecido_id: null, cor_id: null, cor_apelido_id: null, ordem: 0, multiplicador: 1, grades: {}, grade_total: 0, ...o });

  it("colapsa a MESMA variante real 2× → 1 linha, mantém a de MAIOR grade_total (NÃO soma)", () => {
    // reproduz o bug da Loja Teste: bf3d513f 2× (grades 30 e 60) no mesmo material
    const out = dedupVariantes([
      v({ variante_tecido_id: "bf3d513f", grade_total: 30 }),
      v({ variante_tecido_id: "bf3d513f", grade_total: 60 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].variante_tecido_id).toBe("bf3d513f");
    expect(out[0].grade_total).toBe(60); // maior, nunca 90 (não soma)
    expect(out[0].ordem).toBe(1);
  });

  it("preserva variantes distintas e renumera ordem 1..n", () => {
    const out = dedupVariantes([
      v({ variante_tecido_id: "a", grade_total: 40, ordem: 5 }),
      v({ variante_tecido_id: "a", grade_total: 60, ordem: 6 }),
      v({ variante_tecido_id: "b", grade_total: 10, ordem: 7 }),
    ]);
    expect(out.map((x) => x.variante_tecido_id)).toEqual(["a", "b"]);
    expect(out.map((x) => x.ordem)).toEqual([1, 2]);
    expect(out[0].grade_total).toBe(60);
  });

  it("cor PLANEJADA (sem variante) colapsa por cor_id+cor_apelido_id", () => {
    const out = dedupVariantes([
      v({ cor_id: "c1", cor_apelido_id: "ap", grade_total: 5 }),
      v({ cor_id: "c1", cor_apelido_id: "ap", grade_total: 7 }),
      v({ cor_id: "c1", cor_apelido_id: "outro", grade_total: 3 }), // apelido diferente → distinta
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].grade_total).toBe(7);
    expect(out[1].cor_apelido_id).toBe("outro");
  });

  it("linhas SEM identidade (variante e cor nulos) NUNCA colapsam", () => {
    const out = dedupVariantes([v({ grade_total: 0 }), v({ grade_total: 0 })]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.ordem)).toEqual([1, 2]);
  });

  it("lista sem duplicata volta com o mesmo conteúdo (só renumera ordem)", () => {
    const out = dedupVariantes([v({ variante_tecido_id: "x", grade_total: 12, ordem: 3 })]);
    expect(out).toHaveLength(1);
    expect(out[0].ordem).toBe(1);
    expect(out[0].grade_total).toBe(12);
  });
});

describe("buildMateriaisAplicar (payload do 'Aplicar ao modelo' / auto-aplicar do save)", () => {
  const slot = (over: Partial<PtSlot>): PtSlot => ({ modelo_id: "m", materiais: [], ...over } as PtSlot);

  it("variante COM grades próprias mantém as grades (não redistribui)", () => {
    const s = slot({ proporcoes: { "40|M": 1 }, materiais: [
      { artigo_id: "A", tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: "v1", ordem: 1, multiplicador: 1, grades: { "40|M": 7 }, grade_total: 7 }] }] });
    const out = buildMateriaisAplicar(s);
    expect(out[0].variantes[0].grades).toEqual({ "40|M": 7 });
    expect(out[0].variantes[0].grade_total).toBe(7);
  });

  it("variante SEM grades distribui grade_total pela proporção do slot", () => {
    const s = slot({ proporcoes: { PP: 1, M: 2, G: 1 }, materiais: [
      { artigo_id: "A", tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: "v1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 100 }] }] });
    const out = buildMateriaisAplicar(s);
    // 100 distribuído: PP=25, M=50, G=25 (soma = grade_total)
    expect(Object.values(out[0].variantes[0].grades).reduce((a, b) => a + b, 0)).toBe(100);
    expect(out[0].variantes[0].grades["M"]).toBe(50);
  });

  it("preserva tipo/numero/artigo/consumo/loss e a identidade da variante", () => {
    const s = slot({ materiais: [
      { artigo_id: "A", tipo: "forro", numero: 2, consumo: 0.8, loss_percent: 5, ordem: 0,
        variantes: [{ variante_tecido_id: "vX", ordem: 3, multiplicador: 2, grades: { M: 4 }, grade_total: 4 }] }] });
    const [m] = buildMateriaisAplicar(s);
    expect({ tipo: m.tipo, numero: m.numero, artigo_id: m.artigo_id, consumo: m.consumo, loss_percent: m.loss_percent })
      .toEqual({ tipo: "forro", numero: 2, artigo_id: "A", consumo: 0.8, loss_percent: 5 });
    expect(m.variantes[0]).toMatchObject({ variante_tecido_id: "vX", ordem: 3, multiplicador: 2, grade_total: 4 });
  });
});

// ─── "A comprar" AO VIVO (item 2) ─────────────────────────────────────────────────────────────────
describe('plan-tecido/calc — "a comprar" AO VIVO', () => {
  // Espelha a prévia do servidor (chave `cobertura`): supply = max(0, nec_servidor − deficit_servidor).
  it("coberturaVar = max(0, nec_servidor − deficit_servidor); clampa em ≥0", () => {
    expect(coberturaVar(331.68, 31.68)).toBeCloseTo(300, 5); // caso real Ave Rara: OC cobre 300
    expect(coberturaVar(398.72, 398.72)).toBe(0);            // sem cobertura
    expect(coberturaVar(0, 0)).toBe(0);
    expect(coberturaVar(100, 200)).toBe(0);                  // deficit não pode passar da nec, mas clampa
  });

  it("aComprarVivoVar = max(0, nec_vivo − cobertura); nec_vivo==nec_servidor ⇒ == deficit_servidor (PARIDADE)", () => {
    // partially-covered (cobertura=300): editar a grade move o a comprar na hora
    expect(aComprarVivoVar(331.68, 331.68, 31.68)).toBeCloseTo(31.68, 5); // rascunho==salvo → paridade
    expect(aComprarVivoVar(400, 331.68, 31.68)).toBeCloseTo(100, 5);      // bumpou a grade → +
    expect(aComprarVivoVar(250, 331.68, 31.68)).toBe(0);                  // baixou abaixo da cobertura → 0
    // uncovered (cobertura=0): a comprar = a própria nec viva
    expect(aComprarVivoVar(398.72, 398.72, 398.72)).toBeCloseTo(398.72, 5);
    expect(aComprarVivoVar(450, 398.72, 398.72)).toBeCloseTo(450, 5);
  });

  it("PARIDADE por artigo: rascunho==salvo ⇒ Σ por artigo == déficit do servidor por artigo", () => {
    const cobertura: CoberturaVarRow[] = [
      { artigo_id: "A", variante_tecido_id: "v1", nec_m: 331.68, deficit_m: 31.68 }, // supply 300
      { artigo_id: "A", variante_tecido_id: "v2", nec_m: 398.72, deficit_m: 398.72 }, // supply 0
      { artigo_id: "B", variante_tecido_id: "v3", nec_m: 200, deficit_m: 0 },          // supply 200 (coberto)
    ];
    // nec VIVA == nec do servidor → paridade exata com o servidor (Σ deficit por artigo)
    const necVivo = new Map([["v1", 331.68], ["v2", 398.72], ["v3", 200]]);
    const out = aComprarVivoPorArtigo(cobertura, necVivo);
    expect(out.get("A")).toBeCloseTo(31.68 + 398.72, 4); // = Σ deficit do artigo A no servidor
    expect(out.has("B")).toBe(false);                    // deficit 0 → não entra (paridade)
  });

  it("CLAMP POR VARIANTE antes de somar (Σ max(0,·) ≠ max(0,Σ))", () => {
    // v1: nec_vivo 250 < cobertura 300 → 0 (NÃO deixa o excedente abater a v2)
    // v2: nec_vivo 450 > cobertura 0   → 450
    const cobertura: CoberturaVarRow[] = [
      { artigo_id: "A", variante_tecido_id: "v1", nec_m: 331.68, deficit_m: 31.68 }, // supply 300
      { artigo_id: "A", variante_tecido_id: "v2", nec_m: 398.72, deficit_m: 398.72 }, // supply 0
    ];
    const out = aComprarVivoPorArtigo(cobertura, new Map([["v1", 250], ["v2", 450]]));
    // clamp por variante: max(0,250−300)=0 + max(0,450−0)=450 = 450 (não 400 = max(0,(250+450)−300))
    expect(out.get("A")).toBeCloseTo(450, 4);
  });

  it("convergência ao salvar: valor vivo muda na digitação e, quando rascunho vira salvo, == servidor", () => {
    const cobertura: CoberturaVarRow[] = [{ artigo_id: "A", variante_tecido_id: "v1", nec_m: 300, deficit_m: 100 }]; // supply 200
    // durante a edição (rascunho 360, ainda não salvo)
    const vivo = aComprarVivoPorArtigo(cobertura, new Map([["v1", 360]]));
    expect(vivo.get("A")).toBeCloseTo(160, 4); // max(0, 360 − 200)
    // ao salvar, o servidor recomputa: nec_servidor=360, supply=200 (OC inalterada) → deficit=160.
    const coberturaSalva: CoberturaVarRow[] = [{ artigo_id: "A", variante_tecido_id: "v1", nec_m: 360, deficit_m: 160 }];
    const posSave = aComprarVivoPorArtigo(coberturaSalva, new Map([["v1", 360]]));
    expect(posSave.get("A")).toBeCloseTo(vivo.get("A")!, 4); // CONVERGE — mesmos números
  });

  it("variante planejada por cor (sem variante_tecido_id) fica FORA — igual à prévia do servidor", () => {
    const cobertura: CoberturaVarRow[] = [
      { artigo_id: "A", variante_tecido_id: null, nec_m: 100, deficit_m: 100 }, // planejada por cor → servidor não cobre
      { artigo_id: "A", variante_tecido_id: "v1", nec_m: 100, deficit_m: 100 },
    ];
    const out = aComprarVivoPorArtigo(cobertura, new Map([["v1", 100]]));
    expect(out.get("A")).toBeCloseTo(100, 4); // só a variante REAL entra
  });

  it("kg→m: helper trabalha só em METROS; nec viva (metros) casa com nec_servidor (metros) mesmo p/ tecido kg", () => {
    // artigo em kg: o servidor mantém nec/deficit em METROS (consumo m/pç × grade); kg só entra no
    // `qtd` do pedido. A necessidadePorTecido também devolve METROS. Logo o helper nunca divide por
    // rendimento — paridade de unidade garantida. Aqui um artigo "kg" com nec/deficit em metros.
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "MALHA", artigo_nome: "Malha", unidade_medida: "kg", rendimento: 3, tipo: "tecido", numero: 1, consumo: 1.5, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "vk", label: "Preto", ordem: 1, multiplicador: 1, grades: {}, grade_total: 100 }] } ] },
    ] }] }] };
    const necVivo = necVivoPorVariante(arv); // 1.5 × 100 = 150 m (METROS, não kg)
    expect(necVivo.get("vk")).toBeCloseTo(150, 5);
    const cobertura: CoberturaVarRow[] = [{ artigo_id: "MALHA", variante_tecido_id: "vk", nec_m: 150, deficit_m: 60 }]; // servidor em metros; supply 90
    const out = aComprarVivoPorArtigo(cobertura, necVivo);
    expect(out.get("MALHA")).toBeCloseTo(60, 4); // rascunho==salvo → paridade (60 m, NÃO 20 kg)
  });

  it("necVivoPorVariante soma por variante_tecido_id e ignora cor sem id", () => {
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
          variantes: [
            { variante_tecido_id: "v1", label: "x", ordem: 1, multiplicador: 1, grades: {}, grade_total: 90 },
            { variante_tecido_id: null, cor_id: "corX", label: "planejada", ordem: 2, multiplicador: 1, grades: {}, grade_total: 50 },
          ] } ] },
      { modelo_id: null, materiais: [
        { artigo_id: "A", artigo_nome: "Viscose", unidade_medida: "metro", rendimento: null, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: "v1", label: "x", ordem: 1, multiplicador: 1, grades: {}, grade_total: 10 }] } ] },
    ] }] }] };
    const m = necVivoPorVariante(arv);
    expect(m.get("v1")).toBeCloseTo(100, 5); // 90 + 10
    expect(m.size).toBe(1);                  // a cor planejada (sem id) não entra
  });
});
