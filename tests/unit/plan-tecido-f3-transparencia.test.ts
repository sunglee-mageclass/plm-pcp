import { describe, it, expect } from "vitest";
import {
  estoqueDoArtigo, outrasColecoesDoTecido, textoOutrasColecoes, fmtMetros, type CoberturaVarRow,
} from "@/lib/plan-tecido/calc";

const cob = (artigo_id: string, recebido_m?: number, prev_receb_m?: number, fisico_m?: number): CoberturaVarRow => ({
  artigo_id, variante_tecido_id: `v-${artigo_id}-${recebido_m}-${fisico_m}`, nec_m: 10, deficit_m: 0, recebido_m, prev_receb_m, fisico_m,
});

describe("estoqueDoArtigo (F3)", () => {
  it("soma recebido e a chegar das variantes do MESMO artigo (2+ cores)", () => {
    // fisico (disponível) < recebido (bruto): corte/peça-teste já baixados; o Resumo usa o fisico
    const r = estoqueDoArtigo([cob("A", 10, 5, 7), cob("A", 2.5, 0, 2.5), cob("B", 99, 99, 99)], "A");
    expect(r).toEqual({ recebido: 12.5, prevReceb: 5, fisico: 9.5 });
  });
  it("artigo sem linha / cobertura vazia ou ausente → 0/0", () => {
    expect(estoqueDoArtigo([cob("B", 1, 1, 1)], "A")).toEqual({ recebido: 0, prevReceb: 0, fisico: 0 });
    expect(estoqueDoArtigo([], "A")).toEqual({ recebido: 0, prevReceb: 0, fisico: 0 });
    expect(estoqueDoArtigo(undefined, "A")).toEqual({ recebido: 0, prevReceb: 0, fisico: 0 });
  });
  it("campos ausentes/nulos viram 0 (variante sem OC)", () => {
    expect(estoqueDoArtigo([cob("A", undefined, undefined, undefined), cob("A", 0, 0, 0)], "A")).toEqual({ recebido: 0, prevReceb: 0, fisico: 0 });
  });
  it("prévia antiga sem fisico_m → fisico 0 (retrocompatível; recebido/prevReceb seguem)", () => {
    expect(estoqueDoArtigo([cob("A", 4, 1)], "A")).toEqual({ recebido: 4, prevReceb: 1, fisico: 0 });
  });
});

describe("outrasColecoesDoTecido (F3)", () => {
  const outras = [
    { artigo_id: "A", colecoes: [{ colecao_id: "c1", colecao_nome: "Verão", nec_m: 120, papel: "principal" as const }, { colecao_id: "c2", colecao_nome: "Inverno", nec_m: 30.5, papel: "substituto" as const }] },
    { artigo_id: "B", colecoes: [] },
  ];
  it("devolve as coleções do artigo", () => {
    expect(outrasColecoesDoTecido(outras, "A")).toHaveLength(2);
  });
  it("artigo só na coleção atual (ausente ou lista vazia) → []", () => {
    expect(outrasColecoesDoTecido(outras, "B")).toEqual([]);
    expect(outrasColecoesDoTecido(outras, "Z")).toEqual([]);
    expect(outrasColecoesDoTecido(undefined, "A")).toEqual([]);
  });
});

describe("textoOutrasColecoes (F3)", () => {
  it("formata 'Nome (N m) — papel, …' (F3.1: principal/substituto)", () => {
    const t = textoOutrasColecoes(
      [{ colecao_id: "c1", colecao_nome: "Verão", nec_m: 1200, papel: "principal" }, { colecao_id: "c2", colecao_nome: "Inverno", nec_m: 30.5, papel: "substituto" }],
      fmtMetros,
    );
    expect(t).toBe("Verão (1.200 m) — principal, Inverno (30,5 m) — substituto");
  });
  it("mesma coleção com os 2 papéis → 2 entradas, uma por papel", () => {
    const t = textoOutrasColecoes(
      [{ colecao_id: "c1", colecao_nome: "Verão", nec_m: 1418.6, papel: "principal" }, { colecao_id: "c1", colecao_nome: "Verão", nec_m: 91.2, papel: "substituto" }],
      fmtMetros,
    );
    expect(t).toBe("Verão (1.418,6 m) — principal, Verão (91,2 m) — substituto");
  });
  it("prévia antiga sem `papel` → sem sufixo (retrocompatível)", () => {
    const antigo = [{ colecao_id: "c1", colecao_nome: "Verão", nec_m: 10 }] as unknown as Parameters<typeof textoOutrasColecoes>[0];
    expect(textoOutrasColecoes(antigo, fmtMetros)).toBe("Verão (10 m)");
  });
  it("lista vazia → '' (o 'i' não renderiza)", () => {
    expect(textoOutrasColecoes([], fmtMetros)).toBe("");
  });
});
