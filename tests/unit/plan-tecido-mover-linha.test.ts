import { describe, it, expect } from "vitest";
import { moverParaLinha, semearComModelos, mergeArvore } from "@/lib/plan-tecido/engine";
import { achatarSlotsVisiveis, slotPassaFiltroStatus } from "@/lib/plan-tecido/calc";
import type { PtArvore, PtSlot, PtSub } from "@/lib/plan-tecido/types";

// F2 fix-linha: a "linha" de um card e a LANE (PtLinha) onde ele esta. Escolher a Linha no card MOVE o slot de bucket.
const slot = (id: string, o: Partial<PtSlot> = {}): PtSlot =>
  ({ id, modelo_id: null, materiais: [], custos_adicionais: [], slot_index: 0, ...o }) as unknown as PtSlot;
const lane = (linha_id: string | null, slots: PtSlot[], ordem = 0) => ({ linha_id, categoria_id: null, ordem, slots });
const subDe = (linhas: ReturnType<typeof lane>[]): PtSub => ({ subcolecao_id: "s1", ordem: 0, linhas }) as unknown as PtSub;

describe("moverParaLinha (F2 fix-linha)", () => {
  it("move o slot para a lane da linha escolhida (nao para o vizinho) e preserva os dados", () => {
    const meu = slot("MEU", { nome: "Vestido", preco_venda: 199, linha_id: "casual" });
    const viz = slot("VIZ", { nome: "Blusa", linha_id: "social" });
    const sub = subDe([lane("casual", [meu], 0), lane("social", [viz], 1)]);
    const r = moverParaLinha(sub, 0, 0, "social")!;
    expect(r).not.toBeNull();
    const social = r.sub.linhas[1];
    expect(social.slots.map((s) => s.id)).toEqual(["VIZ", "MEU"]);
    expect(r.sub.linhas[0].slots).toHaveLength(0);
    const movido = r.sub.linhas[r.li].slots[r.sli];
    expect(movido.id).toBe("MEU");
    expect(movido.nome).toBe("Vestido");
    expect(movido.preco_venda).toBe(199);
    expect(movido.linha_id).toBe("social");
    // o vizinho segue intacto
    expect(social.slots[0]).toBe(viz);
  });

  it("cria a lane se a linha escolhida ainda nao existe na sub, sem deslocar os indices das lanes existentes", () => {
    const a = slot("A"), b = slot("B"), c = slot("C");
    const sub = subDe([lane("casual", [a, b], 0), lane("social", [c], 1)]);
    const r = moverParaLinha(sub, 0, 1, "festa")!;
    expect(r.sub.linhas).toHaveLength(3);
    expect(r.sub.linhas[0].slots.map((s) => s.id)).toEqual(["A"]);
    expect(r.sub.linhas[1].slots.map((s) => s.id)).toEqual(["C"]); // li 1 continua a mesma lane
    expect(r.sub.linhas[2]).toMatchObject({ linha_id: "festa", categoria_id: null, ordem: 2 });
    expect([r.li, r.sli]).toEqual([2, 0]);
    expect(r.sub.linhas[2].slots[0].id).toBe("B");
    expect(r.sub.linhas[2].slots[0].linha_id).toBe("festa");
  });

  it("e pura (nao muta a sub de entrada) e retorna null se ja esta na lane", () => {
    const sub = subDe([lane("casual", [slot("A")], 0), lane("social", [], 1)]);
    const antes = JSON.stringify(sub);
    expect(moverParaLinha(sub, 0, 0, "casual")).toBeNull();
    moverParaLinha(sub, 0, 0, "social");
    expect(JSON.stringify(sub)).toBe(antes);
  });

  it("escolher '—' (null) move para a lane sem linha; indices invalidos => null", () => {
    const sub = subDe([lane("casual", [slot("A")], 0), lane(null, [], 1)]);
    const r = moverParaLinha(sub, 0, 0, null)!;
    expect(r.sub.linhas[1].slots.map((s) => s.id)).toEqual(["A"]);
    expect(r.sub.linhas[1].slots[0].linha_id).toBeNull();
    expect(moverParaLinha(sub, 5, 0, "x")).toBeNull();
    expect(moverParaLinha(sub, 0, 9, "x")).toBeNull();
  });

  it("renumera slot_index nas duas lanes", () => {
    const sub = subDe([lane("casual", [slot("A", { slot_index: 0 }), slot("B", { slot_index: 1 }), slot("C", { slot_index: 2 })], 0), lane("social", [slot("D", { slot_index: 0 })], 1)]);
    const r = moverParaLinha(sub, 0, 0, "social")!;
    expect(r.sub.linhas[0].slots.map((s) => [s.id, s.slot_index])).toEqual([["B", 0], ["C", 1]]);
    expect(r.sub.linhas[1].slots.map((s) => [s.id, s.slot_index])).toEqual([["D", 0], ["A", 1]]);
  });

  it("indices (li/sli) via achatarSlotsVisiveis continuam acertando o MESMO slot depois de mover, com o filtro de status ativo", () => {
    const sub = subDe([
      lane("casual", [slot("R", { status: "reprovado" }), slot("MEU"), slot("X")], 0),
      lane("social", [slot("Y"), slot("Z", { status: "reprovado" })], 1),
    ]);
    const arv = { colecao_id: "c", subcolecoes: [sub] } as unknown as PtArvore;
    const visivel = (s: PtSlot) => slotPassaFiltroStatus(s, false, "sem_reprovado");
    const antes = achatarSlotsVisiveis(arv, visivel);
    const f = antes.find((x) => x.slot.id === "MEU")!;
    const r = moverParaLinha(arv.subcolecoes[0], f.li, f.sli, "social")!; // (li=0, sli=1): NAO o sli deslocado do filtro
    const depois = { ...arv, subcolecoes: [r.sub] } as PtArvore;
    expect(depois.subcolecoes[0].linhas[0].slots.map((s) => s.id)).toEqual(["R", "X"]); // o reprovado oculto ficou
    const flat = achatarSlotsVisiveis(depois, visivel);
    expect(flat.map((x) => x.slot.id)).toEqual(["X", "Y", "MEU"]);
    for (const x of flat) expect(depois.subcolecoes[0].linhas[x.li].slots[x.sli]).toBe(x.slot);
    const m = flat.find((x) => x.slot.id === "MEU")!;
    expect([m.li, m.sli]).toEqual([r.li, r.sli]);
  });
});

describe("re-seed mantem o slot movido na lane escolhida (F2 fix-linha)", () => {
  const buckets = [
    { subcolecao_id: "s1", linha_id: "casual", categoria_id: null, qtd: 2 },
    { subcolecao_id: "s1", linha_id: "social", categoria_id: null, qtd: 1 },
  ];
  const seed = () => semearComModelos({ colecao_id: "c", tipo: "poder_venda", buckets, modelos: [] } as any);

  it("seed: toda vaga da lane tem linha_id da lane (passo 3 do seed consistente)", () => {
    const s = seed();
    for (const ln of s.subcolecoes[0].linhas) for (const sl of ln.slots) expect(sl.linha_id).toBe(ln.linha_id);
  });

  it("vaga com dados movida de Casual p/ Social continua na lane Social apos mergeArvore (e com linha_id=social)", () => {
    // estado salvo = arvore semeada + usuario preencheu a 1a vaga de Casual e moveu p/ Social
    const base = JSON.parse(JSON.stringify(seed())) as PtArvore;
    base.subcolecoes[0].linhas[0].slots[0] = { ...base.subcolecoes[0].linhas[0].slots[0], nome: "Meu vestido", preco_venda: 150 };
    const r = moverParaLinha(base.subcolecoes[0], 0, 0, "social")!;
    // o salvo vindo do banco NAO devolve linha_id no slot
    const salvo = JSON.parse(JSON.stringify({ ...base, subcolecoes: [r.sub] })) as PtArvore;
    for (const ln of salvo.subcolecoes[0].linhas) for (const sl of ln.slots) delete (sl as any).linha_id;
    const merged = mergeArvore(seed(), salvo);
    const casual = merged.subcolecoes[0].linhas.find((l) => l.linha_id === "casual")!;
    const social = merged.subcolecoes[0].linhas.find((l) => l.linha_id === "social")!;
    expect(social.slots.some((s) => s.nome === "Meu vestido")).toBe(true);
    expect(casual.slots.some((s) => s.nome === "Meu vestido")).toBe(false);
    for (const s of social.slots) expect(s.linha_id).toBe("social"); // o seletor mostra a linha escolhida
    for (const s of casual.slots) expect(s.linha_id).toBe("casual");
  });

  it("vaga movida p/ uma linha SEM bucket no seed (lane orfa) tambem mantem linha_id da lane", () => {
    const base = JSON.parse(JSON.stringify(seed())) as PtArvore;
    base.subcolecoes[0].linhas[0].slots[0] = { ...base.subcolecoes[0].linhas[0].slots[0], nome: "Meu vestido" };
    const r = moverParaLinha(base.subcolecoes[0], 0, 0, "festa")!;
    const salvo = JSON.parse(JSON.stringify({ ...base, subcolecoes: [r.sub] })) as PtArvore;
    for (const ln of salvo.subcolecoes[0].linhas) for (const sl of ln.slots) delete (sl as any).linha_id;
    const merged = mergeArvore(seed(), salvo);
    const festa = merged.subcolecoes[0].linhas.find((l) => l.linha_id === "festa")!;
    expect(festa.slots.map((s) => s.nome)).toEqual(["Meu vestido"]);
    expect(festa.slots[0].linha_id).toBe("festa");
  });
});
