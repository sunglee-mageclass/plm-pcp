import { describe, it, expect } from "vitest";
import {
  aplicarColunasFicha, prepararRetryP0409, tocadosAposSalvar,
} from "@/components/planejamento/planejamento-detail/save-ficha";
import type { TotaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — regras do Salvar unificado do Planejamento (payload do UPDATE `modelos`, rebase pós-save e
// o retry do P0409). Fixes: receita 2419d0f do Desenvolvimento.
const totais: TotaisBom = { tecido: 57.17, forro: 16.52, entretela: 0, aviamento: 4.9, etiqueta: 1.2, custosAdicionais: 3.5, materiaisBom: 79.79, terceirizados: 0, peca: 83.29 };
const base = () => ({ nome: "X", tecidos_planejados: ["a"], proporcoes: { P: 1 }, custos_adicionais: [{ descricao: "B", valor: 3.5 }] } as Record<string, unknown>);
const op = (p: Partial<Parameters<typeof aplicarColunasFicha>[1]> = {}) => ({
  isEdit: true, podeGravarColunasDev: true, incluirDerivados: true, podeVerCustos: true,
  totais, maoObraServidor: 35, gravaBom: false, tecidosPlanejados: ["a", "s"], ...p,
});

describe("aplicarColunasFicha", () => {
  it("card novo: não mexe (a lista do Dialog vai no insert)", () => {
    expect(aplicarColunasFicha(base(), op({ isEdit: false }))).toEqual(base());
  });
  it("edição SEM permissão do Dev: omite lista, proporções e custos adicionais; nenhum custo derivado (decisão F3 #8)", () => {
    const p = aplicarColunasFicha(base(), op({ podeGravarColunasDev: false }));
    expect(p).toEqual({ nome: "X" });
  });
  it("edição com permissão, 1ª tentativa, BOM não gravado: custos derivados SIM, tecidos_planejados NÃO", () => {
    const p = aplicarColunasFicha(base(), op());
    expect(p.tecidos_planejados).toBeUndefined();
    expect(p).toMatchObject({ custo_tecido_total: 57.17, custo_forro_total: 16.52, custo_entretela_total: 0, custo_aviamento_total: 4.9 });
    expect(p.custo_peca_previsto as number).toBeCloseTo(118.29);
    expect(p.proporcoes).toEqual({ P: 1 });
  });
  it("sem ver custos: não grava custo_peca_previsto (a MO vem mascarada — Dev :1914-1930)", () => {
    expect(aplicarColunasFicha(base(), op({ podeVerCustos: false })).custo_peca_previsto).toBeUndefined();
  });
  it("retry do P0409 sem gravar o BOM (incluirDerivados=false): nenhum custo derivado", () => {
    const p = aplicarColunasFicha(base(), op({ incluirDerivados: false }));
    expect(p.custo_tecido_total).toBeUndefined();
    expect(p.custo_peca_previsto).toBeUndefined();
  });
  it("BOM gravado: tecidos_planejados = lista DERIVADA", () => {
    expect(aplicarColunasFicha(base(), op({ gravaBom: true })).tecidos_planejados).toEqual(["a", "s"]);
  });
  it("ficha não carregada (totais null): sem custos derivados", () => {
    expect(aplicarColunasFicha(base(), op({ totais: null })).custo_tecido_total).toBeUndefined();
  });
});

describe("tocadosAposSalvar — fix do save-em-voo", () => {
  it("mantém tocado só o que mudou DEPOIS do envio", () => {
    const out = tocadosAposSalvar({
      touched: new Set(["nome", "semana"]),
      live: { nome: "Novo 2", semana: "2" },
      enviado: { nome: "Novo", semana: "2" },
    });
    expect([...out]).toEqual(["nome"]);
  });
});

describe("prepararRetryP0409 — fix do retry", () => {
  const b = { nome: "A", observacoes_gerais: "x", preco_venda: 10 };
  it("adota o campo do outro usuário e mantém o meu → o retry manda os DOIS", () => {
    const r = prepararRetryP0409({ base: b, live: { ...b, nome: "B" }, fresh: { ...b, observacoes_gerais: "do outro" }, touched: new Set(["nome"]), bomConflito: false });
    expect(r.proximoDraft).toEqual({ nome: "B", observacoes_gerais: "do outro", preco_venda: 10 });
    expect(r.atualizados).toBe(1);
    expect(r.podeRetentar).toBe(true);
  });
  it("conflito no MESMO campo → não retenta", () => {
    const r = prepararRetryP0409({ base: b, live: { ...b, nome: "B" }, fresh: { ...b, nome: "C" }, touched: new Set(["nome"]), bomConflito: false });
    expect(r.conflitos.map((c) => c.path)).toEqual(["nome"]);
    expect(r.podeRetentar).toBe(false);
  });
  it("BOM tocado E o BOM do servidor mudou → não retenta (vira conflito de seção 'Tecidos & BOM')", () => {
    const r = prepararRetryP0409({ base: b, live: b, fresh: { ...b, preco_venda: 12 }, touched: new Set(), bomConflito: true });
    expect(r.podeRetentar).toBe(false);
  });
  it("R5: BOM tocado mas o do servidor IGUAL (o P0409 veio de uma ação que só subiu o rev) → retenta", () => {
    const r = prepararRetryP0409({ base: b, live: b, fresh: { ...b, preco_venda: 12 }, touched: new Set(), bomConflito: false });
    expect(r.podeRetentar).toBe(true);
    expect(r.proximoDraft).toEqual({ ...b, preco_venda: 12 });
  });
  it("nada mudou → devolve o MESMO objeto ao vivo", () => {
    const live = { ...b };
    expect(prepararRetryP0409({ base: b, live, fresh: { ...b }, touched: new Set(), bomConflito: false }).proximoDraft).toBe(live);
  });
});
