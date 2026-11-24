import { describe, it, expect } from "vitest";
import {
  chaveLinha,
  modelosNaOrdemDaTela,
  montarLinhas,
  valorColuna,
  type ModeloGradeEntrada,
} from "@/lib/produto-grade/linhas";
import { COLUNAS_PRODUTO, byKey } from "@/lib/produto-grade/colunas";

const modelo = (id: string, extra: Partial<ModeloGradeEntrada> = {}): ModeloGradeEntrada => ({
  id,
  rev: 3,
  nome: `Vestido ${id}`,
  ref: `VE${id}`,
  estilista_id: "est1",
  linha_id: "lin1",
  colecao: "texto livre",
  colecao_id: "col1",
  colecao_rotulo: "Verão 27",
  subcolecao: "Sub A",
  semana: "2",
  mes_id: "mes1",
  ano_id: "ano1",
  categoria_principal_id: "cat1",
  subcategoria1_id: "s1",
  subcategoria2_id: "s2",
  status_planejamento: "planejado",
  status_desenvolvimento: "modelagem",
  ordem_criacao_enviada: true,
  enviado_cad: false,
  versao: 2,
  origem: "interno",
  descricao_produto: "Descrição",
  ncm: "6104.43.00",
  titulo_pagina: "Título",
  peso_kg: 0.25,
  comprimento_cm: 30,
  largura_cm: 20,
  altura_cm: 5,
  preco_venda: 199.9,
  preco_anterior: 249.9,
  preco_atacado: 120,
  tamanho_tipo: "letra",
  observacoes_gerais: "geral",
  observacoes_mao_obra: "mo",
  data_lancamento: "2027-01-10",
  lancado: false,
  ...extra,
});
const col = (k: string) => byKey(k)!;

describe("montarLinhas — 1 linha por MODELO", () => {
  it("cada modelo vira exatamente 1 linha (sem pai/filhos), chave = id, na ordem recebida", () => {
    const ms = [modelo("B"), modelo("A"), modelo("C")];
    const linhas = montarLinhas(ms);
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => l.chave)).toEqual(["B", "A", "C"]);
    expect(linhas.map((l) => l.modeloId)).toEqual(["B", "A", "C"]);
    expect(linhas[0].modelo).toBe(ms[0]);
  });

  it("a linha carrega o modelo inteiro, inclusive `rev` (p/ o CAS da PR-2) e `enviado_cad`", () => {
    const [l] = montarLinhas([modelo("A", { rev: 41, enviado_cad: true })]);
    expect(l.modelo.rev).toBe(41);
    expect(l.modelo.enviado_cad).toBe(true);
  });

  it("id repetido (paginação) entra UMA vez; a 1ª ocorrência vale", () => {
    const linhas = montarLinhas([
      modelo("A", { nome: "1ª" }),
      modelo("B"),
      modelo("A", { nome: "2ª" }),
    ]);
    expect(linhas.map((l) => l.chave)).toEqual(["A", "B"]);
    expect(linhas[0].modelo.nome).toBe("1ª");
  });

  it("lista vazia gera nenhuma linha", () => {
    expect(montarLinhas([])).toEqual([]);
  });

  it("chaveLinha é o próprio id do modelo", () => {
    expect(chaveLinha("abc")).toBe("abc");
  });
});

describe("valorColuna", () => {
  const [linha] = montarLinhas([modelo("A")]);

  it("colunas de texto/número leem do modelo", () => {
    expect(valorColuna(linha, col("ref"))).toBe("VEA");
    expect(valorColuna(linha, col("nome"))).toBe("Vestido A");
    expect(valorColuna(linha, col("descricao_produto"))).toBe("Descrição");
    expect(valorColuna(linha, col("ncm"))).toBe("6104.43.00");
    expect(valorColuna(linha, col("titulo_pagina"))).toBe("Título");
    expect(valorColuna(linha, col("peso_kg"))).toBe(0.25);
    expect(valorColuna(linha, col("comprimento_cm"))).toBe(30);
    expect(valorColuna(linha, col("largura_cm"))).toBe(20);
    expect(valorColuna(linha, col("altura_cm"))).toBe(5);
    expect(valorColuna(linha, col("preco_venda"))).toBe(199.9);
    expect(valorColuna(linha, col("preco_anterior"))).toBe(249.9);
    expect(valorColuna(linha, col("preco_atacado"))).toBe(120);
    expect(valorColuna(linha, col("versao"))).toBe(2);
    expect(valorColuna(linha, col("semana"))).toBe("2");
    expect(valorColuna(linha, col("subcolecao"))).toBe("Sub A");
    expect(valorColuna(linha, col("tamanho_tipo"))).toBe("letra");
    expect(valorColuna(linha, col("observacoes_gerais"))).toBe("geral");
    expect(valorColuna(linha, col("observacoes_mao_obra"))).toBe("mo");
    expect(valorColuna(linha, col("data_lancamento"))).toBe("2027-01-10");
  });

  it("coleção mostra o RÓTULO (nome do OTB, senão o texto) — nunca o id", () => {
    expect(valorColuna(linha, col("colecao"))).toBe("Verão 27");
    const [semOtb] = montarLinhas([
      modelo("B", { colecao_id: null, colecao_rotulo: "texto livre" }),
    ]);
    expect(valorColuna(semOtb, col("colecao"))).toBe("texto livre");
    const [vazia] = montarLinhas([
      modelo("C", { colecao_id: null, colecao: null, colecao_rotulo: null }),
    ]);
    expect(valorColuna(vazia, col("colecao"))).toBeNull();
  });

  it("origem vira o rótulo humano (ausente = produção própria)", () => {
    expect(valorColuna(linha, col("origem"))).toBe("Produção própria");
    const [rev] = montarLinhas([modelo("R", { origem: "revenda" })]);
    expect(valorColuna(rev, col("origem"))).toBe("Revenda");
    const [nulo] = montarLinhas([modelo("N", { origem: null })]);
    expect(valorColuna(nulo, col("origem"))).toBe("Produção própria");
  });

  it("selects devolvem o id cru sem resolver e o rótulo com ele (id sem rótulo cai no id)", () => {
    for (const [k, id] of [
      ["linha_id", "lin1"],
      ["mes_id", "mes1"],
      ["ano_id", "ano1"],
      ["estilista_id", "est1"],
      ["categoria_principal_id", "cat1"],
      ["subcategoria1_id", "s1"],
      ["subcategoria2_id", "s2"],
    ] as const) {
      expect(valorColuna(linha, col(k)), k).toBe(id);
      expect(
        valorColuna(linha, col(k), (c, i) => (c === k && i === id ? `R-${id}` : undefined)),
        k,
      ).toBe(`R-${id}`);
      expect(
        valorColuna(linha, col(k), () => undefined),
        k,
      ).toBe(id);
    }
  });

  it("status usa o resolver quando há (rótulo) e o valor cru quando não", () => {
    expect(valorColuna(linha, col("status_planejamento"))).toBe("planejado");
    expect(valorColuna(linha, col("status_planejamento"), () => "Planejado")).toBe("Planejado");
  });

  it("grupo é DERIVADO da categoria: só existe com resolver (nunca devolve o id da categoria)", () => {
    expect(valorColuna(linha, col("grupo"))).toBeNull();
    const r = (k: string, id: string) => (k === "grupo" && id === "cat1" ? "Vestuário" : undefined);
    expect(valorColuna(linha, col("grupo"), r)).toBe("Vestuário");
    const [semCat] = montarLinhas([modelo("S", { categoria_principal_id: null })]);
    expect(valorColuna(semCat, col("grupo"), r)).toBeNull();
  });

  it("valores nulos viram null (NULL = vazio), 0 é valor", () => {
    const [v] = montarLinhas([
      modelo("V", {
        nome: null,
        ncm: null,
        peso_kg: 0,
        preco_venda: null,
        linha_id: null,
        semana: null,
      }),
    ]);
    expect(valorColuna(v, col("nome"))).toBeNull();
    expect(valorColuna(v, col("ncm"))).toBeNull();
    expect(valorColuna(v, col("peso_kg"))).toBe(0);
    expect(valorColuna(v, col("preco_venda"))).toBeNull();
    expect(valorColuna(v, col("linha_id"), () => "x")).toBeNull();
    expect(valorColuna(v, col("semana"))).toBeNull();
  });

  it("TODA coluna do catálogo tem leitura (nenhuma cai no default calada por esquecimento)", () => {
    // Com o modelo completo, nenhuma coluna pode devolver undefined/ficar sem case: `grupo` é a única que depende de resolver.
    for (const c of COLUNAS_PRODUTO) {
      const v = valorColuna(linha, c, () => "rótulo");
      expect(v, `coluna ${c.key} sem valor`).not.toBeNull();
    }
  });

  it("coluna desconhecida devolve null", () => {
    expect(
      valorColuna(linha, { key: "x", rotulo: "X", tipo: "texto", dono: "planejamento" }),
    ).toBeNull();
  });
});

describe("modelosNaOrdemDaTela", () => {
  const ms = [modelo("A"), modelo("B"), modelo("C")];
  it("segue a ORDEM dos ids da tela, não a da consulta", () => {
    expect(
      modelosNaOrdemDaTela(ms, [{ id: "C" }, { id: "A" }, { id: "B" }]).map((m) => m.id),
    ).toEqual(["C", "A", "B"]);
  });
  it("só devolve o que a tela filtrou (e a consulta tem)", () => {
    expect(modelosNaOrdemDaTela(ms, [{ id: "B" }]).map((m) => m.id)).toEqual(["B"]);
  });
  it("id da tela que a consulta ainda não trouxe (recém-criado) fica de fora — nunca se inventa linha", () => {
    expect(modelosNaOrdemDaTela(ms, [{ id: "Z" }, { id: "A" }]).map((m) => m.id)).toEqual(["A"]);
  });
  it("id repetido na tela entra 1×; lista vazia = vazio", () => {
    expect(modelosNaOrdemDaTela(ms, [{ id: "A" }, { id: "A" }]).map((m) => m.id)).toEqual(["A"]);
    expect(modelosNaOrdemDaTela(ms, [])).toEqual([]);
  });
});
