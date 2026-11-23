// Linha NOVA da grade de Tecidos (lib pura `linha-nova.ts`): validação (pendente x válido) e payload EXATO de
// `importar_tecido_linha`. Sem React e sem banco.
import { describe, it, expect } from "vitest";
import {
  corNovaEmExistente,
  payloadComplemento,
  payloadImportar,
  problemasDaVariante,
  problemasDoCabecalho,
  separarNovos,
  tecidoNovoVazio,
  trocarApelido,
  trocarCorBase,
  validarTecidoNovo,
  varianteVazia,
  type TecidoNovo,
} from "@/lib/tecido-grade/linha-nova";

function valido(extra: Partial<TecidoNovo> = {}): TecidoNovo {
  const g = tecidoNovoVazio("g1");
  g.cab.nome = "Malha Fiore";
  g.vars[0] = { ...g.vars[0], tmp: "v1", cor_id: "cor-azul" };
  return { ...g, ...extra };
}

describe("validarTecidoNovo", () => {
  it("grupo em branco é pendente (nome + cor base)", () => {
    const r = validarTecidoNovo(tecidoNovoVazio("g"));
    expect(r.ok).toBe(false);
    expect(r.problemas.map((p) => p.campo).sort()).toEqual(["cor_base", "nome"]);
  });

  it("nome vazio (ou só espaço) → pendente com 'nome obrigatório' no cabeçalho", () => {
    const g = valido();
    g.cab.nome = "   ";
    const r = validarTecidoNovo(g);
    expect(r.ok).toBe(false);
    expect(problemasDoCabecalho(r.problemas)).toEqual([{ campo: "nome", msg: "nome obrigatório" }]);
  });

  it("sem cor base em nenhuma cor → pendente, apontando a linha da cor", () => {
    const g = valido();
    g.vars[0].cor_id = "";
    g.vars[0].nome_variante = "Azul bebê"; // tocada, mas sem cor base
    const r = validarTecidoNovo(g);
    expect(r.ok).toBe(false);
    expect(problemasDaVariante(r.problemas, "v1")).toEqual([{ campo: "cor_base", msg: "cor base obrigatória", varTmp: "v1" }]);
  });

  it("nome + 1 cor com cor base = válido; cor em branco sobrando no fim não atrapalha", () => {
    const g = valido();
    g.vars.push(varianteVazia("v2"));
    expect(validarTecidoNovo(g)).toEqual({ ok: true, problemas: [] });
  });

  it("2ª cor com dados mas sem cor base é pendente; a 1ª válida não salva o grupo", () => {
    const g = valido();
    g.vars.push({ ...varianteVazia("v2"), preco: 5 });
    const r = validarTecidoNovo(g);
    expect(r.ok).toBe(false);
    expect(r.problemas).toEqual([{ campo: "cor_base", msg: "cor base obrigatória", varTmp: "v2" }]);
  });

  it("mesma cor + apelido repetida no grupo é recusada na repetida", () => {
    const g = valido();
    g.vars.push({ ...varianteVazia("v2"), cor_id: "cor-azul" });
    const r = validarTecidoNovo(g);
    expect(r.problemas).toEqual([{ campo: "cor_base", msg: "cor repetida neste tecido", varTmp: "v2" }]);
    g.vars[1].cor_apelido_id = "ap1"; // com apelido diferente já é outra variante
    expect(validarTecidoNovo(g).ok).toBe(true);
  });

  it("número BR é parseado; texto não numérico vira problema no campo", () => {
    const g = valido();
    g.cab.preco = "1.234,50";
    g.cab.largura_estimada = "1,5";
    expect(validarTecidoNovo(g).ok).toBe(true);
    g.cab.preco = "abc";
    g.vars[0].preco = "x1";
    const r = validarTecidoNovo(g);
    expect(r.problemas.map((p) => p.campo).sort()).toEqual(["preco", "preco_variante"]);
  });

  it("unidade: vazia = metro (válida); fora de metro/kg é pendente", () => {
    const g = valido();
    g.cab.unidade_medida = null;
    expect(validarTecidoNovo(g).ok).toBe(true);
    g.cab.unidade_medida = "litro";
    expect(validarTecidoNovo(g).problemas).toEqual([{ campo: "unidade", msg: "unidade inválida (metro ou kg)" }]);
  });

  it("cor nova em tecido existente não exige nome nem valida o cabeçalho", () => {
    const g = corNovaEmExistente("art-1", "Malha Fiore", "g");
    expect(validarTecidoNovo(g).ok).toBe(false); // falta a cor base
    g.vars[0].cor_id = "cor-verde";
    expect(validarTecidoNovo(g)).toEqual({ ok: true, problemas: [] });
  });
});

describe("payloadImportar", () => {
  it("tecido NOVO: shape exato da RPC, alvo null, números BR parseados, textos aparados", () => {
    const g = valido();
    g.cab = {
      nome: "  Malha Fiore ",
      empresa_id: "emp1",
      preco: "28,00",
      unidade_medida: "metro",
      largura_estimada: 1.5,
      composicao: " 95% algodão\n5% elastano ",
      ncm: " 6006.32 ",
      rendimento: "3,2", // metro: rendimento NÃO vai
      mes_id: "m1",
      ano_id: "y1",
    };
    g.categoriaIds = ["cat1", "cat2"];
    g.vars = [
      { tmp: "v1", cor_id: "cor-azul", cor_apelido_id: "ap1", nome_variante: " Petróleo ", codigo_variante: "A-1", preco: "30,5" },
      varianteVazia("v2"), // em branco: descartada
    ];
    const p = payloadImportar(g);
    expect(Object.keys(p).sort()).toEqual(["_artigo_alvo_id", "_categoria_ids", "_cabecalho", "_variantes"].sort());
    expect(p._artigo_alvo_id).toBeNull();
    expect(p._categoria_ids).toEqual(["cat1", "cat2"]);
    expect(p._cabecalho).toEqual({
      nome: "Malha Fiore",
      unidade_medida: "metro",
      ncm: "6006.32",
      empresa_id: "emp1",
      representante_id: null,
      composicao: "95% algodão\n5% elastano",
      rendimento: null,
      preco: 28,
      largura_estimada: 1.5,
      mes_id: "m1",
      ano_id: "y1",
    });
    expect(p._variantes).toEqual([
      { cor_id: "cor-azul", cor_apelido_id: "ap1", nome_variante: "Petróleo", codigo_variante: "A-1", preco: 30.5 },
    ]);
  });

  it("unidade vazia vira metro; em kg o rendimento vai", () => {
    const g = valido();
    g.cab.unidade_medida = null;
    g.cab.rendimento = "3,2";
    expect(payloadImportar(g)._cabecalho.unidade_medida).toBe("metro");
    expect(payloadImportar(g)._cabecalho.rendimento).toBeNull();
    g.cab.unidade_medida = "kg";
    expect(payloadImportar(g)._cabecalho.rendimento).toBe(3.2);
  });

  it("campos vazios viram null (nunca '' nem NaN)", () => {
    const p = payloadImportar(valido());
    expect(p._cabecalho).toMatchObject({ ncm: null, composicao: null, empresa_id: null, preco: null, largura_estimada: null, mes_id: null, ano_id: null });
    expect(p._variantes).toEqual([{ cor_id: "cor-azul", cor_apelido_id: null, nome_variante: null, codigo_variante: null, preco: null }]);
  });

  it("cor nova em tecido EXISTENTE: alvo = id e cabeçalho só com o nome (não troca a unidade do tecido)", () => {
    const g = corNovaEmExistente("art-1", "Malha Fiore", "g");
    g.vars[0].cor_id = "cor-verde";
    g.categoriaIds = ["cat1"]; // ignorado: o tecido existente mantém as categorias
    const p = payloadImportar(g);
    expect(p._artigo_alvo_id).toBe("art-1");
    expect(p._cabecalho).toEqual({ nome: "Malha Fiore" });
    expect(p._categoria_ids).toEqual([]);
    expect(p._variantes).toHaveLength(1);
  });
});

describe("payloadComplemento (o que a RPC não grava)", () => {
  it("largura, 1ª categoria e subcategorias só no tecido NOVO", () => {
    const g = valido();
    g.cab.largura_estimada = "1,6";
    g.categoriaIds = ["cat1", "cat2"];
    g.subPorCat = { cat1: "sub1" };
    expect(payloadComplemento(g)).toEqual({
      artigo: { largura_estimada: 1.6, categoria_tecido_id: "cat1" },
      pares: [
        { categoria_tecido_id: "cat1", subcategoria_tecido_id: "sub1" },
        { categoria_tecido_id: "cat2", subcategoria_tecido_id: null },
      ],
    });
  });

  it("sem largura/categoria/sub = nada a fazer; cor em tecido existente nunca mexe no cabeçalho", () => {
    expect(payloadComplemento(valido())).toEqual({ artigo: null, pares: null });
    const g = corNovaEmExistente("art-1", "X", "g");
    g.cab.largura_estimada = 2;
    expect(payloadComplemento(g)).toEqual({ artigo: null, pares: null });
  });
});

describe("separarNovos (resultado parcial)", () => {
  it("pendente não bloqueia os válidos", () => {
    const ok = valido();
    const ruim = tecidoNovoVazio("ruim");
    const r = separarNovos([ruim, ok]);
    expect(r.validos.map((g) => g.tmp)).toEqual(["g1"]);
    expect(r.pendentes.map((g) => g.tmp)).toEqual(["ruim"]);
  });
});

describe("cor base x apelido (mesma regra do Sheet)", () => {
  const apelidos = [
    { id: "ap1", cor_base_id: "cor-azul" },
    { id: "ap2", cor_base_id: "cor-verde" },
  ];
  it("trocar a cor base tira o apelido que não é dela; mantém o que é", () => {
    const v = { ...varianteVazia("v"), cor_id: "cor-azul", cor_apelido_id: "ap1" };
    expect(trocarCorBase(v, "cor-verde", apelidos)).toMatchObject({ cor_id: "cor-verde", cor_apelido_id: "" });
    expect(trocarCorBase(v, "cor-azul", apelidos)).toMatchObject({ cor_id: "cor-azul", cor_apelido_id: "ap1" });
  });
  it("escolher o apelido preenche a cor base dele", () => {
    expect(trocarApelido(varianteVazia("v"), "ap2", apelidos)).toMatchObject({ cor_id: "cor-verde", cor_apelido_id: "ap2" });
  });
});
