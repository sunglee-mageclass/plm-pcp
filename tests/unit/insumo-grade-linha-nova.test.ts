// Grade "Lista" de Insumos (IN-3): linha NOVA — validação (nome vazio = PENDENTE), payload EXATO de `importar_insumo_linha` com as
// variantes EXPANDIDAS por cor × tamanho, cor nova em insumo existente (alvo), nome repetido e vínculo. Puro (sem React/Supabase).
import { describe, it, expect } from "vitest";
import {
  blocoVazio,
  corNovaEmExistente,
  insumoJaExiste,
  insumoNovoVazio,
  payloadImportar,
  separarNovos,
  validarInsumoNovo,
  vinculoDoNovo,
  type InsumoNovo,
} from "@/lib/insumo-grade/linha-nova";

const grupo = (
  extra: Partial<InsumoNovo["cab"]> = {},
  blocos?: InsumoNovo["blocos"],
): InsumoNovo => {
  const g = insumoNovoVazio("g1");
  return { ...g, cab: { ...g.cab, nome: "Cartão Tag", ...extra }, blocos: blocos ?? g.blocos };
};
const bloco = (
  cor: string,
  tamanhos: string[] = [],
  preco: number | null = null,
  tmp = `b-${cor}`,
) => ({
  ...blocoVazio(tmp),
  cor_id: cor,
  tamanhos,
  preco,
});

describe("validarInsumoNovo", () => {
  it("nome vazio = PENDENTE (campo nome); com nome e a cor em branco o insumo vale (sem cor é permitido)", () => {
    expect(validarInsumoNovo(grupo({ nome: "  " }))).toMatchObject({
      ok: false,
      problemas: [{ campo: "nome", msg: "nome obrigatório" }],
    });
    expect(validarInsumoNovo(grupo()).ok).toBe(true);
  });

  it("cor repetida no grupo (inclusive 'sem cor' duas vezes) é problema da linha repetida", () => {
    const v = validarInsumoNovo(grupo({}, [bloco("azul", [], 1, "a"), bloco("azul", [], 2, "b")]));
    expect(v.ok).toBe(false);
    expect(v.problemas).toEqual([{ campo: "cor", msg: "cor repetida neste insumo", varTmp: "b" }]);
    const vv = validarInsumoNovo(
      grupo({}, [bloco("", ["34|PPP"], null, "a"), bloco("", ["36|PP"], null, "b")]),
    );
    expect(vv.ok).toBe(false);
  });

  it("linha de cor em branco que sobra no fim não conta (não trava nem duplica)", () => {
    expect(
      validarInsumoNovo(grupo({}, [bloco("azul", [], 1, "a"), blocoVazio("x"), blocoVazio("y")]))
        .ok,
    ).toBe(true);
  });

  it("vínculo ligado sem tamanho escolhido = pendente; escolhido (insumo sem tamanho próprio) vale", () => {
    const sem = grupo({ vincular: true, tamanho_vinculado: null, formato_tamanho: "nenhum" });
    expect(validarInsumoNovo(sem).problemas).toEqual([
      { campo: "tamanho_vinculado", msg: "escolha o tamanho vinculado ou desligue" },
    ]);
    const com = grupo({ vincular: true, tamanho_vinculado: "40|M", formato_tamanho: "nenhum" });
    expect(validarInsumoNovo(com).ok).toBe(true);
    expect(vinculoDoNovo(com)).toBe("40|M");
  });

  it("vínculo com cor que tem tamanho marcado NÃO vale (Ruling A2): vira null", () => {
    const g = grupo({ vincular: true, tamanho_vinculado: "40|M" }, [bloco("azul", ["34|PPP"])]);
    expect(vinculoDoNovo(g)).toBeNull();
  });
});

describe("payloadImportar (`importar_insumo_linha`)", () => {
  it("insumo NOVO: cabeçalho completo, alvo null e variantes EXPANDIDAS por cor × tamanho", () => {
    const g = grupo(
      {
        tipo_insumo_id: "tp1",
        unidade: "milheiro",
        empresa_id: "emp1",
        preco: 9.5,
        observacoes: " obs ",
        formato_tamanho: "ambos",
      },
      [bloco("azul", ["34|PPP", "36|PP"], 0.5), bloco("verde", [], 0.7), bloco("", ["40|M"], null)],
    );
    const p = payloadImportar(g);
    expect(p._etiqueta_alvo_id).toBeNull();
    expect(p._cabecalho).toEqual({
      nome: "Cartão Tag",
      unidade: "milheiro",
      tipo_insumo_id: "tp1",
      empresa_id: "emp1",
      representante_id: null,
      preco: 9.5,
      formato_tamanho: "ambos",
      observacoes: "obs",
    });
    expect(p._variantes).toEqual([
      { cor_id: "azul", tamanho: "34|PPP", preco: 0.5 },
      { cor_id: "azul", tamanho: "36|PP", preco: 0.5 },
      { cor_id: "verde", tamanho: null, preco: 0.7 },
      { cor_id: null, tamanho: "40|M", preco: null },
    ]);
  });

  it("NÃO manda tamanho_vinculado (a RPC não o conhece) e não manda cor em branco", () => {
    const p = payloadImportar(
      grupo({ vincular: true, tamanho_vinculado: "40|M", formato_tamanho: "nenhum" }, [
        blocoVazio("x"),
      ]),
    );
    expect("tamanho_vinculado" in p._cabecalho).toBe(false);
    expect(p._variantes).toEqual([]);
  });

  it('formato "nenhum" zera os tamanhos marcados (a cor vale sem tamanho)', () => {
    const p = payloadImportar(
      grupo({ formato_tamanho: "nenhum" }, [bloco("azul", ["34|PPP", "36|PP"], 1)]),
    );
    expect(p._variantes).toEqual([{ cor_id: "azul", tamanho: null, preco: 1 }]);
  });

  it("cor nova em insumo EXISTENTE: cabeçalho SÓ com o nome, alvo = id; exige alguma cor/tamanho/preço", () => {
    const g0 = corNovaEmExistente("E1", "Insumo E1", "ambos", "g2");
    expect(validarInsumoNovo(g0).ok).toBe(false); // nada preenchido
    const g: InsumoNovo = { ...g0, blocos: [bloco("preto", ["38|P"], 2)] };
    expect(validarInsumoNovo(g).ok).toBe(true);
    expect(payloadImportar(g)).toEqual({
      _cabecalho: { nome: "Insumo E1" },
      _variantes: [{ cor_id: "preto", tamanho: "38|P", preco: 2 }],
      _etiqueta_alvo_id: "E1",
    });
    expect(vinculoDoNovo(g)).toBeNull();
  });
});

describe("insumoJaExiste / separarNovos", () => {
  it("nome igual (sem acento/caixa) a um existente é recusado só para insumo NOVO", () => {
    const existentes = [{ nome: "Cartão Tag" }];
    expect(insumoJaExiste(grupo({ nome: "cartao tag" }), existentes)).toBe(true);
    expect(insumoJaExiste(grupo({ nome: "Outro" }), existentes)).toBe(false);
    expect(
      insumoJaExiste({ ...grupo({ nome: "cartao tag" }), insumoAlvoId: "E9" }, existentes),
    ).toBe(false);
  });

  it("separa válidos de pendentes (os pendentes não travam os válidos)", () => {
    const { validos, pendentes } = separarNovos([grupo(), grupo({ nome: null })]);
    expect(validos).toHaveLength(1);
    expect(pendentes).toHaveLength(1);
  });
});
