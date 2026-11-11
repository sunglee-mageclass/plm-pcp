import { describe, it, expect } from "vitest";
import { resumoVendaSubcolecao } from "@/lib/plan-tecido/preco-vaga";
import type { PtSlot } from "@/lib/plan-tecido/types";

// Slot mínimo p/ o cálculo: a função pura recebe grade/custo/markup via callbacks, então o slot só
// precisa de modelo_id, linha_id, preco_venda, markup_editado e materiais (usados pelos callbacks).
const slot = (over: Partial<PtSlot>): PtSlot => ({ modelo_id: null, linha_id: "L1", preco_venda: null, markup_editado: null, materiais: [], ...over });

describe("resumoVendaSubcolecao (F4b — poder de venda + markup médio do PT)", () => {
  const fns = (over?: Partial<Parameters<typeof resumoVendaSubcolecao>[1]>) => ({
    comFornec: () => true,
    gradeDe: () => 10,
    custoDe: () => 50,
    markupDe: () => 2,
    ...over,
  });

  it("sem card: usa a estimativa da vaga (preço sugerido arredondado) no poder e no markup real", () => {
    // custo 50, markup 2 → preço 100 → precoSugerido(100)=104,90 (próximo *,90 pra cima);
    // efetivo 104,90; markupReal = 104,90/50 = 2,098
    const r = resumoVendaSubcolecao([slot({})], fns());
    expect(r.poder).toBeCloseTo(104.9 * 10, 6); // preço sugerido × grade
    expect(r.markupMedio).toBeCloseTo(104.9 / 50, 6);
    expect(r.qtd).toBe(1);
  });

  it("sem card com preço de venda digitado: efetivo = o digitado; markup real = digitado/custo", () => {
    // preco_venda 200, custo 50 → markupReal 4
    const r = resumoVendaSubcolecao([slot({ preco_venda: 200 })], fns());
    expect(r.poder).toBeCloseTo(200 * 10, 6);
    expect(r.markupMedio).toBeCloseTo(4, 6);
  });

  it("vaga sem fornecedor (comFornec=false) NÃO entra no resumo", () => {
    const r = resumoVendaSubcolecao([slot({}), slot({})], fns({ comFornec: (s) => s.preco_venda === 200 }));
    // só a que tem preco_venda 200 passa o gate
    const r2 = resumoVendaSubcolecao([slot({ preco_venda: 200 }), slot({ preco_venda: null })], fns({ comFornec: (s) => s.preco_venda === 200 }));
    expect(r.qtd).toBe(0);
    expect(r2.qtd).toBe(1);
    expect(r2.poder).toBeCloseTo(200 * 10, 6);
  });

  it("com card: usa o preço efetivo do card (P-167 A) quando efetivo > 0", () => {
    const precoCardDe = () => ({ custo: 40, markupLinha: 0, markupAplicado: 0, preco: 0, sugerido: 0, efetivo: 160, markupReal: 4, markupExibir: 4 });
    const r = resumoVendaSubcolecao([slot({ modelo_id: "m1" })], fns({ precoCardDe }));
    expect(r.poder).toBeCloseTo(160 * 10, 6); // preço do card × grade
    expect(r.markupMedio).toBeCloseTo(4, 6);   // markup real do card
  });

  it("markup médio é a média aritmética entre vagas (não ponderada por grade)", () => {
    // preços de venda DIGITADOS (não passam pelo arredondamento do sugerido): A 100/custo 50 = 2;
    // B 300/custo 50 = 6 → média (2+6)/2 = 4
    const r = resumoVendaSubcolecao([slot({ preco_venda: 100 }), slot({ preco_venda: 300 })], fns());
    expect(r.markupMedio).toBeCloseTo(4, 6);
  });

  it("lista vazia / nenhum com fornecedor = tudo zero", () => {
    expect(resumoVendaSubcolecao([], fns())).toEqual({ poder: 0, markupMedio: 0, qtd: 0 });
  });
});
