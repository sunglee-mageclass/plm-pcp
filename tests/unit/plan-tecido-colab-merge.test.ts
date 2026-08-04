import { describe, it, expect } from "vitest";
import { achatarSlots, mergeArvorePorSlot } from "@/lib/plan-tecido/colab-merge-arvore";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

// Helper: árvore com 1 subcoleção, 1 linha (categoria_id dado), N slots.
function arv(subId: string | null, catId: string | null, slots: PtSlot[], categorias_tecido: string[] = []): PtArvore {
  return {
    colecao_id: "c",
    subcolecoes: [{
      subcolecao_id: subId, ordem: 0, categorias_tecido,
      linhas: [{ linha_id: null, categoria_id: catId, ordem: 0, slots }],
    }],
  };
}
function slot(id: string | undefined, extra: Partial<PtSlot> = {}): PtSlot {
  return { id, modelo_id: null, materiais: [], categoria_tecido_id: null, nome: null, custos_adicionais: [], ...extra };
}

describe("plan-tecido/colab-merge-arvore", () => {
  it("merge normal por slot: não-tocado adota o fresco em silêncio; tocado+divergente vira conflito", () => {
    const base = arv("sub1", "catA", [slot("s1", { nome: "Original1" }), slot("s2", { nome: "Original2" })]);
    const fresh = arv("sub1", "catA", [slot("s1", { nome: "ServerChanged1" }), slot("s2", { nome: "ServerChanged2" })]);
    const draft = arv("sub1", "catA", [slot("s1", { nome: "Original1" }), slot("s2", { nome: "LocalChanged2" })]);

    const result = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(["s2"]) });

    const flat = new Map(achatarSlots(result.arvore).map((f) => [f.slot.id, f.slot]));
    // s1: não tocado, servidor mudou → adota o fresco em silêncio (sem conflito).
    expect(flat.get("s1")?.nome).toBe("ServerChanged1");
    // s2: tocado E servidor mudou diferente do meu → conflito (mantém o MEU, sinalizado).
    expect(flat.get("s2")?.nome).toBe("LocalChanged2");
    expect(result.conflitos).toHaveLength(1);
    expect(result.conflitos[0].path).toBe("linha:s2");
    expect((result.conflitos[0].meu as PtSlot).nome).toBe("LocalChanged2");
    expect((result.conflitos[0].dele as PtSlot).nome).toBe("ServerChanged2");
    expect(result.atualizados).toBe(1); // só s1
  });

  it("slot tocado que SOME do fresco (bucket saiu do OTB) é REINSERIDO com conflito, resolvível nos 2 sentidos", () => {
    // s3 vivia em sub1/categoria "catA" — sem modelo vinculado (vaga do OTB); a categoria
    // inteira desaparece na árvore fresca (só sobra "catB", sem nenhum slot de s3).
    const base = arv("sub1", "catA", [slot("s3", { categoria_tecido_id: null })]);
    const draft = arv("sub1", "catA", [slot("s3", { categoria_tecido_id: "corX" })]); // tocado localmente
    const fresh: PtArvore = {
      colecao_id: "c",
      subcolecoes: [{ subcolecao_id: "sub1", ordem: 0, categorias_tecido: [], linhas: [
        { linha_id: null, categoria_id: "catB", ordem: 0, slots: [] }, // catA sumiu; catB sobrevive (sub1 continua existindo)
      ] }],
    };

    const result = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(["s3"]) });

    // Conflito levantado (não um "sumiu em silêncio").
    expect(result.conflitos).toHaveLength(1);
    expect(result.conflitos[0].path).toBe("linha:s3");
    expect(result.conflitos[0].dele).toBeNull(); // sumiu no servidor
    expect((result.conflitos[0].meu as PtSlot).categoria_tecido_id).toBe("corX");

    // REINSERIDO na árvore resultante (não perdido) — presente, com o conteúdo LOCAL.
    const achatado = achatarSlots(result.arvore);
    const s3 = achatado.find((f) => f.slot.id === "s3");
    expect(s3).toBeDefined();
    expect(s3!.slot.categoria_tecido_id).toBe("corX");
    // Reinserido na posição ORIGINAL da árvore local (sub1/catA), recriada minimamente.
    expect(s3!.bucket).toBe("sub1::|catA");
    const catARecriada = result.arvore.subcolecoes[0].linhas.find((l) => l.categoria_id === "catA");
    expect(catARecriada?.slots.map((s) => s.id)).toContain("s3");

    // Resolvível nos 2 sentidos (mesma lógica do resolverConflitoSlot do componente):
    // "usar o novo" (dele=null) — acha o slot (não é -1) e REMOVE.
    const arvoreUsarNovo = structuredClone(result.arvore) as PtArvore;
    for (const sub of arvoreUsarNovo.subcolecoes) for (const ln of sub.linhas) {
      const i = ln.slots.findIndex((s) => s.id === "s3");
      if (i < 0) continue;
      if (result.conflitos[0].dele) ln.slots[i] = result.conflitos[0].dele as PtSlot; else ln.slots.splice(i, 1);
    }
    expect(achatarSlots(arvoreUsarNovo).some((f) => f.slot.id === "s3")).toBe(false);

    // "manter meu" — não mexe na árvore; o slot CONTINUA presente (a reinserção já bastou).
    expect(achatarSlots(result.arvore).some((f) => f.slot.id === "s3")).toBe(true);
  });

  it("lane (categoria_tecido) local nova é preservada — união fresh ∪ local, não pisada", () => {
    const base = arv("sub1", "catA", [slot("s1")], ["catA"]);
    // Alguém salvou uma categoria nova (catC) enquanto eu, sem salvar, adicionei outra (catB).
    const fresh = arv("sub1", "catA", [slot("s1")], ["catA", "catC"]);
    const draft = arv("sub1", "catA", [slot("s1")], ["catA", "catB"]);

    const result = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set() });

    const cats = result.arvore.subcolecoes[0].categorias_tecido ?? [];
    expect(new Set(cats)).toEqual(new Set(["catA", "catB", "catC"]));
  });

  it("slot local SEM id (novo, nunca salvo) é mantido na reconstrução", () => {
    const base = arv("sub1", "catA", [slot("s1")]);
    const fresh = arv("sub1", "catA", [slot("s1")]);
    const novoLocal = slot(undefined, { nome: "Novo sem id" });
    const draft = arv("sub1", "catA", [slot("s1"), novoLocal]);

    const result = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set() });

    const semId = achatarSlots(result.arvore).find((f) => !f.slot.id);
    expect(semId).toBeDefined();
    expect(semId!.slot.nome).toBe("Novo sem id");
    expect(semId!.bucket).toBe("sub1::|catA");
  });
});
