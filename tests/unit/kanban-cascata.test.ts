import { describe, it, expect } from "vitest";
import { requisitosEfetivos, requisitosHerdados } from "@/lib/kanban-condicoes";

// Board de exemplo: 3 etapas na ordem A → B → C.
const ORDEM = ["A", "B", "C"];

describe("kanban cascata — requisitosEfetivos", () => {
  it("cada etapa acumula os requisitos das anteriores + os próprios", () => {
    const reqs = { A: ["categoria_definida"], B: ["estilista_definido"], C: ["preco_venda_preenchido"] };
    expect(requisitosEfetivos("A", ORDEM, reqs).sort()).toEqual(["categoria_definida"]);
    expect(requisitosEfetivos("B", ORDEM, reqs).sort()).toEqual(["categoria_definida", "estilista_definido"]);
    expect(requisitosEfetivos("C", ORDEM, reqs).sort()).toEqual(["categoria_definida", "estilista_definido", "preco_venda_preenchido"]);
  });

  it("dedup: key repetida entre etapas conta uma vez", () => {
    const reqs = { A: ["categoria_definida"], B: ["categoria_definida", "estilista_definido"], C: [] };
    expect(requisitosEfetivos("C", ORDEM, reqs).sort()).toEqual(["categoria_definida", "estilista_definido"]);
  });

  it("reordenar as colunas muda a herança", () => {
    const reqs = { A: ["a1"], B: ["b1"], C: ["c1"] };
    // ordem invertida: C → B → A. Entrar em A agora herda de C e B.
    const inv = ["C", "B", "A"];
    expect(requisitosEfetivos("A", inv, reqs).sort()).toEqual(["a1", "b1", "c1"]);
    expect(requisitosEfetivos("C", inv, reqs).sort()).toEqual(["c1"]);
  });

  it("statusKey fora da ordem conhecida → só os próprios", () => {
    const reqs = { A: ["a1"], X: ["x1", "a1"] };
    expect(requisitosEfetivos("X", ORDEM, reqs).sort()).toEqual(["a1", "x1"]);
  });

  it("exceção subtrai um herdado NESTA etapa (não da origem)", () => {
    const reqs = { A: ["a1", "a2"], B: ["b1"], C: [] };
    const exc = { B: ["a1"] }; // etapa B ignora o herdado a1
    // B efetivo = (a1,a2 de A) + (b1) − exceção a1 = a2, b1
    expect(requisitosEfetivos("B", ORDEM, reqs, exc).sort()).toEqual(["a2", "b1"]);
    // C ainda herda a1 (a exceção era só de B)
    expect(requisitosEfetivos("C", ORDEM, reqs, exc).sort()).toEqual(["a1", "a2", "b1"]);
    // A (origem) mantém a1 (exceção nunca remove da origem)
    expect(requisitosEfetivos("A", ORDEM, reqs, exc).sort()).toEqual(["a1", "a2"]);
  });

  it("exceção não remove um requisito PRÓPRIO da etapa (só herdados)", () => {
    const reqs = { A: ["a1"], B: ["a1"], C: [] }; // a1 é próprio de B também
    const exc = { B: ["a1"] };
    // a1 é próprio de B → a exceção não o remove
    expect(requisitosEfetivos("B", ORDEM, reqs, exc)).toContain("a1");
  });

  it("1ª etapa: se tem requisitos próprios, entram (não é livre)", () => {
    const reqs = { A: ["a1", "a2"], B: [], C: [] };
    expect(requisitosEfetivos("A", ORDEM, reqs).sort()).toEqual(["a1", "a2"]);
  });

  it("etapas sem requisitos → vazio", () => {
    expect(requisitosEfetivos("B", ORDEM, {})).toEqual([]);
    expect(requisitosEfetivos("B", ORDEM, undefined)).toEqual([]);
  });
});

describe("kanban cascata — requisitosHerdados (para a UI)", () => {
  it("lista os herdados com a etapa de origem (1ª que exige)", () => {
    const reqs = { A: ["a1"], B: ["a1", "b1"], C: ["c1"] };
    // C herda a1 (origem A, 1ª a exigir) e b1 (origem B). c1 é próprio → não entra.
    expect(requisitosHerdados("C", ORDEM, reqs).sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: "a1", origem: "A" },
      { key: "b1", origem: "B" },
    ]);
  });

  it("1ª etapa não tem herdados", () => {
    expect(requisitosHerdados("A", ORDEM, { A: ["a1"], B: ["b1"] })).toEqual([]);
  });

  it("requisito próprio da etapa NÃO aparece como herdado", () => {
    const reqs = { A: ["x"], B: ["x"] }; // x é próprio de B também
    expect(requisitosHerdados("B", ORDEM, reqs)).toEqual([]);
  });
});
