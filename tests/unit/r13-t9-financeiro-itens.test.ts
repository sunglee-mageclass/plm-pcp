// [urg R13 T9] Janela da OC no Financeiro: a grade de CADA item (OC com vários produtos) vira linhas "nome · variante · tamanho".
import { describe, it, expect } from "vitest";
import { achatarGradeItensOc } from "@/lib/oc-multi-itens";

describe("achatarGradeItensOc", () => {
  it("achata por item, na ordem da OC; 'UN' não aparece; quantidades numéricas", () => {
    const r = achatarGradeItensOc([
      { ordem: 2, nome_produto: "Cinto", grade_detalhe: { "1": { UN: { pedida: 10, recebida: 4 } } } },
      { ordem: 1, nome_produto: "Vestido Midi", grade_detalhe: { "1": { P: { pedida: 5, recebida: 0 }, M: { pedida: "7", recebida: 7 } }, "2": { P: { pedida: 1 } } } },
    ]);
    expect(r).toEqual([
      { _nome: "Vestido Midi · variante 1 · P", quantidade_pedida: 5, quantidade_recebida: 0 },
      { _nome: "Vestido Midi · variante 1 · M", quantidade_pedida: 7, quantidade_recebida: 7 },
      { _nome: "Vestido Midi · variante 2 · P", quantidade_pedida: 1, quantidade_recebida: 0 },
      { _nome: "Cinto · variante 1", quantidade_pedida: 10, quantidade_recebida: 4 },
    ]);
  });
  it("sem itens / sem grade / nome vazio / célula nula: não quebra", () => {
    expect(achatarGradeItensOc(undefined)).toEqual([]);
    expect(achatarGradeItensOc(null)).toEqual([]);
    expect(achatarGradeItensOc([{ nome_produto: "X", grade_detalhe: null }, { nome_produto: null, grade_detalhe: {} }])).toEqual([]);
    expect(achatarGradeItensOc([{ nome_produto: " ", grade_detalhe: { "1": { G: null } } }]))
      .toEqual([{ _nome: "— · variante 1 · G", quantidade_pedida: 0, quantidade_recebida: 0 }]);
  });
});
