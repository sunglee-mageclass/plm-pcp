import { describe, it, expect } from "vitest";
import { saldoCelula, gradeRealCelula, somaCampo, CELULA_ZERO, recebidaExcedeCortada, celulasRecebidaAcimaCortada, completarGradeFonte } from "@/lib/grade-cortada";

describe("grade-cortada helpers", () => {
  it("saldoCelula = cortada − recebida (pode ser negativo)", () => {
    expect(saldoCelula({ enviada: 0, cortada: 10, recebida: 4, defeito: 0 })).toBe(6);
    expect(saldoCelula({ enviada: 0, cortada: 3, recebida: 5, defeito: 0 })).toBe(-2);
  });
  it("gradeRealCelula = max(0, recebida − defeito)", () => {
    expect(gradeRealCelula({ enviada: 0, cortada: 0, recebida: 8, defeito: 3 })).toBe(5);
    expect(gradeRealCelula({ enviada: 0, cortada: 0, recebida: 2, defeito: 9 })).toBe(0);
  });
  it("somaCampo soma o campo sobre toda a grade (chave ausente = 0)", () => {
    const g = { vA: { "38|P": { cortada: 5, recebida: 2 } as any }, vB: { "40|M": { cortada: 3 } as any } };
    expect(somaCampo(g as any, "cortada")).toBe(8);
    expect(somaCampo(g as any, "recebida")).toBe(2);
  });
  it("CELULA_ZERO zera os quatro campos", () => {
    expect(CELULA_ZERO).toEqual({ enviada: 0, cortada: 0, recebida: 0, defeito: 0 });
  });

  it("recebidaExcedeCortada = recebida > cortada", () => {
    expect(recebidaExcedeCortada({ enviada: 0, cortada: 5, recebida: 8, defeito: 0 })).toBe(true);
    expect(recebidaExcedeCortada({ enviada: 0, cortada: 5, recebida: 5, defeito: 0 })).toBe(false);
    expect(recebidaExcedeCortada({ enviada: 0, cortada: 5, recebida: 3, defeito: 0 })).toBe(false);
  });

  it("recebidaExcedeCortada trata cortada ausente como 0 (recebida>0 vira violação)", () => {
    expect(recebidaExcedeCortada({ enviada: 0, recebida: 3, defeito: 0 } as any)).toBe(true);
    expect(recebidaExcedeCortada({ enviada: 0, recebida: 0, defeito: 0 } as any)).toBe(false);
  });

  it("celulasRecebidaAcimaCortada lista as células com recebida > cortada", () => {
    const g = {
      vA: {
        "38|P": { enviada: 0, cortada: 5, recebida: 8, defeito: 0 }, // viola
        "40|M": { enviada: 0, cortada: 5, recebida: 5, defeito: 0 }, // ok
      },
      vB: {
        "38|P": { enviada: 0, cortada: 10, recebida: 3, defeito: 0 }, // ok
        "42|G": { enviada: 0, cortada: 2, recebida: 9, defeito: 0 }, // viola
      },
    };
    const viol = celulasRecebidaAcimaCortada(g as any);
    expect(viol).toHaveLength(2);
    expect(viol).toContainEqual({ variante_tecido_id: "vA", tamanho: "38|P" });
    expect(viol).toContainEqual({ variante_tecido_id: "vB", tamanho: "42|G" });
  });

  it("celulasRecebidaAcimaCortada retorna vazio quando não há violação", () => {
    const g = { vA: { "38|P": { enviada: 0, cortada: 5, recebida: 5, defeito: 0 } } };
    expect(celulasRecebidaAcimaCortada(g as any)).toEqual([]);
  });

  // MÉDIO (fix round 1 da Task 4): a zeragem líquida tem que ir ao payload como zeros EXPLÍCITOS.
  it("completarGradeFonte: zerar tudo vira 0 explícito em TODA size-key (não some do payload)", () => {
    const r = completarGradeFonte({}, ["34|PPP", "36|PP", "38|P"]);
    expect(r.grades).toEqual({ "34|PPP": 0, "36|PP": 0, "38|P": 0 });
    expect(r.grade_total).toBe(0);
  });
  it("completarGradeFonte: size ausente vira 0, presentes mantidos (redução parcial round-trippa)", () => {
    const r = completarGradeFonte({ "38|P": 5 }, ["34|PPP", "36|PP", "38|P"]);
    expect(r.grades).toEqual({ "34|PPP": 0, "36|PP": 0, "38|P": 5 });
    expect(r.grade_total).toBe(5);
  });
  it("completarGradeFonte: só considera size-keys de `tamanhos` (ignora chaves extra do estado)", () => {
    const r = completarGradeFonte({ "38|P": 4, "99|X": 7 }, ["38|P", "40|M"]);
    expect(r.grades).toEqual({ "38|P": 4, "40|M": 0 });
    expect(r.grade_total).toBe(4);
  });
});
