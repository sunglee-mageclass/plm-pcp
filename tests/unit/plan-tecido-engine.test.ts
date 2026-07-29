import { describe, it, expect } from "vitest";
import { semearArvore, mergeArvore, semearComModelos, type ModeloReal } from "@/lib/plan-tecido/engine";

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
    const slotM1 = merged.subcolecoes[0].linhas[0].slots[1];
    expect(slotM1.modelo_id).toBe("M1");
    // Antes do fix: RENDA (snapshot salvo, pela posição). Depois: ANGELIM (BOM vivo por id).
    expect(slotM1.materiais[0].artigo_id).toBe("ANGELIM");
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
});
