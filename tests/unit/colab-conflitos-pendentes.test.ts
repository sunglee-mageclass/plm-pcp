// Conflitos de linha pendentes não somem num merge seguinte (lição I1 da revisão de dffea607): o conflito "removi X, o outro editou X"
// precisa sobreviver ao eco do Realtime de OUTRA linha, senão o Salvar destrava e apaga a edição alheia.
import { describe, it, expect } from "vitest";
import { mergeLinhas, type Conflito } from "@/lib/colab/merge";
import { juntarConflitos, baseSemAvancarEmConflito, baseComLinhaResolvida, semConflitosDeLinha, substituirLinhaNova } from "@/lib/colab/conflitos-pendentes";

type L = { id: string; v: number };
const L = (id: string, v: number): L => ({ id, v });

describe("juntarConflitos", () => {
  const A: Conflito = { path: "linha:1", meu: null, dele: L("1", 5) };
  const B: Conflito = { path: "campo", meu: "a", dele: "b" };
  it("mantém os pendentes de CAMPO/GRADE que o merge novo não recalculou", () => {
    expect(juntarConflitos([A, B], [])).toEqual([B]);
    const grade: Conflito = { path: "grade:v:t:enviada", meu: 1, dele: 2 };
    expect(juntarConflitos([grade, B], [])).toEqual([grade, B]);
  });
  it("conflito de LINHA pendente que o merge não recalculou NÃO vale mais (o servidor apagou a linha ou a outra pessoa reverteu)", () => {
    expect(juntarConflitos([A], [])).toEqual([]);
    expect(semConflitosDeLinha([A, B])).toEqual([B]);
  });
  it("mesmo path: vale o novo (valor mais fresco do servidor); os demais seguem", () => {
    const novo: Conflito = { path: "linha:1", meu: null, dele: L("1", 7) };
    expect(juntarConflitos([A, B], [novo])).toEqual([B, novo]);
  });
});

describe("baseSemAvancarEmConflito / baseComLinhaResolvida", () => {
  it("sem conflito de linha: a base vira o fresh", () => {
    expect(baseSemAvancarEmConflito([L("1", 1)], [L("1", 9)], [])).toEqual([L("1", 9)]);
  });
  it("linha em conflito mantém a base ANTIGA; as outras avançam; linha que o servidor removeu continua lembrada", () => {
    const conf: Conflito[] = [{ path: "linha:1", meu: null, dele: L("1", 5) }, { path: "linha:3", meu: L("3", 3), dele: null }];
    const r = baseSemAvancarEmConflito([L("1", 1), L("2", 2), L("3", 3)], [L("1", 5), L("2", 8)], conf);
    expect(r).toEqual(expect.arrayContaining([L("1", 1), L("2", 8), L("3", 3)]));
    expect(r).toHaveLength(3);
  });
  it("linha em conflito SEM base antiga continua FORA da base (sem fallback p/ o fresh): o próximo merge recalcula o conflito", () => {
    const conf: Conflito[] = [{ path: "linha:9", meu: null, dele: L("9", 1) }];
    expect(baseSemAvancarEmConflito([L("2", 2)], [L("9", 1), L("2", 2)], conf)).toEqual([L("2", 2)]);
  });
  it("resolver: a base da linha vira o que o servidor tem (ou some, se o servidor removeu)", () => {
    expect(baseComLinhaResolvida([L("1", 1), L("2", 2)], "1", L("1", 5))).toEqual(expect.arrayContaining([L("1", 5), L("2", 2)]));
    expect(baseComLinhaResolvida([L("1", 1), L("2", 2)], "1", null)).toEqual([L("2", 2)]);
  });
});

describe("sequência I1: removi X → o outro editou X (conflito) → eco de Y → o conflito SEGUE", () => {
  const meuRascunho = [L("2", 2)];                 // removi a "1"
  const tocadas = new Set(["1"]);
  const rodar = (base: L[], fresh: L[], pend: Conflito[]) => {
    const ml = mergeLinhas({ base, draft: meuRascunho, fresh, touchedIds: tocadas, removidasIds: tocadas });
    const conflitos = juntarConflitos(pend, ml.conflitos);
    return { conflitos, base: baseSemAvancarEmConflito(base, fresh, conflitos) };
  };
  it("com a correção o conflito sobrevive ao merge seguinte", () => {
    const m1 = rodar([L("1", 1), L("2", 2)], [L("1", 5), L("2", 2)], []);
    expect(m1.conflitos.map((c) => c.path)).toEqual(["linha:1"]);
    const m2 = rodar(m1.base, [L("1", 5), L("2", 3)], m1.conflitos); // alguém mexe só na "2"
    expect(m2.conflitos.map((c) => c.path)).toEqual(["linha:1"]);
    expect(m2.conflitos[0].dele).toEqual(L("1", 5));
    const m3 = rodar(m2.base, [L("1", 7), L("2", 3)], m2.conflitos); // e a "1" muda de novo: o conflito mostra o valor mais novo
    expect(m3.conflitos).toEqual([{ path: "linha:1", meu: null, dele: L("1", 7) }]);
  });
  it("sem a correção (base avançada, lista substituída) o conflito SUMIA — o bug", () => {
    const m1 = mergeLinhas({ base: [L("1", 1), L("2", 2)], draft: meuRascunho, fresh: [L("1", 5), L("2", 2)], touchedIds: tocadas, removidasIds: tocadas });
    expect(m1.conflitos).toHaveLength(1);
    const m2 = mergeLinhas({ base: [L("1", 5), L("2", 2)], draft: meuRascunho, fresh: [L("1", 5), L("2", 3)], touchedIds: tocadas, removidasIds: tocadas });
    expect(m2.conflitos).toEqual([]);
  });
  it("depois de resolver (manter meu), a linha não volta a gerar conflito", () => {
    const m1 = rodar([L("1", 1), L("2", 2)], [L("1", 5), L("2", 2)], []);
    const baseResolvida = baseComLinhaResolvida(m1.base, "1", L("1", 5));
    const m2 = rodar(baseResolvida, [L("1", 5), L("2", 3)], []);
    expect(m2.conflitos).toEqual([]);
  });
});

describe("substituirLinhaNova (B-b)", () => {
  it("a linha do servidor ocupa o lugar da nova e HERDA o tempId dela (estados por tempId, como rolosPorItem, não ficam órfãos)", () => {
    const nova = { id: undefined as string | undefined, tempId: "tmp-novo", v: 1 };
    const outra = { id: "x", tempId: "x", v: 2 };
    const r = substituirLinhaNova([outra, nova], 1, { id: "it2", tempId: "it2", v: 9 });
    expect(r).toEqual([outra, { id: "it2", tempId: "tmp-novo", v: 9 }]);
  });
});

describe("sequência (b): removi X, o outro editou X e depois APAGOU X", () => {
  it("o conflito deixa de ser recalculado (fresh sem X e sem edição minha) e o pendente de linha é descartado", () => {
    const tocadas = new Set(["1"]);
    const m1 = mergeLinhas({ base: [L("1", 1), L("2", 2)], draft: [L("2", 2)], fresh: [L("1", 5), L("2", 2)], touchedIds: tocadas, removidasIds: tocadas });
    const c1 = juntarConflitos([], m1.conflitos);
    const base1 = baseSemAvancarEmConflito([L("1", 1), L("2", 2)], [L("1", 5), L("2", 2)], c1);
    const m2 = mergeLinhas({ base: base1, draft: [L("2", 2)], fresh: [L("2", 2)], touchedIds: tocadas, removidasIds: tocadas });
    expect(m2.conflitos).toEqual([]);
    expect(juntarConflitos(c1, m2.conflitos)).toEqual([]); // antes: o conflito velho ficava e "usar o novo" ressuscitava a linha 1
  });
});
