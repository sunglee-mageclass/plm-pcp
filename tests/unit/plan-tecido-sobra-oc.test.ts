import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contabilizarOc, demandaSemCor, sobraOc } from "@/lib/plan-tecido/calc";

// D-1 — o Resumo (por OC) e o Drawer (por cor) usam a MESMA régua: Σ por cor de contabilizarOc.
describe("sobraOc (D-1)", () => {
  // OC com 2 cores: A estoura (entregue 10, demanda 30 → −20); B sobra (entregue 50, demanda 10 → +40).
  const linhas = [
    { oc_tecido_id: "oc1", artigo_id: "t1", variante_tecido_id: "vA", entregue_m: 10, usada_m: 0 },
    { oc_tecido_id: "oc1", artigo_id: "t1", variante_tecido_id: "vB", entregue_m: 50, usada_m: 0 },
    { oc_tecido_id: "oc2", artigo_id: "t1", variante_tecido_id: "vA", entregue_m: 999, usada_m: 0 },
  ];
  const det = {
    reservPorOc: new Map([["oc1", 40]]),
    comprometidoPorOc: new Map<string, number>(),
    reservPorOcVar: new Map([["oc1|vA", 30], ["oc1|vB", 10]]),
    comprometidoPorOcVar: new Map<string, number>(),
  };
  it("é a soma das sobras por cor (igual ao que o Drawer mostra linha a linha)", () => {
    const drawer = contabilizarOc(30, 0, 0, 10).sobra + contabilizarOc(10, 0, 0, 50).sobra;
    expect(sobraOc("oc1", linhas, det)).toBe(drawer);
    expect(sobraOc("oc1", linhas, det)).toBe(20);
  });
  it("difere da conta sobre o total da OC quando as cores se compensam por clamp (o bug)", () => {
    // baixa real maior que a reserva na cor A: usada manda no Math.max por cor.
    const l2 = [
      { oc_tecido_id: "oc1", artigo_id: "t1", variante_tecido_id: "vA", entregue_m: 10, usada_m: 40 },
      { oc_tecido_id: "oc1", artigo_id: "t1", variante_tecido_id: "vB", entregue_m: 50, usada_m: 0 },
    ];
    const porCor = sobraOc("oc1", l2, det);
    const agregado = contabilizarOc(40, 0, 40, 60).sobra;
    expect(porCor).toBe(contabilizarOc(30, 0, 40, 10).sobra + contabilizarOc(10, 0, 0, 50).sobra);
    expect(porCor).not.toBe(agregado);
  });
  it("só conta as linhas da OC pedida e agrupa linhas repetidas da mesma cor", () => {
    const dup = [...linhas, { oc_tecido_id: "oc1", artigo_id: "t1", variante_tecido_id: "vA", entregue_m: 5, usada_m: 0 }];
    expect(sobraOc("oc1", dup, det)).toBe(contabilizarOc(30, 0, 0, 15).sobra + contabilizarOc(10, 0, 0, 50).sobra);
  });
  it("Resumo chama sobraOc; Drawer usa contabilizarOc por cor (mesma função base)", () => {
    const resumo = readFileSync("src/components/plan-tecido/ResumoPanel.tsx", "utf8");
    const drawer = readFileSync("src/components/plan-tecido/PlanTecidoDrawer.tsx", "utf8");
    const calc = readFileSync("src/lib/plan-tecido/calc.ts", "utf8");
    // R15b (P-189 A): o Resumo lê a Sobra de `resumoOcsColecao` (calc.ts), que chama sobraOc por OC
    expect(resumo).toMatch(/resumoOcsColecao\(ocs, situacao, det\)/);
    expect(calc).toMatch(/sobra: sobraOc\(o\.oc_tecido_id, linhas, det\)/);
    expect(drawer).toMatch(/contabilizarOc\(v\.reservada, v\.comprometida, v\.usada, v\.entregue\)/);
    expect(calc).toMatch(/total \+= contabilizarOc\(/);
  });

  it("demanda só-artigo (sem cor) também abate a Sobra: OC 100 m, 60 m sem cor → Sobra 40 (não 100)", () => {
    const l = [{ oc_tecido_id: "oc9", artigo_id: "t1", variante_tecido_id: "vA", entregue_m: 100, usada_m: 0 }];
    const d = {
      reservPorOc: new Map([["oc9", 60]]),            // 60 m só-artigo: entram no total por OC...
      comprometidoPorOc: new Map<string, number>(),
      reservPorOcVar: new Map<string, number>(),      // ...mas nenhuma variante
      comprometidoPorOcVar: new Map<string, number>(),
    };
    expect(demandaSemCor("oc9", d)).toEqual({ reservada: 60, comprometida: 0 });
    expect(sobraOc("oc9", l, d)).toBe(40);
  });
  it("Resumo e Drawer usam a mesma fonte para o resíduo sem cor", () => {
    const drawer = readFileSync("src/components/plan-tecido/PlanTecidoDrawer.tsx", "utf8");
    const resumo = readFileSync("src/components/plan-tecido/ResumoPanel.tsx", "utf8");
    expect(drawer).toMatch(/sobraOc\(/);
    expect(drawer).toMatch(/demandaSemCor\(/);
    // R15b: Resumo e Drawer repartem pela MESMA detalheOcColecao (det com reservPorOc/…Var) → sobraOc em calc.ts
    expect(resumo).toMatch(/resumoOcsColecao\(ocs, situacao, det\)/);
    expect(resumo).toMatch(/const det = detalheOcColecao\(/);
    expect(drawer).toMatch(/const det = detalheOcColecao\(/);
    expect(resumo).toMatch(/uma cor não usa o tecido de outra/);
  });
});
