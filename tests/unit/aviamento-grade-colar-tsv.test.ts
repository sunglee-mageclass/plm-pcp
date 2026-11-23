// Colar do Excel (TSV) na grade de Aviamentos (PURO): parse do bloco (reuso do motor do tecido), mapeamento pelo NOME com os lookups do
// importador (categoria/subcategoria cascateada/material/intervalo/fornecedor/cor/apelido), regras do aviamento (código não cola em
// linha NOVA e vazio nunca apaga o existente; fornecedor é o par; categoria zera a subcategoria), slots na ordem da tela.
import { describe, it, expect } from "vitest";
import { COLUNAS_AVIAMENTO } from "@/lib/aviamento-grade/colunas";
import {
  agruparNovosAviamentos,
  camposDoAviamento,
  ehBlocoColavel,
  mapearColagem,
  montarLookupsColagem,
  parseBlocoTsv,
  resumoColagem,
} from "@/lib/aviamento-grade/colar-tsv";
import { montarSlots, recusaDoSlot } from "@/lib/aviamento-grade/colar-slots";
import { aviamentoNovoVazio, corNovaEmExistente } from "@/lib/aviamento-grade/linha-nova";

const opcoes = {
  empresas: [
    { id: "emp1", nome_fantasia: "Armarinho Alfa" },
    { id: "emp2", nome_fantasia: "Botões Gama" },
  ],
  cores: [
    { id: "cor1", nome: "Azul" },
    { id: "cor2", nome: "Verde" },
  ],
  coresApelido: [{ id: "ap1", nome: "Marinho", cor_base_id: "cor1" }],
  categorias: [
    { id: "cat1", nome: "Botões" },
    { id: "cat2", nome: "Zíperes" },
  ],
  subcategorias: [
    { id: "sub1", nome: "Pressão", categoria_aviamento_id: "cat1" },
    { id: "sub3", nome: "Invisível", categoria_aviamento_id: "cat2" },
    { id: "sub4", nome: "Metal", categoria_aviamento_id: "cat1" },
    { id: "sub5", nome: "Metal", categoria_aviamento_id: "cat2" },
  ],
  materiais: [{ id: "mat1", nome: "Plástico" }],
  intervalos: [{ id: "int1", nome: "1 a 2 cm" }],
};
const lookups = montarLookupsColagem(opcoes);
const idx = (k: string) => COLUNAS_AVIAMENTO.findIndex((c) => c.key === k);
const mapear = (bloco: string[][], col: string, existentes = 1, extra = {}) =>
  mapearColagem({ linhaIdx: 0, colIdx: idx(col) }, bloco, COLUNAS_AVIAMENTO, existentes, {
    lookups,
    ...extra,
  });

describe("parse do bloco (motor do tecido reaproveitado)", () => {
  it("TAB/linhas/aspas do Excel; valor simples não é bloco", () => {
    expect(parseBlocoTsv("a\tb\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseBlocoTsv('"x\ny"\tz')).toEqual([["x\ny", "z"]]);
    expect(ehBlocoColavel("só um valor")).toBe(false);
    expect(ehBlocoColavel("a\tb")).toBe(true);
  });
});

describe("mapearColagem: resolve pelo NOME (lookups do descriptor)", () => {
  it("categoria, material, intervalo e fornecedor viram ids; texto sem correspondência NÃO grava e avisa", () => {
    const r = mapear(
      [["Armarinho alfa", "", "ncm1", "botoes", "", "plastico", "", "1 a 2 cm"]],
      "fornecedor",
    );
    const por = Object.fromEntries(r.patches.map((p) => [p.colKey, p.valor]));
    expect(por.fornecedor).toBe("emp1");
    expect(por.categoria).toBe("cat1");
    expect(por.material).toBe("mat1");
    expect(por.intervalo_largura).toBe("int1");
    expect(por.ncm).toBe("ncm1");
    const ruim = mapear([["Fornecedor que não existe"]], "fornecedor");
    expect(ruim.patches).toHaveLength(0);
    expect(ruim.ignoradas[0]).toMatchObject({
      colKey: "fornecedor",
      motivo: "sem-correspondencia",
    });
    expect(ruim.ignoradas[0].detalhe).toContain("não encontrado");
  });

  it("subcategoria cascateia pela categoria: a colada na MESMA linha vale (homônimo escolhe a da categoria); fora dela é recusada", () => {
    const ok = mapear([["Zíperes", "Metal"]], "categoria");
    expect(ok.patches.map((p) => [p.colKey, p.valor])).toEqual([
      ["categoria", "cat2"],
      ["subcategoria", "sub5"],
    ]);
    const fora = mapear([["Botões", "Invisível"]], "categoria");
    expect(fora.patches.map((p) => p.colKey)).toEqual(["categoria"]);
    expect(fora.ignoradas[0].detalhe).toContain('não pertence à categoria "Botões"');
    // sem categoria na linha: único candidato vale; homônimo exige a categoria junto
    expect(mapear([["Pressão"]], "subcategoria").patches[0].valor).toBe("sub1");
    expect(mapear([["Metal"]], "subcategoria").ignoradas[0].detalhe).toContain(
      "mais de uma categoria",
    );
    // categoria JÁ da linha (contexto do rascunho) vale para a subcategoria colada sozinha
    const ctx = mapear([["Metal"]], "subcategoria", 1, {
      contextoLinha: () => ({ corId: "", categoriaId: "cat2" }),
    });
    expect(ctx.patches[0].valor).toBe("sub5");
  });

  it("cor base/apelido: o apelido tem de ser da cor base (da própria linha ou colada junto)", () => {
    const junto = mapear([["Azul", "Marinho"]], "cor_base");
    expect(junto.patches.map((p) => p.valor)).toEqual(["cor1", "ap1"]);
    const errado = mapear([["Verde", "Marinho"]], "cor_base");
    expect(errado.patches.map((p) => p.colKey)).toEqual(["cor_base"]);
    expect(errado.ignoradas[0].detalhe).toContain("não pertence à cor");
  });

  it("número BR (preço, largura, preço da variante); inválido não grava", () => {
    const r = mapear([["R$ 1.234,567"]], "preco");
    expect(r.patches[0].valor).toBe(1234.57);
    expect(mapear([["abc"]], "preco").ignoradas[0].motivo).toBe("numero-invalido");
  });

  it("foto e coluna além do fim são ignoradas (sem barulho se vazias)", () => {
    const r = mapear([["x", "y"]], "foto");
    expect(r.patches).toHaveLength(0);
    expect(r.ignoradas.map((i) => i.motivo)).toEqual(["coluna-nao-colavel", "transbordo"]);
    expect(mapear([["", ""]], "foto").ignoradas).toHaveLength(0);
  });

  it("código: vazio NUNCA apaga o de uma linha existente; em linha NOVA não cola (o servidor gera)", () => {
    expect(mapear([[""]], "codigo").patches).toHaveLength(0);
    expect(mapear([["BOT-0009"]], "codigo").patches[0]).toMatchObject({
      colKey: "codigo",
      valor: "BOT-0009",
    });
    const nova = mapear([["BOT-0009", "Botão X"]], "codigo", 0);
    expect(nova.novasLinhas[0].map((c) => c.colKey)).toEqual(["codigo_nome"]);
    expect(nova.ignoradas[0]).toMatchObject({ colKey: "codigo", motivo: "linha-nao-aceita" });
  });

  it("linhas além do fim são NOVAS; teto de 500 corta e avisa", () => {
    const bloco = Array.from({ length: 503 }, (_, i) => [`Aviamento ${i}`]);
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: idx("codigo_nome") },
      bloco,
      COLUNAS_AVIAMENTO,
      0,
      { lookups },
    );
    expect(r.novasLinhas).toHaveLength(500);
    expect(r.novasCortadas).toBe(3);
    expect(resumoColagem(r).detalhe).toContain("teto de 500");
  });

  it("resumo: sucesso quando nada foi ignorado; aviso com o detalhe quando algo ficou de fora", () => {
    expect(resumoColagem(mapear([["Azul"]], "cor_base")).tom).toBe("sucesso");
    const r = resumoColagem(mapear([["Roxo"]], "cor_base"));
    expect(r.tom).toBe("aviso");
    expect(r.detalhe).toContain("sem correspondência");
  });
});

describe("camposDoAviamento: fornecedor é o PAR; categoria zera a subcategoria que não é dela", () => {
  const atual = { empresa_id: "emp1", representante_id: "rep1", subcategoria_aviamento_id: "sub1" };
  it("fornecedor diferente zera o representante; o mesmo fornecedor o mantém", () => {
    expect(camposDoAviamento("fornecedor", "emp2", atual, opcoes.subcategorias)).toEqual({
      empresa_id: "emp2",
      representante_id: null,
    });
    expect(camposDoAviamento("fornecedor", "emp1", atual, opcoes.subcategorias)).toEqual({
      empresa_id: "emp1",
      representante_id: "rep1",
    });
  });
  it("categoria nova tira a subcategoria que não pertence a ela; a que pertence fica; coluna de texto passa direto", () => {
    expect(camposDoAviamento("categoria", "cat2", atual, opcoes.subcategorias)).toEqual({
      categoria_aviamento_id: "cat2",
      subcategoria_aviamento_id: null,
    });
    expect(camposDoAviamento("categoria", "cat1", atual, opcoes.subcategorias)).toEqual({
      categoria_aviamento_id: "cat1",
      subcategoria_aviamento_id: "sub1",
    });
    expect(camposDoAviamento("ncm", "9606", atual, opcoes.subcategorias)).toEqual({ ncm: "9606" });
    expect(camposDoAviamento("cor_base", "cor1", atual, opcoes.subcategorias)).toEqual({});
  });
});

describe("agruparNovosAviamentos: linhas seguidas com o mesmo nome = cores do mesmo aviamento", () => {
  it("agrupa por nome (sem acento/caixa), o cabeçalho é o da 1ª linha, cada linha vira uma cor", () => {
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: idx("codigo_nome") },
      [
        ["Botão A", "Armarinho Alfa", "1,50", "", "Botões"],
        ["botao a", "", "", "", "", "", "", "", "", "", "", "Verde"],
        ["Zíper B", "", "", "", "Zíperes"],
        ["", "Armarinho Alfa"],
      ],
      COLUNAS_AVIAMENTO,
      0,
      { lookups },
    );
    const { grupos, varTmpPorLinha } = agruparNovosAviamentos(r.novasLinhas, opcoes.coresApelido);
    expect(grupos).toHaveLength(3);
    expect(grupos[0].cab).toMatchObject({
      codigo_nome: "Botão A",
      empresa_id: "emp1",
      preco: 1.5,
      categoria_aviamento_id: "cat1",
    });
    expect(grupos[0].vars.map((v) => v.cor_id)).toEqual(["", "cor2"]);
    expect(grupos[1].cab.categoria_aviamento_id).toBe("cat2");
    expect(grupos[2].cab.codigo_nome).toBeNull(); // sem nome: aviamento à parte, PENDENTE
    expect(varTmpPorLinha).toHaveLength(4);
    expect(grupos[1].semRolagem).toBe(true);
    expect(grupos[0].semRolagem).toBeUndefined();
  });
});

describe("montarSlots / recusaDoSlot (linha-pai, cores, cores novas, aviamentos novos)", () => {
  const L = (aviamentoId: string, variantId: string | null) => ({
    chave: `${aviamentoId}:${variantId ?? "sem-cor"}`,
    aviamentoId,
    variantId,
  });
  it("aviamento COM cores: a linha-pai (chave do 'sem cor') vem antes das cores; SEM cor: a única linha já é a pai", () => {
    const slots = montarSlots([L("a1", "v1"), L("a1", "v2"), L("a2", null)], []);
    expect(slots.map((s) => [s.chave, s.tipo === "existente" && s.pai])).toEqual([
      ["a1:sem-cor", true],
      ["a1:v1", false],
      ["a1:v2", false],
      ["a2:sem-cor", true],
    ]);
  });

  it("cor nova de aviamento existente entra depois das cores dele; aviamentos novos, no fim", () => {
    const nova = corNovaEmExistente("a1", "x", "g1");
    nova.vars[0].tmp = "n1";
    const novo = aviamentoNovoVazio("g2");
    novo.vars[0].tmp = "n2";
    const slots = montarSlots([L("a1", "v1"), L("a2", null)], [nova, novo]);
    expect(slots.map((s) => s.chave)).toEqual([
      "a1:sem-cor",
      "a1:v1",
      "novo:n1",
      "a2:sem-cor",
      "novo:n2",
    ]);
  });

  it("cabeçalho só na linha-pai; cor só nas cores; cabeçalho herdado do aviamento novo só na 1ª linha", () => {
    const [pai, cor] = montarSlots([L("a1", "v1")], []);
    const [semCor] = montarSlots([L("a2", null)], []);
    expect(recusaDoSlot(cor, { escopo: "aviamento" })).toContain("Cabeçalho do aviamento");
    expect(recusaDoSlot(pai, { escopo: "aviamento" })).toBeNull();
    expect(recusaDoSlot(pai, { escopo: "variante" })).toContain("linha da cor");
    expect(recusaDoSlot(semCor, { escopo: "variante" })).toContain("não tem cores");
    expect(recusaDoSlot(cor, { escopo: "variante" })).toBeNull();
    const g = aviamentoNovoVazio("g");
    g.vars.push({ ...g.vars[0], tmp: "segunda" });
    const novos = montarSlots([], [g]);
    expect(recusaDoSlot(novos[0], { escopo: "aviamento" })).toBeNull();
    expect(recusaDoSlot(novos[1], { escopo: "aviamento" })).toContain("1ª linha do aviamento novo");
  });
});
