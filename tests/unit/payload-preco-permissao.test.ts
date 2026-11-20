import { describe, it, expect } from "vitest";
import { aplicarRegrasPrecoNoPayload } from "@/components/planejamento/planejamento-detail/helpers";
import { filtrarRevendaPorPermissao, payloadRevendaParaSalvar, type RevendaBase, type RevendaRascunho } from "@/lib/revenda-salvar";

const draft = { origem: "interno", preco_venda: 100, preco_atacado: 60 } as any;

describe("payload — varejo e atacado omitidos por chave independente", () => {
  it("interno, edita varejo e atacado: ambos no payload", () => {
    const p: any = {};
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: true, editaAtacado: true });
    expect(p.preco_venda).toBe(100);
    expect(p.preco_atacado).toBe(60);
  });
  it("interno, NÃO edita varejo: preco_venda some, preco_atacado fica (independentes)", () => {
    const p: any = { preco_venda: 1, preco_atacado: 2 };
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: false, editaAtacado: true });
    expect("preco_venda" in p).toBe(false);
    expect(p.preco_atacado).toBe(60);
  });
  it("interno, NÃO edita atacado: preco_atacado some, preco_venda fica", () => {
    const p: any = { preco_venda: 1, preco_atacado: 2 };
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: true, editaAtacado: false });
    expect(p.preco_venda).toBe(100);
    expect("preco_atacado" in p).toBe(false);
  });
  it("interno, não edita nenhum: ambos somem (herdados do spread não vazam)", () => {
    const p: any = { preco_venda: 1, preco_atacado: 2 };
    aplicarRegrasPrecoNoPayload(p, draft, { origemComprada: false, editaVarejo: false, editaAtacado: false });
    expect("preco_venda" in p).toBe(false);
    expect("preco_atacado" in p).toBe(false);
  });
  it("interno com preço 0/vazio: vai null (nada quebra no fluxo normal)", () => {
    const p: any = {};
    aplicarRegrasPrecoNoPayload(p, { origem: "interno", preco_venda: 0, preco_atacado: null }, { origemComprada: false, editaVarejo: true, editaAtacado: true });
    expect(p.preco_venda).toBeNull();
    expect(p.preco_atacado).toBeNull();
  });
  it("comprado (revenda/importado): ambos OMITIDOS (derivados no servidor)", () => {
    const p: any = { preco_venda: 1, preco_atacado: 2 };
    aplicarRegrasPrecoNoPayload(p, { ...draft, origem: "revenda" }, { origemComprada: true, editaVarejo: true, editaAtacado: true });
    expect("preco_venda" in p).toBe(false);
    expect("preco_atacado" in p).toBe(false);
  });
});

// T4-D — o bloco de preço do COMPRADO no Sheet: cada canal é filtrado pela SUA chave (editar-atacado sozinho salva o atacado).
describe("revenda no Sheet — filtro por canal (T4-D)", () => {
  const base: RevendaBase = { markup_atacado: 1.5, markup_varejo: 2, preco_atacado: null, preco_venda: null };
  const rasc: RevendaRascunho = { markupAtacado: 1.8, markupVarejo: 2.5, precoAtacadoFixo: null, precoVarejoFixo: null };
  const f = (editaVarejo: boolean, editaAtacado: boolean) => filtrarRevendaPorPermissao(base, rasc, { editaVarejo, editaAtacado });

  it("só editar-atacado: o atacado muda e vai; o varejo editado é descartado (volta à base)", () => {
    const r = f(false, true);
    expect(r.markupAtacado).toBe(1.8);
    expect(r.markupVarejo).toBe(2);
    const pay = payloadRevendaParaSalvar(base, r, false, null, null);
    expect(pay.markups?.markup_atacado).toBe(1.8);
    expect(pay.markups?.markup_varejo).toBe(2);
  });
  it("só editar-varejo: o varejo vai; o atacado editado é descartado", () => {
    const r = f(true, false);
    expect(r.markupVarejo).toBe(2.5);
    expect(r.markupAtacado).toBe(1.5);
    const pay = payloadRevendaParaSalvar(base, r, false, null, null);
    expect(pay.markups?.markup_varejo).toBe(2.5);
    expect(pay.markups?.markup_atacado).toBe(1.5);
  });
  it("preço fixo: só o canal permitido é tocado", () => {
    const r2 = filtrarRevendaPorPermissao(base, { ...rasc, precoAtacadoFixo: 70, precoVarejoFixo: 120 }, { editaVarejo: false, editaAtacado: true });
    const pay = payloadRevendaParaSalvar(base, r2, false, null, null);
    expect(pay.fixos).toEqual({ tocarAtacado: true, precoAtacado: 70, tocarVarejo: false, precoVarejo: null });
  });
  it("nenhum dos dois: nada a gravar", () => {
    const pay = payloadRevendaParaSalvar(base, f(false, false), false, null, null);
    expect(pay.markups).toBeNull();
    expect(pay.fixos).toBeNull();
  });
  it("ambos: rascunho passa intacto", () => {
    expect(f(true, true)).toEqual(rasc);
  });
});
