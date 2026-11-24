// Grade "Lista" de Insumos (IN-3): colar do Excel (TSV) — parse do bloco, mapeamento pelas colunas da grade, lookups por NOME (tipo,
// cor, fornecedor, tamanhos), a coluna TAMANHOS (lista que explode em cor × tamanho no Salvar), linhas novas e os slots. Puro.
import { describe, it, expect } from "vitest";
import { COLUNAS_INSUMO, indiceDaColuna } from "@/lib/insumo-grade/colunas";
import {
  agruparNovosInsumos,
  camposDaCor,
  camposDoInsumo,
  mapearColagem,
  montarLookupsColagem,
  parseBlocoTsv,
} from "@/lib/insumo-grade/colar-tsv";
import {
  chaveSlotCor,
  chaveSlotPai,
  montarSlots,
  recusaDoSlot,
} from "@/lib/insumo-grade/colar-slots";
import { payloadImportar } from "@/lib/insumo-grade/linha-nova";

const lookups = montarLookupsColagem({
  empresas: [
    { id: "emp1", nome_fantasia: "Etiquetas Alfa" },
    { id: "emp2", nome_fantasia: "Tecelagem Beta" },
  ],
  cores: [
    { id: "azul", nome: "Azul" },
    { id: "verde", nome: "Verde" },
  ],
  tipos: [
    { id: "tp1", nome: "Cartão" },
    { id: "tp2", nome: "Botão" },
  ],
  tamanhosGrade: ["34|PPP", "36|PP", "38|P", "40|M"],
});

/** Colunas: nome, tipo, unidade, fornecedor, preço, formato, tamanho vinculado, observações, cor, tamanhos, preço da cor. */
const linha = (c: Record<string, string>) =>
  COLUNAS_INSUMO.map((col) => c[col.key] ?? "").join("\t");

describe("mapearColagem", () => {
  it("resolve tipo, unidade, fornecedor, cor e preço pelo NOME (sem acento/caixa) e os tamanhos pela lista", () => {
    const bloco = parseBlocoTsv(
      linha({
        nome: "Cartão X",
        tipo_insumo: "cartao",
        unidade: "Milheiro",
        fornecedor: "etiquetas alfa",
        preco: "1,5",
      }),
    );
    const r = mapearColagem({ linhaIdx: 0, colIdx: 0 }, bloco, COLUNAS_INSUMO, 1, { lookups });
    const por = Object.fromEntries(r.patches.map((p) => [p.colKey, p.valor]));
    expect(por).toMatchObject({
      nome: "Cartão X",
      tipo_insumo: "tp1",
      unidade: "milheiro",
      fornecedor: "emp1",
      preco: 1.5,
    });
    expect(r.ignoradas).toEqual([]);
  });

  it("TAMANHOS: lista por vírgula casa número OU letra (tolerante) e vira as chaves da grade; item fora da grade avisa e é ignorado", () => {
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: indiceDaColuna("cor") },
      parseBlocoTsv(["azul", "34, pp,99", "0,5"].join("\t")),
      COLUNAS_INSUMO,
      1,
      { lookups },
    );
    const t = r.patches.find((p) => p.colKey === "tamanhos")!;
    expect(t.valor).toEqual(["34|PPP", "36|PP"]);
    expect(t.aviso).toContain('"99"');
    expect(r.patches.find((p) => p.colKey === "cor")!.valor).toBe("azul");
    expect(r.patches.find((p) => p.colKey === "preco_variante")!.valor).toBe(0.5);
  });

  it("texto sem correspondência NÃO grava e vira aviso (tipo/cor/tamanho/unidade/número)", () => {
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: 0 },
      parseBlocoTsv(
        linha({
          nome: "A",
          tipo_insumo: "Zzz",
          unidade: "furo",
          preco: "abc",
          cor: "Roxo",
          tamanhos: "99",
        }),
      ),
      COLUNAS_INSUMO,
      1,
      { lookups },
    );
    // célula em branco LIMPA o opcional (fornecedor, observações…) como no tecido/aviamento; as que não casam não entram
    const entraram = r.patches.map((p) => p.colKey);
    expect(entraram).toContain("nome");
    for (const k of ["tipo_insumo", "unidade", "preco", "cor", "tamanhos"])
      expect(entraram).not.toContain(k);
    expect(r.ignoradas.map((i) => [i.colKey, i.motivo])).toEqual([
      ["tipo_insumo", "sem-correspondencia"],
      ["unidade", "sem-correspondencia"],
      ["preco", "numero-invalido"],
      ["cor", "sem-correspondencia"],
      ["tamanhos", "sem-correspondencia"],
    ]);
  });

  it("tamanho vinculado NÃO cola (ajuste na célula); vazias em nome/unidade/cor não apagam", () => {
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: 0 },
      parseBlocoTsv(
        linha({ nome: "", unidade: "", tamanho_vinculado: "40|M", cor: "", observacoes: "x" }),
      ),
      COLUNAS_INSUMO,
      1,
      { lookups },
    );
    const entraram = r.patches.map((p) => p.colKey);
    expect(entraram).toContain("observacoes");
    for (const k of ["nome", "unidade", "cor"]) expect(entraram).not.toContain(k); // vazias protegidas
    expect(r.ignoradas.map((i) => [i.colKey, i.motivo])).toEqual([
      ["tamanho_vinculado", "coluna-nao-colavel"],
    ]);
  });

  it("linhas além do fim viram NOVAS (teto 500) e a recusa da linha vale (aceitaCelula)", () => {
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: 0 },
      parseBlocoTsv(`${linha({ nome: "A" })}\n${linha({ nome: "B" })}`),
      COLUNAS_INSUMO,
      1,
      { lookups, aceitaCelula: (_i, k) => (k === "nome" ? "recusa" : null) },
    );
    expect(r.patches.map((p) => p.colKey)).not.toContain("nome");
    expect(r.ignoradas[0]).toMatchObject({
      colKey: "nome",
      motivo: "linha-nao-aceita",
      detalhe: "recusa",
    });
    expect(r.novasLinhas).toHaveLength(1);
    const grande = Array.from({ length: 600 }, (_, i) => linha({ nome: `N${i}` })).join("\n");
    const g = mapearColagem({ linhaIdx: 0, colIdx: 0 }, parseBlocoTsv(grande), COLUNAS_INSUMO, 0, {
      lookups,
    });
    expect(g.novasLinhas).toHaveLength(500);
    expect(g.novasCortadas).toBe(100);
  });
});

describe("camposDoInsumo / camposDaCor", () => {
  it("fornecedor diferente zera o representante; o mesmo mantém", () => {
    const atual = { empresa_id: "emp1", representante_id: "rep1" };
    expect(camposDoInsumo("fornecedor", "emp2", atual)).toEqual({
      empresa_id: "emp2",
      representante_id: null,
    });
    expect(camposDoInsumo("fornecedor", "emp1", atual)).toEqual({
      empresa_id: "emp1",
      representante_id: "rep1",
    });
    expect(camposDoInsumo("tipo_insumo", "tp2", atual)).toEqual({ tipo_insumo_id: "tp2" });
    expect(camposDoInsumo("cor", "x", atual)).toEqual({});
    expect(camposDaCor("tamanhos", ["34|PPP"])).toEqual({ tamanhos: ["34|PPP"] });
    expect(camposDaCor("nome", "x")).toEqual({});
  });
});

describe("agruparNovosInsumos", () => {
  it("linhas seguidas com o mesmo nome são cores do MESMO insumo; payload sai com as variantes expandidas", () => {
    const r = mapearColagem(
      { linhaIdx: 0, colIdx: 0 },
      parseBlocoTsv(
        [
          linha({
            nome: "Cartão Y",
            tipo_insumo: "Cartão",
            cor: "Azul",
            tamanhos: "34,36",
            preco_variante: "1",
          }),
          linha({ nome: "cartão y", cor: "Verde", tamanhos: "", preco_variante: "2" }),
          linha({ nome: "Botão Z", cor: "Azul" }),
          linha({ cor: "Verde" }), // sem nome = insumo à parte (pendente)
        ].join("\n"),
      ),
      COLUNAS_INSUMO,
      0,
      { lookups },
    );
    const { grupos, varTmpPorLinha } = agruparNovosInsumos(r.novasLinhas);
    expect(grupos).toHaveLength(3);
    expect(grupos[0].blocos).toHaveLength(2);
    expect(grupos[0].cab.nome).toBe("Cartão Y");
    expect(grupos[0].cab.tipo_insumo_id).toBe("tp1");
    expect(varTmpPorLinha).toHaveLength(4);
    expect(payloadImportar(grupos[0])._variantes).toEqual([
      { cor_id: "azul", tamanho: "34|PPP", preco: 1 },
      { cor_id: "azul", tamanho: "36|PP", preco: 1 },
      { cor_id: "verde", tamanho: null, preco: 2 },
    ]);
    expect(grupos[2].cab.nome).toBeNull();
  });
});

describe("montarSlots / recusaDoSlot", () => {
  const bloco = (cor: string) => ({ cor_id: cor, preco: null, tamanhos: [] });
  const linhas = [
    { insumoId: "E1", bloco: bloco("azul") },
    { insumoId: "E1", bloco: bloco("verde") },
    { insumoId: "E2", bloco: null },
  ];
  it("pai antes das cores; insumo sem cor = só o pai; cor removida sai; novos no fim", () => {
    const slots = montarSlots(linhas, [], new Set([chaveSlotCor("E1", "verde")]));
    expect(slots.map((s) => s.chave)).toEqual([
      chaveSlotPai("E1"),
      chaveSlotCor("E1", "azul"),
      chaveSlotPai("E2"),
    ]);
    // a cor "sem cor" e o pai têm chaves DISTINTAS
    expect(chaveSlotCor("E1", "")).not.toBe(chaveSlotPai("E1"));
  });

  it("recusa campos fora do lugar (cabeçalho na cor, cor no pai, cabeçalho herdado)", () => {
    const slots = montarSlots(linhas, []);
    expect(recusaDoSlot(slots[0], { escopo: "variante" })).toContain("linha da cor");
    expect(recusaDoSlot(slots[1], { escopo: "insumo" })).toContain("linha do insumo");
    expect(recusaDoSlot(slots[3], { escopo: "variante" })).toContain("use o + ");
    expect(recusaDoSlot(slots[1], { escopo: "variante" })).toBeNull();
  });
});
