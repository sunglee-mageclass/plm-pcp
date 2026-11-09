import { describe, it, expect } from "vitest";
import { estLivre } from "@/lib/plan-tecido/calc";

describe("estLivre", () => {
  it("físico + a-chegar − reserva de outras", () => {
    expect(estLivre({ fisico_m: 0, prev_receb_m: 1170, reserva_outras_m: 641.6 })).toBeCloseTo(528.4, 1);
  });
  it("sem reserva de outras: físico + a-chegar puro", () => {
    expect(estLivre({ fisico_m: 100, prev_receb_m: 50, reserva_outras_m: 0 })).toBe(150);
  });
  it("clampa em 0 quando a reserva de outras supera o disponível", () => {
    expect(estLivre({ fisico_m: 0, prev_receb_m: 100, reserva_outras_m: 300 })).toBe(0);
  });
});
