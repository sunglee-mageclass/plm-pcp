// R15b (achados MÉDIOS) — Plan. Tecido:
//  • P-198 A (dono 01/out): card com status `reprovado` fica na vaga (selo "Reprovado") mas SAI da necessidade da
//    coleção e da Demanda/Sobra das OCs; saindo de Reprovado volta a contar. Espelho do servidor
//    (`_plan_tecido_nec_variante_core` / `comprometida_m` da Situação — migration 20261025400000).
//  • P-189 A (est #12): a Paleta ("OCs que cobrem") usa a MESMA lista e os MESMOS metros da "Situação por OC".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ehReprovado, reprovadoSaiDaDemanda, slotContaNaDemanda, pendenciasResumo, cadEnviadoCorte, statusFornecedorCategoria, arvoreDaDemanda, necessidadePorTecido, necVivoPorVariante, detalheOc, detalheOcColecao,
  ocItensDaSituacao, resumoOcsColecao, contabilizarOc, sobraOc, aComprarVivoPorArtigo, type VinculoDetalhe, type CoberturaVarRow,
} from "@/lib/plan-tecido/calc";
import { agruparPorOc, type SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";
import { linhasOcsPaleta } from "@/components/plan-tecido/PaletaColecao";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const mat = (aid: string, consumo: number, vars: [string | null, number][]) => ({
  artigo_id: aid, artigo_nome: aid, unidade_medida: "metro", rendimento: null, tipo: "tecido" as const, numero: 1, consumo, loss_percent: 0, ordem: 0,
  variantes: vars.map(([vid, g], i) => ({ variante_tecido_id: vid, cor_id: vid ? undefined : "cor", label: vid ?? "plan", ordem: i + 1, multiplicador: 1, grades: {}, grade_total: g })),
});
const arvDe = (slots: PtSlot[]): PtArvore => ({ colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }] });
const vin = (o: Partial<VinculoDetalhe> & { modelo_id: string; oc_tecido_id: string; oc_tecido_item_id: string }): VinculoDetalhe => ({
  tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: "LUNE_BUTTER", artigo_id: "LUNE", prioridade: 1, quantidade_m: 0, ...o,
});
const sit = (o: Partial<SituacaoOcRow> & { oc_tecido_id: string; variante_tecido_id: string }): SituacaoOcRow => ({
  numero: o.oc_tecido_id, data_pedido: null, status: "encomendado", artigo_id: "LUNE", artigo_nome: "MALHA LUNE", variante_label: o.variante_tecido_id,
  pedida_m: 0, entregue_m: 0, usada_m: 0, comprometida_m: 0, ...o,
});

// Fixture no espírito da Ave Rara (Resort 27 Novo): VESTIDO AURELIA (reprovado) 56 pç × 3,16 m em BUTTER e CAFÉ,
// vinculado à OC 00002509 (prioridade 1); um card ativo na mesma OC/cor; uma vaga sem card com hint na OC 10109181.
const AURELIA: PtSlot = { id: "s-aurelia", modelo_id: "m-aurelia", materiais: [mat("LUNE", 3.16, [["LUNE_CAFE", 56], ["LUNE_BUTTER", 56]])] };
const ATIVO: PtSlot = { id: "s-ativo", modelo_id: "m-ativo", materiais: [mat("LUNE", 2, [["LUNE_BUTTER", 30]])] };
const VAGA: PtSlot = { id: "s-vaga", modelo_id: null, materiais: [mat("LUNE", 1, [["LUNE_BORDO", 40]])] };
const ARV = arvDe([AURELIA, ATIVO, VAGA]);
const REPROVADOS = new Set(["m-aurelia"]);
const VINCULOS: VinculoDetalhe[] = [
  vin({ modelo_id: "m-aurelia", oc_tecido_id: "oc2509", oc_tecido_item_id: "i-cafe", variante_tecido_id: "LUNE_CAFE" }),
  vin({ modelo_id: "m-aurelia", oc_tecido_id: "oc2509", oc_tecido_item_id: "i-butter", variante_tecido_id: "LUNE_BUTTER" }),
  vin({ modelo_id: "m-ativo", oc_tecido_id: "oc2509", oc_tecido_item_id: "i-butter", variante_tecido_id: "LUNE_BUTTER" }),
];
const VINC_MAP = { "m-aurelia": ["oc2509"], "m-ativo": ["oc2509"] };
const SLOT_OC = { "s-vaga": ["oc0181"] };
const SITUACAO: SituacaoOcRow[] = [
  sit({ oc_tecido_id: "oc2509", numero: "00002509", variante_tecido_id: "LUNE_CAFE", pedida_m: 1074 }),
  sit({ oc_tecido_id: "oc2509", numero: "00002509", variante_tecido_id: "LUNE_BUTTER", pedida_m: 501.2 }),
  sit({ oc_tecido_id: "oc0181", numero: "10109181", status: "recebido", variante_tecido_id: "LUNE_BORDO", pedida_m: 501.2, entregue_m: 535.926 }),
];
const capacidade = (rows: SituacaoOcRow[]) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const cap = r.status === "recebido" ? r.entregue_m : r.pedida_m;
    m.set(`${r.oc_tecido_id}|${r.variante_tecido_id}`, (m.get(`${r.oc_tecido_id}|${r.variante_tecido_id}`) ?? 0) + cap);
    m.set(`${r.oc_tecido_id}|artigo:${r.artigo_id}`, (m.get(`${r.oc_tecido_id}|artigo:${r.artigo_id}`) ?? 0) + cap);
  }
  return m;
};
const OPTS = { vinculos: VINCULOS, capacidade: capacidade(SITUACAO) };

describe("P-198 A — card reprovado fora da necessidade/Demanda (calc.ts)", () => {
  it("ehReprovado = lower(coalesce(status,'')) = 'reprovado' (mesmo predicado do servidor)", () => {
    expect(ehReprovado("reprovado")).toBe(true);
    expect(ehReprovado("Reprovado")).toBe(true);
    expect(ehReprovado("REPROVADO")).toBe(true);
    expect(ehReprovado(null)).toBe(false);
    expect(ehReprovado(undefined)).toBe(false);
    expect(ehReprovado("")).toBe(false);
    expect(ehReprovado("aprovado")).toBe(false);
    // P-213 A: reprovado no Planejamento também conta (mesma regra da Integração)
    expect(ehReprovado(null, "reprovado")).toBe(true);
    expect(ehReprovado("aprovado", "Reprovado")).toBe(true);
    expect(ehReprovado("aprovado", "aprovado")).toBe(false);
    expect(ehReprovado(null, null)).toBe(false);
  });

  it("vaga sem card sempre conta; card reprovado não; sem reprovados = a MESMA árvore", () => {
    expect(slotContaNaDemanda(VAGA, REPROVADOS)).toBe(true);
    expect(slotContaNaDemanda(AURELIA, REPROVADOS)).toBe(false);
    expect(slotContaNaDemanda(ATIVO, REPROVADOS)).toBe(true);
    expect(slotContaNaDemanda(AURELIA)).toBe(true);
    expect(arvoreDaDemanda(ARV, new Set())).toBe(ARV);
    expect(arvoreDaDemanda(ARV)).toBe(ARV);
    // a árvore original NÃO é mutada (o card segue visível)
    const dem = arvoreDaDemanda(ARV, REPROVADOS);
    expect(dem.subcolecoes[0].linhas[0].slots.map((s) => s.id)).toEqual(["s-ativo", "s-vaga"]);
    expect(ARV.subcolecoes[0].linhas[0].slots.map((s) => s.id)).toEqual(["s-aurelia", "s-ativo", "s-vaga"]);
  });

  it("necessidadePorTecido / necVivoPorVariante excluem o reprovado (AURELIA: −176,96 m em cada cor)", () => {
    const antes = necVivoPorVariante(ARV);
    const depois = necVivoPorVariante(arvoreDaDemanda(ARV, REPROVADOS));
    expect(antes.get("LUNE_CAFE")).toBeCloseTo(176.96, 6);
    expect(antes.get("LUNE_BUTTER")).toBeCloseTo(176.96 + 60, 6);
    expect(depois.get("LUNE_CAFE")).toBeUndefined();
    expect(depois.get("LUNE_BUTTER")).toBeCloseTo(60, 6);
    expect(depois.get("LUNE_BORDO")).toBeCloseTo(40, 6); // vaga sem card conta
    const tot = (a: PtArvore) => necessidadePorTecido(a).reduce((s, t) => s + t.totalMetros, 0);
    expect(tot(ARV) - tot(arvoreDaDemanda(ARV, REPROVADOS))).toBeCloseTo(353.92, 6);
  });

  it("Demanda/Sobra por OC: o reprovado sai da repartição e não consome a capacidade dos outros", () => {
    const det = detalheOcColecao(ARV, SITUACAO, VINC_MAP, SLOT_OC, new Set(), { ...OPTS, reprovados: REPROVADOS });
    expect(det.reservPorOc.get("oc2509")).toBeCloseTo(60, 6);
    expect(det.reservPorOcVar.get("oc2509|LUNE_BUTTER")).toBeCloseTo(60, 6);
    expect(det.reservPorOcVar.get("oc2509|LUNE_CAFE") ?? 0).toBe(0);
    expect(det.nPorOc.get("oc2509")).toBe(1); // só o card ativo aponta a OC na conta
    expect(det.reservPorOc.get("oc0181")).toBeCloseTo(40, 6);
    // Sobra = entregue − Demanda (OC encomendada: entregue 0)
    expect(sobraOc("oc2509", SITUACAO.map((r) => ({ ...r, usada_m: r.usada_m })), det)).toBeCloseTo(-60, 6);
  });

  it("saindo de Reprovado volta a contar — igual ao detalheOc sem filtro", () => {
    const comTodos = detalheOcColecao(ARV, SITUACAO, VINC_MAP, SLOT_OC, new Set(), { ...OPTS, reprovados: new Set() });
    const { ocArtigos, ocVariantes } = ocItensDaSituacao(SITUACAO);
    const base = detalheOc(ARV, VINC_MAP, SLOT_OC, new Set(), ocArtigos, ocVariantes, OPTS);
    expect(comTodos).toEqual(base);
    expect(comTodos.reservPorOc.get("oc2509")).toBeCloseTo(353.92 + 60, 6);
    expect(sobraOc("oc2509", SITUACAO, comTodos)).toBeCloseTo(-(353.92 + 60), 6);
  });

  it("reprovado ENVIADO à Explosão não vira 'em produção' (comprometido) na OC", () => {
    const det = detalheOcColecao(ARV, SITUACAO, VINC_MAP, SLOT_OC, new Set(["m-aurelia"]), { ...OPTS, reprovados: REPROVADOS });
    expect(det.comprometidoPorOc.get("oc2509") ?? 0).toBe(0);
  });

  it("'a comprar' vivo bate com o servidor quando o servidor também exclui o reprovado (paridade)", () => {
    // cobertura como a prévia NOVA devolve: nec_m sem o reprovado (BUTTER 60, BORDO 40; CAFÉ some)
    const cobertura: CoberturaVarRow[] = [
      { artigo_id: "LUNE", variante_tecido_id: "LUNE_BUTTER", nec_m: 60, deficit_m: 0 },
      { artigo_id: "LUNE", variante_tecido_id: "LUNE_BORDO", nec_m: 40, deficit_m: 15 },
    ];
    const vivo = aComprarVivoPorArtigo(cobertura, necVivoPorVariante(arvoreDaDemanda(ARV, REPROVADOS)));
    expect(vivo.get("LUNE")).toBeCloseTo(15, 6); // = Σ deficit do servidor
    // com a régua velha (reprovado contando no vivo) o "a comprar" divergiria do servidor
    expect(aComprarVivoPorArtigo(cobertura, necVivoPorVariante(ARV)).get("LUNE")).toBeGreaterThan(15);
  });
});

describe("P-189 A (est #12) — Paleta = Situação por OC (mesma lista, mesmos metros)", () => {
  const SIT2: SituacaoOcRow[] = [
    ...SITUACAO,
    // OC que só existe pela Situação (vínculo do Dev/hint) — a Paleta antiga (2 fontes) não a listava
    sit({ oc_tecido_id: "oc9118", numero: "10109118", status: "recebido", variante_tecido_id: "LUNE_MENTA", pedida_m: 465.201, entregue_m: 465.201, usada_m: 12 }),
  ];
  const det = detalheOcColecao(ARV, SIT2, VINC_MAP, SLOT_OC, new Set(["m-ativo"]), { vinculos: VINCULOS, capacidade: capacidade(SIT2), reprovados: REPROVADOS });
  const situacaoPorOc = agruparPorOc(SIT2);
  const resumo = resumoOcsColecao(situacaoPorOc, SIT2, det);
  const paleta = linhasOcsPaleta(resumo);

  it("mesma LISTA, na mesma ordem (todas as OCs da Situação)", () => {
    expect(paleta.map((p) => p.oc_tecido_id)).toEqual(situacaoPorOc.map((o) => o.oc_tecido_id));
    expect(paleta.map((p) => p.numero_pedido)).toEqual(["00002509", "10109181", "10109118"]);
  });

  it("mesmos METROS: Pedida da Situação e Demanda repartida (D5) — e a conta = a de antes do Resumo", () => {
    for (const o of situacaoPorOc) {
      const p = paleta.find((x) => x.oc_tecido_id === o.oc_tecido_id)!;
      const r = resumo.find((x) => x.oc_tecido_id === o.oc_tecido_id)!;
      expect(p.pedida).toBeCloseTo(o.pedida, 6);
      // conta inline do Resumo antes do helper (anti-drift): reservada/comprometido → contabilizarOc; Sobra = sobraOc
      const reservadaTotal = det.reservPorOc.get(o.oc_tecido_id) ?? 0;
      const comprometido = det.comprometidoPorOc.get(o.oc_tecido_id) ?? 0;
      const c = contabilizarOc(reservadaTotal, comprometido, o.usada, o.entregue);
      expect(p.demanda).toBeCloseTo(Math.max(reservadaTotal, c.usada), 6);
      expect(r.demanda).toBeCloseTo(p.demanda, 6);
      expect(r.reservadaLivre).toBeCloseTo(c.reservadaLivre, 6);
      expect(r.usadaEfetiva).toBeCloseTo(c.usada, 6);
      expect(r.baixaDomina).toBe(c.baixaDomina);
      expect(r.sobra).toBeCloseTo(sobraOc(o.oc_tecido_id, SIT2, det), 6);
      expect(r.nModelos).toBe(det.nPorOc.get(o.oc_tecido_id) ?? 0);
    }
    expect(paleta.find((p) => p.oc_tecido_id === "oc2509")!.demanda).toBeCloseTo(60, 6); // sem a AURELIA reprovada
    expect(paleta.find((p) => p.oc_tecido_id === "oc9118")!.demanda).toBeCloseTo(12, 6); // baixa real (em produção)
  });
});

describe("R15b — fonte única (anti-drift de código)", () => {
  it("migration: o MESMO predicado (reprovado E não cortado sai) na necessidade, no comprometido e no oc_link da prévia", () => {
    const up = ler("supabase/migrations/20261025400000_plan_tecido_reprovado.sql");
    const pred = (a: string) =>
      new RegExp(`not \\(\\(lower\\(coalesce\\(${a}\\.status_desenvolvimento,''\\)\\) = 'reprovado' or lower\\(coalesce\\(${a}\\.status_planejamento,''\\)\\) = 'reprovado'\\)\\s+and not exists \\(select 1 from cad cc where cc\\.modelo_id = ${a}\\.id and cc\\.enviado_corte\\)\\)`, "g");
    expect(up).toContain("left join modelos mo on mo.id = sl.modelo_id");
    expect(up.match(pred("mo"))?.length).toBe(1); // necessidade
    expect(up.match(pred("m"))?.length).toBe(2); // comprometida_m + vínculo do Dev no oc_link
    expect(up.match(pred("hm"))?.length).toBe(1); // hint de vaga no oc_link
    // espelho TS: mesma regra (status reprovado E sem cad.enviado_corte)
    const calc = ler("src/lib/plan-tecido/calc.ts");
    expect(calc).toContain("ehReprovado(statusDesenvolvimento, statusPlanejamento) && !enviadoCorte");
    // junção L4 I1: o predicado mora só em @/lib/reprovado; calc.ts delega
    expect(calc).toContain("ehReprovadoStatus(statusDesenvolvimento, statusPlanejamento)");
    expect(ler("src/lib/reprovado.ts")).toContain(`(statusDesenvolvimento ?? "").toLowerCase() === "reprovado" || (statusPlanejamento ?? "").toLowerCase() === "reprovado"`);
  });

  it("Resumo e Drawer usam a árvore sem reprovados + detalheOcColecao; a Paleta não chama mais a RPC de 2 fontes", () => {
    const resumo = ler("src/components/plan-tecido/ResumoPanel.tsx");
    const drawer = ler("src/components/plan-tecido/PlanTecidoDrawer.tsx");
    const paleta = ler("src/components/plan-tecido/PaletaColecao.tsx");
    for (const src of [resumo, drawer]) {
      expect(src).toContain("detalheOcColecao(");
      expect(src).not.toMatch(/\bdetalheOc\(/);
      expect(src).toContain("arvoreDaDemanda(colecaoArvore, reprovadoSet)");
    }
    expect(resumo).toContain("resumoOcsColecao(");
    expect(paleta).not.toMatch(/rpc\(\s*"plan_tecido_cobertura_ocs"/);
    expect(paleta).toContain("linhasOcsPaleta");
    const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect(sheet).toContain("status_desenvolvimento");
    expect(sheet).toContain("reprovadoSaiDaDemanda(m.status_desenvolvimento, m.status_planejamento, cadEnviadoCorte(m.cad))");
    expect(sheet).not.toContain("cad?.[0]?.enviado_corte");
    expect(sheet).toContain("status_desenvolvimento, status_planejamento,");
    expect(sheet).toContain("cad(enviado_corte, cad_tecidos(");
    expect((sheet.match(/reprovadoSet=\{reprovadoSet\}/g) ?? []).length).toBe(4); // Resumo ×2 + Drawer ×2
  });
});

describe("R15b fix round 1 — M2 (reprovado já cortado continua) e L1 (transbordo de capacidade)", () => {
  it("reprovadoSaiDaDemanda: só o reprovado AINDA NÃO enviado ao corte sai", () => {
    expect(reprovadoSaiDaDemanda("reprovado", null, false)).toBe(true);
    expect(reprovadoSaiDaDemanda("Reprovado", null, null)).toBe(true);
    expect(reprovadoSaiDaDemanda("reprovado", undefined, undefined)).toBe(true);
    expect(reprovadoSaiDaDemanda("reprovado", null, true)).toBe(false);
    expect(reprovadoSaiDaDemanda("aprovado", "aprovado", false)).toBe(false);
    expect(reprovadoSaiDaDemanda(null, null, true)).toBe(false);
    // P-213 A: só no Planejamento também sai; cortado continua (M2)
    expect(reprovadoSaiDaDemanda("aprovado", "reprovado", false)).toBe(true);
    expect(reprovadoSaiDaDemanda(null, "reprovado", true)).toBe(false);
  });

  it("M2: reprovado cortado 100 m + ativo enviado 50 m na mesma OC → Demanda 150 (não 100)", () => {
    const R: PtSlot = { id: "s-r", modelo_id: "m-r", materiais: [mat("A", 1, [["v1", 100]])] };
    const A: PtSlot = { id: "s-a", modelo_id: "m-a", materiais: [mat("A", 1, [["v1", 50]])] };
    const arv = arvDe([R, A]);
    const sitX: SituacaoOcRow[] = [sit({ oc_tecido_id: "ocX", numero: "X", status: "recebido", artigo_id: "A", variante_tecido_id: "v1", pedida_m: 500, entregue_m: 500, usada_m: 100 })];
    const vincs = ["m-r", "m-a"].map((m, i) => vin({ modelo_id: m, oc_tecido_id: "ocX", oc_tecido_item_id: "iX", variante_tecido_id: "v1", artigo_id: "A", prioridade: 1, ordem: i + 1 }));
    const status = [
      { id: "m-r", st: "reprovado", cortado: true },
      { id: "m-a", st: "aprovado", cortado: false },
    ];
    const reprovados = new Set(status.filter((m) => reprovadoSaiDaDemanda(m.st, null, m.cortado)).map((m) => m.id));
    expect(reprovados.size).toBe(0); // o cortado NÃO sai
    const det = detalheOcColecao(arv, sitX, { "m-r": ["ocX"], "m-a": ["ocX"] }, {}, new Set(["m-r", "m-a"]), { vinculos: vincs, capacidade: capacidade(sitX), reprovados });
    const [linha] = resumoOcsColecao(agruparPorOc(sitX), sitX, det);
    expect(linha.demanda).toBeCloseTo(150, 6);
    expect(linha.sobra).toBeCloseTo(350, 6);
    // contraprova (régua da rodada 0, que tirava QUALQUER reprovado): a Demanda caía para 100 e a Sobra subia 50 à toa
    const det0 = detalheOcColecao(arv, sitX, { "m-r": ["ocX"], "m-a": ["ocX"] }, {}, new Set(["m-r", "m-a"]), { vinculos: vincs, capacidade: capacidade(sitX), reprovados: new Set(["m-r"]) });
    expect(resumoOcsColecao(agruparPorOc(sitX), sitX, det0)[0].demanda).toBeCloseTo(100, 6);
  });

  it("L1: com o reprovado a 1ª OC estoura e o ativo transborda para a 2ª; sem ele, o ativo fica todo na 1ª", () => {
    const R: PtSlot = { id: "s-r", modelo_id: "m-r", materiais: [mat("A", 1, [["v1", 80]])] };
    const A: PtSlot = { id: "s-a", modelo_id: "m-a", materiais: [mat("A", 1, [["v1", 60]])] };
    const arv = arvDe([R, A]);
    const sit2: SituacaoOcRow[] = [
      sit({ oc_tecido_id: "oc1", numero: "1", artigo_id: "A", variante_tecido_id: "v1", pedida_m: 100 }),
      sit({ oc_tecido_id: "oc2", numero: "2", artigo_id: "A", variante_tecido_id: "v1", pedida_m: 500 }),
    ];
    const vincs = ["m-r", "m-a"].flatMap((m) => [
      vin({ modelo_id: m, oc_tecido_id: "oc1", oc_tecido_item_id: "i1", variante_tecido_id: "v1", artigo_id: "A", prioridade: 1 }),
      vin({ modelo_id: m, oc_tecido_id: "oc2", oc_tecido_item_id: "i2", variante_tecido_id: "v1", artigo_id: "A", prioridade: 2 }),
    ]);
    const vm = { "m-r": ["oc1", "oc2"], "m-a": ["oc1", "oc2"] };
    const com = detalheOcColecao(arv, sit2, vm, {}, new Set(), { vinculos: vincs, capacidade: capacidade(sit2), reprovados: new Set() });
    expect(com.reservPorOc.get("oc1")).toBeCloseTo(100, 6); // 80 do reprovado + 20 do ativo (estourou)
    expect(com.reservPorOc.get("oc2")).toBeCloseTo(40, 6); // o ativo transbordou
    const sem = detalheOcColecao(arv, sit2, vm, {}, new Set(), { vinculos: vincs, capacidade: capacidade(sit2), reprovados: new Set(["m-r"]) });
    expect(sem.reservPorOc.get("oc1")).toBeCloseTo(60, 6); // o ativo cabe todo na 1ª
    expect(sem.reservPorOc.get("oc2") ?? 0).toBeCloseTo(0, 6);
  });
});

describe("P-213 A / P-212 A — reprovado só no Planejamento; Poder de venda e Pendências", () => {
  // fixture: o card reprovado SÓ no Planejamento (status_desenvolvimento ativo) e um card reprovado em nenhum
  const status = [
    { id: "m-aurelia", dev: "em_desenvolvimento", plan: "reprovado", cortado: false },
    { id: "m-ativo", dev: "aprovado", plan: "aprovado", cortado: false },
  ];
  const reprovados = new Set(status.filter((m) => reprovadoSaiDaDemanda(m.dev, m.plan, m.cortado)).map((m) => m.id));

  it("card reprovado SÓ no Planejamento sai da necessidade e da Demanda; o que não é reprovado em nenhum segue contando", () => {
    expect([...reprovados]).toEqual(["m-aurelia"]);
    const viva = necVivoPorVariante(arvoreDaDemanda(ARV, reprovados));
    expect(viva.get("LUNE_CAFE")).toBeUndefined();
    expect(viva.get("LUNE_BUTTER")).toBeCloseTo(60, 6); // só o ativo
    const det = detalheOcColecao(ARV, SITUACAO, VINC_MAP, SLOT_OC, new Set(), { ...OPTS, reprovados });
    expect(det.reservPorOc.get("oc2509")).toBeCloseTo(60, 6);
    // ninguém reprovado → tudo conta
    const nenhum = new Set(status.filter((m) => reprovadoSaiDaDemanda(m.dev, "aprovado", m.cortado)).map((m) => m.id));
    expect(nenhum.size).toBe(0);
    expect(detalheOcColecao(ARV, SITUACAO, VINC_MAP, SLOT_OC, new Set(), { ...OPTS, reprovados: nenhum }).reservPorOc.get("oc2509")).toBeCloseTo(353.92 + 60, 6);
  });

  it("P-212 A: Pendências e Poder de venda do Resumo usam só as vagas que contam (reprovado sai; volta ao sair de Reprovado)", () => {
    const semFornec = (_aid: string) => false;
    const slots = ARV.subcolecoes[0].linhas[0].slots;
    const todas = pendenciasResumo(slots, semFornec);
    const semRep = pendenciasResumo(slots.filter((s) => slotContaNaDemanda(s, reprovados)), semFornec);
    expect(todas).toEqual({ semCategoria: 3, semTecFornec: 3, semCard: 1 });
    expect(semRep).toEqual({ semCategoria: 2, semTecFornec: 2, semCard: 1 });
    expect(pendenciasResumo(slots.filter((s) => slotContaNaDemanda(s, new Set())), semFornec)).toEqual(todas);
    // fonte: Pendências e o laço do Poder de venda leem `enc` (vagas que contam), não `slots`
    const resumo = ler("src/components/plan-tecido/ResumoPanel.tsx");
    expect(resumo).toContain("const enc = slots.filter((s) => slotContaNaDemanda(s, reprovadoSet));");
    const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect((sheet.match(/reprovadoStatusSet=\{reprovadoStatusSet\}/g) ?? []).length).toBe(2); // Resumo desktop + mobile
    expect(resumo).toContain("const venda = slots.filter((s) => slotContaNaDemanda(s, reprovadoStatusSet));");
    expect(resumo).toContain("pendenciasResumo(venda, (aid) => fornecSet.has(aid))");
    expect(resumo).toMatch(/for \(const slot of venda\) \{ \/\/ P-212 A/);
    expect(resumo).toContain("{nComFornec} de {venda.length} modelos com fornecedor");
  });
});

describe("R15b fix round 2 — P-212 A: reprovado CORTADO fica na Demanda, mas sai do Poder de venda e das Pendências", () => {
  it("cortado: conta no tecido (M2), não conta na venda (ehReprovado)", () => {
    const m = { id: "m-aurelia", dev: "reprovado", plan: "planejado", cortado: true };
    const saiDaDemanda = new Set([m].filter((x) => reprovadoSaiDaDemanda(x.dev, x.plan, x.cortado)).map((x) => x.id));
    const saiDaVenda = new Set([m].filter((x) => ehReprovado(x.dev, x.plan)).map((x) => x.id));
    expect(saiDaDemanda.size).toBe(0);
    expect([...saiDaVenda]).toEqual(["m-aurelia"]);
    // Demanda: a AURELIA cortada continua na OC (176,96 × 2 + 60 do ativo)
    const det = detalheOcColecao(ARV, SITUACAO, VINC_MAP, SLOT_OC, new Set(), { ...OPTS, reprovados: saiDaDemanda });
    expect(det.reservPorOc.get("oc2509")).toBeCloseTo(353.92 + 60, 6);
    // Poder de venda / Pendências: a vaga dela sai (mesmo filtro do Resumo: slotContaNaDemanda(s, reprovadoStatusSet))
    const slots = ARV.subcolecoes[0].linhas[0].slots;
    const venda = slots.filter((s) => slotContaNaDemanda(s, saiDaVenda));
    expect(venda.map((s) => s.id)).toEqual(["s-ativo", "s-vaga"]);
    expect(pendenciasResumo(venda, () => false)).toEqual({ semCategoria: 2, semTecFornec: 2, semCard: 1 });
  });
});

describe("R15b fix round 3 — cad to-many (inv. #7) e bolinha de fornecedor da categoria (P-212 A)", () => {
  it("cadEnviadoCorte confere QUALQUER linha do embed to-many, não só a 1ª", () => {
    expect(cadEnviadoCorte([{ enviado_corte: false }, { enviado_corte: true }])).toBe(true);
    expect(cadEnviadoCorte([{ enviado_corte: true }])).toBe(true);
    expect(cadEnviadoCorte([{ enviado_corte: false }, { enviado_corte: null }])).toBe(false);
    expect(cadEnviadoCorte([])).toBe(false);
    expect(cadEnviadoCorte(null)).toBe(false);
    expect(cadEnviadoCorte(undefined)).toBe(false);
    // o cortado em linha que não é a 1ª continua contando no tecido (M2)
    expect(reprovadoSaiDaDemanda("reprovado", null, cadEnviadoCorte([{ enviado_corte: false }, { enviado_corte: true }]))).toBe(false);
  });

  it("catStatus: card reprovado (cortado ou não) sem fornecedor não deixa a categoria âmbar; sem ele, verde", () => {
    const comFornec = (aid: string) => aid === "COM";
    const ok: PtSlot = { id: "s-ok", modelo_id: "m-ok", categoria_tecido_id: "cat", materiais: [mat("COM", 1, [["v1", 10]])] };
    const rep: PtSlot = { id: "s-rep", modelo_id: "m-rep", categoria_tecido_id: "cat", materiais: [mat("SEM", 1, [["v2", 10]])] };
    const todos = [ok, rep];
    expect(statusFornecedorCategoria(todos, comFornec)).toBe("a"); // antes: o reprovado puxava para âmbar
    const reprovadosVenda = new Set(["m-rep"].filter(() => ehReprovado("reprovado", null))); // cortado ou não: só o status
    const venda = todos.filter((s) => slotContaNaDemanda(s, reprovadosVenda));
    expect(statusFornecedorCategoria(venda, comFornec)).toBe("g");
    expect(statusFornecedorCategoria([rep].filter((s) => slotContaNaDemanda(s, reprovadosVenda)), comFornec)).toBe("n");
    const resumo = ler("src/components/plan-tecido/ResumoPanel.tsx");
    expect(resumo).toContain("const slotsCat = (cid: string | null) => venda.filter(");
    expect(resumo).toContain("statusFornecedorCategoria(slotsCat(cid), (aid) => fornecSet.has(aid))");
  });
});
