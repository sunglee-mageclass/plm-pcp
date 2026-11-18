// Realtime Onda 1, Task 4 — `rolos_planejados` (plano de rolos por item, OC Tecido modo rolo) entra no merge colaborativo.
// Antes: `rolosPorItem` (estado React por item, chave = tempId = id do item) NUNCA era mesclado — o refetch só semeava na 1a carga, e o
// Salvar mandava `rolos_planejados: roloPlan(tempId)` para TODO item (null quando a minha tela nao tinha o plano) => o Salvar de uma
// pessoa apagava/sobrescrevia o plano de rolos da outra. Agora o plano de cada item segue a regra 3-vias dos demais campos por item.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mesclarParaRetryP0409 } from "@/components/oc-tecido/retry-p0409";
import { mesclarRolosPlanejados, planoDeRolos, baseRolosSemAvancar } from "@/components/oc-tecido/merge-rolos";
import type { RoloEntry } from "@/components/oc-tecido/shared";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = readFileSync(ROOT + "src/routes/_authenticated/entrada-saida.oc-tecido.tsx", "utf8");

type D = { observacoes_entrega: string };
type I = { id: string | null; quantidade_pedida: number; quantidade_recebida: number | null };
type Rolos = Record<string, RoloEntry[]>;

const r = (qtd: string, extra: Partial<RoloEntry> = {}): RoloEntry => ({ qtd, ...extra });

describe("mesclarRolosPlanejados (puro, 3 vias por item)", () => {
  it("o plano que EU fiz no item X e o servidor nao mexeu e PRESERVADO (servidor so mudou outro item)", () => {
    const base: Rolos = {};
    const live: Rolos = { X: [r("30"), r("20")] }; // eu planejei 2 rolos no item X
    const fresh: Rolos = { Y: [r("50")] }; // o outro salvou rolos no item Y; no X nao ha nada
    const m = mesclarRolosPlanejados({ base, live, fresh });
    expect(m.valor.X).toEqual([r("30"), r("20")]); // meus rolos: preservados
    expect(m.valor.Y).toEqual([r("50")]); // os do outro (que eu nao toquei) chegam — o Salvar nao os apaga mais
    expect(m.conflitos).toEqual([]);
    expect(m.atualizados).toEqual(["Y"]);
  });

  it("servidor mudou o item e eu nao toquei: adota o do servidor (inclusive quando ele LIMPOU o plano)", () => {
    const base: Rolos = { X: [r("30")], Z: [r("10")] };
    const live: Rolos = { X: [r("30")], Z: [r("10")] };
    const fresh: Rolos = { X: [r("30"), r("25")] }; // Z foi limpo pelo outro
    const m = mesclarRolosPlanejados({ base, live, fresh });
    expect(m.valor.X).toEqual([r("30"), r("25")]);
    expect(m.valor.Z).toBeUndefined();
    expect(m.conflitos).toEqual([]);
  });

  it("eu removi o meu plano e o servidor nao mexeu: segue removido (nao ressuscita)", () => {
    const base: Rolos = { X: [r("30")] };
    const live: Rolos = { X: [r("")] }; // linha em branco = sem plano
    const m = mesclarRolosPlanejados({ base, live, fresh: { X: [r("30")] } });
    expect(planoDeRolos(m.valor.X)).toEqual([]);
    expect(m.conflitos).toEqual([]);
  });

  it("os dois mexeram no MESMO item de forma diferente: conflito 'rolos:<item>' e fica o meu (nao sobrescreve calado)", () => {
    const base: Rolos = { X: [r("30")] };
    const live: Rolos = { X: [r("30"), r("20")] };
    const fresh: Rolos = { X: [r("60")] };
    const m = mesclarRolosPlanejados({ base, live, fresh });
    expect(m.conflitos).toEqual([{ path: "rolos:X", meu: [r("30"), r("20")], dele: [r("60")] }]);
    expect(m.valor.X).toEqual([r("30"), r("20")]);
  });

  it("os dois chegaram ao MESMO plano: sem conflito", () => {
    const base: Rolos = { X: [r("30")] };
    const m = mesclarRolosPlanejados({ base, live: { X: [r("40")] }, fresh: { X: [r("40")] } });
    expect(m.conflitos).toEqual([]);
  });

  it("compara o plano pela projecao salva (qtd '30,0' = 30; ruido de UI como linha em branco nao e edicao)", () => {
    expect(planoDeRolos([r("30,0"), r(""), r("0")])).toEqual([{ qtd: 30, obs: null, cq_ok: false, cq_alerta: false }]);
    const m = mesclarRolosPlanejados({ base: { X: [r("30")] }, live: { X: [r("30"), r("")] }, fresh: { X: [r("30"), r("5")] } });
    expect(m.valor.X).toEqual([r("30"), r("5")]); // eu nao mexi de verdade -> adota o do servidor
  });

  it("TRANSICAO plano -> rolo real por OUTRA pessoa (recebeu a OC): adota o servidor, nao mantem o plano velho (evita rolo duplicado)", () => {
    const real: RoloEntry = r("40", { roloId: "r1", roloItemId: "ri1" });
    const plano = [r("40")];
    const m = mesclarRolosPlanejados({ base: { X: plano }, live: { X: plano }, fresh: { X: [real] } });
    expect(m.valor.X).toEqual([real]);
    expect(m.atualizados).toEqual(["X"]);
    // mesmo se eu tinha editado o plano: o recebimento consumiu o plano, nada do plano velho segue para o Salvar
    const m2 = mesclarRolosPlanejados({ base: { X: plano }, live: { X: [r("45")] }, fresh: { X: [real] } });
    expect(m2.valor.X).toEqual([real]);
    expect((m2.valor.X ?? []).every((e) => !!e.roloId)).toBe(true);
  });

  it("TRANSICAO inversa (outra pessoa desmarcou o recebimento): eu tinha rolo real, o servidor volta ao plano -> adota o servidor", () => {
    const real: RoloEntry = r("40", { roloId: "r1", roloItemId: "ri1" });
    const m = mesclarRolosPlanejados({ base: { X: [real] }, live: { X: [real] }, fresh: { X: [r("40")] } });
    expect(m.valor.X).toEqual([r("40")]);
    const semPlano = mesclarRolosPlanejados({ base: { X: [real] }, live: { X: [real] }, fresh: {} });
    expect(semPlano.valor.X).toBeUndefined();
  });

  it("rolo ja criado dos DOIS lados (OC recebida): fica FORA deste merge, o estado local nao e tocado", () => {
    const real: RoloEntry = r("40", { roloId: "r1", roloItemId: "ri1" });
    const m = mesclarRolosPlanejados({ base: { X: [real] }, live: { X: [real] }, fresh: { X: [{ ...real, qtd: "45" }] } });
    expect(m.valor.X).toEqual([real]);
    expect(m.conflitos).toEqual([]);
    expect(m.atualizados).toEqual([]);
  });

  it("baseRolosSemAvancar: o item em conflito mantem a base antiga; os demais avancam para o servidor", () => {
    const b = baseRolosSemAvancar({ X: [r("30")], Y: [r("1")] }, { X: [r("60")], Y: [r("2")] }, [{ path: "rolos:X", meu: null, dele: null }]);
    expect(b).toEqual({ X: [r("30")], Y: [r("2")] });
  });
});

describe("mesclarParaRetryP0409 leva os rolos planejados junto (mesmo merge do retry do P0409)", () => {
  const base = { draft: { observacoes_entrega: "" } as D, items: [{ id: "X", quantidade_pedida: 50, quantidade_recebida: null }, { id: "Y", quantidade_pedida: 50, quantidade_recebida: null }] as I[] };
  // eu: planejei rolos no X (a soma vira quantidade_recebida do item) e mudei a observacao
  const live = { draft: { observacoes_entrega: "meu texto" } as D, items: [{ id: "X", quantidade_pedida: 50, quantidade_recebida: 50 }, { id: "Y", quantidade_pedida: 50, quantidade_recebida: null }] as I[] };
  // o outro: planejou rolos no Y
  const fresh = { draft: { observacoes_entrega: "" } as D, items: [{ id: "X", quantidade_pedida: 50, quantidade_recebida: null }, { id: "Y", quantidade_pedida: 50, quantidade_recebida: 70 }] as I[], status: "encomendado" as const };
  const out = mesclarParaRetryP0409({
    base, live, fresh, touched: new Set(["observacoes_entrega"]), touchedIds: new Set(["X"]),
    rolos: { base: {}, live: { X: [r("30"), r("20")] }, fresh: { Y: [r("70")] } },
  });

  it("o retry manda os MEUS rolos do X e os do OUTRO no Y (nenhum e apagado)", () => {
    expect(out.rolos?.valor).toEqual({ X: [r("30"), r("20")], Y: [r("70")] });
    expect(out.mudouRolos).toBe(true);
    expect(out.conflitos).toEqual([]);
  });
  it("o merge de campos/itens segue igual", () => {
    expect(out.estado.draft.observacoes_entrega).toBe("meu texto");
    expect(out.estado.items).toEqual([{ id: "X", quantidade_pedida: 50, quantidade_recebida: 50 }, { id: "Y", quantidade_pedida: 50, quantidade_recebida: 70 }]);
  });
  it("sem `rolos` na chamada o comportamento e o de antes (aditivo)", () => {
    const sem = mesclarParaRetryP0409({ base, live, fresh, touched: new Set(["observacoes_entrega"]), touchedIds: new Set(["X"]) });
    expect(sem.rolos).toBeNull();
    expect(sem.mudouRolos).toBe(false);
  });
  it("conflito de rolos entra na lista de conflitos do retry (trava o Salvar)", () => {
    const c = mesclarParaRetryP0409({
      base, live, fresh, touched: new Set(), touchedIds: new Set(),
      rolos: { base: { X: [r("10")] }, live: { X: [r("30")] }, fresh: { X: [r("60")] } },
    });
    expect(c.conflitos.map((x) => x.path)).toEqual(["rolos:X"]);
  });
});

describe("OC Tecido (fonte): a rota usa o merge dos rolos planejados", () => {
  const ini = SRC.indexOf("const saveMutation = useMutation({");
  const mutationFn = SRC.slice(ini, SRC.indexOf("onSuccess: () => {", ini));
  const onError = SRC.slice(SRC.indexOf("onError: async (e: any, markReceived) => {", ini), SRC.indexOf("const unmarkReceivedMut", ini));
  const efeito = SRC.slice(SRC.indexOf("// Colab (spec 2026-08-03): 1ª carga semeia"), SRC.indexOf("const { data: artigos = [] }"));

  it("o mutationFn le os rolos do ref ao vivo (nunca a closure do clique): o retry manda o plano mesclado", () => {
    expect(mutationFn).toContain("const rolosPorItem = rolosLiveRef.current;");
    expect(mutationFn.indexOf("const rolosPorItem = rolosLiveRef.current;")).toBeLessThan(mutationFn.indexOf("rolos_planejados:"));
  });
  it("o refetch (Realtime/foco) mescla os rolos com a base propria", () => {
    expect(efeito).toContain("mesclarRolosPlanejados({");
    expect(efeito).toContain("baseRolosRef");
  });
  it("o retry do P0409 passa os rolos ao merge e grava o resultado no ref ANTES do retry", () => {
    expect(onError).toContain("rolos: {");
    expect(onError.indexOf("rolosLiveRef.current = ")).toBeGreaterThan(-1);
    expect(onError.indexOf("rolosLiveRef.current = ")).toBeLessThan(onError.indexOf("saveMutation.mutate(markReceived"));
  });
  it("o conflito 'rolos:' tem rotulo e resolucao (manter meu / usar o novo)", () => {
    expect(SRC).toContain('path.startsWith("rolos:")');
  });
});
