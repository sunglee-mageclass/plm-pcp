import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROTA = readFileSync(ROOT + "src/routes/_authenticated/criacao.desenvolvimento.tsx", "utf8");

// Histórico: 26/set (P-48 A) o Sheet antigo do Dev ficou OCULTO e o card abria o Sheet do Planejamento. 28/set (F5a,
// P-104 B ajustado + P-110 A) o card volta a abrir o Sheet do Dev, mas SÓ PARA LEITURA (o comportamento de 26/set
// fica guardado atrás da chave). O que o Sheet só leitura faz/não faz é provado em `f5-dev-somente-leitura.test.ts`.
describe("Kanban do Desenvolvimento abre o Sheet do Dev SÓ LEITURA (dono 28/set, F5a — P-104/P-110)", () => {
  it("a chave existe e está ligada", () => {
    expect(ROTA).toContain("const SHEET_DEV_SOMENTE_LEITURA = true;");
    expect(ROTA).not.toContain("SHEET_DEV_ATIVO");
  });
  it("o card abre o ModeloDetailPanel com somenteLeitura", () => {
    expect(ROTA).toMatch(/import \{ ModeloDetailPanel \} from "@\/components\/desenvolvimento\/ModeloDetailPanel";/);
    expect(ROTA).toMatch(/SHEET_DEV_SOMENTE_LEITURA \? \(\s*(\/\/[^\n]*\n\s*)*<ModeloDetailPanel modeloId=\{openId\} somenteLeitura /);
  });
  it("o caminho de 26/set (Sheet do Planejamento por cima do kanban) continua no código, só atrás da chave", () => {
    expect(ROTA).toMatch(/import \{ PlanejamentoDetail \} from "@\/components\/planejamento\/PlanejamentoDetail";/);
    expect(ROTA).toMatch(/openId && \(\s*<PlanejamentoDetail\s+modeloId=\{openId\}/);
    expect(ROTA).toMatch(/onSaved=\{invalidarQuadro\}/);
  });
  it("salvar/fechar pelo caminho guardado refaz o que o quadro lê", () => {
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
