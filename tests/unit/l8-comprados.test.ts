// Achados LEVES L8 (Comprados) — o lado do SITE, puro:
//   P-207 A: etapa nova do importado nasce com a cotação de referência; as de mercadoria ainda sem cotação recebem a
//            referência quando ela é digitada; Salvar recusa etapa de mercadoria com % > 0 e cotação 0 (validarDraft —
//            mesma regra de `_salvar_produto_importado_core`, 20261028200000); frete nasce com 1.
//   sku #22: variante nova do Produto Acabado nunca reusa a ordem de uma variante já gravada (a grade cor × tamanho do
//            card espelho é por ordem).
import { describe, it, expect } from "vitest";
import {
  emptyDraft,
  validarDraft,
  validarParaPedido,
  novaEtapaImportado,
  etapasComCotacaoRef,
  erroCotacaoEtapas,
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
    // nada a preencher / referência 0 → o MESMO array (não suja o rascunho)
    expect(etapasComCotacaoRef(depois, 7)).toBe(depois);
    expect(etapasComCotacaoRef(antes, 0)).toBe(antes);
  });
});

describe("P-207 A — Salvar recusa etapa de mercadoria com % > 0 e cotação 0", () => {
  it("validarDraft: mercadoria 30% com cotação 0 → mensagem PT (o produto novo sem referência não salva)", () => {
    const d = draft(); // Sinal 30 / Saldo 70 com cotação 0
    expect(validarDraft(d)).toMatch(/^Etapa "Sinal" de mercadoria \(30%\) está sem cotação/);
    expect(validarParaPedido({ ...d, qtd_total: 10 })).toMatch(/sem cotação/);
  });
  it("com a referência digitada (etapasComCotacaoRef) passa; frete com cotação 0 e mercadoria 0% não bloqueiam", () => {
    const d = draft();
    expect(
      validarDraft({ ...d, cotacao_ref: 5, etapas: etapasComCotacaoRef(d.etapas, 5) }),
    ).toBeNull();
    expect(
      erroCotacaoEtapas([
        etapa({ percentual: 100, cotacao: 5 }),
        etapa({ ordem: 2, base: "frete", percentual: 100, cotacao: 0 }),
      ]),
    ).toBeNull();
    expect(
      erroCotacaoEtapas([
        etapa({ percentual: 0, cotacao: 0 }),
        etapa({ ordem: 2, percentual: 100, cotacao: 5 }),
      ]),
    ).toBeNull();
    expect(erroCotacaoEtapas([etapa({ ordem: 7, percentual: 100, cotacao: -1 })])).toMatch(
      /^Etapa 7 de mercadoria \(100%\)/,
    );
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
