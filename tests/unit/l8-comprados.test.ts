// Achados LEVES L8 (Comprados) — o lado do SITE, puro:
//   P-207 A: etapa nova do importado nasce com a cotação de referência; as de mercadoria ainda sem cotação recebem a
//            referência quando ela é digitada; Salvar recusa etapa de mercadoria com % > 0 e cotação 0 QUANDO a compra tem
//            valor (Q2) — validarDraft, mesma regra de `_salvar_produto_importado_core`/`_salvar_oc_importado_core`
//            (20261028200000); frete nasce com 1; Frete → Mercadoria aplica a referência (B3).
//   sku #22: variante nova (Produto Acabado E Importado) nunca reusa a ordem de uma variante já gravada (a grade cor ×
//            tamanho do card espelho é por ordem).
import { describe, it, expect } from "vitest";
import {
  emptyDraft,
  validarDraft,
  validarParaPedido,
  novaEtapaImportado,
  etapasComCotacaoRef,
  erroCotacaoEtapas,
  etapaSemCotacao,
  patchTrocaBase,
  type EtapaImportadoDraft,
  type ProdutoImportadoDraft,
} from "@/components/produto-importado/shared";
import { proximaOrdemVariante } from "@/components/produto-acabado/shared";

const etapa = (o: Partial<EtapaImportadoDraft>): EtapaImportadoDraft => ({
  ordem: 1,
  rotulo: "",
  base: "mercadoria",
  percentual: 0,
  data_vencimento: null,
  cotacao: 0,
  ...o,
});
const draft = (o: Partial<ProdutoImportadoDraft> = {}): ProdutoImportadoDraft => ({
  ...emptyDraft(null, null),
  nome: "Blusa",
  ...o,
});

describe("P-207 A — etapa nova nasce com a cotação de referência", () => {
  it("novaEtapaImportado: mercadoria, % 0, cotação = referência; ordem = maior + 1", () => {
    const nova = novaEtapaImportado(
      [etapa({ ordem: 1 }), etapa({ ordem: 4, base: "frete" })],
      5.42,
    );
    expect(nova).toEqual({
      ordem: 5,
      rotulo: "",
      base: "mercadoria",
      percentual: 0,
      data_vencimento: null,
      cotacao: 5.42,
    });
  });
  it("sem referência ainda (0) a etapa nasce com 0; com 5 etapas não cria", () => {
    expect(novaEtapaImportado([], 0)?.cotacao).toBe(0);
    expect(novaEtapaImportado([], 0)?.ordem).toBe(1);
    expect(
      novaEtapaImportado(
        [1, 2, 3, 4, 5].map((ordem) => etapa({ ordem })),
        5,
      ),
    ).toBeNull();
  });
  it("produto novo: Sinal/Saldo (mercadoria) sem cotação e Frete com 1 (identidade — 'deixe 1 se o frete já está em R$')", () => {
    const e = emptyDraft(null, null).etapas;
    expect(e.map((x) => [x.base, x.cotacao])).toEqual([
      ["mercadoria", 0],
      ["mercadoria", 0],
      ["frete", 1],
    ]);
  });
  it("etapasComCotacaoRef: digitar a referência preenche SÓ as de mercadoria sem cotação; frete e cotação própria ficam", () => {
    const antes = [
      etapa({ ordem: 1, percentual: 30 }),
      etapa({ ordem: 2, percentual: 70, cotacao: 6.1 }),
      etapa({ ordem: 3, base: "frete", percentual: 100, cotacao: 0 }),
    ];
    const depois = etapasComCotacaoRef(antes, 5);
    expect(depois.map((x) => x.cotacao)).toEqual([5, 6.1, 0]);
    expect(etapasComCotacaoRef(depois, 7)).toBe(depois); // nada a preencher → o MESMO array
    expect(etapasComCotacaoRef(antes, 0)).toBe(antes);
  });
});

describe("P-207 A — Salvar recusa etapa de mercadoria com % > 0 e cotação 0 (com valor de compra)", () => {
  it("validarDraft: compra COM valor (M1 10) e mercadoria 30% com cotação 0 → mensagem PT", () => {
    const d = draft({ valor_unitario_m1: 10 }); // Sinal 30 / Saldo 70 com cotação 0
    expect(validarDraft(d)).toMatch(/^Etapa "Sinal" de mercadoria \(30%\) está sem cotação/);
    expect(validarParaPedido({ ...d, qtd_total: 10 })).toMatch(/sem cotação/);
  });
  it("Q2 (fix round 1): compra SEM valor (M1 0) salva — produto recém-criado só com nome não é recusado", () => {
    const d = draft(); // valor_unitario_m1 0
    expect(validarDraft(d)).toBeNull();
    expect(erroCotacaoEtapas(d.etapas, 0)).toBeNull();
    expect(etapaSemCotacao(d.etapas[0], 0)).toBe(false);
    expect(etapaSemCotacao(d.etapas[0], 10)).toBe(true);
  });
  it("com a referência digitada passa; frete com cotação 0 e mercadoria 0% não bloqueiam", () => {
    const d = draft({ valor_unitario_m1: 10 });
    expect(
      validarDraft({ ...d, cotacao_ref: 5, etapas: etapasComCotacaoRef(d.etapas, 5) }),
    ).toBeNull();
    expect(
      erroCotacaoEtapas(
        [
          etapa({ percentual: 100, cotacao: 5 }),
          etapa({ ordem: 2, base: "frete", percentual: 100 }),
        ],
        10,
      ),
    ).toBeNull();
    expect(
      erroCotacaoEtapas(
        [etapa({ percentual: 0 }), etapa({ ordem: 2, percentual: 100, cotacao: 5 })],
        10,
      ),
    ).toBeNull();
    expect(erroCotacaoEtapas([etapa({ ordem: 7, percentual: 100, cotacao: -1 })], 10)).toMatch(
      /^Etapa 7 de mercadoria \(100%\)/,
    );
  });
});

describe("B3 (fix round 1) — trocar a base Frete → Mercadoria aplica a cotação de referência", () => {
  it("frete com cotação 1 ou 0 → mercadoria com a referência", () => {
    expect(patchTrocaBase({ base: "frete", cotacao: 1 }, "mercadoria", 5.4)).toEqual({
      base: "mercadoria",
      cotacao: 5.4,
    });
    expect(patchTrocaBase({ base: "frete", cotacao: 0 }, "mercadoria", 5.4)).toEqual({
      base: "mercadoria",
      cotacao: 5.4,
    });
  });
  it("cotação própria (≠ 0/1), sem referência, ou outra direção: só troca a base", () => {
    expect(patchTrocaBase({ base: "frete", cotacao: 6.2 }, "mercadoria", 5.4)).toEqual({
      base: "mercadoria",
    });
    expect(patchTrocaBase({ base: "frete", cotacao: 1 }, "mercadoria", 0)).toEqual({
      base: "mercadoria",
    });
    expect(patchTrocaBase({ base: "mercadoria", cotacao: 5.4 }, "frete", 5.4)).toEqual({
      base: "frete",
    });
  });
});

describe("sku #22 — variante nova nunca reusa a ordem de uma gravada", () => {
  it("apagou a ÚLTIMA variante (ordem 1) e adicionou outra: ordem 2 (antes: 1, herdava a grade da apagada)", () => {
    expect(proximaOrdemVariante([], [1])).toBe(2);
  });
  it("apagou a do meio: max(rascunho ∪ servidor) + 1", () => {
    expect(proximaOrdemVariante([{ ordem: 1 }, { ordem: 3 }], [1, 2, 3])).toBe(4);
    expect(proximaOrdemVariante([{ ordem: 1 }], [1, 2, 3])).toBe(4);
  });
  it("sem servidor (rascunho novo) = comportamento de antes", () => {
    expect(proximaOrdemVariante([])).toBe(1);
    expect(proximaOrdemVariante([{ ordem: 0 }])).toBe(1);
    expect(proximaOrdemVariante([{ ordem: 2 }, { ordem: 5 }])).toBe(6);
  });
});

describe("B1 (fix round 1) — recusa ASCII do servidor (card e OC de importado) vira texto PT", async () => {
  const { mensagemErro, TEXTO_ETAPA_SEM_COTACAO } = await import("@/lib/erro-mensagem");
  it("P0001 'Informe a cotacao da etapa de mercadoria …' → mensagem acentuada", () => {
    const e = {
      code: "P0001",
      message:
        "Informe a cotacao da etapa de mercadoria (percentual maior que zero e cotacao zerada).",
    };
    expect(mensagemErro(e)).toBe(TEXTO_ETAPA_SEM_COTACAO);
    expect(TEXTO_ETAPA_SEM_COTACAO).toMatch(/cotação/);
  });
});
