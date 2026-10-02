// L7 (LEVES, 02/out) — Plan. Tecido:
//  • PT gaveta "oc": a visão "Detalhe por variante" da coleção usa a MESMA fonte do Resumo (detalheOcColecao +
//    sobraOc/demandaSemCor) — a demanda sem cor também abate e a Sobra total = Σ da "Situação por OC".
//  • D-3: o Salvar não muda a ordem das vagas nem o desempate da repartição D5 (ordemD5 por modelo_id; ordem fixa
//    dos modelos; slot_index = posição na tela).
//  • prod #9 (resto): pç ≠ soma dos tamanhos → aviso âmbar, sem redistribuir.
//  • est #14: vaga cujo card saiu fica com os materiais + selo âmbar + atalho "limpar materiais" (staging).
//  • est #13: proporção legada só numérica cai no lado número ("36|PP").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  contaOcColecao,
  contabilizarOc,
  detalheOc,
  detalheOcColecao,
  necessidadePorTecido,
  ordemD5,
  resumoOcsColecao,
  sobraOc,
  somaTamanhosDivergente,
  type VinculoDetalhe,
} from "@/lib/plan-tecido/calc";
import {
  comOrdemDasVagas,
  limparMateriaisDaVaga,
  limparSlotsOrfaos,
  contarVagasCardSaiuComMateriais,
  textoAvisoCardSaiu,
  mergeArvore,
  semearComModelos,
  vagaComMateriaisDeCardQueSaiu,
  type ModeloReal,
  type SeedInput,
} from "@/lib/plan-tecido/engine";
import { agruparPorOc, type SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";
import { proporcaoDoTamanho } from "@/lib/distribuicao-produto";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const mat = (aid: string, consumo: number, vars: [string | null, number][]) => ({
  artigo_id: aid,
  artigo_nome: aid,
  unidade_medida: "metro",
  rendimento: null,
  tipo: "tecido" as const,
  numero: 1,
  consumo,
  loss_percent: 0,
  ordem: 0,
  variantes: vars.map(([vid, g], i) => ({
    variante_tecido_id: vid,
    cor_id: vid ? undefined : "cor",
    label: vid ?? "plan",
    ordem: i + 1,
    multiplicador: 1,
    grades: {},
    grade_total: g,
  })),
});
const arvDe = (slots: PtSlot[]): PtArvore => ({
  colecao_id: "c",
  subcolecoes: [
    {
      subcolecao_id: null,
      ordem: 0,
      linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }],
    },
  ],
});
const sit = (
  o: Partial<SituacaoOcRow> & { oc_tecido_id: string; variante_tecido_id: string },
): SituacaoOcRow => ({
  numero: o.oc_tecido_id,
  data_pedido: null,
  status: "encomendado",
  artigo_id: "T",
  artigo_nome: "TECIDO T",
  variante_label: o.variante_tecido_id,
  pedida_m: 0,
  entregue_m: 0,
  usada_m: 0,
  comprometida_m: 0,
  ...o,
});
const capacidade = (rows: SituacaoOcRow[]) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const cap = r.status === "recebido" ? r.entregue_m : r.pedida_m;
    m.set(
      `${r.oc_tecido_id}|${r.variante_tecido_id}`,
      (m.get(`${r.oc_tecido_id}|${r.variante_tecido_id}`) ?? 0) + cap,
    );
    m.set(
      `${r.oc_tecido_id}|artigo:${r.artigo_id}`,
      (m.get(`${r.oc_tecido_id}|artigo:${r.artigo_id}`) ?? 0) + cap,
    );
  }
  return m;
};
const mapsIguais = (a: Map<string, number>, b: Map<string, number>) => {
  expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
};

// ─── PT gaveta "oc" ──────────────────────────────────────────────────────────────────────────────────────────
// Coleção com 2 OCs do tecido T. Card A (cor AZUL, 50 m) e card B (só-artigo, SEM cor, 30 m) na oc1; card C (AZUL,
// 20 m, enviado à explosão) na oc2; card D (VERDE, 10 m) SEM vínculo (a comprar, à parte).
const A: PtSlot = { id: "sA", modelo_id: "mA", materiais: [mat("T", 1, [["AZUL", 50]])] };
const B: PtSlot = { id: "sB", modelo_id: "mB", materiais: [mat("T", 1, [[null, 30]])] };
const C: PtSlot = { id: "sC", modelo_id: "mC", materiais: [mat("T", 1, [["AZUL", 20]])] };
const D: PtSlot = { id: "sD", modelo_id: "mD", materiais: [mat("T", 1, [["VERDE", 10]])] };
const ARV = arvDe([A, B, C, D]);
const VINC_MAP = { mA: ["oc1"], mB: ["oc1"], mC: ["oc2"] };
const SITUACAO: SituacaoOcRow[] = [
  sit({
    oc_tecido_id: "oc1",
    variante_tecido_id: "AZUL",
    status: "recebido",
    pedida_m: 100,
    entregue_m: 100,
  }),
  sit({
    oc_tecido_id: "oc1",
    variante_tecido_id: "VERDE",
    status: "recebido",
    pedida_m: 40,
    entregue_m: 40,
  }),
  sit({
    oc_tecido_id: "oc2",
    variante_tecido_id: "AZUL",
    status: "recebido",
    pedida_m: 30,
    entregue_m: 30,
    usada_m: 25,
  }),
];
const ENVIADOS = new Set(["mC"]);
const DET = detalheOcColecao(ARV, SITUACAO, VINC_MAP, {}, ENVIADOS, {
  capacidade: capacidade(SITUACAO),
});

describe('PT gaveta "oc" — visão da coleção pela mesma fonte do Resumo', () => {
  it("Sobra total = Σ das Sobras da Situação por OC (Resumo) = Σ por cor + sem cor", () => {
    const conta = contaOcColecao(SITUACAO, DET);
    const resumo = resumoOcsColecao(agruparPorOc(SITUACAO), SITUACAO, DET);
    const somaResumo = resumo.reduce((s, o) => s + o.sobra, 0);
    expect(conta.sobraTotal).toBeCloseTo(somaResumo, 9);
    const somaLinhas =
      [...conta.porCor.values()].reduce((s, c) => s + c.sobra, 0) + conta.semCor.sobra;
    expect(somaLinhas).toBeCloseTo(conta.sobraTotal, 9);
    // oc1: AZUL 100−50 + VERDE 40−0 − sem cor 30 = 60 · oc2: AZUL 30 − max(20, 25) = 5
    expect(resumo.map((o) => o.sobra)).toEqual([60, 5]);
    expect(conta.sobraTotal).toBe(65);
  });

  it("a demanda SEM COR (só-artigo) abate: 30 m do card B entram no total", () => {
    const conta = contaOcColecao(SITUACAO, DET);
    expect(conta.semCor.reservada).toBe(30);
    expect(conta.semCor.sobra).toBe(-30);
    // a régua antiga (Σ da necessidade dos cards vinculados por variante, sem repartir e sem a parte sem cor)
    // dava outra Sobra: AZUL 130 − 70 = 60, VERDE 40 − 0 = 40 → 100 ≠ 65
    const fisico = (s: PtSlot) =>
      !!s.modelo_id && !!(VINC_MAP as Record<string, string[]>)[s.modelo_id];
    const necByVar = new Map<string, number>();
    for (const t of necessidadePorTecido(ARV, fisico))
      for (const v of t.variantes)
        if (v.variante_tecido_id)
          necByVar.set(v.variante_tecido_id, (necByVar.get(v.variante_tecido_id) ?? 0) + v.metros);
    const antiga =
      contabilizarOc(necByVar.get("AZUL") ?? 0, 20, 25, 130).sobra +
      contabilizarOc(necByVar.get("VERDE") ?? 0, 0, 0, 40).sobra;
    expect(antiga).toBe(100);
    expect(conta.sobraTotal).not.toBe(antiga);
  });

  it("por cor a linha fecha: Entregue − Demanda = Sobra, e a conta é OC a OC (não sobre o agregado)", () => {
    const conta = contaOcColecao(SITUACAO, DET);
    const azul = conta.porCor.get("T|AZUL")!;
    // oc1 AZUL: 50 reservada, entregue 100 → 50 · oc2 AZUL: 20 comprometida/baixa 25, entregue 30 → 5
    expect(azul.demanda).toBe(50 + 25);
    expect(azul.usada).toBe(25);
    expect(azul.comprometida).toBe(20);
    expect(azul.baixaDomina).toBe(true);
    expect(130 - azul.demanda).toBe(azul.sobra);
    expect(azul.sobra).toBe(55);
    // no agregado (contabilizarOc sobre a soma) daria 130 − max(70, 25) = 60: o max por OC sumia
    expect(contabilizarOc(70, 20, 25, 130).sobra).toBe(60);
    expect(sobraOc("oc2", SITUACAO, DET)).toBe(5);
    const verde = conta.porCor.get("T|VERDE")!;
    expect(verde.demanda).toBe(0);
    expect(verde.sobra).toBe(40);
  });

  it("asserção de fonte: a gaveta 'oc' usa contaOcColecao sobre o MESMO det; necByVar saiu", () => {
    const drawer = ler("src/components/plan-tecido/PlanTecidoDrawer.tsx");
    expect(drawer).toContain(
      'const contaCol = kind === "oc" ? contaOcColecao(situacao, det) : null;',
    );
    expect(drawer).not.toMatch(/necByVar|comprometidoByVar/);
    expect(drawer).toContain(
      "v.conta ?? contabilizarOc(v.reservada, v.comprometida, v.usada, v.entregue)",
    );
    expect(drawer).toContain("contaCol ? contaCol.sobraTotal : sobraOc(arg!, situacao, det)");
    expect(drawer).toContain("contaCol ? contaCol.semCor : demandaSemCor(arg!, det)");
  });
});

// ─── D-3 ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 2 cards disputam a MESMA OC (ocA, 100 m de AZUL); cada um transborda para uma OC DIFERENTE (P → ocB, Q → ocC):
// quem vem primeiro enche a ocA e o outro transborda — a ordem muda os metros por OC.
// Fix round 1 (B3): o desempate é o card mais ANTIGO (`criado_em` = modelos.created_at), depois o modelo_id.
const P: PtSlot = {
  id: "sP",
  modelo_id: "m-p",
  criado_em: "2026-08-01T10:00:00+00:00",
  materiais: [mat("T", 1, [["AZUL", 80]])],
};
const Q: PtSlot = {
  id: "sQ",
  modelo_id: "m-q",
  criado_em: "2026-08-02T09:00:00.5+00:00",
  materiais: [mat("T", 1, [["AZUL", 60]])],
};
const VAGA: PtSlot = { id: "sV", modelo_id: null, materiais: [mat("T", 1, [["AZUL", 10]])] };
const vin = (modelo_id: string, oc: string, item: string, prioridade: number): VinculoDetalhe => ({
  modelo_id,
  tipo: "tecido",
  numero: 1,
  ordem: 1,
  variante_tecido_id: "AZUL",
  oc_tecido_item_id: item,
  oc_tecido_id: oc,
  artigo_id: "T",
  prioridade,
  quantidade_m: 0,
});
const VINC_PQ = [
  vin("m-p", "ocA", "iA", 1),
  vin("m-p", "ocB", "iB", 2),
  vin("m-q", "ocA", "iA", 1),
  vin("m-q", "ocC", "iC", 2),
];
const MAP_PQ = { "m-p": ["ocA", "ocB"], "m-q": ["ocA", "ocC"] };
const SLOT_OC = { sV: ["ocB"] };
const CAP = new Map([
  ["ocA|AZUL", 100],
  ["ocB|AZUL", 500],
  ["ocC|AZUL", 500],
  ["ocA|artigo:T", 100],
  ["ocB|artigo:T", 500],
  ["ocC|artigo:T", 500],
]);

describe("D-3 — o desempate da D5 não depende da posição da vaga", () => {
  it("ordemD5: card antes de vaga sem card; cards pelo created_at e depois modelo_id; vagas pelo id", () => {
    expect(ordemD5(P, Q)).toBeLessThan(0);
    expect(ordemD5(Q, P)).toBeGreaterThan(0);
    // created_at vence o modelo_id (Q mais antigo que P → Q primeiro, mesmo com modelo_id maior)
    const qVelho = { ...Q, criado_em: "2026-07-01T00:00:00+00:00" };
    expect(ordemD5(qVelho, P)).toBeLessThan(0);
    // mesmo instante (formatos diferentes do mesmo tempo) → desempata pelo modelo_id
    const pMesmo = { ...P, criado_em: "2026-08-02T09:00:00.500+00:00" };
    expect(ordemD5(pMesmo, Q)).toBeLessThan(0);
    expect(ordemD5(Q, pMesmo)).toBeGreaterThan(0);
    // card sem created_at vai depois dos que têm
    expect(ordemD5({ ...P, criado_em: null }, Q)).toBeGreaterThan(0);
    expect(ordemD5(VAGA, P)).toBeGreaterThan(0);
    expect(
      ordemD5(
        { id: "a", modelo_id: null, materiais: [] },
        { id: "b", modelo_id: null, materiais: [] },
      ),
    ).toBeLessThan(0);
    expect(ordemD5(P, P)).toBe(0);
  });

  it("trocar a ordem das vagas não muda a repartição (antes: quem estivesse 1º na linha levava a OC disputada)", () => {
    const opts = { vinculos: VINC_PQ, capacidade: CAP };
    const d1 = detalheOc(
      arvDe([P, Q, VAGA]),
      MAP_PQ,
      SLOT_OC,
      undefined,
      undefined,
      undefined,
      opts,
    );
    const d2 = detalheOc(
      arvDe([VAGA, Q, P]),
      MAP_PQ,
      SLOT_OC,
      undefined,
      undefined,
      undefined,
      opts,
    );
    mapsIguais(d1.reservPorOcVar, d2.reservPorOcVar);
    mapsIguais(d1.reservPorOc, d2.reservPorOc);
    // m-p (mais antigo) vem 1º: leva 80 da ocA; m-q leva os 20 que sobram e transborda 40 p/ a ocC; a vaga, 10 na ocB.
    // (Com m-q primeiro seria ocA 100 · ocB 50 · ocC 0 — era o que a posição da vaga decidia.)
    expect(d1.reservPorOcVar.get("ocA|AZUL")).toBe(100);
    expect(d1.reservPorOcVar.get("ocB|AZUL")).toBe(10);
    expect(d1.reservPorOcVar.get("ocC|AZUL")).toBe(40);
  });

  it("card mais antigo corta primeiro: Q criado antes de P leva a ocA (independe do modelo_id)", () => {
    const opts = { vinculos: VINC_PQ, capacidade: CAP };
    const qVelho = { ...Q, criado_em: "2026-07-01T00:00:00+00:00" };
    const d = detalheOc(
      arvDe([P, qVelho, VAGA]),
      MAP_PQ,
      SLOT_OC,
      undefined,
      undefined,
      undefined,
      opts,
    );
    // Q 60 na ocA; P 40 na ocA + 40 na ocB; vaga 10 na ocB; ocC vazia
    expect(d.reservPorOcVar.get("ocA|AZUL")).toBe(100);
    expect(d.reservPorOcVar.get("ocB|AZUL")).toBe(50);
    expect(d.reservPorOcVar.get("ocC|AZUL") ?? 0).toBe(0);
  });

  it("enviado à Explosão continua vindo primeiro (antes do created_at)", () => {
    const opts = { vinculos: VINC_PQ, capacidade: CAP };
    const d = detalheOc(arvDe([P, Q]), MAP_PQ, {}, new Set(["m-q"]), undefined, undefined, opts);
    // m-q enviado leva 60 da ocA; m-p leva os 40 que sobram e transborda 40 p/ a ocB; ocC fica vazia
    expect(d.comprometidoPorOcVar.get("ocA|AZUL")).toBe(60);
    expect(d.reservPorOcVar.get("ocA|AZUL")).toBe(100);
    expect(d.reservPorOcVar.get("ocB|AZUL")).toBe(40);
    expect(d.reservPorOcVar.get("ocC|AZUL") ?? 0).toBe(0);
  });

  // Salvar 2× pelo pipeline real do Sheet: seed (modelos na ordem FIXA da consulta) → merge com o salvo →
  // payload (comOrdemDasVagas) → o banco grava `slot_index` como veio e a árvore volta ORDENADA por ele (sem a chave).
  const modelo = (
    id: string,
    metros: number,
    created_at = `2026-08-0${id === "m-p" ? 1 : 2}T00:00:00+00:00`,
  ): ModeloReal => ({
    id,
    created_at,
    ref: id,
    nome: id,
    subcolecao: null,
    subcolecao_id: null,
    linha_id: null,
    categoria_id: null,
    proporcoes: null,
    materiais: [
      {
        tipo: "tecido",
        numero: 1,
        artigo_id: "T",
        consumo: 1,
        loss_percent: 0,
        variantes: [{ variante_tecido_id: "AZUL", ordem: 1, multiplicador: 1 }],
      },
    ],
    grade: { 1: { grades: {}, grade_total: metros } },
  });
  const SEED: SeedInput = {
    colecao_id: "c",
    tipo: "orcamento",
    buckets: [{ subcolecao_id: null, linha_id: null, categoria_id: null, qtd: 4 }],
  };
  const doBanco = (payload: PtArvore): PtArvore => ({
    ...payload,
    subcolecoes: payload.subcolecoes.map((s) => ({
      ...s,
      linhas: s.linhas.map((l) => ({
        ...l,
        slots: [...l.slots]
          .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
          .map(({ slot_index: _i, ...rest }) => rest as PtSlot),
      })),
    })),
  });
  const salvar = (modelos: ModeloReal[], salvo: PtArvore | null): PtArvore =>
    comOrdemDasVagas(mergeArvore(semearComModelos({ ...SEED, modelos }), salvo));
  // vaga VAZIA ganha id novo a cada semeadura (comportamento de sempre — não tem dado a preservar)
  const ordem = (a: PtArvore) =>
    a.subcolecoes[0].linhas[0].slots.map((s) => [
      s.slot_index,
      s.modelo_id ?? (s.materiais.length ? `vaga:${s.id}` : "vaga-vazia"),
    ]);

  it("salvar 2× não muda a ordem das vagas nem o slot_index, e a repartição D5 fica igual", () => {
    const modelos = [modelo("m-p", 80), modelo("m-q", 60)];
    // 1º save: uma vaga sem card com material (dado do usuário) já salva
    const primeiro = salvar(modelos, null);
    primeiro.subcolecoes[0].linhas[0].slots[2] = {
      ...primeiro.subcolecoes[0].linhas[0].slots[2],
      materiais: [mat("T", 1, [["AZUL", 10]])],
    };
    const p1 = comOrdemDasVagas(primeiro);
    const p2 = salvar(modelos, doBanco(p1));
    const p3 = salvar(modelos, doBanco(p2));
    expect(ordem(p2)).toEqual(ordem(p1));
    expect(ordem(p3)).toEqual(ordem(p2));
    expect(p2.subcolecoes[0].linhas[0].slots.map((s) => s.slot_index)).toEqual([0, 1, 2, 3]);
    const slotOc = { [p1.subcolecoes[0].linhas[0].slots[2].id!]: ["ocB"] };
    const opts = { vinculos: VINC_PQ, capacidade: CAP };
    const dA = detalheOc(p2, MAP_PQ, slotOc, undefined, undefined, undefined, opts);
    const dB = detalheOc(p3, MAP_PQ, slotOc, undefined, undefined, undefined, opts);
    mapsIguais(dA.reservPorOcVar, dB.reservPorOcVar);
    mapsIguais(dA.reservPorOc, dB.reservPorOc);
  });

  it("mesmo se os modelos chegassem em outra ordem, a repartição D5 não muda (só a exibição)", () => {
    const a = salvar([modelo("m-p", 80), modelo("m-q", 60)], null);
    const b = salvar([modelo("m-q", 60), modelo("m-p", 80)], null);
    const opts = { vinculos: VINC_PQ, capacidade: CAP };
    mapsIguais(
      detalheOc(a, MAP_PQ, {}, undefined, undefined, undefined, opts).reservPorOcVar,
      detalheOc(b, MAP_PQ, {}, undefined, undefined, undefined, opts).reservPorOcVar,
    );
  });

  it("vaga acrescentada pelo merge (sobra do bucket que encolheu) ganha índice próprio (não empata em 0)", () => {
    const arv = arvDe([
      { ...P, slot_index: 0 },
      { ...VAGA, slot_index: undefined },
      { id: "sX", modelo_id: null, materiais: [], slot_index: undefined },
    ]);
    expect(comOrdemDasVagas(arv).subcolecoes[0].linhas[0].slots.map((s) => s.slot_index)).toEqual([
      0, 1, 2,
    ]);
    // pura: não muta a entrada
    expect(arv.subcolecoes[0].linhas[0].slots[1].slot_index).toBeUndefined();
  });

  it("asserção de fonte: consulta dos modelos com ORDER BY fixo; payload com comOrdemDasVagas; D5 com ordemD5", () => {
    const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
    const calc = ler("src/lib/plan-tecido/calc.ts");
    const q = sheet.slice(
      sheet.indexOf('queryKey: ["plan-tecido-modelos", colecaoId]'),
      sheet.indexOf("// tamanhos da grade cadastrados na loja"),
    );
    expect(q).toContain('.order("created_at", { ascending: true })');
    expect(q).toContain('.order("id", { ascending: true })');
    expect(sheet).toMatch(/const arvorePayload = comOrdemDasVagas\(semPrecoNasVagasComCard\(/);
    expect(calc).toContain(
      "slotsInfo.sort((a, b) => Number(b.enviado) - Number(a.enviado) || ordemD5(a.slot, b.slot));",
    );
    // B3: a consulta traz o created_at e a semeadura leva p/ o slot (criado_em) — mesma ordem da consulta
    expect(q).toContain('"id, created_at, ref,');
    expect(sheet).toContain("created_at: (m.created_at ?? null) as string | null,");
    const engine = ler("src/lib/plan-tecido/engine.ts");
    expect(engine).toContain("criado_em: mr.created_at ?? null,");
  });
});

// ─── prod #9 (resto) ─────────────────────────────────────────────────────────────────────────────────────────
describe("prod #9 — pç ≠ soma dos tamanhos: aviso, sem redistribuir", () => {
  it("somaTamanhosDivergente", () => {
    expect(somaTamanhosDivergente({ grade_total: 20, grades: {} })).toBeNull();
    expect(somaTamanhosDivergente({ grade_total: 20, grades: null })).toBeNull();
    expect(somaTamanhosDivergente({ grade_total: 20 })).toBeNull();
    expect(
      somaTamanhosDivergente({ grade_total: 20, grades: { "38|P": 10, "40|M": 10 } }),
    ).toBeNull();
    expect(somaTamanhosDivergente({ grade_total: 25, grades: { "38|P": 10, "40|M": 10 } })).toBe(
      20,
    );
    // M1 (fix round 1): mapa todo zerado = vazio (o Planejamento grava as chaves com 0 sem a grade preenchida)
    expect(
      somaTamanhosDivergente({ grade_total: 10, grades: { "38|P": 0, "40|M": 0 } }),
    ).toBeNull();
    expect(
      somaTamanhosDivergente({
        grade_total: 56,
        grades: { "34|PPP": 0, "36|PP": 0, "38|P": 0, "40|M": 0, "42|G": 0, "44|GG": 0 },
      }),
    ).toBeNull();
    expect(somaTamanhosDivergente({ grade_total: 0, grades: { "38|P": 3 } })).toBe(3);
  });

  it("MaterialBlock mostra o aviso âmbar e o pç continua sendo gravado sozinho (sem redistribuir)", () => {
    const mb = ler("src/components/plan-tecido/MaterialBlock.tsx");
    expect(mb).toContain("somaTamanhosDivergente(v)");
    expect(mb).toContain("os tamanhos somam {soma} — {ondeAjustarTamanhos}");
    // B6: vaga sem card não manda ao Planejamento
    expect(mb).toContain(
      'const ondeAjustarTamanhos = comCard ? "ajuste no Planejamento" : "ajuste os tamanhos";',
    );
    expect(ler("src/components/plan-tecido/ModelCard.tsx")).toContain("comCard={!!slot.modelo_id}");
    // B1: key com o índice (cor duplicada no material não colide)
    expect(mb).toContain("key={`${varKey(v)}-${i}`}");
    expect(mb).toContain("text-amber-700");
    // setGrade intocado: só troca o grade_total (o mapa por tamanho não é recalculado aqui)
    expect(mb).toContain(
      "const setGrade = (v: PtVariante, val: number) =>\n    onChange({ ...material, variantes: material.variantes.map((x) => (varKey(x) === varKey(v) ? { ...x, grade_total: val } : x)) });",
    );
  });
});

// ─── est #14 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("est #14 — card saiu da coleção: vaga fica com os materiais, selo + atalho", () => {
  const VIVO: PtSlot = {
    id: "s1",
    modelo_id: "m-vivo",
    nome: "VIVO",
    materiais: [mat("T", 1, [["AZUL", 5]])],
  };
  const SAIU: PtSlot = {
    id: "s2",
    modelo_id: "m-saiu",
    nome: "SAIU",
    ref: "R1",
    thumb_path: "x.jpg",
    proporcoes: { P: 1 },
    materiais: [mat("T", 2, [["AZUL", 10]])],
  };
  const arv = arvDe([VIVO, SAIU]);
  const limpa = limparSlotsOrfaos(arv, new Set(["m-vivo"]));
  const [v, s] = limpa.subcolecoes[0].linhas[0].slots;

  it("limparSlotsOrfaos tira só o card; os materiais ficam e a vaga é marcada", () => {
    expect(v).toBe(VIVO);
    expect(s).toMatchObject({
      id: "s2",
      modelo_id: null,
      ref: null,
      nome: null,
      thumb_path: null,
      card_saiu: true,
      proporcoes: { P: 1 },
    });
    expect(s.materiais).toBe(SAIU.materiais);
    expect(vagaComMateriaisDeCardQueSaiu(s)).toBe(true);
    expect(vagaComMateriaisDeCardQueSaiu(v)).toBe(false);
    expect(
      vagaComMateriaisDeCardQueSaiu({
        id: "s3",
        modelo_id: null,
        materiais: [mat("T", 1, [["AZUL", 1]])],
      }),
    ).toBe(false); // vaga comum
  });

  it("M2 (opção b): conta as vagas de card que saiu ainda com materiais e monta o aviso do Salvar", () => {
    expect(contarVagasCardSaiuComMateriais(limpa)).toBe(1);
    expect(contarVagasCardSaiuComMateriais(arv)).toBe(0);
    expect(contarVagasCardSaiuComMateriais(null)).toBe(0);
    const limpou = {
      ...limpa,
      subcolecoes: limpa.subcolecoes.map((sub) => ({
        ...sub,
        linhas: sub.linhas.map((l) => ({
          ...l,
          slots: l.slots.map((x) => (x.card_saiu ? limparMateriaisDaVaga(x) : x)),
        })),
      })),
    };
    expect(contarVagasCardSaiuComMateriais(limpou)).toBe(0);
    expect(textoAvisoCardSaiu(2)).toBe(
      "2 vaga(s) sem card ainda têm materiais — eles continuam contando na necessidade",
    );
  });

  it("'limpar materiais' só mexe no rascunho: materiais [], o resto da vaga fica, o selo some", () => {
    const depois = limparMateriaisDaVaga(s);
    expect(depois).toEqual({ ...s, materiais: [] });
    expect(s.materiais.length).toBe(1); // pura
    expect(vagaComMateriaisDeCardQueSaiu(depois)).toBe(false);
  });

  it("asserção de fonte: selo âmbar + atalho no ModelCard via onChange (sem RPC); Sheet usa o helper do engine", () => {
    const card = ler("src/components/plan-tecido/ModelCard.tsx");
    const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect(card).toContain("vagaComMateriaisDeCardQueSaiu(slot) && (");
    expect(card).toContain('<StatusBadge tone="warning"');
    expect(card).toContain("o card saiu desta coleção — vaga com materiais");
    expect(card).toContain("onChange(limparMateriaisDaVaga(slot))");
    expect(card).toContain("limpar materiais");
    const bloco = card.slice(
      card.indexOf("vagaComMateriaisDeCardQueSaiu(slot) && ("),
      card.indexOf("limpar materiais"),
    );
    expect(bloco).not.toMatch(/supabase|rpc\(/);
    expect(sheet).not.toMatch(/^function limparSlotsOrfaos/m);
    // B8: o selo fica no FIM do card (depois do Accordion), não entre o cabeçalho e as variantes (Modo Plano alinha)
    expect(card.indexOf("vagaComMateriaisDeCardQueSaiu(slot) && (")).toBeGreaterThan(
      card.lastIndexOf("</Accordion>"),
    );
    // M2 (opção b): o Salvar avisa, sem bloquear, quando sobrou vaga de card que saiu com materiais
    const posSucesso = sheet.indexOf('toast.success("Planejamento de tecido salvo.");');
    const aviso = sheet.indexOf(
      "contarVagasCardSaiuComMateriais(arvoreSalvaRef.current ?? arvore)",
    );
    expect(aviso).toBeGreaterThan(posSucesso);
    expect(sheet).toContain("toast.warning(textoAvisoCardSaiu(nCardSaiu)");
    expect(sheet).toMatch(/return normalizarArvoreDistribuicao\(limparSlotsOrfaos\(/);
  });
});

// ─── est #13 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("est #13 — proporção legada só numérica", () => {
  it("'36|PP' com proporção { '36': 3 } = 3 (antes 0)", () => {
    expect(proporcaoDoTamanho({ "36": 3 }, "36|PP")).toBe(3);
    expect(proporcaoDoTamanho({ "36": 3 }, "PP|36")).toBe(3); // par invertido
    expect(proporcaoDoTamanho({ "36": 3, "38": 5 }, "38|P")).toBe(5);
  });
  it("ordem: chave cheia → letra → número", () => {
    expect(proporcaoDoTamanho({ "36|PP": 1, PP: 2, "36": 3 }, "36|PP")).toBe(1);
    expect(proporcaoDoTamanho({ PP: 2, "36": 3 }, "36|PP")).toBe(2);
    expect(proporcaoDoTamanho({ "36": -4 }, "36|PP")).toBe(0);
    expect(proporcaoDoTamanho({ "38": 3 }, "36|PP")).toBe(0);
    expect(proporcaoDoTamanho({ "36": 3 }, "PP")).toBe(0); // tamanho solto sem número
  });
});
