import { describe, it, expect } from "vitest";
import {
  SEM_COR,
  chaveLinha,
  montarLinhas,
  valorColuna,
  type BlocoEntrada,
  type InsumoEntrada,
} from "@/lib/insumo-grade/linhas";
import { byKey } from "@/lib/insumo-grade/colunas";
import { agruparInsumoGrade } from "@/components/insumo/grade/agruparInsumoGrade";
import { vinculoDisponivel } from "@/lib/insumo-tamanho";

const ins = (id: string, extra: Partial<InsumoEntrada> = {}): InsumoEntrada => ({
  id,
  nome: `Insumo ${id}`,
  unidade: "unidade",
  preco: 1.5,
  empresa_id: "emp1",
  representante_id: null,
  observacoes: "obs",
  formato_tamanho: "ambos",
  tipo_insumo_id: "tp1",
  tamanho_vinculado: null,
  ...extra,
});
const bloco = (corId: string, tamanhos: string[] = [], preco: number | null = 2): BlocoEntrada => ({
  cor_id: corId,
  preco,
  tamanhos,
});

describe("montarLinhas (1 linha por COR)", () => {
  it("insumo com 3 cores gera 3 linhas, cabeçalho repetido e chaves distintas", () => {
    const i = ins("E1");
    const mapa = new Map([["E1", [bloco("azul"), bloco("verde"), bloco("rosa")]]]);
    const linhas = montarLinhas([i], mapa);
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.insumo === i && l.insumoId === "E1")).toBe(true);
    expect(linhas.map((l) => l.chave)).toEqual(["E1:azul", "E1:verde", "E1:rosa"]);
    expect(new Set(linhas.map((l) => l.chave)).size).toBe(3);
    expect(linhas.map((l) => l.corId)).toEqual(["azul", "verde", "rosa"]);
  });

  it("os TAMANHOS não viram linhas: cor com 4 tamanhos continua sendo 1 linha, com os 4 no bloco", () => {
    const linhas = montarLinhas(
      [ins("E1")],
      new Map([["E1", [bloco("azul", ["34|PPP", "36|PP", "38|P", "40|M"])]]]),
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].bloco?.tamanhos).toEqual(["34|PPP", "36|PP", "38|P", "40|M"]);
  });

  it("insumo sem cor (ausente ou lista vazia) gera 1 linha 'sem cor' sem bloco", () => {
    const linhas = montarLinhas([ins("E1"), ins("E2")], new Map([["E2", []]]));
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(l.corId).toBeNull();
      expect(l.bloco).toBeNull();
      expect(l.chave).toBe(`${l.insumoId}:${SEM_COR}`);
    }
  });

  it("bloco '' (variantes sem cor) é uma linha com bloco, chave 'sem-cor' (não colide: insumo sem bloco nenhum não tem bloco '')", () => {
    const linhas = montarLinhas([ins("E1")], new Map([["E1", [bloco("", ["40|M"])]]]));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].corId).toBe("");
    expect(linhas[0].bloco).not.toBeNull();
    expect(linhas[0].chave).toBe(`E1:${SEM_COR}`);
  });

  it("segue a ordem dos insumos e dos blocos recebidos; sem insumos = sem linhas", () => {
    const mapa = new Map([
      ["E1", [bloco("b"), bloco("a")]],
      ["E2", [bloco("c")]],
    ]);
    expect(montarLinhas([ins("E2"), ins("E1")], mapa).map((l) => l.chave)).toEqual([
      "E2:c",
      "E1:b",
      "E1:a",
    ]);
    expect(montarLinhas([], mapa)).toEqual([]);
  });

  it("chaveLinha: cor_id vazio ou null cai em 'sem-cor'", () => {
    expect(chaveLinha("E1", "azul")).toBe("E1:azul");
    expect(chaveLinha("E1", "")).toBe("E1:sem-cor");
    expect(chaveLinha("E1", null)).toBe("E1:sem-cor");
  });

  it("integra com o agrupamento: variantes cor×tamanho do banco viram 1 linha por cor", () => {
    const mapa = agruparInsumoGrade(
      ["34|PPP", "36|PP", "38|P"].flatMap((t, k) =>
        ["azul", "verde"].map((c, j) => ({
          id: `${k}${j}`,
          etiqueta_id: "E1",
          cor_id: c,
          tamanho: t,
          preco: c === "azul" ? 2 : 3,
          created_at: "2026-01-01",
        })),
      ),
    );
    const linhas = montarLinhas([ins("E1")], mapa);
    expect(linhas.map((l) => [l.corId, l.bloco?.preco, l.bloco?.tamanhos.length])).toEqual([
      ["azul", 2, 3],
      ["verde", 3, 3],
    ]);
  });
});

describe("valorColuna (accessor de ordenação)", () => {
  const l = montarLinhas(
    [ins("E1", { tamanho_vinculado: "40|M", unidade: "metro", formato_tamanho: "nenhum" })],
    new Map([["E1", [bloco("azul", ["40|M", "42|G"], 4.5)]]]),
  )[0];
  const semCor = montarLinhas([ins("E2")], new Map())[0];
  const c = (k: string) => byKey(k)!;

  it("lê o cabeçalho do insumo (escopo 'insumo')", () => {
    expect(valorColuna(l, c("nome"))).toBe("Insumo E1");
    expect(valorColuna(l, c("unidade"))).toBe("metro");
    expect(valorColuna(l, c("preco"))).toBe(1.5);
    expect(valorColuna(l, c("formato_tamanho"))).toBe("nenhum");
    expect(valorColuna(l, c("tamanho_vinculado"))).toBe("40|M");
    expect(valorColuna(l, c("observacoes"))).toBe("obs");
  });

  it("lê o bloco da cor (escopo 'variante'): cor, tamanhos juntos, preço da cor", () => {
    expect(valorColuna(l, c("cor"))).toBe("azul");
    expect(valorColuna(l, c("tamanhos"))).toBe("40|M, 42|G");
    expect(valorColuna(l, c("preco_variante"))).toBe(4.5);
  });

  it("selects traduzem o id pelo resolver (id sem rótulo cai no id)", () => {
    const resolver = (k: string, id: string) =>
      ({ "tipo_insumo:tp1": "Cartão", "fornecedor:emp1": "Alfa", "cor:azul": "Azul" })[
        `${k}:${id}`
      ];
    expect(valorColuna(l, c("tipo_insumo"), resolver)).toBe("Cartão");
    expect(valorColuna(l, c("fornecedor"), resolver)).toBe("Alfa");
    expect(valorColuna(l, c("cor"), resolver)).toBe("Azul");
    expect(valorColuna(l, c("cor"), () => undefined)).toBe("azul");
    expect(valorColuna(l, c("tipo_insumo"))).toBe("tp1");
  });

  it("linha 'sem cor' sem bloco devolve null nas colunas da cor; vazio vira null", () => {
    expect(valorColuna(semCor, c("cor"))).toBeNull();
    expect(valorColuna(semCor, c("tamanhos"))).toBeNull();
    expect(valorColuna(semCor, c("preco_variante"))).toBeNull();
    expect(valorColuna(semCor, c("nome"))).toBe("Insumo E2");
    expect(valorColuna(semCor, c("tamanho_vinculado"))).toBeNull();
    const semTam = montarLinhas([ins("E3")], new Map([["E3", [bloco("", [], null)]]]))[0];
    expect(valorColuna(semTam, c("cor"))).toBeNull();
    expect(valorColuna(semTam, c("tamanhos"))).toBeNull();
    expect(valorColuna(semTam, c("preco_variante"))).toBeNull();
  });
});

describe("reuso de insumo-tamanho (a regra do vínculo NÃO é reimplementada)", () => {
  it("o bloco da grade serve direto de `blocos` do helper: vínculo só vale sem tamanho próprio", () => {
    const comTam = montarLinhas([ins("E1")], new Map([["E1", [bloco("azul", ["40|M"])]]]));
    const semTam = montarLinhas([ins("E1")], new Map([["E1", [bloco("azul", [])]]]));
    const blocos = (ls: typeof comTam) => ls.flatMap((x) => (x.bloco ? [x.bloco] : []));
    expect(vinculoDisponivel("ambos", blocos(comTam))).toBe(false);
    expect(vinculoDisponivel("ambos", blocos(semTam))).toBe(true);
    expect(vinculoDisponivel("nenhum", blocos(comTam))).toBe(true);
  });
});
