import { describe, it, expect } from "vitest";
import { splitEven, metragemDisponivel, pecasLinha, demandaLinha, saldo, distribuirNasSemanas, agregarUsoOC, effProf } from "@/lib/simulacao";

describe("simulacao — cálculo puro", () => {
  it("splitEven reparte o resto nas primeiras", () => {
    expect(splitEven(13, 5)).toEqual([3, 3, 3, 2, 2]);
    expect(splitEven(10, 5)).toEqual([2, 2, 2, 2, 2]);
    expect(splitEven(3, 0)).toEqual([]);
    expect(splitEven(0, 3)).toEqual([0, 0, 0]);
  });
  it("metragem: kg converte por rendimento; metro é direto", () => {
    expect(metragemDisponivel("kg", 100, 4)).toBe(400);
    expect(metragemDisponivel("metro", 250, 4)).toBe(250);
    expect(metragemDisponivel("kg", 100, null)).toBe(0);
  });
  it("peças e demanda", () => {
    expect(pecasLinha(8, 3)).toBe(24);
    // 2 modelos × 24 peças × consumos 1,2 e 1,5 → 24*1.2 + 24*1.5
    expect(demandaLinha(8, 3, [1.2, 1.5])).toBeCloseTo(24 * 1.2 + 24 * 1.5, 5);
  });
  it("saldo e distribuição", () => {
    expect(saldo(900, 172.8)).toBeCloseTo(727.2, 5);
    expect(distribuirNasSemanas(13, [1, 2, 3, 4, 5])).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
    expect(distribuirNasSemanas(5, [])).toEqual({});
  });
});

describe("agregarUsoOC — uso somado da mesma OC entre subcoleções", () => {
  const item = (id: string, qtd: number) => ({ id, quantidade_pedida: qtd, artigo: { unidade_medida: "metro", rendimento: null } });
  const oc = (id: string, numero: string, itens: any[]) => ({ id, numero_pedido: numero, itens });
  // unidade que usa 1 OC + 1 cor; demanda da unidade = prof×Σconsumo
  const u = (ocId: string | null, ocItemId: string, prof: number, consumo: number, profPorCor?: Record<string, number>) =>
    ({ ocId, variantes: ocItemId ? [{ ocItemId }] : [], linhas: [{ profCor: prof, profPorCor, modelos: [{ consumo }] }] });

  it("soma a demanda da MESMA cor entre 2 subcoleções", () => {
    const ocs = [oc("oc1", "OC-123", [item("verde", 20), item("preto", 30)])];
    // 2 subcoleções usam oc1+verde; cada demU = 8×1 = 8 → total 16
    const res = agregarUsoOC([u("oc1", "verde", 8, 1), u("oc1", "verde", 8, 1)], ocs);
    expect(res).toHaveLength(1);
    const verde = res[0].cores.find((c) => c.ocItemId === "verde")!;
    expect(verde.dem).toBe(16);   // somado, não separado
    expect(verde.disp).toBe(20);
    expect(verde.saldo).toBe(4);
    expect(res[0].ok).toBe(true);
  });

  it("cor compartilhada estoura; cor exclusiva sobra; ok=false", () => {
    const ocs = [oc("oc1", "OC-1", [item("verde", 10), item("preto", 30)])];
    const res = agregarUsoOC([
      u("oc1", "verde", 8, 1),
      { ocId: "oc1", variantes: [{ ocItemId: "verde" }, { ocItemId: "preto" }], linhas: [{ profCor: 8, modelos: [{ consumo: 1 }] }] },
    ], ocs);
    const verde = res[0].cores.find((c) => c.ocItemId === "verde")!;
    const preto = res[0].cores.find((c) => c.ocItemId === "preto")!;
    expect(verde.dem).toBe(16); expect(verde.disp).toBe(10); expect(verde.saldo).toBe(-6);
    expect(preto.dem).toBe(8); expect(preto.disp).toBe(30); expect(preto.saldo).toBe(22);
    expect(res[0].ok).toBe(false);
    expect(res[0].totalSaldo).toBe(10 + 30 - (16 + 8)); // 16
  });

  it("OC não atribuída não aparece; unidade sem OC é ignorada", () => {
    const ocs = [oc("oc1", "A", [item("v", 10)]), oc("oc2", "B", [item("w", 10)])];
    const res = agregarUsoOC([u("oc1", "v", 8, 1), u(null, "", 8, 1)], ocs);
    expect(res).toHaveLength(1);
    expect(res[0].ocId).toBe("oc1");
  });

  it("profPorCor: demanda da cor soma as duas subcoleções com profs diferentes", () => {
    // verde usada em 2 subcoleções, cada uma com profPorCor diferente p/ "verde"
    // Sub1: effProf("verde")=3, consumo=2 → demCor=6
    // Sub2: effProf("verde")=7, consumo=2 → demCor=14
    // Total dem verde = 20; disp=25 → saldo=5, ok=true
    const ocs = [oc("oc1", "OC-abc", [item("verde", 25)])];
    const res = agregarUsoOC([
      u("oc1", "verde", 5, 2, { verde: 3 }),
      u("oc1", "verde", 5, 2, { verde: 7 }),
    ], ocs);
    expect(res).toHaveLength(1);
    const verde = res[0].cores.find((c) => c.ocItemId === "verde")!;
    expect(verde.dem).toBe(20);
    expect(verde.disp).toBe(25);
    expect(verde.saldo).toBe(5);
    expect(res[0].ok).toBe(true);
  });

  it("profPorCor: override maior estoura, cor sem override sobra", () => {
    // azul: effProf=10 (override), consumo=2 → dem=20; disp=15 → estoura
    // vermelho: effProf=5 (base, sem override), consumo=2 → dem=10; disp=30 → sobra
    const ocs = [oc("oc1", "OC-xyz", [item("azul", 15), item("vermelho", 30)])];
    const unidade = {
      ocId: "oc1",
      variantes: [{ ocItemId: "azul" }, { ocItemId: "vermelho" }],
      linhas: [{ profCor: 5, profPorCor: { azul: 10 }, modelos: [{ consumo: 2 }] }],
    };
    const res = agregarUsoOC([unidade], ocs);
    expect(res).toHaveLength(1);
    const azul = res[0].cores.find((c) => c.ocItemId === "azul")!;
    const vermelho = res[0].cores.find((c) => c.ocItemId === "vermelho")!;
    expect(azul.dem).toBe(20);
    expect(azul.disp).toBe(15);
    expect(azul.saldo).toBe(-5);
    expect(vermelho.dem).toBe(10);
    expect(vermelho.disp).toBe(30);
    expect(vermelho.saldo).toBe(20);
    expect(res[0].ok).toBe(false);
  });
});
