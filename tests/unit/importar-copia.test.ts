import { describe, it, expect } from "vitest";
import { construirCopia, gradeAplicavel, type ModeloParaCopia, type Selecao } from "@/components/desenvolvimento/importar/importar-copia";
import { makeEmptyBlocks } from "@/components/desenvolvimento/modelo-detail/types";

function origemVazia(): ModeloParaCopia {
  return { observacoes_tecnicas: "", custos_adicionais: [], proporcoes: {}, blocks: makeEmptyBlocks(), aviamentos: [], etiquetas: [], grades: [] };
}
function selNada(): Selecao {
  return {
    obsTecnica: false,
    tecidos: { tecido: { artigo: false, consumo: false, variantes: false }, forro: { artigo: false, consumo: false, variantes: false }, entretela: { artigo: false, consumo: false, variantes: false } },
    aviamentos: false, etiquetas: false, grade: false, custosAdicionais: false,
  };
}

describe("construirCopia — escalares", () => {
  it("copia observações técnicas e custos adicionais quando marcados", () => {
    const origem = { ...origemVazia(), observacoes_tecnicas: "Pespontar 2mm", custos_adicionais: [{ descricao: "Lavanderia", valor: 3 }] };
    const sel = { ...selNada(), obsTecnica: true, custosAdicionais: true };
    const { patch, campos } = construirCopia(origem, makeEmptyBlocks(), sel);
    expect(patch.observacoes_tecnicas).toBe("Pespontar 2mm");
    expect(patch.custos_adicionais).toEqual([{ descricao: "Lavanderia", valor: 3 }]);
    expect(campos.has("obs_tecnicas")).toBe(true);
    expect(campos.has("custos_adicionais")).toBe(true);
  });

  it("não copia nada quando a seleção está vazia", () => {
    const { patch, campos } = construirCopia({ ...origemVazia(), observacoes_tecnicas: "X" }, makeEmptyBlocks(), selNada());
    expect(patch.observacoes_tecnicas).toBeUndefined();
    expect(campos.size).toBe(0);
  });
});
