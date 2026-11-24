import { describe, it, expect } from "vitest";
import {
  COLUNAS_PRODUTO,
  byKey,
  chaveDePermissao,
  colunaEditavelNoProduto,
  colunaTravadaPelaIntegracao,
  colunaVisivel,
  colunasVisiveis,
  indiceDaColuna,
  type ColunaProduto,
  type ProdutoEdicao,
} from "@/lib/produto-grade/colunas";
import {
  CAMPOS_COMPARTILHADOS_DRAFT,
  CAMPOS_DEV_DRAFT,
  CAMPOS_SO_PLANEJAMENTO_DRAFT,
} from "@/components/planejamento/planejamento-detail/helpers";
import { CAMPOS } from "@/lib/integracao/campos";
import { SEMPRE_TRAVADO, type EstadoModeloIntegracao } from "@/lib/integracao/trava";
import type { CampoKey } from "@/lib/integracao/campos";

const col = (k: string): ColunaProduto => byKey(k)!;
const set =
  (...chaves: string[]) =>
  (k: string) =>
    chaves.includes(k);
const nada = () => false;
const PLAN = "criacao_planejamento";
const DEV = "criacao_desenvolvimento";
const P_VENDA = "criacao_planejamento:preco_venda";
const P_ATAC = "criacao_planejamento:preco_atacado";
const CUSTOS = "criacao_planejamento:custos";
const interno: ProdutoEdicao = { origem: "interno", enviado_cad: false };
const estado = (
  campos: CampoKey[],
  e: "integravel" | "integrado" = "integravel",
): EstadoModeloIntegracao => ({
  estado: e,
  campos,
  marcadoEm: null,
  integradoEm: null,
});

describe("COLUNAS_PRODUTO — catálogo", () => {
  it("chaves únicas, rótulos PT-BR preenchidos e REF é a 1ª coluna", () => {
    const keys = COLUNAS_PRODUTO.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of COLUNAS_PRODUTO) expect(c.rotulo.length).toBeGreaterThan(0);
    expect(keys[0]).toBe("ref");
    expect(indiceDaColuna("ref")).toBe(0);
    expect(indiceDaColuna("nao-existe")).toBe(-1);
  });

  it("NÃO tem coluna de custo nem ref_auto (custo é escondido por permissão; a sigla pré-revelação não aparece)", () => {
    const keys = COLUNAS_PRODUTO.map((c) => c.key);
    expect(keys).not.toContain("ref_auto");
    expect(keys.filter((k) => k.startsWith("custo"))).toEqual([]);
  });

  it("tem as colunas do brief (texto, medidas, preço, planejamento, taxonomia, tamanho)", () => {
    for (const k of [
      "ref",
      "status_planejamento",
      "nome",
      "descricao_produto",
      "ncm",
      "titulo_pagina",
      "observacoes_gerais",
      "observacoes_mao_obra",
      "peso_kg",
      "comprimento_cm",
      "largura_cm",
      "altura_cm",
      "preco_venda",
      "preco_anterior",
      "preco_atacado",
      "colecao",
      "subcolecao",
      "semana",
      "linha_id",
      "mes_id",
      "ano_id",
      "estilista_id",
      "categoria_principal_id",
      "subcategoria1_id",
      "subcategoria2_id",
      "tamanho_tipo",
    ]) {
      expect(byKey(k), k).toBeDefined();
    }
  });

  it("só-leitura: REF, status/kanban, versão, origem, data de lançamento, grupo (derivado) e atacado", () => {
    for (const k of [
      "ref",
      "status_planejamento",
      "versao",
      "origem",
      "data_lancamento",
      "grupo",
      "preco_atacado",
    ]) {
      expect(col(k).soLeitura, k).toBe(true);
    }
    // nenhuma coluna editável é do tipo "readonly" e vice-versa (tipo e flag não podem divergir)
    for (const c of COLUNAS_PRODUTO) {
      if (c.tipo === "readonly") expect(c.soLeitura, c.key).toBe(true);
    }
  });

  it("taxonomia (categoria/sub1/sub2) é editável e documenta o gatilho REF+espelho", () => {
    for (const k of ["categoria_principal_id", "subcategoria1_id", "subcategoria2_id"]) {
      expect(col(k).soLeitura).toBeFalsy();
      expect(col(k).tipo).toBe("select");
      expect(col(k).disparaRegra).toMatch(/REF\+espelho/);
    }
  });

  it("preço de venda/anterior exigem a seção preco_venda; atacado a seção preco_atacado; Obs. M.O. a seção custos", () => {
    expect(col("preco_venda").permissao).toBe("preco_venda");
    expect(col("preco_anterior").permissao).toBe("preco_venda");
    expect(col("preco_atacado").permissao).toBe("preco_atacado");
    expect(col("observacoes_mao_obra").permissao).toBe("custos");
    // ninguém mais tem seção
    const comPerm = COLUNAS_PRODUTO.filter((c) => c.permissao)
      .map((c) => c.key)
      .sort();
    expect(comPerm).toEqual([
      "observacoes_mao_obra",
      "preco_anterior",
      "preco_atacado",
      "preco_venda",
    ]);
  });

  it("chaves de permissão = as do catálogo/preco-permissao", () => {
    expect(chaveDePermissao("custos")).toBe(CUSTOS);
    expect(chaveDePermissao("preco_venda")).toBe(P_VENDA);
    expect(chaveDePermissao("preco_atacado")).toBe(P_ATAC);
  });
});

describe("anti-drift — as flags batem com o Sheet e com a Integração", () => {
  // Cada coluna EDITÁVEL tem o MESMO dono que o Sheet dá ao campo (CAMPOS_*_DRAFT, P-53 A).
  const DONO_DO_SHEET = new Map<string, "planejamento" | "compartilhado" | "dev">();
  for (const k of CAMPOS_SO_PLANEJAMENTO_DRAFT) DONO_DO_SHEET.set(k, "planejamento");
  for (const k of CAMPOS_COMPARTILHADOS_DRAFT) DONO_DO_SHEET.set(k, "compartilhado");
  for (const k of CAMPOS_DEV_DRAFT) DONO_DO_SHEET.set(k, "dev");

  it("dono de toda coluna editável = o do Sheet (nem ganha, nem perde)", () => {
    for (const c of COLUNAS_PRODUTO) {
      if (c.soLeitura) continue;
      // `colecao` e `subcolecao` etc. estão nas listas; `grupo` (derivado) é só-leitura e fica de fora.
      expect(
        DONO_DO_SHEET.has(c.key),
        `${c.key} precisa estar numa lista CAMPOS_*_DRAFT do Sheet`,
      ).toBe(true);
      expect(c.dono, c.key).toBe(DONO_DO_SHEET.get(c.key));
    }
  });

  it("travavelIntegracao ⇔ a coluna é a `coluna` de algum campo da API (ou SEMPRE_TRAVADO)", () => {
    const colunasDaApi = new Set<string>(
      CAMPOS.map((c) => c.coluna).filter((c): c is NonNullable<typeof c> => !!c),
    );
    for (const c of COLUNAS_PRODUTO) {
      if (c.soLeitura) continue;
      const esperado =
        colunasDaApi.has(c.key as never) || (SEMPRE_TRAVADO as readonly string[]).includes(c.key);
      expect(!!c.travavelIntegracao, `${c.key} travavelIntegracao`).toBe(esperado);
    }
  });

  it("sempreTravadaIntegracao ⇔ SEMPRE_TRAVADO da Integração (só tamanho_tipo é coluna do produto)", () => {
    const sempre = COLUNAS_PRODUTO.filter((c) => c.sempreTravadaIntegracao).map((c) => c.key);
    const doBanco = (SEMPRE_TRAVADO as readonly string[]).filter((k) => byKey(k));
    expect(sempre.sort()).toEqual(doBanco.sort());
    expect(sempre).toEqual(["tamanho_tipo"]);
  });

  it("preço ATACADO nunca é travável (a Integração trava só o varejo)", () => {
    expect(col("preco_atacado").travavelIntegracao).toBeFalsy();
  });
});

describe("colunasVisiveis — esconde preço/custo sem a seção", () => {
  it("sem nenhuma permissão: some preço (3), Obs. M.O.; ficam as colunas livres", () => {
    const keys = colunasVisiveis(nada, nada).map((c) => c.key);
    for (const k of ["preco_venda", "preco_anterior", "preco_atacado", "observacoes_mao_obra"]) {
      expect(keys, k).not.toContain(k);
    }
    for (const k of ["ref", "nome", "ncm", "categoria_principal_id", "tamanho_tipo"])
      expect(keys, k).toContain(k);
  });

  it("varejo e atacado são INDEPENDENTES (e independem de custos)", () => {
    const soVarejo = colunasVisiveis(set(P_VENDA), nada).map((c) => c.key);
    expect(soVarejo).toContain("preco_venda");
    expect(soVarejo).toContain("preco_anterior");
    expect(soVarejo).not.toContain("preco_atacado");
    expect(soVarejo).not.toContain("observacoes_mao_obra");

    const soAtacado = colunasVisiveis(set(P_ATAC), nada).map((c) => c.key);
    expect(soAtacado).toContain("preco_atacado");
    expect(soAtacado).not.toContain("preco_venda");

    const soCustos = colunasVisiveis(set(CUSTOS), nada).map((c) => c.key);
    expect(soCustos).toContain("observacoes_mao_obra");
    expect(soCustos).not.toContain("preco_venda");
  });

  it("EDITAR a seção também mostra a coluna (o Editor inclui ver)", () => {
    expect(colunaVisivel(col("preco_venda"), nada, set(P_VENDA))).toBe(true);
    expect(colunaVisivel(col("preco_venda"), nada, nada)).toBe(false);
  });

  it("com tudo liberado mostra todas as colunas, na ordem do catálogo", () => {
    expect(
      colunasVisiveis(
        () => true,
        () => true,
      ).map((c) => c.key),
    ).toEqual(COLUNAS_PRODUTO.map((c) => c.key));
  });
});

describe("colunaEditavelNoProduto — permissão", () => {
  it("coluna só-leitura NUNCA edita, nem com todas as permissões", () => {
    const tudo = () => true;
    for (const k of [
      "ref",
      "status_planejamento",
      "versao",
      "origem",
      "data_lancamento",
      "grupo",
      "preco_atacado",
    ]) {
      expect(colunaEditavelNoProduto(col(k), interno, tudo, null), k).toBe(false);
    }
  });

  it("campo SÓ do Planejamento (NCM, título, medidas, tamanho): exige editar o Planejamento — editar só o Dev NÃO basta", () => {
    for (const k of ["ncm", "titulo_pagina", "descricao_produto", "peso_kg", "tamanho_tipo"]) {
      expect(colunaEditavelNoProduto(col(k), interno, set(PLAN), null), k).toBe(true);
      expect(colunaEditavelNoProduto(col(k), interno, set(DEV), null), k).toBe(false);
      expect(colunaEditavelNoProduto(col(k), interno, nada, null), k).toBe(false);
    }
  });

  it("campo COMPARTILHADO (nome, categoria…): Planejamento OU Dev (Dev só com o card fora da Explosão)", () => {
    for (const k of ["nome", "categoria_principal_id", "linha_id", "estilista_id", "colecao"]) {
      expect(colunaEditavelNoProduto(col(k), interno, set(PLAN), null), k).toBe(true);
      expect(colunaEditavelNoProduto(col(k), interno, set(DEV), null), k).toBe(true);
      expect(
        colunaEditavelNoProduto(col(k), { ...interno, enviado_cad: true }, set(DEV), null),
        `${k} dev pós-Explosão`,
      ).toBe(false);
      expect(
        colunaEditavelNoProduto(col(k), { ...interno, enviado_cad: true }, set(PLAN), null),
        `${k} plan pós-Explosão`,
      ).toBe(true);
      expect(colunaEditavelNoProduto(col(k), interno, nada, null), k).toBe(false);
    }
  });

  it("campo do Dev (observações gerais): só o Dev, e trava pós-Explosão", () => {
    const c = col("observacoes_gerais");
    expect(colunaEditavelNoProduto(c, interno, set(DEV), null)).toBe(true);
    expect(colunaEditavelNoProduto(c, interno, set(PLAN), null)).toBe(false);
    expect(colunaEditavelNoProduto(c, { ...interno, enviado_cad: true }, set(DEV), null)).toBe(
      false,
    );
  });

  it("preço de venda: exige editar a seção E o Planejamento (a seção sozinha perderia o valor — P-53 A)", () => {
    const c = col("preco_venda");
    expect(colunaEditavelNoProduto(c, interno, set(PLAN, P_VENDA), null)).toBe(true);
    expect(colunaEditavelNoProduto(c, interno, set(P_VENDA), null)).toBe(false);
    expect(colunaEditavelNoProduto(c, interno, set(PLAN), null)).toBe(false);
    // atacado não destrava o varejo
    expect(colunaEditavelNoProduto(c, interno, set(PLAN, P_ATAC), null)).toBe(false);
    // preço anterior segue a seção do varejo
    expect(colunaEditavelNoProduto(col("preco_anterior"), interno, set(PLAN, P_VENDA), null)).toBe(
      true,
    );
    expect(colunaEditavelNoProduto(col("preco_anterior"), interno, set(PLAN, P_ATAC), null)).toBe(
      false,
    );
  });

  it("Obs. de M.O.: exige editar custos (além de planejamento/dev)", () => {
    const c = col("observacoes_mao_obra");
    expect(colunaEditavelNoProduto(c, interno, set(PLAN, CUSTOS), null)).toBe(true);
    expect(colunaEditavelNoProduto(c, interno, set(PLAN), null)).toBe(false);
    expect(colunaEditavelNoProduto(c, interno, set(CUSTOS), null)).toBe(false);
  });

  it("preço de venda de produto COMPRADO (revenda/importado) é só-leitura na grade (derivado, B1b)", () => {
    const c = col("preco_venda");
    const edita = set(PLAN, P_VENDA);
    expect(colunaEditavelNoProduto(c, { origem: "interno" }, edita, null)).toBe(true);
    expect(colunaEditavelNoProduto(c, { origem: null }, edita, null)).toBe(true); // ausente = interno
    expect(colunaEditavelNoProduto(c, { origem: "revenda" }, edita, null)).toBe(false);
    expect(colunaEditavelNoProduto(c, { origem: "importado" }, edita, null)).toBe(false);
    // preço anterior não é derivado do comprado
    expect(colunaEditavelNoProduto(col("preco_anterior"), { origem: "revenda" }, edita, null)).toBe(
      true,
    );
  });
});

describe("colunaEditavelNoProduto — trava da Integração POR PRODUTO", () => {
  const edita = set(PLAN, P_VENDA, DEV);

  it("sem estado (produto não integrável) nada é travado", () => {
    for (const k of ["nome", "ncm", "preco_venda", "tamanho_tipo", "peso_kg"]) {
      expect(colunaEditavelNoProduto(col(k), interno, edita, null), k).toBe(true);
      expect(colunaEditavelNoProduto(col(k), interno, edita, undefined), k).toBe(true);
    }
  });

  it("campo MARCADO na Integração trava; o NÃO marcado segue livre (mesmo produto)", () => {
    const e = estado(["nome", "preco_venda", "ncm"]);
    expect(colunaEditavelNoProduto(col("nome"), interno, edita, e)).toBe(false);
    expect(colunaEditavelNoProduto(col("preco_venda"), interno, edita, e)).toBe(false);
    expect(colunaEditavelNoProduto(col("ncm"), interno, edita, e)).toBe(false);
    // não marcados
    expect(colunaEditavelNoProduto(col("titulo_pagina"), interno, edita, e)).toBe(true);
    expect(colunaEditavelNoProduto(col("peso_kg"), interno, edita, e)).toBe(true);
    expect(colunaEditavelNoProduto(col("preco_anterior"), interno, edita, e)).toBe(true);
  });

  it("a trava é por PRODUTO: o mesmo catálogo, 2 produtos, 2 respostas", () => {
    const e = estado(["nome"]);
    const trav = colunaEditavelNoProduto(col("nome"), interno, edita, e);
    const livre = colunaEditavelNoProduto(col("nome"), interno, edita, null);
    expect([trav, livre]).toEqual([false, true]);
  });

  it("tamanho_tipo é travado SEMPRE com QUALQUER estado (marcado ou não; integrável ou integrado)", () => {
    expect(colunaEditavelNoProduto(col("tamanho_tipo"), interno, edita, estado([]))).toBe(false);
    expect(
      colunaEditavelNoProduto(col("tamanho_tipo"), interno, edita, estado(["nome"], "integrado")),
    ).toBe(false);
    expect(colunaEditavelNoProduto(col("tamanho_tipo"), interno, edita, null)).toBe(true);
  });

  it("taxonomia, coleção e preço ATACADO nunca são travados pela Integração", () => {
    const e = estado([
      "nome",
      "ref_sku",
      "preco_venda",
      "preco_anterior",
      "peso",
      "ncm",
      "titulo",
      "descricao",
      "comprimento",
      "largura",
      "altura",
      "foto",
    ]);
    for (const k of [
      "categoria_principal_id",
      "subcategoria1_id",
      "subcategoria2_id",
      "colecao",
      "linha_id",
      "estilista_id",
      "observacoes_gerais",
    ]) {
      expect(colunaEditavelNoProduto(col(k), interno, edita, e), k).toBe(true);
    }
  });

  it("a trava soma com a permissão (sem permissão continua não editando, com ou sem trava)", () => {
    expect(colunaEditavelNoProduto(col("titulo_pagina"), interno, nada, estado(["titulo"]))).toBe(
      false,
    );
    expect(colunaEditavelNoProduto(col("titulo_pagina"), interno, nada, null)).toBe(false);
  });

  it("colunaTravadaPelaIntegracao só informa a trava (não olha permissão)", () => {
    expect(colunaTravadaPelaIntegracao(col("nome"), estado(["nome"]))).toBe(true);
    expect(colunaTravadaPelaIntegracao(col("nome"), estado(["ncm"]))).toBe(false);
    expect(colunaTravadaPelaIntegracao(col("tamanho_tipo"), estado([]))).toBe(true);
    expect(colunaTravadaPelaIntegracao(col("tamanho_tipo"), null)).toBe(false);
    expect(colunaTravadaPelaIntegracao(col("categoria_principal_id"), estado(["nome"]))).toBe(
      false,
    );
  });
});
