import { describe, it, expect } from "vitest";
import {
  REVENDA_CAMPOS_DEFAULT_OFF,
  REVENDA_CAMPO_KEYS,
  REVENDA_SECAO_KEYS,
  revendaCampoVisivel,
  revendaColunaPermitida,
  revendaRequisitos,
  lerRevendaConfig,
  type RevendaConfig,
} from "@/lib/revenda-config";

describe("REVENDA_CAMPOS_DEFAULT_OFF", () => {
  it("tem exatamente os 9 campos + 3 seções (12 no total)", () => {
    expect(REVENDA_CAMPOS_DEFAULT_OFF).toHaveLength(12);
    expect(REVENDA_CAMPOS_DEFAULT_OFF).toEqual(
      expect.arrayContaining([
        "modelista_id",
        "piloteiro1_id",
        "piloteiro2_id",
        "piloteiro3_id",
        "data_piloto1",
        "data_piloto2",
        "data_piloto3",
        "data_desenho_tecnico",
        "data_aprovacao",
        "prova",
        "s2",
        "s-cad",
      ]),
    );
  });
});

describe("REVENDA_CAMPO_KEYS / REVENDA_SECAO_KEYS", () => {
  it("REVENDA_CAMPO_KEYS tem as 9 chaves de Info Básicas", () => {
    expect(REVENDA_CAMPO_KEYS).toHaveLength(9);
    expect(REVENDA_CAMPO_KEYS).toEqual([
      "modelista_id",
      "piloteiro1_id",
      "piloteiro2_id",
      "piloteiro3_id",
      "data_piloto1",
      "data_piloto2",
      "data_piloto3",
      "data_desenho_tecnico",
      "data_aprovacao",
    ]);
  });

  it("REVENDA_SECAO_KEYS tem as 9 seções do Sheet, na ordem do accordion", () => {
    expect(REVENDA_SECAO_KEYS).toEqual(["s1", "prova", "s2", "s-cad", "s3", "s3e", "s4", "s5", "s6"]);
  });
});

describe("revendaCampoVisivel", () => {
  it("os 9 campos default-OFF ficam invisíveis sem override (cfg undefined)", () => {
    for (const key of REVENDA_CAMPO_KEYS) {
      expect(revendaCampoVisivel(undefined, key)).toBe(false);
    }
  });

  it("as 3 seções default-OFF (prova, s2, s-cad) ficam invisíveis sem override", () => {
    expect(revendaCampoVisivel(undefined, "prova")).toBe(false);
    expect(revendaCampoVisivel(undefined, "s2")).toBe(false);
    expect(revendaCampoVisivel(undefined, "s-cad")).toBe(false);
  });

  it('"nome" e "s1" são SEMPRE visíveis, mesmo com override explícito false e cfg null', () => {
    expect(revendaCampoVisivel(null, "nome")).toBe(true);
    expect(revendaCampoVisivel(null, "s1")).toBe(true);
    const cfg: RevendaConfig = { colunas: [], requisitos: {}, campos: { nome: false, s1: false } };
    expect(revendaCampoVisivel(cfg, "nome")).toBe(true);
    expect(revendaCampoVisivel(cfg, "s1")).toBe(true);
  });

  it("campo não-listado (fora do default-OFF) fica visível por padrão", () => {
    expect(revendaCampoVisivel(undefined, "s3")).toBe(true);
    expect(revendaCampoVisivel(undefined, "s4")).toBe(true);
    expect(revendaCampoVisivel(undefined, "algum_campo_qualquer")).toBe(true);
  });

  it("override explícito é respeitado nos dois sentidos", () => {
    const cfgLiga: RevendaConfig = { colunas: [], requisitos: {}, campos: { modelista_id: true } };
    expect(revendaCampoVisivel(cfgLiga, "modelista_id")).toBe(true);

    const cfgDesliga: RevendaConfig = { colunas: [], requisitos: {}, campos: { s3: false } };
    expect(revendaCampoVisivel(cfgDesliga, "s3")).toBe(false);
  });
});

describe("revendaColunaPermitida", () => {
  it("colunas vazio/ausente = todas permitidas", () => {
    expect(revendaColunaPermitida(undefined, "qualquer_coluna")).toBe(true);
    expect(revendaColunaPermitida(null, "aprovado")).toBe(true);
    const cfg: RevendaConfig = { colunas: [], requisitos: {}, campos: {} };
    expect(revendaColunaPermitida(cfg, "em_modelagem")).toBe(true);
  });

  it("lista não-vazia = só as listadas são permitidas", () => {
    const cfg: RevendaConfig = { colunas: ["em_modelagem", "aprovado"], requisitos: {}, campos: {} };
    expect(revendaColunaPermitida(cfg, "em_modelagem")).toBe(true);
    expect(revendaColunaPermitida(cfg, "aprovado")).toBe(true);
    expect(revendaColunaPermitida(cfg, "corte_piloto")).toBe(false);
  });
});

describe("revendaRequisitos", () => {
  it("ausente (sem cfg, sem coluna, ou objeto vazio) = []", () => {
    expect(revendaRequisitos(undefined, "aprovado")).toEqual([]);
    expect(revendaRequisitos(null, "aprovado")).toEqual([]);
    const cfg: RevendaConfig = { colunas: [], requisitos: {}, campos: {} };
    expect(revendaRequisitos(cfg, "aprovado")).toEqual([]);
  });

  it("retorna a lista configurada para a coluna", () => {
    const cfg: RevendaConfig = {
      colunas: [],
      requisitos: { aprovado: ["preco_venda_preenchido", "lancado"] },
      campos: {},
    };
    expect(revendaRequisitos(cfg, "aprovado")).toEqual(["preco_venda_preenchido", "lancado"]);
    expect(revendaRequisitos(cfg, "outra_coluna")).toEqual([]);
  });
});

describe("lerRevendaConfig", () => {
  it("tenant_config nulo/undefined → RevendaConfig vazio válido", () => {
    expect(lerRevendaConfig(null)).toEqual({ colunas: [], requisitos: {}, campos: {} });
    expect(lerRevendaConfig(undefined)).toEqual({ colunas: [], requisitos: {}, campos: {} });
    expect(lerRevendaConfig({})).toEqual({ colunas: [], requisitos: {}, campos: {} });
  });

  it("parse robusto de tenant_config parcial (só uma das 3 chaves presente)", () => {
    expect(lerRevendaConfig({ revenda_kanban_colunas: ["aprovado"] })).toEqual({
      colunas: ["aprovado"],
      requisitos: {},
      campos: {},
    });
    expect(
      lerRevendaConfig({ revenda_campos: { modelista_id: true, s2: false } }),
    ).toEqual({
      colunas: [],
      requisitos: {},
      campos: { modelista_id: true, s2: false },
    });
  });

  it("parse robusto de tipos errados/malformados (ignora silenciosamente, não quebra)", () => {
    expect(
      lerRevendaConfig({
        revenda_kanban_colunas: "nao-e-array",
        revenda_kanban_requisitos: ["nao-e-objeto"],
        revenda_campos: null,
      }),
    ).toEqual({ colunas: [], requisitos: {}, campos: {} });

    // valores de tipo errado dentro de um objeto correto são filtrados, não quebram o parse
    expect(
      lerRevendaConfig({
        revenda_kanban_colunas: ["ok", 123, null],
        revenda_kanban_requisitos: { aprovado: ["a", 1, "b"], outra: "nao-e-array" },
        revenda_campos: { s1: true, s2: "sim" },
      }),
    ).toEqual({
      colunas: ["ok"],
      requisitos: { aprovado: ["a", "b"] },
      campos: { s1: true },
    });
  });

  it("monta o objeto completo quando as 3 chaves estão presentes e válidas", () => {
    const tc = {
      revenda_kanban_colunas: ["em_modelagem", "aprovado"],
      revenda_kanban_requisitos: { aprovado: ["lancado"] },
      revenda_campos: { modelista_id: true, prova: false },
    };
    expect(lerRevendaConfig(tc)).toEqual({
      colunas: ["em_modelagem", "aprovado"],
      requisitos: { aprovado: ["lancado"] },
      campos: { modelista_id: true, prova: false },
    });
  });
});
