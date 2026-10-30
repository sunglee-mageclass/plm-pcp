// [urg R13 T9] `mensagemR13` (erro-mensagem.ts): as recusas da OC com VÁRIOS produtos viram texto PT na tela. Os RAISE abaixo são
// os EXATOS da migration 20261105100000; a última asserção confere banco × tela (código novo no banco sem texto = falha).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mensagemErro, mensagemR13, TEXTOS_R13, MOTIVOS_PEDIDO_R13, TEXTOS_NAO_ENCONTRADO } from "@/lib/erro-mensagem";

const P1 = (message: string) => ({ code: "P0001", message });

describe("mensagemR13 — códigos fixos (P0001)", () => {
  it.each([
    ["versao_antiga: recarregue a pagina", TEXTOS_R13.versao_antiga],
    ["oc_sem_produtos: exclua a OC", TEXTOS_R13.oc_sem_produtos],
    ["item_recebido_nao_sai: ha produto recebido que nao pode ser tirado", TEXTOS_R13.item_recebido_nao_sai],
    ["oc_recebida_nao_adiciona: OC recebida nao aceita produtos novos", TEXTOS_R13.oc_recebida_nao_adiciona],
    ["oc_varios_produtos: abra a OC para tirar o produto", TEXTOS_R13.oc_varios_produtos],
    ["oc_produto_por_item: o produto da OC agora fica nos itens (ocs_p_acabado_itens)", TEXTOS_R13.oc_produto_por_item],
  ])("%s → PT", (msg, texto) => {
    expect(mensagemErro(P1(msg), "fb")).toBe(texto);
    expect(mensagemR13("P0001", msg)).toBe(texto);
    expect(texto).toMatch(/[ãçéíóú]|OC|produto/); // PT, não o ASCII cru
    expect(texto).not.toContain("_");
  });
});

describe("mensagemR13 — com o nome do produto", () => {
  it("fornecedor_diferente: com nome (pedido) e sem nome (vincular)", () => {
    expect(mensagemErro(P1("fornecedor_diferente: Vestido Midi nao e do fornecedor do pedido"), "fb"))
      .toBe("“Vestido Midi” não é do fornecedor desta OC. Use um produto do mesmo fornecedor.");
    expect(mensagemErro(P1("fornecedor_diferente: o produto e de outro fornecedor"), "fb"))
      .toBe("O produto é de outro fornecedor: use produtos do mesmo fornecedor da OC.");
  });
  it("moeda_diferente: com nome e sem nome", () => {
    expect(mensagemErro(P1("moeda_diferente: Blusa Lia tem moeda diferente da do pedido"), "fb"))
      .toBe("“Blusa Lia” tem moeda diferente da desta OC. Use produtos na mesma moeda.");
    expect(mensagemErro(P1("moeda_diferente: o produto tem moeda diferente da OC"), "fb"))
      .toBe("O produto tem moeda diferente da da OC: use produtos na mesma moeda.");
  });
  it("pedido_recusado: nome + motivos traduzidos (nome com ': ' e motivo desconhecido preservados)", () => {
    expect(mensagemErro(P1("pedido_recusado: Vestido Ana: ja_tem_oc, sem_valor"), "fb"))
      .toBe("“Vestido Ana” não pode entrar no pedido: já tem OC vinculada; falta o valor unitário.");
    expect(mensagemErro(P1("pedido_recusado: Kit: Verão: soma_variantes"), "fb"))
      .toBe("“Kit: Verão” não pode entrar no pedido: a soma das variantes não bate com a quantidade total.");
    expect(mensagemErro(P1("pedido_recusado: Lia: motivo_novo"), "fb")).toBe("“Lia” não pode entrar no pedido: motivo_novo.");
    expect(mensagemR13("P0001", "pedido_recusado: ")).toBe("O produto não pode entrar no pedido.");
  });
  it("todos os 8 motivos do servidor têm texto PT", () => {
    const cods = ["ja_tem_oc", "sem_nome", "sem_fornecedor", "sem_quantidade", "sem_variante", "soma_variantes", "grade_vazia", "sem_valor"];
    for (const c of cods) expect(MOTIVOS_PEDIDO_R13[c], c).toBeTruthy();
  });
});

describe("mensagemR13 — nao_encontrado: item (P0002) e códigos desconhecidos", () => {
  it("P0002 item → texto próprio; outras entidades seguem no mensagemBackend", () => {
    const e = { code: "P0002", message: "nao_encontrado: item" };
    expect(mensagemErro(e, "fb")).toBe(TEXTOS_NAO_ENCONTRADO.item);
    expect(mensagemR13("P0002", "nao_encontrado: item")).toBe(TEXTOS_NAO_ENCONTRADO.item);
    expect(mensagemR13("P0002", "nao_encontrado: oc")).toBeNull();
    expect(mensagemErro({ code: "P0002", message: "nao_encontrado: oc" }, "fb")).toBe(TEXTOS_NAO_ENCONTRADO.oc);
  });
  it("código desconhecido passa (não engole o texto do servidor); P0409/outro code não é tocado", () => {
    expect(mensagemR13("P0001", "outra_recusa: algo")).toBeNull();
    expect(mensagemErro(P1("Texto próprio em PT do servidor"), "fb")).toBe("Texto próprio em PT do servidor");
    expect(mensagemR13("P0409", "versao_antiga: x")).toBeNull();
    expect(mensagemR13("42501", "oc_sem_produtos: x")).toBeNull();
    expect(mensagemR13("P0001", "")).toBeNull();
  });
  it("o P0409 conflito_versao da OC continua no texto genérico de P0409", () => {
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: oc" }, "fb")).toMatch(/Outra pessoa salvou/);
  });
});

describe("banco × tela — todo código novo da R13 tem texto", () => {
  const MIG = readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), "supabase/migrations/20261105100000_urg_r13_oc_itens.sql"), "utf8");
  // Recusas de NEGÓCIO da R13 (RAISE P0001 'codigo: …'); `estado_vazio_recusado`/etc. já têm texto nas frentes anteriores.
  const CODIGOS = ["versao_antiga", "oc_sem_produtos", "item_recebido_nao_sai", "oc_recebida_nao_adiciona", "fornecedor_diferente",
    "moeda_diferente", "pedido_recusado", "oc_varios_produtos", "oc_produto_por_item"];
  it.each(CODIGOS)("%s existe no banco e a tela o traduz", (cod) => {
    expect(MIG.includes(`'${cod}:`), `${cod} no banco`).toBe(true);
    const msg = cod === "pedido_recusado" ? "pedido_recusado: X: sem_nome" : `${cod}: detalhe`;
    expect(mensagemR13("P0001", msg), `${cod} na tela`).toBeTruthy();
  });
  it("`nao_encontrado: item` existe no banco", () => {
    expect(MIG).toMatch(/'nao_encontrado: item'/);
  });
});
