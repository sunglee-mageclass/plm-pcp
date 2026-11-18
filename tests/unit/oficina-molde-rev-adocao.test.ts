import { describe, it, expect } from "vitest";
import { decidirAdocaoMolde } from "@/lib/oficina-molde-rev";

const base = { revBase: 3, moldeBase: "A" };
describe("Oficina: decisao de adocao do molde (rev sobe por outro campo do CAD nao e conflito)", () => {
  it("rev nao subiu (ou eco do meu save) -> nada", () => {
    expect(decidirAdocaoMolde({ ...base, srvRev: 3, srvMolde: "A", moldeForm: "A" })).toBe("nada");
    expect(decidirAdocaoMolde({ ...base, srvRev: 2, srvMolde: "A", moldeForm: "A" })).toBe("nada");
    expect(decidirAdocaoMolde({ ...base, srvRev: null, srvMolde: "A", moldeForm: "A" })).toBe("nada");
  });
  it("F1: rev subiu por OUTRO campo (molde do servidor == base) com molde editado -> so avanca o rev, mantem o texto", () => {
    expect(decidirAdocaoMolde({ ...base, srvRev: 5, srvMolde: "A", moldeForm: "A digitado" })).toBe("avancar_rev");
  });
  it("rev subiu por outro campo e molde nao editado -> avanca o rev", () => {
    expect(decidirAdocaoMolde({ ...base, srvRev: 5, srvMolde: "A", moldeForm: "A" })).toBe("avancar_rev");
  });
  it("outra pessoa mudou o molde e eu NAO editei -> adota o do servidor", () => {
    expect(decidirAdocaoMolde({ ...base, srvRev: 4, srvMolde: "B", moldeForm: "A" })).toBe("adotar");
  });
  it("outra pessoa mudou o molde e eu editei -> conflito real: segura o rev antigo", () => {
    expect(decidirAdocaoMolde({ ...base, srvRev: 4, srvMolde: "B", moldeForm: "A digitado" })).toBe("nada");
  });
  it("sem rev de base (null) e rev do servidor presente -> avalia pelo molde", () => {
    expect(decidirAdocaoMolde({ revBase: null, moldeBase: "A", srvRev: 1, srvMolde: "B", moldeForm: "A" })).toBe("adotar");
  });
});
