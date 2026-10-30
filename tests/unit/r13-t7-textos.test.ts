// [urg R13 T7] Textos da OC com VÁRIOS produtos — fixados VERBATIM (mockup R13, superfície 3) + regras puras de `oc-multi-itens`.
import { describe, it, expect } from "vitest";
import { textoTirarProdutoDaOc, textoMarcarProdutoRecebido, textoExcluirOc } from "@/lib/confirmacoes-textos";
import {
  contarRecebidos, motivoNaoExcluirOc, motivoNaoTirar, produtosTexto, textoProdutosDaOc, textoRecebidos,
  TEXTO_GRAVA_AO_RECEBER, TEXTO_ITEM_RECEBIDO_NAO_SAI, TEXTO_OC_COM_RECEBIDO_NAO_EXCLUI, TEXTO_UNICO_PRODUTO,
} from "@/lib/oc-multi-itens";

describe("[R13 T7] confirmacoes-textos — Seção 5 (OC com vários produtos)", () => {
  it("5.1 Tirar da OC (desfaz → vermelho)", () => {
    const t = textoTirarProdutoDaOc({ nome: "Blusa Manga Curta Lia", totalAntes: "R$ 10.000,00", totalDepois: "R$ 7.500,00" });
    expect(t.titulo).toBe("Tirar “Blusa Manga Curta Lia” da OC?");
    expect(t.descricao).toBe("O produto volta a ficar sem OC e pode entrar em outro pedido. O total da OC passa de R$ 10.000,00 para R$ 7.500,00 e as parcelas são refeitas. Os outros produtos não mudam.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Tirar da OC", "Cancelar", true]);
  });
  it("5.1 com alterações pendentes: o Salvar leva junto", () => {
    const t = textoTirarProdutoDaOc({ nome: "Lia", totalAntes: "R$ 2,00", totalDepois: "R$ 1,00", pendentes: true });
    expect(t.descricao.endsWith(" As alterações pendentes da OC são salvas junto.")).toBe(true);
  });
  it("5.1 sem os totais ou sem o nome: versão SEM o dado", () => {
    const t = textoTirarProdutoDaOc({});
    expect(t.titulo).toBe("Tirar este produto da OC?");
    expect(t.descricao).toBe("O produto volta a ficar sem OC e pode entrar em outro pedido. O total da OC é recalculado e as parcelas são refeitas. Os outros produtos não mudam.");
    // só um dos totais não basta
    expect(textoTirarProdutoDaOc({ totalAntes: "R$ 1,00" }).descricao).toContain("O total da OC é recalculado");
  });
  it("5.2 Marcar o produto como recebido (refaz → neutro)", () => {
    const t = textoMarcarProdutoRecebido({ nome: "Lia" });
    expect(t.titulo).toBe("Marcar “Lia” como recebido?");
    expect(t.descricao).toBe("Isto registra a entrada só deste produto e libera o CQ/Direcionamento para ele. A grade real vira recebida − defeito. Os outros produtos da OC seguem aguardando.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Confirmar recebimento", "Cancelar", false]);
    expect(textoMarcarProdutoRecebido({ nome: "Lia", pendentes: true }).descricao).toMatch(/ As alterações pendentes da OC são salvas junto\.$/);
    expect(textoMarcarProdutoRecebido({}).titulo).toBe("Marcar este produto como recebido?");
  });
  it("5.3 Excluir OC (desfaz → vermelho)", () => {
    const t = textoExcluirOc();
    expect(t.titulo).toBe("Excluir OC?");
    expect(t.descricao).toBe("Esta ação não pode ser desfeita. Os produtos voltam a ficar sem OC.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Excluir", "Cancelar", true]);
  });
});

describe("[R13 T7] oc-multi-itens — textos e regras puras", () => {
  it("textos do mockup, verbatim", () => {
    expect(TEXTO_ITEM_RECEBIDO_NAO_SAI).toBe("Já recebido — não sai da OC");
    expect(TEXTO_UNICO_PRODUTO).toBe("Único produto — exclua a OC para desvincular");
    expect(TEXTO_OC_COM_RECEBIDO_NAO_EXCLUI).toBe("Há produto recebido — não dá para excluir a OC");
    expect(TEXTO_GRAVA_AO_RECEBER).toContain("gravados ao marcar este produto como recebido");
  });
  it("topo 'X de N produtos recebidos' (singular com 1)", () => {
    expect(textoRecebidos(1, 3)).toBe("1 de 3 produtos recebidos");
    expect(textoRecebidos(0, 1)).toBe("0 de 1 produto recebido");
    expect(produtosTexto(1)).toBe("1 produto");
    expect(produtosTexto(4)).toBe("4 produtos");
    expect(contarRecebidos([{ status: "recebido" }, { status: "encomendado" }, { status: "encomendado" }])).toEqual({ recebidos: 1, total: 3 });
  });
  it("tirar: recebido não sai; único produto não sai; senão pode", () => {
    expect(motivoNaoTirar({ status: "recebido" }, 3)).toBe("Já recebido — não sai da OC");
    expect(motivoNaoTirar({ status: "recebido" }, 1)).toBe("Já recebido — não sai da OC"); // recebido vence o 'único'
    expect(motivoNaoTirar({ status: "encomendado" }, 1)).toBe("Único produto — exclua a OC para desvincular");
    expect(motivoNaoTirar({ status: "encomendado" }, 2)).toBeNull();
  });
  it("excluir OC: qualquer produto recebido recusa", () => {
    expect(motivoNaoExcluirOc([{ status: "encomendado" }, { status: "recebido" }])).toBe("Há produto recebido — não dá para excluir a OC");
    expect(motivoNaoExcluirOc([{ status: "encomendado" }])).toBeNull();
    expect(motivoNaoExcluirOc([])).toBeNull();
  });
  it("coluna 'Produtos' da lista: 'Vestido Midi +2'", () => {
    expect(textoProdutosDaOc([{ nome_produto: "Vestido Midi", ordem: 1 }, { nome_produto: "Blusa", ordem: 2 }, { nome_produto: "Short", ordem: 3 }])).toBe("Vestido Midi +2");
    expect(textoProdutosDaOc([{ nome_produto: "Blusa", ordem: 2 }, { nome_produto: "Vestido Midi", ordem: 1 }])).toBe("Vestido Midi +1"); // pela ordem da OC
    expect(textoProdutosDaOc([{ nome_produto: "Blusa", ordem: 1 }])).toBe("Blusa");
    expect(textoProdutosDaOc([{ nome_produto: null, ordem: 1 }])).toBe("Sem nome");
    expect(textoProdutosDaOc([])).toBe("—");
  });
});
