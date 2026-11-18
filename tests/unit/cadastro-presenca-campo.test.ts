// Realtime Onda 2 / Task 2 — Cadastros editáveis ganham o anel "quem edita o quê".
// Teste de FONTE: cada tela instrumentada monta a presença de página com canal POR LOJA (tenantId no
// nome — segurança), o overlay do anel e o PAR focus/blur (sem o onBlurCapture o anel GRUDA).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const telas = [
  "src/routes/_authenticated/cadastro.atributos.tsx",
  "src/routes/_authenticated/cadastro.colaboradores.tsx",
  "src/routes/_authenticated/cadastro.servico.tsx",
  "src/routes/_authenticated/cadastro.aviamentos.tsx",
  "src/routes/_authenticated/cadastro.etiquetas.tsx",
  "src/routes/_authenticated/cadastro.lojas.tsx",
];

describe("Cadastros: presença de campo", () => {
  for (const t of telas) {
    const src = readFileSync(t, "utf8");
    it(`${t} monta presença de página com canal por tenant`, () => {
      expect(src).toMatch(/useColabPresencaPagina/);
      expect(src).toMatch(/colab-canvas:cad-[a-z]+[^`]*\$\{tenantId\}/); // canal único da tela, leva o tenant
      expect(src).toMatch(/<ColabPresenceOverlay /);
    });
    it(`${t} limpa o foco no blur (senão o anel gruda)`, () => {
      expect(src).toMatch(/onFocusCapture(=|:)/);
      expect(src).toMatch(/onBlurCapture(=\{|: )\(\) => setCampoFocado\(null\)/);
    });
  }

  it("canais são únicos por tela", () => {
    const nomes = telas.map((t) => /colab-canvas:(cad-[a-z]+)/.exec(readFileSync(t, "utf8"))?.[1]);
    expect(new Set(nomes).size).toBe(telas.length);
    expect(nomes.every(Boolean)).toBe(true);
  });
});
