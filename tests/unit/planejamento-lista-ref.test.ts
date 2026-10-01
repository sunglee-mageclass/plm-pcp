import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// kanban #19 — a lista do Planejamento mostra só a REF oficial (`ref`), nunca a provisória (`ref_auto`);
// a busca pela lupa continua casando por `ref_auto`.
describe("Planejamento: lista × REF provisória", () => {
  const s = readFileSync("src/routes/_authenticated/criacao.planejamento.tsx", "utf8");
  it("o card recebe só `ref`", () => {
    expect(s).toMatch(/refModelo=\{\(m as any\)\.ref \|\| null\}/);
    expect(s).not.toMatch(/refModelo=\{[^}]*ref_auto/);
  });
  it("a busca por ref_auto permanece", () => {
    expect(s).toMatch(/\(m\.ref_auto \?\? ""\)\.toLowerCase\(\)\.includes\(q\)/);
  });
});
