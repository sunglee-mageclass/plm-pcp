import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROTA = readFileSync(ROOT + "src/routes/_authenticated/criacao.desenvolvimento.tsx", "utf8");

describe("Sheet do Desenvolvimento OCULTO — o kanban abre o Sheet do Planejamento (dono 26/set, P-48 A)", () => {
  it("a chave existe e está desligada", () => {
    expect(ROTA).toContain("const SHEET_DEV_ATIVO = false;");
  });
  it("o card abre o PlanejamentoDetail, montado só com openId (senão abriria o Dialog de Novo)", () => {
    expect(ROTA).toMatch(/import \{ PlanejamentoDetail \} from "@\/components\/planejamento\/PlanejamentoDetail";/);
    expect(ROTA).toMatch(/openId && \(\s*<PlanejamentoDetail\s+modeloId=\{openId\}/);
    expect(ROTA).toMatch(/onSaved=\{invalidarQuadro\}/);
  });
  it("salvar/fechar refaz o que o quadro lê", () => {
    for (const k of ["modelos-desenvolvimento", "desenv-condicoes", "desenv-mo-resumo", "desenv-modelo-tecidos", "modelos-planejamento"])
      expect(ROTA).toContain(`qc.invalidateQueries({ queryKey: ["${k}"] });`);
  });
  it("o Sheet antigo continua no código, só atrás da chave (nada apagado)", () => {
    expect(ROTA).toMatch(/import \{ ModeloDetailPanel \} from "@\/components\/desenvolvimento\/ModeloDetailPanel";/);
    expect(ROTA).toMatch(/SHEET_DEV_ATIVO \? \(\s*<ModeloDetailPanel/);
  });
});
