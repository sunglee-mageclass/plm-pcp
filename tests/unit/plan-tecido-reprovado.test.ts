// R15b (achados MÉDIOS) — Plan. Tecido:
//  • P-198 A (dono 01/out): card com status `reprovado` fica na vaga (selo "Reprovado") mas SAI da necessidade da
//    coleção e da Demanda/Sobra das OCs; saindo de Reprovado volta a contar. Espelho do servidor
//    (`_plan_tecido_nec_variante_core` / `comprometida_m` da Situação — migration 20261025400000).
//  • P-189 A (est #12): a Paleta ("OCs que cobrem") usa a MESMA lista e os MESMOS metros da "Situação por OC".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ehReprovado, slotContaNaDemanda, arvoreDaDemanda, necessidadePorTecido, necVivoPorVariante, detalheOc, detalheOcColecao,
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
  it("migration: o MESMO predicado do _estoque_tecido_core na necessidade e no comprometido da Situação", () => {
    const up = ler("supabase/migrations/20261025400000_plan_tecido_reprovado.sql");
    expect(up).toContain("left join modelos mo on mo.id = sl.modelo_id");
    expect(up).toContain("and lower(coalesce(mo.status_desenvolvimento,'')) <> 'reprovado'");
    expect(up).toContain("and lower(coalesce(m.status_desenvolvimento,'')) <> 'reprovado'");
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
    expect(sheet).toContain("ehReprovado(m.status_desenvolvimento)");
    expect((sheet.match(/reprovadoSet=\{reprovadoSet\}/g) ?? []).length).toBe(4); // Resumo ×2 + Drawer ×2
  });
});
