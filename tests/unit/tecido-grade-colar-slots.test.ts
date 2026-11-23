// "Linhas" da grade de Tecidos na ordem da tela (colar do Excel), com a linha-PAI de cada tecido (Task 12): o cabeçalho só vale na linha-pai,
// a cor só nos campos da cor.
import { describe, it, expect } from "vitest";
import { montarSlots, recusaDoSlot } from "@/lib/tecido-grade/colar-slots";
import type { TecidoNovo } from "@/lib/tecido-grade/linha-nova";

const L = (artigoId: string, variantId: string | null) => ({ chave: `${artigoId}:${variantId ?? "sem-cor"}`, artigoId, variantId });

describe("montarSlots com linha-pai", () => {
  it("tecido COM cores: a linha-pai (chave do 'sem cor') vem antes das cores; tecido SEM cor: a única linha já é a pai", () => {
    const slots = montarSlots([L("a1", "v1"), L("a1", "v2"), L("a2", null)], []);
    expect(slots.map((s) => [s.chave, s.tipo === "existente" && s.pai])).toEqual([
      ["a1:sem-cor", true],
      ["a1:v1", false],
      ["a1:v2", false],
      ["a2:sem-cor", true],
    ]);
  });

  it("cor nova de tecido existente entra depois das cores dele (e antes do próximo tecido)", () => {
    const novo = { tmp: "g1", artigoAlvoId: "a1", cab: {}, categoriaIds: [], subPorCat: {}, vars: [{ tmp: "n1" }] } as unknown as TecidoNovo;
    const slots = montarSlots([L("a1", "v1"), L("a2", null)], [novo]);
    expect(slots.map((s) => s.chave)).toEqual(["a1:sem-cor", "a1:v1", "novo:n1", "a2:sem-cor"]);
  });
});

describe("recusaDoSlot: cabeçalho só na linha-pai, cor só nas cores", () => {
  const [paiComCores, cor, paiSemCor] = [
    ...montarSlots([L("a1", "v1")], []),
    ...montarSlots([L("a2", null)], []),
  ];
  it("cabeçalho colado numa linha de cor é recusado; na linha-pai passa", () => {
    expect(recusaDoSlot(cor, { escopo: "artigo" })).toContain("Cabeçalho do tecido");
    expect(recusaDoSlot(paiComCores, { escopo: "artigo" })).toBeNull();
    expect(recusaDoSlot(paiSemCor, { escopo: "artigo" })).toBeNull();
  });
  it("campo de cor na linha-pai é recusado (com cores: 'cole na linha da cor'; sem cores: 'use o +'); na cor passa", () => {
    expect(recusaDoSlot(paiComCores, { escopo: "variante" })).toContain("linha da cor");
    expect(recusaDoSlot(paiSemCor, { escopo: "variante" })).toContain("não tem cores");
    expect(recusaDoSlot(cor, { escopo: "variante" })).toBeNull();
  });
});
