import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { baseCustoPlanejamento, baseMarkupComMO, estimativaComCustosAdicionais, previstoDaFicha } from "@/components/planejamento/planejamento-detail/custo-base";
import type { TotaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — decisão F3 #6: markup e tabela no MESMO custo-base (real › previsto do BOM › estimativa).
const tot = (p: Partial<TotaisBom>): TotaisBom => ({ tecido: 0, forro: 0, entretela: 0, aviamento: 0, etiqueta: 0, custosAdicionais: 0, materiaisBom: 0, terceirizados: 0, peca: 0, ...p });

describe("baseCustoPlanejamento", () => {
  it("confirmado (CAD enviado ao corte) → real, mesmo com previsto maior", () => {
    expect(baseCustoPlanejamento({ confirmado: true, realServidor: 100, previsto: 118.29, estimativa: 80 })).toEqual({ valor: 100, selo: "real" });
  });
  it("confirmado sem real → 0 com selo real (tabela mostra —)", () => {
    expect(baseCustoPlanejamento({ confirmado: true, realServidor: null, previsto: 118, estimativa: 80 })).toEqual({ valor: 0, selo: "real" });
  });
  it("sem corte e com previsto → previsto", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 118.29, previsto: 118.29, estimativa: 80 })).toEqual({ valor: 118.29, selo: "previsto" });
  });
  it("sem previsto → estimativa (antes ficava '—')", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 0, previsto: 0, estimativa: 80 })).toEqual({ valor: 80, selo: "estimado" });
  });
  it("nada → 0 estimado", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: undefined, previsto: undefined, estimativa: 0 })).toEqual({ valor: 0, selo: "estimado" });
  });
  // Fix round 4 (item 1, IMPORTANTE) — sem `veCustos` (nem `criacao_planejamento:custos` nem
  // `criacao_desenvolvimento:custos`), o PD (PlanejamentoDetail.tsx) zera `previsto`/`estimativa` ANTES de
  // chamar esta função (o gate de permissão fica no PD, não aqui — mantém `baseCustoPlanejamento` pura/sem
  // RBAC). `confirmado`/`realServidor` seguem intocados porque já vêm mascarados (`{}`) do RPC
  // `custo_unitario_modelos` no servidor (invariante #12) — redundante propositalmente, defesa em
  // profundidade. Resultado: base 0/estimado, exatamente o mesmo caso de "nada" acima — documentado aqui
  // como o cenário específico do vazamento corrigido (sugerido/markup/faixas viram "—" na tabela).
  it("sem veCustos (o PD zera previsto/estimativa antes de chamar) → base 0, mesmo com real mascarado (real=0, confirmado=false)", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 0, previsto: 0, estimativa: 0 })).toEqual({ valor: 0, selo: "estimado" });
  });
});

describe("previstoDaFicha", () => {
  it("BOM sem material (só M.O./custos adicionais) NÃO vira previsto", () => {
    expect(previstoDaFicha(tot({ terceirizados: 35, peca: 35 }))).toBe(0);
  });
  it("BOM com material → Custo de 1 Peça", () => {
    expect(previstoDaFicha(tot({ tecido: 57.17, materiaisBom: 79.79, terceirizados: 35, custosAdicionais: 3.5, peca: 118.29 }))).toBe(118.29);
  });
});

// Fix pós-rebase (item 7) — no estimado, os custos adicionais entram no custo-base (paridade com o Dev; preco.ts intocado).
describe("estimativaComCustosAdicionais", () => {
  it("soma os custos adicionais à estimativa (tecido + aviamento + M.O.)", () => {
    expect(estimativaComCustosAdicionais(80, [{ descricao: "Lavanderia", valor: 3.5 }, { descricao: "Bordado", valor: 2 }])).toBe(85.5);
  });
  it("só custos adicionais (sem tecido/aviamento/M.O.) ⇒ a estimativa é a soma deles — vira o custo-base estimado", () => {
    const est = estimativaComCustosAdicionais(0, [{ descricao: "Etiqueta bordada", valor: 1.25 }]);
    expect(est).toBe(1.25);
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 0, previsto: 0, estimativa: est })).toEqual({ valor: 1.25, selo: "estimado" });
  });
  it("sem custos adicionais / formato inválido ⇒ a estimativa de sempre", () => {
    expect(estimativaComCustosAdicionais(80, [])).toBe(80);
    expect(estimativaComCustosAdicionais(80, null)).toBe(80);
  });
});

describe("preço M6 — base do markup do importado = landed + M.O.", () => {
  it("soma a M.O. ao custo landed (previsto)", () => {
    expect(baseMarkupComMO(100, 34)).toBe(134);
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 0, previsto: baseMarkupComMO(100, 34), estimativa: 0 }).valor).toBe(134);
  });
  it("real tem precedência sobre previsto e também soma a M.O.", () => {
    expect(baseCustoPlanejamento({ confirmado: true, realServidor: baseMarkupComMO(90, 34), previsto: baseMarkupComMO(100, 34), estimativa: 0 }).valor).toBe(124);
  });
  it("sem custo a base é 0 (nunca só a M.O.)", () => {
    expect(baseMarkupComMO(0, 34)).toBe(0);
    expect(baseMarkupComMO(null, 34)).toBe(0);
  });
  it("o PlanejamentoDetail aplica o helper ao importado (previsto e real)", () => {
    const src = readFileSync("src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
    expect(src).toMatch(/draft\.origem === "importado"/);
    expect((src.match(/baseMarkupComMO\(/g) ?? []).length).toBe(2);
  });
});
