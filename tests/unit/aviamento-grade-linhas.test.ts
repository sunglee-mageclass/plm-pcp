import { describe, it, expect } from "vitest";
import {
  SEM_COR,
  chaveLinha,
  montarLinhas,
  valorColuna,
  type AviamentoEntrada,
  type VarianteEntrada,
} from "@/lib/aviamento-grade/linhas";
import { byKey } from "@/lib/aviamento-grade/colunas";

const av = (id: string, extra: Partial<AviamentoEntrada> = {}): AviamentoEntrada => ({
  id,
  codigo: `ZIP-${id}`,
  codigo_nome: `Aviamento ${id}`,
  empresa_id: "emp1",
  representante_id: null,
  categoria_aviamento_id: "cat1",
  subcategoria_aviamento_id: "sub1",
  material_aviamento_id: "mat1",
  composicao: "100% poliéster",
  preco: 2.5,
  ncm: "9607.11.00",
  observacoes: "obs",
  intervalo_largura_id: "int1",
  largura_exata: 12,
  ...extra,
});
const vari = (
  id: string,
  aviamentoId: string,
  extra: Partial<VarianteEntrada> = {},
): VarianteEntrada => ({
  id,
  aviamento_id: aviamentoId,
  cor_id: `cor-${id}`,
  cor_apelido_id: null,
  nome_variante: `Var ${id}`,
  codigo_variante: `C-${id}`,
  preco: 3,
  foto_url: null,
  ...extra,
});

describe("montarLinhas", () => {
  it("aviamento com 3 variantes gera 3 linhas, cabeçalho repetido e chaves distintas", () => {
    const a = av("A1");
    const mapa = new Map([["A1", [vari("v1", "A1"), vari("v2", "A1"), vari("v3", "A1")]]]);
    const linhas = montarLinhas([a], mapa);
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.aviamento === a && l.aviamentoId === "A1")).toBe(true);
    expect(linhas.map((l) => l.chave)).toEqual(["A1:v1", "A1:v2", "A1:v3"]);
    expect(new Set(linhas.map((l) => l.chave)).size).toBe(3);
    expect(linhas.map((l) => l.variantId)).toEqual(["v1", "v2", "v3"]);
  });

  it("aviamento sem variante (ausente ou lista vazia) gera 1 linha 'sem cor'", () => {
    const linhas = montarLinhas([av("A1"), av("A2")], new Map([["A2", []]]));
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(l.variantId).toBeNull();
      expect(l.variante).toBeNull();
    }
    expect(linhas.map((l) => l.chave)).toEqual([`A1:${SEM_COR}`, `A2:${SEM_COR}`]);
  });

  it("preserva a ordem dos aviamentos e das variantes recebidas", () => {
    const mapa = new Map([
      ["B", [vari("b2", "B"), vari("b1", "B")]],
      ["A", [vari("a1", "A")]],
    ]);
    const linhas = montarLinhas([av("B"), av("A")], mapa);
    expect(linhas.map((l) => l.chave)).toEqual(["B:b2", "B:b1", "A:a1"]);
  });

  it("lista vazia gera nenhuma linha", () => {
    expect(montarLinhas([], new Map())).toEqual([]);
  });

  it("a linha não carrega `rev` (aviamento não tem versão otimista)", () => {
    const [l] = montarLinhas([av("A1")], new Map());
    expect("rev" in l).toBe(false);
  });
});

describe("chaveLinha", () => {
  it("usa 'sem-cor' quando não há variante", () => {
    expect(chaveLinha("A1", null)).toBe("A1:sem-cor");
    expect(chaveLinha("A1", "v9")).toBe("A1:v9");
  });
});

describe("valorColuna", () => {
  const a = av("A1");
  const v = vari("v1", "A1", { cor_apelido_id: "ap1", foto_url: "x/y.jpg" });
  const [linha] = montarLinhas([a], new Map([["A1", [v]]]));
  const [semCor] = montarLinhas([a], new Map());
  const col = (k: string) => byKey(k)!;

  it("colunas do cabeçalho leem do aviamento (nome = codigo_nome)", () => {
    expect(valorColuna(linha, col("codigo"))).toBe("ZIP-A1");
    expect(valorColuna(linha, col("codigo_nome"))).toBe("Aviamento A1");
    expect(valorColuna(linha, col("preco"))).toBe(2.5);
    expect(valorColuna(linha, col("ncm"))).toBe("9607.11.00");
    expect(valorColuna(linha, col("composicao"))).toBe("100% poliéster");
    expect(valorColuna(linha, col("largura_exata"))).toBe(12);
    expect(valorColuna(linha, col("observacoes"))).toBe("obs");
  });

  it("selects de cabeçalho devolvem o id cru sem resolver", () => {
    expect(valorColuna(linha, col("fornecedor"))).toBe("emp1");
    expect(valorColuna(linha, col("categoria"))).toBe("cat1");
    expect(valorColuna(linha, col("subcategoria"))).toBe("sub1");
    expect(valorColuna(linha, col("material"))).toBe("mat1");
    expect(valorColuna(linha, col("intervalo_largura"))).toBe("int1");
  });

  it("com resolver devolve o rótulo; id sem rótulo cai no próprio id", () => {
    const resolver = (k: string, id: string) =>
      ({ "categoria:cat1": "Zíper", "cor_base:cor-v1": "Preto" })[`${k}:${id}`];
    expect(valorColuna(linha, col("categoria"), resolver)).toBe("Zíper");
    expect(valorColuna(linha, col("cor_base"), resolver)).toBe("Preto");
    expect(valorColuna(linha, col("material"), resolver)).toBe("mat1");
  });

  it("colunas de variante leem da variante", () => {
    expect(valorColuna(linha, col("cor_base"))).toBe("cor-v1");
    expect(valorColuna(linha, col("cor_apelido"))).toBe("ap1");
    expect(valorColuna(linha, col("nome_variante"))).toBe("Var v1");
    expect(valorColuna(linha, col("codigo_variante"))).toBe("C-v1");
    expect(valorColuna(linha, col("preco_variante"))).toBe(3);
    expect(valorColuna(linha, col("foto"))).toBe("x/y.jpg");
  });

  it("linha 'sem cor' devolve null nas colunas de variante e mantém o cabeçalho", () => {
    for (const k of [
      "cor_base",
      "cor_apelido",
      "nome_variante",
      "codigo_variante",
      "preco_variante",
      "foto",
    ]) {
      expect(valorColuna(semCor, col(k))).toBeNull();
    }
    expect(valorColuna(semCor, col("codigo_nome"))).toBe("Aviamento A1");
  });

  it("campos vazios viram null e id vazio não passa pelo resolver", () => {
    const vazio = av("A9", {
      codigo: null,
      empresa_id: null,
      categoria_aviamento_id: null,
      preco: null,
      ncm: null,
      composicao: null,
      largura_exata: null,
      observacoes: null,
    });
    const [l] = montarLinhas([vazio], new Map());
    const resolver = () => "NUNCA";
    for (const k of [
      "codigo",
      "fornecedor",
      "categoria",
      "preco",
      "ncm",
      "composicao",
      "largura_exata",
      "observacoes",
    ]) {
      expect(valorColuna(l, col(k), resolver)).toBeNull();
    }
  });

  it("chave desconhecida devolve null", () => {
    expect(
      valorColuna(linha, {
        key: "x",
        rotulo: "X",
        escopo: "aviamento",
        tipo: "texto",
        editavel: true,
      }),
    ).toBeNull();
    expect(
      valorColuna(linha, {
        key: "x",
        rotulo: "X",
        escopo: "variante",
        tipo: "texto",
        editavel: true,
      }),
    ).toBeNull();
  });
});
