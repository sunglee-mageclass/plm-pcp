import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  baseAutoSeCasa, aplicarTotalCor, totaisDaDistribuicao, temDistribuicao,
  type BaseConfigLinha, type Distribuicao,
} from "@/lib/distribuicao-produto";

// Config de Cadastro>Lojas: para a qtd 96, a base é E-commerce 60 + Física 36 (soma 96).
const config: BaseConfigLinha = { "96": { ecom: 60, fisica: 36 }, "48": { ecom: 30, fisica: 18 } };

describe("baseAutoSeCasa", () => {
  it("total digitado BATE com o cadastro → devolve a base por loja", () => {
    expect(baseAutoSeCasa(config, 96)).toEqual({ ecom: 60, fisica: 36 });
  });
  it("outro total cadastrado também bate", () => {
    expect(baseAutoSeCasa(config, 48)).toEqual({ ecom: 30, fisica: 18 });
  });
  it("total NÃO cadastrado → null (fica manual)", () => {
    expect(baseAutoSeCasa(config, 100)).toBeNull();
  });
  it("cor sem config nenhum → null (manual)", () => {
    expect(baseAutoSeCasa(null, 96)).toBeNull();
    expect(baseAutoSeCasa({}, 96)).toBeNull();
  });
  it("total 0 → null (não aplica base)", () => {
    expect(baseAutoSeCasa(config, 0)).toBeNull();
  });
});

describe("aplicarTotalCor (gatilho do total digitado no dialog)", () => {
  const prop = { P: 1 }; // proporção 1 → célula = base (Σ = total)
  const tamanhos = ["P"];
  const lojas = ["ecom", "fisica"];

  it("total bate → reparte a base pelas lojas (Σ = total)", () => {
    const out = aplicarTotalCor({ a: {} }, "a", config, 96, lojas, prop, tamanhos);
    expect(out.a.ecom.base).toBe(60);
    expect(out.a.fisica.base).toBe(36);
    expect(totaisDaDistribuicao(out.a).total).toBe(96);
  });
  it("total NÃO bate → devolve o MESMO objeto (manual, nada muda, nasce 0)", () => {
    const antes = { a: {} as Distribuicao };
    expect(aplicarTotalCor(antes, "a", config, 100, lojas, prop, tamanhos)).toBe(antes);
    expect(temDistribuicao(antes.a)).toBe(false);
  });
  it("cor sem cadastro → manual (mesmo objeto)", () => {
    const antes = { a: {} as Distribuicao };
    expect(aplicarTotalCor(antes, "a", {}, 96, lojas, prop, tamanhos)).toBe(antes);
  });
  it("chave desconhecida → mesmo objeto", () => {
    const antes = { a: {} as Distribuicao };
    expect(aplicarTotalCor(antes, "zzz", config, 96, lojas, prop, tamanhos)).toBe(antes);
  });
  it("cor que já tinha distribuição: total que NÃO bate não a zera", () => {
    const salva: Distribuicao = { ecom: { base: 10, grades: {}, manuais: [] } };
    const antes = { a: salva };
    const out = aplicarTotalCor(antes, "a", config, 100, lojas, prop, tamanhos);
    expect(out).toBe(antes);
    expect(out.a.ecom.base).toBe(10);
  });
  it("só mexe na cor pedida", () => {
    const outra: Distribuicao = { ecom: { base: 7, grades: {}, manuais: [] } };
    const out = aplicarTotalCor({ a: {}, b: outra }, "a", config, 96, lojas, prop, tamanhos);
    expect(out.b).toBe(outra);
  });
});

describe("DistribuirPorLojaDialog (fonte): a base NÃO é pré-preenchida na abertura", () => {
  const dlg = readFileSync("src/components/plan-tecido/DistribuirPorLojaDialog.tsx", "utf8");
  it("não semeia a config ao abrir (sem devePrePreencher / preencheuRef)", () => {
    expect(dlg).not.toContain("devePrePreencher");
    expect(dlg).not.toContain("preencheuRef");
  });
  it("o total digitado passa por aplicarTotalCor; o ↺ recalcular continua com aplicarConfigPorCor", () => {
    expect(dlg).toContain("aplicarTotalCor(");
    expect(dlg).toContain("aplicarConfigPorCor(");
  });
});
