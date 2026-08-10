import { describe, it, expect } from "vitest";
import {
  splitMaiorResto,
  ehGrupoAcessorio,
  cadeiaValores,
  previewRefProduto,
  previewNumeroOc,
} from "@/lib/produto-acabado";

describe("splitMaiorResto — método do maior resto (espelha _split_maior_resto do banco)", () => {
  it("divisão exata: 198 em pesos 3:2:1 → 99/66/33", () => {
    expect(splitMaiorResto(198, { P: 3, B: 2, A: 1 })).toEqual({ P: 99, B: 66, A: 33 });
  });

  it("pesos iguais: soma do resultado bate com o total mesmo sem dividir exato", () => {
    const r = splitMaiorResto(100, { a: 1, b: 1, c: 1 });
    const soma = Object.values(r).reduce((s, v) => s + v, 0);
    expect(soma).toBe(100);
    // 100/3 = 33,33... → maior resto distribui o resto (1) pela chave de maior fração;
    // com frações empatadas, desempate por chave asc.
    expect(r).toEqual({ a: 34, b: 33, c: 33 });
  });

  it("desempate por fração desc, depois chave asc (mesma regra do banco)", () => {
    // 198/6=33 exato pros 3, sem resto — troca de pesos pra forçar frações desiguais
    const r = splitMaiorResto(100, { "38": 1, "40": 1, "42": 1 });
    expect(r).toEqual({ "38": 34, "40": 33, "42": 33 });
  });

  it("caso degenerado: Σ pesos positivos = 0 (todos 0) → split igualitário, Σ = total", () => {
    const r = splitMaiorResto(10, { "38": 0, "40": 0, "42": 0 });
    expect(r).toEqual({ "38": 4, "40": 3, "42": 3 });
    const soma = Object.values(r).reduce((s, v) => s + v, 0);
    expect(soma).toBe(10);
  });

  it("caso degenerado: pesos negativos/zero misturados também caem no ramo igualitário", () => {
    const r = splitMaiorResto(10, { a: -1, b: -2, c: 0 });
    const soma = Object.values(r).reduce((s, v) => s + v, 0);
    expect(soma).toBe(10);
  });

  it("caso NÃO-degenerado: peso 0 entre pesos positivos continua recebendo 0", () => {
    const r = splitMaiorResto(100, { "38": 1, "40": 1, "42": 0 });
    expect(r).toEqual({ "38": 50, "40": 50, "42": 0 });
  });

  it("mapa vazio → objeto vazio", () => {
    expect(splitMaiorResto(100, {})).toEqual({});
  });
});

describe("cadeiaValores — bruto → total com desconto → unitário real", () => {
  it("198 × R$99 − 20% → 19.602 / 15.681,60 / 79,20 (números canônicos do brief)", () => {
    const r = cadeiaValores(198, 99, 20);
    expect(r.bruto).toBe(19602);
    expect(r.totalDesc).toBe(15681.6);
    expect(r.unitReal).toBe(79.2);
  });

  it("sem desconto: totalDesc = bruto, unitReal = valorUnit", () => {
    const r = cadeiaValores(10, 50, 0);
    expect(r).toEqual({ bruto: 500, totalDesc: 500, unitReal: 50 });
  });

  it("qtd 0 → unitReal 0 (não divide por zero)", () => {
    const r = cadeiaValores(0, 50, 10);
    expect(r.bruto).toBe(0);
    expect(r.unitReal).toBe(0);
  });
});

describe("ehGrupoAcessorio — normaliza sem acento/lower, contém 'acessor'", () => {
  it("'Acessórios' → true", () => {
    expect(ehGrupoAcessorio("Acessórios")).toBe(true);
  });

  it("'Feminino' → false", () => {
    expect(ehGrupoAcessorio("Feminino")).toBe(false);
  });

  it("variações de caixa/acento e null/undefined", () => {
    expect(ehGrupoAcessorio("ACESSÓRIO")).toBe(true);
    expect(ehGrupoAcessorio("acessorios")).toBe(true);
    expect(ehGrupoAcessorio(null)).toBe(false);
    expect(ehGrupoAcessorio(undefined)).toBe(false);
    expect(ehGrupoAcessorio("")).toBe(false);
  });
});

describe("previewRefProduto — sigla da REF (número vem do banco)", () => {
  it("não-acessório: 2 grupo + 1 categoria + 2 sub1 → 'FEVES'", () => {
    expect(previewRefProduto("Feminino", "Vestido", "Estampado", false)).toBe("FEVES");
  });

  it("acessório: 2 grupo + 3 categoria → 'ACBOL'", () => {
    expect(previewRefProduto("Acessórios", "Bolsa", null, true)).toBe("ACBOL");
  });
});

describe("previewNumeroOc — sigla do número da OC (contador+dash vem do banco)", () => {
  it("não-acessório: 3 fornecedor + 1 grupo + 2 categoria → 'AVEFVE'", () => {
    expect(previewNumeroOc("Ave Rara", "Feminino", "Vestido", false)).toBe("AVEFVE");
  });

  it("acessório: 3 fornecedor + 'ACE' → 'BELACE'", () => {
    expect(previewNumeroOc("Bella Couros", "Acessórios", "Bolsa", true)).toBe("BELACE");
  });

  it("fornecedor sem letra alfabética alguma → sigla 'FOR'", () => {
    expect(previewNumeroOc("123", "Feminino", "Vestido", false)).toBe("FORFVE");
    expect(previewNumeroOc("", "Acessórios", "Bolsa", true)).toBe("FORACE");
  });

  // FIX ROUND 1 (review adversarial): `norm3` interno usava .normalize("NFD"), que
  // converte QUALQUER acento pra letra-base — mas o `_norm3` do SQL só converte a lista
  // fixa PT-BR (ÁÀÂÃÉÊÍÓÔÕÚÇ/áàâãéêíóôõúç) via translate(); acento FORA dessa lista
  // (ä/ö/ü/ñ/ï…) não é convertido pelo banco e é DESCARTADO no filtro seguinte — o
  // NFD antigo, ao contrário, mantinha a letra-base e divergia do banco. Valores
  // conferidos AO VIVO no banco (`select _norm3('Ärger')` etc.) antes de escrever o teste.
  it("acento FORA da lista fixa do banco (ä/ñ) é DESCARTADO, não convertido pra letra-base", () => {
    // _norm3('Ärger') = 'RGE' no banco (Ä não traduzido, cai fora do filtro A-Za-z)
    expect(previewNumeroOc("Ärger", "Feminino", "Vestido", false)).toBe("RGEFVE");
    // _norm3('Ñandú') = 'AND' no banco (Ñ descartado; o 'ú' SEGUE convertido — está na lista)
    expect(previewNumeroOc("Ñandú", "Feminino", "Vestido", false)).toBe("ANDFVE");
  });

  it("acento DENTRO da lista fixa PT-BR (ã/é) segue convertido normalmente — 'São José' = 'SAO' no banco", () => {
    // _norm3('São José') = 'SAO' no banco (ã→a, espaço removido, José nem entra nas 3 primeiras)
    expect(previewNumeroOc("São José", "Feminino", "Vestido", false)).toBe("SAOFVE");
  });
});
