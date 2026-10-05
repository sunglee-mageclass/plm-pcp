// urg R1 T7 (fix round 1) — a COLA de producao do Sheet do Planejamento: `tamanhoPorEtiquetaDe` (catalogo -> tamanho
// efetivo) e `recomputarEtiquetaComGrade` (previa de custo da linha), alem do texto de ajuda da linha.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { recomputarEtiquetaComGrade, tamanhoPorEtiquetaDe } from "@/components/planejamento/planejamento-detail/ficha/ficha-cad";
import type { EtiquetaInfo, GradeRow, ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";
import { mostraAvisoForaDaGrade, textoAjudaInsumoVinculado } from "@/components/desenvolvimento/modelo-detail/insumo-ajuda";
import { rotuloTamanho } from "@/lib/insumo-tamanho";
import { CASOS_ETIQUETA_FATOR, GRADE_FATOR } from "../fixtures/custo-bom-casos";

const TOL = 0.01;
const info = (p: Partial<EtiquetaInfo> = {}): EtiquetaInfo => ({
  id: "e1", nome: "Etq", formato_tamanho: "nenhum", preco: 1, variantes: [], tamanho_vinculado: null, ...p,
});
const linha = (consumo = 2, perda = 0): ModeloEtiquetaRow => ({ etiqueta_id: "e1", cor_id: null, consumo, loss_percent: perda, custo_previsto: 0 });
const soma = (g: Record<string, number>) => Object.values(g).reduce((s, v) => s + v, 0);
const gradeDe = (g: Record<string, number>): GradeRow[] => [{ variante_numero: 1, grades: g, grade_total: soma(g) }];

describe("tamanhoPorEtiquetaDe — catalogo -> tamanho efetivo", () => {
  it("vinculo valido (sem tamanho proprio) vira o tamanho, sem os espacos das pontas", () => {
    expect(tamanhoPorEtiquetaDe([linha()], { e1: info({ tamanho_vinculado: " 40|M " }) })).toEqual({ e1: "40|M" });
  });
  it("insumo COM variantes de tamanho proprio ignora o vinculo (Ruling A2)", () => {
    const m = { e1: info({ formato_tamanho: "unico", tamanho_vinculado: "40|M", variantes: [{ cor_id: null, cor_nome: null, preco: 1, tamanho: "U" }] }) };
    expect(tamanhoPorEtiquetaDe([linha()], m)).toEqual({ e1: null });
  });
  it("entrada ausente do catalogo, sem etiqueta ou sem vinculo = sem vinculo (null / fora do mapa)", () => {
    expect(tamanhoPorEtiquetaDe([linha()], {})).toEqual({ e1: null });
    expect(tamanhoPorEtiquetaDe([{ ...linha(), etiqueta_id: null }], { e1: info({ tamanho_vinculado: "40|M" }) })).toEqual({});
    expect(tamanhoPorEtiquetaDe([linha()], { e1: info() })).toEqual({ e1: null });
  });
  it("cada etiqueta aparece uma vez, mesmo em varias linhas (cores diferentes)", () => {
    const rows = [linha(), { ...linha(), cor_id: "azul" }];
    expect(tamanhoPorEtiquetaDe(rows, { e1: info({ tamanho_vinculado: "40|M" }) })).toEqual({ e1: "40|M" });
  });
});

describe("recomputarEtiquetaComGrade — previa de custo da linha", () => {
  const mapa = { e1: info({ preco: 1, tamanho_vinculado: "40|M" }) };

  it("mudar a grade recalcula o custo da linha vinculada", () => {
    const antes = recomputarEtiquetaComGrade(linha(2), mapa, gradeDe(GRADE_FATOR), false); // 16/64 = 0,25 -> 0,50
    const depois = recomputarEtiquetaComGrade(linha(2), mapa, gradeDe({ ...GRADE_FATOR, "40|M": 32 }), false); // 32/80 = 0,4 -> 0,80
    expect(antes.custo_previsto).toBeCloseTo(0.5, 2);
    expect(depois.custo_previsto).toBeCloseTo(0.8, 2);
  });

  it("gradeExterna (comprado): fator 1, o custo cheio, mesmo com vinculo e grade", () => {
    const r = recomputarEtiquetaComGrade(linha(2), mapa, gradeDe(GRADE_FATOR), true);
    expect(r.custo_previsto).toBe(2);
  });

  it("insumo com tamanho proprio: vinculo ignorado, custo cheio", () => {
    const m = { e1: info({ formato_tamanho: "unico", tamanho_vinculado: "40|M", variantes: [{ cor_id: null, cor_nome: null, preco: 1, tamanho: "U" }] }) };
    expect(recomputarEtiquetaComGrade(linha(2), m, gradeDe(GRADE_FATOR), false).custo_previsto).toBe(2);
  });

  it("tamanho fora da grade = 0; grade vazia = custo cheio; sem vinculo = custo cheio", () => {
    expect(recomputarEtiquetaComGrade(linha(2), { e1: info({ tamanho_vinculado: "46|XG" }) }, gradeDe(GRADE_FATOR), false).custo_previsto).toBe(0);
    expect(recomputarEtiquetaComGrade(linha(2), mapa, [], false).custo_previsto).toBe(2);
    expect(recomputarEtiquetaComGrade(linha(2), { e1: info() }, gradeDe(GRADE_FATOR), false).custo_previsto).toBe(2);
  });

  it("linha sem etiqueta escolhida: custo 0 (como sempre)", () => {
    expect(recomputarEtiquetaComGrade({ ...linha(2), etiqueta_id: null }, mapa, gradeDe(GRADE_FATOR), false).custo_previsto).toBe(0);
  });

  it.each(CASOS_ETIQUETA_FATOR.map((c) => [c.nome, c] as const))("fixture do servidor pela cola de producao: %s", (_n, caso) => {
    const m = {
      e1: info({
        preco: caso.preco,
        formato_tamanho: caso.tamanhoProprio ? "unico" : "nenhum",
        tamanho_vinculado: caso.vinculo,
        variantes: caso.tamanhoProprio ? [{ cor_id: null, cor_nome: null, preco: caso.preco, tamanho: "U" }] : [],
      }),
    };
    const g = caso.grade ? gradeDe(caso.grade) : [];
    const r = recomputarEtiquetaComGrade(linha(caso.consumo, caso.perda), m, g, false);
    expect(Math.abs(r.custo_previsto - caso.esperado)).toBeLessThanOrEqual(TOL + 1e-9);
  });

  it("o efeito de precos do useFichaBom depende de `grades` (mudar a grade dispara o recalculo)", () => {
    const src = readFileSync("src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts", "utf8");
    expect(src).toMatch(/\[dados\.etiquetaMap, dados\.etiquetasData, grades, gradeExterna, cargaSeq, hidratarTick\]/);
  });
});

describe("texto de ajuda da linha vinculada", () => {
  const rot = rotuloTamanho("40|M");
  it("interno: qtd = consumo x pecas do tamanho", () => {
    expect(textoAjudaInsumoVinculado(rot, false)).toBe("Vinculado ao tamanho M · 40 — qtd = consumo × peças desse tamanho.");
  });
  it("comprado: texto neutro, sem prometer so as pecas do tamanho", () => {
    const t = textoAjudaInsumoVinculado(rot, true);
    expect(t).toContain("custo previsto calculado no servidor");
    expect(t).not.toContain("peças desse tamanho");
  });
  it("aviso de fora da grade: so no interno", () => {
    expect(mostraAvisoForaDaGrade(true, false)).toBe(true);
    expect(mostraAvisoForaDaGrade(true, true)).toBe(false);
    expect(mostraAvisoForaDaGrade(false, false)).toBe(false);
  });
});
