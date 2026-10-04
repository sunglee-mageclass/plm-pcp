// Reforço de segurança S6, fix round B1 — retry automático do P0409 da OC Tecido manda o estado MESCLADO.
// Cenário: A abre a OC encomendada e muda as observações de entrega e a qtd do item 1; B (outra aba) recebe a OC e muda a
// observação de defeitos e o preço do item 2. A salva → P0409 → merge → retry. O retry tem de mandar: status do servidor
// ("recebido"), os campos de B que A não tocou (obs. de defeitos, item 2) e os de A (obs. de entrega, item 1).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mesclarParaRetryP0409 } from "@/components/oc-tecido/retry-p0409";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = readFileSync(ROOT + "src/routes/_authenticated/entrada-saida.oc-tecido.tsx", "utf8");

type D = { observacoes_entrega: string; observacoes_defeitos: string; prazo_pagamento: string };
type I = { id: string | null; quantidade_pedida: number; preco: number };

describe("mesclarParaRetryP0409 (puro)", () => {
  const base = {
    draft: { observacoes_entrega: "", observacoes_defeitos: "", prazo_pagamento: "30" } as D,
    items: [{ id: "i1", quantidade_pedida: 100, preco: 10 }, { id: "i2", quantidade_pedida: 50, preco: 10 }] as I[],
  };
  const live = {
    draft: { ...base.draft, observacoes_entrega: "meu texto" },
    items: [{ id: "i1", quantidade_pedida: 120, preco: 10 }, { id: "i2", quantidade_pedida: 50, preco: 10 }, { id: null, quantidade_pedida: 5, preco: 1 }],
  };
  const fresh = {
    draft: { ...base.draft, observacoes_defeitos: "texto do B" },
    items: [{ id: "i1", quantidade_pedida: 100, preco: 10 }, { id: "i2", quantidade_pedida: 50, preco: 12 }],
    status: "recebido" as const,
  };
  const r = mesclarParaRetryP0409({ base, live, fresh, touched: new Set(["observacoes_entrega"]), touchedIds: new Set(["i1"]) });

  it("status = o do servidor (nunca o da tela)", () => expect(r.estado.status).toBe("recebido"));
  it("campos de B que eu não toquei chegam; os meus ficam", () => {
    expect(r.estado.draft).toEqual({ observacoes_entrega: "meu texto", observacoes_defeitos: "texto do B", prazo_pagamento: "30" });
    expect(r.estado.items).toEqual([
      { id: "i1", quantidade_pedida: 120, preco: 10 }, // meu
      { id: "i2", quantidade_pedida: 50, preco: 12 }, // do B
      { id: null, quantidade_pedida: 5, preco: 1 }, // minha linha nova
    ]);
    expect(r.conflitos).toEqual([]);
    expect(r.mudouDraft && r.mudouItens).toBe(true);
    expect(r.atualizados).toBe(2);
  });
  it("conflito real (eu e B no mesmo campo) aparece e mantém o meu", () => {
    const r2 = mesclarParaRetryP0409({
      base, live, fresh: { ...fresh, draft: { ...fresh.draft, observacoes_entrega: "do B" } },
      touched: new Set(["observacoes_entrega"]), touchedIds: new Set(),
    });
    expect(r2.conflitos.map((c) => c.path)).toEqual(["observacoes_entrega"]);
    expect(r2.estado.draft.observacoes_entrega).toBe("meu texto");
  });
});

describe("OC Tecido: o retry do P0409 usa o estado mesclado (fonte)", () => {
  const ini = SRC.indexOf("const saveMutation = useMutation({");
  const fimFn = SRC.indexOf("onSuccess: () => {", ini);
  const mutationFn = SRC.slice(ini, fimFn);
  const onError = SRC.slice(SRC.indexOf("onError: async (e: any, markReceived) => {", ini), SRC.indexOf("const unmarkReceivedMut", ini));

  it("mutationFn lê draft/items/status dos refs ao vivo (não da closure) e recalcula os totais deles", () => {
    expect(mutationFn).toContain("const draft = draftLiveRef.current;");
    expect(mutationFn).toContain("const items = itemsLiveRef.current;");
    expect(mutationFn).toContain("const status = statusLiveRef.current;");
    expect(mutationFn).toMatch(/const totalPrevisto = items\.filter/);
    expect(mutationFn).toMatch(/const totalReal = items\.filter/);
    // as leituras vêm ANTES de qualquer uso no payload
    expect(mutationFn.indexOf("const status = statusLiveRef.current;")).toBeLessThan(mutationFn.indexOf('status: markReceived ? "recebido" : status'));
  });
  it("statusLiveRef existe e é atualizado a cada render", () => {
    expect(SRC).toContain("const statusLiveRef = useRef(status);\n  statusLiveRef.current = status;");
  });
  it("onError: merge puro → refs com o estado mesclado → só então o retry", () => {
    expect(onError).toContain("mesclarParaRetryP0409({");
    const iRefs = onError.indexOf("statusLiveRef.current = r.estado.status;");
    expect(onError.indexOf("draftLiveRef.current = r.estado.draft;")).toBeGreaterThan(-1);
    expect(onError.indexOf("itemsLiveRef.current = r.estado.items;")).toBeGreaterThan(-1);
    expect(iRefs).toBeGreaterThan(-1);
    expect(iRefs).toBeLessThan(onError.indexOf("saveMutation.mutate(markReceived"));
  });
  it("onSuccess re-baseia no que foi ENVIADO", () => {
    expect(SRC).toContain("baseRef.current = enviadoRef.current ?? { draft, items };");
  });
});
