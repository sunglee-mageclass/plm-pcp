/* eslint-disable @typescript-eslint/no-explicit-any -- resolver de rótulos de teste */
// Mapeamento puro das células e ordenação por GRUPO da grade de Aviamentos.
import { describe, it, expect } from "vitest";
import { COLUNAS_AVIAMENTO, byKey } from "@/lib/aviamento-grade/colunas";
import {
  CAMPO_AVIAMENTO,
  CAMPO_VARIANTE,
  controleDaCelula,
  ehTextoLongo,
  empresasParaLinha,
  opcoesDaColuna,
  permiteVazio,
  subcategoriaAposTrocarCategoria,
  type OpcoesGradeSelect,
} from "@/lib/aviamento-grade/celulas";
import { colunaOrdenavel, ordenarLinhasPorColuna } from "@/lib/aviamento-grade/ordenar";
import {
  montarLinhas,
  type AviamentoEntrada,
  type VarianteEntrada,
} from "@/lib/aviamento-grade/linhas";

const O: OpcoesGradeSelect = {
  categorias: [
    { id: "c1", nome: "Botões" },
    { id: "c2", nome: "Zíperes" },
  ],
  subcategorias: [
    { id: "s1", nome: "Pressão", categoria_aviamento_id: "c1" },
    { id: "s2", nome: "Metal", categoria_aviamento_id: "c1" },
    { id: "s3", nome: "Invisível", categoria_aviamento_id: "c2" },
  ],
  materiais: [{ id: "m1", nome: "Plástico" }],
  cores: [
    { id: "cor1", nome: "Azul" },
    { id: "cor2", nome: "Verde" },
  ],
  coresApelido: [
    { id: "ap1", nome: "Marinho", cor_base_id: "cor1" },
    { id: "ap2", nome: "Bandeira", cor_base_id: "cor2" },
  ],
  empresas: [{ id: "e1", nome_fantasia: "Alfa" }],
  intervalos: [{ id: "i1", nome: "1 a 2 cm" }],
};

describe("controle por tipo de coluna", () => {
  it("texto=input, money=money, select=select, foto=foto, só-leitura/não editável=somente-leitura", () => {
    expect(controleDaCelula({ tipo: "texto", editavel: true })).toBe("input");
    expect(controleDaCelula({ tipo: "money", editavel: true })).toBe("money");
    expect(controleDaCelula({ tipo: "select", editavel: true })).toBe("select");
    expect(controleDaCelula({ tipo: "foto", editavel: true })).toBe("foto");
    expect(controleDaCelula({ tipo: "readonly", editavel: false })).toBe("somente-leitura");
    expect(controleDaCelula({ tipo: "texto", editavel: false })).toBe("somente-leitura");
  });
  it("toda coluna editável do catálogo tem campo no rascunho; só composição/observações são multilinha", () => {
    for (const c of COLUNAS_AVIAMENTO) {
      if (c.key === "foto") continue;
      expect(
        c.escopo === "aviamento" ? CAMPO_AVIAMENTO[c.key] : CAMPO_VARIANTE[c.key],
        c.key,
      ).toBeTruthy();
    }
    expect(COLUNAS_AVIAMENTO.filter((c) => ehTextoLongo(c.key)).map((c) => c.key)).toEqual([
      "composicao",
      "observacoes",
    ]);
  });
  it("tudo é opcional (permite limpar) exceto a cor base e os campos de texto/número", () => {
    for (const k of [
      "fornecedor",
      "categoria",
      "subcategoria",
      "material",
      "intervalo_largura",
      "cor_apelido",
    ])
      expect(permiteVazio(k), k).toBe(true);
    expect(permiteVazio("cor_base")).toBe(false);
  });
});

describe("opções e cascata", () => {
  it("subcategoria só lista as da categoria do aviamento; sem categoria, todas", () => {
    expect(opcoesDaColuna("subcategoria", O, { categoriaId: "c1" }).map((o) => o.id)).toEqual([
      "s1",
      "s2",
    ]);
    expect(opcoesDaColuna("subcategoria", O, { categoriaId: "c2" }).map((o) => o.id)).toEqual([
      "s3",
    ]);
    expect(opcoesDaColuna("subcategoria", O, { categoriaId: null }).map((o) => o.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });
  it("apelido só lista os da cor base; sem cor base, todos", () => {
    expect(opcoesDaColuna("cor_apelido", O, { corId: "cor1" }).map((o) => o.id)).toEqual(["ap1"]);
    expect(opcoesDaColuna("cor_apelido", O, { corId: "" }).map((o) => o.id)).toEqual([
      "ap1",
      "ap2",
    ]);
  });
  it("categoria, material, intervalo, cor base e fornecedor", () => {
    expect(opcoesDaColuna("categoria", O)).toHaveLength(2);
    expect(opcoesDaColuna("material", O)).toEqual([{ id: "m1", nome: "Plástico" }]);
    expect(opcoesDaColuna("intervalo_largura", O)).toEqual([{ id: "i1", nome: "1 a 2 cm" }]);
    expect(opcoesDaColuna("cor_base", O)).toHaveLength(2);
    expect(opcoesDaColuna("fornecedor", O)).toEqual([{ id: "e1", nome: "Alfa" }]);
    expect(opcoesDaColuna("preco", O)).toEqual([]);
  });
  it("trocar a categoria zera a subcategoria que não é dela (mantém a compatível)", () => {
    expect(subcategoriaAposTrocarCategoria("c2", "s1", O.subcategorias)).toBeNull();
    expect(subcategoriaAposTrocarCategoria("c1", "s1", O.subcategorias)).toBe("s1");
    expect(subcategoriaAposTrocarCategoria(null, "s1", O.subcategorias)).toBeNull();
    expect(subcategoriaAposTrocarCategoria("c1", null, O.subcategorias)).toBeNull();
    expect(subcategoriaAposTrocarCategoria("c1", "s-inexistente", O.subcategorias)).toBeNull();
  });
  it("fornecedor da linha: os de aviamento + o já salvo (mesmo de outra categoria)", () => {
    const emp = [
      { id: "a", ehAviamento: true },
      { id: "b", ehAviamento: false },
      { id: "c", ehAviamento: false },
      { id: "d" },
    ];
    expect(empresasParaLinha(emp, null).map((e) => e.id)).toEqual(["a", "d"]);
    expect(empresasParaLinha(emp, "c").map((e) => e.id)).toEqual(["a", "c", "d"]);
  });
});

describe("ordenação por GRUPO (as cores de um aviamento ficam juntas)", () => {
  const A = (
    id: string,
    nome: string,
    empresa: string | null = null,
    preco: number | null = null,
  ): AviamentoEntrada => ({
    id,
    codigo: `C-${id}`,
    codigo_nome: nome,
    empresa_id: empresa,
    categoria_aviamento_id: null,
    subcategoria_aviamento_id: null,
    material_aviamento_id: null,
    composicao: null,
    preco,
    ncm: null,
    observacoes: null,
    intervalo_largura_id: null,
    largura_exata: null,
  });
  const V = (id: string, av: string, cor: string | null): VarianteEntrada => ({
    id,
    aviamento_id: av,
    cor_id: cor,
    cor_apelido_id: null,
    nome_variante: null,
    codigo_variante: null,
    preco: null,
    foto_url: null,
  });
  const linhas = montarLinhas(
    [A("a1", "Zeta", "e2", 10), A("a2", "Alfa", "e1", 30), A("a3", "Meio", null, 20)],
    new Map([
      ["a1", [V("v1", "a1", "cor2"), V("v2", "a1", "cor1")]],
      ["a2", [V("v3", "a2", "cor1")]],
    ]),
  );
  const ids = (ls: typeof linhas) => ls.map((l) => `${l.aviamentoId}/${l.variantId ?? "-"}`);
  const resolver = (k: string, id: string) =>
    (
      ({
        fornecedor: { e1: "Armarinho", e2: "Tecelagem" },
        cor_base: { cor1: "Azul", cor2: "Verde" },
      }) as any
    )[k]?.[id];

  it("coluna do aviamento ordena os grupos e mantém a ordem das cores", () => {
    expect(ids(ordenarLinhasPorColuna(linhas, byKey("codigo_nome")!, "asc"))).toEqual([
      "a2/v3",
      "a3/-",
      "a1/v1",
      "a1/v2",
    ]);
    expect(ids(ordenarLinhasPorColuna(linhas, byKey("codigo_nome")!, "desc"))).toEqual([
      "a1/v1",
      "a1/v2",
      "a3/-",
      "a2/v3",
    ]);
  });
  it("número como número; vazio por último nos dois sentidos", () => {
    const so = (ls: typeof linhas) =>
      ls.map((l) => l.aviamentoId).filter((x, i, a) => a.indexOf(x) === i);
    expect(so(ordenarLinhasPorColuna(linhas, byKey("preco")!, "asc"))).toEqual(["a1", "a3", "a2"]);
    expect(so(ordenarLinhasPorColuna(linhas, byKey("preco")!, "desc"))).toEqual(["a2", "a3", "a1"]);
    expect(so(ordenarLinhasPorColuna(linhas, byKey("fornecedor")!, "asc", resolver))).toEqual([
      "a2",
      "a1",
      "a3",
    ]); // Armarinho < Tecelagem; sem fornecedor no fim
  });
  it("coluna da cor ordena DENTRO do grupo pelo rótulo; aviamento sem cor vai para o fim", () => {
    expect(ids(ordenarLinhasPorColuna(linhas, byKey("cor_base")!, "asc", resolver))).toEqual([
      "a1/v2",
      "a1/v1",
      "a2/v3",
      "a3/-",
    ]);
  });
  it("não muda a lista de entrada e a foto não é ordenável", () => {
    const copia = [...linhas];
    ordenarLinhasPorColuna(linhas, byKey("codigo_nome")!, "asc");
    expect(linhas).toEqual(copia);
    expect(colunaOrdenavel({ key: "foto" })).toBe(false);
    expect(colunaOrdenavel({ key: "preco" })).toBe(true);
  });
});
