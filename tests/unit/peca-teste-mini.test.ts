import { describe, it, expect } from "vitest";
import {
  linhasUmaPeca, alocarTecido, arredondar, miniExplosaoFeita,
  chaveTecido, chaveAviamento, chaveInsumo, tamanhoBucketInsumo,
} from "@/lib/peca-teste-mini";
import { CASOS_MINI_LINHAS, CASOS_MINI_ALOCAR } from "../fixtures/peca-teste-mini-casos";

// compara so os campos de identidade/calculo que o anti-drift SQL confere (4 casas nos numeros).
const r4 = (x: number) => Number(x.toFixed(4));
const normLinha = (l: {
  chave: string; familia: string; tipo: string | null; numero: number | null; ordem: number | null;
  variante_tecido_id: string | null; pecas: number; aviamento_id: string | null; variante_aviamento_id: string | null;
  etiqueta_id: string | null; cor_id: string | null; tamanho_bucket: string | null; consumo: number;
  loss_percent: number; necessaria: number; a_enviar: number; unidade: string;
}) => ({
  chave: l.chave, familia: l.familia, tipo: l.tipo, numero: l.numero, ordem: l.ordem,
  variante_tecido_id: l.variante_tecido_id, pecas: r4(l.pecas), aviamento_id: l.aviamento_id,
  variante_aviamento_id: l.variante_aviamento_id, etiqueta_id: l.etiqueta_id, cor_id: l.cor_id,
  tamanho_bucket: l.tamanho_bucket, consumo: r4(l.consumo), loss_percent: r4(l.loss_percent),
  necessaria: r4(l.necessaria), a_enviar: r4(l.a_enviar), unidade: l.unidade,
});

describe("peca-teste-mini: linhasUmaPeca (BOM 1 peca)", () => {
  for (const c of CASOS_MINI_LINHAS) {
    it(c.nome, () => {
      const got = linhasUmaPeca(c.bom, c.tamanho, c.ordemN, c.varianteV, c.ajustes);
      const esperadoChaves = new Set(c.esperado.map((e) => e.chave));
      expect(got.map((l) => l.chave).sort()).toEqual([...esperadoChaves].sort());
      const byChave = new Map(got.map((l) => [l.chave, l]));
      for (const e of c.esperado) {
        const g = byChave.get(e.chave);
        expect(g, `linha ${e.chave}`).toBeDefined();
        expect(normLinha(g!)).toMatchObject(normLinha(e));
      }
    });
  }
});

describe("peca-teste-mini: alocarTecido (regua do corte)", () => {
  for (const c of CASOS_MINI_ALOCAR) {
    it(c.nome, () => {
      const got = alocarTecido({
        modo: c.modo, mesma_oc: c.mesma_oc, itemEscolhido: c.itemEscolhido,
        metros: c.metros, vinculos: c.vinculos, fifo: c.fifo,
      });
      expect(r4(got.baixado)).toBe(r4(c.esperado.baixado));
      expect(got.fontes.map((f) => ({ oc_tecido_item_id: f.oc_tecido_item_id, metros: r4(f.metros) })))
        .toEqual(c.esperado.fontes.map((f) => ({ oc_tecido_item_id: f.oc_tecido_item_id, metros: r4(f.metros) })));
    });
  }
});

describe("peca-teste-mini: arredondar (decimal, half-up)", () => {
  it("meio centavo 1.005 -> 1.01", () => expect(arredondar(1.005, 2)).toBe(1.01));
  it("1.575 -> 1.58", () => expect(arredondar(1.5 * 1.05, 2)).toBe(1.58));
  it("round 4 casas", () => expect(arredondar(1.23455, 4)).toBe(1.2346));
  it("inteiro intacto", () => expect(arredondar(3, 2)).toBe(3));
  it("negativo", () => expect(arredondar(-1.005, 2)).toBe(-1.01));
  it("nao-finito -> 0", () => expect(arredondar(NaN, 2)).toBe(0));
});

describe("peca-teste-mini: chaves", () => {
  it("tecido", () => expect(chaveTecido("tecido", 1, 2, "vx")).toBe("t:tecido:1:2:vx"));
  it("aviamento", () => expect(chaveAviamento("ax", 2)).toBe("a:ax:2"));
  it("insumo com cor", () => expect(chaveInsumo("ex", "cx", 1)).toBe("i:ex:cx:1"));
  it("insumo sem cor", () => expect(chaveInsumo("ex", null, 1)).toBe("i:ex:-:1"));
});

describe("peca-teste-mini: tamanhoBucketInsumo (ce_sem)", () => {
  it("formato nenhum -> NULL", () => expect(tamanhoBucketInsumo("M", "nenhum", [{ tamanho: "M" }])).toBeNull());
  it("sem variante com tamanho -> NULL", () => expect(tamanhoBucketInsumo("M", "ambos", [{ tamanho: null }])).toBeNull());
  it("tamanho ' ' (espaco) -> NULL", () => expect(tamanhoBucketInsumo("M", "ambos", [{ tamanho: " " }])).toBeNull());
  it("com tamanho proprio -> T", () => expect(tamanhoBucketInsumo("M", "letra", [{ tamanho: "M" }])).toBe("M"));
  it("tamanho T null -> NULL", () => expect(tamanhoBucketInsumo(null, "letra", [{ tamanho: "M" }])).toBeNull());
  it("formato null = ambos (nao nenhum)", () => expect(tamanhoBucketInsumo("M", null, [{ tamanho: "M" }])).toBe("M"));
});

describe("peca-teste-mini: miniExplosaoFeita (R12)", () => {
  it("sem trilha -> false", () => expect(miniExplosaoFeita([])).toBe(false));
  it("atual com baixa -> true", () =>
    expect(miniExplosaoFeita([{ numero: 1, baixa_ativa: false }, { numero: 2, baixa_ativa: true }])).toBe(true));
  it("atual sem baixa -> false (mesmo com anterior com baixa)", () =>
    expect(miniExplosaoFeita([{ numero: 1, baixa_ativa: true }, { numero: 2, baixa_ativa: false }])).toBe(false));
  it("unica com baixa -> true", () => expect(miniExplosaoFeita([{ numero: 1, baixa_ativa: true }])).toBe(true));
  it("unica sem baixa -> false", () => expect(miniExplosaoFeita([{ numero: 1, baixa_ativa: false }])).toBe(false));
});
