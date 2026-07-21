import { describe, it, expect } from "vitest";
import { construirCopia, gradeAplicavel, type ModeloParaCopia, type Selecao } from "@/components/desenvolvimento/importar/importar-copia";
import type { AviamentoRow, GradeRow, ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";
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

describe("construirCopia — listas e grade", () => {
  it("copia aviamentos e etiquetas sem id (novos)", () => {
    const av: AviamentoRow = { id: "a1", aviamento_id: "AV", consumo: 2, loss_percent: 0, custo_previsto: 4 };
    const et: ModeloEtiquetaRow = { id: "e1", etiqueta_id: "ET", cor_id: "C", consumo: 1, loss_percent: 0, custo_previsto: 1 };
    const origem = { ...origemVazia(), aviamentos: [av], etiquetas: [et] };
    const sel = { ...selNada(), aviamentos: true, etiquetas: true };
    const { patch, campos } = construirCopia(origem, makeEmptyBlocks(), sel);
    expect(patch.aviamentos).toEqual([{ aviamento_id: "AV", consumo: 2, loss_percent: 0, custo_previsto: 4 }]);
    expect(patch.etiquetas).toEqual([{ etiqueta_id: "ET", cor_id: "C", consumo: 1, loss_percent: 0, custo_previsto: 1 }]);
    expect(campos.has("aviamentos")).toBe(true);
    expect(campos.has("etiquetas")).toBe(true);
  });

  it("só copia grade+proporções quando há variantes de tecido selecionadas", () => {
    const g: GradeRow = { variante_numero: 1, grades: { P: 2, M: 3 }, grade_total: 5 };
    const origem = { ...origemVazia(), grades: [g], proporcoes: { P: 40, M: 60 } };
    // grade marcada mas SEM variantes → não aplica
    const semVar = construirCopia(origem, makeEmptyBlocks(), { ...selNada(), grade: true });
    expect(semVar.patch.grades).toBeUndefined();
    expect(semVar.patch.proporcoes).toBeUndefined();
    // com variantes do Tecido → aplica
    const sel = { ...selNada(), grade: true };
    sel.tecidos.tecido.variantes = true;
    const comVar = construirCopia(origem, makeEmptyBlocks(), sel);
    expect(comVar.patch.grades).toEqual([g]);
    expect(comVar.patch.proporcoes).toEqual({ P: 40, M: 60 });
    expect(comVar.campos.has("grade")).toBe(true);
  });
});

function blocoTecido1(over: Partial<import("@/components/desenvolvimento/modelo-detail/types").TecidoBlock>) {
  const bs = makeEmptyBlocks();
  const i = bs.findIndex((b) => b.tipo === "tecido" && b.numero === 1);
  bs[i] = { ...bs[i], ...over };
  return bs;
}

describe("construirCopia — blocos de tecido", () => {
  it("copia só os itens marcados do Tecido 1 e zera oc_links das variantes", () => {
    const origemBlocks = blocoTecido1({
      artigo_id: "ART", artigoIdsExtra: ["SUB"], consumo: 1.5, loss_percent: 5,
      variantes: ["V1", "V2", ...Array(8).fill(null)],
      multiplicadores: [1, 2, ...Array(8).fill(1)],
      oc_links: Array.from({ length: 10 }, (_, i) => (i < 2 ? [{ oc_tecido_item_id: "OC", quantidade_m: 3, prioridade: 1 }] : [])),
    });
    const origem = { ...origemVazia(), blocks: origemBlocks };
    const sel = { ...selNada() };
    sel.tecidos.tecido = { artigo: true, consumo: false, variantes: true };

    const { patch, campos } = construirCopia(origem, makeEmptyBlocks(), sel);
    const t1 = patch.blocks!.find((b) => b.tipo === "tecido" && b.numero === 1)!;
    expect(t1.artigo_id).toBe("ART");
    expect(t1.artigoIdsExtra).toEqual(["SUB"]);
    expect(t1.consumo).toBe(0); // consumo NÃO marcado → mantém destino (0)
    expect(t1.variantes.slice(0, 2)).toEqual(["V1", "V2"]);
    expect(t1.oc_links.every((l) => l.length === 0)).toBe(true); // oc-links zerados
    expect(campos.has("tecido:tecido:1:artigo")).toBe(true);
    expect(campos.has("tecido:tecido:1:variantes")).toBe(true);
    expect(campos.has("tecido:tecido:1:consumo")).toBe(false);
  });
});
