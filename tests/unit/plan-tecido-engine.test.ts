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
});
