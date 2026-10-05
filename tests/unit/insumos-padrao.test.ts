import { describe, it, expect } from "vitest";
import {
  CASOS_NORMALIZA,
  CASOS_RECUSA,
  IP_IDS,
  PREFIXO_ERRO_INSUMOS_PADRAO,
} from "../fixtures/insumos-padrao-casos";
import {
  LIMITE_INSUMOS_PADRAO,
  diagnosticarLinhasInsumosPadrao,
  normalizarInsumosPadrao,
  validarInsumosPadrao,
  type CatalogoInsumoPadrao,
} from "@/lib/insumos-padrao";
import { COLUNAS_PAGINA, montarMudancas, rotuloColuna, serializarColuna, type ConfigLojaColab } from "@/lib/config-loja-colab";
import { pickKanban } from "@/lib/kanban-auto-config";

const { E1, E2, C1, C2 } = IP_IDS;

describe("fixture compartilhada (T9, espelho da RPC salvar_config_loja)", () => {
  it("limite do TS = 20", () => {
    expect(LIMITE_INSUMOS_PADRAO).toBe(20);
  });

  describe("normalizarInsumosPadrao", () => {
    for (const c of CASOS_NORMALIZA) {
      it(`normaliza: ${c.nome}`, () => {
        expect(normalizarInsumosPadrao(c.entrada)).toEqual(c.esperado);
      });
      it(`valida (aceita) e devolve o mesmo normalizado: ${c.nome}`, () => {
        const r = validarInsumosPadrao(c.entrada);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.lista).toEqual(c.esperado);
      });
    }
  });

  describe("validarInsumosPadrao (recusas que o TS sabe fazer)", () => {
    for (const c of CASOS_RECUSA.filter((x) => !x.soServidor)) {
      it(`recusa: ${c.nome}`, () => {
        const r = validarInsumosPadrao(c.entrada);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.motivo).toBe(c.motivo);
          expect(r.mensagem).toBe(PREFIXO_ERRO_INSUMOS_PADRAO + c.motivo);
        }
      });
    }
    it("os casos soServidor (outra loja / inexistente) so tem a forma conferida: o TS aceita a forma", () => {
      for (const c of CASOS_RECUSA.filter((x) => x.soServidor)) {
        expect(validarInsumosPadrao(c.entrada).ok).toBe(true);
      }
    });
  });
});

describe("normalizarInsumosPadrao — leitura tolerante do servidor (nunca quebra a tela)", () => {
  it("qualquer coisa que nao e lista vira []", () => {
    for (const v of [null, undefined, {}, { etiqueta_id: E1 }, "[]", 5, true]) {
      expect(normalizarInsumosPadrao(v)).toEqual([]);
    }
  });
  it("item que nao e objeto sai; o resto fica na ordem", () => {
    const r = normalizarInsumosPadrao([null, "x", [E1], { etiqueta_id: E2, cor_id: C1, consumo: 2 }]);
    expect(r).toEqual([{ etiqueta_id: E2, cor_id: C1, consumo: 2 }]);
  });
  it("id desconhecido/fora do formato e MANTIDO (a tela mostra 'removido'); sem id vira vazio", () => {
    expect(normalizarInsumosPadrao([{ etiqueta_id: "lixo", cor_id: "azul", consumo: 1 }])).toEqual([
      { etiqueta_id: "lixo", cor_id: "azul", consumo: 1 },
    ]);
    expect(normalizarInsumosPadrao([{ consumo: 1 }])).toEqual([{ etiqueta_id: "", cor_id: null, consumo: 1 }]);
  });
  it("consumo ruim vira 0 (nao NaN) e nunca lanca", () => {
    const r = normalizarInsumosPadrao([
      { etiqueta_id: E1, consumo: "abc" },
      { etiqueta_id: E2, consumo: null },
      { etiqueta_id: C1, consumo: Number.NaN },
    ]);
    expect(r.map((x) => x.consumo)).toEqual([0, 0, 0]);
  });
  it("e idempotente", () => {
    for (const c of CASOS_NORMALIZA) {
      const uma = normalizarInsumosPadrao(c.entrada);
      expect(normalizarInsumosPadrao(uma)).toEqual(uma);
    }
  });
  it("lista com mais de 20 itens NAO e cortada na leitura (a validacao e que recusa)", () => {
    const l = Array.from({ length: 25 }, (_, i) => ({ etiqueta_id: E1, cor_id: i % 2 ? C1 : null, consumo: 1 }));
    expect(normalizarInsumosPadrao(l)).toHaveLength(25);
    expect(validarInsumosPadrao(l).ok).toBe(false);
  });
});

describe("validarInsumosPadrao — linha em branco do editor", () => {
  it("insumo nao escolhido recusa com o motivo do servidor (item N)", () => {
    const r = validarInsumosPadrao([{ etiqueta_id: E1, cor_id: null, consumo: 1 }, { etiqueta_id: "", cor_id: null, consumo: 0 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("item 2: insumo não encontrado nesta loja");
  });
});

describe("diagnosticarLinhasInsumosPadrao — o que a tela mostra por linha (catalogo da loja)", () => {
  const catalogo: CatalogoInsumoPadrao[] = [
    { id: E1, nome: "Etiqueta", cores: [{ id: C1, nome: "Azul" }, { id: C2, nome: "Preto" }] },
    { id: E2, nome: "Botao", cores: [] },
  ];
  const diag = (lista: unknown) => diagnosticarLinhasInsumosPadrao(normalizarInsumosPadrao(lista), catalogo);

  it("linha sadia: sem problema", () => {
    expect(diag([{ etiqueta_id: E1, cor_id: C1, consumo: 1 }, { etiqueta_id: E2, cor_id: null, consumo: 2 }])).toEqual([
      { insumoNome: "Etiqueta", problema: null },
      { insumoNome: "Botao", problema: null },
    ]);
  });
  it("insumo fora do catalogo = removido", () => {
    expect(diag([{ etiqueta_id: IP_IDS.E_INEXISTENTE, cor_id: null, consumo: 1 }])).toEqual([{ insumoNome: null, problema: "insumo_removido" }]);
  });
  it("cor que nao e mais variante do insumo = cor removida (insumo ok)", () => {
    expect(diag([{ etiqueta_id: E2, cor_id: C1, consumo: 1 }])).toEqual([{ insumoNome: "Botao", problema: "cor_removida" }]);
  });
  it("insumo nao escolhido (linha nova) = pendente", () => {
    expect(diag([{ etiqueta_id: "", cor_id: null, consumo: 0 }])).toEqual([{ insumoNome: null, problema: "sem_insumo" }]);
  });
  it("par repetido: a 2a linha e 'duplicado' (aponta a 1a)", () => {
    const r = diag([
      { etiqueta_id: E1, cor_id: C1, consumo: 1 },
      { etiqueta_id: E1, cor_id: null, consumo: 1 },
      { etiqueta_id: E1, cor_id: C1, consumo: 2 },
    ]);
    expect(r.map((x) => x.problema)).toEqual([null, null, "duplicado"]);
  });
  it("consumo fora de 0..9999 ou com mais de 4 casas = consumo_invalido", () => {
    const r = diag([
      { etiqueta_id: E1, cor_id: C1, consumo: -1 },
      { etiqueta_id: E1, cor_id: C2, consumo: 10000 },
      { etiqueta_id: E2, cor_id: null, consumo: 1.00001 },
    ]);
    expect(r.map((x) => x.problema)).toEqual(["consumo_invalido", "consumo_invalido", "consumo_invalido"]);
  });
});

describe("integracao com config-loja-colab (17 colunas, coluna insumos_padrao)", () => {
  function cfgBase(): ConfigLojaColab {
    return {
      timezone: "America/Sao_Paulo", modo_baixa_estoque: "por_oc", modo_oc_rolo: "ambos", explosao_envio_status: "",
      ref_exibir_status: "", markup_analise_faixa: false, leadtime: { etapas: [], slaServico: null }, pcp_etapas: [],
      revenda_campos: {}, ref_config: null, keywords: "", status_kanban: ["Em Modelagem", "Aprovado"], kanban_requisitos: {},
      kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {}, insumos_padrao: [],
    };
  }
  it("COLUNAS_PAGINA tem 17 e inclui insumos_padrao", () => {
    expect(COLUNAS_PAGINA).toHaveLength(17);
    expect(COLUNAS_PAGINA).toContain("insumos_padrao");
  });
  it('rotulo "Insumos padrão"', () => {
    expect(rotuloColuna("insumos_padrao")).toBe("Insumos padrão");
  });
  it("serializarColuna normaliza (caixa do uuid, '' -> null, chaves extras saem)", () => {
    expect(serializarColuna("insumos_padrao", [{ id: "x", etiqueta_id: E1.toUpperCase(), cor_id: "", consumo: 2 }])).toEqual([
      { etiqueta_id: E1, cor_id: null, consumo: 2 },
    ]);
    expect(serializarColuna("insumos_padrao", null)).toEqual([]);
  });
  it("montarMudancas com so insumos_padrao alterado manda so essa coluna e a base CRUA do servidor", () => {
    const base = cfgBase();
    const cfg = { ...base, insumos_padrao: [{ etiqueta_id: E1, cor_id: C1, consumo: 1.5 }] };
    const baseRaw = { insumos_padrao: [{ etiqueta_id: E2, cor_id: null, consumo: 1, extra: "cru" }], timezone: "x" };
    const { mudancas, base: b } = montarMudancas({ cfg, baseUi: base, baseRaw, kanbanBaseCfg: pickKanban(base) });
    expect(Object.keys(mudancas)).toEqual(["insumos_padrao"]);
    expect(mudancas.insumos_padrao).toEqual([{ etiqueta_id: E1, cor_id: C1, consumo: 1.5 }]);
    expect(Object.keys(b)).toEqual(["insumos_padrao"]);
    expect(b.insumos_padrao).toEqual(baseRaw.insumos_padrao); // CRU, sem normalizar
  });
  it("loja sem a coluna lida (undefined) e lista [] na tela: nada a salvar; base ausente vira null", () => {
    const base = cfgBase();
    const { mudancas } = montarMudancas({ cfg: base, baseUi: base, baseRaw: {}, kanbanBaseCfg: pickKanban(base) });
    expect(mudancas).toEqual({});
    const cfg = { ...base, insumos_padrao: [{ etiqueta_id: E1, cor_id: null, consumo: 1 }] };
    const r = montarMudancas({ cfg, baseUi: base, baseRaw: {}, kanbanBaseCfg: pickKanban(base) });
    expect(r.base.insumos_padrao).toBeNull();
  });
  it("so mudou a grafia (caixa do uuid / '' x null / chave extra) = nao e mudanca", () => {
    const base = { ...cfgBase(), insumos_padrao: [{ etiqueta_id: E1, cor_id: null, consumo: 1 }] };
    const cfg = { ...base, insumos_padrao: [{ etiqueta_id: E1.toUpperCase(), cor_id: "", consumo: 1, lixo: 1 }] as unknown[] };
    const { mudancas } = montarMudancas({ cfg: cfg as ConfigLojaColab, baseUi: base, baseRaw: {}, kanbanBaseCfg: pickKanban(base) });
    expect(mudancas).toEqual({});
  });
});
