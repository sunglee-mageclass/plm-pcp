// @vitest-environment happy-dom
// "CQ no Salvar da OC" (nov/2026, Task 3 — modo OC): a seção 5 (OcCqSection) é EDIÇÃO SOLTA. Editar CQ ok / Alertar estilo / observação
// só chama onCqChange(itemId, patch) — NENHUMA chamada de rede (nada grava na hora); o rascunho entra no Salvar da OC. Item em estado
// de resolução (estilo_ok/trocado/cancelado/troca_pendente) não oferece o toggle de forma a rebaixá-lo. Mais as funções puras do
// rascunho: `aplicarPatchCq` (tocado = difere do carregado) e `chavesCqDoPayload` (chave só quando tocado; nunca cq_alerta em resolvido).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Qualquer acesso à rede/banco FALHA o teste: o supabase é um espião que não deve ser tocado.
const rede = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), auth: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: rede }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, ...r }: any) => createElement("a", { href: to, ...r }, children),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeLinhas } from "@/lib/colab/merge";
import { mesclarParaRetryP0409 } from "@/components/oc-tecido/retry-p0409";
import {
  OcCqSection, aplicarPatchCq, chavesCqDoPayload, alertaAlternavel, semEfemeros, type OcCqLinha,
} from "@/components/oc-tecido/CqTecido";

let root: Root | null = null;
let el: HTMLElement;

const linha = (over: Partial<OcCqLinha> = {}): OcCqLinha => ({
  id: "it-1", artigo: "Linho", variante: "Azul", cq_ok: false, cq_alerta_status: "sem_alerta",
  cq_observacao: "", tocado: false, ...over,
});

async function montar(itens: OcCqLinha[]) {
  const onCqChange = vi.fn();
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(OcCqSection, { itens, onCqChange })); });
  // os cartões nascem colapsados: abre todos
  await act(async () => { el.querySelectorAll<HTMLButtonElement>("button[aria-expanded]").forEach((b) => b.click()); });
  return onCqChange;
}
const interruptor = (rotulo: string) =>
  Array.from(el.querySelectorAll("label")).find((l) => l.textContent?.includes(rotulo))!.querySelector('button[role="switch"]') as HTMLButtonElement;
function digitar(ta: HTMLTextAreaElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  set.call(ta, valor);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => { Object.values(rede).forEach((f) => f.mockReset()); });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  el?.remove();
});

describe("OcCqSection — edição solta (nada grava na hora)", () => {
  it("CQ ok, Alertar estilo e observação chamam onCqChange com o patch certo e NENHUMA chamada de rede", async () => {
    const onCqChange = await montar([linha()]);

    await act(async () => { interruptor("CQ ok").click(); });
    expect(onCqChange).toHaveBeenLastCalledWith("it-1", { cq_ok: true });

    await act(async () => { interruptor("Alertar estilo").click(); });
    expect(onCqChange).toHaveBeenLastCalledWith("it-1", { cq_alerta: true });

    await act(async () => { digitar(el.querySelector("textarea")!, "manchado na ourela"); });
    expect(onCqChange).toHaveBeenLastCalledWith("it-1", { cq_observacao: "manchado na ourela" });

    // tirar o foco da observação (onBlur) NÃO grava mais nada: só os 3 onCqChange
    await act(async () => { el.querySelector("textarea")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(onCqChange).toHaveBeenCalledTimes(3);

    expect(rede.from).not.toHaveBeenCalled();
    expect(rede.rpc).not.toHaveBeenCalled();
    expect(rede.channel).not.toHaveBeenCalled();
  });

  it("alerta ligado: desligar manda cq_alerta:false; o link para os Alertas de Tecido continua", async () => {
    const onCqChange = await montar([linha({ cq_alerta_status: "alertado" })]);
    expect(interruptor("Alertar estilo").getAttribute("aria-checked")).toBe("true");
    expect(el.textContent).toContain("Resolver nos Alertas de Tecido");
    await act(async () => { interruptor("Alertar estilo").click(); });
    expect(onCqChange).toHaveBeenLastCalledWith("it-1", { cq_alerta: false });
    expect(rede.from).not.toHaveBeenCalled();
  });

  it("item já resolvido ou em troca: o toggle Alertar fica desabilitado (não rebaixa) e o clique não chama nada", async () => {
    for (const st of ["estilo_ok", "trocado", "cancelado", "troca_pendente"] as const) {
      const onCqChange = await montar([linha({ cq_alerta_status: st })]);
      const sw = interruptor("Alertar estilo");
      expect(sw.disabled, st).toBe(true);
      expect(sw.getAttribute("aria-checked"), st).toBe("true"); // segue mostrando que há alerta/resolução
      expect(el.textContent, st).toContain("Resolver nos Alertas de Tecido");
      await act(async () => { sw.click(); });
      expect(onCqChange, st).not.toHaveBeenCalled();
      await act(async () => { root!.unmount(); });
      el.remove();
    }
    expect(rede.from).not.toHaveBeenCalled();
  });

  it("selo 'alterações não salvas' (UnsavedIndicator) só no item tocado e no título da seção", async () => {
    await montar([linha({ id: "a" }), linha({ id: "b", tocado: true })]);
    const selos = Array.from(el.querySelectorAll("span")).filter((s) => s.textContent === "alterações não salvas");
    expect(selos.length).toBe(2); // 1 no cabeçalho da seção + 1 no item tocado
    await act(async () => { root!.unmount(); });
    el.remove();
    await montar([linha()]);
    expect(el.textContent).not.toContain("alterações não salvas");
  });

  it("aviso de conflito pendente aparece no item", async () => {
    await montar([linha({ emConflito: true })]);
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Resolva o conflito");
  });

  it("sem itens a seção não aparece", async () => {
    await montar([]);
    expect(el.textContent).toBe("");
  });
});

describe("rascunho do CQ — aplicarPatchCq / chavesCqDoPayload", () => {
  const base = { cq_ok: false, cq_alerta_status: "sem_alerta", cq_observacao: "" };

  it("editar marca tocado; voltar ao carregado desmarca (a chave some do objeto)", () => {
    const a = aplicarPatchCq({ ...base }, { cq_ok: true }, base);
    expect(a.cq_ok).toBe(true);
    expect(a.cq_tocado).toBe(true);
    const b = aplicarPatchCq(a, { cq_ok: false }, base);
    expect("cq_tocado" in b).toBe(false);
    // observação: null/"" do servidor ≈ vazio
    const c = aplicarPatchCq({ ...base }, { cq_observacao: "x" }, base);
    expect(c.cq_tocado).toBe(true);
    expect("cq_tocado" in aplicarPatchCq(c, { cq_observacao: "" }, base)).toBe(false);
  });

  it("sem base (item sem linha carregada) conta como tocado", () => {
    expect(aplicarPatchCq({ ...base }, { cq_ok: true }, undefined).cq_tocado).toBe(true);
  });

  it("alertar alterna sem_alerta <-> alertado; estado de resolução NÃO é alterado pelo patch", () => {
    expect(aplicarPatchCq({ ...base }, { cq_alerta: true }, base).cq_alerta_status).toBe("alertado");
    const alertado = { ...base, cq_alerta_status: "alertado" };
    expect(aplicarPatchCq(alertado, { cq_alerta: false }, alertado).cq_alerta_status).toBe("sem_alerta");
    for (const st of ["estilo_ok", "trocado", "cancelado", "troca_pendente"]) {
      const it = { ...base, cq_alerta_status: st };
      expect(aplicarPatchCq(it, { cq_alerta: false }, it).cq_alerta_status, st).toBe(st);
      expect(aplicarPatchCq(it, { cq_alerta: true }, it).cq_alerta_status, st).toBe(st);
      expect(alertaAlternavel(st), st).toBe(false);
    }
    expect(alertaAlternavel("sem_alerta") && alertaAlternavel("alertado") && alertaAlternavel(undefined)).toBe(true);
  });

  it("payload: item NÃO tocado não leva chave cq_* (o banco mantém)", () => {
    expect(chavesCqDoPayload({ ...base, cq_ok: true })).toEqual({});
    expect(chavesCqDoPayload({})).toEqual({});
  });

  it("payload: item tocado leva cq_ok, cq_alerta (boolean) e cq_observacao ('' quando vazia)", () => {
    expect(chavesCqDoPayload({ cq_ok: true, cq_alerta_status: "alertado", cq_observacao: "ruim", cq_tocado: true }))
      .toEqual({ cq_ok: true, cq_alerta: true, cq_observacao: "ruim" });
    expect(chavesCqDoPayload({ cq_ok: false, cq_alerta_status: "sem_alerta", cq_observacao: "", cq_tocado: true }))
      .toEqual({ cq_ok: false, cq_alerta: false, cq_observacao: "" });
    expect(chavesCqDoPayload({ cq_tocado: true })).toEqual({ cq_ok: false, cq_alerta: false, cq_observacao: "" });
  });

  it("payload: item em estado de resolução tocado (ex.: só a observação) NUNCA manda cq_alerta", () => {
    for (const st of ["estilo_ok", "trocado", "cancelado", "troca_pendente"]) {
      const k = chavesCqDoPayload({ cq_ok: true, cq_alerta_status: st, cq_observacao: "obs", cq_tocado: true });
      expect(k, st).toEqual({ cq_ok: true, cq_observacao: "obs" });
      expect("cq_alerta" in k, st).toBe(false);
    }
  });
});

// Falso "Alguém salvou agora": o merge compara a LINHA pela UNIÃO de chaves, e `cq_tocado` (efêmero de UI) só existe no rascunho. O
// `comparavel: semEfemeros` tira `cq_tocado`/`tempId` da comparação nos 3 lados — mas cq_ok/cq_alerta_status/cq_observacao CONTINUAM nela.
describe("merge colaborativo com CQ no item — sem falso aviso (semEfemeros)", () => {
  const row = (id: string, o: Record<string, unknown> = {}) => ({
    tempId: id, id, preco: 10, cq_ok: false, cq_alerta_status: "sem_alerta", cq_observacao: "", ...o,
  });
  const merge = (base: any[], draft: any[], fresh: any[], tocados: string[]) =>
    mergeLinhas({ base, draft, fresh, touchedIds: new Set(tocados), removidasIds: new Set(tocados), comparavel: semEfemeros });

  it("(a) seed -> edito o CQ (liga Alertar e CQ ok) -> refetch com o servidor INTACTO: nenhum 'atualizado', nenhum conflito", () => {
    const base = [row("i1"), row("i2")];
    let d1: any = aplicarPatchCq(row("i1"), { cq_alerta: true }, base[0]);
    d1 = aplicarPatchCq(d1, { cq_ok: true }, base[0]);
    expect(d1.cq_tocado).toBe(true);
    const r = merge(base, [d1, row("i2")], [row("i1"), row("i2")], ["i1"]);
    expect(r.atualizadas).toEqual([]);
    expect(r.conflitos).toEqual([]);
    expect(r.linhas[0]).toBe(d1); // o rascunho (com cq_tocado) é o que fica — a projeção só vale na comparação
  });

  it("(a2) o servidor chegou nos MESMOS valores que eu digitei: não é conflito (cq_tocado não conta como diferença)", () => {
    const base = [row("i1")];
    const d1: any = aplicarPatchCq(row("i1"), { cq_ok: true }, base[0]);
    const fresh = [row("i1", { cq_ok: true })];
    expect(merge(base, [d1], fresh, ["i1"]).conflitos).toEqual([]);
    // sem a projeção, a chave só-do-rascunho acusaria um conflito falso
    expect(mergeLinhas({ base, draft: [d1], fresh, touchedIds: new Set(["i1"]) }).conflitos.length).toBe(1);
  });

  it("(b) o servidor MUDOU o cq_* do item que eu também toquei: vira conflito de LINHA (não 'atualizado' calado)", () => {
    const base = [row("i1")];
    const d1: any = aplicarPatchCq(row("i1"), { cq_observacao: "minha" }, base[0]);
    const fresh = [row("i1", { cq_observacao: "dele", cq_alerta_status: "alertado" })];
    const r = merge(base, [d1], fresh, ["i1"]);
    expect(r.atualizadas).toEqual([]);
    expect(r.conflitos.map((c) => c.path)).toEqual(["linha:i1"]);
    expect((r.conflitos[0].meu as any).cq_observacao).toBe("minha");
    expect((r.conflitos[0].dele as any).cq_observacao).toBe("dele");
    expect(r.linhas[0]).toBe(d1); // o meu fica até eu resolver
  });

  it("(c) o servidor mudou o cq_* de um item que eu NÃO toquei: 'atualizado' legítimo (o aviso real continua)", () => {
    const base = [row("i1"), row("i2")];
    const d1: any = aplicarPatchCq(row("i1"), { cq_ok: true }, base[0]);
    const fresh = [row("i1"), row("i2", { cq_alerta_status: "estilo_ok", cq_ok: true })];
    const r = merge(base, [d1, row("i2")], fresh, ["i1"]);
    expect(r.atualizadas).toEqual(["i2"]);
    expect(r.conflitos).toEqual([]);
    expect(r.linhas[1]).toEqual(fresh[1]);
    expect(r.linhas[0]).toBe(d1);
  });

  it("o retry do P0409 usa a mesma projeção: servidor intacto nos meus valores = sem conflito", () => {
    const base = [row("i1")];
    const d1: any = aplicarPatchCq(row("i1"), { cq_ok: true }, base[0]);
    const fresh = [row("i1", { cq_ok: true })];
    const dr = { x: 1 };
    const com = mesclarParaRetryP0409({ base: { draft: dr, items: base }, live: { draft: dr, items: [d1] }, fresh: { draft: dr, items: fresh, status: "recebido" }, touched: new Set(), touchedIds: new Set(["i1"]), comparavel: semEfemeros });
    expect(com.conflitos).toEqual([]);
    const sem = mesclarParaRetryP0409({ base: { draft: dr, items: base }, live: { draft: dr, items: [d1] }, fresh: { draft: dr, items: fresh, status: "recebido" }, touched: new Set(), touchedIds: new Set(["i1"]) });
    expect(sem.conflitos.length).toBe(1);
  });

  it("semEfemeros tira SÓ cq_tocado e tempId", () => {
    expect(semEfemeros({ tempId: "t", id: "i", cq_ok: true, cq_alerta_status: "alertado", cq_observacao: "o", cq_tocado: true }))
      .toEqual({ id: "i", cq_ok: true, cq_alerta_status: "alertado", cq_observacao: "o" });
  });

  it("a tela passa `comparavel: semEfemeros` nos DOIS merges de itens (efeito de refetch e retry do P0409)", () => {
    const SRC = readFileSync(join(process.cwd(), "src/routes/_authenticated/entrada-saida.oc-tecido.tsx"), "utf8");
    expect(SRC.match(/comparavel: semEfemeros/g)?.length).toBe(2);
    expect(SRC).toMatch(/mergeLinhas\(\{[^}]*comparavel: semEfemeros/);
  });
});
