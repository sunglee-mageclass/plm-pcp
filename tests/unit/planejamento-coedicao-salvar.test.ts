import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
const LINHAS = SRC.split("\n");

// ALLOWLIST EXATA: o mapa do overlay (`valorAoVivoPorPath`) só pode aparecer em 3 lugares —
// desestruturação do hook, chamada de aplicarCoedicao e array de deps do useEffect. Qualquer outro uso
// (spread no draft, alias, objeto literal, mutação multi-linha) falha o teste: o valor ao vivo do OUTRO
// nunca pode entrar no que o Salvar grava.
const USO_LEGITIMO = [/useCoedicaoAoVivo\(/, /aplicarCoedicao\(/, /\[locks, valorAoVivoPorPath/];

describe("Onda 3 — o overlay nunca contamina o Salvar", () => {
  const ocorrencias = LINHAS.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => l.includes("valorAoVivoPorPath"));

  it("o hook e o aplicarCoedicao estão fiados", () => {
    expect(SRC.includes("aplicarCoedicao(")).toBe(true);
    expect(SRC.includes("useCoedicaoAoVivo(")).toBe(true);
    expect(ocorrencias.length).toBe(3);
  });
  it("CADA ocorrência de valorAoVivoPorPath está numa linha da allowlist (desestruturação, chamada ou deps)", () => {
    for (const { l, n } of ocorrencias) {
      const ok = USO_LEGITIMO.some((re) => re.test(l)) || /^\s*const \{[^}]*valorAoVivoPorPath[^}]*\} = useCoedicaoAoVivo\(/.test(l);
      expect(ok, `linha ${n} usa valorAoVivoPorPath fora da allowlist: ${l.trim()}`).toBe(true);
    }
  });
  it("proíbe alias/objeto literal (valorAoVivoPorPath:) e spread/atribuição", () => {
    expect(/valorAoVivoPorPath\s*:/.test(SRC)).toBe(false);
    expect(/\.\.\.\s*valorAoVivoPorPath/.test(SRC)).toBe(false);
    expect(/valorAoVivoPorPath\s*\[/.test(SRC)).toBe(false);
  });
  it("a regra de allowlist realmente pega um uso indevido (auto-verificação)", () => {
    const indevida = "const x = {...draft, ...valorAoVivoPorPath};";
    expect(USO_LEGITIMO.some((re) => re.test(indevida))).toBe(false);
    expect(/\.\.\.\s*valorAoVivoPorPath/.test(indevida)).toBe(true);
  });
});
