import { describe, it, expect } from "vitest";
import { makeEmptyBlocks, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import {
  artigosTecidoPrincipais, assinaturaBom, blocosTecidosIniciais, bomDivergeDaReferencia, deveHidratarCarga, estadoBomDoServidor,
  herdarGrades, hidratarBlocos, hidratarGrades,
  montarAviamentosPayload, montarGradesPayload, montarTecidosPayload, paresComplementares, pecaCom, planoEtiquetas,
  relevantArtigoIds, resumoBom, snapshotBom, tecido1VarianteIds, tecido1VariantesInfo,
  tecidosPlanejadosDerivados, totaisBom, type EstadoBom,
} from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — trava as contas PORTADAS do Desenvolvimento (ModeloDetailPanel.tsx) + a guarda R5.
const A = "art-a", B = "art-b", S = "art-sub", F = "art-forro";
const V1 = "v-a-1", V2 = "v-sub-1", VB = "v-b-1", VF = "v-forro-1";

function bloco(tipo: TecidoBlock["tipo"], numero: number, patch: Partial<TecidoBlock> = {}): TecidoBlock {
  const base = makeEmptyBlocks().find((b) => b.tipo === tipo && b.numero === numero)!;
  return { ...base, ...patch };
}
function slots<T>(vals: T[], fill: T): T[] { return [...vals, ...Array(10 - vals.length).fill(fill)]; }

describe("hidratarBlocos — carga do BOM (Dev :870-946)", () => {
  const blocos = hidratarBlocos({
    tecidos: [
      { id: "mt1", tipo: "tecido", numero: 1, artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17 },
      { id: "mtf", tipo: "forro", numero: 1, artigo_id: F, consumo: 0.9, loss_percent: 2, custo_previsto: 16.52 },
    ],
    variantes: [
      { modelo_tecido_id: "mt1", variante_tecido_id: V2, ordem: 2, multiplicador: null, complementa_variante_ids: null, variantes_tecido: { artigo_id: S } },
      { modelo_tecido_id: "mt1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, complementa_variante_ids: [], variantes_tecido: { artigo_id: A } },
      { modelo_tecido_id: "mtf", variante_tecido_id: VF, ordem: 1, multiplicador: 2, complementa_variante_ids: [V1, V2], variantes_tecido: { artigo_id: F } },
    ],
    ocLinks: [
      { tipo: "tecido", numero: 1, ordem: 1, oc_tecido_item_id: "oc-b", quantidade_m: 10, prioridade: 2 },
      { tipo: "tecido", numero: 1, ordem: 1, oc_tecido_item_id: "oc-a", quantidade_m: 5, prioridade: 1 },
    ],
    planejados: [A, S],
  });
  const t1 = blocos.find((b) => b.tipo === "tecido" && b.numero === 1)!;
  it("mantém os 9 blocos fixos (3 por tipo)", () => expect(blocos).toHaveLength(9));
  it("variantes por ordem, multiplicador null→1, casamento vazio→null", () => {
    expect(t1.id).toBe("mt1");
    expect(t1.variantes.slice(0, 3)).toEqual([V1, V2, null]);
    expect(t1.multiplicadores[1]).toBe(1);
    expect(t1.complementas[0]).toBeNull();
  });
  it("substituto = artigo de variante ≠ principal (só tecido/forro)", () => expect(t1.artigoIdsExtra).toEqual([S]));
  it("OC-links da variante ordenados por prioridade", () => {
    expect(t1.oc_links[0].map((o) => o.oc_tecido_item_id)).toEqual(["oc-a", "oc-b"]);
    expect(t1.oc_links[1]).toEqual([]);
  });
  it("forro guarda multiplicador e casamento", () => {
    const fo = blocos.find((b) => b.tipo === "forro" && b.numero === 1)!;
    expect(fo.multiplicadores[0]).toBe(2);
    expect(fo.complementas[0]).toEqual([V1, V2]);
    expect(fo.artigoIdsExtra).toEqual([]);
  });
  it("G-mockup R5: BOM NÃO vazio ⇒ NÃO pré-preenche (sem 'Tecido 2' fantasma com o substituto)", () => {
    const t2 = blocos.find((b) => b.tipo === "tecido" && b.numero === 2)!;
    expect(t2.artigo_id).toBeNull();
  });
  it("G-mockup R5: BOM vazio ⇒ pré-preenche Tecido 1..3 com a lista (4º ignorado, como no Dev)", () => {
    const vazio = hidratarBlocos({ tecidos: [], variantes: [], ocLinks: [], planejados: [A, B, S, "art-4"] });
    expect(vazio.filter((b) => b.tipo === "tecido").map((b) => b.artigo_id)).toEqual([A, B, S]);
  });
});

describe("snapshotBom — 'não salvo' ignora id e custo derivado", () => {
  const e1: EstadoBom = {
    blocks: [bloco("tecido", 1, { id: "x", artigo_id: A, consumo: 1, custo_previsto: 10 })],
    aviamentos: [{ id: "a1", aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 5 }],
    etiquetas: [], grades: [],
  };
  it("mudar só id/custo_previsto não muda o snapshot", () => {
    const e2: EstadoBom = {
      ...e1,
      blocks: [bloco("tecido", 1, { id: "y", artigo_id: A, consumo: 1, custo_previsto: 99 })],
      aviamentos: [{ id: "a2", aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 7 }],
    };
    expect(snapshotBom(e2)).toBe(snapshotBom(e1));
  });
  it("mudar consumo muda o snapshot", () => {
    const e3: EstadoBom = { ...e1, aviamentos: [{ ...e1.aviamentos[0], consumo: 2 }] };
    expect(snapshotBom(e3)).not.toBe(snapshotBom(e1));
  });
});

describe("grade — herança e Tecido 1 (Dev :1430-1468)", () => {
  it("tecido1VarianteIds para no 1º buraco", () => {
    expect(tecido1VarianteIds([bloco("tecido", 1, { variantes: slots([V1, null, V2], null) })])).toEqual([V1]);
  });
  it("herdarGrades acrescenta as linhas que faltam copiando a 1ª com quantidade", () => {
    const prev = [{ variante_numero: 1, grades: { P: 0 }, grade_total: 0 }, { variante_numero: 2, grades: { P: 4, M: 8 }, grade_total: 12 }];
    const out = herdarGrades(prev, 3);
    expect(out.map((g) => g.variante_numero)).toEqual([1, 2, 3]);
    expect(out[2]).toEqual({ variante_numero: 3, grades: { P: 4, M: 8 }, grade_total: 12 });
  });
  it("herdarGrades devolve a MESMA referência quando não há o que herdar (sem loop)", () => {
    const prev = [{ variante_numero: 1, grades: { P: 1 }, grade_total: 1 }];
    expect(herdarGrades(prev, 1)).toBe(prev);
    const vazio: typeof prev = [];
    expect(herdarGrades(vazio, 3)).toBe(vazio);
  });
  it("hidratarGrades normaliza nulos", () => {
    expect(hidratarGrades([{ variante_numero: 1, grades: null, grade_total: null }])).toEqual([{ variante_numero: 1, grades: {}, grade_total: 0 }]);
  });
});

describe("casar variantes (Dev :1488-1564)", () => {
  const blocks = [
    bloco("tecido", 1, { artigo_id: A, variantes: slots([V1, V2], null) }),
    bloco("forro", 1, { artigo_id: F, variantes: slots([VF], null), complementas: slots<string[] | null>([[V1, V2]], null) }),
    bloco("tecido", 2, { artigo_id: B, variantes: slots([VB], null), complementas: slots<string[] | null>([[V1]], null) }),
  ];
  it("paresComplementares ignora o Tecido 1 e expande N-pra-N", () => {
    expect(paresComplementares(blocks)).toEqual([
      { t1id: V1, compVarId: VF }, { t1id: V2, compVarId: VF }, { t1id: V1, compVarId: VB },
    ]);
  });
  it("tecido1VariantesInfo: tecido só com pool misto; complemento sem repetir", () => {
    const info = tecido1VariantesInfo({
      ids: [V1, V2],
      labels: { [V1]: "Areia", [V2]: "Oliva" },
      varianteArtigoMap: { [V1]: A, [V2]: S, [VF]: F, [VB]: B },
      nomeArtigo: (id) => ({ [A]: "Linho", [S]: "Linho Sub", [F]: "Viscose", [B]: "Tule" } as Record<string, string>)[id ?? ""],
      pares: paresComplementares(blocks),
      compLabels: { [VF]: "Off White", [VB]: "Preto" },
    });
    expect(info[0]).toEqual({ numero: 1, label: "Areia", tecido: "Linho", complemento: "Viscose · Off White, Tule · Preto" });
    expect(info[1]).toEqual({ numero: 2, label: "Oliva", tecido: "Linho Sub", complemento: "Viscose · Off White" });
  });
});

describe("totais (Dev :1388-1401)", () => {
  const estado = {
    blocks: [bloco("tecido", 1, { custo_previsto: 57.17 }), bloco("forro", 1, { custo_previsto: 16.52 })],
    aviamentos: [{ aviamento_id: "av", consumo: 1, loss_percent: 0, custo_previsto: 4.9 }],
    etiquetas: [{ etiqueta_id: "et", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 1.2 }],
  };
  const t = totaisBom({ ...estado, custosAdicionais: [{ descricao: "Bordado", valor: 3.5 }], maoObra: 35 });
  it("separa as linhas e soma a peça na ordem do Dev", () => {
    expect(t.tecido).toBeCloseTo(57.17); expect(t.forro).toBeCloseTo(16.52); expect(t.entretela).toBe(0);
    expect(t.aviamento).toBeCloseTo(4.9); expect(t.etiqueta).toBeCloseTo(1.2); expect(t.custosAdicionais).toBeCloseTo(3.5);
    expect(t.materiaisBom).toBeCloseTo(79.79); expect(t.terceirizados).toBe(35);
    expect(t.peca).toBeCloseTo(118.29);
  });
  it("pecaCom troca só a mão de obra", () => {
    expect(pecaCom(t, 0)).toBeCloseTo(83.29);
    expect(pecaCom(t, 40)).toBeCloseTo(123.29);
  });
});

describe("derivações do Salvar", () => {
  const blocks = [
    bloco("tecido", 2, { artigo_id: B, variantes: slots([VB], null) }),
    bloco("tecido", 1, { artigo_id: A, variantes: slots([V1, V2], null) }),
    bloco("forro", 1, { artigo_id: F, variantes: slots([VF], null) }),
  ];
  const map = { [V1]: A, [V2]: S, [VB]: B, [VF]: F };
  it("tecidosPlanejadosDerivados: principais por número + substitutos usados; forro fora (Dev :1937-1948)", () => {
    expect(tecidosPlanejadosDerivados(blocks, map)).toEqual([A, B, S]);
  });
  it("artigosTecidoPrincipais: só o artigo dos blocos Tecido, por número (decisão F3 #9)", () => {
    expect(artigosTecidoPrincipais(blocks)).toEqual([A, B]);
  });
  it("blocosTecidosIniciais: até 3, só o artigo, sem variante/consumo (G-mockup R3)", () => {
    const out = blocosTecidosIniciais([A, "", B, S, "art-4"]);
    expect(out.map((t) => [t.artigo_id, t.numero, t.tipo])).toEqual([[A, 1, "tecido"], [B, 2, "tecido"], [S, 3, "tecido"]]);
    expect(out[0]).toMatchObject({ consumo: 0, loss_percent: 0, custo_previsto: 0, variantes: [], multiplicadores: [], complementas: [], oc_links: [] });
  });
  it("montarTecidosPayload: Tecido 1 sem multiplicador/casamento; complementar leva os dois; OC-links achatados (Dev :1973-2008)", () => {
    const t1 = bloco("tecido", 1, {
      artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17,
      variantes: slots([V1, V2], null), multiplicadores: slots([3, 2], 1),
      complementas: slots<string[] | null>([["x"]], null),
      oc_links: [[{ oc_tecido_item_id: "oc-a", quantidade_m: 5, prioridade: 1 }, { oc_tecido_item_id: "", quantidade_m: 1, prioridade: 2 }], ...Array.from({ length: 9 }, () => [])],
    });
    const fo = bloco("forro", 1, { artigo_id: F, variantes: slots([VF], null), multiplicadores: slots([2], 1), complementas: slots<string[] | null>([[]], null) });
    const vazio = bloco("entretela", 1);
    const out = montarTecidosPayload([t1, fo, vazio]);
    expect(out).toHaveLength(2);
    expect(out[0].multiplicadores.slice(0, 2)).toEqual([1, 1]);
    expect(out[0].complementas.slice(0, 2)).toEqual([null, null]);
    expect(out[0].oc_links).toEqual([{ ordem: 1, variante_tecido_id: V1, oc_tecido_item_id: "oc-a", quantidade_m: 5, prioridade: 1 }]);
    expect(out[1].multiplicadores[0]).toBe(2);
    expect(out[1].complementas[0]).toBeNull();
  });
  it("montarAviamentosPayload numera só as linhas com aviamento", () => {
    const out = montarAviamentosPayload([
      { aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 },
      { aviamento_id: "av2", variante_aviamento_id: "va", consumo: 2, loss_percent: 1, custo_previsto: 3 },
    ]);
    expect(out).toEqual([{ aviamento_id: "av2", variante_aviamento_id: "va", numero: 1, consumo: 2, loss_percent: 1, custo_previsto: 3 }]);
  });
  it("planoEtiquetas: atualiza por id, insere sem id, apaga o que sumiu (Dev :2038-2060)", () => {
    const p = planoEtiquetas([
      { id: "e1", etiqueta_id: "et1", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 1 },
      { etiqueta_id: null, cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 },
      { etiqueta_id: "et2", cor_id: "c", consumo: 2, loss_percent: 0, custo_previsto: 2 },
    ], ["e1", "e9"], "m1");
    expect(p.ops.map((o) => [o.tipo, o.row.numero, o.row.etiqueta_id])).toEqual([["atualizar", 1, "et1"], ["inserir", 2, "et2"]]);
    expect(p.ops[0]).toMatchObject({ id: "e1" });
    expect(p.apagar).toEqual(["e9"]);
  });
});

describe("resumo e pools", () => {
  it("resumoBom conta tecidos com artigo, variantes faltando, aviamentos, insumos e grade", () => {
    const r = resumoBom({
      blocks: [bloco("tecido", 1, { artigo_id: A, variantes: slots([V1], null) }), bloco("forro", 1, { artigo_id: F })],
      aviamentos: [{ aviamento_id: "av", consumo: 1, loss_percent: 0, custo_previsto: 0 }, { aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }],
      etiquetas: [{ etiqueta_id: "et", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      grades: [{ variante_numero: 1, grades: {}, grade_total: 24 }],
    });
    expect(r).toEqual({ nTecidos: 1, todosBlocosComArtigoTemVariante: false, nAviamentos: 1, nInsumos: 1, gradeTotalGeral: 24 });
  });
  it("relevantArtigoIds: união ordenada sem repetição", () => {
    expect(relevantArtigoIds({
      planejados: [B, A], extras: [F, A],
      blocks: [bloco("tecido", 1, { artigo_id: A, artigoIdsExtra: [S] })],
    })).toEqual([A, B, F, S].sort());
  });
});

// R5 (G-plano conjunto) — "Tecidos & BOM" só quando o BOM do SERVIDOR mudou de verdade: ações do próprio usuário
// que só sobem o `rev` (Mover para…, Ordem, Lançar, aprovar MO) e o eco do próprio save não acendem o aviso.
describe("R5 — o BOM do servidor mudou de verdade?", () => {
  const linhas = {
    tecidos: [{ id: "mt1", tipo: "tecido", numero: 1, artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17 }],
    variantes: [
      { modelo_tecido_id: "mt1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, complementa_variante_ids: null, variantes_tecido: { artigo_id: A } },
      { modelo_tecido_id: "mt1", variante_tecido_id: V2, ordem: 2, multiplicador: 1, complementa_variante_ids: null, variantes_tecido: { artigo_id: S } },
    ],
    ocLinks: [],
    aviamentos: [{ id: "a1", aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 4.9 }],
    etiquetas: [],
    grades: [{ variante_numero: 1, grades: { M: 8, P: 4 }, grade_total: 12 }],
    planejados: [A, S],
  };
  const servidor = estadoBomDoServidor(linhas);
  const referencia = assinaturaBom(servidor);
  it("mesmas linhas com ids e custos novos e chaves da grade em outra ordem (eco) ⇒ NÃO diverge", () => {
    // NOTA (achado da Task 2, com evidência): o brief trocava só `tecidos[0].id`, deixando
    // `variantes[].modelo_tecido_id` apontando pro id ANTIGO ("mt1"). `hidratarBlocos` casa
    // variante↔tecido por `v.modelo_tecido_id === t.id` — EXATAMENTE o join do Dev
    // (ModeloDetailPanel.tsx:900,1115,1150). Numa leitura real do servidor essas 2 colunas
    // SEMPRE vêm da mesma foto (é a MESMA FK): reconstruído aqui trocando `modelo_tecido_id`
    // junto do `id` novo do tecido, como um re-fetch de verdade traria. Sem isso a variante
    // "sumia" da eco e o teste acusava divergência onde não deveria haver nenhuma — não é uma
    // âncora de linha, é um bug na fixture do teste; `ficha-calc.ts` não mudou.
    const eco = estadoBomDoServidor({
      ...linhas,
      tecidos: [{ ...linhas.tecidos[0], id: "mt-novo", custo_previsto: 99 }],
      variantes: linhas.variantes.map((v) => ({ ...v, modelo_tecido_id: "mt-novo" })),
      aviamentos: [{ ...linhas.aviamentos[0], id: "a-novo", custo_previsto: 1 }],
      grades: [{ variante_numero: 1, grades: { P: 4, M: 8 }, grade_total: 12 }],
    });
    expect(bomDivergeDaReferencia(referencia, eco)).toBe(false);
  });
  it("a herança de grade entra (a 2ª variante do Tecido 1 herda a da 1ª), como na carga", () => {
    expect(servidor.grades.map((g) => g.variante_numero)).toEqual([1, 2]);
  });
  it("outra pessoa mudou o consumo ⇒ diverge", () => {
    const outro = estadoBomDoServidor({ ...linhas, tecidos: [{ ...linhas.tecidos[0], consumo: 2 }] });
    expect(bomDivergeDaReferencia(referencia, outro)).toBe(true);
  });
  it("linha vazia no estado local não conta (o Salvar não a grava)", () => {
    const local: EstadoBom = {
      ...servidor,
      aviamentos: [...servidor.aviamentos, { aviamento_id: null, variante_aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }],
    };
    expect(assinaturaBom(local)).toBe(referencia);
  });
  it("sem referência ⇒ diverge (conservador: na dúvida, avisa)", () => {
    expect(bomDivergeDaReferencia(null, servidor)).toBe(true);
  });
});

// M1 (fix round 1) — falso positivo do R5 DEPOIS de um Salvar: a referência passa a ser o estado
// ENVIADO, mas o RPC NORMALIZA o que grava (`_salvar_modelo_bom_core`, funcoes.sql:7605-7719) — o
// eco relido nunca é byte-a-byte igual ao enviado mesmo sem ninguém mais ter mexido. `ecoDoServidor`
// simula exatamente essa normalização: monta o payload do Salvar (`montarTecidosPayload`/
// `montarGradesPayload`, as MESMAS funções do Salvar de verdade) e relê pela carga
// (`estadoBomDoServidor`), com ids novos (o RPC apaga e re-insere) e a grade filtrada por "tem
// valor" (funcoes.sql:7695-7717) como o INSERT realmente faz.
describe("M1 — falso positivo pós-Salvar (referência = ENVIADO × eco normalizado pelo RPC)", () => {
  function ecoDoServidor(e: EstadoBom): EstadoBom {
    const tp = montarTecidosPayload(e.blocks);
    const tecidos: any[] = []; const variantes: any[] = []; const ocLinks: any[] = [];
    tp.forEach((t, k) => {
      const id = "novo-" + k;
      tecidos.push({ id, tipo: t.tipo, numero: t.numero, artigo_id: t.artigo_id, consumo: t.consumo, loss_percent: t.loss_percent, custo_previsto: 0 });
      t.variantes.forEach((v, i) => {
        if (!v) return;
        variantes.push({
          modelo_tecido_id: id, variante_tecido_id: v, ordem: i + 1,
          multiplicador: t.multiplicadores[i] ?? 1,
          complementa_variante_ids: t.complementas[i] && t.complementas[i]!.length ? t.complementas[i] : null,
          variantes_tecido: { artigo_id: t.artigo_id },
        });
      });
      t.oc_links.forEach((o) => ocLinks.push({ tipo: t.tipo, numero: t.numero, ...o }));
    });
    // Mesmo filtro "tem valor" do INSERT (funcoes.sql:7700-7708): grade_total>0 OU alguma célula>0.
    const grades = montarGradesPayload(e.grades).filter(
      (g) => (g.grade_total || 0) > 0 || Object.values(g.grades || {}).some((v) => Number(v) > 0),
    );
    return estadoBomDoServidor({ tecidos, variantes, ocLinks, aviamentos: [], etiquetas: [], grades, planejados: [] });
  }
  const blocoT1 = (vs: (string | null)[]): TecidoBlock => ({ ...makeEmptyBlocks()[0], artigo_id: A, variantes: slots(vs, null) });

  it("caso limpo: enviado × eco não diverge", () => {
    const enviado: EstadoBom = {
      blocks: [blocoT1([V1, V2])], aviamentos: [], etiquetas: [],
      grades: [{ variante_numero: 1, grades: { P: 4 }, grade_total: 4 }, { variante_numero: 2, grades: { P: 4 }, grade_total: 4 }],
    };
    expect(bomDivergeDaReferencia(assinaturaBom(enviado), ecoDoServidor(enviado))).toBe(false);
  });

  it("(a) grade de uma variante ZERADA: o RPC descarta a linha e a herança a recria copiando a 1ª ⇒ NÃO diverge", () => {
    const enviado: EstadoBom = {
      blocks: [blocoT1([V1, V2])], aviamentos: [], etiquetas: [],
      grades: [{ variante_numero: 1, grades: { P: 4 }, grade_total: 4 }, { variante_numero: 2, grades: { P: 0 }, grade_total: 0 }],
    };
    expect(bomDivergeDaReferencia(assinaturaBom(enviado), ecoDoServidor(enviado))).toBe(false);
  });

  it("(b) forro trocou de artigo sem escolher variante: multiplicador velho num slot sem variante ⇒ NÃO diverge", () => {
    const fo: TecidoBlock = { ...makeEmptyBlocks().find((b) => b.tipo === "forro" && b.numero === 1)!, artigo_id: F, multiplicadores: slots([2], 1) };
    const enviado: EstadoBom = { blocks: [blocoT1([V1]), fo], aviamentos: [], etiquetas: [], grades: [] };
    expect(bomDivergeDaReferencia(assinaturaBom(enviado), ecoDoServidor(enviado))).toBe(false);
  });

  it("mudança REAL de consumo (outra pessoa) continua divergindo", () => {
    const enviado: EstadoBom = {
      blocks: [blocoT1([V1, V2])], aviamentos: [], etiquetas: [],
      grades: [{ variante_numero: 1, grades: { P: 4 }, grade_total: 4 }, { variante_numero: 2, grades: { P: 4 }, grade_total: 4 }],
    };
    const referencia = assinaturaBom(enviado);
    const outro: EstadoBom = { ...enviado, blocks: [{ ...enviado.blocks[0], consumo: 9.99 }] };
    expect(bomDivergeDaReferencia(referencia, ecoDoServidor(outro))).toBe(true);
  });

  it("mudança REAL de variante (outra pessoa) continua divergindo", () => {
    const enviado: EstadoBom = { blocks: [blocoT1([V1, V2])], aviamentos: [], etiquetas: [], grades: [] };
    const referencia = assinaturaBom(enviado);
    const outro: EstadoBom = { ...enviado, blocks: [blocoT1([V1, VB])] };
    expect(bomDivergeDaReferencia(referencia, ecoDoServidor(outro))).toBe(true);
  });

  it("mudança REAL de grade — não é zerar, é outro valor — continua divergindo", () => {
    const enviado: EstadoBom = {
      blocks: [blocoT1([V1, V2])], aviamentos: [], etiquetas: [],
      grades: [{ variante_numero: 1, grades: { P: 4 }, grade_total: 4 }, { variante_numero: 2, grades: { P: 4 }, grade_total: 4 }],
    };
    const referencia = assinaturaBom(enviado);
    const outro: EstadoBom = { ...enviado, grades: [{ variante_numero: 1, grades: { P: 10 }, grade_total: 10 }, { variante_numero: 2, grades: { P: 4 }, grade_total: 4 }] };
    expect(bomDivergeDaReferencia(referencia, ecoDoServidor(outro))).toBe(true);
  });

  // Contraponto do caso (b) acima: lá o slot SEM variante escondia o multiplicador/casamento velhos
  // (o RPC nunca os lê) e por isso não divergia. COM variante no slot, o RPC LÊ e grava os dois — uma
  // mudança real neles tem que ser capturada pela assinatura (`slotsDoBloco`), senão o guardião perde
  // um conflito de verdade.
  it("mudança REAL de multiplicador num slot COM variante (complementar) continua divergindo", () => {
    const fo: TecidoBlock = {
      ...makeEmptyBlocks().find((b) => b.tipo === "forro" && b.numero === 1)!,
      artigo_id: F, variantes: slots([VF], null), multiplicadores: slots([2], 1),
    };
    const enviado: EstadoBom = { blocks: [blocoT1([V1]), fo], aviamentos: [], etiquetas: [], grades: [] };
    const referencia = assinaturaBom(enviado);
    const outro: EstadoBom = { ...enviado, blocks: [enviado.blocks[0], { ...fo, multiplicadores: slots([5], 1) }] };
    expect(bomDivergeDaReferencia(referencia, ecoDoServidor(outro))).toBe(true);
  });

  it("mudança REAL de casamento num slot COM variante (complementar) continua divergindo", () => {
    const fo: TecidoBlock = {
      ...makeEmptyBlocks().find((b) => b.tipo === "forro" && b.numero === 1)!,
      artigo_id: F, variantes: slots([VF], null), complementas: slots<string[] | null>([[V1]], null),
    };
    const enviado: EstadoBom = { blocks: [blocoT1([V1, V2]), fo], aviamentos: [], etiquetas: [], grades: [] };
    const referencia = assinaturaBom(enviado);
    const outro: EstadoBom = { ...enviado, blocks: [enviado.blocks[0], { ...fo, complementas: slots<string[] | null>([[V2]], null) }] };
    expect(bomDivergeDaReferencia(referencia, ecoDoServidor(outro))).toBe(true);
  });
});

// I1/I2 (fix round 1) — "hidrata agora?" extraída de useFichaBom p/ ser testável sem montar hooks.
describe("deveHidratarCarga — só com as 5 queries prontas, ESTÁVEIS e a Ficha habilitada", () => {
  const prontas = { tecidosData: {}, ocLinksData: [], aviamentosData: [], etiquetasData: [], gradesData: [] };

  it("tudo pronto e estável ⇒ hidrata", () => {
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, ...prontas })).toBe(true);
  });
  it("desabilitada ⇒ não hidrata, mesmo com tudo pronto", () => {
    expect(deveHidratarCarga({ habilitada: false, bomFetching: false, ...prontas })).toBe(false);
  });
  it("I2: QUALQUER uma das 5 em refetch (bomFetching) ⇒ não hidrata, mesmo com dados prontos", () => {
    expect(deveHidratarCarga({ habilitada: true, bomFetching: true, ...prontas })).toBe(false);
  });
  it("1ª carga: algum dos 5 arrays ainda undefined ⇒ não hidrata", () => {
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, ...prontas, gradesData: undefined })).toBe(false);
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, ...prontas, tecidosData: undefined })).toBe(false);
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, ...prontas, ocLinksData: undefined })).toBe(false);
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, ...prontas, aviamentosData: undefined })).toBe(false);
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, ...prontas, etiquetasData: undefined })).toBe(false);
  });
  it("array vazio (BOM sem nada salvo ainda) NÃO é 'undefined' ⇒ hidrata", () => {
    expect(deveHidratarCarga({ habilitada: true, bomFetching: false, tecidosData: {}, ocLinksData: [], aviamentosData: [], etiquetasData: [], gradesData: [] })).toBe(true);
  });
});
