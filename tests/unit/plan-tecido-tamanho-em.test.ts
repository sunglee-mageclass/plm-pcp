// @vitest-environment happy-dom
// "Tamanho em" nos cards do Plan. Tecido — Tarefa 4 do plano `.superpowers/sdd/2026-09-29-tamanho-em/plan.md`.
// Cobre: `marcarTamanhoTocado` (payload do Salvar; ruling #1 do G-plano — slot de card travado FICA no payload, sem a
// marca, e volta ao valor do modelo), o merge do engine (`tamanho_tipo` com card = modelo; sem card = vaga) e
// `savedTemDados` (ressalva #2 — vaga só com o "Tamanho em" não perde a escolha), e o GradeSection (ressalva #3 — o
// filtro de exibição nunca reduz o que é gravado; chave legada do par invertido).
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { marcarTamanhoTocado, textoTamanhoRevertido } from "@/lib/plan-tecido/tamanho-tocado";
import { mergeArvore, savedTemDados, semearArvore, semearComModelos, type ModeloReal } from "@/lib/plan-tecido/engine";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const propModelo = vi.hoisted(() => ({ current: null as Record<string, number> | null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { proporcoes: propModelo.current }, error: null }) }) }) }),
  },
}));

const ler = (p: string) => readFileSync(p, "utf8");

function slot(o: Partial<PtSlot> & { id: string }): PtSlot {
  return { modelo_id: null, materiais: [], ...o };
}
function arv(slots: PtSlot[]): PtArvore {
  return { colecao_id: "c", subcolecoes: [{ subcolecao_id: "s1", ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }] };
}
const slotsDe = (a: PtArvore) => a.subcolecoes[0].linhas[0].slots as (PtSlot & { tamanho_tipo_tocado?: true })[];

describe("marcarTamanhoTocado (payload do Salvar do Plan. Tecido)", () => {
  const materiais = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }];
  const base = arv([
    slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra", nome: "Blusa" }),
    slot({ id: "s2", modelo_id: "m2", tamanho_tipo: "letra", nome: "Saia" }),
    slot({ id: "s3", modelo_id: null, tamanho_tipo: null }),
  ]);

  it("card com valor diferente da base leva tamanho_tipo_tocado; card igual e vaga não", () => {
    const draft = arv([
      slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero", nome: "Blusa" }),
      slot({ id: "s2", modelo_id: "m2", tamanho_tipo: "letra", nome: "Saia" }),
      slot({ id: "s3", modelo_id: null, tamanho_tipo: "numero" }),
    ]);
    const r = marcarTamanhoTocado(draft, base);
    const p = slotsDe(r.arvore);
    expect(p[0]).toMatchObject({ tamanho_tipo: "numero", tamanho_tipo_tocado: true });
    expect(p[1].tamanho_tipo_tocado).toBeUndefined();
    expect(p[1]).toBe(slotsDe(draft)[1]); // sem mudança = mesma referência
    expect(p[2]).toMatchObject({ tamanho_tipo: "numero" }); // vaga: o valor vai como está (P-119 A)
    expect(p[2].tamanho_tipo_tocado).toBeUndefined();
    expect(r.tocados).toEqual(["m1"]);
    expect(r.revertidos).toEqual([]);
    // a marca NUNCA entra no estado local
    expect(slotsDe(r.local).some((s) => "tamanho_tipo_tocado" in s)).toBe(false);
    // não muta a entrada
    expect(slotsDe(draft)[0]).not.toHaveProperty("tamanho_tipo_tocado");
  });

  it("ruling #1: card TRAVADO continua no payload (materiais intactos), SEM a marca, com o valor do modelo", () => {
    const draft = arv([
      slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero", nome: "Blusa", materiais }),
      slot({ id: "s2", modelo_id: "m2", tamanho_tipo: "numero", nome: "Saia" }),
    ]);
    const r = marcarTamanhoTocado(draft, base, (mid) => mid === "m1");
    const p = slotsDe(r.arvore);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra", materiais });
    expect(p[0].tamanho_tipo_tocado).toBeUndefined();
    expect(p[1]).toMatchObject({ modelo_id: "m2", tamanho_tipo: "numero", tamanho_tipo_tocado: true });
    expect(r.tocados).toEqual(["m2"]);
    expect(r.revertidos).toEqual([{ modeloId: "m1", nome: "Blusa" }]);
    // o rascunho local também volta ao valor do modelo (sem marca)
    expect(slotsDe(r.local)[0]).toMatchObject({ tamanho_tipo: "letra", materiais });
    expect(slotsDe(r.local)[1]).toMatchObject({ tamanho_tipo: "numero" });
    expect(slotsDe(r.local)[1]).not.toHaveProperty("tamanho_tipo_tocado");
  });

  it("card travado NÃO tocado: nada a reverter nem avisar (toast só se a pessoa mexeu)", () => {
    const r = marcarTamanhoTocado(base, base, () => true);
    expect(r.revertidos).toEqual([]);
    expect(r.tocados).toEqual([]);
  });

  it("sem base, card fora da base ou valor nulo no rascunho ⇒ nunca marca (o servidor recusaria null com P0001)", () => {
    const draft = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero" })]);
    expect(marcarTamanhoTocado(draft, null).tocados).toEqual([]);
    expect(marcarTamanhoTocado(arv([slot({ id: "s9", modelo_id: "m9", tamanho_tipo: "numero" })]), base).tocados).toEqual([]);
    expect(marcarTamanhoTocado(arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: null })]), base).tocados).toEqual([]);
  });

  it("modelo legado com NULL: escolher Letra/Número conta como tocado", () => {
    const b = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: null })]);
    const r = marcarTamanhoTocado(arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra" })]), b);
    expect(r.tocados).toEqual(["m1"]);
  });

  it("texto do toast (PT, só com os nomes revertidos)", () => {
    expect(textoTamanhoRevertido([{ nome: "Blusa" }])).toBe('O "Tamanho em" de Blusa foi travado pela Integração enquanto você editava — essa alteração não foi salva.');
    expect(textoTamanhoRevertido([{ nome: "A" }, { nome: "B" }, { nome: "C" }])).toContain("de A, B e C foi travado");
  });
});

describe("engine: merge do tamanho_tipo + savedTemDados (ressalva #2)", () => {
  const modelo = (tt: "letra" | "numero" | null): ModeloReal => ({
    id: "m1", ref: "R", nome: "Vestido", subcolecao: null, subcolecao_id: "s1", linha_id: null, categoria_id: null,
    proporcoes: null, materiais: [], grade: {}, tamanho_tipo: tt,
  });
  const buckets = [{ subcolecao_id: "s1", linha_id: null, categoria_id: null, qtd: 2 }];

  it("vaga cujo ÚNICO dado é o 'Tamanho em' conta como dado salvo (não volta ao slot semeado ao reabrir)", () => {
    expect(savedTemDados(slot({ id: "x", tamanho_tipo: "numero" }))).toBe(true);
    expect(savedTemDados(slot({ id: "x", tamanho_tipo: null }))).toBe(false);
    const seed = semearArvore({ colecao_id: "c", tipo: "orcamento", buckets });
    const salvo = arv([slot({ id: "v1", slot_index: 0, tamanho_tipo: "numero" }), slot({ id: "v2", slot_index: 1 })]);
    const m = slotsDe(mergeArvore(seed, salvo));
    expect(m[0]).toMatchObject({ id: "v1", tamanho_tipo: "numero" });
    expect(m[1].tamanho_tipo ?? null).toBeNull();
  });

  it("com card, o valor do MODELO (seed) vence o salvo; sem card, o da vaga", () => {
    const seed = semearComModelos({ colecao_id: "c", tipo: "orcamento", buckets, modelos: [modelo("numero")] });
    const salvo = arv([
      slot({ id: "c1", slot_index: 0, modelo_id: "m1", tamanho_tipo: "letra" }),
      slot({ id: "v1", slot_index: 1, tamanho_tipo: "numero" }),
    ]);
    const m = slotsDe(mergeArvore(seed, salvo));
    const card = m.find((s) => s.modelo_id === "m1")!;
    const vaga = m.find((s) => !s.modelo_id)!;
    expect(card.tamanho_tipo).toBe("numero");
    expect(vaga.tamanho_tipo).toBe("numero");
  });

  it("com card de modelo legado NULL no seed, cai no salvo (não inventa valor)", () => {
    const seed = semearComModelos({ colecao_id: "c", tipo: "orcamento", buckets, modelos: [modelo(null)] });
    const salvo = arv([slot({ id: "c1", slot_index: 0, modelo_id: "m1", tamanho_tipo: "letra" })]);
    expect(slotsDe(mergeArvore(seed, salvo)).find((s) => s.modelo_id === "m1")!.tamanho_tipo).toBe("letra");
  });
});

// ─── GradeSection (ressalva #3) — render real ──────────────────────────────────────────────────────────────
function montar(el: ReturnType<typeof createElement>): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}
async function montarGrade(s: PtSlot, tamanhos: string[], onChange: (s: PtSlot) => void) {
  const { GradeSection } = await import("@/components/plan-tecido/GradeSection");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(GradeSection, { slot: s, onChange, tamanhos })));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return view;
}
const rotulos = (c: HTMLElement) => [...c.querySelectorAll("span")].map((x) => x.textContent);

describe("GradeSection: filtro do 'Tamanho em' só de exibição (ressalva #3)", () => {
  it("par mostra o lado escolhido; em Número o rótulo vira o número", async () => {
    propModelo.current = null;
    const grade = ["34|PPP", "36|PP", "38|P"];
    const a = await montarGrade(slot({ id: "s", tamanho_tipo: "letra" }), grade, () => {});
    expect(rotulos(a.container)).toEqual(["PPP", "PP", "P"]);
    a.unmount();
    const b = await montarGrade(slot({ id: "s", tamanho_tipo: "numero" }), grade, () => {});
    expect(rotulos(b.container)).toEqual(["34", "36", "38"]);
    b.unmount();
  });

  it("solto do outro lado: escondido sem valor, esmaecido com valor — e editar outra célula CONGELA todas as chaves (inclusive a oculta)", async () => {
    propModelo.current = null;
    const grade = ["PP", "P", "36", "38"]; // Ark: soltos dos dois lados
    let salvo: PtSlot | null = null;
    const s = slot({ id: "s", tamanho_tipo: "letra", proporcoes: { PP: 1, P: 2, "36": 3, "38": 0 } });
    const v = await montarGrade(s, grade, (n) => { salvo = n; });
    expect(rotulos(v.container)).toEqual(["PP", "P", "36"]); // 38 (sem valor) oculto; 36 (com valor) resgatado
    const cel36 = [...v.container.querySelectorAll("div")].find((d) => d.querySelector("span")?.textContent === "36" && d.className.includes("rounded"))!;
    expect(cel36.className).toContain("opacity-50");
    const input = v.container.querySelector("input")! as HTMLInputElement; // PP
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "5"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(salvo).not.toBeNull();
    expect(salvo!.proporcoes).toEqual({ PP: 5, P: 2, "36": 3, "38": 0 });
    v.unmount();
  });

  it("chave LEGADA só-letra do modelo resolve também no par invertido 'PPP|34' (antes caía no lado número)", async () => {
    propModelo.current = { PPP: 4 };
    const v = await montarGrade(slot({ id: "s", modelo_id: "m1", tamanho_tipo: "letra" }), ["PPP|34", "36|PP"], () => {});
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const inputs = [...v.container.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs[0].value).toBe("4");
    expect(rotulos(v.container)).toEqual(["PPP", "PP"]);
    v.unmount();
  });
});

describe("fonte: fiação do Plan. Tecido", () => {
  it("Sheet marca/omite no payload, trata 42501 e manda o 'Tamanho em' no criar card", () => {
    const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect(sheet).toContain('const marca = marcarTamanhoTocado(arvore!, planBaseRef.current, (mid) => colunasTravadas(estadosIntegracao[mid]).has("tamanho_tipo"));');
    expect(sheet).toContain("const arvorePayload = normalizarCategoriasAuto(marca.arvore,");
    expect(sheet).toContain("invalidarEstadoSeTravado(qc, e);");
    expect(sheet).toContain("tamanho_tipo: slot.tamanho_tipo ?? null,");
    expect(sheet).toContain("planBaseRef.current = arvoreSalvaRef.current ?? arvore;");
    // eco do save: a árvore salva chega ANTES dos modelos com o "Tamanho em" novo (lição N1 — senão re-semeia velho)
    const inv = sheet.slice(sheet.indexOf("const invalidarTamanhoNoModelo = async"));
    expect(inv.indexOf('await qc.refetchQueries({ queryKey: ["plan-tecido-arvore", colecaoId] }, { cancelRefetch: false });'))
      .toBeLessThan(inv.indexOf('qc.setQueryData<any[]>(["plan-tecido-modelos", colecaoId]'));
    expect(inv.indexOf('qc.setQueryData<any[]>(["plan-tecido-modelos", colecaoId]')).toBeGreaterThan(0);
  });
  it("card: toggle só na faixa do interno/vaga, trava só por página/Integração; Limpar slot zera", () => {
    const card = ler("src/components/plan-tecido/ModelCard.tsx");
    expect(card).toContain("disabled={paginaSoLeitura || tamanhoTravado}");
    expect(card).toContain('const tamanhoTravado = travaIntegracao.has("tamanho_tipo");');
    expect(card).toContain("usar_estoque: slot.usar_estoque, materiais: [], tamanho_tipo: null,");
    // dentro do bloco `!isComprado` da "Proporção por tamanho", sem gate de travado (Explosão) nem lancado
    const faixa = card.slice(card.indexOf("Proporção por tamanho</div>"), card.indexOf("<GradeSection"));
    expect(faixa).toContain("<TamanhoEmToggle");
    expect(faixa).not.toMatch(/disabled=\{[^}]*\b(travado|lancado)\b/);
  });
});
