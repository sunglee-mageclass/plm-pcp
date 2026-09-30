import { describe, it, expect } from "vitest";
import {
  agruparPorFamilia, precisaConfirmar, estaNoDestino, rotuloLocal, fmtDataCriacao, podeProsseguir, chaveGrupos, emLotes, chaveConfirmacao, carregandoVersoes,
  type LinhaVersao,
} from "@/lib/versoes-familia";

const L = (id: string, o: Partial<LinhaVersao> = {}): LinhaVersao => ({
  id, nome: "Vestido", versao: 1, modelo_base_id: null, colecao_id: "c1", colecao: "Verão", subcolecao: null, created_at: "2026-09-01T12:00:00Z", ...o,
});

describe("agruparPorFamilia / precisaConfirmar", () => {
  it("card sozinho na família = sem aviso", () => {
    const g = agruparPorFamilia([L("a")], ["a"]);
    expect(g).toHaveLength(1);
    expect(precisaConfirmar(g)).toBe(false);
  });
  it("v1+v2 ambas selecionadas, sem outras = sem aviso e 1 família só", () => {
    const g = agruparPorFamilia([L("a"), L("b", { versao: 2, modelo_base_id: "a" })], ["a", "b"]);
    expect(g).toHaveLength(1);
    expect(g[0].versoes.every((v) => v.ehSelecionado)).toBe(true);
    expect(precisaConfirmar(g)).toBe(false);
  });
  it("outra versão em outra coleção = aviso", () => {
    const g = agruparPorFamilia(
      [L("a"), L("b", { versao: 2, modelo_base_id: "a", colecao_id: "c2", colecao: "Inverno" })], ["a"]);
    expect(precisaConfirmar(g)).toBe(true);
    expect(g[0].versoes.map((v) => [v.id, v.ehSelecionado])).toEqual([["a", true], ["b", false]]);
  });
  it("selecionar a v2 traz a raiz e as irmãs (família por coalesce)", () => {
    const g = agruparPorFamilia(
      [L("a"), L("b", { versao: 2, modelo_base_id: "a" }), L("c", { versao: 3, modelo_base_id: "a" })], ["b"]);
    expect(g).toHaveLength(1);
    expect(g[0].raiz).toBe("a");
    expect(g[0].versoes).toHaveLength(3);
    expect(precisaConfirmar(g)).toBe(true);
  });
  it("lote multi-família: sem repetir família; só a que tem outras exige", () => {
    const linhas = [
      L("a", { nome: "Vestido" }), L("b", { nome: "Vestido", versao: 2, modelo_base_id: "a" }),
      L("x", { nome: "Blusa" }), L("y", { nome: "Saia" }), L("z", { nome: "Saia", versao: 2, modelo_base_id: "y" }),
    ];
    const g = agruparPorFamilia(linhas, ["a", "x", "y", "z"]);
    expect(g.map((f) => f.raiz).sort()).toEqual(["a", "x", "y"]);
    expect(precisaConfirmar(g)).toBe(true); // a/b: b não está selecionado
    const semVestido = agruparPorFamilia(linhas.filter((l) => l.nome !== "Vestido"), ["x", "y", "z"]);
    expect(precisaConfirmar(semVestido)).toBe(false);
  });
  it("órfã: selecionado que não veio na consulta é ignorado; raiz apagada (base NULL) vira família própria", () => {
    expect(agruparPorFamilia([L("a")], ["fantasma"])).toEqual([]);
    const g = agruparPorFamilia([L("b", { versao: 2, modelo_base_id: null })], ["b"]);
    expect(g[0].raiz).toBe("b");
    expect(precisaConfirmar(g)).toBe(false);
  });
  it("ordena por versão, depois created_at, depois id", () => {
    const g = agruparPorFamilia([
      L("a"), L("d", { versao: 2, modelo_base_id: "a", created_at: "2026-09-03T00:00:00Z" }),
      L("c", { versao: 2, modelo_base_id: "a", created_at: "2026-09-02T00:00:00Z" }),
    ], ["a"]);
    expect(g[0].versoes.map((v) => v.id)).toEqual(["a", "c", "d"]);
  });
});

describe("rótulos", () => {
  it("no destino: coleção + sub (texto), sub vazia = sem sub", () => {
    expect(estaNoDestino(L("a"), { colecaoId: "c1", subcolecao: null })).toBe(true);
    expect(estaNoDestino(L("a", { subcolecao: "" }), { colecaoId: "c1", subcolecao: null })).toBe(true);
    expect(estaNoDestino(L("a", { subcolecao: "Fase 1" }), { colecaoId: "c1", subcolecao: null })).toBe(false);
    expect(estaNoDestino(L("a", { subcolecao: "Fase 1" }), { colecaoId: "c1", subcolecao: "Fase 1" })).toBe(true);
    expect(estaNoDestino(L("a"), { colecaoId: "c2", subcolecao: null })).toBe(false);
    expect(estaNoDestino(L("a"), null)).toBe(false);
  });
  it("local e data", () => {
    expect(rotuloLocal(L("a"))).toBe("Verão › Sem subcoleção");
    expect(rotuloLocal(L("a", { colecao: null, subcolecao: "F1" }))).toBe("Sem coleção › F1");
    expect(fmtDataCriacao("2026-09-05T02:00:00Z")).toBe("04/09/2026"); // fuso da loja (-03)
    expect(fmtDataCriacao(null)).toBe("—");
    expect(fmtDataCriacao("lixo")).toBe("—");
  });
});

describe("podeProsseguir (falha fechada)", () => {
  const base = { carregando: false, erro: false, precisa: false, confirmado: false };
  it("sem outras versões libera; com outras exige o check", () => {
    expect(podeProsseguir(base)).toBe(true);
    expect(podeProsseguir({ ...base, precisa: true })).toBe(false);
    expect(podeProsseguir({ ...base, precisa: true, confirmado: true })).toBe(true);
  });
  it("carregando ou erro nunca libera", () => {
    expect(podeProsseguir({ ...base, carregando: true })).toBe(false);
    expect(podeProsseguir({ ...base, erro: true, confirmado: true })).toBe(false);
  });
  it("chaveGrupos muda quando a lista muda; emLotes", () => {
    const a = agruparPorFamilia([L("a")], ["a"]);
    const b = agruparPorFamilia([L("a"), L("b", { modelo_base_id: "a", versao: 2 })], ["a"]);
    expect(chaveGrupos(a)).not.toBe(chaveGrupos(b));
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("P-152 fix — confirmação e cache", () => {
  const fam = () => agruparPorFamilia([L("a"), L("b", { versao: 2, modelo_base_id: "a", colecao_id: "c2", colecao: "Inverno" })], ["a"]);
  it("trocar o destino para onde já existe uma versão muda a chave (desmarca)", () => {
    const g = fam();
    const k1 = chaveConfirmacao(g, { colecaoId: "c9", subcolecao: null });
    const k2 = chaveConfirmacao(g, { colecaoId: "c2", subcolecao: null });
    expect(k1).not.toBe(k2);
  });
  it("trocar entre destinos que marcam as mesmas versões mantém a chave", () => {
    const g = fam();
    expect(chaveConfirmacao(g, { colecaoId: "c8", subcolecao: null })).toBe(chaveConfirmacao(g, { colecaoId: "c9", subcolecao: "X" }));
  });
  const base = { enabled: true, nIds: 1, isPending: false, isFetching: false, isFetchedAfterMount: true, isError: false };
  it("cache nunca destrava: dado antigo em refetch ou sem fetch pós-mount = carregando", () => {
    expect(carregandoVersoes({ ...base, isFetching: true, isFetchedAfterMount: false })).toBe(true);
    expect(carregandoVersoes({ ...base, isFetchedAfterMount: false })).toBe(true);
    expect(carregandoVersoes({ ...base })).toBe(false);
  });
  it("erro + refetch (Tentar de novo) = carregando; erro parado não é carregando", () => {
    expect(carregandoVersoes({ ...base, isError: true, isFetching: true })).toBe(true);
    expect(carregandoVersoes({ ...base, isError: true })).toBe(false);
  });
  it("desabilitado ou sem ids = não carregando", () => {
    expect(carregandoVersoes({ ...base, enabled: false, isPending: true })).toBe(false);
    expect(carregandoVersoes({ ...base, nIds: 0, isPending: true })).toBe(false);
  });
  it("gating do botão: cache + refetch nunca libera; erro nunca libera; pós-refetch sem outras libera", () => {
    const cache = carregandoVersoes({ ...base, isFetching: true, isFetchedAfterMount: false });
    expect(podeProsseguir({ carregando: cache, erro: false, precisa: false, confirmado: false })).toBe(false);
    expect(podeProsseguir({ carregando: false, erro: true, precisa: false, confirmado: true })).toBe(false);
    expect(podeProsseguir({ carregando: false, erro: false, precisa: false, confirmado: false })).toBe(true);
  });
});
