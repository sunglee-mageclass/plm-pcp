// R9 T3 — núcleo PURO do requisito "Peça teste aprovada" (src/lib/peca-teste.ts) contra a fixture COMPARTILHADA com o anti-drift
// SQL × TS (tests/integration/urgc-r9-kanban.test.ts).
import { describe, it, expect } from "vitest";
import { pecaTesteAprovadaModelo, pecaTesteAprovadaTrilha, tentativaAtual } from "../../src/lib/peca-teste";
import { CASOS_PECA_TESTE, CATEGORIAS_ROTULO, entradaDoCaso } from "../fixtures/peca-teste-casos";

describe("pecaTesteAprovadaModelo × fixture (espelho da chave peca_teste_aprovada)", () => {
  it("a fixture tem os casos mínimos (≥ 12) e nomes únicos", () => {
    expect(CASOS_PECA_TESTE.length).toBeGreaterThanOrEqual(12);
    expect(new Set(CASOS_PECA_TESTE.map((c) => c.nome)).size).toBe(CASOS_PECA_TESTE.length);
    // os 2 lados aparecem (nenhuma fixture "sempre true" passa despercebida)
    expect(CASOS_PECA_TESTE.some((c) => c.esperado)).toBe(true);
    expect(CASOS_PECA_TESTE.some((c) => !c.esperado)).toBe(true);
    // ruling do controlador (revisão T3, achado 1): "tipo trocado" e "linha apagada"/órfã estão na fixture
    expect(CASOS_PECA_TESTE.some((c) => c.linhas.some((l) => l.tentativas.some((x) => x.tipoOriginal)))).toBe(true);
    expect(CASOS_PECA_TESTE.some((c) => (c.orfas?.length ?? 0) > 0)).toBe(true);
  });

  for (const caso of CASOS_PECA_TESTE) {
    it(caso.nome, () => {
      expect(pecaTesteAprovadaModelo(entradaDoCaso(caso))).toBe(caso.esperado);
    });
  }

  it("ids reais no lugar dos rótulos dão o mesmo resultado", () => {
    const ids = { F1: "00000000-0000-4000-8000-0000000000f1", F2: "00000000-0000-4000-8000-0000000000f2" };
    const cats = { exige: "00000000-0000-4000-8000-00000000ca01", sem_switch: "00000000-0000-4000-8000-00000000ca02" };
    for (const caso of CASOS_PECA_TESTE) expect(pecaTesteAprovadaModelo(entradaDoCaso(caso, ids, cats)), caso.nome).toBe(caso.esperado);
  });
});

describe("pecaTesteAprovadaTrilha / tentativaAtual (espelho de _peca_teste_aprovada)", () => {
  const CAT = CATEGORIAS_ROTULO.exige;
  const OUTRA = CATEGORIAS_ROTULO.sem_switch;
  const tent = (numero: number, aprovacao: "aprovado" | "reprovado" | null, empresa_id: string | null, categoria_id: string | null = CAT) => ({
    categoria_id,
    numero,
    aprovacao,
    empresa_id,
  });

  it("tentativa atual = a de maior número, independente da ordem da lista", () => {
    const ts = [tent(2, "aprovado", "F2"), tent(1, "reprovado", "F1")];
    expect(tentativaAtual(ts)?.numero).toBe(2);
    expect(tentativaAtual([])).toBeNull();
    expect(pecaTesteAprovadaTrilha({ categoria_id: CAT, empresa_id: "F2", tentativas: ts })).toBe(true);
    expect(pecaTesteAprovadaTrilha({ categoria_id: CAT, empresa_id: "F1", tentativas: ts })).toBe(false);
  });

  it("não olha a M.O. nem o switch (quem decide é o chamador)", () => {
    const linha = { categoria_id: CAT, empresa_id: "F1", tentativas: [tent(1, "aprovado", "F1")] };
    expect(pecaTesteAprovadaTrilha(linha)).toBe(true);
    expect(pecaTesteAprovadaModelo([{ ...linha, exige: true, mo_aprovado: null }])).toBe(false);
    expect(pecaTesteAprovadaModelo([{ ...linha, exige: false, mo_aprovado: null }])).toBe(true);
  });

  it("ruling T3: a própria função filtra pelo TIPO ATUAL da linha (o chamador não precisa)", () => {
    // aprovada só no tipo antigo → falso; a do tipo atual é a que vale, mesmo com número MENOR que a do tipo antigo
    expect(pecaTesteAprovadaTrilha({ categoria_id: CAT, empresa_id: "F1", tentativas: [tent(1, "aprovado", "F1", OUTRA)] })).toBe(false);
    expect(
      pecaTesteAprovadaTrilha({
        categoria_id: CAT,
        empresa_id: "F1",
        tentativas: [tent(3, "reprovado", "F1", OUTRA), tent(1, "aprovado", "F1", CAT)],
      }),
    ).toBe(true);
    // voltar ao tipo antigo traz a aprovada de volta (as tentativas nunca saem do banco)
    expect(pecaTesteAprovadaTrilha({ categoria_id: OUTRA, empresa_id: "F1", tentativas: [tent(1, "aprovado", "F1", OUTRA)] })).toBe(true);
  });

  it("linha sem tipo (categoria null) nunca casa tentativa alguma, como o `= NULL` do SQL", () => {
    expect(pecaTesteAprovadaTrilha({ categoria_id: null, empresa_id: "F1", tentativas: [tent(1, "aprovado", "F1", null)] })).toBe(false);
    expect(pecaTesteAprovadaTrilha({ categoria_id: null, empresa_id: "F1", tentativas: [] })).toBe(false);
  });
});
