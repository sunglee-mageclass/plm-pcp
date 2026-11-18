import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/components/planejamento/PlanejamentoDetail.tsx", "utf8");

describe("Onda 3 — o overlay nunca contamina o Salvar", () => {
  it("o payload do Salvar não lê valorAoVivoPorPath", () => {
    // Nenhuma construção de payload/draft pode referenciar o mapa do overlay.
    // (o overlay é aplicado no DOM via aplicarCoedicao, nunca lido para montar o que se grava.)
    const linhasDeSave = SRC.split("\n").filter((l) => /mutationFn|payload|salvar|setDraftTracked\(/.test(l));
    expect(linhasDeSave.some((l) => l.includes("valorAoVivoPorPath"))).toBe(false);
  });
  it("valorAoVivoPorPath só é usado dentro de aplicarCoedicao", () => {
    const usos = [...SRC.matchAll(/valorAoVivoPorPath/g)];
    // Deve aparecer pouquíssimas vezes e sempre perto de aplicarCoedicao.
    expect(SRC.includes("aplicarCoedicao(")).toBe(true);
    expect(usos.length).toBeGreaterThan(0);
    for (const m of usos) {
      const trecho = SRC.slice(Math.max(0, m.index! - 120), m.index! + 40);
      expect(/aplicarCoedicao|useCoedicaoAoVivo|const \{/.test(trecho)).toBe(true);
    }
  });
});
