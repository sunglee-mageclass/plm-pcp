import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROTA = readFileSync(ROOT + "src/routes/_authenticated/criacao.desenvolvimento.tsx", "utf8");

// Histórico: 26/set (P-48 A) o Sheet antigo do Dev ficou OCULTO e o card abria o Sheet do Planejamento. 28/set (F5a,
// P-104 B ajustado + P-110 A) o card voltou a abrir o Sheet do Dev, SÓ PARA LEITURA. 05/out (R7, dono, P-48 A de volta):
// o card do kanban abre de novo o Sheet do Planejamento (único editor); o Sheet antigo só leitura fica OCULTO atrás da
// chave (não apagado — faxina depois). O que o Sheet só leitura faz/não faz segue provado em `f5-dev-somente-leitura*.test.ts`.
describe("Kanban do Desenvolvimento abre o Sheet do Planejamento (dono 05/out, R7 — P-48 A de volta)", () => {
  it("a chave existe e está desligada", () => {
    expect(ROTA).toContain("const SHEET_DEV_SOMENTE_LEITURA = false;");
    expect(ROTA).not.toContain("SHEET_DEV_ATIVO");
  });
  it("o card abre o PlanejamentoDetail (só com openId) e salvar refaz o quadro", () => {
    expect(ROTA).toMatch(/import \{ PlanejamentoDetail \} from "@\/components\/planejamento\/PlanejamentoDetail";/);
    expect(ROTA).toMatch(/openId && \(\s*<PlanejamentoDetail\s+modeloId=\{openId\}/);
    expect(ROTA).toMatch(/onSaved=\{invalidarQuadro\}/);
  });
  it("o Sheet antigo só leitura segue no código, OCULTO atrás da chave (não apagado)", () => {
    expect(ROTA).toMatch(/import \{ ModeloDetailPanel \} from "@\/components\/desenvolvimento\/ModeloDetailPanel";/);
    expect(ROTA).toMatch(/SHEET_DEV_SOMENTE_LEITURA \? \(\s*(\/\/[^\n]*\n\s*)*<ModeloDetailPanel modeloId=\{openId\} somenteLeitura /);
  });
  it("salvar/fechar o Sheet do Planejamento refaz o que o quadro lê", () => {
    // m4 (revisão da parte 1): recorta SÓ o corpo de `invalidarQuadro` — procurar no arquivo inteiro
    // daria falso-positivo com invalidações homônimas de outras funções.
    const inicio = ROTA.indexOf("const invalidarQuadro = () => {");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const fim = ROTA.indexOf("};", inicio);
    expect(fim).toBeGreaterThan(inicio);
    const corpo = ROTA.slice(inicio, fim);
    for (const k of ["modelos-desenvolvimento", "desenv-condicoes", "desenv-mo-resumo", "desenv-modelo-tecidos", "modelos-planejamento"])
      expect(corpo).toContain(`qc.invalidateQueries({ queryKey: ["${k}"] });`);
  });
});
