import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { semPrecoNasVagasComCard } from "@/lib/plan-tecido/engine";
import { termoPoderDeVenda } from "@/lib/plan-tecido/preco-vaga";
import { precoDoCard } from "@/lib/preco";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

// Entradas sintéticas (sem banco).
const slot = (o: Partial<PtSlot>): PtSlot => ({ modelo_id: null, materiais: [], ...o } as PtSlot);
const arvore = (slots: PtSlot[]): PtArvore =>
  ({ colecao_id: "c", subcolecoes: [{ id: "s", nome: "S", linhas: [{ id: "l", nome: "L", slots }] }] } as unknown as PtArvore);

describe("semPrecoNasVagasComCard", () => {
  it("zera preco_venda só nas vagas com modelo_id; não muta a entrada", () => {
    const a = arvore([slot({ id: "1", modelo_id: "m1", preco_venda: 298 }), slot({ id: "2", modelo_id: null, preco_venda: 150 })]);
    const r = semPrecoNasVagasComCard(a);
    const [s1, s2] = (r.subcolecoes[0] as any).linhas[0].slots;
    expect(s1.preco_venda).toBeNull();
    expect(s2.preco_venda).toBe(150);
    expect((a.subcolecoes[0] as any).linhas[0].slots[0].preco_venda).toBe(298);
  });
});

describe("poder de venda por vaga", () => {
  const custoMap = { m1: { real: 100 } };
  const mk = { L1: 2.5 };
  const card = precoDoCard({ id: "m1", linha_id: "L1", preco_venda: 298, markup_editado: null }, custoMap, mk);

  it("vaga COM card usa o preço do card x grade (ignora o preço/estimativa da vaga)", () => {
    const s = slot({ modelo_id: "m1", preco_venda: 999 });
    expect(termoPoderDeVenda(s, 10, card, { custo: 1, markup: 9 })).toBe(2980);
  });

  it("vaga SEM card usa a estimativa da vaga", () => {
    const s = slot({ modelo_id: null, preco_venda: 120 });
    expect(termoPoderDeVenda(s, 5, null, { custo: 50, markup: 2 })).toBe(600);
    const s2 = slot({ modelo_id: null, preco_venda: null });
    // 50 x 2 = 100 -> sugerido 104,90
    expect(termoPoderDeVenda(s2, 2, undefined, { custo: 50, markup: 2 })).toBeCloseTo(209.8, 5);
  });

  it("vaga com card sem preço do card disponível cai na estimativa (ainda carregando)", () => {
    const s = slot({ modelo_id: "m1", preco_venda: null });
    expect(termoPoderDeVenda(s, 2, null, { custo: 50, markup: 2 })).toBeCloseTo(209.8, 5);
  });
});

describe("CustoSection (fonte)", () => {
  const src = readFileSync("src/components/plan-tecido/CustoSection.tsx", "utf8");
  it("o bloco da vaga COM card não lê slot.preco_venda", () => {
    const ini = src.indexOf("function CustoDoCard");
    const fim = src.indexOf("function CustoDaVagaSemCard");
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    expect(src.slice(ini, fim)).not.toMatch(/preco_venda/);
  });
  it("despacha por modelo_id e oferece 'Abrir no Planejamento' só com canView", () => {
    expect(src).toMatch(/slot\.modelo_id \? <CustoDoCard/);
    expect(src).toMatch(/canView\("criacao_planejamento"\)/);
    expect(src).toContain("Abrir no Planejamento");
  });
});
