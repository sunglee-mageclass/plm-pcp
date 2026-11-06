import { describe, it, expect } from "vitest";
import { statusEfetivoDaVaga, modelosReprovadosDeVagas } from "@/lib/plan-tecido/calc";
import type { PtSlot } from "@/lib/plan-tecido/types";

const vaga = (over: Partial<PtSlot>): PtSlot => ({ modelo_id: null, materiais: [], ...over });

describe("statusEfetivoDaVaga", () => {
  it("sem card: usa o status da vaga", () => {
    expect(statusEfetivoDaVaga(vaga({ status: "reprovado" }), false)).toBe("reprovado");
    expect(statusEfetivoDaVaga(vaga({ status: "pendente" }), false)).toBe("pendente");
    expect(statusEfetivoDaVaga(vaga({ status: null }), false)).toBe("pendente"); // default
    expect(statusEfetivoDaVaga(vaga({}), false)).toBe("pendente"); // sem a chave = pendente
  });
  it("com card: DERIVA do card, ignora o status da vaga", () => {
    const s = vaga({ modelo_id: "m1", status: "pendente" });
    expect(statusEfetivoDaVaga(s, true)).toBe("reprovado"); // card reprovado manda
    expect(statusEfetivoDaVaga(vaga({ modelo_id: "m1", status: "reprovado" }), false)).toBe("pendente"); // card nao reprovado manda
  });
});

describe("modelosReprovadosDeVagas", () => {
  it("transicao vaga->card: so os criados de vaga reprovada herdam reprovado", () => {
    const criados = [
      { slot_id: "s1", modelo_id: "m1" },
      { slot_id: "s2", modelo_id: "m2" },
    ];
    const statusPorSlot = { s1: "reprovado" as const, s2: "pendente" as const };
    expect(modelosReprovadosDeVagas(criados, statusPorSlot)).toEqual(["m1"]);
  });
  it("slot sem status conhecido nao herda reprovado", () => {
    const criados = [{ slot_id: "s1", modelo_id: "m1" }];
    expect(modelosReprovadosDeVagas(criados, {})).toEqual([]);
    expect(modelosReprovadosDeVagas(criados, { s1: null })).toEqual([]);
  });
});
