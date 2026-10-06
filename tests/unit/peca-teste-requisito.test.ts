// R9 T3 — núcleo PURO do requisito "Peça teste aprovada" (src/lib/peca-teste.ts) contra a fixture COMPARTILHADA com o anti-drift
// SQL × TS (tests/integration/urgc-r9-kanban.test.ts).
import { describe, it, expect } from "vitest";
import { pecaTesteAprovadaModelo, pecaTesteAprovadaTrilha, tentativaAtual } from "../../src/lib/peca-teste";
import { CASOS_PECA_TESTE, entradaDoCaso } from "../fixtures/peca-teste-casos";

describe("pecaTesteAprovadaModelo × fixture (espelho da chave peca_teste_aprovada)", () => {
  it("a fixture tem os casos mínimos (≥ 12) e nomes únicos", () => {
    expect(CASOS_PECA_TESTE.length).toBeGreaterThanOrEqual(12);
    expect(new Set(CASOS_PECA_TESTE.map((c) => c.nome)).size).toBe(CASOS_PECA_TESTE.length);
    // os 2 lados aparecem (nenhuma fixture "sempre true" passa despercebida)
    expect(CASOS_PECA_TESTE.some((c) => c.esperado)).toBe(true);
    expect(CASOS_PECA_TESTE.some((c) => !c.esperado)).toBe(true);
  });

  for (const caso of CASOS_PECA_TESTE) {
    it(caso.nome, () => {
      expect(pecaTesteAprovadaModelo(entradaDoCaso(caso))).toBe(caso.esperado);
    });
  }

  it("ids reais no lugar dos rótulos dão o mesmo resultado", () => {
    const ids = { F1: "00000000-0000-4000-8000-0000000000f1", F2: "00000000-0000-4000-8000-0000000000f2" };
    for (const caso of CASOS_PECA_TESTE) expect(pecaTesteAprovadaModelo(entradaDoCaso(caso, ids)), caso.nome).toBe(caso.esperado);
  });
});

describe("pecaTesteAprovadaTrilha / tentativaAtual (espelho de _peca_teste_aprovada)", () => {
  it("tentativa atual = a de maior número, independente da ordem da lista", () => {
    const ts = [
      { numero: 2, aprovacao: "aprovado" as const, empresa_id: "F2" },
      { numero: 1, aprovacao: "reprovado" as const, empresa_id: "F1" },
    ];
    expect(tentativaAtual(ts)?.numero).toBe(2);
    expect(tentativaAtual([])).toBeNull();
    expect(pecaTesteAprovadaTrilha({ empresa_id: "F2", tentativas: ts })).toBe(true);
    expect(pecaTesteAprovadaTrilha({ empresa_id: "F1", tentativas: ts })).toBe(false);
  });

  it("não olha a M.O. nem o switch (quem decide é o chamador)", () => {
    const linha = { empresa_id: "F1", tentativas: [{ numero: 1, aprovacao: "aprovado" as const, empresa_id: "F1" }] };
    expect(pecaTesteAprovadaTrilha(linha)).toBe(true);
    expect(pecaTesteAprovadaModelo([{ ...linha, exige: true, mo_aprovado: null }])).toBe(false);
    expect(pecaTesteAprovadaModelo([{ ...linha, exige: false, mo_aprovado: null }])).toBe(true);
  });
});
