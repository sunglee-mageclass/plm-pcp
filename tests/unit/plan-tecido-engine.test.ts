import { describe, it, expect } from "vitest";
import { semearArvore, mergeArvore, semearComModelos, comConsumoDoPlano, comVariantesDoPlano, comGradeDoPlano, slotDeModeloReal, type ModeloReal } from "@/lib/plan-tecido/engine";

describe("plan-tecido/engine", () => {
  it("semeia N slots por bucket", () => {
    const arv = semearArvore({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 2 }] });
    expect(arv.subcolecoes).toHaveLength(1);
    expect(arv.subcolecoes[0].linhas[0].slots).toHaveLength(2);
    expect(arv.subcolecoes[0].linhas[0].slots[0].materiais).toEqual([]);
  });

  it("merge preserva materiais/grade do plano salvo pela chave do bucket+slot_index", () => {
    const seed = semearArvore({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }] });
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const merged = mergeArvore(seed, salvo);
    expect(merged.subcolecoes[0].linhas[0].slots[0].materiais[0].artigo_id).toBe("A");
  });

  it("semearComModelos: um modelo real com 1 tecido + grade vira 1 slot pré-preenchido", () => {
    const modelo: ModeloReal = {
      id: "m1", ref: "REF1", nome: "Vestido", subcolecao: "Verão", subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes: { PP: 1, P: 2, M: 2 },
      materiais: [{ tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1.4, loss_percent: 5,
        variantes: [{ variante_tecido_id: "v1", ordem: 1, multiplicador: 1 }] }],
      grade: { 1: { grades: { PP: 3, P: 4, M: 3 }, grade_total: 10 } },
    };
    const arv = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [modelo] });
    const slot = arv.subcolecoes[0].linhas[0].slots[0];
    expect(slot.modelo_id).toBe("m1");
    expect(slot.ref).toBe("REF1");
    expect(slot.proporcoes).toEqual({ PP: 1, P: 2, M: 2 });
    expect(slot.materiais).toHaveLength(1);
    expect(slot.materiais[0].artigo_id).toBe("A");
    expect(slot.materiais[0].consumo).toBe(1.4);
    expect(slot.materiais[0].variantes[0].variante_tecido_id).toBe("v1");
    expect(slot.materiais[0].variantes[0].grade_total).toBe(10);
    expect(slot.materiais[0].variantes[0].grades).toEqual({ PP: 3, P: 4, M: 3 });
  });

  it("semearComModelos: bucket com qtd>modelos completa com slots vazios", () => {
    const modelo: ModeloReal = {
      id: "m1", ref: null, nome: null, subcolecao: "Verão", subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes: null,
      materiais: [], grade: {},
    };
    const arv = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 3 }], modelos: [modelo] });
    const slots = arv.subcolecoes[0].linhas[0].slots;
    expect(slots).toHaveLength(3); // 1 real + 2 vazios
    expect(slots[0].modelo_id).toBe("m1");
    expect(slots[1].modelo_id).toBeNull();
    expect(slots[2].modelo_id).toBeNull();
  });

  it("mergeArvore: slot salvo VAZIO não apaga o modelo semeado (bug do plano pré-semeadura)", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "M1", slot_index: 0, ref: "REF1", custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slot = merged.subcolecoes[0].linhas[0].slots[0];
    expect(slot.modelo_id).toBe("M1");
    expect(slot.materiais).toHaveLength(1);
    expect(slot.ref).toBe("REF1");
  });

  it("mergeArvore: MODELO REAL usa o BOM VIVO do seed (a.1); campos de plano do salvo vencem", () => {
    // modelo_id presente = card avançado: o BOM (materiais) reflete o Desenvolvimento (seed=vivo),
    // não o snapshot salvo. Já custo/preço/proporção são do plano → salvo vence.
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "M1", slot_index: 0, ref: "REF1", proporcoes: { M: 1 }, custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "M1", slot_index: 0, custo_terceirizados_previsto: 9, custos_adicionais: [], materiais: [{ artigo_id: "B", tipo: "tecido" as const, numero: 1, consumo: 2, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slot = merged.subcolecoes[0].linhas[0].slots[0];
    expect(slot.materiais[0].artigo_id).toBe("A"); // BOM vivo (seed) vence p/ modelo real
    expect(slot.ref).toBe("REF1");
    expect(slot.custo_terceirizados_previsto).toBe(9); // campo de plano do salvo
  });

  it("mergeArvore: slot de PLANEJAMENTO (sem modelo) mantém o BOM salvo (rascunho)", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [{ artigo_id: "B", tipo: "tecido" as const, numero: 1, consumo: 2, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    expect(merged.subcolecoes[0].linhas[0].slots[0].materiais[0].artigo_id).toBe("B"); // rascunho salvo vence
  });

  it("mergeArvore: slot de modelo SALVO desalinhado puxa o BOM VIVO por modelo_id (bug Renda Delicate)", () => {
    // Seed: M1 com BOM vivo ANGELIM no índice 0; índice 1 é um slot VAZIO (sem modelo).
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
      slots: [
        { modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [{ artigo_id: "ANGELIM", tipo: "tecido" as const, numero: 1, consumo: 1.7, loss_percent: 0, ordem: 0, variantes: [] }] },
        { modelo_id: null, slot_index: 1, custos_adicionais: [], materiais: [] },
      ] }] }] };
    // Salvo (stale): M1 caiu no índice 1 com um snapshot ANTIGO RENDA; índice 0 é rascunho vazio.
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
      slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] },
        { modelo_id: "M1", slot_index: 1, ref: "REF1", custos_adicionais: [], materiais: [{ artigo_id: "RENDA", tipo: "tecido" as const, numero: 1, consumo: 2, loss_percent: 0, ordem: 0, variantes: [] }] },
      ] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    // O modelo aparece UMA vez (o salvo casa por modelo_id, não pela posição — sem duplicar),
    // na POSIÇÃO VIVA do seed, com o BOM VIVO (ANGELIM) e os campos de plano do salvo (ref).
    const slotsM1 = merged.subcolecoes[0].linhas[0].slots.filter((s) => s.modelo_id === "M1");
    expect(slotsM1).toHaveLength(1);
    expect(slotsM1[0].materiais[0].artigo_id).toBe("ANGELIM");
    expect(slotsM1[0].ref).toBe("REF1");
  });

  it("mergeArvore: modelo MOVIDO de subcoleção (R1→R2) segue a colocação VIVA (bug Ave Rara)", () => {
    // Vivo: M1 agora está em S2 (R2). Seed reflete isso (S1 ficou com um vazio do bucket).
    const seed = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
        slots: [{ modelo_id: "M1", slot_index: 0, ref: "REF1", custos_adicionais: [], materiais: [{ artigo_id: "VIVO", tipo: "tecido" as const, numero: 1, consumo: 1.5, loss_percent: 0, ordem: 0, variantes: [] }] }] }] },
    ] };
    // Salvo (antes da mudança): M1 estava em S1, com campos de plano (custo 9).
    const salvo = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
        slots: [{ modelo_id: "M1", slot_index: 0, custo_terceirizados_previsto: 9, custos_adicionais: [], materiais: [{ artigo_id: "SNAP", tipo: "tecido" as const, numero: 1, consumo: 2, loss_percent: 0, ordem: 0, variantes: [] }] }] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [] }] },
    ] };
    const merged = mergeArvore(seed as any, salvo as any);
    const s1 = merged.subcolecoes.find((s) => s.subcolecao_id === "S1")!;
    const s2 = merged.subcolecoes.find((s) => s.subcolecao_id === "S2")!;
    // NÃO fica pregado em S1 (era o bug: 11 modelos da Ave Rara presos em R1)…
    expect(s1.linhas[0].slots.filter((s) => s.modelo_id === "M1")).toHaveLength(0);
    // …aparece UMA vez em S2 (colocação viva), carregando os campos de plano salvos + BOM vivo.
    const emS2 = s2.linhas[0].slots.filter((s) => s.modelo_id === "M1");
    expect(emS2).toHaveLength(1);
    expect(emS2[0].custo_terceirizados_previsto).toBe(9); // dado do plano SEGUE o modelo
    expect(emS2[0].materiais[0].artigo_id).toBe("VIVO");  // BOM vivo (regra a.1)
  });

  it("mergeArvore: rascunho salvo (sem modelo) ainda pareia com vazio mesmo com modelo movido no bucket", () => {
    // S1 salvo: [M1 (movido p/ fora), rascunho B]. Seed S1: [vazio, vazio] (bucket qtd 2).
    const seed = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
        slots: [
          { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] },
          { modelo_id: null, slot_index: 1, custos_adicionais: [], materiais: [] },
        ] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
        slots: [{ modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [] }] }] },
    ] };
    const salvo = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
        slots: [
          { modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [] },
          { modelo_id: null, slot_index: 1, custos_adicionais: [], materiais: [{ artigo_id: "B", tipo: "tecido" as const, numero: 1, consumo: 2, loss_percent: 0, ordem: 0, variantes: [] }] },
        ] }] },
    ] };
    const merged = mergeArvore(seed as any, salvo as any);
    const s1 = merged.subcolecoes.find((s) => s.subcolecao_id === "S1")!;
    // O slot salvo do M1 (modelo vivo em OUTRO bucket) não entra no pareamento posicional;
    // o rascunho B casa com o PRIMEIRO vazio do seed.
    expect(s1.linhas[0].slots[0].modelo_id).toBeNull();
    expect(s1.linhas[0].slots[0].materiais[0]?.artigo_id).toBe("B");
    expect(s1.linhas[0].slots.filter((s) => s.modelo_id === "M1")).toHaveLength(0);
  });

  it("semearComModelos: card nasce com categoria_tecido_id do Tecido 1 (auto-categorização)", () => {
    const modelo: ModeloReal = {
      id: "M1", ref: null, nome: "Vestido", thumb_path: null, subcolecao: null, subcolecao_id: null,
      linha_id: null, categoria_id: null, categoria_tecido_id: "CAT_CHIFFON",
      materiais: [{ tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [] }], grade: {},
    };
    const arv = semearComModelos({ colecao_id: "c", tipo: "orcamento", buckets: [{ subcolecao_id: null, linha_id: null, categoria_id: null, qtd: 1 }], modelos: [modelo] });
    expect(arv.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe("CAT_CHIFFON");
  });

  it("semearComModelos: subcoleção SEM modelo nem bucket ainda aparece (bug R3 sumida)", () => {
    const modelo: ModeloReal = {
      id: "M1", ref: null, nome: "Vestido", thumb_path: null, subcolecao: "R1", subcolecao_id: "S1",
      linha_id: null, categoria_id: null, materiais: [], grade: {},
    };
    // 3 subcoleções na coleção, mas modelos só em S1 e nenhum bucket → S2 e S3 ainda devem existir.
    const arv = semearComModelos({
      colecao_id: "c", tipo: "orcamento", buckets: [],
      subcolecoes: [{ subcolecao_id: "S1", ordem: 0 }, { subcolecao_id: "S2", ordem: 1 }, { subcolecao_id: "S3", ordem: 2 }],
      modelos: [modelo],
    });
    const ids = arv.subcolecoes.map((s) => s.subcolecao_id);
    expect(arv.subcolecoes).toHaveLength(3);
    expect(ids).toEqual(["S1", "S2", "S3"]); // ordem preservada
    // ⚠️ e o MODELO continua colocado na sua sub (S1) — enumerar as subs não pode roubar o modelo
    const nModelos = arv.subcolecoes.reduce((a, s) => a + s.linhas.reduce((b, l) => b + l.slots.filter((x) => x.modelo_id).length, 0), 0);
    expect(nModelos).toBe(1);
    const s1 = arv.subcolecoes.find((s) => s.subcolecao_id === "S1")!;
    expect(s1.linhas.reduce((b, l) => b + l.slots.filter((x) => x.modelo_id === "M1").length, 0)).toBe(1);
  });

  it("mergeArvore: categoria manual salva VENCE, mas sem categoria salva auto-preenche do seed", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
      slots: [
        { modelo_id: "M1", slot_index: 0, categoria_tecido_id: "AUTO_A", custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] },
        { modelo_id: "M2", slot_index: 1, categoria_tecido_id: "AUTO_B", custos_adicionais: [], materiais: [{ artigo_id: "B", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] },
      ] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0,
      slots: [
        { modelo_id: "M1", slot_index: 0, categoria_tecido_id: "MANUAL_X", custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] },
        { modelo_id: "M2", slot_index: 1, categoria_tecido_id: null, custos_adicionais: [], materiais: [{ artigo_id: "B", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] },
      ] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slots = merged.subcolecoes[0].linhas[0].slots;
    expect(slots[0].categoria_tecido_id).toBe("MANUAL_X"); // override manual do usuário preservado
    expect(slots[1].categoria_tecido_id).toBe("AUTO_B");   // salvo sem categoria → auto do seed
  });
  describe("comConsumoDoPlano (auditoria jul/2026 — Dev vence só se preenchido)", () => {
    const mat = (over: Record<string, unknown>) =>
      ({ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 0, loss_percent: 0, ordem: 0, variantes: [], ...over });

    it("consumo 0 no Dev cai no consumo salvo do MESMO artigo+tipo", () => {
      const out = comConsumoDoPlano([mat({ consumo: 0 })], [mat({ consumo: 3.1 })]);
      expect(out[0].consumo).toBe(3.1);
    });
    it("consumo preenchido no Dev NÃO é sobrescrito pelo salvo", () => {
      const out = comConsumoDoPlano([mat({ consumo: 2.22 })], [mat({ consumo: 9 })]);
      expect(out[0].consumo).toBe(2.22);
    });
    it("artigo diferente no salvo não vaza (nem tipo forro pro tecido)", () => {
      expect(comConsumoDoPlano([mat({ consumo: 0 })], [mat({ artigo_id: "B", consumo: 5 })])[0].consumo).toBe(0);
      expect(comConsumoDoPlano([mat({ consumo: 0 })], [mat({ tipo: "forro" as const, consumo: 5 })])[0].consumo).toBe(0);
    });
    it("sem salvo (ou salvo com consumo 0) mantém o vivo", () => {
      expect(comConsumoDoPlano([mat({ consumo: 0 })], null)[0].consumo).toBe(0);
      expect(comConsumoDoPlano([mat({ consumo: 0 })], [mat({ consumo: 0 })])[0].consumo).toBe(0);
    });
    it("merge de card real com Dev zerado usa o consumo do plano salvo (caso SAMIRA)", () => {
      const modelo: ModeloReal = { id: "m1", ref: null, nome: "VESTIDO SAMIRA", categoria_tecido_id: null, thumb_path: null,
        subcolecao: null, subcolecao_id: "s1", linha_id: "l1", categoria_id: null, proporcoes: null,
        materiais: [{ artigo_id: "ANG", tipo: "tecido", numero: 1, consumo: 0, loss_percent: 0, ordem: 0, variantes: [] }],
        materiais_custo: 0, grade: null };
      const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
        buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [modelo] });
      const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
        slots: [{ modelo_id: "m1", slot_index: 0, materiais: [{ artigo_id: "ANG", tipo: "tecido" as const, numero: 1, consumo: 3.1, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
      const merged = mergeArvore(seed, salvo as never);
      expect(merged.subcolecoes[0].linhas[0].slots[0].materiais[0].consumo).toBe(3.1);
    });
  });

  // FIX 1 (ago/2026): a partição por artigo pode emitir 2+ materiais do MESMO tipo com o mesmo
  // `numero` do bloco (bloco de forro com variantes de 2 artigos). slotDeModeloReal renumera 1..n
  // POR TIPO → sem colisão em uq_plan_mat(slot_id,tipo,numero) no salvar_plan_tecido.
  describe("slotDeModeloReal: numero 1..n por tipo (partição 2 artigos)", () => {
    it("dois forros de artigos distintos (numero=1 do bloco) viram Forro 1 e Forro 2", () => {
      const mr: ModeloReal = {
        id: "M", ref: null, nome: "VESTIDO VALEN", subcolecao: null, subcolecao_id: null,
        linha_id: null, categoria_id: null, proporcoes: null, grade: {},
        materiais: [
          // principal + substituto no MESMO bloco de forro → partição emite (forro, numero=1) 2x
          { tipo: "forro", numero: 1, artigo_id: "d30bac25", consumo: 1.2, loss_percent: 0,
            variantes: [{ variante_tecido_id: "vP", ordem: 1, multiplicador: 1 }] },
          { tipo: "forro", numero: 1, artigo_id: "809ef37a", consumo: 1.2, loss_percent: 0,
            variantes: [{ variante_tecido_id: "vS", ordem: 1, multiplicador: 1 }] },
        ],
      };
      const slot = slotDeModeloReal(mr, 0);
      expect(slot.materiais.map((m) => [m.tipo, m.numero])).toEqual([["forro", 1], ["forro", 2]]);
      // o substituto (2º artigo) APARECE (pedido de UX) como Forro 2, com sua variante
      expect(slot.materiais[1].artigo_id).toBe("809ef37a");
      expect(slot.materiais[1].variantes[0].variante_tecido_id).toBe("vS");
      // sem colisão de chave (slot_id,tipo,numero) dentro do mesmo tipo
      const chaves = slot.materiais.map((m) => `${m.tipo}|${m.numero}`);
      expect(new Set(chaves).size).toBe(chaves.length);
    });

    it("renumera cada tipo independente e preserva Tecido 1 = numero 1 (auto-categorização)", () => {
      const mr: ModeloReal = {
        id: "M", ref: null, nome: null, subcolecao: null, subcolecao_id: null,
        linha_id: null, categoria_id: null, proporcoes: null, grade: {},
        materiais: [
          { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [] },
          { tipo: "forro", numero: 1, artigo_id: "F1", consumo: 1, loss_percent: 0, variantes: [] },
          { tipo: "tecido", numero: 1, artigo_id: "B", consumo: 1, loss_percent: 0, variantes: [] },
          { tipo: "forro", numero: 1, artigo_id: "F2", consumo: 1, loss_percent: 0, variantes: [] },
        ],
      };
      const slot = slotDeModeloReal(mr, 0);
      expect(slot.materiais.map((m) => [m.tipo, m.numero])).toEqual([
        ["tecido", 1], ["forro", 1], ["tecido", 2], ["forro", 2],
      ]);
      const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
      expect(tec1?.artigo_id).toBe("A"); // 1º tecido na ordem estável continua sendo o Tecido 1
    });

    it("card com forro de 2 artigos SALVA a coleção inteira sem colidir numero (repro VESTIDO VALEN)", () => {
      const modelo: ModeloReal = {
        id: "valen", ref: "REF", nome: "VESTIDO VALEN", subcolecao: null, subcolecao_id: "s1",
        linha_id: "l1", categoria_id: null, proporcoes: null, grade: {},
        materiais: [
          { tipo: "forro", numero: 1, artigo_id: "d30bac25", consumo: 1.2, loss_percent: 0,
            variantes: [{ variante_tecido_id: "vP", ordem: 1, multiplicador: 1 }] },
          { tipo: "forro", numero: 1, artigo_id: "809ef37a", consumo: 1.2, loss_percent: 0,
            variantes: [{ variante_tecido_id: "vS", ordem: 1, multiplicador: 1 }] },
        ],
      };
      const arv = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
        buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [modelo] });
      const mats = arv.subcolecoes[0].linhas[0].slots[0].materiais;
      const chaves = mats.map((m) => `${m.tipo}|${m.numero}`);
      expect(new Set(chaves).size).toBe(chaves.length); // estado-completo salvável sem 23505
    });
  });

  // FIX 2 (ago/2026): variantes digitadas no card e salvas (sem "Aplicar ao modelo") não podem sumir
  // no reload. Mesmo princípio do comConsumoDoPlano: Dev vence só se preenchido, senão vale o plano.
  describe("comVariantesDoPlano (Dev vence só se tem variantes, senão vale o plano)", () => {
    const mat = (over: Record<string, unknown>) =>
      ({ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [], ...over });
    const vte = (id: string, ordem: number, over: Record<string, unknown> = {}) =>
      ({ variante_tecido_id: id, ordem, multiplicador: 1, grades: {}, grade_total: 0, ...over });

    it("BOM cheio vence: variantes do vivo mantidas, salvo ignorado", () => {
      const out = comVariantesDoPlano(
        [mat({ variantes: [vte("BOM", 1)] })],
        [mat({ variantes: [vte("PLAN", 1)] })],
      );
      expect(out[0].variantes.map((v) => v.variante_tecido_id)).toEqual(["BOM"]);
    });

    it("BOM vazio + plano cheio: variantes do plano aparecem, renumeradas 1..n", () => {
      const out = comVariantesDoPlano(
        [mat({ variantes: [] })],
        [mat({ variantes: [vte("c1", 5, { grade_total: 10 }), vte("c2", 9)] })],
      );
      expect(out[0].variantes.map((v) => [v.variante_tecido_id, v.ordem])).toEqual([["c1", 1], ["c2", 2]]);
      expect(out[0].variantes[0].grade_total).toBe(10); // grades/pç preservados
    });

    it("os dois vazios → continua vazio", () => {
      expect(comVariantesDoPlano([mat({ variantes: [] })], [mat({ variantes: [] })])[0].variantes).toEqual([]);
      expect(comVariantesDoPlano([mat({ variantes: [] })], null)[0].variantes).toEqual([]);
    });

    it("só casa mesmo artigo+tipo; não vaza de forro/artigo diferente", () => {
      expect(comVariantesDoPlano([mat({ variantes: [] })], [mat({ artigo_id: "B", variantes: [vte("x", 1)] })])[0].variantes).toEqual([]);
      expect(comVariantesDoPlano([mat({ variantes: [] })], [mat({ tipo: "forro" as const, variantes: [vte("x", 1)] })])[0].variantes).toEqual([]);
    });

    it("não duplica cor (variante_tecido_id repetido)", () => {
      const out = comVariantesDoPlano([mat({ variantes: [] })], [mat({ variantes: [vte("c1", 1), vte("c1", 2), vte("c2", 3)] })]);
      expect(out[0].variantes.map((v) => v.variante_tecido_id)).toEqual(["c1", "c2"]);
    });
  });

  // BUG #9 (causa raiz do "reverteu"): quando o BOM VIVO do Dev JÁ TEM variantes, comVariantesDoPlano
  // faz o BOM vencer — uma cor NOVA digitada no card e salva SÓ no plano NÃO aparece no reload (o merge
  // re-deriva do BOM vivo, que não a tem). É por isso que editar pelo card "revertia". O fix é o
  // AUTO-APLICAR no save (Sheet): espelha a edição no BOM vivo, aí o merge passa a exibi-la. Este teste
  // DOCUMENTA o mecanismo do merge (que é correto — o BOM é a fonte da exibição — desde que o auto-aplicar
  // mantenha o BOM em dia).
  it("mergeArvore: cor NOVA só-no-plano é DROPADA quando o BOM vivo já tem cor (mecanismo do 'reverteu')", () => {
    const modelo: ModeloReal = {
      id: "m1", ref: "REF", nome: "Blusa", subcolecao: null, subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes: null, grade: { 1: { grades: { M: 5 }, grade_total: 5 } },
      // BOM VIVO do Dev já tem a cor "corA"
      materiais: [{ tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1.4, loss_percent: 0,
        variantes: [{ variante_tecido_id: "corA", ordem: 1, multiplicador: 1 }] }],
    };
    const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [modelo] });
    // plano SALVO com a cor extra "corB" (digitada no card, sem "Aplicar ao modelo")
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "m1", slot_index: 0, materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
        variantes: [
          { variante_tecido_id: "corA", ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 },
          { variante_tecido_id: "corB", ordem: 2, multiplicador: 1, grades: { M: 3 }, grade_total: 3 },
        ] }] }] }] }] };
    const merged = mergeArvore(seed, salvo as never);
    const mm = merged.subcolecoes[0].linhas[0].slots[0].materiais[0];
    // a cor NOVA some no reload (BOM vivo só tem corA) → é o que o dono via como "reverteu".
    // (O auto-aplicar do save conserta ISSO gravando corB no BOM vivo — coberto na integração.)
    expect(mm.variantes.map((v) => v.variante_tecido_id)).toEqual(["corA"]);
  });

  it("mergeArvore: variantes salvas no plano sobrevivem quando o BOM vivo tem 0 variantes (FIX 2)", () => {
    // Card real com BOM vivo SEM variantes (Dev não recebeu cores); o usuário digitou cores no card
    // do Plan. Tecido e Salvou (sem Aplicar). No reload o BOM vivo não pode apagar as variantes salvas.
    const modelo: ModeloReal = {
      id: "m1", ref: "REF", nome: "Vestido", subcolecao: null, subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes: null, grade: {},
      materiais: [{ tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1.4, loss_percent: 0, variantes: [] }],
    };
    const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [modelo] });
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "m1", slot_index: 0, materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: "cor1", ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 }] }] }] }] }] };
    const merged = mergeArvore(seed, salvo as never);
    const mm = merged.subcolecoes[0].linhas[0].slots[0].materiais[0];
    expect(mm.variantes.map((v) => v.variante_tecido_id)).toEqual(["cor1"]);
    expect(mm.variantes[0].grade_total).toBe(5);
  });

  // A grade do Dev (modelo_grades) só descreve o TECIDO 1 (chave = ordem da variante do Tecido 1).
  // slotDeModeloReal não deve aplicá-la por `ordem` a forro/Tecido 2 (cross-read do Tecido 1).
  describe("slotDeModeloReal: grade do Dev só no Tecido 1 (não vaza p/ forro/Tecido 2)", () => {
    const base = { id: "m", ref: null, nome: null, subcolecao: null, subcolecao_id: null,
      linha_id: null, categoria_id: null, proporcoes: null } as const;

    it("Tecido 1 puxa a grade do Dev por ordem=variante_numero", () => {
      const mr: ModeloReal = { ...base,
        materiais: [{ tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0,
          variantes: [{ variante_tecido_id: "t1", ordem: 1, multiplicador: 1 }, { variante_tecido_id: "t2", ordem: 2, multiplicador: 1 }] }],
        grade: { 1: { grades: { M: 10 }, grade_total: 10 }, 2: { grades: { M: 20 }, grade_total: 20 } } };
      const slot = slotDeModeloReal(mr, 0);
      expect(slot.materiais[0].variantes.map((v) => v.grade_total)).toEqual([10, 20]);
    });

    it("FORRO NÃO puxa a grade do Dev (nasce sem pç — vem do plano depois)", () => {
      const mr: ModeloReal = { ...base,
        materiais: [
          { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0,
            variantes: [{ variante_tecido_id: "t1", ordem: 1, multiplicador: 1 }] },
          // forro com variantes de ordem 1,2 — antes cross-lia grade[1]=10, grade[2]=20 do Tecido 1
          { tipo: "forro", numero: 1, artigo_id: "F", consumo: 0.4, loss_percent: 0,
            variantes: [{ variante_tecido_id: "f1", ordem: 1, multiplicador: 1 }, { variante_tecido_id: "f2", ordem: 2, multiplicador: 1 }] },
        ],
        grade: { 1: { grades: { M: 10 }, grade_total: 10 }, 2: { grades: { M: 20 }, grade_total: 20 } } };
      const slot = slotDeModeloReal(mr, 0);
      const forro = slot.materiais.find((m) => m.tipo === "forro")!;
      expect(forro.variantes.map((v) => v.grade_total)).toEqual([0, 0]);
      expect(forro.variantes.map((v) => v.grades)).toEqual([{}, {}]);
    });

    it("Tecido 2 NÃO puxa a grade do Dev do Tecido 1", () => {
      const mr: ModeloReal = { ...base,
        materiais: [
          { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0,
            variantes: [{ variante_tecido_id: "t1", ordem: 1, multiplicador: 1 }] },
          { tipo: "tecido", numero: 2, artigo_id: "B", consumo: 1, loss_percent: 0,
            variantes: [{ variante_tecido_id: "b1", ordem: 1, multiplicador: 1 }] },
        ],
        grade: { 1: { grades: { M: 10 }, grade_total: 10 } } };
      const slot = slotDeModeloReal(mr, 0);
      const tec2 = slot.materiais.find((m) => m.numero === 2 && m.tipo === "tecido")!;
      expect(tec2.variantes[0].grade_total).toBe(0);
    });
  });

  // pç (grade) por variante do plano quando o vivo (Dev) não tem — forro/Tecido 2 ou variante nova.
  describe("comGradeDoPlano (Dev vence só se tem pç, senão vale o plano)", () => {
    const mat = (over: Record<string, unknown>) =>
      ({ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [], ...over });
    const vte = (id: string, over: Record<string, unknown> = {}) =>
      ({ variante_tecido_id: id, ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, ...over });

    it("vivo SEM pç + plano COM pç → usa a pç do plano (casada por variante_tecido_id)", () => {
      const out = comGradeDoPlano(
        [mat({ tipo: "forro" as const, artigo_id: "F", variantes: [vte("f1"), vte("f2")] })],
        [mat({ tipo: "forro" as const, artigo_id: "F", variantes: [vte("f1", { grades: { M: 7 }, grade_total: 7 }), vte("f2", { grades: { M: 3 }, grade_total: 3 })] })],
      );
      expect(out[0].variantes.map((v) => v.grade_total)).toEqual([7, 3]);
      expect(out[0].variantes[0].grades).toEqual({ M: 7 });
    });

    it("vivo COM pç → vivo VENCE (não sobrescreve pelo plano)", () => {
      const out = comGradeDoPlano(
        [mat({ variantes: [vte("t1", { grade_total: 64, grades: { M: 64 } })] })],
        [mat({ variantes: [vte("t1", { grade_total: 99, grades: { M: 99 } })] })],
      );
      expect(out[0].variantes[0].grade_total).toBe(64);
    });

    it("cor PLANEJADA (variante_tecido_id null) casa por cor_id+apelido", () => {
      const out = comGradeDoPlano(
        [mat({ variantes: [{ variante_tecido_id: null, cor_id: "c1", cor_apelido_id: "a1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 }] })],
        [mat({ variantes: [{ variante_tecido_id: null, cor_id: "c1", cor_apelido_id: "a1", ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 }] })],
      );
      expect(out[0].variantes[0].grade_total).toBe(5);
    });

    it("só casa mesmo artigo+tipo; plano nulo/vazio = passthrough", () => {
      expect(comGradeDoPlano([mat({ variantes: [vte("t1")] })], [mat({ artigo_id: "B", variantes: [vte("t1", { grade_total: 5 })] })])[0].variantes[0].grade_total).toBe(0);
      expect(comGradeDoPlano([mat({ variantes: [vte("t1")] })], null)[0].variantes[0].grade_total).toBe(0);
      expect(comGradeDoPlano([mat({ variantes: [vte("t1")] })], [])[0].variantes[0].grade_total).toBe(0);
    });
  });

  it("mergeArvore: pç do FORRO salva no plano sobrevive (Dev não tem grade de forro)", () => {
    // Card real: Tecido 1 com grade do Dev; forro com pç digitada no card (só no plano). O reload não
    // pode zerar a pç do forro — o Dev não tem grade de forro, então o plano é a fonte.
    const modelo: ModeloReal = {
      id: "m1", ref: "REF", nome: "Vestido", subcolecao: null, subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes: null,
      materiais: [
        { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 2, loss_percent: 0, variantes: [{ variante_tecido_id: "t1", ordem: 1, multiplicador: 1 }] },
        { tipo: "forro", numero: 1, artigo_id: "F", consumo: 0.5, loss_percent: 0, variantes: [{ variante_tecido_id: "f1", ordem: 1, multiplicador: 1 }] },
      ],
      grade: { 1: { grades: { M: 30 }, grade_total: 30 } },
    };
    const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [modelo] });
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "m1", slot_index: 0, materiais: [
        { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 2, loss_percent: 0, ordem: 0, variantes: [{ variante_tecido_id: "t1", ordem: 1, multiplicador: 1, grades: { M: 999 }, grade_total: 999 }] },
        { artigo_id: "F", tipo: "forro" as const, numero: 1, consumo: 0.5, loss_percent: 0, ordem: 1, variantes: [{ variante_tecido_id: "f1", ordem: 1, multiplicador: 1, grades: { M: 30 }, grade_total: 30 }] },
      ] }] }] }] };
    const merged = mergeArvore(seed, salvo as never);
    const mats = merged.subcolecoes[0].linhas[0].slots[0].materiais;
    const tec = mats.find((m) => m.tipo === "tecido")!;
    const forro = mats.find((m) => m.tipo === "forro")!;
    expect(tec.variantes[0].grade_total).toBe(30);  // Tecido 1: Dev VENCE (não os 999 do plano)
    expect(forro.variantes[0].grade_total).toBe(30); // Forro: pç do PLANO (Dev não tem grade de forro)
  });

  describe("mergeArvore proporção: Dev vence se preenchido, plano é fallback", () => {
    const mkModelo = (proporcoes: Record<string, number> | null): ModeloReal => ({
      id: "m1", ref: "R", nome: "V", subcolecao: null, subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes,
      materiais: [{ tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [] }], grade: {},
    });
    const mkSalvo = (proporcoes: Record<string, number>) => ({ colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "m1", slot_index: 0, proporcoes, materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] });
    const seedOf = (m: ModeloReal) => semearComModelos({ colecao_id: "c", tipo: "poder_venda",
      buckets: [{ subcolecao_id: "s1", linha_id: "l1", categoria_id: null, qtd: 1 }], modelos: [m] });

    it("modelo COM proporção + plano com proporção VAZIA ({}) → usa a do MODELO", () => {
      const merged = mergeArvore(seedOf(mkModelo({ "40|M": 2, "42|G": 1 })), mkSalvo({}) as never);
      expect(merged.subcolecoes[0].linhas[0].slots[0].proporcoes).toEqual({ "40|M": 2, "42|G": 1 });
    });

    it("modelo SEM proporção → cai no plano salvo (fallback)", () => {
      const merged = mergeArvore(seedOf(mkModelo(null)), mkSalvo({ "40|M": 3 }) as never);
      expect(merged.subcolecoes[0].linhas[0].slots[0].proporcoes).toEqual({ "40|M": 3 });
    });
  });
});
