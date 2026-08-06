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
  it("2 blocos mesmo rank (2× Oficina) → desempata por created_at (o mais antigo vence)", () => {
    const bOfi1 = { ...bloco("bOfi1", "cOfi", true), created_at: "2026-08-06T12:00:00Z" };
    const bOfi2 = { ...bloco("bOfi2", "cOfi", true), created_at: "2026-08-01T09:00:00Z" };
    // Ordem de entrada propositalmente "errada" (o mais novo primeiro) — o desempate
    // tem que ignorar a ordem do array e escolher pelo created_at, não pela posição.
    const r = resolverFonteConfeccao([bOfi1, bOfi2], cats);
    expect(r.fonteId).toBe("bOfi2");
    expect(r.ambiguo).toBe(true);
    expect(r.candidatos.sort()).toEqual(["bOfi1", "bOfi2"]);
  });
});
