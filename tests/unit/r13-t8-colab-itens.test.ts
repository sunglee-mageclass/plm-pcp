// [urg R13 T8] Colaboração da OC de Produto Importado COM itens — merge 3-vias (cabeçalho com as ETAPAS · linhas · grade por célula de cada
// item), retry do P0409 e resolução de conflito de linha. Tudo PURO: o que a tela faz é chamar estas funções (ver OcImpDialog).
import { describe, it, expect } from "vitest";
import {
  baseAposMerge, baseDe, mesclarOcItens, mesclarParaRetryP0409Imp, resolverConflitoLinha, rotuloConflitoOc, tocadasDoItem,
} from "@/components/oc-p-importado/colab-itens";
import { itemDeRow, pathCelulaItem, type ItemOcImp } from "@/components/oc-p-importado/itens";
import { emptyCabecalho, type CabecalhoImpDraft, type EtapaDraft, type GradeDetalhe } from "@/components/oc-p-importado/shared";

const grade = (pp = 5, p = 5, rec = 0): GradeDetalhe => ({ "1": { "36|PP": { pedida: pp, recebida: rec, defeito: 0 }, "38|P": { pedida: p, recebida: 0, defeito: 0 } } });
const mk = (id: string, over: Partial<ItemOcImp> = {}): ItemOcImp => ({
  ...itemDeRow({
    id, ordem: 1, produto_importado_id: `prod-${id}`, nome_produto: `Produto ${id}`, grupo_id: "g1", categoria_id: "c1",
    ref_fornecedor: "", composicao: "", grade_proporcao: { "36|PP": 1, "38|P": 1 }, variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
    qtd_total: 10, valor_unitario_m1: 50, peso_kg: 0.5, transporte_m2: 10, desconto_pct: 0, custo_unitario_landed_real: 0, grade_detalhe: grade(), status: "encomendado",
  }),
  ...over,
});
const etp = (rotulo: string, pct: number, ordem = 1): EtapaDraft => ({ ordem, rotulo, base: "mercadoria", percentual: pct, data_vencimento: null, cotacao: 5 });
const cab = (over: Partial<CabecalhoImpDraft> = {}): CabecalhoImpDraft => ({ ...emptyCabecalho(), empresa_id: "e1", data_pedido: "2026-10-01", etapas: [etp("Sinal", 100)], ...over });
const set = (...x: string[]) => new Set(x);
const vazio = () => new Set<string>();

// Estado de partida: a OC tem A e B; eu vi o servidor assim.
const A0 = mk("A"), B0 = mk("B");
const base = () => baseDe(cab(), [A0, B0]);

function merge(o: { live: ItemOcImp[]; fresh: ItemOcImp[]; liveDraft?: CabecalhoImpDraft; freshDraft?: CabecalhoImpDraft; touched?: Set<string>; ids?: Set<string>; celulas?: Set<string>; b?: ReturnType<typeof base> }) {
  return mesclarOcItens({
    base: o.b ?? base(),
    live: { draft: o.liveDraft ?? cab(), items: o.live },
    fresh: { draft: o.freshDraft ?? cab(), items: o.fresh },
    touched: o.touched ?? vazio(), touchedIds: o.ids ?? vazio(), touchedGrade: o.celulas ?? vazio(),
  });
}
function pathCelula(id: string) { return pathCelulaItem(id, "1", "36|PP", "pedida"); }

describe("grade por item — mergeGradeGenerico com caminho item:<id>:grade:<ordem>:<tam>:<campo>", () => {
  it("EU mexo numa célula do item A, o outro numa célula do item B: as duas ficam, sem conflito", () => {
    const meuA = { ...A0, grade: grade(9, 5) };
    const deleB = { ...B0, grade: grade(5, 7) };
    const r = merge({ live: [meuA, B0], fresh: [A0, deleB], celulas: set(pathCelula("A")) });
    expect(r.conflitos).toEqual([]);
    expect(r.items.find((i) => i.id === "A")!.grade["1"]["36|PP"].pedida).toBe(9);
    expect(r.items.find((i) => i.id === "B")!.grade["1"]["38|P"].pedida).toBe(7);
    expect(r.atualizados).toBe(1);
    expect(r.mudouItens).toBe(true);
  });
  it("EU e o outro na MESMA célula: conflito com o caminho prefixado pelo item; meu valor fica", () => {
    const r = merge({ live: [{ ...A0, grade: grade(9, 5) }, B0], fresh: [{ ...A0, grade: grade(6, 5) }, B0], celulas: set(pathCelula("A")) });
    expect(r.conflitos).toEqual([{ path: "item:A:grade:1:36|PP:pedida", meu: 9, dele: 6 }]);
    expect(r.items.find((i) => i.id === "A")!.grade["1"]["36|PP"].pedida).toBe(9);
  });
  it("células DIFERENTES do MESMO item: merge por célula (a linha não vira conflito só porque a grade mexeu)", () => {
    const r = merge({ live: [{ ...A0, grade: grade(9, 5) }, B0], fresh: [{ ...A0, grade: grade(5, 8) }, B0], celulas: set(pathCelula("A")) });
    expect(r.conflitos).toEqual([]);
    expect(r.items[0].grade["1"]).toMatchObject({ "36|PP": { pedida: 9 }, "38|P": { pedida: 8 } });
  });
  it("tocadasDoItem e o rótulo do conflito (reusados do Acabado) servem ao Importado", () => {
    expect([...tocadasDoItem(set("item:A:grade:1:36|PP:pedida", "item:B:grade:1:38|P:defeito"), "A")]).toEqual(["grade:1:36|PP:pedida"]);
    const nome = (id: string) => (id === "A" ? "Vestido" : "?");
    expect(rotuloConflitoOc("item:A:grade:1:36|PP:pedida", {}, nome)).toBe("Vestido · Pedida · 36|PP (var 1)");
    expect(rotuloConflitoOc("linha:A", {}, nome)).toBe("Produto “Vestido”");
    expect(rotuloConflitoOc("etapas", { etapas: "Etapas de pagamento" }, nome)).toBe("Etapas de pagamento");
  });
});

describe("itens — mergeLinhas({removidasIds})", () => {
  it("REMOVI o item B e o servidor não mexeu: SEGUE removido (não ressuscita)", () => {
    const r = merge({ live: [A0], fresh: [A0, B0], ids: set("B") });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.conflitos).toEqual([]);
  });
  it("REMOVI o item B mas o servidor MEXEU nele (M1) depois da base: conflito de linha (meu: null), nem restaurado nem apagado calado", () => {
    const r = merge({ live: [A0], fresh: [A0, { ...B0, valor_unitario_m1: 55 }], ids: set("B") });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: "linha:B", meu: null });
    expect((r.conflitos[0].dele as { valor_unitario_m1: number }).valor_unitario_m1).toBe(55);
  });
  it("o servidor TIROU o item B que EU tinha editado: conflito (dele: null) e o meu fica na tela", () => {
    const r = merge({ live: [A0, { ...B0, valor_unitario_m1: 60 }], fresh: [A0], ids: set("B") });
    expect(r.items.map((i) => i.id)).toEqual(["A", "B"]);
    expect(r.conflitos).toEqual([expect.objectContaining({ path: "linha:B", dele: null })]);
  });
  it("o servidor tirou o item B que EU NÃO toquei: some da minha tela", () => {
    expect(merge({ live: [A0, B0], fresh: [A0] }).items.map((i) => i.id)).toEqual(["A"]);
  });
  it("o outro ADICIONOU o item C: aparece, com a grade dele", () => {
    const r = merge({ live: [A0, B0], fresh: [A0, B0, mk("C", { grade: grade(3, 3) })] });
    expect(r.items.map((i) => i.id)).toEqual(["A", "B", "C"]);
    expect(r.items[2].grade["1"]["36|PP"].pedida).toBe(3);
    expect(r.atualizados).toBe(1);
  });
  it("minha linha NOVA (sem id) sempre fica", () => {
    const nova = mk("x", { id: null, tempId: "novo-1" });
    expect(merge({ live: [A0, B0, nova], fresh: [A0, B0] }).items.map((i) => i.tempId)).toEqual(["A", "B", "novo-1"]);
  });
  it("o OUTRO RECEBEU o item A e eu não toquei nele: adoto o recebimento, a grade recebida e o LANDED que o servidor calculou", () => {
    const rec = { ...A0, status: "recebido" as const, data_entrega: "2026-10-05", nota_fiscal: "4512", grade: grade(5, 5, 4), custo_unitario_landed_real: 77.7 };
    const r = merge({ live: [A0, B0], fresh: [rec, B0] });
    const a = r.items.find((i) => i.id === "A")!;
    expect(a.status).toBe("recebido");
    expect(a).toMatchObject({ data_entrega: "2026-10-05", nota_fiscal: "4512", custo_unitario_landed_real: 77.7 });
    expect(a.grade["1"]["36|PP"].recebida).toBe(4);
    expect(r.conflitos).toEqual([]);
  });
  it("status e landed NUNCA são meus: mesmo com a linha tocada por mim, mostra o do servidor (e não vira conflito)", () => {
    const r = merge({ live: [{ ...A0, valor_unitario_m1: 51 }, B0], fresh: [{ ...A0, status: "recebido" as const, custo_unitario_landed_real: 9 }, B0], ids: set("A") });
    const a = r.items.find((i) => i.id === "A")!;
    expect(a).toMatchObject({ status: "recebido", valor_unitario_m1: 51, custo_unitario_landed_real: 9 });
    expect(r.conflitos).toEqual([]);
    expect(r.mudouItens).toBe(true);
  });
  it("só o LANDED mudou no servidor (o outro mexeu nas etapas/cotação): a tela adota, sem conflito", () => {
    const r = merge({ live: [A0, B0], fresh: [{ ...A0, custo_unitario_landed_real: 42 }, B0] });
    expect(r.items[0].custo_unitario_landed_real).toBe(42);
    expect(r.conflitos).toEqual([]);
    expect(r.mudouItens).toBe(true);
  });
  it("eu e o outro editamos o MESMO item (M1 × desconto): conflito de linha, o meu fica", () => {
    const r = merge({ live: [{ ...A0, valor_unitario_m1: 51 }, B0], fresh: [{ ...A0, desconto_pct: 10 }, B0], ids: set("A") });
    expect(r.conflitos).toEqual([expect.objectContaining({ path: "linha:A" })]);
    expect(r.items[0].valor_unitario_m1).toBe(51);
  });
  it("peso e transporte também são campos da linha (mexer neles não passa em silêncio)", () => {
    const r = merge({ live: [{ ...A0, peso_kg: 1 }, B0], fresh: [{ ...A0, transporte_m2: 99 }, B0], ids: set("A") });
    expect(r.conflitos).toEqual([expect.objectContaining({ path: "linha:A" })]);
  });
  it("#16: NF/data/responsável/devolução/revisão são campos NORMAIS da linha: o outro gravou a NF e eu não toquei → adoto (sem receber, status igual); os dois editamos → conflito de linha", () => {
    const dele = { ...A0, nota_fiscal: "NF-DELE", data_entrega: "2026-10-05", responsavel_recebimento_id: "u9", revisao: "ok", devolucao: "2 peças" };
    const r1 = merge({ live: [A0, B0], fresh: [dele, B0] });
    const a = r1.items.find((i) => i.id === "A")!;
    expect(a).toMatchObject({ nota_fiscal: "NF-DELE", data_entrega: "2026-10-05", responsavel_recebimento_id: "u9", revisao: "ok", devolucao: "2 peças", status: "encomendado" });
    expect(r1.conflitos).toEqual([]);
    expect(r1.mudouItens).toBe(true);
    // eu mexi na NF dele também (mesma linha, campos diferentes do que ela mexeu NA LINHA): conflito de linha; o meu fica
    const r2 = merge({ live: [{ ...A0, nota_fiscal: "NF-MINHA" }, B0], fresh: [{ ...A0, nota_fiscal: "NF-DELE" }, B0], ids: set("A") });
    expect(r2.conflitos).toEqual([expect.objectContaining({ path: "linha:A" })]);
    expect(r2.items[0].nota_fiscal).toBe("NF-MINHA");
  });
  it("nada mudou: resultado vazio (a tela não toca em nenhum state)", () => {
    expect(merge({ live: [A0, B0], fresh: [A0, B0] })).toMatchObject({ conflitos: [], atualizados: 0, mudouDraft: false, mudouItens: false });
  });
});

describe("cabeçalho — mergeDraft (moeda, cotações e ETAPAS como UM campo)", () => {
  it("campos diferentes se somam; o mesmo campo conflita (o meu fica)", () => {
    const r = merge({
      live: [A0, B0], fresh: [A0, B0],
      liveDraft: cab({ cotacao_final: 5.9 }), freshDraft: cab({ data_prevista: "2026-11-01", cotacao_final: 6.1 }),
      touched: set("cotacao_final"),
    });
    expect(r.draft.data_prevista).toBe("2026-11-01");
    expect(r.draft.cotacao_final).toBe(5.9);
    expect(r.conflitos).toEqual([{ path: "cotacao_final", meu: 5.9, dele: 6.1 }]);
    expect(r.mudouDraft).toBe(true);
  });
  it("cronograma: o outro mexeu nas etapas e eu não → adoto; os dois mexemos → conflito do cronograma inteiro", () => {
    const novo = [etp("Sinal", 50), etp("Saldo", 50, 2)];
    const adota = merge({ live: [A0, B0], fresh: [A0, B0], freshDraft: cab({ etapas: novo }) });
    expect(adota.draft.etapas).toEqual(novo);
    expect(adota.conflitos).toEqual([]);
    const conflita = merge({
      live: [A0, B0], fresh: [A0, B0], liveDraft: cab({ etapas: [etp("Sinal", 70), etp("Saldo", 30, 2)] }), freshDraft: cab({ etapas: novo }), touched: set("etapas"),
    });
    expect(conflita.conflitos).toEqual([expect.objectContaining({ path: "etapas" })]);
    expect(conflita.draft.etapas[0].percentual).toBe(70);
  });
});

describe("base depois do merge", () => {
  it("a linha em conflito NÃO avança a base (o próximo merge recalcula); cabeçalho e GRADES avançam", () => {
    const deleA = { ...A0, desconto_pct: 10, grade: grade(7, 5) };
    const b = base();
    const r = merge({ live: [{ ...A0, valor_unitario_m1: 51 }, B0], fresh: [deleA, B0], ids: set("A"), b });
    const nova = baseAposMerge(b, { draft: cab(), items: [deleA, B0] }, r.conflitos);
    expect(nova.linhas.find((l) => l.id === "A")!.desconto_pct).toBe(0);
    expect(nova.linhas.find((l) => l.id === "B")).toBeDefined();
    expect(nova.grades.A["1"]["36|PP"].pedida).toBe(7);
  });
});

describe("retry do P0409 (receita 2419d0f)", () => {
  it("meus campos/linhas/células tocados ficam, o que SÓ o outro mexeu chega e o status é o do servidor", () => {
    const live = { draft: cab({ cotacao_final: 5.9 }), items: [{ ...A0, valor_unitario_m1: 51 }, B0, mk("N", { id: null, tempId: "novo-9" })] };
    const fresh = { draft: cab({ data_prevista: "2026-11-01" }), items: [A0, { ...B0, desconto_pct: 8 }], status: "recebido" as const };
    const r = mesclarParaRetryP0409Imp({ base: base(), live, fresh, touched: set("cotacao_final"), touchedIds: set("A"), touchedGrade: vazio() });
    expect(r.estado.status).toBe("recebido");
    expect(r.estado.draft).toMatchObject({ cotacao_final: 5.9, data_prevista: "2026-11-01" });
    expect(r.estado.items.map((i) => [i.tempId, i.valor_unitario_m1, i.desconto_pct])).toEqual([["A", 51, 0], ["B", 50, 8], ["novo-9", 50, 0]]);
    expect(r.conflitos).toEqual([]);
  });
  it("item que EU removi e o servidor não mexeu NÃO volta no retry", () => {
    const r = mesclarParaRetryP0409Imp({
      base: base(), live: { draft: cab(), items: [A0] }, fresh: { draft: cab(), items: [A0, B0], status: "encomendado" },
      touched: vazio(), touchedIds: set("B"), touchedGrade: vazio(),
    });
    expect(r.estado.items.map((i) => i.id)).toEqual(["A"]);
  });
});

describe("resolverConflitoLinha", () => {
  const items = [A0, B0];
  it("usar o novo, servidor mudou o item: o dele ocupa o lugar do meu e a GRADE continua a minha", () => {
    const r = resolverConflitoLinha({ items: [{ ...A0, grade: grade(9, 5) }, B0], id: "A", escolha: "dele", fresh: { ...A0, desconto_pct: 10, grade: grade(1, 1) } });
    expect(r.items[0].desconto_pct).toBe(10);
    expect(r.items[0].grade["1"]["36|PP"].pedida).toBe(9);
    expect(r.limparToque).toBe(true);
  });
  it("usar o novo, servidor APAGOU: o item sai do rascunho", () => {
    expect(resolverConflitoLinha({ items, id: "B", escolha: "dele", fresh: null }).items.map((i) => i.id)).toEqual(["A"]);
  });
  it("manter meu, servidor APAGOU: o meu vira linha NOVA (sem id, status e landed zerados)", () => {
    const r = resolverConflitoLinha({ items: [A0, mk("B", { custo_unitario_landed_real: 5 })], id: "B", escolha: "meu", fresh: null });
    const b = r.items.find((i) => i.tempId === "B")!;
    expect(b.id).toBeNull();
    expect(b.custo_unitario_landed_real).toBe(0);
    expect(r.limparToque).toBe(true);
  });
  it("manter meu, servidor mudou: nada muda na tela e o id segue 'tocado' (será salvo)", () => {
    const r = resolverConflitoLinha({ items, id: "A", escolha: "meu", fresh: { ...A0, desconto_pct: 10 } });
    expect(r.items).toEqual(items);
    expect(r.limparToque).toBe(false);
  });
  it("usar o novo numa linha que EU removi: ela volta (com a grade do servidor)", () => {
    const r = resolverConflitoLinha({ items: [A0], id: "B", escolha: "dele", fresh: { ...B0, valor_unitario_m1: 55 } });
    expect(r.items.map((i) => i.id)).toEqual(["A", "B"]);
    expect(r.items[1].valor_unitario_m1).toBe(55);
  });
  it("usar o novo numa removida: substitui a linha NOVA do mesmo produto (sem duplicar) e herda o tempId dela", () => {
    const pendente = mk("pend", { id: null, tempId: "novo-5", produto_importado_id: "prod-B", doProduto: true });
    const r = resolverConflitoLinha({ items: [A0, pendente], id: "B", escolha: "dele", fresh: { ...B0, valor_unitario_m1: 55 } });
    expect(r.items).toHaveLength(2);
    expect(r.items[1]).toMatchObject({ id: "B", tempId: "novo-5", valor_unitario_m1: 55 });
  });
  it("manter meu numa linha que EU removi: continua removida", () => {
    const r = resolverConflitoLinha({ items: [A0], id: "B", escolha: "meu", fresh: B0 });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.limparToque).toBe(false);
  });
});
