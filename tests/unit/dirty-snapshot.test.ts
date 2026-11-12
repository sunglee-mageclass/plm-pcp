import { describe, it, expect } from "vitest";
import { snapshotsEqual, serializeSnapshot } from "@/hooks/useDirtySnapshot";

describe("snapshotsEqual — detecção de alterações não salvas", () => {
  it("objetos idênticos = sem alteração", () => {
    expect(snapshotsEqual({ nome: "A", preco: 10 }, { nome: "A", preco: 10 })).toBe(true);
  });

  it("campo alterado = alteração", () => {
    expect(snapshotsEqual({ nome: "A", preco: 10 }, { nome: "A", preco: 11 })).toBe(false);
  });

  it("alteração aninhada = alteração", () => {
    expect(
      snapshotsEqual({ cor: { id: 1, nome: "azul" } }, { cor: { id: 1, nome: "verde" } }),
    ).toBe(false);
  });

  it("número vs string equivalente = alteração (tipos importam)", () => {
    expect(snapshotsEqual({ qtd: 1 }, { qtd: "1" })).toBe(false);
  });

  it("null e undefined são tratados como equivalentes (formulário vazio)", () => {
    expect(snapshotsEqual(null, undefined)).toBe(true);
  });

  it("array reordenado = alteração (ordem importa)", () => {
    expect(snapshotsEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("serializeSnapshot é resiliente a ciclos (não lança)", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serializeSnapshot(a)).not.toThrow();
  });
});

// ── Config da Loja (card Etapas PL): o Postgres `jsonb` REORDENA as chaves de objeto ao gravar; o servidor devolve o mesmo valor
// em outra ordem e o selo "não salvo" nunca apagava. A comparação ignora a ordem das chaves de OBJETO (em qualquer nível) e
// continua exata em tudo o mais: ordem de ARRAY, valor, chave a mais/menos.
describe("snapshotsEqual — ordem de chaves de objeto (jsonb) não é alteração", () => {
  const cfg = (kanban: string[], reqs: Record<string, string[]>) => ({ timezone: "America/Sao_Paulo", etapas_pl_kanban: kanban, etapas_pl_requisitos: reqs });

  it("caso do dono: requisitos na ordem do rascunho × na ordem do jsonb, mesmos valores = SEM alteração", () => {
    const rascunho = cfg(["Em Produção", "Corte"], { em_producao: ["tem_peca_teste"], corte: ["cq_liberado", "lancado"] });
    const servidor = cfg(["Em Produção", "Corte"], { corte: ["cq_liberado", "lancado"], em_producao: ["tem_peca_teste"] });
    expect(snapshotsEqual(rascunho, servidor)).toBe(true);
    expect(serializeSnapshot(rascunho)).toBe(serializeSnapshot(servidor));
  });

  it("a ordem das chaves também é ignorada em objetos aninhados e dentro de arrays de objetos", () => {
    expect(snapshotsEqual({ a: { x: 1, y: { p: 1, q: 2 } }, l: [{ b: 1, a: 2 }] }, { l: [{ a: 2, b: 1 }], a: { y: { q: 2, p: 1 }, x: 1 } })).toBe(true);
  });

  it("coluna a MAIS no rascunho (array) = alteração real", () => {
    const base = cfg(["Em Produção", "Corte"], { corte: ["cq_liberado"] });
    expect(snapshotsEqual(cfg(["Em Produção", "Corte", "Embalagem"], { corte: ["cq_liberado"] }), base)).toBe(false);
  });

  it("só ADICIONAR colunas (sem requisito): rascunho com o item × baseline sem = sujo; depois do baseline = limpo", () => {
    const sem = cfg(["Em Produção"], {});
    const com = cfg(["Em Produção", "Corte", "Embalagem"], {});
    expect(snapshotsEqual(com, sem)).toBe(false); // antes de salvar
    expect(snapshotsEqual(com, cfg(["Em Produção", "Corte", "Embalagem"], {}))).toBe(true); // baseline = o que o servidor devolveu
  });

  it("array reordenado de verdade = alteração (a ordem das colunas importa, nunca é mascarada)", () => {
    expect(snapshotsEqual(cfg(["A", "B", "C"], {}), cfg(["C", "B", "A"], {}))).toBe(false);
    expect(snapshotsEqual({ l: [{ a: 1 }, { b: 2 }] }, { l: [{ b: 2 }, { a: 1 }] })).toBe(false);
    expect(snapshotsEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("não-regressão: chave a MENOS/a MAIS, valor diferente, tipo diferente = alteração", () => {
    expect(snapshotsEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(snapshotsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(snapshotsEqual({ a: 1, b: 2 }, { b: 2, a: 3 })).toBe(false);
    expect(snapshotsEqual({ a: { x: ["q"] } }, { a: { x: ["r"] } })).toBe(false);
    expect(snapshotsEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(snapshotsEqual({ a: 1, b: null }, { a: 1 })).toBe(false); // null explícito ≠ chave ausente (nada é descartado)
  });

  it("a semântica do JSON.stringify se mantém: undefined omitido, Date via toJSON, null/primitivos", () => {
    expect(snapshotsEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(snapshotsEqual({ d: new Date("2026-01-01T00:00:00Z") }, { d: "2026-01-01T00:00:00.000Z" })).toBe(true);
    expect(serializeSnapshot(null)).toBe("null");
    expect(serializeSnapshot(7)).toBe("7");
    expect(serializeSnapshot("x")).toBe('"x"');
  });
});
