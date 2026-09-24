import { describe, it, expect } from "vitest";
import { aparar, ehNumeroTamanho, ladoTamanho, parseTamanho } from "@/lib/tamanho";
import {
  ACENTOS_DE, ACENTOS_PARA, canonico, ladosDaGrade, mesclarSiglasTamanho, montarSku, normalizarRefSku, normalizarSigla,
  normalizarSkuConfig, normalizarSkuManual, normalizarTamanhosSku, resolverSku, textoAviso, textoFalta,
} from "@/lib/sku-montar";
import {
  CASOS_CONFIG, CASOS_MONTAR, CASOS_REF, CASOS_RESOLVER, CASOS_SIGLA, CASOS_SKU_MANUAL, CASOS_TAMANHO, CASOS_TAMANHOS_SKU,
} from "../fixtures/sku-casos";

// Lado TS do anti-drift (o lado SQL roda as MESMAS fixtures em tests/integration/sku-automatico.test.ts).

describe("tamanho.ts — parseTamanho / ladoTamanho (espelho _sku_tamanho_lados/_sku_tamanho_lado)", () => {
  for (const c of CASOS_TAMANHO) {
    it(`${JSON.stringify(c.entrada)} → número ${c.numero} · letra ${c.letra}`, () => {
      expect(parseTamanho(c.entrada)).toEqual({ numero: c.numero, letra: c.letra });
      expect(ladoTamanho(c.entrada, "numero")).toBe(c.ladoNumero);
      expect(ladoTamanho(c.entrada, "letra")).toBe(c.ladoLetra);
    });
  }
  it("aparar só tira espaço/tab/CR/LF (igual ao btrim do SQL), não o espaço unicode", () => {
    expect(aparar(" \t a \r\n")).toBe("a");
    expect(aparar(" a ")).toBe(" a "); // NBSP fica (o btrim do SQL também não o tira)
    expect(aparar(null)).toBe("");
  });
  it("ehNumeroTamanho: só dígitos ASCII", () => {
    expect(ehNumeroTamanho("034")).toBe(true);
    expect(ehNumeroTamanho("3M")).toBe(false);
    expect(ehNumeroTamanho("")).toBe(false);
    expect(ehNumeroTamanho("٣٤")).toBe(false);
  });
});

describe("sku-montar.ts — normalizarSigla (espelho _sku_norm_sigla)", () => {
  for (const c of CASOS_SIGLA) {
    it(`${JSON.stringify(c.entrada)} → ${JSON.stringify(c.esperado)}`, () => {
      expect(normalizarSigla(c.entrada)).toBe(c.esperado);
    });
  }
});

describe("sku-montar.ts — normalizarRefSku / normalizarSkuManual (espelhos _sku_norm_ref / _sku_norm_manual)", () => {
  it("lista de acentos: DE e PARA com o mesmo tamanho (é a do translate() do SQL)", () => {
    expect([...ACENTOS_DE].length).toBe([...ACENTOS_PARA].length);
    expect(new Set([...ACENTOS_DE]).size).toBe([...ACENTOS_DE].length);
  });
  for (const c of CASOS_REF) {
    it(`REF ${JSON.stringify(c.entrada)} → ${JSON.stringify(c.esperado)}`, () => {
      expect(normalizarRefSku(c.entrada)).toBe(c.esperado);
    });
  }
  for (const c of CASOS_SKU_MANUAL) {
    it(`manual ${JSON.stringify(c.entrada)}`, () => {
      const r = normalizarSkuManual(c.entrada);
      if ("erro" in c) expect(r).toEqual({ ok: false, erro: c.erro });
      else expect(r).toEqual({ ok: true, valor: c.esperado });
    });
  }
});

describe("sku-montar.ts — normalizarSkuConfig (espelho _sku_config_normaliza, mesmas mensagens)", () => {
  for (const c of CASOS_CONFIG) {
    it(JSON.stringify(c.entrada), () => {
      const r = normalizarSkuConfig(c.entrada);
      if ("erro" in c) expect(r).toEqual({ ok: false, erro: c.erro });
      else expect(r).toEqual({ ok: true, valor: c.esperado });
    });
  }
});

describe("sku-montar.ts — normalizarTamanhosSku (espelho _sku_tamanhos_normaliza, mesmas mensagens)", () => {
  for (const c of CASOS_TAMANHOS_SKU) {
    it(JSON.stringify(c.entrada), () => {
      const r = normalizarTamanhosSku(c.entrada);
      if ("erro" in c) expect(r).toEqual({ ok: false, erro: c.erro });
      else expect(r).toEqual({ ok: true, valor: c.esperado });
    });
  }
});

describe("sku-montar.ts — montarSku (espelho _sku_montar)", () => {
  for (const c of CASOS_MONTAR) {
    it(`${c.cfg.partes.join("+")} ${JSON.stringify(c.valores)} → ${c.esperado}`, () => {
      expect(montarSku(c.cfg, c.valores)).toBe(c.esperado);
    });
  }
});

describe("sku-montar.ts — resolverSku (espelho _sku_resolver)", () => {
  CASOS_RESOLVER.forEach((c, i) => {
    it(`caso ${i + 1}: ${c.entrada.tamanhoKey} (${c.entrada.tipo}) → ${c.esperado.sku ?? "falta"}`, () => {
      expect(resolverSku(c.entrada)).toEqual(c.esperado);
    });
  });
});

describe("sku-montar.ts — apoio às telas", () => {
  it("textoFalta", () => {
    expect(textoFalta({ atributo: "cor_base", id: "x", nome: "Amarelo" })).toBe("Falta sigla: Cor base Amarelo");
    expect(textoFalta({ atributo: "cor_apelido", id: "y", nome: "Musgo" })).toBe("Falta sigla: Cor apelido Musgo");
    expect(textoFalta({ atributo: "tamanho", id: null, nome: "PPP" })).toBe("Falta sigla: Tamanho PPP");
    expect(textoFalta({ atributo: "cor_base", id: null, nome: null })).toBe("Falta a cor base na variante");
  });
  it("textoAviso (D4: apelido sem sigla não bloqueia)", () => {
    expect(textoAviso({ atributo: "cor_apelido", id: "y", nome: "Musgo" })).toBe("Falta sigla na cor apelido: Musgo");
  });
  it("canonico ignora a ordem das chaves (o jsonb reordena)", () => {
    expect(canonico({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(canonico({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
    expect(canonico(null)).toBe("null");
    expect(canonico(undefined)).toBe("null");
  });
  it("ladosDaGrade destrincha cada item", () => {
    expect(ladosDaGrade(["34|PPP", "36", "P"])).toEqual([
      { item: "34|PPP", numero: "34", letra: "PPP" },
      { item: "36", numero: "36", letra: null },
      { item: "P", numero: null, letra: "P" },
    ]);
  });
  it("mesclarSiglasTamanho aplica só o que o usuário mudou sobre o mapa ATUAL do banco", () => {
    const base = { "34": "34", PPP: "PPP" };
    const fresco = { "34": "34", PPP: "PPP", "36": "36" }; // outra pessoa gravou "36" depois que a tela abriu
    const rascunho = { "34": "34", PPP: " x " }; // eu mudei PPP
    expect(mesclarSiglasTamanho(fresco, base, rascunho)).toEqual({ "34": "34", PPP: "X", "36": "36" });
    expect(mesclarSiglasTamanho(fresco, base, { "34": "", PPP: "PPP" })).toEqual({ PPP: "PPP", "36": "36" });
    expect(mesclarSiglasTamanho(null, null, {})).toBeNull();
    expect(mesclarSiglasTamanho({ P: "P" }, { P: "P" }, { P: "" })).toBeNull();
  });
});
