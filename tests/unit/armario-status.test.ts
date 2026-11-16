import { describe, it, expect } from "vitest";
import { transicaoValida, armarioTravado, type ArmarioStatus } from "@/lib/armario/status";

describe("transicaoValida", () => {
  it.each([
    ["rascunho", "pronto"],
    ["pronto", "rascunho"],
    ["pronto", "publicado"],
    ["publicado", "pronto"],
  ] as [ArmarioStatus, ArmarioStatus][])("%s -> %s válida", (de, para) => {
    expect(transicaoValida(de, para)).toBe(true);
  });
  it.each([
    ["rascunho", "publicado"],
    ["publicado", "rascunho"],
    ["rascunho", "rascunho"],
    ["pronto", "pronto"],
    ["publicado", "publicado"],
  ] as [ArmarioStatus, ArmarioStatus][])("%s -> %s inválida", (de, para) => {
    expect(transicaoValida(de, para)).toBe(false);
  });
});

describe("armarioTravado", () => {
  it("só publicado trava", () => {
    expect(armarioTravado("publicado")).toBe(true);
    expect(armarioTravado("pronto")).toBe(false);
    expect(armarioTravado("rascunho")).toBe(false);
  });
});
