// Contas certas C1 (R-CD4) — anti-drift TS × SQL do custo previsto do BOM. O VALOR QUE VALE é o do servidor
// (migration 20261019300000: _custo_linha/_custo_preco_*/_custo_adicionais_soma/_custo_calcular); as funções TS abaixo só
// alimentam a prévia ao vivo do Sheet. Mesmas fixtures do lado SQL (tests/integration/custo-previsto-servidor.test.ts):
// o TS tem de ficar a no máximo TOLERANCIA (0,01) do `esperado` (= SQL exato) por linha e no total.
import { describe, it, expect } from "vitest";
import {
  makeEmptyBlocks,
  recomputeAviamento,
  recomputeBlock,
  recomputeEtiqueta,
  type EtiquetaInfo,
  type TecidoBlock,
} from "@/components/desenvolvimento/modelo-detail/types";
import { pecaCom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import { somaCustosAdicionais } from "@/lib/custo";
import {
  CASO_MODELO,
  CASOS_ADICIONAIS,
  CASOS_AVIAMENTO,
  CASOS_ETIQUETA,
  CASOS_TECIDO,
  MEIO_CENTAVO,
  TOLERANCIA,
  precoPorMetro,
  type CasoEtiqueta,
  type CasoTecido,
} from "../fixtures/custo-bom-casos";

const perto = (ts: number, sql: number) => Math.abs(ts - sql) <= TOLERANCIA + 1e-9;

/** Monta as entradas do recomputeBlock como o Sheet monta (mapas de artigo/variante + preço congelado do servidor). */
function tecidoTs(caso: CasoTecido): number {
  const base = makeEmptyBlocks().find((b) => b.tipo === caso.tipo && b.numero === caso.numero)!;
  const variantes = caso.substitutos.map((_, i) => `var-${i}`);
  const bloco: TecidoBlock = {
    ...base,
    artigo_id: "art-linha",
    consumo: caso.consumo,
    loss_percent: caso.perda,
    variantes: [...variantes, ...Array(10 - variantes.length).fill(null)],
  };
  const artigoMap: Record<string, { preco?: number | null; preco_por_metro?: number | null }> = {
    "art-linha": { preco: caso.artigo.preco, preco_por_metro: precoPorMetro(caso.artigo) },
  };
  const varianteArtigoMap: Record<string, string> = {};
  caso.substitutos.forEach((a, i) => {
    artigoMap[`art-sub-${i}`] = { preco: a.preco, preco_por_metro: precoPorMetro(a) };
    varianteArtigoMap[`var-${i}`] = `art-sub-${i}`;
  });
  // o mapa congelado vem da RPC precos_tecido_congelado: só item não cancelado e com preço; kg ÷ rendimento
  const frozen: Record<string, number> = {};
  if (caso.oc && !caso.oc.cancelado && caso.oc.preco != null) {
    const a = caso.oc.artigo;
    frozen[`${caso.tipo}|${caso.numero}`] =
      a.unidade === "kg" && (a.rendimento ?? 0) > 0 ? caso.oc.preco / (a.rendimento as number) : caso.oc.preco;
  }
  return recomputeBlock(bloco, artigoMap, varianteArtigoMap, frozen).custo_previsto;
}

function etiquetaTs(caso: CasoEtiqueta): number {
  const info: EtiquetaInfo = {
    id: "etq",
    nome: "Etq",
    formato_tamanho: "unico",
    preco: caso.precoBase,
    variantes: caso.variantes.map((v) => ({ cor_id: v.cor, cor_nome: v.cor, preco: v.preco })),
  };
  return recomputeEtiqueta(
    { etiqueta_id: "etq", cor_id: caso.cor, consumo: caso.consumo, loss_percent: caso.perda, custo_previsto: 0 },
    { etq: info },
  ).custo_previsto;
}

describe("custo previsto — anti-drift TS × SQL (tests/fixtures/custo-bom-casos.ts)", () => {
  it.each(CASOS_TECIDO.map((c) => [c.nome, c] as const))("tecido: %s", (_nome, caso) => {
    expect(perto(tecidoTs(caso), caso.esperado)).toBe(true);
  });

  it.each(CASOS_AVIAMENTO.map((c) => [c.nome, c] as const))("aviamento: %s", (_nome, caso) => {
    const ts = recomputeAviamento(
      { aviamento_id: "avi", consumo: caso.consumo, loss_percent: caso.perda, custo_previsto: 0 },
      { avi: { preco: caso.preco } },
    ).custo_previsto;
    expect(perto(ts, caso.esperado)).toBe(true);
  });

  it.each(CASOS_ETIQUETA.map((c) => [c.nome, c] as const))("etiqueta: %s", (_nome, caso) => {
    expect(perto(etiquetaTs(caso), caso.esperado)).toBe(true);
  });

  it.each(CASOS_ADICIONAIS.map((c) => [c.nome, c] as const))("custos adicionais (R-CD6): %s", (_nome, caso) => {
    expect(perto(somaCustosAdicionais(caso.custos), caso.esperado)).toBe(true);
  });

  it("R-CD4 meio centavo: 1,005 × 1 × 1 — TS dá 1,00, o SQL grava 1,01 (dentro da tolerância; vale o servidor)", () => {
    const ts = recomputeAviamento(
      { aviamento_id: "avi", consumo: MEIO_CENTAVO.consumo, loss_percent: MEIO_CENTAVO.perda, custo_previsto: 0 },
      { avi: { preco: MEIO_CENTAVO.preco } },
    ).custo_previsto;
    expect(ts).toBe(MEIO_CENTAVO.ts);
    expect(ts).not.toBe(MEIO_CENTAVO.sql);
    expect(perto(ts, MEIO_CENTAVO.sql)).toBe(true);
  });

  it("card inteiro: totais por tipo + M.O. multi-instância + adicionais somam na ordem de pecaCom", () => {
    const e = CASO_MODELO.esperado;
    const soma = (tipo: CasoTecido["tipo"]) =>
      CASO_MODELO.tecidos.filter((t) => t.tipo === tipo).reduce((s, t) => s + tecidoTs(t), 0);
    const t = {
      tecido: soma("tecido"),
      forro: soma("forro"),
      entretela: soma("entretela"),
      aviamento: CASO_MODELO.aviamentos.reduce(
        (s, a) =>
          s + recomputeAviamento({ aviamento_id: "avi", consumo: a.consumo, loss_percent: a.perda, custo_previsto: 0 }, { avi: { preco: a.preco } }).custo_previsto,
        0,
      ),
      etiqueta: CASO_MODELO.etiquetas.reduce((s, x) => s + etiquetaTs(x), 0),
      custosAdicionais: somaCustosAdicionais(CASO_MODELO.adicionais),
    };
    const mo = CASO_MODELO.maoObra.reduce((s, v) => s + v, 0);
    expect(perto(t.tecido, e.tecido)).toBe(true);
    expect(perto(t.forro, e.forro)).toBe(true);
    expect(perto(t.entretela, e.entretela)).toBe(true);
    expect(perto(t.aviamento, e.aviamento)).toBe(true);
    expect(perto(t.etiqueta, e.etiqueta)).toBe(true);
    expect(perto(mo, e.mao_obra)).toBe(true);
    expect(perto(t.custosAdicionais, e.adicionais)).toBe(true);
    expect(perto(pecaCom(t, mo), e.peca)).toBe(true);
  });
});
