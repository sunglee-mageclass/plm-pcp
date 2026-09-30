import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detalheOc, type VinculoDetalhe } from "@/lib/plan-tecido/calc";
import { precoCardDoPlano, termoPoderDeVenda } from "@/lib/plan-tecido/preco-vaga";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

const mat = (aid: string, numero: number, vars: [string | null, number][], ordem = 0) => ({
  artigo_id: aid, artigo_nome: aid, unidade_medida: "metro", rendimento: null, tipo: "tecido", numero, consumo: 1, loss_percent: 0, ordem,
  variantes: vars.map(([vid, g], i) => ({ variante_tecido_id: vid, cor_id: vid ? undefined : "cor", label: "x", ordem: i + 1, multiplicador: 1, grades: {}, grade_total: g })),
});
const arvDe = (slots: any[]): PtArvore => ({ colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }] } as any);
const vin = (o: Partial<VinculoDetalhe> & { oc_tecido_id: string; oc_tecido_item_id: string }): VinculoDetalhe => ({
  modelo_id: "m1", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: "v1", artigo_id: "A", prioridade: 1, quantidade_m: null, ...o,
});

describe("fix 1: capacidade de variante e de artigo não contam 2x a mesma OC", () => {
  it("X (V,100) enche OC1; Y (sem variante, A, 80) vai para OC2", () => {
    const arv = arvDe([
      { id: "sx", modelo_id: "mx", materiais: [mat("A", 1, [["V", 100]])] },
      { id: "sy", modelo_id: "my", materiais: [mat("A", 1, [[null, 80]])] },
    ]);
    const vinculos = [
      vin({ modelo_id: "mx", variante_tecido_id: "V", oc_tecido_id: "oc1", oc_tecido_item_id: "i1", prioridade: 1 }),
      vin({ modelo_id: "my", variante_tecido_id: null, oc_tecido_id: "oc1", oc_tecido_item_id: "i1", prioridade: 1 }),
      vin({ modelo_id: "my", variante_tecido_id: null, oc_tecido_id: "oc2", oc_tecido_item_id: "i2", prioridade: 2 }),
    ];
    const capacidade = new Map([["oc1|V", 100], ["oc2|V", 100], ["oc1|artigo:A", 100], ["oc2|artigo:A", 100]]);
    const d = detalheOc(arv, { mx: ["oc1"], my: ["oc1", "oc2"] }, {}, new Set(["mx"]), undefined, undefined, { vinculos, capacidade });
    expect(d.reservPorOc.get("oc1")).toBeCloseTo(100, 5);
    expect(d.reservPorOc.get("oc2")).toBeCloseTo(80, 5);
  });
});

describe("fix 2: preço do card no poder de venda (loading / mascarado)", () => {
  const modelos = [{ id: "m1", linha_id: "L1", preco_venda: null, markup_editado: null }, { id: "m2", linha_id: "L1", preco_venda: 300, markup_editado: null }];
  const mk = { L1: 2.5 };
  const est = { custo: 50, markup: 2 };
  const sl = (modelo_id: string): PtSlot => ({ modelo_id, materiais: [] } as any);

  it("custo ainda carregando (undefined) => null => estimativa", () => {
    expect(precoCardDoPlano("m2", modelos, undefined, mk)).toBeNull();
    expect(termoPoderDeVenda(sl("m2"), 2, precoCardDoPlano("m2", modelos, undefined, mk), est)).toBeCloseTo(209.8, 5);
  });
  it("custo mascarado ({}) + card SEM preço digitado => estimativa (nunca 0)", () => {
    const p = precoCardDoPlano("m1", modelos, {}, mk);
    expect(p?.efetivo).toBe(0);
    expect(termoPoderDeVenda(sl("m1"), 2, p, est)).toBeCloseTo(209.8, 5);
  });
  it("custo mascarado + card COM preço digitado => usa o preço digitado", () => {
    const p = precoCardDoPlano("m2", modelos, {}, mk);
    expect(termoPoderDeVenda(sl("m2"), 2, p, est)).toBe(600);
  });
  it("custo disponível => preço do card", () => {
    const p = precoCardDoPlano("m1", modelos, { m1: { real: 100 } }, mk);
    expect(p).not.toBeNull();
    expect(p!.efetivo).toBeGreaterThan(0);
  });
  it("modelo ausente => null", () => {
    expect(precoCardDoPlano("zz", modelos, {}, mk)).toBeNull();
  });
  it("a tela usa o builder puro e só passa o mapa depois do sucesso da query", () => {
    const src = readFileSync("src/components/plan-tecido/PlanTecidoSheet.tsx", "utf8");
    expect(src).toContain("precoCardDoPlano(");
    expect(src).toMatch(/custoCardOk \? custoCardMap : undefined/);
  });
});

describe("fix 3: base pós-save sem preço nas vagas com card", () => {
  it("fonte: arvoreSalvaRef recebe semPrecoNasVagasComCard(marca.local)", () => {
    const src = readFileSync("src/components/plan-tecido/PlanTecidoSheet.tsx", "utf8");
    expect(src).toMatch(/arvoreSalvaRef\.current = semPrecoNasVagasComCard\(marca\.local\)/);
  });
});

describe("fix 4: fallback sem detalhe é determinístico e espera a situação", () => {
  it("ordena ocIds por oc_tecido_id quando não há detalhe", () => {
    const arv = arvDe([{ id: "s1", modelo_id: "m1", materiais: [mat("A", 1, [["v1", 100]])] }]);
    const capacidade = new Map([["ocA|v1", 60], ["ocB|v1", 500]]);
    const d1 = detalheOc(arv, { m1: ["ocB", "ocA"] }, {}, new Set(), undefined, undefined, { capacidade });
    const d2 = detalheOc(arv, { m1: ["ocA", "ocB"] }, {}, new Set(), undefined, undefined, { capacidade });
    expect(d1.reservPorOc.get("ocA")).toBeCloseTo(60, 5);
    expect(d1.reservPorOc.get("ocB")).toBeCloseTo(40, 5);
    expect([...d1.reservPorOc.entries()].sort()).toEqual([...d2.reservPorOc.entries()].sort());
  });
  it("aguardando a situação => sem repartição (mapas vazios)", () => {
    const arv = arvDe([{ id: "s1", modelo_id: "m1", materiais: [mat("A", 1, [["v1", 100]])] }]);
    const d = detalheOc(arv, { m1: ["ocA", "ocB"] }, {}, new Set(), undefined, undefined, { aguardando: true });
    expect(d.reservPorOc.size).toBe(0);
    expect(d.reservPorOcVar.size).toBe(0);
  });
});

describe("fix 5: ordem entra na chave da parcela", () => {
  it("blocos com mesmo tipo/numero e ordens diferentes não se fundem", () => {
    const arv = arvDe([{ id: "s1", modelo_id: "m1", materiais: [mat("A", 1, [["v1", 100]], 1), mat("A", 1, [["v1", 50]], 2)] }]);
    // (mat ordem 1 e 2 casam com vin.ordem 1 e 2)
    const vinculos = [
      vin({ oc_tecido_id: "ocA", oc_tecido_item_id: "i1", ordem: 1 }),
      vin({ oc_tecido_id: "ocB", oc_tecido_item_id: "i2", ordem: 2 }),
    ];
    const d = detalheOc(arv, { m1: ["ocA", "ocB"] }, {}, new Set(), undefined, undefined, { vinculos, capacidade: new Map() });
    expect(d.reservPorOc.get("ocA")).toBeCloseTo(100, 5);
    expect(d.reservPorOc.get("ocB")).toBeCloseTo(50, 5);
  });
});
