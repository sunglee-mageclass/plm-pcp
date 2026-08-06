import { describe, it, expect } from "vitest";
import { resolverFonteConfeccao } from "@/lib/confeccao-fonte";

const cats = [
  { id: "cPL", nome: "PL" },
  { id: "cOfi", nome: "Oficina" },
  { id: "cBord", nome: "Bordado" },
];
const bloco = (id: string, cat: string, detalhado: boolean) => ({ id, categoria_terceirizado_id: cat, detalhado });

describe("resolverFonteConfeccao", () => {
  it("sem bloco destrinchado de confecção → fonte nula", () => {
    const r = resolverFonteConfeccao([bloco("b1", "cBord", true), bloco("b2", "cOfi", false)], cats);
    expect(r).toEqual({ fonteId: null, ambiguo: false, candidatos: [] });
  });
  it("um PL destrinchado → é a fonte", () => {
    const r = resolverFonteConfeccao([bloco("b1", "cPL", true)], cats);
    expect(r.fonteId).toBe("b1");
    expect(r.ambiguo).toBe(false);
  });
  it("default PL > Oficina quando ambos destrinchados (ambíguo, escolhe PL)", () => {
    const r = resolverFonteConfeccao([bloco("bOfi", "cOfi", true), bloco("bPL", "cPL", true)], cats);
    expect(r.fonteId).toBe("bPL");
    expect(r.ambiguo).toBe(true);
    expect(r.candidatos.sort()).toEqual(["bOfi", "bPL"]);
  });
  it("prioridade configurada sobrepõe o default (Oficina antes de PL)", () => {
    const r = resolverFonteConfeccao([bloco("bOfi", "cOfi", true), bloco("bPL", "cPL", true)], cats, ["cOfi", "cPL"]);
    expect(r.fonteId).toBe("bOfi");
  });
  it("Bordado destrinchado não conta (não é confecção)", () => {
    const r = resolverFonteConfeccao([bloco("bB", "cBord", true)], cats);
    expect(r.fonteId).toBeNull();
  });
});
