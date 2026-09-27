import { describe, it, expect } from "vitest";
import { CAMPO_BY_KEY } from "@/lib/integracao/campos";
import { lerLista } from "@/lib/integracao/produtos";
import { TEXTO_TRAVADO_INTEGRADO, TEXTO_TRAVADO_INTEGRAVEL, infoEdicao, modoCelula } from "@/lib/integracao/celula";

const g = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const p = (o: Record<string, unknown> = {}) => lerLista({ campos: [], produtos: [{ modelo_id: "m1", origem: "interno",
  estado: "nao_integravel", rev: 1, raw: { nome: "X", tamanho_tipo: "letra" },
  gates: { compartilhado: g(true), planejamento: g(true), preco: g(false, "Precisa da permissão de preço de venda."),
    ref: g(false, "REF travada pelo envio à Explosão — não pode mudar depois desse ponto."), sku: g(true), keywords: g(true) }, ...o }] }).produtos[0];
const c = (k: string) => CAMPO_BY_KEY.get(k as never)!;

describe("modoCelula — quem decide editar × ler", () => {
  it("gate do servidor aberto = edita; fechado = lê com o motivo do card", () => {
    expect(modoCelula(c("peso"), p(), false)).toEqual({ tipo: "editar" });
    expect(modoCelula(c("preco_venda"), p(), false)).toEqual({ tipo: "leitura", motivo: "Precisa da permissão de preço de venda.", travado: false });
    expect(modoCelula(c("ref_sku"), p(), false)).toMatchObject({ tipo: "leitura", motivo: "REF travada pelo envio à Explosão — não pode mudar depois desse ponto." });
  });
  it("custo/cor/tamanho, metatag e keywords nunca editam na célula (P-80 A; Keywords = diálogo)", () => {
    for (const k of ["preco_custo", "cor_base", "cor_apelido", "tamanho", "metatag", "keywords"]) {
      expect(modoCelula(c(k), p(), false).tipo, k).toBe("leitura");
    }
  });
  it("integrável/integrado = travado (cadeado), qualquer campo", () => {
    expect(modoCelula(c("nome"), p({ estado: "integravel" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRAVEL, travado: true });
    expect(modoCelula(c("nome"), p({ estado: "integrado" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRADO, travado: true });
  });
  it("salvando = nada edita", () => {
    expect(modoCelula(c("peso"), p(), true)).toEqual({ tipo: "leitura", motivo: "Salvando…", travado: false });
  });
  it("informação de quem edita (textos do mockup)", () => {
    expect(infoEdicao(c("ref_sku"), p({ origem: "revenda" }))).toBe("REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).");
    expect(infoEdicao(c("preco_venda"), p({ origem: "revenda" }))).toBe('Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").');
    expect(infoEdicao(c("ref_sku"), p())).toBe("REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.");
    expect(infoEdicao(c("peso"), p())).toBeNull();
  });
});
