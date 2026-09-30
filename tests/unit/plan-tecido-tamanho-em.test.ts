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
import { marcarTamanhoTocado, slotDaBase, soTamanhoMudou, textoTamanhoRevertido } from "@/lib/plan-tecido/tamanho-tocado";
import { igual } from "@/lib/plan-tecido/atendimento";
import { mergeArvorePorSlot } from "@/lib/plan-tecido/colab-merge-arvore";
import { normalizarDistribuicao, recalcularLinha, totaisDaDistribuicao, definirCelula, tamanhosDoTipo } from "@/lib/distribuicao-produto";
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
    const r = marcarTamanhoTocado(draft, base, { travado: (mid) => mid === "m1" });
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
    const r = marcarTamanhoTocado(base, base, { travado: () => true });
    expect(r.revertidos).toEqual([]);
    expect(r.tocados).toEqual([]);
  });

  it("sem base, card sem correspondente na base (nem id nem modelo) ou valor nulo ⇒ nunca marca (null daria P0001)", () => {
    const draft = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero" })]);
    expect(marcarTamanhoTocado(draft, null).tocados).toEqual([]);
    expect(marcarTamanhoTocado(arv([slot({ id: "s9", modelo_id: "m9", tamanho_tipo: "numero" })]), base).tocados).toEqual([]);
    expect(marcarTamanhoTocado(arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: null })]), base).tocados).toEqual([]);
  });

  it("I-1: card recém-criado (a base ainda tem a VAGA com o mesmo id) — a busca por slot.id acha a vaga", () => {
    // vaga s3 em Número → "Criar cards" (base = a vaga salva, sem modelo_id) → troca p/ Letra → Salvar marca tocado
    const b = arv([slot({ id: "s3", modelo_id: null, tamanho_tipo: "numero" })]);
    const trocado = marcarTamanhoTocado(arv([slot({ id: "s3", modelo_id: "mNovo", tamanho_tipo: "letra" })]), b);
    expect(trocado.tocados).toEqual(["mNovo"]);
    expect(slotsDe(trocado.arvore)[0]).toMatchObject({ tamanho_tipo: "letra", tamanho_tipo_tocado: true });
    // sem trocar: o card nasceu com o valor da vaga (o servidor já gravou) ⇒ nada a marcar
    expect(marcarTamanhoTocado(arv([slot({ id: "s3", modelo_id: "mNovo", tamanho_tipo: "numero" })]), b).tocados).toEqual([]);
    // o id vence o modelo_id: slot s1 (base Letra) com modelo de outro slot da base (m2) compara com s1
    const b2 = arv([slot({ id: "s1", modelo_id: null, tamanho_tipo: "letra" }), slot({ id: "s2", modelo_id: "m2", tamanho_tipo: "numero" })]);
    expect(marcarTamanhoTocado(arv([slot({ id: "s1", modelo_id: "m2", tamanho_tipo: "numero" })]), b2).tocados).toEqual(["m2"]);
  });

  it("I-2: só slots TOCADOS são marcados — retry do P0409 com rascunho velho não sobrescreve a troca de outra tela", () => {
    // outra tela trocou m1 p/ Número: a base NOVA (fresca) tem Número; meu rascunho (não toquei m1) ainda tem Letra
    const fresca = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero" }), slot({ id: "s2", modelo_id: "m2", tamanho_tipo: "letra" })]);
    const rascunho = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra" }), slot({ id: "s2", modelo_id: "m2", tamanho_tipo: "numero" })]);
    const r = marcarTamanhoTocado(rascunho, fresca, { touchedIds: new Set(["s2"]) });
    expect(r.tocados).toEqual(["m2"]);
    expect(slotsDe(r.arvore)[0].tamanho_tipo_tocado).toBeUndefined();
    // travado + não tocado: nem reverte nem avisa
    expect(marcarTamanhoTocado(rascunho, fresca, { touchedIds: new Set(), travado: () => true }).revertidos).toEqual([]);
  });

  it("M-3: soTamanhoMudou só quando a ÚNICA diferença é o 'Tamanho em' (o auto-aplicar pula o BOM)", () => {
    const mats = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }];
    const b = slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra", materiais: mats });
    expect(soTamanhoMudou({ ...b, tamanho_tipo: "numero" }, b)).toBe(true);
    expect(soTamanhoMudou({ ...b, tamanho_tipo: "numero", materiais: [{ ...mats[0], consumo: 2 }] }, b)).toBe(false);
    expect(soTamanhoMudou({ ...b }, b)).toBe(false); // nada mudou
    expect(soTamanhoMudou({ ...b, tamanho_tipo: "numero" }, undefined)).toBe(false); // sem base: aplica como antes
    expect(slotDaBase(arv([b]), { ...b, modelo_id: "outro" })).toBe(b); // por id primeiro
  });

  it("Fix round 1 (L-5, review) — soTamanhoMudou devolve false pra um slot BYTE-IDÊNTICO à base (linha 127, M-3 acima), exatamente o que sobra depois do revert automático de F3: 'igual' (a checagem NOVA no autoAplicarDirty) devolve true nesse caso — a razão por que precisa de um guard À PARTE (não dá pra reusar soTamanhoMudou pra isto)", () => {
    const mats = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [] }];
    const b = slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra", materiais: mats });
    // Cenário do L-5: F3 reverteu tamanho_tipo (voltou a "letra", igual à base) — o slot no rascunho fica
    // BYTE-IDÊNTICO à base (nem tamanho_tipo, nem tecido/cor/pç diferem).
    const slotRevertido = { ...b };
    expect(soTamanhoMudou(slotRevertido, b)).toBe(false); // confirma o achado: NÃO cai no ramo "só o tamanho mudou"
    expect(igual(slotRevertido, b)).toBe(true); // o guard novo PEGA esse caso — autoAplicarDirty pode pular
    // Contraste: slot com edição REAL (tecido mudou) — soTamanhoMudou já dizia false, e o guard novo tem que
    // continuar false também (nunca pode pular um slot com mudança de verdade).
    const slotEditado = { ...b, materiais: [{ ...mats[0], consumo: 2 }] };
    expect(soTamanhoMudou(slotEditado, b)).toBe(false);
    expect(igual(slotEditado, b)).toBe(false); // o guard NÃO pula — o BOM precisa ir pro auto-aplicar
    // Contraste 2: só o "Tamanho em" mudou de verdade (M-3 original) — soTamanhoMudou já pulava (true), e o
    // guard novo `igual` teria de dar false aqui (tamanho_tipo difere) — mas o `if` de M-3 (linha acima) já
    // capturou este caso com `continue` ANTES de chegar no guard novo, então a ordem no código importa: M-3
    // primeiro, L-5 depois (nunca o inverso — o guard L-5 sozinho não distingue "só tamanho mudou" de "nada
    // mudou", ambos têm materiais/etc iguais; só soTamanhoMudou sabe que o tamanho É diferente).
    const soTamanho = { ...b, tamanho_tipo: "numero" as const };
    expect(soTamanhoMudou(soTamanho, b)).toBe(true);
    expect(igual(soTamanho, b)).toBe(false);
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
    expect(sheet).toContain("const marca = marcarTamanhoTocado(arvoreAtual, planBaseRef.current, {");
    expect(sheet).toContain('travado: (mid) => colunasTravadas(estadosIntegracao[mid]).has("tamanho_tipo"),');
    expect(sheet).toContain("touchedIds: touchedSlotIdsRef.current,");
    // I-2 (receita 2419d0f): o mutationFn lê o espelho síncrono e o retry do P0409 o atualiza ANTES de re-mutar
    expect(sheet).toContain("const arvoreAtual = arvoreLiveRef.current ?? arvore!;");
    const retry = sheet.slice(sheet.indexOf("if (result.conflitos.length === 0) {"));
    expect(retry.indexOf("arvoreLiveRef.current = result.arvore;")).toBeGreaterThan(0);
    expect(retry.indexOf("arvoreLiveRef.current = result.arvore;")).toBeLessThan(retry.indexOf("salvarMut.mutate(undefined"));
    // revert + toast (card travado pela Integração enquanto editava)
    expect(sheet).toMatch(/if \(marca\.revertidos\.length > 0\) \{\n\s+setArvore\(marca\.local\);\n\s+toast\.warning\(textoTamanhoRevertido\(marca\.revertidos\)\);/);
    // M-3: o auto-aplicar pula o slot que só trocou o "Tamanho em", comparando com a base ANTES do Salvar
    expect(sheet).toContain("baseAntesDoSaveRef.current = planBaseRef.current;");
    // Fix round 1 (L-5, review) — `baseDoSlot` extraído numa variável (reusado pelo guard novo abaixo, na
    // mesma linha de código); a chamada de `soTamanhoMudou` continua a MESMA, só lendo da variável.
    expect(sheet).toContain("const baseDoSlot = slotDaBase(baseAntesDoSaveRef.current, slot);");
    expect(sheet).toContain("if (soTamanhoMudou(slot, baseDoSlot)) continue;");
    // N-2: nº de SKUs na mesma consulta dos modelos vivos + aviso no card
    expect(sheet).toContain("modelo_skus(count)");
    expect(sheet).toContain("avisoSkuTamanho={avisoSkuTamanhoDe(slot)}");
    expect(sheet).toContain("const arvorePayload = semPrecoNasVagasComCard(normalizarCategoriasAuto(marca.arvore,");
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
    expect(card).toContain("tituloDesabilitado={tamanhoTravado ? TEXTO_SKU_TRAVADO : undefined}");
    expect(card).toContain("SKUs já gerados não mudam — use Regerar no Planejamento.");
    expect(card).toContain('const tamanhoTravado = travaIntegracao.has("tamanho_tipo");');
    expect(card).toContain("usar_estoque: slot.usar_estoque, materiais: [], tamanho_tipo: null,");
    // dentro do bloco `!isComprado` da "Proporção por tamanho", sem gate de travado (Explosão) nem lancado
    const faixa = card.slice(card.indexOf("Proporção por tamanho</div>"), card.indexOf("<GradeSection"));
    expect(faixa).toContain("<TamanhoEmToggle");
    expect(faixa).not.toMatch(/disabled=\{[^}]*\b(travado|lancado)\b/);
  });
  it("Fix round pós-QA (F2) — o toggle leva um colabPath POR CARD/SLOT (mesma convenção de pt-prop/pt-consumo/pt-grade); sem isto, N cards abertos compartilhavam o path default e o anel de presença aparecia no card errado", () => {
    const card = ler("src/components/plan-tecido/ModelCard.tsx");
    const faixa = card.slice(card.indexOf("Proporção por tamanho</div>"), card.indexOf("<GradeSection"));
    expect(faixa).toContain('colabPath={`pt-tamtipo:${slot.id ?? slot.modelo_id ?? "x"}`}');
  });
  it("Fix round 1 (L-5, review) — autoAplicarDirty pula o slot BYTE-IDÊNTICO à base (guard novo com 'igual', DEPOIS do continue de M-3/soTamanhoMudou — a ordem importa)", () => {
    const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
    expect(sheet).toContain('import { efeitoDaCarga, igual, materiaisParaAplicar, normalizarArvoreDistribuicao, type OpcoesDist } from "@/lib/plan-tecido/atendimento";');
    const idxM3 = sheet.indexOf("if (soTamanhoMudou(slot, baseDoSlot)) continue;");
    const idxL5 = sheet.indexOf("if (baseDoSlot && igual(slot, baseDoSlot)) continue;");
    expect(idxM3).toBeGreaterThan(-1);
    expect(idxL5).toBeGreaterThan(idxM3); // L-5 DEPOIS de M-3 — ver o comentário no teste puro acima (a ordem é obrigatória)
    expect(sheet).toContain("const baseDoSlot = slotDaBase(baseAntesDoSaveRef.current, slot);");
  });
});

describe("M-4: merge colaborativo por slot com o 'Tamanho em'", () => {
  it("outra tela trocou o 'Tamanho em' do card (fresca) e eu não toquei ⇒ adota o novo, SEM conflito", () => {
    const base = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra" })]);
    const fresh = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero" })]);
    const r = mergeArvorePorSlot({ base, draft: base, fresh, touchedIds: new Set() });
    expect(r.conflitos).toEqual([]);
    expect(slotsDe(r.arvore)[0].tamanho_tipo).toBe("numero");
  });
  it("EU troquei e o servidor não mudou ⇒ mantém o meu, SEM conflito", () => {
    const base = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "letra" })]);
    const draft = arv([slot({ id: "s1", modelo_id: "m1", tamanho_tipo: "numero" })]);
    const r = mergeArvorePorSlot({ base, draft, fresh: base, touchedIds: new Set(["s1"]) });
    expect(r.conflitos).toEqual([]);
    expect(slotsDe(r.arvore)[0].tamanho_tipo).toBe("numero");
  });
});

describe("M-1: GradeSection — célula esmaecida não desmonta ao passar por 0", () => {
  it("apagar o valor do solto do outro lado mantém a célula (acumulativo por slot)", async () => {
    propModelo.current = null;
    const { GradeSection } = await import("@/components/plan-tecido/GradeSection");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const grade = ["PP", "P", "36", "38"];
    let atual = slot({ id: "s", tamanho_tipo: "letra", proporcoes: { PP: 1, P: 1, "36": 3, "38": 0 } });
    const render = () => act(() => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(GradeSection, { slot: atual, onChange: (n: PtSlot) => { atual = n; }, tamanhos: grade }))); });
    render();
    expect(rotulos(container)).toEqual(["PP", "P", "36"]);
    atual = { ...atual, proporcoes: { ...atual.proporcoes, "36": 0 } }; // Backspace até 0
    render();
    expect(rotulos(container)).toEqual(["PP", "P", "36"]); // segue lá (esmaecida) — não desmontou
    atual = { ...atual, id: "outro", proporcoes: { PP: 1, P: 1, "36": 0, "38": 0 } }; // outro slot: recomeça
    render();
    expect(rotulos(container)).toEqual(["PP", "P"]);
    act(() => { root.unmount(); });
    container.remove();
  });
});

describe("M-2: trocar de lado não destrói a correção à mão do lado oculto (distribuicao-produto)", () => {
  const grade = ["PP", "P", "M", "36", "38", "40"]; // Ark: soltos dos dois lados
  const prop = { PP: 1, P: 2, M: 1, "36": 1, "38": 1, "40": 1 };
  const letra = tamanhosDoTipo(grade, "letra");
  const numero = tamanhosDoTipo(grade, "numero");

  it("Letra → Número → Letra: a manual de 'P' vai para `ocultas` (fora dos totais) e VOLTA como manual", () => {
    // pela derivação do card (normalizarSlotDistribuicao passa a grade inteira) — mesmo caminho do toggle
    // Base 10 em Letra; P corrigido à mão p/ 7 (calculado seria 20)
    let d = definirCelula({ L1: { base: 10, grades: {}, manuais: [] } }, "L1", "P", 7, prop, letra, grade);
    expect(d.L1.manuais).toEqual(["P"]);
    expect(d.L1.grades.P).toBe(7);
    // → Número: P some da lista, mas fica guardado; totais só com o lado visível
    d = normalizarDistribuicao(d, prop, numero, grade);
    expect(d.L1.manuais).toEqual([]);
    expect(d.L1.ocultas).toEqual({ P: 7 });
    expect(d.L1.grades).toEqual({ "36": 10, "38": 10, "40": 10 });
    expect(totaisDaDistribuicao(d).total).toBe(30);
    // → Letra de novo: P volta à mão com 7
    d = normalizarDistribuicao(d, prop, letra, grade);
    expect(d.L1.manuais).toEqual(["P"]);
    expect(d.L1.grades).toEqual({ PP: 10, P: 7, M: 10 });
    expect(d.L1.ocultas).toBeUndefined();
  });

  it("linha só com a correção oculta (Base 0) continua existindo; sem ocultas a linha fica byte a byte igual", () => {
    const d = normalizarDistribuicao({ L1: { base: 0, grades: { P: 4 }, manuais: ["P"] } }, prop, numero, grade);
    expect(d.L1).toEqual({ base: 0, grades: {}, manuais: [], ocultas: { P: 4 } });
    expect(totaisDaDistribuicao(d).total).toBe(0);
    // lado visível intacto: mesma saída de sempre, sem a chave `ocultas` (com ou sem a grade inteira)
    for (const g of [undefined, grade])
      expect(recalcularLinha({ base: 10, grades: { P: 7 }, manuais: ["P"] }, prop, letra, g)).toEqual({ base: 10, grades: { PP: 10, P: 7, M: 10 }, manuais: ["P"] });
    // tamanho que saiu da GRADE inteira (não só escondido pelo lado) continua descartado
    expect(recalcularLinha({ base: 1, grades: { XG: 3 }, manuais: ["XG"] }, prop, letra, grade).ocultas).toBeUndefined();
    // sem a grade: comportamento de antes (manual fora da lista é descartada)
    expect(recalcularLinha({ base: 1, grades: { P: 3 }, manuais: ["P"] }, prop, numero).ocultas).toBeUndefined();
  });
});

describe("M-2 pelo card: trocar o toggle re-deriva o slot sem perder a manual do outro lado", () => {
  it("normalizarSlotDistribuicao Letra→Número→Letra preserva a correção à mão", async () => {
    const { normalizarSlotDistribuicao } = await import("@/lib/plan-tecido/atendimento");
    const grade = ["PP", "P", "36", "38"];
    const prop = { PP: 1, P: 1, "36": 1, "38": 1 };
    const v = { variante_tecido_id: "vt", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0,
      distribuicao: { L1: { base: 5, grades: { PP: 5, P: 2 }, manuais: ["P"] } } };
    const s0: PtSlot = { id: "s", modelo_id: null, tamanho_tipo: "letra", proporcoes: prop,
      materiais: [{ artigo_id: "A", tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [v] }] };
    const o = { ligado: true, tamanhos: grade };
    const n = normalizarSlotDistribuicao({ ...s0, tamanho_tipo: "numero" }, o);
    expect(n.materiais[0].variantes[0].grade_total).toBe(10); // 36+38 = 5+5; o P manual não conta
    const l = normalizarSlotDistribuicao({ ...n, tamanho_tipo: "letra" }, o);
    expect(l.materiais[0].variantes[0].distribuicao!.L1).toEqual({ base: 5, grades: { PP: 5, P: 2 }, manuais: ["P"] });
    expect(l.materiais[0].variantes[0].grade_total).toBe(7);
  });
});
