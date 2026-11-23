import { describe, it, expect } from "vitest";
import {
  TAMANHOS_GRADE_PADRAO,
  agruparInsumoGrade,
  blocosDoInsumo,
  normalizarEtiquetaGrade,
  normalizarTamanhosGrade,
  type GradeVarianteInsumo,
} from "@/components/insumo/grade/agruparInsumoGrade";

const v = (
  id: string,
  etiquetaId: string,
  corId: string | null,
  tamanho: string | null,
  preco: number | null = null,
): GradeVarianteInsumo => ({
  id,
  etiqueta_id: etiquetaId,
  cor_id: corId,
  tamanho,
  preco,
  created_at: "2026-01-01",
});

describe("agruparInsumoGrade (por etiqueta E por cor)", () => {
  it("agrupa por etiqueta e, dentro dela, por cor: 1 bloco por cor com os tamanhos marcados", () => {
    const mapa = agruparInsumoGrade([
      v("1", "E1", "azul", "34|PPP", 2),
      v("2", "E1", "azul", "36|PP", 2),
      v("3", "E1", "verde", "34|PPP", 3),
      v("4", "E2", "azul", null, 5),
      v("5", "E1", "azul", "38|P", 2),
    ]);
    expect([...mapa.keys()]).toEqual(["E1", "E2"]);
    expect(mapa.get("E1")).toEqual([
      { cor_id: "azul", preco: 2, tamanhos: ["34|PPP", "36|PP", "38|P"] },
      { cor_id: "verde", preco: 3, tamanhos: ["34|PPP"] },
    ]);
    expect(mapa.get("E2")).toEqual([{ cor_id: "azul", preco: 5, tamanhos: [] }]);
  });

  it("preserva a ordem de 1ª aparição das cores (a query ordena por created_at, id)", () => {
    const blocos = blocosDoInsumo([
      v("1", "E1", "verde", null),
      v("2", "E1", "azul", null),
      v("3", "E1", "verde", "40|M"),
    ]);
    expect(blocos.map((b) => b.cor_id)).toEqual(["verde", "azul"]);
  });

  it("variante sem tamanho = bloco só da cor (tamanhos vazio)", () => {
    expect(blocosDoInsumo([v("1", "E1", "azul", null, 4)])).toEqual([
      { cor_id: "azul", preco: 4, tamanhos: [] },
    ]);
  });

  it("variante sem cor vira o bloco '' (sem cor), separado das cores", () => {
    const blocos = blocosDoInsumo([
      v("1", "E1", null, "40|M", 1),
      v("2", "E1", "azul", "40|M", 2),
      v("3", "E1", null, "42|G", 1),
    ]);
    expect(blocos).toEqual([
      { cor_id: "", preco: 1, tamanhos: ["40|M", "42|G"] },
      { cor_id: "azul", preco: 2, tamanhos: ["40|M"] },
    ]);
  });

  it("preço da cor = o da 1ª variante; se ela não tem preço, o da 1ª que tiver (como o editor do Sheet)", () => {
    expect(
      blocosDoInsumo([v("1", "E1", "azul", "34|PPP", 7), v("2", "E1", "azul", "36|PP", 9)])[0]
        .preco,
    ).toBe(7);
    expect(
      blocosDoInsumo([v("1", "E1", "azul", "34|PPP", null), v("2", "E1", "azul", "36|PP", 9)])[0]
        .preco,
    ).toBe(9);
    expect(blocosDoInsumo([v("1", "E1", "azul", "34|PPP", null)])[0].preco).toBeNull();
  });

  it("não repete tamanho dentro da cor e ignora tamanho vazio", () => {
    const [b] = blocosDoInsumo([
      v("1", "E1", "azul", "40|M"),
      v("2", "E1", "azul", "40|M"),
      v("3", "E1", "azul", ""),
      v("4", "E1", "azul", null),
    ]);
    expect(b.tamanhos).toEqual(["40|M"]);
  });

  it("lista vazia gera Map vazio e etiqueta sem variante fica ausente", () => {
    const mapa = agruparInsumoGrade([]);
    expect(mapa.size).toBe(0);
    expect(mapa.get("E1")).toBeUndefined();
  });
});

describe("normalizarTamanhosGrade", () => {
  it("ausente, vazio ou não-array = o padrão da loja nova (cópia, não a constante)", () => {
    for (const raw of [null, undefined, [], "x", {}, 3]) {
      const r = normalizarTamanhosGrade(raw);
      expect(r).toEqual(["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"]);
      expect(r).not.toBe(TAMANHOS_GRADE_PADRAO);
    }
  });

  it("aceita string e objeto {nome|label} (formatos antigos)", () => {
    expect(normalizarTamanhosGrade(["34|PPP", { nome: "36|PP" }, { label: "38|P" }, 40])).toEqual([
      "34|PPP",
      "36|PP",
      "38|P",
      "40",
    ]);
  });
});

describe("normalizarEtiquetaGrade", () => {
  it("aplica os defaults da tela de Insumos (unidade 'unidade', formato 'ambos') e nulos", () => {
    expect(normalizarEtiquetaGrade({ id: "E1", nome: "Etiqueta" })).toEqual({
      id: "E1",
      nome: "Etiqueta",
      unidade: "unidade",
      preco: null,
      empresa_id: null,
      representante_id: null,
      observacoes: null,
      formato_tamanho: "ambos",
      tipo_insumo_id: null,
      tamanho_vinculado: null,
      created_at: "",
    });
  });

  it("mantém os valores gravados", () => {
    const r = normalizarEtiquetaGrade({
      id: "E1",
      nome: "Cartão",
      unidade: "milheiro",
      preco: 12.5,
      empresa_id: "emp1",
      representante_id: "rep1",
      observacoes: "obs",
      formato_tamanho: "nenhum",
      tipo_insumo_id: "tp1",
      tamanho_vinculado: "40|M",
      created_at: "2026-01-02",
    });
    expect(r).toMatchObject({
      unidade: "milheiro",
      preco: 12.5,
      formato_tamanho: "nenhum",
      tipo_insumo_id: "tp1",
      tamanho_vinculado: "40|M",
    });
  });
});
