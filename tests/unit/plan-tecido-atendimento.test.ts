import { describe, it, expect } from "vitest";
import {
  alternarAtende, atendimentoDoBloco, complementaReal, efeitoDaCarga, materiaisParaAplicar, normalizarArvoreDistribuicao,
  normalizarSlotDistribuicao, pcAtendido, resolverChaveT1,
} from "@/lib/plan-tecido/atendimento";
import { definirBase, definirCelula, type Distribuicao } from "@/lib/distribuicao-produto";
import type { PtArvore, PtSlot, PtVariante } from "@/lib/plan-tecido/types";

const GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
const PROP = { "38|P": 1, "40|M": 2, "42|G": 2, "44|GG": 1 };
const MARROM = "cor-marrom", PRETO = "cor-preto", VINHO = "cor-vinho";
const v = (id: string | null, cor: string, pc: number, extra: Partial<PtVariante> = {}): PtVariante =>
  ({ variante_tecido_id: id, cor_id: cor, cor_apelido_id: null, ordem: 1, multiplicador: 1, grades: {}, grade_total: pc, cor_nome: cor, ...extra }) as PtVariante;
const dist = (bases: Record<string, number>, manuais: [string, string, number][] = []): Distribuicao => {
  let d: Distribuicao = {};
  for (const [l, b] of Object.entries(bases)) d = definirBase(d, l, b, PROP, GRADE);
  for (const [l, t, x] of manuais) d = definirCelula(d, l, t, x, PROP, GRADE);
  return d;
};

// Tecido 1 do mockup: Marrom·Canela (71), Preto (90), Vinho·Bordô (30) — distribuídos
const T1 = [
  v("vt-marrom", MARROM, 0, { distribuicao: dist({ ec: 5, lf: 3, at: 4 }, [["ec", "38|P", 4]]) }),
  v("vt-preto", PRETO, 0, { distribuicao: dist({ ec: 6, lf: 4, at: 5 }) }),
  v("vt-vinho", VINHO, 0, { distribuicao: dist({ ec: 3, lf: 2 }) }),
];

describe("atendimento — 'atende a' (R14/R16)", () => {
  it("automático = mesma cor base; manual vence; cada cor do T1 por UMA cor do bloco (mockup: Preto atende Preto + Vinho à mão)", () => {
    const forro = [v("fr-marrom", MARROM, 7), v("fr-preto", PRETO, 5, { atende: ["vt-preto", "vt-vinho"] })];
    const at = atendimentoDoBloco(T1, forro);
    expect(at.porCor.get("fr-marrom")).toEqual(["vt-marrom"]);
    expect(at.porCor.get("fr-preto")).toEqual(["vt-preto", "vt-vinho"]);
    expect(at.servidaPor.get("vt-vinho")).toBe("fr-preto");
    expect([...at.manual]).toEqual(["fr-preto"]);
  });
  it("manual que pega uma cor tira ela do automático de outra cor do bloco", () => {
    const forro = [v("fr-marrom", MARROM, 0), v("fr-preto", PRETO, 0, { atende: ["vt-marrom"] })];
    const at = atendimentoDoBloco(T1, forro);
    expect(at.porCor.get("fr-marrom")).toEqual([]);
    expect(at.servidaPor.get("vt-marrom")).toBe("fr-preto");
  });
  it("cor do bloco sem cor base igual e sem lista = não atende nenhuma", () => {
    const at = atendimentoDoBloco(T1, [v("fr-bege", "cor-bege", 12)]);
    expect(at.porCor.get("fr-bege")).toEqual([]);
  });
  it("re-casa a cor planejada que virou real por cor + apelido (R16)", () => {
    const t1 = [v("vt-real", MARROM, 10, { cor_apelido_id: "ap-canela" })];
    expect(resolverChaveT1(`plan:${MARROM}|ap-canela`, t1)).toBe("vt-real");
    expect(resolverChaveT1("vt-real", t1)).toBe("vt-real");
    expect(resolverChaveT1("sumiu", t1)).toBeNull();
  });
  it("pcAtendido = Σ pç e Σ por tamanho das cores atendidas; sem cor atendida = null (pç digitado)", () => {
    const t1 = [v("a", MARROM, 10, { grades: { "38|P": 4, "40|M": 6 } }), v("b", PRETO, 5, { grades: { "38|P": 5 } })];
    expect(pcAtendido(t1, ["a", "b"])).toEqual({ grade_total: 15, grades: { "38|P": 9, "40|M": 6 } });
    expect(pcAtendido(t1, [])).toBeNull();
  });
  it("alternarAtende parte do conjunto EFETIVO de hoje", () => {
    const forro = [v("fr-preto", PRETO, 0)];
    const at = atendimentoDoBloco(T1, forro);
    expect(alternarAtende(at, "fr-preto", "vt-vinho")).toEqual(["vt-preto", "vt-vinho"]);
    expect(alternarAtende(at, "fr-preto", "vt-preto")).toEqual([]);
  });
  it("complementaReal descarta cor planejada (o BOM só aceita variante real)", () => {
    expect(complementaReal(["vt-1", "plan:c|a"])).toEqual(["vt-1"]);
  });
});

const slot = (materiais: PtSlot["materiais"], extra: Partial<PtSlot> = {}): PtSlot =>
  ({ id: "s1", modelo_id: "m1", proporcoes: { "34|PPP": 0, "36|PP": 0, ...PROP }, materiais, ...extra }) as PtSlot;
const mat = (tipo: "tecido" | "forro", numero: number, variantes: PtVariante[]) =>
  ({ artigo_id: `${tipo}${numero}`, tipo, numero, consumo: tipo === "forro" ? 1.2 : 1.97, loss_percent: 0, ordem: 0, variantes });

describe("normalizarSlotDistribuicao (R6)", () => {
  const LIG = { ligado: true, tamanhos: GRADE };
  it("pç do T1 = soma da distribuição; forro amarrado = soma das cores atendidas (mockup: 71·90·30 → forro 71 e 120)", () => {
    const s = slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7), v("fr-preto", PRETO, 5, { atende: ["vt-preto", "vt-vinho"] })])]);
    const n = normalizarSlotDistribuicao(s, LIG);
    expect(n.materiais[0].variantes.map((x) => x.grade_total)).toEqual([71, 90, 30]);
    expect(n.materiais[0].variantes[0].grades).toEqual({ "38|P": 11, "40|M": 24, "42|G": 24, "44|GG": 12 });
    expect(n.materiais[1].variantes.map((x) => x.grade_total)).toEqual([71, 120]);
  });
  it("Tecido 2 também é amarrado (R15); cor do bloco sem amarração mantém o pç digitado (R14)", () => {
    const s = slot([mat("tecido", 1, T1), mat("tecido", 2, [v("t2-bege", "cor-bege", 33), v("t2-preto", PRETO, 1)])]);
    const n = normalizarSlotDistribuicao(s, LIG);
    expect(n.materiais[1].variantes.map((x) => x.grade_total)).toEqual([33, 90]);
  });
  it("módulo desligado ⇒ o MESMO objeto (card como hoje — R4)", () => {
    const s = slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]);
    expect(normalizarSlotDistribuicao(s, { ligado: false, tamanhos: GRADE })).toBe(s);
  });
  it("idempotente: normalizar o normalizado devolve o MESMO objeto", () => {
    const s = slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]);
    const n = normalizarSlotDistribuicao(s, LIG);
    expect(normalizarSlotDistribuicao(n, LIG)).toBe(n);
  });
  it("cor do T1 SEM distribuição mantém o pç digitado; a distribuição que esvazia não zera o pç (só o Salvar do dialog zera — R10)", () => {
    const vazia = v("vt-x", MARROM, 40, { distribuicao: { ec: { base: 0, grades: {}, manuais: [] } } });
    const n = normalizarSlotDistribuicao(slot([mat("tecido", 1, [v("vt-y", PRETO, 25), vazia])]), LIG);
    expect(n.materiais[0].variantes.map((x) => [x.grade_total, x.distribuicao ?? null])).toEqual([[25, null], [40, {}]]);
  });
  it("tipo Número usa os tamanhos do lado número (grade solta)", () => {
    const d = { ec: { base: 2, grades: {}, manuais: [] } };
    const s = slot([mat("tecido", 1, [v("vt", MARROM, 0, { distribuicao: d })])], { tamanho_tipo: "numero", proporcoes: { "38": 1, "P": 5 } });
    const n = normalizarSlotDistribuicao(s, { ligado: true, tamanhos: ["38", "40", "P", "M"] });
    expect(n.materiais[0].variantes[0].grade_total).toBe(2);
  });
  it("normalizarArvoreDistribuicao devolve a MESMA árvore quando nada muda", () => {
    const s = normalizarSlotDistribuicao(slot([mat("tecido", 1, T1)]), LIG);
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [s] }] }] };
    expect(normalizarArvoreDistribuicao(arv, LIG)).toBe(arv);
  });
});

describe("efeitoDaCarga (G-plano R3 — PR12: card = Resumo depois do 1º Salvar)", () => {
  const LIG = { ligado: true, tamanhos: GRADE };
  const arvDe = (s: PtSlot): PtArvore => ({ colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [s] }] }] });
  it("normalização sem mudança ⇒ NÃO fica sujo, sem aviso; base = a própria árvore", () => {
    const n = normalizarSlotDistribuicao(slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]), LIG);
    const e = efeitoDaCarga(arvDe(n), LIG, true);
    expect(e).toMatchObject({ tocados: [], recalculadasForaT1: 0, sujo: false });
    expect(e.arvore).toBe(e.base);
  });
  it("forro gravado com pç ≠ soma das cores atendidas ⇒ FICA SUJO, aviso com N cores e o slot tocado; a base é a árvore CRUA", () => {
    const cru = arvDe(slot([mat("tecido", 1, [v("vt-marrom", MARROM, 71)]), mat("forro", 1, [v("fr-marrom", MARROM, 7), v("fr-bege", "cor-bege", 12)])]));
    const e = efeitoDaCarga(cru, LIG, true);
    expect(e).toMatchObject({ tocados: ["s1"], recalculadasForaT1: 1, sujo: true });
    expect(e.base).toBe(cru);
    expect(e.arvore.subcolecoes[0].linhas[0].slots[0].materiais[1].variantes.map((x) => x.grade_total)).toEqual([71, 12]);
  });
  it("sem permissão de editar ⇒ o aviso aparece mas NÃO suja (não dá para salvar)", () => {
    const cru = arvDe(slot([mat("tecido", 1, [v("vt-marrom", MARROM, 71)]), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]));
    expect(efeitoDaCarga(cru, LIG, false)).toMatchObject({ recalculadasForaT1: 1, sujo: false });
  });
  it("módulo desligado ⇒ nada muda (R4)", () => {
    const cru = arvDe(slot([mat("tecido", 1, [v("vt-marrom", MARROM, 71)]), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]));
    expect(efeitoDaCarga(cru, { ligado: false, tamanhos: GRADE }, true)).toMatchObject({ tocados: [], recalculadasForaT1: 0, sujo: false });
  });
});

describe("materiaisParaAplicar (R3/R4)", () => {
  const s = slot([mat("tecido", 1, [v("vt-marrom", MARROM, 71), v(null, PRETO, 90)]), mat("forro", 1, [v("fr-marrom", MARROM, 71), v("fr-preto", PRETO, 90)])]);
  it("com o módulo: o forro leva complementa_variante_ids (só ids REAIS do T1); o T1 NÃO leva a chave", () => {
    const m = materiaisParaAplicar(s, true);
    expect(m[0].variantes[0]).not.toHaveProperty("complementa_variante_ids");
    expect(m[1].variantes.map((x: any) => x.complementa_variante_ids)).toEqual([["vt-marrom"], []]);
  });
  it("sem o módulo: NENHUMA variante leva a chave (o servidor preserva o casamento do BOM)", () => {
    const m = materiaisParaAplicar(s, false);
    expect(m.flatMap((x) => x.variantes).some((x: any) => "complementa_variante_ids" in x)).toBe(false);
  });
});
