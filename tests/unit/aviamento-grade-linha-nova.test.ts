// Linha NOVA da grade de Aviamentos (PURA): validação, payload EXATO de `importar_aviamento_linha` (sem `codigo`), multi-cor
// (só adiciona, preço herdado, sem duplicar), cor nova em aviamento existente e a recusa de nome+fornecedor já existentes.
import { describe, it, expect } from "vitest";
import {
  adicionarCoresAoGrupo,
  aviamentoJaExiste,
  aviamentoNovoVazio,
  corNovaEmExistente,
  payloadImportar,
  semCategoria,
  separarNovos,
  trocarApelido,
  trocarCorBase,
  validarAviamentoNovo,
  type AviamentoNovo,
} from "@/lib/aviamento-grade/linha-nova";

const completo = (extra: Partial<AviamentoNovo["cab"]> = {}): AviamentoNovo => {
  const g = aviamentoNovoVazio("g1");
  g.cab = { ...g.cab, codigo_nome: "Botão metal", categoria_aviamento_id: "cat1", ...extra };
  g.vars[0] = { ...g.vars[0], tmp: "v1", cor_id: "cor1" };
  return g;
};

describe("validarAviamentoNovo", () => {
  it("grupo em branco: pendente (nome + cor base obrigatórios)", () => {
    const r = validarAviamentoNovo(aviamentoNovoVazio("g"));
    expect(r.ok).toBe(false);
    expect(r.problemas.map((p) => p.campo).sort()).toEqual(["codigo_nome", "cor_base"]);
  });

  it("SEM cor base = pendente, mesmo com nome (cor tocada sem base também)", () => {
    const g = completo();
    g.vars[0] = { ...g.vars[0], cor_id: "" };
    expect(validarAviamentoNovo(g).problemas.map((p) => p.campo)).toEqual(["cor_base"]);
    g.vars[0] = { ...g.vars[0], nome_variante: "Dourado" };
    expect(validarAviamentoNovo(g).ok).toBe(false);
  });

  it("nome + 1 cor com cor base = válido; categoria/fornecedor/preço são opcionais", () => {
    expect(validarAviamentoNovo(completo()).ok).toBe(true);
    expect(validarAviamentoNovo(completo({ categoria_aviamento_id: null })).ok).toBe(true);
  });

  it("nome em branco (só espaço) é pendente: a RPC exige `codigo_nome`", () => {
    const r = validarAviamentoNovo(completo({ codigo_nome: "   " }));
    expect(r.problemas.map((p) => p.campo)).toEqual(["codigo_nome"]);
  });

  it("cor repetida (mesma cor+apelido) e número inválido são pendências da própria cor", () => {
    const g = completo();
    g.vars.push({ ...g.vars[0], tmp: "v2" });
    expect(validarAviamentoNovo(g).problemas).toEqual([
      { campo: "cor_base", msg: "cor repetida neste aviamento", varTmp: "v2" },
    ]);
    const h = completo({ preco: "abc" });
    expect(validarAviamentoNovo(h).problemas.map((p) => p.campo)).toEqual(["preco"]);
  });

  it("cor nova em aviamento EXISTENTE não exige nome nem olha o cabeçalho", () => {
    const g = corNovaEmExistente("av1", "Botão", "g");
    g.vars[0] = { ...g.vars[0], cor_id: "cor2" };
    expect(validarAviamentoNovo(g).ok).toBe(true);
  });

  it("separarNovos: válidos vão, pendentes ficam (resultado parcial)", () => {
    const { validos, pendentes } = separarNovos([completo(), aviamentoNovoVazio("g2")]);
    expect(validos.map((g) => g.tmp)).toEqual(["g1"]);
    expect(pendentes.map((g) => g.tmp)).toEqual(["g2"]);
  });

  it("semCategoria avisa só aviamento NOVO sem categoria (o código nasce da categoria)", () => {
    expect(semCategoria(completo({ categoria_aviamento_id: null }))).toBe(true);
    expect(semCategoria(completo())).toBe(false);
    expect(semCategoria(corNovaEmExistente("av1", "x"))).toBe(false);
  });
});

describe("payloadImportar (importar_aviamento_linha)", () => {
  it("aviamento NOVO: cabeçalho completo, SEM `codigo`, alvo null, texto vazio = null, número BR parseado", () => {
    const g = completo({
      empresa_id: "emp1",
      representante_id: "rep1",
      subcategoria_aviamento_id: "sub1",
      material_aviamento_id: "mat1",
      composicao: "  100% latão  ",
      preco: "1.234,50",
      ncm: " 9606.22.00 ",
      intervalo_largura_id: "int1",
      largura_exata: 12,
      observacoes: "",
    });
    g.vars[0] = { ...g.vars[0], cor_apelido_id: "ap1", nome_variante: " Dourado ", preco: "2,5" };
    const p = payloadImportar(g);
    expect(p._aviamento_alvo_id).toBeNull();
    expect(p._cabecalho).toEqual({
      codigo_nome: "Botão metal",
      empresa_id: "emp1",
      representante_id: "rep1",
      categoria_aviamento_id: "cat1",
      subcategoria_aviamento_id: "sub1",
      material_aviamento_id: "mat1",
      composicao: "100% latão",
      preco: 1234.5,
      ncm: "9606.22.00",
      intervalo_largura_id: "int1",
      largura_exata: 12,
      observacoes: null,
    });
    expect("codigo" in p._cabecalho).toBe(false);
    expect(p._variantes).toEqual([
      {
        cor_id: "cor1",
        cor_apelido_id: "ap1",
        nome_variante: "Dourado",
        codigo_variante: null,
        preco: 2.5,
      },
    ]);
  });

  it("cor sem apelido/preço vira null; cor em branco é descartada", () => {
    const g = completo();
    g.vars.push({ ...g.vars[0], tmp: "v2", cor_id: "" });
    const p = payloadImportar(g);
    expect(p._variantes).toEqual([
      {
        cor_id: "cor1",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
    ]);
  });

  it("cor nova em EXISTENTE: cabeçalho SÓ com o nome (nada do resto, a RPC faria COALESCE) + alvo", () => {
    const g = corNovaEmExistente("av1", "Botão", "g");
    g.cab = { ...g.cab, preco: 99, ncm: "1234" }; // lixo que NÃO pode ir
    g.vars[0] = { ...g.vars[0], cor_id: "cor2", preco: 3 };
    const p = payloadImportar(g);
    expect(p._aviamento_alvo_id).toBe("av1");
    expect(p._cabecalho).toEqual({ codigo_nome: "Botão" });
    expect(p._variantes).toHaveLength(1);
  });

  it("aviamento existente SEM nome (o nome é opcional na tela de hoje): manda texto genérico (a RPC não grava o nome com alvo)", () => {
    const g = corNovaEmExistente("av1", "", "g");
    g.vars[0] = { ...g.vars[0], cor_id: "cor2" };
    expect(payloadImportar(g)._cabecalho).toEqual({ codigo_nome: "aviamento" });
  });
});

describe("multi-cor (adicionarCoresAoGrupo): só adiciona, preço herdado, sem duplicar", () => {
  it("a cor em branco que o grupo traz é PREENCHIDA; as demais viram linhas novas com o preço do aviamento", () => {
    const g = aviamentoNovoVazio("g");
    const r = adicionarCoresAoGrupo(g, ["cor1", "cor2", "cor3"], 4.5);
    expect(r.vars.map((v) => [v.cor_id, v.preco])).toEqual([
      ["cor1", 4.5],
      ["cor2", 4.5],
      ["cor3", 4.5],
    ]);
    expect(r.vars[0].tmp).toBe(g.vars[0].tmp); // reaproveitou a linha em branco
  });

  it("cor que já existe não duplica; nada novo = a MESMA referência; desmarcar nunca remove", () => {
    const g = adicionarCoresAoGrupo(aviamentoNovoVazio("g"), ["cor1", "cor2"], 1);
    expect(adicionarCoresAoGrupo(g, ["cor1", "cor2"], 9)).toBe(g);
    const mais = adicionarCoresAoGrupo(g, ["cor2", "cor3"], 9);
    expect(mais.vars.map((v) => v.cor_id)).toEqual(["cor1", "cor2", "cor3"]);
    expect(mais.vars[1].preco).toBe(1); // a que já tinha não muda de preço
    expect(adicionarCoresAoGrupo(g, [], 9)).toBe(g); // lista vazia não remove nada
  });

  it("cor nova em aviamento existente: o grupo-alvo recebe as cores com o preço herdado", () => {
    const g = corNovaEmExistente("av1", "Botão", "g");
    const r = adicionarCoresAoGrupo(g, ["cor2", "cor3"], null);
    expect(r.vars.map((v) => v.cor_id)).toEqual(["cor2", "cor3"]);
    expect(r.aviamentoAlvoId).toBe("av1");
  });
});

describe("cor/apelido e duplicidade", () => {
  const apelidos = [{ id: "ap1", cor_base_id: "cor1" }];
  it("escolher a cor base tira o apelido que não é dela; escolher o apelido preenche a cor base", () => {
    const g = completo();
    g.vars[0] = { ...g.vars[0], cor_apelido_id: "ap1" };
    expect(trocarCorBase(g.vars[0], "cor2", apelidos).cor_apelido_id).toBe("");
    expect(trocarCorBase(g.vars[0], "cor1", apelidos).cor_apelido_id).toBe("ap1");
    expect(trocarApelido({ ...g.vars[0], cor_id: "" }, "ap1", apelidos).cor_id).toBe("cor1");
  });

  it("aviamentoJaExiste: mesmo nome (sem acento/caixa) E mesmo fornecedor; cor nova em existente nunca", () => {
    const existentes = [{ codigo_nome: "BOTÃO Metal", empresa_id: "emp1" }];
    expect(aviamentoJaExiste(completo({ empresa_id: "emp1" }), existentes)).toBe(true);
    expect(aviamentoJaExiste(completo({ empresa_id: "emp2" }), existentes)).toBe(false);
    expect(aviamentoJaExiste(completo({ empresa_id: null }), existentes)).toBe(false);
    expect(aviamentoJaExiste(corNovaEmExistente("av1", "Botão metal"), existentes)).toBe(false);
    expect(
      aviamentoJaExiste(completo({ empresa_id: null }), [
        { codigo_nome: "botao metal", empresa_id: null },
      ]),
    ).toBe(true);
  });
});
