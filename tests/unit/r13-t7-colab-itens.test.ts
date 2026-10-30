// [urg R13 T7] Colaboração da OC de Produto Acabado COM itens — merge 3-vias (cabeçalho · linhas · grade por célula de cada item),
// retry do P0409 e resolução de conflito de linha. Tudo PURO: o que a tela faz é chamar estas funções (ver OcPaDialog).
import { describe, it, expect } from "vitest";
import {
  baseAposMerge, baseDe, mesclarOcItens, mesclarParaRetryP0409Pa, resolverConflitoLinha, rotuloConflitoOc, tocadasDoItem,
} from "@/components/oc-p-acabado/colab-itens";
import { itemDeRow, pathCelulaItem, type ItemOcPa } from "@/components/oc-p-acabado/itens";
import { emptyCabecalho, type CabecalhoDraft, type GradeDetalhe } from "@/components/oc-p-acabado/shared";

const grade = (pp = 5, p = 5, rec = 0): GradeDetalhe => ({ "1": { "36|PP": { pedida: pp, recebida: rec, defeito: 0 }, "38|P": { pedida: p, recebida: 0, defeito: 0 } } });
const mk = (id: string, over: Partial<ItemOcPa> = {}): ItemOcPa => ({
  ...itemDeRow({
    id, ordem: 1, produto_acabado_id: `prod-${id}`, nome_produto: `Produto ${id}`, grupo_id: "g1", categoria_id: "c1",
    ref_fornecedor: "", composicao: "", grade_proporcao: { "36|PP": 1, "38|P": 1 }, variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
    qtd_total: 10, valor_unitario: 50, desconto_pct: 0, grade_detalhe: grade(), status: "encomendado",
  }),
  ...over,
});
const cab = (over: Partial<CabecalhoDraft> = {}): CabecalhoDraft => ({ ...emptyCabecalho(), empresa_id: "e1", data_pedido: "2026-10-01", prazo_pagamento: "30", ...over });
const set = (...x: string[]) => new Set(x);
const vazio = () => new Set<string>();

// Estado de partida: a OC tem A e B; eu vi o servidor assim.
const A0 = mk("A"), B0 = mk("B");
const base = () => baseDe(cab(), [A0, B0]);

function merge(o: { live: ItemOcPa[]; fresh: ItemOcPa[]; liveDraft?: CabecalhoDraft; freshDraft?: CabecalhoDraft; touched?: Set<string>; ids?: Set<string>; celulas?: Set<string>; b?: ReturnType<typeof base> }) {
  return mesclarOcItens({
    base: o.b ?? base(),
    live: { draft: o.liveDraft ?? cab(), items: o.live },
    fresh: { draft: o.freshDraft ?? cab(), items: o.fresh },
    touched: o.touched ?? vazio(), touchedIds: o.ids ?? vazio(), touchedGrade: o.celulas ?? vazio(),
  });
}

describe("grade por item — mergeGradeGenerico com caminho item:<id>:grade:<ordem>:<tam>:<campo>", () => {
  it("EU mexo numa célula do item A, o outro numa célula do item B: as duas ficam, sem conflito", () => {
    const meuA = { ...A0, grade: grade(9, 5) };                 // pedida 36|PP de A: 5 → 9 (minha)
    const deleB = { ...B0, grade: grade(5, 7) };                // pedida 38|P de B: 5 → 7 (dele)
    const r = merge({ live: [meuA, B0], fresh: [A0, deleB], celulas: set(pathCelulaItem("A", "1", "36|PP", "pedida")) });
    expect(r.conflitos).toEqual([]);
    expect(r.items.find((i) => i.id === "A")!.grade["1"]["36|PP"].pedida).toBe(9);
    expect(r.items.find((i) => i.id === "B")!.grade["1"]["38|P"].pedida).toBe(7);
    expect(r.atualizados).toBe(1);
    expect(r.mudouItens).toBe(true);
  });
  it("EU e o outro na MESMA célula: conflito com o caminho prefixado pelo item; meu valor fica", () => {
    const meuA = { ...A0, grade: grade(9, 5) };
    const deleA = { ...A0, grade: grade(6, 5) };
    const r = merge({ live: [meuA, B0], fresh: [deleA, B0], celulas: set(pathCelula("A")) });
    expect(r.conflitos).toEqual([{ path: "item:A:grade:1:36|PP:pedida", meu: 9, dele: 6 }]);
    expect(r.items.find((i) => i.id === "A")!.grade["1"]["36|PP"].pedida).toBe(9);
  });
  it("células DIFERENTES do MESMO item: merge por célula (a linha não vira conflito só porque a grade mexeu)", () => {
    const meuA = { ...A0, grade: grade(9, 5) };
    const deleA = { ...A0, grade: grade(5, 8) };
    const r = merge({ live: [meuA, B0], fresh: [deleA, B0], celulas: set(pathCelula("A")) });
    expect(r.conflitos).toEqual([]);
    expect(r.items[0].grade["1"]).toMatchObject({ "36|PP": { pedida: 9 }, "38|P": { pedida: 8 } });
  });
  it("tocadasDoItem filtra por item e tira o prefixo (formato do mergeGradeGenerico)", () => {
    const s = set("item:A:grade:1:36|PP:pedida", "item:B:grade:1:38|P:defeito");
    expect([...tocadasDoItem(s, "A")]).toEqual(["grade:1:36|PP:pedida"]);
    expect([...tocadasDoItem(s, "C")]).toEqual([]);
  });
  it("rótulo do conflito de célula e de linha usa o NOME do produto", () => {
    const nome = (id: string) => (id === "A" ? "Vestido" : "?");
    expect(rotuloConflitoOc("item:A:grade:1:36|PP:pedida", {}, nome)).toBe("Vestido · Pedida · 36|PP (var 1)");
    expect(rotuloConflitoOc("linha:A", {}, nome)).toBe("Produto “Vestido”");
    expect(rotuloConflitoOc("prazo_pagamento", { prazo_pagamento: "Prazo" }, nome)).toBe("Prazo");
  });
});
function pathCelula(id: string) { return pathCelulaItem(id, "1", "36|PP", "pedida"); }

describe("itens — mergeLinhas({removidasIds})", () => {
  it("REMOVI o item B e o servidor não mexeu: SEGUE removido (não ressuscita como 'linha nova do servidor')", () => {
    const r = merge({ live: [A0], fresh: [A0, B0], ids: set("B") });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.conflitos).toEqual([]);
  });
  it("REMOVI o item B mas o servidor MEXEU nele depois da base: conflito de linha (meu: null), nem restaurado nem apagado calado", () => {
    const B1 = { ...B0, valor_unitario: 55 };
    const r = merge({ live: [A0], fresh: [A0, B1], ids: set("B") });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: "linha:B", meu: null });
    expect((r.conflitos[0].dele as { valor_unitario: number }).valor_unitario).toBe(55);
  });
  it("o servidor TIROU o item B que EU tinha editado: conflito (dele: null) e o meu fica na tela", () => {
    const meuB = { ...B0, valor_unitario: 60 };
    const r = merge({ live: [A0, meuB], fresh: [A0], ids: set("B") });
    expect(r.items.map((i) => i.id)).toEqual(["A", "B"]);
    expect(r.conflitos).toEqual([expect.objectContaining({ path: "linha:B", dele: null })]);
  });
  it("o servidor tirou o item B que EU NÃO toquei: some da minha tela", () => {
    const r = merge({ live: [A0, B0], fresh: [A0] });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.conflitos).toEqual([]);
  });
  it("o outro ADICIONOU o item C: aparece, com a grade dele", () => {
    const C = mk("C", { grade: grade(3, 3) });
    const r = merge({ live: [A0, B0], fresh: [A0, B0, C] });
    expect(r.items.map((i) => i.id)).toEqual(["A", "B", "C"]);
    expect(r.items[2].grade["1"]["36|PP"].pedida).toBe(3);
    expect(r.atualizados).toBe(1);
  });
  it("minha linha NOVA (sem id) sempre fica", () => {
    const nova = mk("x", { id: null, tempId: "novo-1" });
    const r = merge({ live: [A0, B0, nova], fresh: [A0, B0] });
    expect(r.items.map((i) => i.tempId)).toEqual(["A", "B", "novo-1"]);
  });
  it("o OUTRO RECEBEU o item A e eu não toquei nele: adoto o recebimento (status, dados e a grade recebida) — status segue o servidor", () => {
    const rec = { ...A0, status: "recebido" as const, data_entrega: "2026-10-05", nota_fiscal: "4512", grade: grade(5, 5, 4) };
    const r = merge({ live: [A0, B0], fresh: [rec, B0] });
    const a = r.items.find((i) => i.id === "A")!;
    expect(a.status).toBe("recebido");
    expect(a).toMatchObject({ data_entrega: "2026-10-05", nota_fiscal: "4512" });
    expect(a.grade["1"]["36|PP"].recebida).toBe(4);
    expect(r.conflitos).toEqual([]);
  });
  it("o status do item NUNCA é meu: mesmo com a linha tocada por mim, mostra o do servidor", () => {
    const meuA = { ...A0, valor_unitario: 51 };
    const recA = { ...A0, status: "recebido" as const };
    const r = merge({ live: [meuA, B0], fresh: [recA, B0], ids: set("A") });
    expect(r.items.find((i) => i.id === "A")!.status).toBe("recebido");
    expect(r.items.find((i) => i.id === "A")!.valor_unitario).toBe(51);
    expect(r.conflitos).toEqual([]); // status não é campo da linha do merge
  });
  it("eu e o outro editamos o MESMO item (campos de compra): conflito de linha, o meu fica", () => {
    const r = merge({ live: [{ ...A0, valor_unitario: 51 }, B0], fresh: [{ ...A0, desconto_pct: 10 }, B0], ids: set("A") });
    expect(r.conflitos).toEqual([expect.objectContaining({ path: "linha:A" })]);
    expect(r.items[0].valor_unitario).toBe(51);
  });
  it("nada mudou: resultado vazio (a tela não toca em nenhum state)", () => {
    const r = merge({ live: [A0, B0], fresh: [A0, B0] });
    expect(r).toMatchObject({ conflitos: [], atualizados: 0, mudouDraft: false, mudouItens: false });
  });
});

describe("cabeçalho — mergeDraft", () => {
  it("campos diferentes se somam; o mesmo campo conflita (o meu fica)", () => {
    const r = merge({
      live: [A0, B0], fresh: [A0, B0],
      liveDraft: cab({ prazo_pagamento: "30/60" }), freshDraft: cab({ data_prevista: "2026-11-01", prazo_pagamento: "45" }),
      touched: set("prazo_pagamento"),
    });
    expect(r.draft.data_prevista).toBe("2026-11-01");
    expect(r.draft.prazo_pagamento).toBe("30/60");
    expect(r.conflitos).toEqual([{ path: "prazo_pagamento", meu: "30/60", dele: "45" }]);
    expect(r.mudouDraft).toBe(true);
  });
});

describe("base depois do merge", () => {
  it("a linha em conflito NÃO avança a base (o próximo merge recalcula); cabeçalho e GRADES avançam", () => {
    const meuA = { ...A0, valor_unitario: 51 };
    const deleA = { ...A0, desconto_pct: 10, grade: grade(7, 5) };
    const b = base();
    const r = merge({ live: [meuA, B0], fresh: [deleA, B0], ids: set("A"), b });
    const nova = baseAposMerge(b, { draft: cab(), items: [deleA, B0] }, r.conflitos);
    expect(nova.linhas.find((l) => l.id === "A")!.desconto_pct).toBe(0);          // base antiga da linha em conflito
    expect(nova.linhas.find((l) => l.id === "B")).toBeDefined();
    expect(nova.grades.A["1"]["36|PP"].pedida).toBe(7);                           // a grade avança para o servidor
  });
});

describe("retry do P0409 (receita 2419d0f)", () => {
  it("meus campos/linhas/células ficam, o que SÓ o outro mexeu chega e o status é o do servidor", () => {
    const b = base();
    const live = { draft: cab({ prazo_pagamento: "30/60" }), items: [{ ...A0, valor_unitario: 51 }, B0, mk("N", { id: null, tempId: "novo-9" })] };
    const fresh = {
      draft: cab({ data_prevista: "2026-11-01" }),
      items: [A0, { ...B0, desconto_pct: 8 }],
      status: "recebido" as const,
    };
    const r = mesclarParaRetryP0409Pa({ base: b, live, fresh, touched: set("prazo_pagamento"), touchedIds: set("A"), touchedGrade: vazio() });
    expect(r.estado.status).toBe("recebido");
    expect(r.estado.draft).toMatchObject({ prazo_pagamento: "30/60", data_prevista: "2026-11-01" });
    expect(r.estado.items.map((i) => [i.tempId, i.valor_unitario, i.desconto_pct])).toEqual([["A", 51, 0], ["B", 50, 8], ["novo-9", 50, 0]]);
    expect(r.conflitos).toEqual([]);
  });
  it("item que EU removi e o servidor não mexeu NÃO volta no retry (senão o retry o ressuscitaria)", () => {
    const r = mesclarParaRetryP0409Pa({
      base: base(), live: { draft: cab(), items: [A0] }, fresh: { draft: cab(), items: [A0, B0], status: "encomendado" },
      touched: vazio(), touchedIds: set("B"), touchedGrade: vazio(),
    });
    expect(r.estado.items.map((i) => i.id)).toEqual(["A"]);
  });
});

describe("resolverConflitoLinha", () => {
  const items = [A0, B0];
  it("usar o novo, servidor mudou o item: o dele ocupa o lugar do meu e a GRADE continua a minha", () => {
    const meu = { ...A0, grade: grade(9, 5) };
    const dele = { ...A0, desconto_pct: 10, grade: grade(1, 1) };
    const r = resolverConflitoLinha({ items: [meu, B0], id: "A", escolha: "dele", fresh: dele });
    expect(r.items[0].desconto_pct).toBe(10);
    expect(r.items[0].grade["1"]["36|PP"].pedida).toBe(9);
    expect(r.limparToque).toBe(true);
  });
  it("usar o novo, servidor APAGOU: o item sai do rascunho", () => {
    const r = resolverConflitoLinha({ items, id: "B", escolha: "dele", fresh: null });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
  });
  it("manter meu, servidor APAGOU: o meu vira linha NOVA (sem id) — mandar o id de uma linha que não existe daria nao_encontrado", () => {
    const r = resolverConflitoLinha({ items, id: "B", escolha: "meu", fresh: null });
    expect(r.items.find((i) => i.tempId === "B")!.id).toBeNull();
    expect(r.limparToque).toBe(true);
  });
  it("manter meu, servidor mudou: nada muda na tela e o id segue 'tocado' (será salvo)", () => {
    const r = resolverConflitoLinha({ items, id: "A", escolha: "meu", fresh: { ...A0, desconto_pct: 10 } });
    expect(r.items).toEqual(items);
    expect(r.limparToque).toBe(false);
  });
  it("usar o novo numa linha que EU removi: ela volta (com a grade do servidor)", () => {
    const dele = { ...B0, valor_unitario: 55 };
    const r = resolverConflitoLinha({ items: [A0], id: "B", escolha: "dele", fresh: dele });
    expect(r.items.map((i) => i.id)).toEqual(["A", "B"]);
    expect(r.items[1].valor_unitario).toBe(55);
  });
  it("usar o novo numa removida: substitui a linha NOVA do mesmo produto (sem duplicar) e herda o tempId dela", () => {
    const pendente = mk("pend", { id: null, tempId: "novo-5", produto_acabado_id: "prod-B", doProduto: true });
    const r = resolverConflitoLinha({ items: [A0, pendente], id: "B", escolha: "dele", fresh: { ...B0, valor_unitario: 55 } });
    expect(r.items).toHaveLength(2);
    expect(r.items[1]).toMatchObject({ id: "B", tempId: "novo-5", valor_unitario: 55 });
  });
  it("manter meu numa linha que EU removi: continua removida", () => {
    const r = resolverConflitoLinha({ items: [A0], id: "B", escolha: "meu", fresh: B0 });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.limparToque).toBe(false); // o id segue em touchedIds => o Salvar o tira
  });
});
