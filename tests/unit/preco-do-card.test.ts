import { describe, it, expect } from "vitest";
import { precoDoCard, precoInfo } from "@/lib/preco";

// Entradas SINTÉTICAS (sem acesso ao banco): reproduzem a fórmula do `piFor` da lista do Planejamento.
// Os valores de referência do plano (ALICIA 298,00 / CATARINA C 398,00 / DALILA 198,00) não foram conferidos na cópia.
const linhaMk = { L1: 2.5, L2: 3 };

describe("precoDoCard = piFor da lista do Planejamento", () => {
  const piFor = (m: any, custoMap: any) =>
    precoInfo(custoMap[m.id]?.real, m.linha_id ? (linhaMk as any)[m.linha_id] : 0, m.preco_venda, m.markup_editado);

  it("iguala o piFor em casos variados (com preço, sem preço, markup editado, sem linha)", () => {
    const custoMap = { a: { real: 119.2 }, b: { real: 132.5 }, c: { real: 66 }, d: { real: 50 } };
    const cards = [
      { id: "a", linha_id: "L1", preco_venda: 298, markup_editado: null },
      { id: "b", linha_id: "L2", preco_venda: null, markup_editado: null },
      { id: "c", linha_id: "L2", preco_venda: 198, markup_editado: 3 },
      { id: "d", linha_id: null, preco_venda: null, markup_editado: 2 },
    ];
    for (const c of cards) expect(precoDoCard(c, custoMap, linhaMk)).toEqual(piFor(c, custoMap));
  });

  it("preço da venda manda sobre o sugerido; sem preço usa sugerido do markup da LINHA DO MODELO", () => {
    const custoMap = { a: { real: 119.2 }, b: { real: 159.2 } };
    expect(precoDoCard({ id: "a", linha_id: "L1", preco_venda: 298, markup_editado: null }, custoMap, linhaMk).efetivo).toBe(298);
    const b = precoDoCard({ id: "b", linha_id: "L2", preco_venda: null, markup_editado: null }, custoMap, linhaMk);
    expect(b.markupAplicado).toBe(3);
    expect(b.sugerido).toBe(479.9); // 159,2 x 3 = 477,6 -> próximo degrau x4,90/x9,90
    expect(b.efetivo).toBe(b.sugerido);
  });

  it("custo mascarado ({}): custo 0 (UI mostra '—'), sem sugerido; preço do card ainda vale", () => {
    const p = precoDoCard({ id: "a", linha_id: "L1", preco_venda: 298, markup_editado: null }, {}, linhaMk);
    expect(p.custo).toBe(0);
    expect(p.sugerido).toBe(0);
    expect(p.efetivo).toBe(298);
    const sem = precoDoCard({ id: "a", linha_id: "L1", preco_venda: null, markup_editado: null }, {}, linhaMk);
    expect(sem.efetivo).toBe(0);
  });

  it("tolera mapas ausentes", () => {
    expect(precoDoCard({ id: "x", linha_id: "L1" }, undefined, undefined).efetivo).toBe(0);
  });
});
