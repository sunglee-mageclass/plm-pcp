import { describe, it, expect } from "vitest";
import { achatarSlots, mergeArvorePorSlot, restaurarSlotNaArvore } from "@/lib/plan-tecido/colab-merge-arvore";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

// Realtime Onda 1, Task 3 — o merge da arvore do Plan.Tecido leva `removidasIds` ao `mergeLinhas`:
// slot que EU removi e o servidor nao mexeu continua removido; se o servidor mexeu vira conflito
// (meu: null, dele: slot) — nem ressuscitado nem apagado em silencio.
function arv(slots: PtSlot[], categorias_tecido: string[] = []): PtArvore {
  return {
    colecao_id: "c",
    subcolecoes: [{
      subcolecao_id: "sub1", ordem: 0, categorias_tecido,
      linhas: [{ linha_id: null, categoria_id: "catA", ordem: 0, slots }],
    }],
  };
}
function slot(id: string | undefined, extra: Partial<PtSlot> = {}): PtSlot {
  return { id, modelo_id: null, materiais: [], categoria_tecido_id: null, nome: null, custos_adicionais: [], ...extra };
}
const ids = (a: PtArvore) => achatarSlots(a).map((f) => f.slot.id);

describe("plan-tecido/colab-merge-arvore — removidasIds", () => {
  it("slot que eu removi e o servidor nao mexeu continua removido (nao ressuscita)", () => {
    const base = arv([slot("s1", { nome: "A" }), slot("S", { nome: "B" })]);
    const draft = arv([slot("s1", { nome: "A" })]); // removi S
    const fresh = arv([slot("s1", { nome: "A" }), slot("S", { nome: "B" })]); // servidor igual a base

    const r = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(), removidasIds: new Set(["S"]) });

    expect(ids(r.arvore)).toEqual(["s1"]);
    expect(r.conflitos).toHaveLength(0);
  });

  it("sem removidasIds o comportamento antigo se mantem (o slot volta do fresh)", () => {
    const base = arv([slot("s1"), slot("S")]);
    const draft = arv([slot("s1")]);
    const fresh = arv([slot("s1"), slot("S")]);
    const r = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set() });
    expect(ids(r.arvore)).toContain("S");
  });

  it("servidor mudou S depois que eu removi: vira conflito (meu null / dele slot), sem restaurar calado", () => {
    const base = arv([slot("s1"), slot("S", { nome: "B" })]);
    const draft = arv([slot("s1")]);
    const fresh = arv([slot("s1"), slot("S", { nome: "B-mudado-pelo-outro" })]);

    const r = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(), removidasIds: new Set(["S"]) });

    expect(ids(r.arvore)).toEqual(["s1"]); // nao restaurado calado
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].path).toBe("linha:S");
    expect(r.conflitos[0].meu).toBeNull();
    expect((r.conflitos[0].dele as PtSlot).nome).toBe("B-mudado-pelo-outro");
  });

  it("slot novo criado pelo servidor continua entrando mesmo com removidasIds de OUTRO slot", () => {
    const base = arv([slot("s1"), slot("S")]);
    const draft = arv([slot("s1")]);
    const fresh = arv([slot("s1"), slot("S"), slot("novo", { nome: "do outro" })]);
    const r = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(), removidasIds: new Set(["S"]) });
    expect(ids(r.arvore).sort()).toEqual(["novo", "s1"]);
    expect(r.atualizados).toBe(1);
  });

  it("lane local (categoria criada e nao salva) continua preservada quando ha removidas", () => {
    const base = arv([slot("s1"), slot("S")]);
    const draft = arv([slot("s1")], ["laneLocal"]);
    const fresh = arv([slot("s1"), slot("S")], []);
    const r = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(), removidasIds: new Set(["S"]) });
    expect(r.arvore.subcolecoes[0].categorias_tecido).toContain("laneLocal");
    expect(ids(r.arvore)).toEqual(["s1"]);
  });

  it("restaurarSlotNaArvore devolve o slot ao bucket que ele tem na arvore de referencia", () => {
    const fresh = arv([slot("s1"), slot("S", { nome: "B" })]);
    const atual = arv([slot("s1")]);
    const r = restaurarSlotNaArvore(atual, fresh, "S", slot("S", { nome: "B" }));
    expect(ids(r)).toEqual(["s1", "S"]);
    expect(ids(atual)).toEqual(["s1"]); // nao muta a entrada
  });
});
