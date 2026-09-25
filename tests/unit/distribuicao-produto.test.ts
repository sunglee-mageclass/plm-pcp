import { describe, it, expect } from "vitest";
import {
  abreviarNome, celulaCalculada, chaveSlot, definirBase, definirCelula, definirProporcao, linhaVista, normalizarDistribuicao,
  pathDistAberto, pathDistBase, pathDistCel, pathDistProp, pathEhDoProduto, proporcaoDoTamanho, rotuloTamanho, somaVistas,
  tamanhosDoTipo, temDistribuicao, tipoDoProduto, totaisDaDistribuicao, voltarAoCalculado, type Distribuicao,
} from "@/lib/distribuicao-produto";

const GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
const PROP_LETRA = { "34|PPP": 0, "36|PP": 0, "38|P": 1, "40|M": 2, "42|G": 2, "44|GG": 1 };
const EC = "loja-ecom", LF = "loja-fisica", AT = "loja-atacado";

/** Monta a distribuição de UMA cor a partir das Bases por loja (e correções à mão). */
function cor(bases: Record<string, number>, prop: Record<string, number>, tams: string[], manuais: [string, string, number][] = []): Distribuicao {
  let d: Distribuicao = {};
  for (const [loja, b] of Object.entries(bases)) d = definirBase(d, loja, b, prop, tams);
  for (const [loja, t, v] of manuais) d = definirCelula(d, loja, t, v, prop, tams);
  return d;
}

describe("distribuicao-produto — mockup em LETRA (VESTIDO LONGO POEMA)", () => {
  const tams = tamanhosDoTipo(GRADE, "letra");
  const marrom = cor({ [EC]: 5, [LF]: 3, [AT]: 4 }, PROP_LETRA, tams, [[EC, "38|P", 4]]);
  const preto = cor({ [EC]: 6, [LF]: 4, [AT]: 5 }, PROP_LETRA, tams);
  const vinho = cor({ [EC]: 3, [LF]: 2 }, PROP_LETRA, tams);

  it("célula = round(proporção × Base); PPP/PP (proporção 0) = 0", () => {
    expect(celulaCalculada(PROP_LETRA, "40|M", 6)).toBe(12);
    expect(celulaCalculada(PROP_LETRA, "34|PPP", 6)).toBe(0);
  });
  it("E-commerce · Marrom: P corrigido à mão para 4 (calculado 5) → linha 29; a célula guarda o manual", () => {
    const v = linhaVista(marrom[EC], PROP_LETRA, tams);
    expect(v.celulas["38|P"]).toEqual({ valor: 4, calculado: 5, manual: true });
    expect(v.total).toBe(29);
    expect(marrom[EC].manuais).toEqual(["38|P"]);
  });
  it("totais por cor = pç no card: Marrom 71 · Preto 90 · Vinho 30 = 191", () => {
    expect(totaisDaDistribuicao(marrom).total).toBe(71);
    expect(totaisDaDistribuicao(preto).total).toBe(90);
    expect(totaisDaDistribuicao(vinho).total).toBe(30);
    expect(totaisDaDistribuicao(marrom).grades).toEqual({ "38|P": 11, "40|M": 24, "42|G": 24, "44|GG": 12 });
    expect(totaisDaDistribuicao(marrom).base).toBe(12);
  });
  it("subtotal por loja: E-commerce 83 (Base 14; P 13 · M 28 · G 28 · GG 14); Atacado 54 sem Vinho", () => {
    const ec = somaVistas([marrom, preto, vinho].map((d) => linhaVista(d[EC], PROP_LETRA, tams)), tams);
    expect(ec).toEqual({ base: 14, grades: { "34|PPP": 0, "36|PP": 0, "38|P": 13, "40|M": 28, "42|G": 28, "44|GG": 14 }, total: 83 });
    const at = somaVistas([marrom, preto, vinho].map((d) => linhaVista(d[AT], PROP_LETRA, tams)), tams);
    expect(at.total).toBe(54);
    expect(vinho[AT]).toBeUndefined(); // Base vazia e sem célula à mão = a linha nem existe (R8)
  });
  it("P-23 = A: mudar a Base NÃO mexe no corrigido à mão; só os calculados acompanham", () => {
    const d = definirBase(marrom, EC, 6, PROP_LETRA, tams);
    expect(linhaVista(d[EC], PROP_LETRA, tams).celulas["38|P"]).toEqual({ valor: 4, calculado: 6, manual: true });
    expect(d[EC].grades["40|M"]).toBe(12);
  });
  it("↺ voltar ao calculado tira o ponto; digitar o próprio calculado também não marca", () => {
    const d = voltarAoCalculado(marrom, EC, "38|P", PROP_LETRA, tams);
    expect(d[EC].manuais).toEqual([]);
    expect(d[EC].grades["38|P"]).toBe(5);
    const d2 = definirCelula(preto, EC, "40|M", 12, PROP_LETRA, tams);
    expect(d2[EC].manuais).toEqual([]);
  });
  it("célula à mão = 0 fica guardada (manual) e some do total", () => {
    const d = definirCelula(preto, LF, "44|GG", 0, PROP_LETRA, tams);
    expect(d[LF].grades["44|GG"]).toBe(0);
    expect(d[LF].manuais).toEqual(["44|GG"]);
    expect(totaisDaDistribuicao(d).total).toBe(86);
  });
  it("Base 0 sem célula à mão tira a linha (R8); com célula à mão a linha fica", () => {
    expect(definirBase(preto, EC, 0, PROP_LETRA, tams)[EC]).toBeUndefined();
    expect(definirBase(marrom, EC, 0, PROP_LETRA, tams)[EC]).toEqual({ base: 0, grades: { "38|P": 4 }, manuais: ["38|P"] });
  });
  it("mudar a proporção recalcula só as não-manuais (normalizarDistribuicao)", () => {
    const np = definirProporcao(PROP_LETRA, tams, "40|M", 3);
    const d = normalizarDistribuicao(marrom, np, tams);
    expect(d[EC].grades).toEqual({ "38|P": 4, "40|M": 15, "42|G": 10, "44|GG": 5 });
  });
  it("normalizar sem tamanhos (grade não carregou) mantém as células gravadas", () => {
    expect(normalizarDistribuicao(marrom, PROP_LETRA, [])).toEqual(marrom);
  });
  it("normalizar tira célula de tamanho fora da grade e é idempotente", () => {
    const sujo: Distribuicao = { [EC]: { base: 2, grades: { "38|P": 2, "99|XG": 7 }, manuais: ["99|XG"] } };
    const d = normalizarDistribuicao(sujo, PROP_LETRA, tams);
    expect(d[EC]).toEqual({ base: 2, grades: { "38|P": 2, "40|M": 4, "42|G": 4, "44|GG": 2 }, manuais: [] });
    expect(normalizarDistribuicao(d, PROP_LETRA, tams)).toEqual(d);
  });
  it("temDistribuicao", () => {
    expect(temDistribuicao(marrom)).toBe(true);
    expect(temDistribuicao({})).toBe(false);
    expect(temDistribuicao(undefined)).toBe(false);
  });
});

describe("distribuicao-produto — mockup em NÚMERO (CALÇA PANTALONA LUNA)", () => {
  const tams = tamanhosDoTipo(GRADE, "numero");
  const prop = { "34|PPP": 0, "36|PP": 1, "38|P": 1, "40|M": 1, "42|G": 1, "44|GG": 0 };
  const bege = cor({ [EC]: 14, [LF]: 6, [AT]: 10 }, prop, tams, [[EC, "36|PP", 13]]);
  const preto = cor({ [EC]: 10, [LF]: 5, [AT]: 8 }, prop, tams);
  it("rótulos em número; 36 à mão 13 → E-commerce Bege 55; Bege 119 · Preto 92 = 211; E-commerce 95", () => {
    expect(tams.map((t) => rotuloTamanho(t, "numero"))).toEqual(["34", "36", "38", "40", "42", "44"]);
    expect(linhaVista(bege[EC], prop, tams).total).toBe(55);
    expect(totaisDaDistribuicao(bege).total).toBe(119);
    expect(totaisDaDistribuicao(preto).total).toBe(92);
    expect(somaVistas([bege, preto].map((d) => linhaVista(d[EC], prop, tams)), tams).total).toBe(95);
  });
});

describe("distribuicao-produto — tamanhos, proporção legada, tipo, abreviação, paths", () => {
  it("tamanhosDoTipo: par entra sempre; solto só com o lado do tipo; nenhum com o lado ⇒ todos (R11)", () => {
    const ark = ["36", "38", "40", "42", "44", "PP", "P", "M", "G", "GG"];
    expect(tamanhosDoTipo(ark, "letra")).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(tamanhosDoTipo(ark, "numero")).toEqual(["36", "38", "40", "42", "44"]);
    expect(tamanhosDoTipo(["UN"], "numero")).toEqual(["UN"]);
    expect(tamanhosDoTipo(GRADE, "letra")).toEqual(GRADE);
  });
  it("proporção com chave legada só-letra/só-número", () => {
    expect(proporcaoDoTamanho({ P: 2 }, "38|P")).toBe(2);
    expect(proporcaoDoTamanho({ "38": 3 }, "38|P")).toBe(3);
    expect(proporcaoDoTamanho({ "38|P": 1, P: 9 }, "38|P")).toBe(1);
    expect(proporcaoDoTamanho(null, "38|P")).toBe(0);
  });
  it("definirProporcao congela as chaves cheias exibidas e troca só o tamanho digitado", () => {
    expect(definirProporcao({ P: 2 }, ["38|P", "40|M"], "40|M", 3)).toEqual({ "38|P": 2, "40|M": 3 });
  });
  it("tipoDoProduto: NULL/sem modelo ⇒ Letra (P-25)", () => {
    expect(tipoDoProduto(null)).toBe("letra");
    expect(tipoDoProduto("numero")).toBe("numero");
  });
  it("abreviarNome: até antes da 2ª vogal (mockup mobile)", () => {
    expect(abreviarNome("Marrom Canela")).toBe("Marr. Can.");
    expect(abreviarNome("Preto")).toBe("Pret.");
    expect(abreviarNome("Vinho Bordô")).toBe("Vinh. Bord.");
    expect(abreviarNome("Bege")).toBe("Bege");
  });
  it("paths de presença (R19) e chave do slot", () => {
    expect(chaveSlot({ id: "s1", modelo_id: "m1" })).toBe("s1");
    expect(chaveSlot({ modelo_id: "m1" })).toBe("m1");
    expect(pathDistProp("s1", "38|P")).toBe("dist:s1:prop:38|P");
    expect(pathDistBase("s1", EC, "v1")).toBe("dist:s1:loja-ecom:v1:base");
    expect(pathDistCel("s1", EC, "plan:c|a", "38|P")).toBe("dist:s1:loja-ecom:plan:c|a:38|P");
    expect(pathDistAberto("s1")).toBe("dist:s1:aberto");
    expect(pathEhDoProduto("dist:s1:aberto", "s1")).toBe(true);
    expect(pathEhDoProduto("dist:s10:aberto", "s1")).toBe(false);
    expect(pathEhDoProduto(null, "s1")).toBe(false);
  });
});
