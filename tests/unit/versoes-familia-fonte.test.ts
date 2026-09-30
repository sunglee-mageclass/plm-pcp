import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");

describe("P-152 — ligação dos componentes (fonte)", () => {
  for (const f of [
    "src/components/plan-tecido/ReplicarCardsDialog.tsx",
    "src/components/produto-acabado/ReplicarAcabadoDialog.tsx",
    "src/components/produto-importado/ReplicarImportadoDialog.tsx",
  ]) {
    it(`${f}: botão trava em !versoes.pronto e o destino entra no hook`, () => {
      const s = ler(f);
      expect(s).toMatch(/!versoes\.pronto/);
      expect(s).toMatch(/useVersoesFamilia\(modeloIds, open, destinoVersoes\)/);
    });
  }
  it("Duplicar: fetchQuery antes de iniciarDuplicar, botão trava, reset ao fechar, ignora se desmontou", () => {
    const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(s.indexOf("qc.fetchQuery")).toBeGreaterThan(-1);
    expect(s.indexOf("qc.fetchQuery")).toBeLessThan(s.indexOf("else iniciarDuplicar()"));
    expect(s).toMatch(/disabled=\{!versoesDup\.pronto\}/);
    expect(s).toMatch(/versoesDup\.reset\(\)/);
    expect(s).toMatch(/if \(!montadoRef\.current\) return;/);
  });
  it("invalida ['versoes-familia'] após replicar/duplicar", () => {
    for (const f of [
      "src/components/plan-tecido/PlanTecidoSheet.tsx",
      "src/components/produto-acabado/ProdutoAcabadoSheet.tsx",
      "src/components/produto-importado/ProdutoImportadoSheet.tsx",
      "src/components/planejamento/PlanejamentoDetail.tsx",
    ]) expect(ler(f)).toMatch(/invalidateQueries\(\{ queryKey: \["versoes-familia"\] \}\)/);
  });
  it("aviso usa fuso da loja e useId", () => {
    const s = ler("src/components/planejamento/VersoesExistentesAviso.tsx");
    expect(s).toMatch(/useStoreTimezone\(\)/);
    expect(s).toMatch(/fmtDataCriacao\(v\.created_at, tz\)/);
    expect(s).toMatch(/useId\(\)/);
  });
});
