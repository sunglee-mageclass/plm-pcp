import { describe, it, expect } from "vitest";
import { makeEmptyBlocks } from "@/components/desenvolvimento/modelo-detail/types";
import { camposDoPatchNoDraft, itensSobrescritos, patchCadDoImport } from "@/components/planejamento/planejamento-detail/ficha/importar-ficha";

// F3.3 — Importar dados no Sheet unificado: o que vai para o Draft e o que o AlertDialog avisa que será substituído
// (porta de ModeloDetailPanel.tsx:2329-2332 e :2357-2377).
const vazio = { observacoesTecnicas: "", custosAdicionais: [], proporcoes: {}, blocks: makeEmptyBlocks(), aviamentos: [], etiquetas: [], grades: [] };

describe("camposDoPatchNoDraft", () => {
  it("só as 3 colunas do modelo que o Importar traz", () => {
    expect(camposDoPatchNoDraft({ observacoes_tecnicas: "x", proporcoes: { P: 1 }, aviamentos: [] })).toEqual({ observacoes_tecnicas: "x", proporcoes: { P: 1 } });
  });
});

describe("itensSobrescritos", () => {
  it("destino vazio ⇒ nada a confirmar", () => {
    expect(itensSobrescritos({ observacoes_tecnicas: "x", grades: [], aviamentos: [] }, vazio, false)).toEqual([]);
  });
  it("lista o que já tem valor e será substituído (+ Observações do bloco)", () => {
    const blocks = makeEmptyBlocks().map((b) => (b.tipo === "tecido" && b.numero === 1 ? { ...b, artigo_id: "a", consumo: 1, variantes: ["v", ...Array(9).fill(null)] } : b));
    const atual = {
      ...vazio, observacoesTecnicas: "tem", custosAdicionais: [{ descricao: "x", valor: 1 }], proporcoes: { P: 1 }, blocks,
      aviamentos: [{ aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      etiquetas: [{ etiqueta_id: "e", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      grades: [{ variante_numero: 1, grades: {}, grade_total: 5 }],
    };
    const novos = makeEmptyBlocks().map((b) => (b.tipo === "tecido" && b.numero === 1 ? { ...b, artigo_id: "b" } : b));
    expect(itensSobrescritos({
      observacoes_tecnicas: "n", custos_adicionais: [], proporcoes: {}, grades: [], aviamentos: [], etiquetas: [], blocks: novos,
    }, atual, true)).toEqual(["Observações técnicas", "Custos adicionais", "Proporções", "Grade", "Aviamentos", "Insumos/Etiquetas", "Tecido 1", "Observações (bloco)"]);
  });
});

// Fix pós-rebase (item 4) — o Importar leva ao CAD só os CAMPOS marcados de cada bloco.
describe("patchCadDoImport", () => {
  const b = { tipo: "forro", numero: 1, consumo: 1.2, loss_percent: 5, artigo_id: "art-x" } as const;
  it("só `:artigo` ⇒ só o artigo (consumo/%loss do CAD intactos)", () => {
    expect(patchCadDoImport(b, new Set(["tecido:forro:1:artigo"]))).toEqual({ artigo_id: "art-x" });
  });
  it("só `:consumo` ⇒ consumo E %loss, sem artigo", () => {
    expect(patchCadDoImport(b, new Set(["tecido:forro:1:consumo"]))).toEqual({ consumo: 1.2, loss_percent: 5 });
  });
  it("só `:variantes` ⇒ sem patch (as variantes seguem pelo sincronizarCadComBlocos)", () => {
    expect(patchCadDoImport(b, new Set(["tecido:forro:1:variantes"]))).toBeNull();
  });
  it("`:artigo` + `:consumo` ⇒ os três; chave de OUTRO bloco não conta", () => {
    expect(patchCadDoImport(b, new Set(["tecido:forro:1:artigo", "tecido:forro:1:consumo"]))).toEqual({ artigo_id: "art-x", consumo: 1.2, loss_percent: 5 });
    expect(patchCadDoImport(b, new Set(["tecido:tecido:1:consumo", "tecido:forro:2:artigo"]))).toBeNull();
  });
});
