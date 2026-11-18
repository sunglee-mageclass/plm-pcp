// Realtime Onda 2 / Task 3 — telas de LISTA de negócio com campo editável inline ganham o anel de presença.
// Teste de FONTE. Ficam FORA (sem edição inline de campo; só filtro/mover card/abrir Sheet com Salvar):
// otb.index, expedicao.lancamentos, pcp.etapas, criacao.armario(+ArmarioListPage), criacao.desenvolvimento.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const telas = ["src/routes/_authenticated/financeiro.tsx"];

for (const t of telas) {
  describe(t, () => {
    const src = readFileSync(t, "utf8");
    it("tem presença de campo com canal por tenant", () => {
      expect(src).toMatch(/useColabPresencaPagina/);
      expect(src).toMatch(/ColabPresenceOverlay/);
      expect(src).toMatch(/colab-canvas:[a-z-]+:\$\{/);
    });
    it("tem o PAR onFocusCapture + onBlurCapture com guarda contains", () => {
      expect(src).toMatch(/onFocusCapture/);
      expect(src).toMatch(/onBlurCapture=\{\(\) => setCampoFocado\(null\)\}/);
      expect(src).toMatch(/scope\.contains\(alvo\)/);
    });
  });
}

describe("financeiro: vencimento inline carrega data-colab-path por linha", () => {
  it("VencimentoCell repassa colabPath ao DateField", () => {
    const c = readFileSync("src/components/financeiro/VencimentoCell.tsx", "utf8");
    expect(c).toMatch(/data-colab-path=\{colabPath\}/);
  });
});
