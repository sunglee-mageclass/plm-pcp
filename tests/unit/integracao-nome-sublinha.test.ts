import { describe, it, expect } from "vitest";
import { nomeSublinha } from "@/lib/integracao/nome-sublinha";
import { COR_NO_NOME, corNoNomeEfetiva, normalizarSkuConfig } from "@/lib/sku-montar";
import { CASOS_COR_NO_NOME, CASOS_NOME_SUBLINHA } from "../fixtures/nome-sublinha-casos";

// Lado TS do anti-drift "Cor no nome das sublinhas" (P-126). O lado SQL roda as MESMAS fixtures em
// tests/integration/integracao-8-nome-cor.test.ts (public._integracao_nome_sublinha / public._integracao_cor_no_nome).

describe("nome-sublinha.ts — nomeSublinha (espelho _integracao_nome_sublinha)", () => {
  for (const c of CASOS_NOME_SUBLINHA) {
    it(`${JSON.stringify([c.nome, c.base, c.apelido, c.tam, c.modo])} → ${JSON.stringify(c.esperado)}`, () => {
      expect(nomeSublinha(c.nome, c.base, c.apelido, c.tam, c.modo)).toBe(c.esperado);
    });
  }
  it("undefined = null nas 5 pontas", () => {
    expect(nomeSublinha("Blusa", undefined, undefined, undefined, undefined)).toBe("Blusa");
    expect(nomeSublinha(undefined, "Preto", null, "P", "cor_base")).toBeNull();
  });
});

describe("sku-montar.ts — corNoNomeEfetiva (espelho _integracao_cor_no_nome)", () => {
  for (const c of CASOS_COR_NO_NOME) {
    it(`${JSON.stringify(c.cfg)} → ${c.esperado}`, () => {
      expect(corNoNomeEfetiva(c.cfg)).toBe(c.esperado);
    });
  }
  it("as 2 opções, nesta ordem (Cor base | Apelido)", () => {
    expect(COR_NO_NOME).toEqual(["cor_base", "cor_apelido"]);
  });
  it("o que o normalizador GRAVA dá a mesma escolha efetiva que o cru (a chave explícita sobrevive à normalização)", () => {
    for (const c of CASOS_COR_NO_NOME) {
      const n = normalizarSkuConfig(c.cfg);
      if (!n.ok) continue; // cru inválido nunca é gravado (o gatilho recusa)
      expect(corNoNomeEfetiva(n.valor), JSON.stringify(c.cfg)).toBe(c.esperado);
    }
  });
});
