// @vitest-environment happy-dom
// [urg R13 #17, Onda 2] Seletor de MOEDA POR CAMPO no item da OC de Produto Importado — SÓ REGISTRA/EXIBE.
//   - o seletor aparece em cada campo de valor (valor unit., transporte); o landed (derivado no servidor, BRL) NÃO tem seletor;
//   - o padrão vem do SLOT pelo cabeçalho (valor unit. → moeda de compra; transporte → intermediária, ou a de compra se direta);
//   - trocar a moeda de um campo muda o símbolo/rótulo e os valores formatados daquele campo;
//   - o ÚLTIMO escolhido no campo vira o padrão do PRÓXIMO item (localStorage por campo), mas NÃO reescreve item já salvo;
//   - a CONTA não muda: totais, "Valor produto" (M1→M2 pela cotação) e landed saem idênticos com qualquer moeda-rótulo; nada de `moedas` vai
//     ao Salvar nem ao merge das linhas.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, createContext, useContext, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Select de Radix não abre em happy-dom: troca por uma casca nativa (gatilho com aria-label + um botão por item).
const Ctx = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    createElement(Ctx.Provider, { value: onValueChange }, createElement("div", { "data-mock-select": "", "data-value": value }, children)),
  SelectTrigger: ({ children, ...p }: any) => createElement("button", { type: "button", "aria-label": p["aria-label"] }, children),
  SelectValue: ({ children }: any) => createElement("span", { "data-valor-exibido": "" }, children),
  SelectContent: ({ children }: any) => createElement("div", null, children),
  SelectItem: ({ value, children }: any) => {
    const cb = useContext(Ctx);
    return createElement("button", { type: "button", "data-item": value, onClick: () => cb(value) }, children);
  },
}));

vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));

const { OcImpItem } = await import("@/components/oc-p-importado/OcImpItem");
const { OcImpTotais } = await import("@/components/oc-p-importado/OcImpCabecalho");
const { itemAvulsoVazio, itemParaPayload, linhaDeItem, preservarMoedas, totaisDoItem, totaisDaOc } = await import("@/components/oc-p-importado/itens");
const { emptyCabecalho } = await import("@/components/oc-p-importado/shared");
const { montarDocModeloOcImp } = await import("@/components/oc-p-importado/doc-modelo");
const MC = await import("@/lib/moeda-campo");
const { m1ParaM2 } = await import("@/lib/moeda");
import type { ItemOcImp } from "@/components/oc-p-importado/itens";

const NBSP = /[\u00a0\u202f]/g;
let root: Root | null = null;
let host: HTMLElement | null = null;

const base = (over: Partial<ItemOcImp> = {}): ItemOcImp => ({
  ...itemAvulsoVazio(), id: "i1", tempId: "i1", nome_produto: "Vestido Midi", grupo_id: "g1",
  grade_proporcao: { "36|PP": 1 }, variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 10 }],
  qtd_total: 10, valor_unitario_m1: 50, peso_kg: 0.4, transporte_m2: 12, desconto_pct: 0, custo_unitario_landed_real: 21.5,
  ...over,
});

function Harness({ inicial, moedaCompra = "RMB", moedaIntermediaria = "USD", onItem }: {
  inicial: ItemOcImp; moedaCompra?: string; moedaIntermediaria?: string | null; onItem?: (i: ItemOcImp) => void;
}) {
  const [item, setItem] = useState(inicial);
  onItem?.(item);
  return createElement(OcImpItem, {
    item, onItemChange: (u: (i: ItemOcImp) => ItemOcImp) => setItem((p) => u(p)),
    grupos: [{ id: "g1", nome: "Vestuário" }], categorias: [], subcats1: [], subcats2: [], cores: [], coresApelido: [], tamanhos: ["36|PP"], colaboradores: [],
    moedaCompra, moedaIntermediaria, cotacaoRef: 5, isEdit: false,
    motivoNaoTira: null, onTirar: () => {}, motivoNaoRecebe: null, onReceber: () => {},
  });
}
async function montar(el: any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
}
const texto = () => (document.body.textContent ?? "").replace(NBSP, " ");
const gatilho = (rotulo: string) => document.querySelector(`button[aria-label="${rotulo}"]`) as HTMLButtonElement | null;
const exibido = (rotulo: string) => gatilho(rotulo)?.querySelector("[data-valor-exibido]")?.textContent ?? null;
const escolher = async (rotulo: string, code: string) => {
  const seletor = gatilho(rotulo)!.closest("[data-mock-select]")!;
  const alvo = seletor.querySelector(`[data-item="${code}"]`) as HTMLButtonElement;
  await act(async () => { alvo.click(); });
};
/** Trecho "Valor produto … Valor transp." do InfoStrip (a conversão M1→M2 informativa, pela cotação de ref.). */
const valorProduto = () => texto().match(/Valor produto.*?Valor transp\./)?.[0] ?? "";

beforeEach(() => { window.localStorage.clear(); });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; host?.remove(); host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  window.localStorage.clear();
});

describe("seletor de moeda por campo — aparece e nasce com o padrão do slot", () => {
  it("valor unit. e transporte têm seletor; o landed (derivado no servidor, BRL) não", async () => {
    await montar(createElement(Harness, { inicial: base() }));
    expect(gatilho("Moeda do valor unitário")).toBeTruthy();
    expect(gatilho("Moeda do transporte")).toBeTruthy();
    expect(document.querySelectorAll("button[aria-label^='Moeda do']")).toHaveLength(2);
    expect(Array.from(document.querySelectorAll("button[aria-label]")).some((b) => /landed/i.test(b.getAttribute("aria-label")!))).toBe(false);
    // o seletor oferece a lista fixa (MOEDAS) + "Adicionar moeda…" (código livre)
    const lista = gatilho("Moeda do valor unitário")!.closest("[data-mock-select]")!;
    for (const m of MC_CODES) expect(lista.querySelector(`[data-item="${m}"]`), m).toBeTruthy();
    expect(lista.textContent).toContain("Adicionar moeda…");
  });
  it("padrão = slot do cabeçalho: valor unit. → moeda de compra; transporte → intermediária; landed → BRL", async () => {
    await montar(createElement(Harness, { inicial: base() }));
    expect(exibido("Moeda do valor unitário")).toBe("RMB");
    expect(exibido("Moeda do transporte")).toBe("USD");
    expect(texto()).toContain("Valor unit. (¥)");
    expect(texto()).toContain("Transporte (US$/kg)");
    expect(texto()).toContain("R$ 21,50"); // landed: sempre BRL, do servidor
    expect(MC.moedaPadraoDoSlot("landed", { moedaCompra: "RMB", moedaIntermediaria: "USD" })).toBe("BRL");
  });
  it("cadeia DIRETA (sem M2): o transporte cai na moeda de compra", async () => {
    await montar(createElement(Harness, { inicial: base(), moedaCompra: "USD", moedaIntermediaria: null }));
    expect(exibido("Moeda do valor unitário")).toBe("USD");
    expect(exibido("Moeda do transporte")).toBe("USD");
    expect(texto()).toContain("Transporte (US$/kg)");
  });
});

const MC_CODES = ["BRL", "USD", "RMB", "PYG"];

describe("trocar a moeda de um campo reflete no símbolo/rótulo e nos valores daquele campo", () => {
  it("valor unit.: o rótulo e o Bruto/Total/V. unit. real passam para a nova moeda; o transporte não é tocado", async () => {
    await montar(createElement(Harness, { inicial: base() }));
    expect(texto()).toContain("¥ 500,00"); // bruto 10 × 50 em RMB
    await escolher("Moeda do valor unitário", "USD");
    expect(exibido("Moeda do valor unitário")).toBe("USD");
    expect(texto()).toContain("Valor unit. (US$)");
    expect(texto()).toContain("US$ 500,00");
    expect(texto()).not.toContain("¥ 500,00");
    expect(texto()).toContain("Transporte (US$/kg)"); // outro campo: continua o seu
    expect(exibido("Moeda do transporte")).toBe("USD");
  });
  it("transporte: troca só o rótulo e o 'Valor transp.' daquele campo", async () => {
    await montar(createElement(Harness, { inicial: base() }));
    await escolher("Moeda do transporte", "BRL");
    expect(texto()).toContain("Transporte (R$/kg)");
    expect(texto()).toContain("R$ 4,80"); // 0,4 kg × 12
    expect(exibido("Moeda do valor unitário")).toBe("RMB");
  });
  it("moeda livre ('Adicionar moeda…'): o código digitado vira o rótulo", async () => {
    await montar(createElement(Harness, { inicial: base() }));
    await escolher("Moeda do valor unitário", "__outra__");
    const campo = document.querySelector("input[placeholder='Código']") as HTMLInputElement;
    expect(campo).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "jpy");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(texto()).toContain("Valor unit. (JPY)");
    expect(texto()).toContain("JPY 500,00");
    expect(window.localStorage.getItem("wish360:oc-imp:moeda-ultima:valor_unitario")).toBe("JPY");
  });
});

describe("a CONTA não muda com a moeda-rótulo", () => {
  it("totais, 'Valor produto' (M1→M2 pela cotação) e landed idênticos antes e depois de trocar; o número do campo não é reconvertido", async () => {
    let ultimo: ItemOcImp | null = null;
    await montar(createElement(Harness, { inicial: base(), onItem: (i) => { ultimo = i; } }));
    const antes = { vp: valorProduto(), landed: texto().includes("R$ 21,50"), tot: totaisDoItem(ultimo!), valor: ultimo!.valor_unitario_m1 };
    expect(antes.vp).toContain("US$ 10,00"); // 50 ÷ cotação de ref. 5 → em M2 (USD)
    await escolher("Moeda do valor unitário", "PYG");
    await escolher("Moeda do transporte", "RMB");
    expect(valorProduto()).toBe(antes.vp);
    expect(texto().includes("R$ 21,50")).toBe(antes.landed);
    expect(totaisDoItem(ultimo!)).toEqual(antes.tot);
    expect(ultimo!.valor_unitario_m1).toBe(antes.valor);
    expect(m1ParaM2(ultimo!.valor_unitario_m1, 5)).toBe(10);
    expect(ultimo!.moedas).toEqual({ valor_unitario: "PYG", transporte: "RMB" });
  });
  it("a moeda-rótulo nunca vai ao Salvar nem entra na linha do merge", () => {
    const sem = base();
    const com = base({ moedas: { valor_unitario: "PYG", transporte: "RMB" } });
    expect(itemParaPayload(com)).toEqual(itemParaPayload(sem));
    expect(JSON.stringify(itemParaPayload(com))).not.toMatch(/moeda/i);
    expect(linhaDeItem(com)).toEqual(linhaDeItem(sem));
    expect(totaisDoItem(com)).toEqual(totaisDoItem(sem));
    expect(totaisDaOc([com, sem])).toEqual(totaisDaOc([sem, sem]));
  });
});

describe("o ÚLTIMO escolhido no campo vira o padrão do PRÓXIMO item", () => {
  it("escolher grava por campo; o item novo nasce com ele; o campo sem histórico segue o slot", async () => {
    expect(MC.moedasParaItemNovo()).toEqual({});
    await montar(createElement(Harness, { inicial: base() }));
    await escolher("Moeda do valor unitário", "USD");
    expect(window.localStorage.getItem("wish360:oc-imp:moeda-ultima:valor_unitario")).toBe("USD");
    expect(window.localStorage.getItem("wish360:oc-imp:moeda-ultima:transporte")).toBeNull();
    expect(MC.moedasParaItemNovo()).toEqual({ valor_unitario: "USD" });
    await act(async () => { root!.unmount(); });
    host!.remove();
    // próximo item: valor unit. = USD (último usado); transporte = slot do cabeçalho (USD no cab. RMB→USD)... use cabeçalho EUR→GBP p/ distinguir
    const novo: ItemOcImp = { ...itemAvulsoVazio(), moedas: MC.moedasParaItemNovo() };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(Harness, { inicial: novo, moedaCompra: "RMB", moedaIntermediaria: "PYG" })); });
    expect(exibido("Moeda do valor unitário")).toBe("USD");
    expect(exibido("Moeda do transporte")).toBe("PYG");
    expect(texto()).toContain("Valor unit. (US$)");
  });
  it("trocar por cima do padrão vale e vira o novo último; segunda troca sobrescreve a primeira", async () => {
    MC.gravarUltimaMoeda("valor_unitario", "USD");
    const novo: ItemOcImp = { ...itemAvulsoVazio(), moedas: MC.moedasParaItemNovo() };
    await montar(createElement(Harness, { inicial: novo }));
    expect(exibido("Moeda do valor unitário")).toBe("USD");
    await escolher("Moeda do valor unitário", "BRL");
    expect(exibido("Moeda do valor unitário")).toBe("BRL");
    expect(MC.lerUltimaMoeda("valor_unitario")).toBe("BRL");
  });
  it("item JÁ SALVO sem escolha não é reescrito pelo último usado: segue o cabeçalho", async () => {
    MC.gravarUltimaMoeda("valor_unitario", "USD");
    await montar(createElement(Harness, { inicial: base() }));
    expect(exibido("Moeda do valor unitário")).toBe("RMB");
  });
  it("código incompleto/inválido e storage quebrado não lembram nada nem derrubam a tela", () => {
    MC.gravarUltimaMoeda("valor_unitario", "");
    MC.gravarUltimaMoeda("valor_unitario", "J");
    MC.gravarUltimaMoeda("valor_unitario", "R$");
    expect(MC.lerUltimaMoeda("valor_unitario")).toBeNull();
    window.localStorage.setItem("wish360:oc-imp:moeda-ultima:transporte", "lixo!!");
    expect(MC.lerUltimaMoeda("transporte")).toBeNull();
    const orig = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => ({ getItem: () => { throw new Error("privado"); }, setItem: () => { throw new Error("quota"); } }),
    });
    try {
      expect(() => MC.gravarUltimaMoeda("valor_unitario", "USD")).not.toThrow();
      expect(MC.lerUltimaMoeda("valor_unitario")).toBeNull();
      expect(MC.moedasParaItemNovo()).toEqual({});
    } finally {
      if (orig) Object.defineProperty(window, "localStorage", orig);
    }
  });
  it("re-semeio do servidor (tirar/receber) devolve a escolha de cada item por id; item novo do servidor fica sem", () => {
    const tela = [base({ id: "a", moedas: { valor_unitario: "USD" } }), base({ id: "b" })];
    const servidor = [base({ id: "a" }), base({ id: "b" }), base({ id: "c" })];
    const r = preservarMoedas(servidor, tela);
    expect(r[0].moedas).toEqual({ valor_unitario: "USD" });
    expect(r[1].moedas).toBeUndefined();
    expect(r[2].moedas).toBeUndefined();
  });
});

describe("exibição: totais da OC, tabela de produtos e impressão usam a moeda registrada", () => {
  const ocMoedas = { moedaCompra: "RMB", moedaIntermediaria: "USD" };
  it("moeda do total: a comum dos itens; se divergem, a do cabeçalho; sem itens, a do cabeçalho", () => {
    const usd = base({ moedas: { valor_unitario: "USD" } });
    expect(MC.moedaDoTotalDaOc([usd, usd], ocMoedas)).toBe("USD");
    expect(MC.moedaDoTotalDaOc([usd, base()], ocMoedas)).toBe("RMB");
    expect(MC.moedaDoTotalDaOc([], ocMoedas)).toBe("RMB");
    expect(MC.moedaDoTotalDaOc([base(), base()], ocMoedas)).toBe("RMB");
  });
  it("impressão (doc-modelo): preço unit./subtotal de cada produto na moeda registrada; a conta é a mesma", () => {
    const itens = [base({ moedas: { valor_unitario: "USD" } }), base({ id: "i2", tempId: "i2", nome_produto: "Blusa" })];
    const docMoedas = montarDocModeloOcImp({
      numero: "X1", cabecalho: { data_pedido: "2026-10-02", data_prevista: "", moeda_compra: "RMB", moeda_intermediaria: "USD" }, landedUnitarioOc: null,
      empresaNome: "F", representanteNome: null, itens, tamanhos: ["36|PP"], grupoNome: () => "Vestuário", corNome: () => null, apelidoNome: () => null, emitidoEm: "02/10/2026",
    });
    const docSem = montarDocModeloOcImp({
      numero: "X1", cabecalho: { data_pedido: "2026-10-02", data_prevista: "", moeda_compra: "RMB", moeda_intermediaria: "USD" }, landedUnitarioOc: null,
      empresaNome: "F", representanteNome: null, itens: itens.map((i) => ({ ...i, moedas: undefined })), tamanhos: ["36|PP"], grupoNome: () => "Vestuário", corNome: () => null, apelidoNome: () => null, emitidoEm: "02/10/2026",
    });
    const v = (d: typeof docMoedas, k: number) => d.grades![k].valores![0];
    expect(String(v(docMoedas, 0).subtotal).replace(NBSP, " ")).toBe("US$ 500,00");
    expect(String(v(docMoedas, 1).subtotal).replace(NBSP, " ")).toBe("¥ 500,00"); // o outro produto segue o cabeçalho
    expect(String(v(docSem, 0).subtotal).replace(NBSP, " ")).toBe("¥ 500,00");
    // divergentes → total na moeda do cabeçalho, e o NÚMERO é o mesmo com ou sem rótulo
    expect(String(docMoedas.totalPrevisto).replace(NBSP, " ")).toBe("¥ 1.000,00");
    expect(String(docSem.totalPrevisto).replace(NBSP, " ")).toBe("¥ 1.000,00");
    const todosUsd = montarDocModeloOcImp({
      numero: "X1", cabecalho: { data_pedido: "2026-10-02", data_prevista: "", moeda_compra: "RMB", moeda_intermediaria: "USD" }, landedUnitarioOc: null,
      empresaNome: "F", representanteNome: null, itens: itens.map((i) => ({ ...i, moedas: { valor_unitario: "USD" } })), tamanhos: ["36|PP"], grupoNome: () => "Vestuário", corNome: () => null, apelidoNome: () => null, emitidoEm: "02/10/2026",
    });
    expect(String(todosUsd.totalPrevisto).replace(NBSP, " ")).toBe("US$ 1.000,00");
  });
  it("tabela de produtos da OC (seção Etapas & valores): cada linha na sua moeda; total pela comum/cabeçalho", async () => {
    const itens = [base({ moedas: { valor_unitario: "USD" } }), base({ id: "i2", tempId: "i2", nome_produto: "Blusa" })];
    const draft = { ...emptyCabecalho(), moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5.5 };
    await montar(createElement(OcImpTotais, { draft, setDraft: () => {}, itens, landedUnitarioOc: 0 }));
    const linhas = Array.from(document.querySelectorAll("tbody tr")).map((r) => (r.textContent ?? "").replace(NBSP, " "));
    expect(linhas[0]).toContain("Vestido Midi");
    expect(linhas[0]).toContain("US$ 500,00");
    expect(linhas[1]).toContain("Blusa");
    expect(linhas[1]).toContain("¥ 500,00");
    expect((document.querySelector("tfoot")?.textContent ?? "").replace(NBSP, " ")).toContain("¥ 1.000,00");
  });
});
