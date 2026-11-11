import { describe, it, expect } from "vitest";
import { linhasComparativo, tamanhosDaResp, type GradeComparativoResp } from "@/lib/grade-comparativo";

const resp: GradeComparativoResp = {
  variantes: [
    { variante_numero: 2, variante_tecido_id: "vt-b", label: "Azul" },
    { variante_numero: 1, variante_tecido_id: null, label: "Preto" },
  ],
  tamanhos: ["P", "M", "G"],
  celulas: {
    "2|P": { programada: 10, cad: 8, pcp: { enviada: 8, cortada: 8, recebida: 7, defeito: 1 }, cq: { recebida: 7, defeito: 1, real: 6 } },
    "2|M": { programada: 5, cad: null, pcp: null, cq: null },
    "1|G": { programada: null, cad: 3, pcp: null, cq: null },
  },
};

describe("grade-comparativo (F5-2 Task 4)", () => {
  it("monta uma linha por variante na ordem do servidor, com todos os tamanhos da união", () => {
    const linhas = linhasComparativo(resp);
    expect(linhas.map((l) => l.variante)).toEqual([{ num: 2, label: "Azul" }, { num: 1, label: "Preto" }]);
    for (const l of linhas) expect(Object.keys(l.celulas)).toEqual(["P", "M", "G"]);
    expect(linhas[0].celulas.P).toEqual({
      programada: 10, cad: 8,
      pcp: { enviada: 8, cortada: 8, recebida: 7, defeito: 1 },
      cq: { recebida: 7, defeito: 1, real: 6 },
    });
    expect(linhas[1].celulas.G).toEqual({ programada: null, cad: 3, pcp: null, cq: null });
  });

  it("célula faltante = todas as fases null (a UI formata '—')", () => {
    const linhas = linhasComparativo(resp);
    expect(linhas[0].celulas.G).toEqual({ programada: null, cad: null, pcp: null, cq: null });
    expect(linhas[1].celulas.P).toEqual({ programada: null, cad: null, pcp: null, cq: null });
  });

  it("preserva zero (0 não vira null) e fase ausente dentro de célula parcial vira null", () => {
    const r: GradeComparativoResp = {
      variantes: [{ variante_numero: 1, variante_tecido_id: null, label: "X" }],
      tamanhos: ["U"],
      celulas: { "1|U": { programada: 0, cad: 0 } },
    };
    expect(linhasComparativo(r)[0].celulas.U).toEqual({ programada: 0, cad: 0, pcp: null, cq: null });
  });

  it("tamanhosDaResp devolve a união ordenada do servidor, sem reordenar", () => {
    expect(tamanhosDaResp(resp)).toEqual(["P", "M", "G"]);
    expect(tamanhosDaResp({ variantes: [], tamanhos: ["10", "2"], celulas: {} })).toEqual(["10", "2"]);
  });

  it("resp vazio = []", () => {
    const vazio: GradeComparativoResp = { variantes: [], tamanhos: [], celulas: {} };
    expect(linhasComparativo(vazio)).toEqual([]);
    expect(tamanhosDaResp(vazio)).toEqual([]);
    expect(linhasComparativo(null)).toEqual([]);
  });
});
