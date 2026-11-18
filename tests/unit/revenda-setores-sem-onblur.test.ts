// Salvar por card da revenda (Task 3) — os 4 campos de preço/markup do Sheet viram só RASCUNHO: o blur não grava (o Salvar do Sheet grava).
// Teste de FONTE (fallback aceito no brief): o comportamento "não grava no onBlur" é exatamente a ausência das chamadas .mutate no componente.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const setores = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/RevendaSetores.tsx", "utf8");
const detail = readFileSync(ROOT + "src/components/planejamento/PlanejamentoDetail.tsx", "utf8");

describe("RevendaSetores — campos de preço/markup só rascunho", () => {
  it("editar markup/preço e sair do campo NÃO grava (sem onBlur→mutate)", () => {
    expect(setores).not.toContain("salvarMarkupsRevenda.mutate");
    expect(setores).not.toContain("salvarPrecosFixoRevenda.mutate");
    expect(setores).not.toMatch(/onBlur=/);
  });

  it("os 4 campos mantêm onChange (rascunho) e Enter→blur, e a trava sem isPending de mutation por campo", () => {
    for (const setter of ["setMarkupAtacadoInput", "setMarkupVarejoInput", "setPrecoAtacadoDraft", "setPrecoVarejoDraft"]) {
      expect(setores).toMatch(new RegExp(`onChange=\\{\\(e\\) => ${setter}\\(`));
    }
    expect(setores).not.toContain("salvarMarkupsRevenda");
    expect(setores).toContain("disabled={planBloqueado || !podeEditarPrecoComprado || travaVarejo}");
    expect(setores).toContain("disabled={planBloqueado || !podeEditarPrecoComprado}");
  });

  it("o rascunho da revenda entra no dirty do Sheet (revendaDirty derivado do mesmo ref/helper do Salvar)", () => {
    expect(detail).toMatch(/const revendaDirty = \(\(\) => \{[\s\S]*revendaSaveRef\.current;[\s\S]*if \(!s\) return false;[\s\S]*payloadRevendaParaSalvar\([\s\S]*travaIntegracao\.has\("preco_venda"\)[\s\S]*return !!\(p\.markups \|\| p\.fixos\);/);
    expect(detail).toMatch(/const dirty = [^\n]*\|\| revendaDirty \|\| pt\.dirty;/);
    // revendaDirty/travaIntegracao precisam estar declarados ANTES do `dirty` (TDZ).
    expect(detail.indexOf("const travaIntegracao = ")).toBeLessThan(detail.indexOf("const dirty = "));
    expect(detail.indexOf("const revendaDirty = ")).toBeLessThan(detail.indexOf("const dirty = "));
  });
});
