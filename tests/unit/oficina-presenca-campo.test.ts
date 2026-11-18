import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/routes/_authenticated/pcp.oficina.$modeloId.tsx", "utf8");

describe("Oficina: anel de presença de campo", () => {
  it("monta ColabPresenceOverlay com presentes do colab", () => {
    expect(src).toMatch(/ColabPresenceOverlay/);
    expect(src).toMatch(/presentes=\{presentes\}/);
  });

  it("marca o campo do molde (e demais) com data-colab-path", () => {
    expect(src).toMatch(/data-colab-path=/);
  });

  it("passa campoFocado ao useColabRegistro", () => {
    expect(src).toMatch(/campoFocado/);
  });
});
