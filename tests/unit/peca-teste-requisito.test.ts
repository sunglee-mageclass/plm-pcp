import { describe, it, expect } from "vitest";
import { CASOS_PECA_TESTE, type CasoPecaTeste } from "../fixtures/peca-teste-tipo-casos";
import { pecaTesteAprovadaModelo, pecaTesteAprovadaTipo, statusPecaTesteModelo, tentativaAtual, type ModeloRequisito } from "../../src/lib/peca-teste-requisito";

const ID = { exige: "cat-exige", exige2: "cat-exige2", sem_switch: "cat-sem", sem_tipo: null } as const;
function paraRequisito(c: CasoPecaTeste): ModeloRequisito {
  return {
    linhas: c.linhas.map((l) => ({ categoria_id: ID[l.tipo], exige: l.tipo === "exige" || l.tipo === "exige2", mo_aprovado: l.mo_aprovado })),
    tentativas: c.tentativas.map((t) => ({ categoria_id: ID[t.tipo], numero: t.numero, aprovacao: t.aprovacao, data_saida: "2026-10-01" })),
  };
}
describe("pecaTesteAprovadaModelo × fixture", () => {
  it("a fixture tem os casos mínimos (≥ 15) e nomes únicos", () => {
    expect(CASOS_PECA_TESTE.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CASOS_PECA_TESTE.map((c) => c.nome)).size).toBe(CASOS_PECA_TESTE.length);
  });
  for (const c of CASOS_PECA_TESTE) it(c.nome, () => expect(pecaTesteAprovadaModelo(paraRequisito(c))).toBe(c.esperado));
});
describe("pecaTesteAprovadaTipo / tentativaAtual", () => {
  it("tentativa atual = a de maior número, independente da ordem da lista", () => {
    expect(tentativaAtual([{ numero: 2 }, { numero: 3 }, { numero: 1 }])?.numero).toBe(3);
    expect(tentativaAtual([])).toBeNull();
  });
  it("não olha o fornecedor, a M.O. nem o switch; tipo null nunca casa", () => {
    const ts = [{ categoria_id: "A", numero: 1, aprovacao: "aprovado" as const }];
    expect(pecaTesteAprovadaTipo(ts, "A")).toBe(true);
    expect(pecaTesteAprovadaTipo(ts, "B")).toBe(false);
    expect(pecaTesteAprovadaTipo(ts, null)).toBe(false);
  });
});
describe("statusPecaTesteModelo", () => {
  const exige = { categoria_id: "A", exige: true, mo_aprovado: true };
  it("nenhuma linha exige → nao_exige", () => expect(statusPecaTesteModelo({ linhas: [{ categoria_id: "B", exige: false, mo_aprovado: null }], tentativas: [] })).toBe("nao_exige"));
  it("aprovada (M.O. + trilha do tipo)", () => expect(statusPecaTesteModelo({ linhas: [exige], tentativas: [{ categoria_id: "A", numero: 1, aprovacao: "aprovado" }] })).toBe("aprovada"));
  it("exige sem tentativa iniciada → falta; com data de saída e não aprovada → em_teste", () => {
    expect(statusPecaTesteModelo({ linhas: [exige], tentativas: [{ categoria_id: "A", numero: 1, aprovacao: null, data_saida: null }] })).toBe("falta");
    expect(statusPecaTesteModelo({ linhas: [exige], tentativas: [{ categoria_id: "A", numero: 1, aprovacao: null, data_saida: "2026-10-01" }] })).toBe("em_teste");
  });
  it("PT aprovada mas M.O. não aprovada → em_teste (iniciou, não está ok)", () =>
    expect(statusPecaTesteModelo({ linhas: [{ ...exige, mo_aprovado: null }], tentativas: [{ categoria_id: "A", numero: 1, aprovacao: "aprovado", data_saida: "2026-10-01" }] })).toBe("em_teste"));
});
