/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão de tecido-grade-aba.test.ts) */
// Gravação de UM grupo novo da grade de Tecidos (`salvarTecidoNovo`) e o texto do toast com os novos somados (`resultadoComNovos`).
// `supabase` mockado: aqui só se confere O QUE vai à RPC `importar_tecido_linha` e o que se grava DEPOIS dela (o que a RPC não grava).
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const updates: Array<{ payload: Record<string, unknown>; id: unknown }> = [];
let erroUpdate: unknown = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (t: string) => {
      let payload: Record<string, unknown> = {};
      const c: any = {
        update: (p: Record<string, unknown>) => { payload = p; return c; },
        eq: (_col: string, id: unknown) => { if (t === "artigos") updates.push({ payload, id }); return c; },
        then: (res: (v: unknown) => unknown) => res({ data: null, error: erroUpdate }),
      };
      return c;
    },
  },
}));

import { corNovaEmExistente, tecidoNovoVazio } from "@/lib/tecido-grade/linha-nova";
import { ErroGrade, resultadoComNovos, salvarTecidoNovo } from "@/lib/tecido-grade/salvar";

function grupo() {
  const g = tecidoNovoVazio("g");
  g.cab.nome = "Malha Fiore";
  g.vars[0].cor_id = "cor1";
  return g;
}

beforeEach(() => {
  rpc.mockReset();
  updates.length = 0;
  erroUpdate = null;
});

describe("salvarTecidoNovo", () => {
  it("chama importar_tecido_linha com o shape exato e, sem largura/categoria/sub, não faz mais nada", async () => {
    rpc.mockResolvedValue({ data: { artigo_id: "n1", acao: "criado" }, error: null });
    await expect(salvarTecidoNovo(grupo())).resolves.toBe("criado");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("importar_tecido_linha");
    expect(Object.keys(rpc.mock.calls[0][1]).sort()).toEqual(["_artigo_alvo_id", "_cabecalho", "_categoria_ids", "_variantes"]);
    expect(updates).toHaveLength(0);
  });

  it("tecido CRIADO: grava depois o que a RPC não grava (largura, 1ª categoria, subcategoria)", async () => {
    rpc.mockResolvedValue({ data: { artigo_id: "n1", acao: "criado" }, error: null });
    const g = grupo();
    g.cab.largura_estimada = 1.5;
    g.categoriaIds = ["cat1"];
    g.subPorCat = { cat1: "sub1" };
    await salvarTecidoNovo(g);
    expect(updates).toEqual([{ id: "n1", payload: { largura_estimada: 1.5, categoria_tecido_id: "cat1" } }]);
    expect(rpc).toHaveBeenLastCalledWith("set_artigo_categorias", {
      _artigo_id: "n1",
      _pares: [{ categoria_tecido_id: "cat1", subcategoria_tecido_id: "sub1" }],
    });
  });

  it("falha no complemento vira ErroGrade PT-BR dizendo que o tecido foi criado", async () => {
    rpc.mockResolvedValue({ data: { artigo_id: "n1", acao: "criado" }, error: null });
    erroUpdate = { message: "boom" };
    const g = grupo();
    g.cab.largura_estimada = 2;
    await expect(salvarTecidoNovo(g)).rejects.toThrow(/O tecido foi criado/);
  });

  it("cor nova em tecido existente: alvo no payload e nenhum complemento", async () => {
    rpc.mockResolvedValue({ data: { artigo_id: "a2", acao: "complementado" }, error: null });
    const g = corNovaEmExistente("a2", "Tecido a2", "g");
    g.vars[0].cor_id = "cor1";
    await expect(salvarTecidoNovo(g)).resolves.toBe("complementado");
    expect(rpc.mock.calls[0][1]).toMatchObject({ _artigo_alvo_id: "a2", _cabecalho: { nome: "Tecido a2" } });
    expect(updates).toHaveLength(0);
  });

  it("'inalterado' (a cor já existe) não é sucesso silencioso: ErroGrade", async () => {
    rpc.mockResolvedValue({ data: { artigo_id: "a2", acao: "inalterado" }, error: null });
    const g = corNovaEmExistente("a2", "Tecido a2", "g");
    g.vars[0].cor_id = "cor1";
    await expect(salvarTecidoNovo(g)).rejects.toBeInstanceOf(ErroGrade);
    await expect(salvarTecidoNovo(g)).rejects.toThrow("Essa cor já existe neste tecido.");
  });

  it("erro da RPC vira ErroGrade com texto PT-BR", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Informe o nome do tecido." } });
    await expect(salvarTecidoNovo(grupo())).rejects.toBeInstanceOf(ErroGrade);
  });
});

describe("resultadoComNovos", () => {
  it("sem pendentes = texto de sempre, somando os criados nos salvos", () => {
    expect(resultadoComNovos({ ok: 1, conflito: 0, erro: 0 }, { criados: 2, erros: 0, pendentes: 0 })).toEqual({ tom: "sucesso", texto: "3 salvos." });
  });
  it("pendentes avisam e rebaixam o sucesso para aviso", () => {
    const r = resultadoComNovos({ ok: 0, conflito: 0, erro: 0 }, { criados: 1, erros: 0, pendentes: 2 });
    expect(r.tom).toBe("aviso");
    expect(r.texto).toBe("1 salvo. 2 linhas novas pendentes (faltam dados) não foram enviadas.");
  });
  it("só pendentes: nada foi salvo", () => {
    expect(resultadoComNovos({ ok: 0, conflito: 0, erro: 0 }, { criados: 0, erros: 0, pendentes: 1 })).toEqual({
      tom: "aviso",
      texto: "1 linha nova pendente (faltam dados) não foi enviada.",
    });
  });
  it("erros do servidor nos novos contam 'com erro'", () => {
    const r = resultadoComNovos({ ok: 0, conflito: 0, erro: 0 }, { criados: 0, erros: 1, pendentes: 0 });
    expect(r).toEqual({ tom: "erro", texto: "1 com erro. Veja o aviso na linha." });
  });
});
