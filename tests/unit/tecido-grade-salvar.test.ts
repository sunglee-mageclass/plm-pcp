// Gravação da grade de Tecidos (`src/lib/tecido-grade/salvar.ts`): payload do tecido, ordem artigo -> cor com resultado
// PARCIAL, CAS por rev (P0409_LOCAL) e tradução dos erros da RPC da cor. `supabase` é mockado (nada de banco aqui).
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
let updRows: Array<{ id: string; rev: number }> = [];
const calls: string[] = [];
let ultimoUpdate: { payload?: Record<string, unknown>; eq: Array<[string, unknown]> } = { eq: [] };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (t: string) => {
      const c: any = {
        update: (p: Record<string, unknown>) => { calls.push(`${t}.update`); ultimoUpdate = { payload: p, eq: [] }; return c; },
        eq: (col: string, v: unknown) => { ultimoUpdate.eq.push([col, v]); return c; },
        select: () => c,
        then: (res: (v: unknown) => unknown) => res({ data: updRows, error: null }),
      };
      return c;
    },
  },
}));

import {
  artigoParaDraft, atualizarArtigoComRev, buscarAssinaturaPreco, ehConflito, ErroGrade, montarPayloadArtigo,
  salvarArtigo, salvarEmOrdem, salvarVarianteGrade, textoErroSalvar, textoResultadoSalvar, tocouCategorias,
  type ArtigoDraft, type ItemSalvar,
} from "@/lib/tecido-grade/salvar";

const baseArtigo = (extra: Partial<ArtigoDraft> = {}): ArtigoDraft => ({
  nome: "Malha", empresa_id: "e1", preco: 10, unidade_medida: "metro", largura_estimada: 1.5, composicao: null, ncm: null,
  rendimento: null, mes_id: null, ano_id: null, catIds: ["c1"], subPorCat: { c1: "s1" }, ...extra,
});

beforeEach(() => { rpc.mockReset(); calls.length = 0; updRows = []; ultimoUpdate = { eq: [] }; });

describe("artigoParaDraft", () => {
  it("normaliza vazio em null e deriva catIds/subPorCat dos pares", () => {
    const d = artigoParaDraft(
      { nome: "X", empresa_id: null, preco: 5, unidade_medida: null, largura_estimada: null, composicao: "  ", ncm: "", rendimento: null, mes_id: null, ano_id: null },
      [{ categoria_tecido_id: "c1", subcategoria_tecido_id: "s1" }, { categoria_tecido_id: "c2", subcategoria_tecido_id: null }],
    );
    expect(d.composicao).toBeNull();
    expect(d.ncm).toBeNull();
    expect(d.unidade_medida).toBe("metro");
    expect(d.catIds).toEqual(["c1", "c2"]);
    expect(d.subPorCat).toEqual({ c1: "s1" });
  });
});

describe("montarPayloadArtigo (só o que foi tocado, mesmas normalizações do Sheet)", () => {
  it("manda só os campos tocados", () => {
    expect(montarPayloadArtigo({ preco: 12 }, baseArtigo())).toEqual({ preco: 12 });
  });
  it("trocar o fornecedor zera o representante; vazio vira null", () => {
    expect(montarPayloadArtigo({ empresa_id: "e2" }, baseArtigo())).toEqual({ empresa_id: "e2", representante_id: null });
    expect(montarPayloadArtigo({ empresa_id: null }, baseArtigo())).toEqual({ empresa_id: null, representante_id: null });
  });
  it("NCM com trim e vazio = null; composição vazia = null", () => {
    expect(montarPayloadArtigo({ ncm: "  5208 " }, baseArtigo())).toEqual({ ncm: "5208" });
    expect(montarPayloadArtigo({ ncm: "   ", composicao: "" }, baseArtigo())).toEqual({ ncm: null, composicao: null });
  });
  it("rendimento só vale em Kg: trocar para metro zera; editar em kg mantém; editar em metro vira null", () => {
    expect(montarPayloadArtigo({ unidade_medida: "metro" }, baseArtigo({ unidade_medida: "kg", rendimento: 4 })))
      .toEqual({ unidade_medida: "metro", rendimento: null });
    expect(montarPayloadArtigo({ unidade_medida: "kg" }, baseArtigo({ rendimento: 4 }))).toEqual({ unidade_medida: "kg", rendimento: 4 });
    expect(montarPayloadArtigo({ rendimento: 3 }, baseArtigo({ unidade_medida: "kg" }))).toEqual({ rendimento: 3 });
    expect(montarPayloadArtigo({ rendimento: 3 }, baseArtigo({ unidade_medida: "metro" }))).toEqual({ rendimento: null });
  });
  it("categorias tocadas: categoria_tecido_id = a 1ª marcada (null sem nenhuma); só sub tocada mantém a 1ª da base", () => {
    expect(montarPayloadArtigo({ catIds: ["c9", "c1"] }, baseArtigo())).toEqual({ categoria_tecido_id: "c9" });
    expect(montarPayloadArtigo({ catIds: [] }, baseArtigo())).toEqual({ categoria_tecido_id: null });
    expect(montarPayloadArtigo({ subPorCat: { c1: "s2" } }, baseArtigo())).toEqual({ categoria_tecido_id: "c1" });
    expect(tocouCategorias({ catIds: [] })).toBe(true);
    expect(tocouCategorias({ preco: 1 })).toBe(false);
  });
  it("nome em branco lança ErroGrade", () => {
    expect(() => montarPayloadArtigo({ nome: "  " }, baseArtigo())).toThrow(ErroGrade);
  });
});

describe("salvarArtigo (CAS por rev)", () => {
  it("UPDATE com .eq(rev) e depois set_artigo_categorias; devolve o rev novo", async () => {
    updRows = [{ id: "a1", rev: 8 }];
    rpc.mockResolvedValue({ error: null });
    const novo = await salvarArtigo("a1", 7, { preco: 12 }, { catIds: ["c1"], subPorCat: { c1: "s1" } });
    expect(novo).toBe(8);
    expect(ultimoUpdate.eq).toEqual([["id", "a1"], ["rev", 7]]);
    expect(rpc).toHaveBeenCalledWith("set_artigo_categorias", { _artigo_id: "a1", _pares: [{ categoria_tecido_id: "c1", subcategoria_tecido_id: "s1" }] });
  });
  it("0 linhas = P0409_LOCAL e NÃO chama set_artigo_categorias", async () => {
    updRows = [];
    await expect(salvarArtigo("a1", 7, { preco: 12 }, { catIds: ["c1"], subPorCat: {} })).rejects.toMatchObject({ code: "P0409_LOCAL" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sem mudança de categorias não chama a RPC de categorias", async () => {
    updRows = [{ id: "a1", rev: 2 }];
    await salvarArtigo("a1", 1, { preco: 1 }, null);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rev nulo não acusa conflito (igual ao Sheet)", async () => {
    updRows = [];
    await expect(atualizarArtigoComRev("a1", null, { nome: "x" })).resolves.toBeNull();
  });
});

describe("salvarEmOrdem (UM Salvar: tecidos primeiro, depois cores; parcial)", () => {
  const item = (id: string, log: string[], opts: { dirty?: boolean; falha?: unknown } = {}): ItemSalvar => ({
    id,
    dirty: () => opts.dirty ?? true,
    salvar: async () => { log.push(id); if (opts.falha) throw opts.falha; },
  });
  it("grava os tecidos ANTES das cores e conta ok", async () => {
    const log: string[] = [];
    const r = await salvarEmOrdem([item("A1", log), item("A2", log)], [item("V1", log), item("V2", log)], {});
    expect(log).toEqual(["A1", "A2", "V1", "V2"]);
    expect(r).toEqual({ ok: 4, conflito: 0, erro: 0 });
  });
  it("um conflito/erro NÃO derruba os outros; cada um é contado no seu balde; limpo é pulado", async () => {
    const log: string[] = [];
    const conflitoLocal = Object.assign(new Error("x"), { code: "P0409_LOCAL" });
    const r = await salvarEmOrdem(
      [item("A1", log, { falha: conflitoLocal }), item("A2", log, { dirty: false })],
      [item("V1", log, { falha: new ErroGrade("conflito", true) }), item("V2", log, { falha: new ErroGrade("duplicada") }), item("V3", log)],
      {},
    );
    expect(log).toEqual(["A1", "V1", "V2", "V3"]); // A2 estava limpo
    expect(r).toEqual({ ok: 1, conflito: 2, erro: 1 });
  });
  it("repassa o prazo comum a todos", async () => {
    const vistos: unknown[] = [];
    const mk = (id: string): ItemSalvar => ({ id, dirty: () => true, salvar: async (ctx) => { vistos.push(ctx.limite); } });
    await salvarEmOrdem([mk("A")], [mk("V")], { limite: 123 });
    expect(vistos).toEqual([123, 123]);
  });
  it("ehConflito reconhece P0409_LOCAL e ErroGrade.conflito", () => {
    expect(ehConflito(Object.assign(new Error(), { code: "P0409_LOCAL" }))).toBe(true);
    expect(ehConflito(new ErroGrade("x", true))).toBe(true);
    expect(ehConflito(new ErroGrade("x"))).toBe(false);
    expect(ehConflito(new Error("x"))).toBe(false);
  });
});

describe("textoResultadoSalvar", () => {
  it("tudo ok = sucesso", () => {
    expect(textoResultadoSalvar({ ok: 3, conflito: 0, erro: 0 })).toEqual({ tom: "sucesso", texto: "3 salvos." });
    expect(textoResultadoSalvar({ ok: 1, conflito: 0, erro: 0 }).texto).toBe("1 salvo.");
  });
  it('"X salvos, Y com conflito"', () => {
    const r = textoResultadoSalvar({ ok: 3, conflito: 1, erro: 0 });
    expect(r.tom).toBe("aviso");
    expect(r.texto).toContain("3 salvos, 1 com conflito");
  });
  it("nada salvo e só falhas = erro; erro genérico entra no texto", () => {
    expect(textoResultadoSalvar({ ok: 0, conflito: 1, erro: 1 }).tom).toBe("erro");
    expect(textoResultadoSalvar({ ok: 2, conflito: 0, erro: 1 }).texto).toContain("1 com erro");
    expect(textoResultadoSalvar({ ok: 0, conflito: 0, erro: 0 }).tom).toBe("aviso");
  });
});

describe("salvarVarianteGrade (RPC salvar_variante_tecido)", () => {
  const args = { id: "v1", mudancas: { nome_variante: "A" }, base: { nome_variante: null }, tocouPreco: false, preco: null as number | null };
  it("sem preço: manda assinatura null, sem pedir prévia", async () => {
    rpc.mockResolvedValue({ error: null });
    await salvarVarianteGrade(args);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("salvar_variante_tecido", { _id: "v1", _mudancas: { nome_variante: "A" }, _base: { nome_variante: null }, _assinatura: null });
  });
  it("com preço: busca a assinatura da prévia (leitura) e a manda de volta", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "variante_tecido_preco_previa" ? { data: { afetados: 2, assinatura: "sig" }, error: null } : { error: null });
    await salvarVarianteGrade({ ...args, mudancas: { preco: 12 }, tocouPreco: true, preco: 12 });
    expect(rpc).toHaveBeenNthCalledWith(1, "variante_tecido_preco_previa", { _id: "v1", _preco: 12 });
    expect(rpc).toHaveBeenNthCalledWith(2, "salvar_variante_tecido", expect.objectContaining({ _assinatura: "sig" }));
  });
  it("prévia sem assinatura: NÃO grava", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    await expect(salvarVarianteGrade({ ...args, tocouPreco: true, preco: 5 })).rejects.toBeInstanceOf(ErroGrade);
    expect(rpc.mock.calls.some((c) => c[0] === "salvar_variante_tecido")).toBe(false);
  });
  it("prévia que estoura o prazo = sem assinatura", async () => {
    rpc.mockImplementation(() => new Promise(() => {})); // nunca responde
    expect(await buscarAssinaturaPreco("v1", 1, Date.now() + 20)).toBeNull();
  });
  it("P0409 conflito_versao = ErroGrade de conflito; previa_desatualizada também; 23505 = cor duplicada", async () => {
    rpc.mockResolvedValue({ error: { code: "P0409", message: "conflito_versao: x" } });
    await expect(salvarVarianteGrade(args)).rejects.toMatchObject({ conflito: true });
    rpc.mockResolvedValue({ error: { code: "P0409", message: "previa_desatualizada: x" } });
    await expect(salvarVarianteGrade(args)).rejects.toMatchObject({ conflito: true });
    rpc.mockResolvedValue({ error: { code: "23505", message: "dup" } });
    await expect(salvarVarianteGrade(args)).rejects.toMatchObject({ message: "Já existe uma variante com essa cor e apelido.", conflito: false });
  });
  it("textoErroSalvar traduz o conflito do tecido", () => {
    expect(textoErroSalvar(Object.assign(new Error(), { code: "P0409_LOCAL" }))).toContain("Outra pessoa salvou este tecido");
  });
});
