import { describe, it, expect } from "vitest";
import { baseCustoPlanejamento, previstoDaFicha } from "@/components/planejamento/planejamento-detail/custo-base";
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
