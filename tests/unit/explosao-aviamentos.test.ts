import { describe, it, expect } from "vitest";
import {
  agruparAviamentosExplosao,
  chaveEntradaAviamento,
  type ModeloAviamentoEmbedRow,
} from "@/lib/explosao-aviamentos";

let seq = 0;
const zíper = (variante: ModeloAviamentoEmbedRow["variantes_aviamento"] | null, consumo: number, vid: string | null, numero?: number): ModeloAviamentoEmbedRow => ({
  aviamento_id: "avi-ziper",
  variante_aviamento_id: vid,
  numero: numero ?? ++seq,
  consumo,
  aviamentos: { codigo_nome: "Zíper 55cm" },
  variantes_aviamento: variante,
});

describe("agruparAviamentosExplosao — bloco de aviamentos da Explosão", () => {
  it("agrega por aviamento × variante e deriva qtd = Σ consumo × grade", () => {
    const rows: ModeloAviamentoEmbedRow[] = [
      zíper({ nome_variante: null, cor: { nome: "Off White" }, apelido: { nome: "Branco" } }, 0.05, "v-branco"),
      // mesma (aviamento, variante) numa 2ª linha do BOM → soma o consumo
      zíper({ nome_variante: null, cor: { nome: "Off White" }, apelido: { nome: "Branco" } }, 0.05, "v-branco"),
    ];
    const [g] = agruparAviamentosExplosao(rows, 192);
    expect(g.aviamento_nome).toBe("Zíper 55cm");
    expect(g.linhas).toHaveLength(1);
    expect(g.linhas[0].label).toBe("Off White - Branco");
    expect(g.linhas[0].consumo).toBeCloseTo(0.1, 6);
    // 0.1 × 192 = 19.2
    expect(g.linhas[0].quantidade).toBeCloseTo(19.2, 6);
    expect(g.totalQtd).toBeCloseTo(19.2, 6);
  });

  it("mantém o aviamento legado SEM variante como linha 'Sem variante'", () => {
    const rows: ModeloAviamentoEmbedRow[] = [
      { aviamento_id: "avi-patch", variante_aviamento_id: null, consumo: 1, aviamentos: { codigo_nome: "Patch" }, variantes_aviamento: null },
      { aviamento_id: "avi-patch", variante_aviamento_id: null, consumo: 0, aviamentos: { codigo_nome: "Patch" }, variantes_aviamento: null },
    ];
    const [g] = agruparAviamentosExplosao(rows, 120);
    expect(g.linhas).toHaveLength(1);
    expect(g.linhas[0].variante_aviamento_id).toBeNull();
    expect(g.linhas[0].label).toBe("Sem variante");
    expect(g.linhas[0].consumo).toBe(1);
    expect(g.linhas[0].quantidade).toBe(120);
  });

  it("separa variantes distintas do MESMO aviamento e ordena 'Sem variante' por último", () => {
    const rows: ModeloAviamentoEmbedRow[] = [
      zíper(null, 0.2, null),
      zíper({ nome_variante: null, cor: { nome: "Preto" }, apelido: null }, 0.1, "v-preto"),
      zíper({ nome_variante: null, cor: { nome: "Azul" }, apelido: null }, 0.1, "v-azul"),
    ];
    const [g] = agruparAviamentosExplosao(rows, 10);
    expect(g.linhas.map((l) => l.label)).toEqual(["Azul", "Preto", "Sem variante"]);
    expect(g.totalQtd).toBeCloseTo(4, 6); // (0.1+0.1+0.2) × 10
  });

  it("ordena os grupos pelo nome do aviamento e ignora linhas sem aviamento_id", () => {
    const rows: ModeloAviamentoEmbedRow[] = [
      { aviamento_id: "b", variante_aviamento_id: null, consumo: 1, aviamentos: { codigo_nome: "Zíper" }, variantes_aviamento: null },
      { aviamento_id: "a", variante_aviamento_id: null, consumo: 1, aviamentos: { codigo_nome: "Botão" }, variantes_aviamento: null },
      { aviamento_id: null, variante_aviamento_id: null, consumo: 9, aviamentos: null, variantes_aviamento: null },
    ];
    const grupos = agruparAviamentosExplosao(rows, 5);
    expect(grupos.map((x) => x.aviamento_nome)).toEqual(["Botão", "Zíper"]);
  });

  it("grade zero → qtd zero (bloco aparece, sem esconder aviamento)", () => {
    const rows: ModeloAviamentoEmbedRow[] = [zíper({ nome_variante: null, cor: { nome: "Preto" }, apelido: null }, 0.5, "v-preto")];
    const [g] = agruparAviamentosExplosao(rows, 0);
    expect(g.linhas[0].quantidade).toBe(0);
    expect(g.linhas[0].consumo).toBe(0.5);
  });

  describe("a separar/enviar (espelho do metragem_enviada do tecido)", () => {
    it("default = necessária quando não há registro no CAD", () => {
      const rows: ModeloAviamentoEmbedRow[] = [zíper({ nome_variante: null, cor: { nome: "Branco" }, apelido: null }, 0.05, "v-branco", 1)];
      const [g] = agruparAviamentosExplosao(rows, 192);
      // sem mapa → a separar cai no default = necessária (0.05 × 192 = 9.6)
      expect(g.linhas[0].quantidade).toBeCloseTo(9.6, 6);
      expect(g.linhas[0].aSeparar).toBeCloseTo(9.6, 6);
      expect(g.totalSeparar).toBeCloseTo(9.6, 6);
    });

    it("usa o cad_aviamentos.quantidade_separar por entrada (aviamento_id, numero) quando presente", () => {
      const rows: ModeloAviamentoEmbedRow[] = [zíper({ nome_variante: null, cor: { nome: "Branco" }, apelido: null }, 0.05, "v-branco", 3)];
      const mapa = new Map<string, number>([[chaveEntradaAviamento("avi-ziper", 3), 4]]);
      const [g] = agruparAviamentosExplosao(rows, 192, mapa);
      // necessária inalterada; a separar = valor editado no CAD (4), não o default 9.6
      expect(g.linhas[0].quantidade).toBeCloseTo(9.6, 6);
      expect(g.linhas[0].aSeparar).toBe(4);
    });

    it("soma 'a separar' por (aviamento, variante) e cada entrada casa por numero", () => {
      const rows: ModeloAviamentoEmbedRow[] = [
        zíper({ nome_variante: null, cor: { nome: "Branco" }, apelido: null }, 0.05, "v-branco", 1),
        zíper({ nome_variante: null, cor: { nome: "Branco" }, apelido: null }, 0.05, "v-branco", 2),
      ];
      const mapa = new Map<string, number>([
        [chaveEntradaAviamento("avi-ziper", 1), 3],
        [chaveEntradaAviamento("avi-ziper", 2), 5],
      ]);
      const [g] = agruparAviamentosExplosao(rows, 100, mapa);
      expect(g.linhas).toHaveLength(1);
      expect(g.linhas[0].aSeparar).toBe(8); // 3 + 5
      expect(g.linhas[0].quantidade).toBeCloseTo(10, 6); // (0.05+0.05) × 100
    });
  });
});
