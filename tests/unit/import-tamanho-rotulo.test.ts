import { describe, it, expect } from "vitest";
import { rotuloTamanho } from "@/lib/import/entities/insumo.descriptor";

// Bug #3: o rótulo do tamanho na tabela de análise mostrava sempre o NÚMERO (split "|"[0]),
// mesmo quando o insumo é formato "letra" e o usuário digitou a sigla. Agora respeita o formato.
describe("rotuloTamanho — rótulo do tamanho conforme formato", () => {
  it("formato letra → mostra a SIGLA", () => {
    expect(rotuloTamanho("34|PPP", "letra")).toBe("PPP");
    expect(rotuloTamanho("40|M", "letra")).toBe("M");
  });

  it("formato numero → mostra o NÚMERO", () => {
    expect(rotuloTamanho("34|PPP", "numero")).toBe("34");
    expect(rotuloTamanho("40|M", "numero")).toBe("40");
  });

  it("formato ambos → mostra 'num · sigla'", () => {
    expect(rotuloTamanho("34|PPP", "ambos")).toBe("34 · PPP");
  });

  it("formato desconhecido cai em 'ambos'", () => {
    expect(rotuloTamanho("34|PPP", "qualquer")).toBe("34 · PPP");
  });

  it("chave sem sigla + formato letra → cai no número (não quebra)", () => {
    expect(rotuloTamanho("34|", "letra")).toBe("34");
    expect(rotuloTamanho("34", "letra")).toBe("34");
  });

  it("chave sem número + formato numero → cai na sigla", () => {
    expect(rotuloTamanho("|PPP", "numero")).toBe("PPP");
  });

  it("null (sem tamanho) → '—'", () => {
    expect(rotuloTamanho(null, "letra")).toBe("—");
    expect(rotuloTamanho(null, "ambos")).toBe("—");
  });
});
