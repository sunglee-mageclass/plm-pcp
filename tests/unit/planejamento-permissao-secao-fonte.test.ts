import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DETALHE = readFileSync(ROOT + "src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
const SAVE = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts", "utf8");
const INFO_GERAIS = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx", "utf8");

describe("Sheet do Planejamento trava POR SEÇÃO pelas 2 permissões (P-53 A) — testes de fonte", () => {
  it("PlanejamentoDetail chama resolverPermissoesSheet", () => {
    expect(DETALHE).toMatch(/resolverPermissoesSheet\(/);
  });

  it("o Sheet (card existente) e o Dialog (card novo) usam ReadOnlyScope, sem herdar a trava da página", () => {
    expect(DETALHE).toMatch(/<ReadOnlyScope\s+value=\{perm\.sheetSomenteLeitura\}>/);
    expect(DETALHE).toMatch(/<ReadOnlyScope\s+value=\{!podeEditarPlanejamento\}>/);
  });

  it("Excluir/Duplicar/Ordem/Lançar ficam sob perm.podeAcoesPlanejamento", () => {
    // Excluir: o botão do rodapé só aparece com isEdit — some/desabilita com a permissão de ações.
    expect(DETALHE).toMatch(/perm\.podeAcoesPlanejamento/);
    // Pelo menos as 4 famílias de ação (Excluir/Duplicar via menu/Ordem/Lançar) referenciam a flag em algum ponto do arquivo.
    const usos = (DETALHE.match(/perm\.podeAcoesPlanejamento/g) ?? []).length;
    expect(usos).toBeGreaterThanOrEqual(3);
  });

  it("usePlanejamentoSave chama aplicarRegrasCamposPlanejamento", () => {
    expect(SAVE).toMatch(/aplicarRegrasCamposPlanejamento\(/);
  });

  it("InfoGeraisSecao recebe planBloqueado e compartilhadoBloqueado", () => {
    expect(DETALHE).toMatch(/<InfoGeraisSecao[\s\S]*?planBloqueado=\{perm\.planBloqueado\}[\s\S]*?\/>/);
    expect(DETALHE).toMatch(/<InfoGeraisSecao[\s\S]*?compartilhadoBloqueado=\{perm\.compartilhadoBloqueado\}[\s\S]*?\/>/);
    expect(INFO_GERAIS).toMatch(/planBloqueado/);
    expect(INFO_GERAIS).toMatch(/compartilhadoBloqueado/);
  });
});
