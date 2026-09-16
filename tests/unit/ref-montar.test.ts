import { describe, it, expect } from "vitest";
import { montarRef, norm3, fmtNumero, siglaFamilia, type RefConfig, type RefTaxonomia } from "@/lib/ref-montar";

// Taxonomia de exemplo (espelha o QA do banco: Top / Blusa / Manga Longa → TOB ML).
const TAX: RefTaxonomia = {
  grupoId: "g1", grupoNome: "Top",
  categoriaId: "c1", categoriaNome: "Blusa",
  sub1Id: "s1", sub1Nome: "Manga Longa",
  sub2Id: "s2", sub2Nome: "Estampada",
};

describe("norm3 (espelho _norm3)", () => {
  it("normaliza PT-BR, só letras, upper, corta em 3", () => {
    expect(norm3("Vestido")).toBe("VES");
    expect(norm3("Ação")).toBe("ACA");
    expect(norm3("One Piece")).toBe("ONE"); // espaço vira nada, corta em 3
    expect(norm3(null)).toBe("");
  });
});

describe("fmtNumero — nunca trunca (bug do lpad)", () => {
  it("largura é MÍNIMA, não teto", () => {
    expect(fmtNumero({ num_digitos: 6 }, 42)).toBe("000042");
    // número de 8 dígitos com num_digitos=6 → passa INTEIRO (não vira 100000)
    expect(fmtNumero({ num_digitos: 6 }, 10000012)).toBe("10000012");
    expect(fmtNumero({ num_digitos: 8 }, 12)).toBe("00000012");
    expect(fmtNumero(null, 12)).toBe("00000012"); // default 8
  });
});

describe("montarRef — FALLBACK (sem config = comportamento histórico)", () => {
  it("acabado sem config: sigla derivada 2+1+2 colada ao número de 8 díg (espelha QA banco TOBMA)", () => {
    // Top(2)=TO + Blusa(1)=B + Manga Longa(2)=MA = TOBMA
    expect(montarRef({ cfg: null, familia: "acabado", tax: TAX, numero: 10000012, acessorio: false }))
      .toBe("TOBMA10000012");
  });
  it("importado sem config idêntico (mesma fórmula)", () => {
    expect(montarRef({ cfg: undefined, familia: "importado", tax: TAX, numero: 10000013, acessorio: false }))
      .toBe("TOBMA10000013");
  });
  it("acessório sem config: 2 grupo + 3 categoria", () => {
    // Top(2)=TO + Blusa(3)=BLU = TOBLU
    expect(montarRef({ cfg: null, familia: "acabado", tax: TAX, numero: 10000000, acessorio: true }))
      .toBe("TOBLU10000000");
  });
});

describe("montarRef — CONFIGURADO", () => {
  const cfg: RefConfig = {
    partes: ["familia", "grupo", "numero"],
    separador: "-",
    num_digitos: 6,
    num_inicio: 500,
    sigla_familia: { acabado: "ACB", importado: "IMP" },
    sigla_taxonomia: { g1: "XG" }, // grupo sobrescrito
  };

  it("família + grupo custom + número, com separador (espelha QA banco ACB-XG-10000014)", () => {
    expect(montarRef({ cfg, familia: "acabado", tax: TAX, numero: 10000014, acessorio: false }))
      .toBe("ACB-XG-10000014");
    expect(montarRef({ cfg, familia: "importado", tax: TAX, numero: 10000015, acessorio: false }))
      .toBe("IMP-XG-10000015");
  });

  it("família default quando não configurada", () => {
    const c2: RefConfig = { partes: ["familia", "numero"], separador: "", num_digitos: 4 };
    expect(montarRef({ cfg: c2, familia: "interno", tax: TAX, numero: 7, acessorio: false })).toBe("I0007");
  });

  it("grupo sem sigla configurada cai na derivada", () => {
    const c3: RefConfig = { partes: ["grupo", "categoria", "numero"], separador: ".", num_digitos: 3 };
    // grupo derivado TO, categoria derivada B, sep "." → TO.B.NNN
    expect(montarRef({ cfg: c3, familia: "acabado", tax: TAX, numero: 5, acessorio: false })).toBe("TO.B.005");
  });

  it("parte 'numero' fora das partes → REF sem número", () => {
    // sem sigla_familia configurada → família cai no default (acabado=A); grupo sem sigla → derivada TO
    const c4: RefConfig = { partes: ["familia", "grupo"], separador: "-" };
    expect(montarRef({ cfg: c4, familia: "acabado", tax: TAX, numero: 999, acessorio: false })).toBe("A-TO");
  });

  it("Acessório NO MODO CONFIGURADO não vira 3 letras na categoria (regra de acessório é só do fallback — casa com o SQL)", () => {
    // categoria 'Bolsa' derivada no modo configurado = 1 letra 'B' (não 'BOL'), mesmo sendo acessório
    const cAcc: RefConfig = { partes: ["categoria", "numero"], separador: "", num_digitos: 5 };
    const taxBolsa: RefTaxonomia = { ...TAX, categoriaNome: "Bolsa" };
    expect(montarRef({ cfg: cAcc, familia: "acabado", tax: taxBolsa, numero: 178, acessorio: true }))
      .toBe("B00178");
  });

  it("sub1 e sub2 com siglas configuradas + ordem custom", () => {
    const c5: RefConfig = {
      partes: ["sub2", "sub1", "numero"], separador: "",
      sigla_taxonomia: { s1: "ML", s2: "ES" }, num_digitos: 5,
    };
    expect(montarRef({ cfg: c5, familia: "acabado", tax: TAX, numero: 42, acessorio: false })).toBe("ESML00042");
  });
});

describe("siglaFamilia — normaliza livre + default", () => {
  it("default quando vazio, normaliza quando preenchido", () => {
    expect(siglaFamilia(null, "interno")).toBe("I");
    expect(siglaFamilia({ sigla_familia: { acabado: "a-b." } }, "acabado")).toBe("AB");
    expect(siglaFamilia({ sigla_familia: { importado: "" } }, "importado")).toBe("M"); // vazio = default
  });
});
