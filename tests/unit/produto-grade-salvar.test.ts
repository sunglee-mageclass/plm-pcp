/* eslint-disable @typescript-eslint/no-explicit-any -- cliente do banco falso */
// Grade "Lista" do Planejamento de Produto (PR-2) — camada PURA do Salvar: payload só com o EDITADO, decisão ÚNICA de editabilidade,
// omissão do que a Integração trava, NULL (não "") em Título/Preço anterior, Acessórios, CAS por `rev` + P0409, resumo do resultado parcial.
import { describe, it, expect, vi } from "vitest";
import { RecusaEsperadaError } from "@/lib/categoria-card-produto";
import type { EstadoModeloIntegracao } from "@/lib/integracao/trava";
import {
  ConflitoProdutoError,
  CHAVES_DRAFT_PRODUTO,
  colunaDaChave,
  ehConflitoRev,
  montarPayloadProduto,
  produtoParaDraft,
  salvarProduto,
  textoErroSalvar,
  valorParaPayload,
  type ClienteModelos,
} from "@/lib/produto-grade/salvar";
import { resumoSalvar } from "@/lib/produto-grade/resumo";
import {
  COLUNAS_PRODUTO,
  assinaturaPermissoes,
  colunaEditavelNoProduto,
  colunasNaOrdemDaTela,
  colunasVisiveis,
  byKey,
} from "@/lib/produto-grade/colunas";
import {
  categoriaEhAcessorio,
  controleDaColuna,
  dataParaTela,
  opcoesDaColuna,
  resolverRotulosProduto,
  subDaCategoria,
  textoDaCelula,
} from "@/lib/produto-grade/celulas";
import { ordenarLinhasProduto } from "@/lib/produto-grade/ordenar";
import { montarLinhas, type ModeloGradeEntrada } from "@/lib/produto-grade/linhas";

const TUDO = () => true;
const NADA = () => false;
const integravel = (campos: string[]): EstadoModeloIntegracao => ({
  estado: "integravel",
  campos: campos as any,
  marcadoEm: null,
  integradoEm: null,
});

const modelo = (id: string, extra: Partial<ModeloGradeEntrada> = {}): ModeloGradeEntrada =>
  ({
    id,
    rev: 3,
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

const entrada = (o: Partial<Parameters<typeof montarPayloadProduto>[1]> = {}) => ({
  modelo: { origem: "interno", enviado_cad: false },
  canEdit: TUDO,
  estado: null,
  integracaoPronta: true,
  acessorio: false,
  ...o,
});

describe("rascunho do produto", () => {
  it("toda coluna EDITÁVEL do catálogo tem chave no rascunho (e toda chave aponta para uma coluna editável)", () => {
    const colunasDoRascunho = new Set(CHAVES_DRAFT_PRODUTO.map(colunaDaChave));
    const editaveis = COLUNAS_PRODUTO.filter((c) => !c.soLeitura && c.tipo !== "readonly").map(
      (c) => c.key,
    );
    expect([...colunasDoRascunho].sort()).toEqual([...editaveis].sort());
    expect(colunaDaChave("colecao_id")).toBe("colecao"); // colecao_id anda junto da coluna Coleção
  });

  it('produtoParaDraft: vazio = null (nome: "") e NUNCA leva ref/status/custo', () => {
    const d = produtoParaDraft(modelo("A", { nome: null, titulo_pagina: null, preco_venda: 10 }));
    expect(d.nome).toBe("");
    expect(d.titulo_pagina).toBeNull();
    expect(d.preco_venda).toBe(10);
    for (const proibida of [
      "ref",
      "status_planejamento",
      "versao",
      "origem",
      "custo_peca_previsto",
      "data_lancamento",
    ]) {
      expect(proibida in d, proibida).toBe(false);
    }
  });
});

describe("valorParaPayload — mesmas normalizações do Sheet", () => {
  it('Título e Preço anterior VAZIOS = NULL (automático/herdado), nunca "" nem 0', () => {
    expect(valorParaPayload("titulo_pagina", null)).toBeNull();
    expect(valorParaPayload("titulo_pagina", "")).toBeNull();
    expect(valorParaPayload("titulo_pagina", "   ")).toBeNull();
    expect(valorParaPayload("titulo_pagina", "  Vestido | Loja ")).toBe("Vestido | Loja");
    expect(valorParaPayload("preco_anterior", null)).toBeNull();
    expect(valorParaPayload("preco_anterior", 0)).toBeNull();
    expect(valorParaPayload("preco_anterior", 129.9)).toBe(129.9);
  });

  it("preço de venda 0/vazio = NULL; medidas arredondam às casas (peso 3, medidas 2) e 0 vale", () => {
    expect(valorParaPayload("preco_venda", 0)).toBeNull();
    expect(valorParaPayload("preco_venda", null)).toBeNull();
    expect(valorParaPayload("preco_venda", 199.904)).toBe(199.9);
    expect(valorParaPayload("peso_kg", 0.12345)).toBe(0.123);
    expect(valorParaPayload("altura_cm", 10.456)).toBe(10.46);
    expect(valorParaPayload("largura_cm", 0)).toBe(0);
    expect(valorParaPayload("comprimento_cm", null)).toBeNull();
  });

  it("NCM só dígitos/pontos (até 10); texto vazio = NULL; ids vazios = NULL", () => {
    expect(valorParaPayload("ncm", "6104,43.00xx99")).toBe("6104.43.00");
    expect(valorParaPayload("ncm", "")).toBeNull();
    expect(valorParaPayload("descricao_produto", "  ")).toBeNull();
    expect(valorParaPayload("observacoes_gerais", "texto  livre")).toBe("texto  livre");
    expect(valorParaPayload("linha_id", "")).toBeNull();
    expect(valorParaPayload("linha_id", "lin1")).toBe("lin1");
    expect(valorParaPayload("tamanho_tipo", "numero")).toBe("numero");
    expect(valorParaPayload("tamanho_tipo", "xx")).toBeNull();
  });
});

describe("montarPayloadProduto — só o EDITADO, só o que a célula deixaria editar", () => {
  it("leva SÓ os campos tocados (nunca o modelo inteiro)", () => {
    const { payload, omitidas } = montarPayloadProduto({ nome: "Novo", ncm: "6104.43" }, entrada());
    expect(payload).toEqual({ nome: "Novo", ncm: "6104.43" });
    expect(omitidas).toEqual([]);
  });

  it("OMITE a coluna travada pela Integração NESTE produto (nunca envia campo travado) e relata como 'travada'", () => {
    const { payload, omitidas } = montarPayloadProduto(
      { nome: "X", descricao_produto: "d", peso_kg: 1 },
      entrada({ estado: integravel(["nome", "peso"]) }),
    );
    expect(payload).toEqual({ descricao_produto: "d" });
    expect(omitidas.map((o) => [o.key, o.motivo])).toEqual([
      ["nome", "travada"],
      ["peso_kg", "travada"],
    ]);
  });

  it("'Tamanho em' é travado SEMPRE em produto integrável/integrado (marcado ou não)", () => {
    const { payload, omitidas } = montarPayloadProduto(
      { tamanho_tipo: "numero" },
      entrada({ estado: integravel([]) }),
    );
    expect(payload).toEqual({});
    expect(omitidas[0]).toMatchObject({ key: "tamanho_tipo", motivo: "travada" });
  });

  it("estado da Integração AINDA não carregado: coluna travável NÃO vai (nunca livre); a não travável vai", () => {
    const { payload, omitidas } = montarPayloadProduto(
      { nome: "X", observacoes_gerais: "obs" },
      entrada({ integracaoPronta: false }),
    );
    expect(payload).toEqual({ observacoes_gerais: "obs" });
    expect(omitidas).toEqual([expect.objectContaining({ key: "nome", motivo: "travada" })]);
  });

  it("sem a permissão da página/seção a coluna sai (motivo 'nao_edita', sem aviso de trava)", () => {
    const so = (chaves: string[]) => (k: string) => chaves.includes(k);
    const sem = montarPayloadProduto(
      { nome: "X", preco_venda: 10 },
      entrada({ canEdit: so(["criacao_planejamento"]) }),
    );
    expect(sem.payload).toEqual({ nome: "X" });
    expect(sem.omitidas).toEqual([
      expect.objectContaining({ key: "preco_venda", motivo: "nao_edita" }),
    ]);
    const com = montarPayloadProduto(
      { preco_venda: 10 },
      entrada({ canEdit: so(["criacao_planejamento", "criacao_planejamento:preco_venda"]) }),
    );
    expect(com.payload).toEqual({ preco_venda: 10 });
    expect(montarPayloadProduto({ nome: "X" }, entrada({ canEdit: NADA })).payload).toEqual({});
  });

  it("preço de venda de COMPRADO (revenda/importado) nunca vai (derivado no servidor — gatilho B1b)", () => {
    const r = montarPayloadProduto(
      { preco_venda: 10, nome: "X" },
      entrada({ modelo: { origem: "revenda", enviado_cad: false } }),
    );
    expect(r.payload).toEqual({ nome: "X" });
    expect(r.omitidas[0]).toMatchObject({ key: "preco_venda", motivo: "nao_edita" });
  });

  it("card já enviado à Explosão: campo só do Desenvolvimento (Obs. gerais) sai; o do Planejamento vai", () => {
    const so = (k: string) => k === "criacao_desenvolvimento";
    expect(
      montarPayloadProduto(
        { observacoes_gerais: "x" },
        entrada({ canEdit: so, modelo: { origem: "interno", enviado_cad: true } }),
      ).payload,
    ).toEqual({});
    expect(
      montarPayloadProduto({ observacoes_gerais: "x" }, entrada({ canEdit: so })).payload,
    ).toEqual({ observacoes_gerais: "x" });
  });

  it("Acessórios: 'Tamanho em' NÃO se aplica (grade única UN) — não vai mesmo tocado", () => {
    const r = montarPayloadProduto(
      { tamanho_tipo: "numero", nome: "Bolsa" },
      entrada({ acessorio: true }),
    );
    expect(r.payload).toEqual({ nome: "Bolsa" });
    expect(r.omitidas[0]).toMatchObject({ key: "tamanho_tipo", motivo: "nao_edita" });
  });

  it("Título e Preço anterior limpos viram NULL no payload (voltam ao automático)", () => {
    const { payload } = montarPayloadProduto(
      { titulo_pagina: "", preco_anterior: null },
      entrada({ canEdit: TUDO }),
    );
    expect(payload).toEqual({ titulo_pagina: null, preco_anterior: null });
    expect("titulo_pagina" in payload && payload.titulo_pagina === "").toBe(false);
  });

  it("Coleção com OTB leva colecao_id e colecao juntos; categoria e subcategorias vão no MESMO payload", () => {
    const { payload } = montarPayloadProduto(
      {
        colecao_id: "col1",
        colecao: "Verão",
        categoria_principal_id: "cat1",
        subcategoria1_id: null,
        subcategoria2_id: "s2",
      },
      entrada(),
    );
    expect(payload).toEqual({
      colecao: "Verão",
      colecao_id: "col1",
      categoria_principal_id: "cat1",
      subcategoria1_id: null,
      subcategoria2_id: "s2",
    });
  });

  it("nome vazio é recusado (NOT NULL) com texto PT — antes de ir ao servidor", () => {
    expect(() => montarPayloadProduto({ nome: "   " }, entrada())).toThrow(RecusaEsperadaError);
    expect(() => montarPayloadProduto({ nome: null }, entrada())).toThrow(
      "O nome do produto não pode ficar vazio.",
    );
  });

  it("a decisão é a MESMA de `colunaEditavelNoProduto` (anti-drift: payload só tem o que a célula editaria)", () => {
    const estados = [
      null,
      integravel([]),
      integravel(["nome", "ncm", "preco_venda", "titulo", "peso"]),
    ];
    for (const estado of estados) {
      for (const origem of ["interno", "revenda"]) {
        const m = { origem, enviado_cad: false };
        for (const k of CHAVES_DRAFT_PRODUTO) {
          const col = byKey(colunaDaChave(k))!;
          const valor: any =
            k === "nome"
              ? "x"
              : k === "tamanho_tipo"
                ? "numero"
                : typeof valorParaPayload(k, 1) === "number"
                  ? 1
                  : "x";
          const { payload } = montarPayloadProduto({ [k]: valor } as any, {
            modelo: m,
            canEdit: TUDO,
            estado,
            integracaoPronta: true,
            acessorio: false,
          });
          expect(k in payload, `${k} / ${origem} / ${estado?.estado}`).toBe(
            colunaEditavelNoProduto(col, m, TUDO, estado),
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------- salvarProduto: CAS por rev

function clienteFalso(resposta: { data: any; error: any }) {
  const chamadas: { tabela?: string; payload?: any; eqs: [string, unknown][]; select?: string } = {
    eqs: [],
  };
  const client: ClienteModelos = {
    from: (tabela: string) => {
      chamadas.tabela = tabela;
      return {
        update: (payload: any) => {
          chamadas.payload = payload;
          return {
            eq: (c: string, v: unknown) => {
              chamadas.eqs.push([c, v]);
              return {
                eq: (c2: string, v2: unknown) => {
                  chamadas.eqs.push([c2, v2]);
                  return {
                    select: (cols: string) => {
                      chamadas.select = cols;
                      return Promise.resolve(resposta);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, chamadas };
}

const baseSalvar = (client: ClienteModelos, extra: Record<string, unknown> = {}) => ({
  client,
  modelo: { id: "M1", origem: "interno", enviado_cad: false, categoria_principal_id: null },
  revBase: 3,
  mudancas: { nome: "Novo" } as any,
  canEdit: TUDO,
  estado: null,
  integracaoPronta: true,
  acessorio: false,
  ...extra,
});

describe("salvarProduto — CAS por rev + P0409", () => {
  it("UPDATE só com o editado, `.eq(id).eq(rev, revBase).select('id, rev')`, devolve o rev NOVO (re-baseliza o CAS)", async () => {
    const { client, chamadas } = clienteFalso({ data: [{ id: "M1", rev: 4 }], error: null });
    const r = await salvarProduto(baseSalvar(client));
    expect(chamadas.tabela).toBe("modelos");
    expect(chamadas.payload).toEqual({ nome: "Novo" });
    expect(chamadas.eqs).toEqual([
      ["id", "M1"],
      ["rev", 3],
    ]);
    expect(chamadas.select).toBe("id, rev");
    expect(r).toMatchObject({ rev: 4, enviou: true });
  });

  it("0 linhas = P0409 (ConflitoProdutoError, code P0409) — ninguém é sobrescrito", async () => {
    const { client } = clienteFalso({ data: [], error: null });
    const e = await salvarProduto(baseSalvar(client)).catch((x) => x);
    expect(e).toBeInstanceOf(ConflitoProdutoError);
    expect(e.code).toBe("P0409");
    expect(ehConflitoRev(e)).toBe(true);
    expect(textoErroSalvar(e)).toMatch(/Outra pessoa salvou este produto/);
  });

  it("P0409 vindo do banco (gatilho) também é conflito; outros erros não", () => {
    expect(ehConflitoRev({ code: "P0409", message: "conflito_versao: x" })).toBe(true);
    expect(ehConflitoRev({ code: "42501", message: "integracao_travado: nome" })).toBe(false);
    expect(ehConflitoRev(null)).toBe(false);
  });

  it('sem `rev` de base não grava (o `.eq("rev", null)` nunca casaria): vira o mesmo conflito', async () => {
    const { client, chamadas } = clienteFalso({ data: [{ id: "M1", rev: 4 }], error: null });
    await expect(salvarProduto(baseSalvar(client, { revBase: null }))).rejects.toBeInstanceOf(
      ConflitoProdutoError,
    );
    expect(chamadas.payload).toBeUndefined();
  });

  it("tudo omitido (travado/sem permissão) = NADA vai ao servidor (sem UPDATE vazio)", async () => {
    const { client, chamadas } = clienteFalso({ data: [{ id: "M1", rev: 4 }], error: null });
    const r = await salvarProduto(baseSalvar(client, { estado: integravel(["nome"]) }));
    expect(chamadas.payload).toBeUndefined();
    expect(r).toMatchObject({ rev: null, enviou: false });
    expect(r.omitidas[0]).toMatchObject({ key: "nome", motivo: "travada" });
  });

  it("erro do banco propaga (42501 travado traduzido em PT; P0001 de Acessórios+OC idem)", async () => {
    const { client } = clienteFalso({
      data: null,
      error: { code: "42501", message: "integracao_travado: nome" },
    });
    const e = await salvarProduto(baseSalvar(client)).catch((x) => x);
    expect(textoErroSalvar(e)).toMatch(/travado pela Integração/);
    const { client: c2 } = clienteFalso({
      data: null,
      error: { code: "P0001", message: "categoria_acessorio_com_pedido: x" },
    });
    const e2 = await salvarProduto(baseSalvar(c2)).catch((x) => x);
    expect(textoErroSalvar(e2)).toMatch(/pedido \(OC\)/);
  });

  it("troca de categoria de COMPRADO: pré-checagem só-leitura ANTES do UPDATE; recusa vira texto PT e NADA grava", async () => {
    const { client, chamadas } = clienteFalso({ data: [{ id: "M1", rev: 4 }], error: null });
    const conferir = vi
      .fn()
      .mockResolvedValue([{ modeloId: "M1", nome: "X", ref: null, tipo: "PA" }]);
    const e = await salvarProduto(
      baseSalvar(client, {
        modelo: { id: "M1", origem: "revenda", enviado_cad: false, categoria_principal_id: "catA" },
        mudancas: { categoria_principal_id: "catB" },
        conferirCategoria: conferir,
      }),
    ).catch((x) => x);
    expect(conferir).toHaveBeenCalledOnce();
    expect(e).toBeInstanceOf(RecusaEsperadaError);
    expect(e.message).toMatch(/Não dá para trocar a Categoria/);
    expect(chamadas.payload).toBeUndefined();
  });

  it("pré-checagem NÃO roda para interno nem quando a categoria não muda", async () => {
    const conferir = vi.fn().mockResolvedValue([]);
    const { client } = clienteFalso({ data: [{ id: "M1", rev: 4 }], error: null });
    await salvarProduto(
      baseSalvar(client, {
        mudancas: { categoria_principal_id: "catB" },
        conferirCategoria: conferir,
      }),
    );
    expect(conferir).not.toHaveBeenCalled();
    await salvarProduto(
      baseSalvar(client, {
        modelo: { id: "M1", origem: "revenda", enviado_cad: false, categoria_principal_id: "catA" },
        mudancas: { nome: "x" },
        conferirCategoria: conferir,
      }),
    );
    expect(conferir).not.toHaveBeenCalled();
  });
});

describe("resumoSalvar — resultado PARCIAL", () => {
  const ok = (id: string, extra: object = {}) => ({
    id,
    nome: id,
    tipo: "ok" as const,
    enviou: true,
    ...extra,
  });
  it("tudo salvo", () => {
    expect(resumoSalvar([ok("A"), ok("B")])).toEqual({
      tom: "sucesso",
      texto: "2 produtos salvos.",
      detalhe: undefined,
    });
    expect(resumoSalvar([ok("A")]).texto).toBe("1 produto salvo.");
  });
  it("conflito (P0409) em 1 não derruba os outros: aviso com o que salvou e o que ficou", () => {
    const r = resumoSalvar([ok("A"), { id: "B", nome: "B", tipo: "conflito" }, ok("C")]);
    expect(r.tom).toBe("aviso");
    expect(r.texto).toBe("2 produtos salvos; 1 não salvou.");
    expect(r.detalhe).toMatch(/salvo por outra pessoa antes/);
  });
  it("nada salvo = erro; erro de linha aponta o aviso na linha", () => {
    const r = resumoSalvar([{ id: "A", nome: "A", tipo: "erro" }]);
    expect(r.tom).toBe("erro");
    expect(r.detalhe).toMatch(/aviso vermelho na própria linha/);
  });
  it("campo travado pela Integração não enviado é AVISADO (e não conta como salvo se nada foi)", () => {
    const o = [{ key: "nome", rotulo: "Nome", motivo: "travada" as const }];
    const r1 = resumoSalvar([{ id: "A", nome: "Vestido", tipo: "ok", enviou: false, omitidas: o }]);
    expect(r1.texto).toBe("Nada foi enviado ao servidor.");
    expect(r1.detalhe).toContain("Vestido (Nome)");
    const r2 = resumoSalvar([ok("B", { omitidas: o })]);
    expect(r2.tom).toBe("aviso");
    expect(r2.texto).toBe("1 produto salvo.");
  });
  it("'nao_edita' (permissão/origem) não gera aviso de trava", () => {
    const r = resumoSalvar([
      ok("A", { omitidas: [{ key: "preco_venda", rotulo: "Preço", motivo: "nao_edita" }] }),
    ]);
    expect(r.tom).toBe("sucesso");
    expect(r.detalhe).toBeUndefined();
  });
});

// ---------------------------------------------------------------- colunas / células / ordenar

describe("colunas (PR-2): integração pronta, ordem da tela, assinatura", () => {
  it("`integracaoPronta:false` bloqueia só as colunas TRAVÁVEIS; default (omitido) = pronta", () => {
    const nome = byKey("nome")!;
    const obs = byKey("observacoes_gerais")!;
    const m = { origem: "interno", enviado_cad: false };
    expect(colunaEditavelNoProduto(nome, m, TUDO, null)).toBe(true);
    expect(colunaEditavelNoProduto(nome, m, TUDO, null, { integracaoPronta: false })).toBe(false);
    expect(
      colunaEditavelNoProduto(byKey("tamanho_tipo")!, m, TUDO, null, { integracaoPronta: false }),
    ).toBe(false);
    expect(colunaEditavelNoProduto(obs, m, TUDO, null, { integracaoPronta: false })).toBe(true);
  });

  it("Nome vem PRIMEIRO (coluna fixa); as demais seguem na ordem do catálogo", () => {
    const cols = colunasNaOrdemDaTela(COLUNAS_PRODUTO);
    expect(cols[0].key).toBe("nome");
    expect(cols.map((c) => c.key).filter((k) => k !== "nome")).toEqual(
      COLUNAS_PRODUTO.map((c) => c.key).filter((k) => k !== "nome"),
    );
    expect(cols).toHaveLength(COLUNAS_PRODUTO.length);
  });

  it("a assinatura de permissões só muda quando o RESULTADO muda e cobre tudo o que as colunas consultam", () => {
    const a = assinaturaPermissoes(TUDO, TUDO);
    expect(
      assinaturaPermissoes(
        (k) => !!k,
        (k) => !!k,
      ),
    ).toBe(a); // outra função, mesmo resultado
    expect(assinaturaPermissoes(TUDO, NADA)).not.toBe(a);
    // visibilidade das colunas segue a assinatura
    const verTudo = colunasVisiveis(TUDO, TUDO).length;
    const verSo = colunasVisiveis((k) => k === "criacao_planejamento", NADA).length;
    expect(verTudo).toBeGreaterThan(verSo);
  });
});

describe("células: controle, opções em cascata, textos", () => {
  const op: any = {
    estilistas: [{ id: "e1", nome: "Ana" }],
    linhas: [{ id: "l1", nome: "Casual" }],
    meses: [{ id: "m1", nome: "Janeiro" }],
    anos: [{ id: "a1", nome: "2027" }],
    grupos: [
      { id: "g1", nome: "Vestuário" },
      { id: "g2", nome: "Acessórios" },
    ],
    categorias: [
      { id: "c1", nome: "Vestido", grupo_id: "g1" },
      { id: "c2", nome: "Bolsa", grupo_id: "g2" },
    ],
    subcategorias1: [
      { id: "s1", nome: "Longo", categoria_id: "c1" },
      { id: "s2", nome: "Tote", categoria_id: "c2" },
    ],
    subcategorias2: [{ id: "t1", nome: "Manga", categoria_id: "c1" }],
    colecoes: [{ id: "col1", nome: "Verão" }],
    subcolecoesPorColecao: new Map([["col1", ["Sub A", "Sub B"]]]),
    semanas: [{ id: "1", nome: "1" }],
    tamanhoTipos: [{ id: "letra", nome: "Letra" }],
  };

  it("Coleção/Subcoleção: dropdown SÓ com OTB; sem OTB é texto livre", () => {
    expect(controleDaColuna(byKey("colecao")!, true)).toBe("select");
    expect(controleDaColuna(byKey("colecao")!, false)).toBe("texto");
    expect(controleDaColuna(byKey("subcolecao")!, false)).toBe("texto");
    expect(controleDaColuna(byKey("linha_id")!, false)).toBe("select");
    expect(controleDaColuna(byKey("peso_kg")!, false)).toBe("money");
    expect(controleDaColuna(byKey("ref")!, true)).toBe("somente-leitura");
    expect(controleDaColuna(byKey("preco_atacado")!, true)).toBe("somente-leitura");
  });

  it("Subcategorias cascateiam pela categoria; Subcoleção, pela coleção; valor órfão entra para não 'esvaziar'", () => {
    const ctx = (extra: object) => ({ categoriaId: null, colecaoId: null, atual: null, ...extra });
    expect(
      opcoesDaColuna("subcategoria1_id", op, ctx({ categoriaId: "c1" })).map((o) => o.id),
    ).toEqual(["s1"]);
    expect(opcoesDaColuna("subcategoria1_id", op, ctx({ categoriaId: null }))).toEqual([]);
    expect(
      opcoesDaColuna("subcategoria1_id", op, ctx({ categoriaId: "c1", atual: "sX" })).map(
        (o) => o.id,
      ),
    ).toEqual(["s1", "sX"]);
    expect(opcoesDaColuna("subcolecao", op, ctx({ colecaoId: "col1" })).map((o) => o.id)).toEqual([
      "Sub A",
      "Sub B",
    ]);
    expect(subDaCategoria(op.subcategorias1, "s1", "c1")).toBe(true);
    expect(subDaCategoria(op.subcategorias1, "s1", "c2")).toBe(false);
    expect(subDaCategoria(op.subcategorias1, null, "c2")).toBe(true);
  });

  it("Acessórios é pelo GRUPO da categoria (ehGrupoAcessorio)", () => {
    expect(categoriaEhAcessorio(op, "c2")).toBe(true);
    expect(categoriaEhAcessorio(op, "c1")).toBe(false);
    expect(categoriaEhAcessorio(op, null)).toBe(false);
  });

  it("textos de leitura: rótulo (não o id), data sem fuso, versão, status pelo nome da etapa, número com casas", () => {
    const resolver = resolverRotulosProduto(op);
    const l = montarLinhas([
      modelo("A", {
        linha_id: "l1",
        categoria_principal_id: "c1",
        versao: 2,
        status_planejamento: "planejado",
        data_lancamento: "2026-11-23",
        origem: "revenda",
        preco_atacado: 1234.5,
        peso_kg: 0.25,
      }),
    ])[0];
    expect(textoDaCelula(l, byKey("linha_id")!, resolver)).toBe("Casual");
    expect(textoDaCelula(l, byKey("grupo")!, resolver)).toBe("Vestuário");
    expect(textoDaCelula(l, byKey("versao")!, resolver)).toBe("v2");
    expect(textoDaCelula(l, byKey("status_planejamento")!, resolver)).toBe("Planejado");
    expect(textoDaCelula(l, byKey("data_lancamento")!, resolver)).toBe("23/11/2026");
    expect(textoDaCelula(l, byKey("origem")!, resolver)).toBe("Revenda");
    expect(textoDaCelula(l, byKey("preco_atacado")!, resolver)).toBe("1.234,50");
    expect(textoDaCelula(l, byKey("peso_kg")!, resolver)).toBe("0,250");
    expect(textoDaCelula(l, byKey("ncm")!, resolver)).toBeNull();
    expect(dataParaTela("2026-11-23T00:00:00+00:00")).toBe("23/11/2026");
    expect(dataParaTela("")).toBeNull();
  });
});

describe("ordenar por coluna (valor SALVO, vazio por último, estável)", () => {
  it("asc/desc por texto e por número; vazios sempre por último; empate mantém a ordem recebida", () => {
    const l = montarLinhas([
      modelo("A", { nome: "Zeta", peso_kg: 2 }),
      modelo("B", { nome: "Alfa", peso_kg: null }),
      modelo("C", { nome: "Meio", peso_kg: 1 }),
      modelo("D", { nome: "alfa", peso_kg: 2 }),
    ]);
    const ids = (xs: typeof l) => xs.map((x) => x.modeloId);
    expect(ids(ordenarLinhasProduto(l, byKey("nome")!, "asc"))).toEqual(["B", "D", "C", "A"]);
    expect(ids(ordenarLinhasProduto(l, byKey("nome")!, "desc"))).toEqual(["A", "C", "B", "D"]);
    expect(ids(ordenarLinhasProduto(l, byKey("peso_kg")!, "asc"))).toEqual(["C", "A", "D", "B"]);
    expect(ids(ordenarLinhasProduto(l, byKey("peso_kg")!, "desc"))).toEqual(["A", "D", "C", "B"]);
    expect(ids(l)).toEqual(["A", "B", "C", "D"]); // a entrada não muda
  });

  it("ordena selects pelo RÓTULO, não pelo id", () => {
    const resolver = resolverRotulosProduto({
      linhas: [
        { id: "z", nome: "Alfa" },
        { id: "a", nome: "Zeta" },
      ],
      meses: [],
      anos: [],
      estilistas: [],
      categorias: [],
      subcategorias1: [],
      subcategorias2: [],
      grupos: [],
    } as any);
    const l = montarLinhas([modelo("A", { linha_id: "a" }), modelo("B", { linha_id: "z" })]);
    expect(
      ordenarLinhasProduto(l, byKey("linha_id")!, "asc", resolver).map((x) => x.modeloId),
    ).toEqual(["B", "A"]);
  });
});
