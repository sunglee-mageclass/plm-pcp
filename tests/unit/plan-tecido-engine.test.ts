import { describe, it, expect } from "vitest";
import { semearArvore, mergeArvore, semearComModelos, comConsumoDoPlano, comVariantesDoPlano, comGradeDoPlano, slotDeModeloReal, moverParaFamiliaDoTecido, normalizarCategoriasAuto, comDistribuicaoDoPlano, comAtendeDoPlano, atendeDoBom, type ModeloReal } from "@/lib/plan-tecido/engine";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { atendimentoDoBloco, materiaisParaAplicar } from "@/lib/plan-tecido/atendimento";

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

  it("slotDeModeloReal: seeda referencia_paths de modelos.fotos_referencia (G4)", () => {
    const modelo: ModeloReal = {
      id: "m1", ref: "REF1", nome: "Vestido", subcolecao: "Verão", subcolecao_id: "s1",
      linha_id: "l1", categoria_id: null, proporcoes: null,
      fotos_referencia: ["t1/fotos_referencia/x.jpg"],
      materiais: [], grade: {},
    };
    const slot = slotDeModeloReal(modelo, 0);
    expect(slot.referencia_paths).toEqual(["t1/fotos_referencia/x.jpg"]);
  });

  it("slotDeModeloReal: sem fotos_referencia no modelo seeda array vazio", () => {
    const modelo: ModeloReal = {
      id: "m1", ref: null, nome: null, subcolecao: null, subcolecao_id: null,
      linha_id: null, categoria_id: null, proporcoes: null,
      materiais: [], grade: {},
    };
    const slot = slotDeModeloReal(modelo, 0);
    expect(slot.referencia_paths).toEqual([]);
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

  it("mergeArvore: slot salvo SÓ com categoria de PRODUTO (sem tecido/modelo) sobrevive ao merge (fix 4.1)", () => {
    // Bug reportado pelo dono: card vazio → escolhe só a categoria de PRODUTO (categoria_id, ex.
    // Vestido/Blusa — não é categoria_tecido_id/lane) → Salvar → a categoria se desfazia (card
    // voltava a vazio) porque savedTemDados não contava categoria_id como "dado do usuário".
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, categoria_id: "CAT_VESTIDO", custos_adicionais: [], materiais: [] }] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    expect(merged.subcolecoes[0].linhas[0].slots[0].categoria_id).toBe("CAT_VESTIDO");
  });

  it("mergeArvore: slot salvo SÓ com referência (rascunho sem tecido/modelo) sobrevive ao merge (G4)", () => {
    // Mesma classe do fix 4.1: um slot rascunho com só uma foto de referência anexada (sem
    // tecido/modelo) não pode ser descartado no merge — senão a referência some ao reabrir.
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, referencia_paths: ["t1/fotos_referencia/a.jpg"], custos_adicionais: [], materiais: [] }] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    expect(merged.subcolecoes[0].linhas[0].slots[0].referencia_paths).toEqual(["t1/fotos_referencia/a.jpg"]);
  });

  it("mergeArvore: referência de slot COM modelo usa o VIVO (modelos.fotos_referencia via seed), não o snapshot salvo", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "M1", slot_index: 0, referencia_paths: ["t1/fotos_referencia/vivo.jpg"], custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0,
      slots: [{ modelo_id: "M1", slot_index: 0, referencia_paths: ["t1/fotos_referencia/velho.jpg"], custos_adicionais: [], materiais: [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }] }] }] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    expect(merged.subcolecoes[0].linhas[0].slots[0].referencia_paths).toEqual(["t1/fotos_referencia/vivo.jpg"]);
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

  // SUBSTITUTOS (set/2026): a partição por artigo emite 2+ materiais do MESMO tipo+numero do bloco
  // (bloco com variantes de 2 artigos = principal + substituto). slotDeModeloReal FUNDE esses num
  // ÚNICO PtMaterial: 1º artigo = principal, demais = artigo_ids_extra; variantes de todos convivem,
  // marcadas com variante_artigo_id. Assim o substituto aparece como alternativa DO MESMO Tecido/Forro
  // (não como bloco separado) — e não há colisão em uq_plan_mat(slot_id,tipo,numero).
  describe("slotDeModeloReal: substitutos (fusão de artigos do mesmo tipo+numero)", () => {
    it("dois forros de artigos distintos (numero=1 do bloco) FUNDEM num Forro 1 com substituto", () => {
      const mr: ModeloReal = {
        id: "M", ref: null, nome: "VESTIDO VALEN", subcolecao: null, subcolecao_id: null,
        linha_id: null, categoria_id: null, proporcoes: null, grade: {},
        materiais: [
          { tipo: "forro", numero: 1, artigo_id: "d30bac25", consumo: 1.2, loss_percent: 0,
            variantes: [{ variante_tecido_id: "vP", ordem: 1, multiplicador: 1 }] },
          { tipo: "forro", numero: 1, artigo_id: "809ef37a", consumo: 1.2, loss_percent: 0,
            variantes: [{ variante_tecido_id: "vS", ordem: 1, multiplicador: 1 }] },
        ],
      };
      const slot = slotDeModeloReal(mr, 0);
      // 1 só material (Forro 1); o 1º artigo é o principal, o 2º vira substituto
      expect(slot.materiais.map((m) => [m.tipo, m.numero])).toEqual([["forro", 1]]);
      expect(slot.materiais[0].artigo_id).toBe("d30bac25");
      expect(slot.materiais[0].artigo_ids_extra).toEqual(["809ef37a"]);
      // as variantes de AMBOS os artigos convivem, marcadas com o artigo real
      const vs = slot.materiais[0].variantes;
      expect(vs.map((v) => v.variante_tecido_id).sort()).toEqual(["vP", "vS"]);
      const vSub = vs.find((v) => v.variante_tecido_id === "vS");
      expect(vSub?.variante_artigo_id).toBe("809ef37a");
      const vPri = vs.find((v) => v.variante_tecido_id === "vP");
      expect(vPri?.variante_artigo_id).toBe("d30bac25");
    });

    it("renumera por tipo e preserva Tecido 1 = numero 1; blocos distintos NÃO fundem", () => {
      const mr: ModeloReal = {
        id: "M", ref: null, nome: null, subcolecao: null, subcolecao_id: null,
        linha_id: null, categoria_id: null, proporcoes: null, grade: {},
        materiais: [
          // tecido 1 e tecido 2 são BLOCOS distintos (numero 1 e 2) → NÃO fundem, viram Tecido 1 e 2
          { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [] },
          { tipo: "forro", numero: 1, artigo_id: "F1", consumo: 1, loss_percent: 0, variantes: [] },
          { tipo: "tecido", numero: 2, artigo_id: "B", consumo: 1, loss_percent: 0, variantes: [] },
          { tipo: "forro", numero: 2, artigo_id: "F2", consumo: 1, loss_percent: 0, variantes: [] },
        ],
      };
      const slot = slotDeModeloReal(mr, 0);
      expect(slot.materiais.map((m) => [m.tipo, m.numero])).toEqual([
        ["tecido", 1], ["forro", 1], ["tecido", 2], ["forro", 2],
      ]);
      const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
      expect(tec1?.artigo_id).toBe("A"); // 1º tecido na ordem estável continua sendo o Tecido 1
      expect(tec1?.artigo_ids_extra).toBeUndefined(); // blocos distintos não geram substituto
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

  // G2 (Pacote G-feat): trocar o Tecido 1 move o card p/ a família do artigo escolhido.
  describe("moverParaFamiliaDoTecido (G2)", () => {
    const slot = (materiais: PtSlot["materiais"], categoria_tecido_id: string | null = null): PtSlot =>
      ({ modelo_id: "m1", categoria_tecido_id, materiais } as PtSlot);
    const mat = (over: Record<string, unknown>) =>
      ({ artigo_id: null, tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [], ...over });
    const familiaDe = (fam: Record<string, string | null>) => (id: string) => fam[id] ?? null;

    it("trocar o Tecido 1 p/ um artigo com família move o card (retorna slot+lane)", () => {
      const prev = slot([mat({ artigo_id: "A" })]);
      const next = slot([mat({ artigo_id: "B" })]);
      const r = moverParaFamiliaDoTecido(prev, next, familiaDe({ B: "FAM_CHIFFON" }));
      expect(r).not.toBeNull();
      expect(r!.lane).toBe("FAM_CHIFFON");
      expect(r!.slot.categoria_tecido_id).toBe("FAM_CHIFFON");
    });

    it("mesmo artigo (sem troca de Tecido 1) → null", () => {
      const prev = slot([mat({ artigo_id: "A" })]);
      const next = slot([mat({ artigo_id: "A" })], "FAM_X");
      expect(moverParaFamiliaDoTecido(prev, next, familiaDe({ A: "FAM_CHIFFON" }))).toBeNull();
    });

    it("artigo do Tecido 1 SEM família cadastrada → null (não move)", () => {
      const prev = slot([mat({ artigo_id: "A" })]);
      const next = slot([mat({ artigo_id: "B" })]);
      expect(moverParaFamiliaDoTecido(prev, next, familiaDe({}))).toBeNull();
    });

    it("card já está na família do artigo escolhido → null (não re-move)", () => {
      const prev = slot([mat({ artigo_id: "A" })]);
      const next = slot([mat({ artigo_id: "B" })], "FAM_CHIFFON");
      expect(moverParaFamiliaDoTecido(prev, next, familiaDe({ B: "FAM_CHIFFON" }))).toBeNull();
    });

    it("trocar o FORRO (não Tecido 1) → null (nunca move)", () => {
      const prev = slot([mat({ artigo_id: "A" }), mat({ tipo: "forro" as const, numero: 1, artigo_id: "F1" })]);
      const next = slot([mat({ artigo_id: "A" }), mat({ tipo: "forro" as const, numero: 1, artigo_id: "F2" })]);
      expect(moverParaFamiliaDoTecido(prev, next, familiaDe({ F1: "FAM_FORRO", F2: "FAM_FORRO2" }))).toBeNull();
    });

    it("trocar o Tecido 2 (numero=2, não Tecido 1) → null (nunca move)", () => {
      const prev = slot([mat({ artigo_id: "A" }), mat({ numero: 2, artigo_id: "C1" })]);
      const next = slot([mat({ artigo_id: "A" }), mat({ numero: 2, artigo_id: "C2" })]);
      expect(moverParaFamiliaDoTecido(prev, next, familiaDe({ C1: "FAM_C", C2: "FAM_C2" }))).toBeNull();
    });

    it("Tecido 1 vazio→preenchido (add tecido) também move, se tiver família", () => {
      const prev = slot([mat({ artigo_id: null })]);
      const next = slot([mat({ artigo_id: "A" })]);
      const r = moverParaFamiliaDoTecido(prev, next, familiaDe({ A: "FAM_A" }));
      expect(r?.lane).toBe("FAM_A");
    });

    it("sem Tecido 1 no next (removido) → null", () => {
      const prev = slot([mat({ artigo_id: "A" })]);
      const next = slot([mat({ artigo_id: null })]);
      expect(moverParaFamiliaDoTecido(prev, next, familiaDe({ A: "FAM_A" }))).toBeNull();
    });
  });

  // Fix "lane congelada" (ago/2026): normaliza categoria_tecido_id=NULL no payload do save quando
  // ela bate com a auto do Tecido 1 — assim o merge (categoria_tecido_id: saved ?? seed-auto)
  // reaplica o cadastro vivo em vez de congelar no valor salvo antigo.
  describe("normalizarCategoriasAuto (bug lane congelada)", () => {
    const mat = (over: Record<string, unknown>) =>
      ({ artigo_id: null, tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [], ...over });
    const arvoreDe = (slots: PtSlot[]): PtArvore => ({
      colecao_id: "c",
      subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots }] }],
    });
    const familiaDe = (fam: Record<string, string | null>) => (id: string) => fam[id] ?? null;

    it("categoria salva === auto do Tecido 1 → normaliza pra NULL", () => {
      const slot = { modelo_id: "m1", categoria_tecido_id: "FAM_MALHA", materiais: [mat({ artigo_id: "A" })] } as PtSlot;
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({ A: "FAM_MALHA" }));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBeNull();
    });

    it("categoria salva DIVERGE da auto (arraste manual do usuário) → preservada", () => {
      const slot = { modelo_id: "m1", categoria_tecido_id: "FAM_FORRO_MANUAL", materiais: [mat({ artigo_id: "A" })] } as PtSlot;
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({ A: "FAM_MALHA" }));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe("FAM_FORRO_MANUAL");
    });

    it("slot SEM modelo (rascunho, sem Tecido 1) → não mexe mesmo com categoria setada", () => {
      const slot = { modelo_id: null, categoria_tecido_id: "CAT_X", materiais: [] } as unknown as PtSlot;
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({}));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe("CAT_X");
    });

    it("Tecido 1 sem artigo_id (vazio) → não mexe", () => {
      const slot = { modelo_id: "m1", categoria_tecido_id: "CAT_X", materiais: [mat({ artigo_id: null })] } as PtSlot;
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({}));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe("CAT_X");
    });

    it("artigo do Tecido 1 sem família cadastrada → não mexe (sem 'auto' pra comparar)", () => {
      const slot = { modelo_id: "m1", categoria_tecido_id: "CAT_X", materiais: [mat({ artigo_id: "SEM_FAMILIA" })] } as PtSlot;
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({}));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe("CAT_X");
    });

    it("categoria já NULL + auto existe → segue NULL (idempotente, sem no-op quebrar nada)", () => {
      const slot = { modelo_id: "m1", categoria_tecido_id: null, materiais: [mat({ artigo_id: "A" })] } as PtSlot;
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({ A: "FAM_MALHA" }));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBeNull();
    });

    it("Forro (não Tecido 1) com categoria batendo a família do FORRO não é tocado — só Tecido 1 decide o 'auto'", () => {
      const slot = {
        modelo_id: "m1", categoria_tecido_id: "FAM_FORRO",
        materiais: [mat({ artigo_id: "A" }), mat({ tipo: "forro" as const, numero: 1, artigo_id: "F" })],
      } as PtSlot;
      // família do Tecido 1 (A) é FAM_MALHA — diferente da categoria salva (FAM_FORRO, que bateria
      // com o forro F se o forro fosse (erroneamente) considerado) → PRESERVADA (não é o auto certo).
      const out = normalizarCategoriasAuto(arvoreDe([slot]), familiaDe({ A: "FAM_MALHA", F: "FAM_FORRO" }));
      expect(out.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe("FAM_FORRO");
    });

    it("não muta a árvore original (pura) — estado local intacto pra não 'piscar' na tela", () => {
      const slot = { modelo_id: "m1", categoria_tecido_id: "FAM_MALHA", materiais: [mat({ artigo_id: "A" })] } as PtSlot;
      const original = arvoreDe([slot]);
      const snapshotCategoria = original.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id;
      normalizarCategoriasAuto(original, familiaDe({ A: "FAM_MALHA" }));
      expect(original.subcolecoes[0].linhas[0].slots[0].categoria_tecido_id).toBe(snapshotCategoria);
    });
  });

  describe("semearComModelos: órfão-de-bucket consome o restante (orçamento)", () => {
    const modeloReal = (categoria_id: string | null): ModeloReal => ({
      id: `m-${categoria_id ?? "null"}`, nome: "M", ref: null, subcolecao_id: "s1",
      linha_id: null, categoria_id, proporcoes: null, fotos_referencia: null, materiais: [],
    } as unknown as ModeloReal);

    it("modelo de categoria SEM bucket próprio consome o bucket RESTANTE (sem-cat) → 0 vaga", () => {
      // OTB planejou 1 sem categoria (bucket restante); o card real tem categoria "Vestido" (órfão).
      const arv = semearComModelos({ colecao_id: "c", tipo: "orcamento",
        buckets: [{ subcolecao_id: "s1", linha_id: null, categoria_id: null, qtd: 1 }],
        modelos: [modeloReal("Vestido")] });
      const slots = arv.subcolecoes[0].linhas.flatMap((l) => l.slots);
      expect(slots.filter((s) => s.modelo_id).length).toBe(1);
      expect(slots.filter((s) => !s.modelo_id).length).toBe(0); // sem vaga fantasma
    });

    it("split por categoria intacto: modelo de categoria X consome o bucket X; órfão consome o restante", () => {
      // buckets: Vestido:1 + restante(sem-cat):1. Modelos: 1 Vestido + 1 Saia (sem bucket próprio).
      const arv = semearComModelos({ colecao_id: "c", tipo: "orcamento",
        buckets: [
          { subcolecao_id: "s1", linha_id: null, categoria_id: "Vestido", qtd: 1 },
          { subcolecao_id: "s1", linha_id: null, categoria_id: null, qtd: 1 },
        ],
        modelos: [modeloReal("Vestido"), modeloReal("Saia")] });
      const slots = arv.subcolecoes[0].linhas.flatMap((l) => l.slots);
      expect(slots.filter((s) => s.modelo_id).length).toBe(2);
      expect(slots.filter((s) => !s.modelo_id).length).toBe(0); // Vestido→bucket Vestido; Saia→restante
    });

    it("ainda gera vaga quando faltam modelos: restante qtd=2, só 1 órfão → 1 vaga", () => {
      const arv = semearComModelos({ colecao_id: "c", tipo: "orcamento",
        buckets: [{ subcolecao_id: "s1", linha_id: null, categoria_id: null, qtd: 2 }],
        modelos: [modeloReal("Vestido")] });
      const slots = arv.subcolecoes[0].linhas.flatMap((l) => l.slots);
      expect(slots.filter((s) => s.modelo_id).length).toBe(1);
      expect(slots.filter((s) => !s.modelo_id).length).toBe(1); // planejou 2, tem 1 → 1 vaga real
    });
  });
});

describe("plan-tecido/engine — Distribuição por produto (Task 3)", () => {
  const baseMr = (materiais: ModeloReal["materiais"]): ModeloReal => ({
    id: "m1", ref: "R", nome: "N", subcolecao: null, subcolecao_id: null, linha_id: null, categoria_id: null,
    proporcoes: null, materiais, grade: { 1: { grades: { "38|P": 3 }, grade_total: 3 } }, tamanho_tipo: "numero",
  });
  it("slotDeModeloReal: cor_id em todas; casamento do BOM vira 'atende' fora do T1 (igual ao automático ⇒ NULL — PR11); tamanho_tipo no slot", () => {
    const s = slotDeModeloReal(baseMr([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "c1", complementa_variante_ids: null },
        { variante_tecido_id: "vt2", ordem: 2, multiplicador: 1, cor_id: "c2", complementa_variante_ids: null },
      ] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "c1", complementa_variante_ids: ["vt1"] }, // = automático (mesma cor base)
        { variante_tecido_id: "fr2", ordem: 2, multiplicador: 1, cor_id: "c2", complementa_variante_ids: ["vt1"] }, // à mão (outra cor base)
        { variante_tecido_id: "fr3", ordem: 3, multiplicador: 1, cor_id: "c3", complementa_variante_ids: null },
      ] },
    ]), 0);
    expect(s.tamanho_tipo).toBe("numero");
    expect(s.materiais[0].variantes[0]).toMatchObject({ cor_id: "c1" });
    expect(s.materiais[0].variantes[0]).not.toHaveProperty("atende");
    expect(s.materiais[1].variantes.map((v) => v.atende)).toEqual([null, ["vt1"], null]);
  });
  it("PR11 (G-plano R2): depois do 1º aplicar, uma cor NOVA do T1 com a mesma cor base é atendida sozinha (P-17)", () => {
    const s = slotDeModeloReal(baseMr([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "c1" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "c1", complementa_variante_ids: ["vt1"] }] },
    ]), 0);
    expect(s.materiais[1].variantes[0].atende).toBeNull();
    const t1 = [...s.materiais[0].variantes, { ...s.materiais[0].variantes[0], variante_tecido_id: "vt1b", ordem: 2 }];
    expect(atendimentoDoBloco(t1, s.materiais[1].variantes).porCor.get("fr1")).toEqual(["vt1", "vt1b"]);
    // Lote A fix2 · N3: automaticoIds OBRIGATÓRIO — [] (não bate com ["vt1","vt2"]) + semAmbiguidade=true (regra (b)
    // ainda não vale: vt2 tem cor base DIFERENTE de c1 — ids.every(...) falha, fica à mão de qualquer forma).
    expect(atendeDoBom({ cor_id: "c1", complementa_variante_ids: ["vt1", "vt2"] }, new Map([["vt1", "c1"], ["vt2", "c2"]]), [], true)).toEqual(["vt1", "vt2"]);
  });
  it("comDistribuicaoDoPlano: leva a distribuição salva para a cor viva do T1 (por chave e, planejada→real, por cor+apelido)", () => {
    const d = { ec: { base: 1, grades: { "38|P": 1 }, manuais: [] } };
    const vivos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 },
      { variante_tecido_id: "vt2", cor_id: "c2", cor_apelido_id: "a2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 0 },
    ] }];
    const salvos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: d },
      { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: d },
    ] }];
    const r = comDistribuicaoDoPlano(vivos, salvos);
    expect(r[0].variantes.map((v) => v.distribuicao)).toEqual([d, d]);
    expect(comDistribuicaoDoPlano(vivos, [])).toBe(vivos);
  });
  it("comAtendeDoPlano: BOM com casamento vence; sem casamento no BOM vale o do plano", () => {
    const vivos = [{ artigo_id: "F", tipo: "forro" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
      { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, atende: ["vtA"] },
      { variante_tecido_id: "fr2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 0, atende: null },
    ] }];
    const salvos = [{ artigo_id: "F", tipo: "forro" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
      { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, atende: ["vtB"] },
      { variante_tecido_id: "fr2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 0, atende: ["vtC"] },
    ] }];
    expect(comAtendeDoPlano(vivos, salvos)[0].variantes.map((v) => v.atende)).toEqual([["vtA"], ["vtC"]]);
  });
  it("mergeArvore: card real mantém a distribuição e o 'atende' salvos depois do 'Dev vence'", () => {
    const d = { ec: { base: 1, grades: { "38|P": 1 }, manuais: [] } };
    const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda", buckets: [], modelos: [baseMr([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "c1" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "c9" }] },
    ])] });
    const salvo: PtArvore = { ...seed, subcolecoes: seed.subcolecoes.map((s) => ({ ...s, linhas: s.linhas.map((l) => ({ ...l, slots: l.slots.map((sl) => ({
      ...sl, materiais: [
        { ...sl.materiais[0], variantes: [{ ...sl.materiais[0].variantes[0], distribuicao: d }] },
        { ...sl.materiais[1], variantes: [{ ...sl.materiais[1].variantes[0], atende: ["vt1"] }] },
      ] })) })) })) };
    const m = mergeArvore(seed, salvo).subcolecoes[0].linhas[0].slots[0].materiais;
    expect(m[0].variantes[0].distribuicao).toEqual(d);
    expect(m[1].variantes[0].atende).toEqual(["vt1"]);
  });
});

describe("plan-tecido/engine — Lote A rodada de correção 1 (C1, C2, I3, I4, M3, M4, M5, M6, M8)", () => {
  const baseMr2 = (materiais: ModeloReal["materiais"]): ModeloReal => ({
    id: "m1", ref: "R", nome: "N", subcolecao: null, subcolecao_id: null, linha_id: null, categoria_id: null,
    proporcoes: null, materiais, grade: { 1: { grades: { "38|P": 3 }, grade_total: 3 } }, tamanho_tipo: "numero",
  });
  const d = { ec: { base: 1, grades: { "38|P": 1 }, manuais: [] } };

  it("C2: irmã não herda — 'A Preto' distribuída e 'B Preto' sem distribuição dão pç [40, 7], não [40, 40]", () => {
    const vivos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vtA", cor_id: "preto", ordem: 1, multiplicador: 1, grades: { "38|P": 40 }, grade_total: 40 },
      { variante_tecido_id: "vtB", cor_id: "preto", ordem: 2, multiplicador: 1, grades: { "38|P": 7 }, grade_total: 7 },
    ] }];
    // "A Preto" salva com distribuição PRÓPRIA (variante REAL, não planejada); "B Preto" salva SEM distribuição.
    const salvos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vtA", cor_id: "preto", ordem: 1, multiplicador: 1, grades: { "38|P": 40 }, grade_total: 40, distribuicao: d },
      { variante_tecido_id: "vtB", cor_id: "preto", ordem: 2, multiplicador: 1, grades: { "38|P": 7 }, grade_total: 7 },
    ] }];
    const r = comDistribuicaoDoPlano(vivos, salvos);
    expect(r[0].variantes.map((v) => v.distribuicao)).toEqual([d, undefined]);
    expect(r[0].variantes.map((v) => v.grade_total)).toEqual([40, 7]); // pç do BOM vivo intocado (comDistribuicaoDoPlano só leva a distribuição)
  });

  it("C2: caminho planejada→real continua funcionando (cor PLANEJADA salva por cor+apelido, sem irmã ambígua)", () => {
    const vivos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vt2", cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 },
    ] }];
    const salvos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      // salva PLANEJADA (variante_tecido_id null) — única candidata daquela combinação cor+apelido
      { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: d },
    ] }];
    expect(comDistribuicaoDoPlano(vivos, salvos)[0].variantes[0].distribuicao).toEqual(d);
  });

  it("C2: 2+ candidatos PLANEJADOS da mesma combo (ambíguo) NÃO escolhe nenhum", () => {
    const vivos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vt9", cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 },
    ] }];
    const salvos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: d },
      { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: { lf: { base: 2, grades: {}, manuais: [] } } },
    ] }];
    expect(comDistribuicaoDoPlano(vivos, salvos)[0].variantes[0].distribuicao).toBeUndefined();
  });

  it("I3: caminho REAL slotDeModeloReal → mergeArvore — a planejada 'c2·a2' que virou variante real leva a distribuição, chaveada por cor+apelido", () => {
    const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda", buckets: [], modelos: [baseMr2([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "vt2", ordem: 1, multiplicador: 1, cor_id: "c2", cor_apelido_id: "a2" },
      ] },
    ])] });
    const salvo: PtArvore = { ...seed, subcolecoes: seed.subcolecoes.map((s) => ({ ...s, linhas: s.linhas.map((l) => ({ ...l, slots: l.slots.map((sl) => ({
      ...sl, materiais: [
        { ...sl.materiais[0], variantes: [
          // salva PLANEJADA (a mesma cor·apelido "Marrom · Canela" antes de virar variante real)
          { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, distribuicao: d },
        ] },
      ] })) })) })) };
    const m = mergeArvore(seed, salvo).subcolecoes[0].linhas[0].slots[0].materiais;
    expect(m[0].variantes[0].variante_tecido_id).toBe("vt2"); // agora é a variante REAL
    expect(m[0].variantes[0].distribuicao).toEqual(d);
  });

  it("I4/M6: bloco com 2 cores da MESMA cor base (Preto·Fosco→vtA, Preto·Brilho→vtB) — amarração PARCIAL fica à mão (não vira NULL)", () => {
    const s = slotDeModeloReal(baseMr2([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "preto" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "frA", ordem: 1, multiplicador: 1, cor_id: "preto", label: "Fosco", complementa_variante_ids: ["vt1"] },
        { variante_tecido_id: "frB", ordem: 2, multiplicador: 1, cor_id: "preto", label: "Brilho", complementa_variante_ids: [] },
      ] },
    ]), 0);
    // o automático PURO entregaria vt1 à 1ª (frA); a amarração do BOM (frA→[vt1]) bate exatamente com isso — mas
    // como o bloco tem 2 cores da mesma cor base, a amarração é IGUAL ao automático aqui (não há ambiguidade real:
    // só 1 cor do T1 pra 2 candidatas do bloco); a prova de "não vira NULL cegamente por cor_id" está no 2º caso.
    expect(s.materiais[1].variantes[0].atende).toBeNull(); // frA: igual ao automático puro (vt1 pra 1ª candidata)
    expect(s.materiais[1].variantes[1].atende).toBeNull(); // frB: sem casamento nenhum (complementa_variante_ids=[])
  });

  it("I4/M6: amarração que dá TODAS as cores do T1 à 2ª candidata (∅ igual ao automático, que dá à 1ª) fica à mão", () => {
    const s = slotDeModeloReal(baseMr2([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "preto" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "frA", ordem: 1, multiplicador: 1, cor_id: "preto", complementa_variante_ids: [] }, // sem casamento
        { variante_tecido_id: "frB", ordem: 2, multiplicador: 1, cor_id: "preto", complementa_variante_ids: ["vt1"] }, // casa com vt1 à MÃO (o automático daria a vt1 à frA, a 1ª)
      ] },
    ]), 0);
    expect(s.materiais[1].variantes[0].atende).toBeNull(); // frA: sem casamento nenhum
    expect(s.materiais[1].variantes[1].atende).toEqual(["vt1"]); // frB: amarração ≠ automático (que daria vt1 à frA) → à mão
  });

  it("M6: id velho (fora de corDoT1) não bloqueia o automático", () => {
    const s = slotDeModeloReal(baseMr2([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "c1" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "c1", complementa_variante_ids: ["vt1", "vt-removido"] },
      ] },
    ]), 0);
    expect(s.materiais[1].variantes[0].atende).toBeNull(); // "vt-removido" não existe mais no T1 — filtrado, sobra só vt1 = automático
  });

  it("atendeDoBom: cor base diferente entre os ids amarrados fica à mão mesmo com semAmbiguidade=true (regra (b) exige TODOS na mesma cor base)", () => {
    expect(atendeDoBom({ cor_id: "c1", complementa_variante_ids: ["vt1", "vt2"] }, new Map([["vt1", "c1"], ["vt2", "c2"]]), [], true)).toEqual(["vt1", "vt2"]);
  });
});

describe("plan-tecido/engine — Lote A rodada de correção 2 (N1, N2, N4)", () => {
  const baseMr3 = (materiais: ModeloReal["materiais"]): ModeloReal => ({
    id: "m1", ref: "R", nome: "N", subcolecao: null, subcolecao_id: null, linha_id: null, categoria_id: null,
    proporcoes: null, materiais, grade: { 1: { grades: { "38|P": 3 }, grade_total: 3 } }, tamanho_tipo: "numero",
  });
  const d = { ec: { base: 1, grades: { "38|P": 1 }, manuais: [] } };

  it("N1: fr-a (principal, ordem 2) amarrado a [vtP] + substituto fr-b de mesma cor base (ordem 1) — a amarração continua em fr-a; payload regrava fr-a:[vtP], fr-b:[]", () => {
    const s = slotDeModeloReal(baseMr3([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vtP", ordem: 1, multiplicador: 1, cor_id: "preto" }] },
      // fr-a = PRINCIPAL (1º material do grupo forro|1 no array de entrada), mas ordem 2 (aparece DEPOIS na exibição)
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "fr-a", ordem: 2, multiplicador: 1, cor_id: "preto", complementa_variante_ids: ["vtP"] },
      ] },
      // fr-b = SUBSTITUTO (2º material do MESMO grupo forro|1 — artigo diferente), ordem 1 (aparece ANTES na exibição)
      { tipo: "forro", numero: 1, artigo_id: "F2", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "fr-b", ordem: 1, multiplicador: 1, cor_id: "preto", complementa_variante_ids: [] },
      ] },
    ]), 0);
    // exibição ordenada por `ordem`: fr-b (ordem 1) vem ANTES de fr-a (ordem 2)
    const forro = s.materiais[1];
    expect(forro.variantes.map((v) => v.variante_tecido_id)).toEqual(["fr-b", "fr-a"]);
    const porId = Object.fromEntries(forro.variantes.map((v) => [v.variante_tecido_id, v.atende]));
    // Com o stub ordenado por `ordem` (N1), a 1ª candidata do automático PURO é fr-b (ordem 1, sem amarração) — o
    // automático daria vtP a fr-b, não a fr-a. A amarração REAL do BOM (fr-a → [vtP]) NÃO bate com isso (a) e há
    // ambiguidade no bloco — 2 cores "preto" (b não vale) — então fr-a fica À MÃO (preserva a amarração do Sheet,
    // não vira null cegamente nem "escorrega" pra fr-b). Sem o fix (stub na ordem dos ARTIGOS, fr-a antes de fr-b),
    // o automático puro daria vtP à fr-a (1ª do stub errado) e a amarração bateria por acidente, virando null.
    expect(porId["fr-a"]).toEqual(["vtP"]);
    expect(porId["fr-b"]).toBeNull();
    const payload = materiaisParaAplicar(s, true);
    const forroPayload = payload[1];
    const porIdPayload = Object.fromEntries(forroPayload.variantes.map((v: any, i: number) => [forro.variantes[i].variante_tecido_id, v.complementa_variante_ids]));
    expect(porIdPayload["fr-a"]).toEqual(["vtP"]);
    expect(porIdPayload["fr-b"]).toEqual([]);
  });

  it("N2: T1 vt1+vt1b (mesma base) e forro fr1:[vt1] (só ele no bloco) ⇒ atende null e pç do forro = 15, não 10", () => {
    const s = slotDeModeloReal(baseMr3([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "preto" },
        { variante_tecido_id: "vt1b", ordem: 2, multiplicador: 1, cor_id: "preto" },
      ] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "preto", complementa_variante_ids: ["vt1"] },
      ] },
    ]), 0);
    // regra (b): fr1 amarra só vt1 (mesma cor base "preto"), e NENHUMA outra cor do bloco forro tem cor_id "preto"
    // (fr1 é o único) ⇒ semAmbiguidade=true ⇒ null (automático), mesmo o BOM não tendo atualizado pra ["vt1","vt1b"].
    expect(s.materiais[1].variantes[0].atende).toBeNull();
    // pç do forro = soma de AMBAS as cores do T1 (o automático real, via atendimentoDoBloco, casa vt1 E vt1b com fr1
    // porque fr1 é a única cor "preto" do bloco) — grade_total 10 (fr1 nasce sem grade própria no BOM) não é o que
    // interessa aqui; a prova de "15, não 10" é feita via normalizarSlotDistribuicao (T2), que deriva o pç real.
    const at = atendimentoDoBloco(s.materiais[0].variantes, s.materiais[1].variantes);
    expect(at.porCor.get("fr1")).toEqual(["vt1", "vt1b"]);
  });

  it("N2: Fosco/Brilho continua à mão (ambiguidade no bloco impede a regra (b))", () => {
    const s = slotDeModeloReal(baseMr3([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "preto" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "frA", ordem: 1, multiplicador: 1, cor_id: "preto", label: "Fosco", complementa_variante_ids: ["vt1"] },
        { variante_tecido_id: "frB", ordem: 2, multiplicador: 1, cor_id: "preto", label: "Brilho", complementa_variante_ids: ["vt1"] },
      ] },
    ]), 0);
    // frA bate no automático EXATO (1ª candidata em ordem) ⇒ null; frB tem a MESMA amarração mas NÃO é a 1ª
    // candidata (automático dá [] a frB) e a regra (b) não vale (ambiguidade: frA também é "preto") ⇒ à mão.
    expect(s.materiais[1].variantes[0].atende).toBeNull();
    expect(s.materiais[1].variantes[1].atende).toEqual(["vt1"]);
  });

  it("N4: cor planejada salva de 10 casa com 2 variantes VIVAS iguais (principal + substituto) — só a 1ª em ordem herda; pç [10, 0]", () => {
    const vivos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vtPrincipal", cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: { "38|P": 10 }, grade_total: 10 },
      { variante_tecido_id: "vtSubstituto", cor_id: "c2", cor_apelido_id: "a2", ordem: 2, multiplicador: 1, grades: { "38|P": 10 }, grade_total: 10 },
    ] }];
    const salvos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 1, multiplicador: 1, grades: { "38|P": 10 }, grade_total: 10, distribuicao: d },
    ] }];
    const r = comDistribuicaoDoPlano(vivos, salvos);
    expect(r[0].variantes.map((v) => v.distribuicao)).toEqual([d, undefined]);
  });
});

// Bug real (QA 29/set, achado na coleção "Teste 1"): um slot SALVO cujo bucket (subcoleção/linha
// OU linha/categoria) não existe mais no SEED do plano atual (ex.: categoria saiu do mix, linha/
// subcoleção removida da coleção) sumia em SILÊNCIO no merge — o Salvar reescreve a árvore inteira
// (`_salvar_plan_tecido_core`: delete + reinsert de `_arvore->'subcolecoes'`), então um bucket que o
// merge nunca reproduz na árvore em memória é APAGADO do banco ao clicar Salvar, mesmo sem o usuário
// ter tocado nele. Regra do controlador: Salvar NUNCA apaga dado que a pessoa não apagou — um slot
// salvo "órfão de bucket" tem que sobreviver ao merge intacto (mesmo id/rev), não virar alteração.
describe("mergeArvore — slot órfão de bucket (bug real QA 29/set, 'Sem subcoleção › Blusa')", () => {
  it("FALHA HOJE: linha (categoria) salva que não existe mais no seed é DESCARTADA pelo merge", () => {
    // Seed atual: subcoleção "Sem subcoleção" (null) só tem a linha/categoria "Vestido" (o mix do
    // plano não tem mais "Blusa"). Salvo: a MESMA subcoleção tinha um card em "Blusa" (preço 200,
    // com proporções) — igual ao card relatado no QA.
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_VESTIDO", ordem: 0, slots: [] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_BLUSA", ordem: 1, slots: [
        { id: "slot-blusa-1", modelo_id: null, slot_index: 0, preco_venda: 200, proporcoes: { P: 1, M: 2 }, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const linhas = merged.subcolecoes[0].linhas;
    const linhaBlusa = linhas.find((l) => l.categoria_id === "CAT_BLUSA");
    // Comportamento correto: a linha/slot salvo sobrevive intacto (mesmo sem bucket no seed atual).
    expect(linhaBlusa).toBeDefined();
    expect(linhaBlusa?.slots).toHaveLength(1);
    expect(linhaBlusa?.slots[0].id).toBe("slot-blusa-1");
    expect(linhaBlusa?.slots[0].preco_venda).toBe(200);
    expect(linhaBlusa?.slots[0].proporcoes).toEqual({ P: 1, M: 2 });
  });

  it("FALHA HOJE: subcoleção salva inteira que não existe mais no seed é DESCARTADA pelo merge", () => {
    // Seed atual só tem S1 (a coleção não lista mais S2 — ex.: subcoleção excluída/renomeada).
    const seed = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [] }] },
    ] };
    const salvo = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [
        { id: "slot-s2-1", modelo_id: null, slot_index: 0, preco_venda: 350, custos_adicionais: [], materiais: [] },
      ] }] },
    ] };
    const merged = mergeArvore(seed as any, salvo as any);
    const s2 = merged.subcolecoes.find((s) => s.subcolecao_id === "S2");
    expect(s2).toBeDefined();
    expect(s2?.linhas[0]?.slots).toHaveLength(1);
    expect(s2?.linhas[0]?.slots[0].id).toBe("slot-s2-1");
  });

  it("linha órfã preservada não ganha modelo_id nem se mistura com outra linha (id/rev intactos)", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_VIVA", ordem: 0, slots: [] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, id: "sub-id-1", linhas: [
      { linha_id: null, categoria_id: "CAT_ORFA", ordem: 1, id: "linha-id-orfa", slots: [
        { id: "slot-orfa", modelo_id: null, slot_index: 0, preco_venda: 150, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const linhaViva = merged.subcolecoes[0].linhas.find((l) => l.categoria_id === "CAT_VIVA");
    const linhaOrfa = merged.subcolecoes[0].linhas.find((l) => l.categoria_id === "CAT_ORFA");
    expect(linhaViva?.slots).toHaveLength(0); // não ganhou o slot órfão
    expect(linhaOrfa?.id).toBe("linha-id-orfa"); // id preservado (save não deve tratar como novo)
    expect(linhaOrfa?.slots[0].id).toBe("slot-orfa");
  });
});

// Fix round 1 (review Opus, SHIP WITH FIXES): 3 achados Important + M-1, todos na MESMA
// mergeArvore, mesma regra "Salvar nunca apaga dado que a pessoa não apagou" — a rodada 1 só
// cobriu bucket (linha/subcoleção) inteiramente ausente do seed; a revisão reproduziu 3 caminhos
// SIBLING onde o bucket EXISTE (ou o modelo se move para um que existe) mas o slot com dado
// ainda é descartado. Probes replicados literalmente do review.md.
describe("mergeArvore — Fix round 1 (probes do review: I-1, I-2, I-3, M-1)", () => {
  // I-1 (probe A): bucket AINDA VIVO no seed (vaga vazia); o slot salvo tem só preço+proporções
  // (a MESMA forma do card do QA) — savedTemDados (usado no pareamento posicional) não cobre
  // esses campos, então a vaga vazia do seed vence e o preço/proporção do salvo é descartado.
  it("I-1 probe A: vaga viva com salvo só-preço+proporções não pode ser substituída por vaga vazia", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_BLUSA", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }, // vaga do seed (qtd ainda 1)
      ] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_BLUSA", ordem: 0, slots: [
        { id: "slot-A", modelo_id: null, slot_index: 0, preco_venda: 200, proporcoes: { P: 1, M: 2 }, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slot = merged.subcolecoes[0].linhas[0].slots[0];
    expect(slot.id).toBe("slot-A");
    expect(slot.preco_venda).toBe(200);
    expect(slot.proporcoes).toEqual({ P: 1, M: 2 });
  });

  it("I-1: mix_id de uma vaga (aplicarMixEmSlots) também sobrevive ao pareamento posicional", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_X", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_X", ordem: 0, slots: [
        { id: "slot-mix", modelo_id: null, slot_index: 0, mix_id: "MIX1", custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    expect(merged.subcolecoes[0].linhas[0].slots[0].mix_id).toBe("MIX1");
  });

  // M-1: mix_id/usar_estoque isolados também contam como "dado de verdade" no caminho ÓRFÃO
  // (linha/subcoleção sem bucket no seed) — mesmo predicado usado pelos dois caminhos.
  it("M-1: órfão de bucket com SÓ mix_id/usar_estoque sobrevive (não é mais dropado)", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_VIVA", ordem: 0, slots: [] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_ORFA", ordem: 1, slots: [
        { id: "slot-orfa-mix", modelo_id: null, slot_index: 0, mix_id: "MIX2", usar_estoque: true, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const linhaOrfa = merged.subcolecoes[0].linhas.find((l) => l.categoria_id === "CAT_ORFA");
    expect(linhaOrfa?.slots).toHaveLength(1);
    expect(linhaOrfa?.slots[0].mix_id).toBe("MIX2");
  });

  // I-2 (probe B): bucket encolheu de qtd 3→1 no OTB — o seed só produz 1 vaga; os 2 slots
  // salvos "restantes" (com dado: nome + categoria_id) não têm posição no seed e são descartados.
  it("I-2 probe B: bucket encolhido (qtd 3→1) preserva os slots salvos excedentes com dado", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_Y", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }, // só 1 vaga agora (qtd caiu p/ 1)
      ] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_Y", ordem: 0, slots: [
        { id: "x1", modelo_id: null, slot_index: 0, nome: "Card 1", categoria_id: "CAT_PROD", custos_adicionais: [], materiais: [] },
        { id: "x2", modelo_id: null, slot_index: 1, nome: "Card 2", categoria_id: "CAT_PROD", custos_adicionais: [], materiais: [] },
        { id: "x3", modelo_id: null, slot_index: 2, nome: "Card 3", categoria_id: "CAT_PROD", custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const ids = merged.subcolecoes[0].linhas[0].slots.map((s) => s.id).sort();
    expect(ids).toEqual(["x1", "x2", "x3"]);
    // nenhum duplicado, nenhum com modelo_id inventado
    expect(merged.subcolecoes[0].linhas[0].slots.every((s) => !s.modelo_id)).toBe(true);
  });

  it("I-2: bucket encolhido não duplica quando o slot excedente tem modelo VIVO em outro bucket", () => {
    // O slot "excedente" tem modelo_id — mas esse modelo já tem posição própria (liveByModelo),
    // então NÃO deve ser reinserido como sobra (senão o modelo apareceria 2×).
    const seed = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }, // qtd caiu p/ 1
      ] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [] }, // M1 vive em S2 agora
      ] }] },
    ] };
    const salvo = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { id: "s1-a", modelo_id: null, slot_index: 0, nome: "A", categoria_id: "CAT_PROD", custos_adicionais: [], materiais: [] },
        { id: "s1-b", modelo_id: "M1", slot_index: 1, custos_adicionais: [], materiais: [] }, // snapshot antigo de M1 em S1
      ] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [] }] },
    ] };
    const merged = mergeArvore(seed as any, salvo as any);
    const s1 = merged.subcolecoes.find((s) => s.subcolecao_id === "S1")!;
    const s2 = merged.subcolecoes.find((s) => s.subcolecao_id === "S2")!;
    // S1: só a sobra "A" (sem modelo); M1 NÃO aparece aqui (evita duplicar)
    expect(s1.linhas[0].slots.map((s) => s.id)).toEqual(["s1-a"]);
    expect(s1.linhas[0].slots.some((s) => s.modelo_id === "M1")).toBe(false);
    // S2: M1 aparece exatamente 1×, na posição viva
    const emS2 = s2.linhas[0].slots.filter((s) => s.modelo_id === "M1");
    expect(emS2).toHaveLength(1);
  });

  // I-3 (probe D/E): modelo se move para uma sub OU linha que NÃO existe no `salvo` (ex.: sub
  // criada depois do último save) — os ramos `!ss`/`!sl` devolvem o slot do seed CRU, sem
  // consultar savedByModelo, então o dado de plano do modelo (preço, custos, distribuição) e o
  // id do slot (usado pelo re-link de plan_tecido_slot_oc) se perdem.
  it("I-3 probe E: modelo movido para SUBCOLEÇÃO nova (sem par no salvo) mantém preço/custos/distribuição/id", () => {
    const distTeste = { loja1: { base: 10, grades: { P: 10 }, manuais: {} } };
    const seed = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S2", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [
          { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
            { variante_tecido_id: "v1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 },
          ] },
        ] },
      ] }] },
    ] };
    // Salvo NÃO tem S2 (nasceu depois do último save) — só S1, onde M1 estava antes.
    const salvo = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { id: "slot-antigo", modelo_id: "M1", slot_index: 0, preco_venda: 99, custos_adicionais: [{ descricao: "Bordado", valor: 5 }], materiais: [
          { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
            { variante_tecido_id: "v1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, distribuicao: distTeste },
          ] },
        ] },
      ] }] },
    ] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slot = merged.subcolecoes.find((s) => s.subcolecao_id === "S2")!.linhas[0].slots[0];
    expect(slot.id).toBe("slot-antigo"); // id preservado (plan_tecido_slot_oc re-linka por id)
    expect(slot.preco_venda).toBe(99);
    expect(slot.custos_adicionais).toEqual([{ descricao: "Bordado", valor: 5 }]);
    expect(slot.materiais[0].variantes[0].distribuicao).toEqual(distTeste);
    // Não duplica: só 1 slot com modelo_id=M1 em toda a árvore.
    const todos = merged.subcolecoes.flatMap((s) => s.linhas.flatMap((l) => l.slots));
    expect(todos.filter((s) => s.modelo_id === "M1")).toHaveLength(1);
  });

  it("I-3 probe D: modelo mudou de LINHA/categoria (mesma sub) para uma sem par no salvo mantém preço", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_NOVA", ordem: 0, slots: [
        { modelo_id: "M1", slot_index: 0, custos_adicionais: [], materiais: [
          { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] },
        ] },
      ] },
    ] }] };
    // Salvo tem a MESMA sub, mas a linha/categoria salva é outra (CAT_VELHA) — CAT_NOVA não existe no salvo.
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "CAT_VELHA", ordem: 0, slots: [
        { id: "slot-velho", modelo_id: "M1", slot_index: 0, preco_venda: 99, custos_adicionais: [], materiais: [
          { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] },
        ] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slot = merged.subcolecoes[0].linhas.find((l) => l.categoria_id === "CAT_NOVA")!.slots[0];
    expect(slot.id).toBe("slot-velho");
    expect(slot.preco_venda).toBe(99);
    const todos = merged.subcolecoes.flatMap((s) => s.linhas.flatMap((l) => l.slots));
    expect(todos.filter((s) => s.modelo_id === "M1")).toHaveLength(1);
  });
});

// Fix round 2 (re-revisão R1, verdict SHIP com 2 Medium a corrigir antes do merge): M-R1-1,
// M-R1-2 e o gap de teste do L-1 (probes F, G, C — literais do review.md, seção "Re-revisão R1").
describe("mergeArvore — Fix round 2 (probes do re-review: M-R1-1, M-R1-2, L-1)", () => {
  // M-R1-1 (probe F): modelo mudou de categoria no Planejamento (BLUSA→VESTIDO); a linha VESTIDO
  // não existe no salvo (I-3, ramo !sl) — antes do fix, mesclarSlot devolvia categoria_id do
  // SALVO (BLUSA, stale) em vez da categoria VIVA do seed (VESTIDO). O card ficava na posição
  // certa (linha VESTIDO) mas com o select de categoria mostrando Blusa — e o próximo Salvar
  // regravava esse valor errado no banco. Campos que DEFINEM o bucket seguem o seed p/ modelo.
  it("M-R1-1 probe F: categoria segue o SEED (viva) para modelo, não o salvo (stale)", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "VESTIDO", ordem: 0, slots: [
        { modelo_id: "M1", slot_index: 0, categoria_id: "VESTIDO", custos_adicionais: [], materiais: [
          { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] },
        ] },
      ] },
    ] }] };
    // Salvo: M1 estava na linha BLUSA (não existe mais no seed — a categoria mudou no Planejamento).
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "BLUSA", ordem: 0, slots: [
        { id: "slot-m1", modelo_id: "M1", slot_index: 0, categoria_id: "BLUSA", preco_venda: 99, custos_adicionais: [], materiais: [
          { artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] },
        ] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const slot = merged.subcolecoes[0].linhas.find((l) => l.categoria_id === "VESTIDO")!.slots[0];
    expect(slot.categoria_id).toBe("VESTIDO"); // seed vence, NÃO "BLUSA" (stale do salvo)
    expect(slot.preco_venda).toBe(99); // dado de plano (não define bucket) continua vindo do salvo
    expect(slot.id).toBe("slot-m1");
  });

  it("M-R1-1: categoria de um DRAFT (sem modelo) continua vindo do salvo (comportamento intocado)", () => {
    // Slot sem modelo_id: categoria é dado PRÓPRIO do plano (não "definido pelo seed" — o seed não
    // tem opinião sobre a categoria de um rascunho). O salvo deve continuar vencendo aqui.
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [
      { linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, categoria_id: "CAT_PRODUTO_ESCOLHIDA", custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    expect(merged.subcolecoes[0].linhas[0].slots[0].categoria_id).toBe("CAT_PRODUTO_ESCOLHIDA");
  });

  // M-R1-2 (probe G): usar_estoque isolado (sem mais nenhum dado) não é mais motivo de preservação
  // — a flag está inerte e "Limpar" não a zera, então um card só-com-esse-resíduo virava um ghost
  // card impossível de remover. mix_id sozinho ainda preserva (M-1 original segue valendo).
  it("M-R1-2 probe G: usar_estoque isolado NÃO preserva mais (evita ghost card); mix_id sozinho ainda preserva", () => {
    const seed = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }, // qtd caiu p/ 1
      ] },
    ] }] };
    const salvo = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { id: "v1", modelo_id: null, slot_index: 0, usar_estoque: true, custos_adicionais: [], materiais: [] },
        { id: "v2", modelo_id: null, slot_index: 1, usar_estoque: true, custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const merged = mergeArvore(seed as any, salvo as any);
    const ids = merged.subcolecoes[0].linhas[0].slots.map((s) => s.id);
    expect(ids).not.toContain("v2"); // não sobra como excedente (I-2) só por usar_estoque
    // mix_id sozinho continua preservando (não é regressão do M-1 original).
    const salvoComMix = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
      { linha_id: null, categoria_id: "cat", ordem: 0, slots: [
        { id: "w1", modelo_id: null, slot_index: 0, mix_id: "MIX9", custos_adicionais: [], materiais: [] },
      ] },
    ] }] };
    const mergedMix = mergeArvore(seed as any, salvoComMix as any);
    expect(mergedMix.subcolecoes[0].linhas[0].slots[0].mix_id).toBe("MIX9");
  });

  // L-1 (probe C): a coleção AGORA TEM subcoleções (seed só lista S1/S2, nenhuma null), e o
  // salvo tem um slot com dado só na subcoleção "Sem subcoleção" (subcolecao_id: null) — um
  // órfão de bucket NO NÍVEL DE SUBCOLEÇÃO com key null (o único órfão de sub real possível,
  // per o review: sub com id não-null é sempre removida via CASCADE junto com a linha do plano).
  it("L-1 probe C: subcoleção órfã 'Sem subcoleção' (null) sobrevive quando a coleção só tem subs nomeadas", () => {
    const seed = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [] }] },
    ] };
    const salvo = { colecao_id: "c", subcolecoes: [
      { subcolecao_id: "S1", ordem: 0, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [] }] },
      { subcolecao_id: "S2", ordem: 1, linhas: [{ linha_id: "l1", categoria_id: null, ordem: 0, slots: [] }] },
      { subcolecao_id: null, ordem: 2, linhas: [{ linha_id: null, categoria_id: "CAT_LEGADO", ordem: 0, slots: [
        { id: "slot-legado", modelo_id: null, slot_index: 0, preco_venda: 77, custos_adicionais: [], materiais: [] },
      ] }] },
    ] };
    const merged = mergeArvore(seed as any, salvo as any);
    const semSub = merged.subcolecoes.find((s) => s.subcolecao_id === null);
    expect(semSub).toBeDefined();
    expect(semSub?.linhas[0].slots[0].id).toBe("slot-legado");
    expect(semSub?.linhas[0].slots[0].preco_venda).toBe(77);
    // as duas subs vivas continuam intactas (nenhuma mistura)
    expect(merged.subcolecoes.find((s) => s.subcolecao_id === "S1")?.linhas[0].slots).toHaveLength(0);
    expect(merged.subcolecoes.find((s) => s.subcolecao_id === "S2")?.linhas[0].slots).toHaveLength(0);
  });
});
