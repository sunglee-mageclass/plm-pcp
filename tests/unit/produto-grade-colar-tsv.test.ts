// PR-3 (Produto) — COLAR do Excel (TSV): parte PURA. Produto NÃO cria (linhas além do fim = ignoradas); campo bloqueado = ignorado
// (permissão, trava da Integração, só-leitura, origem); texto → id por NOME; o que não resolve não grava; só devolve o que MUDA.
import { describe, it, expect } from "vitest";
import {
  ehBlocoColavel,
  mapearColagemProduto,
  parseBlocoTsv,
  resumoColagemProduto,
  TETO_LINHAS_COLAR,
  type EntradaColagemProduto,
} from "@/lib/produto-grade/colar-tsv";
import { colunasNaOrdemDaTela, colunasVisiveis } from "@/lib/produto-grade/colunas";
import { montarLinhas, type ModeloGradeEntrada } from "@/lib/produto-grade/linhas";
import { produtoParaDraft, type ProdutoDraft } from "@/lib/produto-grade/salvar";
import type { GradeOpcoesProduto } from "@/components/planejamento/grade/useProdutosGrade";

const tudo = () => true;
const COLS = colunasNaOrdemDaTela(colunasVisiveis(tudo, tudo));
const idx = (k: string) => COLS.findIndex((c) => c.key === k);
/** Linha do TSV com os textos nas colunas dadas (as demais vazias) a partir da coluna `de` até a última pedida. */
function tsv(de: string, textos: Record<string, string>): string[] {
  const ini = idx(de);
  const fim = Math.max(...Object.keys(textos).map(idx));
  return COLS.slice(ini, fim + 1).map((c) => textos[c.key] ?? "");
}

const modelo = (id: string, extra: Partial<ModeloGradeEntrada> = {}): ModeloGradeEntrada =>
  ({
    id,
    rev: 1,
    nome: `Modelo ${id}`,
    ref: null,
    estilista_id: null,
    linha_id: null,
    colecao: null,
    colecao_id: null,
    colecao_rotulo: null,
    subcolecao: null,
    semana: null,
    mes_id: null,
    ano_id: null,
    categoria_principal_id: null,
    subcategoria1_id: null,
    subcategoria2_id: null,
    status_planejamento: null,
    status_desenvolvimento: null,
    ordem_criacao_enviada: false,
    enviado_cad: false,
    versao: 1,
    origem: "interno",
    descricao_produto: null,
    ncm: null,
    titulo_pagina: null,
    peso_kg: null,
    comprimento_cm: null,
    largura_cm: null,
    altura_cm: null,
    preco_venda: null,
    preco_anterior: null,
    preco_atacado: null,
    tamanho_tipo: "letra",
    observacoes_gerais: null,
    observacoes_mao_obra: null,
    data_lancamento: null,
    lancado: false,
    ...extra,
  }) as ModeloGradeEntrada;

const OPCOES: GradeOpcoesProduto = {
  estilistas: [{ id: "est1", nome: "Ana" }],
  linhas: [{ id: "lin1", nome: "Casual" }],
  meses: [{ id: "mes1", nome: "Janeiro" }],
  anos: [{ id: "ano1", nome: "2027" }],
  grupos: [
    { id: "g1", nome: "Vestuário" },
    { id: "g2", nome: "Acessórios" },
  ],
  categorias: [
    { id: "cat1", nome: "Vestido", grupo_id: "g1" },
    { id: "cat2", nome: "Saia", grupo_id: "g1" },
    { id: "cat3", nome: "Bolsa", grupo_id: "g2" },
  ],
  subcategorias1: [
    { id: "s1", nome: "Longo", categoria_id: "cat1" },
    { id: "s1b", nome: "Midi", categoria_id: "cat2" },
  ],
  subcategorias2: [{ id: "s2", nome: "Manga", categoria_id: "cat1" }],
  colecoes: [{ id: "col1", nome: "Verão 27", mes_id: "mes1", ano_id: "ano1" }],
  subcolecoesPorColecao: new Map([["col1", ["Sub A"]]]),
  semanas: [
    { id: "1", nome: "1" },
    { id: "2", nome: "2" },
  ],
  tamanhoTipos: [
    { id: "letra", nome: "Letra" },
    { id: "numero", nome: "Número" },
  ],
} as unknown as GradeOpcoesProduto;

function entrada(
  over: Partial<EntradaColagemProduto> & { modelos?: ModeloGradeEntrada[] } = {},
): EntradaColagemProduto {
  const modelos = over.modelos ?? [modelo("M1"), modelo("M2"), modelo("M3")];
  const linhas = montarLinhas(modelos);
  const rasc = new Map<string, ProdutoDraft>(modelos.map((m) => [m.id, produtoParaDraft(m)]));
  return {
    linhas,
    colunas: COLS,
    opcoes: OPCOES,
    otbOn: false,
    readOnly: false,
    integracaoPronta: true,
    canEdit: tudo,
    estadoDe: () => null,
    valorDe: (id) => rasc.get(id)!,
    ...over,
  };
}
const campos = (r: ReturnType<typeof mapearColagemProduto>, id: string) =>
  r.patches.find((p) => p.modeloId === id)?.campos;

describe("parse do bloco (reuso do motor do tecido)", () => {
  it("TSV do Excel: colunas por TAB, linhas por quebra, aspas com TAB/quebra dentro", () => {
    expect(parseBlocoTsv('a\tb\r\nc\t"d\te"\r\n')).toEqual([
      ["a", "b"],
      ["c", "d\te"],
    ]);
    expect(ehBlocoColavel("so um valor")).toBe(false);
    expect(ehBlocoColavel("a\tb")).toBe(true);
  });
});

describe("Produto NÃO cria: linhas além do fim são ignoradas", () => {
  it("5 linhas coladas a partir do 2º produto: só M2 e M3 recebem; 3 linhas ignoradas 'além do fim'; nenhum patch para linha inexistente", () => {
    const bloco = [1, 2, 3, 4, 5].map((n) =>
      tsv("nome", { nome: `Novo ${n}`, descricao_produto: `d${n}` }),
    );
    const r = mapearColagemProduto({ linhaIdx: 1, colIdx: idx("nome") }, bloco, entrada());
    expect(r.patches.map((p) => p.modeloId)).toEqual(["M2", "M3"]);
    expect(r.patches.map((p) => p.linhaIdx)).toEqual([1, 2]);
    expect(r.ignoradas.filter((i) => i.motivo === "alem-do-fim")).toHaveLength(3);
    expect(r.celulasAplicadas).toBe(4);
    const resumo = resumoColagemProduto(r);
    expect(resumo.tom).toBe("aviso");
    expect(resumo.texto).toContain("Coladas 4 células em 2 produtos");
    expect(resumo.detalhe).toContain("3 linhas além do último produto");
  });
});

describe("campo bloqueado é IGNORADO (nunca grava)", () => {
  it("só-leitura (REF/Status/Origem), sem permissão (preço), travado pela Integração e 'verificando'", () => {
    const bloco = [tsv("ref", { ref: "X1", versao: "9", origem: "Importado", ncm: "6109.10" })];
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("ref") }, bloco, entrada());
    expect(r.patches).toHaveLength(1);
    expect(campos(r, "M1")).toEqual({ ncm: "6109.10" }); // só o NCM (editável) entra
    expect(r.ignoradas.map((i) => i.motivo).sort()).toEqual([
      "somente-leitura",
      "somente-leitura",
      "somente-leitura",
    ]);

    // sem a permissão de preço de venda
    const semPreco = entrada({ canEdit: (k) => k === "criacao_planejamento" });
    const r2 = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("preco_venda") },
      [["99,90"]],
      semPreco,
    );
    expect(r2.patches).toHaveLength(0);
    expect(r2.ignoradas[0].motivo).toBe("sem-permissao");

    // travado pela Integração NESTE produto (nome) — o outro produto segue livre
    const trava = {
      estado: "integravel",
      campos: ["nome"],
      marcado_em: "2026-11-20T12:00:00Z",
      integrado_em: null,
    };
    const r3 = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("nome") },
      [["A"], ["B"]],
      entrada({ estadoDe: (id) => (id === "M1" ? (trava as never) : null) }),
    );
    expect(r3.patches.map((p) => p.modeloId)).toEqual(["M2"]);
    expect(r3.ignoradas).toHaveLength(1);
    expect(r3.ignoradas[0]).toMatchObject({ modeloId: "M1", colKey: "nome", motivo: "travada" });

    // Integração ainda não respondeu: coluna travável fica bloqueada (nunca livre)
    const r4 = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("nome") },
      [["A"]],
      entrada({ integracaoPronta: false }),
    );
    expect(r4.patches).toHaveLength(0);
    expect(r4.ignoradas[0].motivo).toBe("verificando");
  });

  it("tela só-leitura: nada aplica; preço de venda em produto COMPRADO (derivado) é ignorado", () => {
    const r = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("nome") },
      [["A"]],
      entrada({ readOnly: true }),
    );
    expect(r.patches).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toBe("sem-permissao");
    const rev = entrada({ modelos: [modelo("M1", { origem: "revenda" })] });
    const r2 = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("preco_venda") }, [["10,00"]], rev);
    expect(r2.patches).toHaveLength(0);
    expect(r2.ignoradas[0].motivo).toBe("sem-permissao");
  });

  it("célula vazia em campo bloqueado/obrigatório não faz barulho nem apaga o Nome", () => {
    const r = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("ref") },
      [tsv("ref", { ref: "", nome: "" })],
      entrada(),
    );
    expect(r.ignoradas).toHaveLength(0);
    expect(r.patches).toHaveLength(0);
    const r2 = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("nome") }, [[""]], entrada());
    expect(r2.patches).toHaveLength(0);
  });
});

describe("texto → id por NOME (lookups) e o que não resolve não grava", () => {
  it("linha/estilista/mês/ano/categoria/sub por nome (sem acento e sem caixa); dispara a cascata da categoria", () => {
    const bloco = [
      tsv("linha_id", {
        linha_id: "casual",
        mes_id: "JANEIRO",
        ano_id: "2027",
        estilista_id: "ana",
        categoria_principal_id: "vestido",
        subcategoria1_id: "longo",
        subcategoria2_id: "manga",
      }),
    ];
    const e = entrada({
      modelos: [modelo("M1", { categoria_principal_id: "cat2", subcategoria1_id: "s1b" })],
    });
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("linha_id") }, bloco, e);
    expect(campos(r, "M1")).toEqual({
      linha_id: "lin1",
      mes_id: "mes1",
      ano_id: "ano1",
      estilista_id: "est1",
      categoria_principal_id: "cat1",
      subcategoria1_id: "s1",
      subcategoria2_id: "s2",
    });
    expect(r.ignoradas).toHaveLength(0);
  });

  it("trocar só a categoria limpa a subcategoria que ficou órfã (igual à célula)", () => {
    const e = entrada({
      modelos: [
        modelo("M1", {
          categoria_principal_id: "cat1",
          subcategoria1_id: "s1",
          subcategoria2_id: "s2",
        }),
      ],
    });
    const r = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("categoria_principal_id") },
      [["Saia"]],
      e,
    );
    expect(campos(r, "M1")).toEqual({
      categoria_principal_id: "cat2",
      subcategoria1_id: null,
      subcategoria2_id: null,
    });
  });

  it("nome inexistente: não grava, vira aviso na célula (com sugestão) e a linha segue", () => {
    const bloco = [tsv("linha_id", { linha_id: "Casuall", estilista_id: "Ana" })];
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("linha_id") }, bloco, entrada());
    expect(campos(r, "M1")).toEqual({ estilista_id: "est1" });
    expect(r.ignoradas).toHaveLength(1);
    expect(r.ignoradas[0]).toMatchObject({ colKey: "linha_id", motivo: "sem-correspondencia" });
    expect(r.avisos["M1|linha_id"]).toContain("Casuall");
    expect(r.avisos["M1|linha_id"]).toContain('você quis dizer "Casual"');
    expect(resumoColagemProduto(r).detalhe).toContain("sem correspondência");
  });

  it("subcategoria exige a categoria da linha; sem categoria = aviso pedindo para colar a categoria junto", () => {
    const r = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("subcategoria1_id") },
      [["Longo"]],
      entrada(),
    );
    expect(r.patches).toHaveLength(0);
    expect(r.avisos["M1|subcategoria1_id"]).toContain("Categoria");
  });

  it("Coleção/Subcoleção com OTB: coleção grava id + texto e herda Mês/Ano vazios; subcoleção só da coleção da linha", () => {
    const bloco = [tsv("colecao", { colecao: "verão 27", subcolecao: "sub a" })];
    const r = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("colecao") },
      bloco,
      entrada({ otbOn: true }),
    );
    expect(campos(r, "M1")).toEqual({
      colecao_id: "col1",
      colecao: "Verão 27",
      mes_id: "mes1",
      ano_id: "ano1",
      subcolecao: "Sub A",
    });
    // sem OTB = texto livre
    const r2 = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("colecao") },
      [tsv("colecao", { colecao: "Qualquer", subcolecao: "Livre" })],
      entrada(),
    );
    expect(campos(r2, "M1")).toEqual({ colecao: "Qualquer", subcolecao: "Livre" });
  });

  it("'Tamanho em' não vale em Acessórios (regra) e vale nos demais", () => {
    const acess = entrada({ modelos: [modelo("M1", { categoria_principal_id: "cat3" })] });
    const r = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("tamanho_tipo") },
      [["Número"]],
      acess,
    );
    expect(r.patches).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toBe("regra");
    const r2 = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("tamanho_tipo") },
      [["numero"]],
      entrada(),
    );
    expect(campos(r2, "M1")).toEqual({ tamanho_tipo: "numero" });
  });
});

describe("números e textos", () => {
  it("número BR (1.234,5 / R$ 12,90), arredonda nas casas da coluna; inválido/negativo não grava", () => {
    const bloco = [
      tsv("peso_kg", {
        peso_kg: "1,2345",
        comprimento_cm: "R$ 1.234,567",
        largura_cm: "abc",
        altura_cm: "-3",
        preco_venda: "199,9",
      }),
    ];
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("peso_kg") }, bloco, entrada());
    expect(campos(r, "M1")).toEqual({
      peso_kg: 1.235,
      comprimento_cm: 1234.57,
      preco_venda: 199.9,
    });
    expect(r.ignoradas.map((i) => i.motivo)).toEqual(["numero-invalido", "numero-invalido"]);
    expect(r.avisos["M1|largura_cm"]).toContain("abc");
  });

  it("NCM filtra; texto vazio limpa campo opcional (e só devolve o que MUDA)", () => {
    const e = entrada({
      modelos: [modelo("M1", { descricao_produto: "velha", titulo_pagina: "igual" })],
    });
    const bloco = [
      tsv("descricao_produto", {
        descricao_produto: "",
        ncm: "6109.10.00x",
        titulo_pagina: "igual",
      }),
    ];
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("descricao_produto") }, bloco, e);
    expect(campos(r, "M1")).toEqual({ descricao_produto: null, ncm: "6109.10.00" });
    expect(r.celulasAplicadas).toBe(3);
  });

  it("coluna além da última vira 'transbordo'; teto de linhas corta e avisa", () => {
    const ultima = COLS.length - 1;
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: ultima }, [["x", "y"]], entrada());
    expect(r.ignoradas.some((i) => i.motivo === "transbordo")).toBe(true);
    const muitos = Array.from({ length: 5 }, (_, n) => [`N${n}`]);
    const r2 = mapearColagemProduto(
      { linhaIdx: 0, colIdx: idx("nome") },
      muitos,
      entrada({ tetoLinhas: 2 }),
    );
    expect(r2.cortadas).toBe(3);
    expect(resumoColagemProduto(r2).detalhe).toContain(`teto de ${TETO_LINHAS_COLAR}`);
  });

  it("resumo sem ignoradas é 'sucesso'", () => {
    const r = mapearColagemProduto({ linhaIdx: 0, colIdx: idx("nome") }, [["A"], ["B"]], entrada());
    const s = resumoColagemProduto(r);
    expect(s.tom).toBe("sucesso");
    expect(s.texto).toBe("Coladas 2 células em 2 produtos · 0 ignoradas");
  });
});
