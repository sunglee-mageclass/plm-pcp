import { describe, it, expect } from "vitest";
import { payloadRevendaParaSalvar, type RevendaBase, type RevendaRascunho } from "@/lib/revenda-salvar";

const base: RevendaBase = { markup_atacado: 2, markup_varejo: 3, preco_atacado: null, preco_venda: null };
const rasc = (p: Partial<RevendaRascunho> = {}): RevendaRascunho => ({
  markupAtacado: 2, markupVarejo: 3, precoAtacadoFixo: null, precoVarejoFixo: null, ...p,
});

describe("payloadRevendaParaSalvar", () => {
  it("nada mudou → não manda nada", () => {
    const r = payloadRevendaParaSalvar(base, rasc(), false, null, null);
    expect(r.markups).toBeNull();
    expect(r.fixos).toBeNull();
  });

  it("só atacado mudou → manda markups com varejo intocado (valor do servidor)", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ markupAtacado: 2.5 }), false, null, null);
    expect(r.markups).toEqual({ markup_atacado: 2.5, markup_varejo: 3 });
    expect(r.fixos).toBeNull();
  });

  it("varejo travado → nunca manda markup varejo novo", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ markupAtacado: 2.5, markupVarejo: 9 }), true, null, null);
    expect(r.markups?.markup_atacado).toBe(2.5);
    expect(r.markups?.markup_varejo).toBe(3); // servidor, não o 9 digitado
  });

  it("preço atacado fixo digitado → tocarAtacado=true, varejo não tocado", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ precoAtacadoFixo: 49.9 }), false, null, null);
    expect(r.fixos).toEqual({ tocarAtacado: true, precoAtacado: 49.9, tocarVarejo: false, precoVarejo: null });
  });

  it("preço varejo fixo com varejo travado → tocarVarejo=false (não grava no canal travado)", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ precoVarejoFixo: 80 }), true, null, null);
    expect(r.fixos?.tocarVarejo).toBe(false);
  });
});
