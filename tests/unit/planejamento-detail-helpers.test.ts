import { describe, it, expect } from "vitest";
import {
  rotuloConflitoPlan,
  limparCustoSim,
  invalidarAposAprovarMO,
} from "@/components/planejamento/planejamento-detail/helpers";

// F3.0 (set/2026) — trava o comportamento dos helpers do detalhe do Planejamento, que saíram de
// dentro de PlanejamentoDetail.tsx. Nada aqui muda regra: é a foto do comportamento de hoje.

describe("rotuloConflitoPlan", () => {
  it("devolve o rótulo PT dos campos conhecidos do Draft", () => {
    expect(rotuloConflitoPlan("nome")).toBe("Nome do Modelo");
    expect(rotuloConflitoPlan("preco_venda")).toBe("Preço para venda");
    expect(rotuloConflitoPlan("custo_simulado")).toBe("Simulação de custo");
    expect(rotuloConflitoPlan("tecidos_planejados")).toBe("Tecido Planejado");
  });
  it("cai no próprio path quando não há rótulo", () => {
    expect(rotuloConflitoPlan("campo_inexistente")).toBe("campo_inexistente");
  });
});

describe("limparCustoSim", () => {
  it("null, undefined e objeto vazio viram null", () => {
    expect(limparCustoSim(null)).toBeNull();
    expect(limparCustoSim(undefined)).toBeNull();
    expect(limparCustoSim({})).toBeNull();
  });
  it("zero, negativo e não-número viram null (tudo null → null)", () => {
    expect(limparCustoSim({ consumo_tecido: 0, aviamento: -1, mao_obra: Number.NaN })).toBeNull();
  });
  it("mantém só valores > 0 e descarta preco_tecido_m", () => {
    expect(limparCustoSim({ consumo_tecido: 1.2, aviamento: 0, mao_obra: 10, preco_tecido_m: 30 }))
      .toEqual({ consumo_tecido: 1.2, aviamento: null, mao_obra: 10 });
  });
  it("aceita número em texto", () => {
    expect(limparCustoSim({ aviamento: "4.5" } as any))
      .toEqual({ consumo_tecido: null, aviamento: 4.5, mao_obra: null });
  });
});

describe("invalidarAposAprovarMO", () => {
  it("invalida exatamente estas 7 queryKeys, nesta ordem", () => {
    const chamadas: unknown[] = [];
    const qc = { invalidateQueries: (o: { queryKey: unknown }) => { chamadas.push(o.queryKey); } };
    invalidarAposAprovarMO(qc as any, "m1");
    expect(chamadas).toEqual([
      ["modelo", "m1"],
      ["mo-resumo", "m1"],
      ["plan-custo-unit", "m1"],
      ["modelos-planejamento"],
      ["mo-resumo-list"],
      ["modelo-mo-resumo"],
      ["modelos-desenvolvimento"],
    ]);
  });
});
