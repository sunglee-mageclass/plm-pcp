import { describe, it, expect } from "vitest";
import {
  podeVerPrecoVarejo, podeVerPrecoAtacado, podeEditarPrecoVarejo, podeEditarPrecoAtacado,
  CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO,
} from "@/lib/preco-permissao";
import { CHAVES_VER_CUSTOS, podeVerCustosServidor } from "@/lib/mao-obra";
import { ALL_PAGE_KEYS, PAGES_CATALOG } from "@/lib/permissions-catalog";

// Fábrica de canView/canEdit a partir de um conjunto de chaves true.
const comChaves = (...ks: string[]) => (k: string) => ks.includes(k);

describe("preco-permissao — chaves próprias, independentes de custos", () => {
  it("UMA chave por preço, na seção criacao_planejamento (Leitor=ver, Editor=editar)", () => {
    expect(CHAVE_EDITAR_PRECO_VAREJO).toBe("criacao_planejamento:preco_venda");
    expect(CHAVE_EDITAR_PRECO_ATACADO).toBe("criacao_planejamento:preco_atacado");
  });

  it("as 2 chaves existem no catálogo (ALL_PAGE_KEYS) e as chaves ver_* NÃO existem mais", () => {
    for (const k of [CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO]) expect(ALL_PAGE_KEYS).toContain(k);
    expect(ALL_PAGE_KEYS).not.toContain("criacao_planejamento:ver_preco_venda");
    expect(ALL_PAGE_KEYS).not.toContain("criacao_planejamento:ver_preco_atacado");
  });

  it("catálogo: labels e ordem (Custos, Preço de venda (varejo), Preço de atacado, Peça Teste)", () => {
    const pag = PAGES_CATALOG.flatMap((m) => m.pages).find((p) => p.key === "criacao_planejamento");
    expect((pag?.sections ?? []).map((x) => x.label)).toEqual(["Custos", "Preço de venda (varejo)", "Preço de atacado", "Peça Teste"]);
  });

  it("ver varejo/atacado = canView da chave única do respectivo preço", () => {
    expect(podeVerPrecoVarejo(comChaves(CHAVE_EDITAR_PRECO_VAREJO))).toBe(true);
    expect(podeVerPrecoVarejo(comChaves(CHAVE_EDITAR_PRECO_ATACADO))).toBe(false);
    expect(podeVerPrecoAtacado(comChaves(CHAVE_EDITAR_PRECO_ATACADO))).toBe(true);
    expect(podeVerPrecoAtacado(comChaves(CHAVE_EDITAR_PRECO_VAREJO))).toBe(false);
    expect(podeVerPrecoVarejo(comChaves())).toBe(false);
    expect(podeVerPrecoAtacado(comChaves())).toBe(false);
  });

  it("ver e editar são colunas DA MESMA chave: Leitor vê sem editar; Editor edita (canEdit independe de canView no helper)", () => {
    const so = (ver: string[], edita: string[]) => ({ cv: comChaves(...ver), ce: comChaves(...edita) });
    const leitor = so([CHAVE_EDITAR_PRECO_VAREJO], []);
    expect(podeVerPrecoVarejo(leitor.cv)).toBe(true);
    expect(podeEditarPrecoVarejo(leitor.ce)).toBe(false);
    const editor = so([CHAVE_EDITAR_PRECO_ATACADO], [CHAVE_EDITAR_PRECO_ATACADO]);
    expect(podeVerPrecoAtacado(editor.cv)).toBe(true);
    expect(podeEditarPrecoAtacado(editor.ce)).toBe(true);
  });

  it("editar varejo/atacado = SÓ a chave própria", () => {
    expect(podeEditarPrecoVarejo(comChaves(CHAVE_EDITAR_PRECO_VAREJO))).toBe(true);
    expect(podeEditarPrecoVarejo(comChaves(CHAVE_EDITAR_PRECO_ATACADO))).toBe(false);
    expect(podeEditarPrecoAtacado(comChaves(CHAVE_EDITAR_PRECO_ATACADO))).toBe(true);
    expect(podeEditarPrecoAtacado(comChaves(CHAVE_EDITAR_PRECO_VAREJO))).toBe(false);
    expect(podeEditarPrecoVarejo(comChaves())).toBe(false);
    expect(podeEditarPrecoAtacado(comChaves())).toBe(false);
  });

  it("ORTOGONAL a custos — cruzamento 1: vê custo / NÃO vê preço (nenhuma chave de preço)", () => {
    const soCustos = comChaves(...CHAVES_VER_CUSTOS);
    expect(podeVerCustosServidor(soCustos)).toBe(true); // sanidade: ele de fato vê custos
    expect(podeVerPrecoVarejo(soCustos)).toBe(false);
    expect(podeVerPrecoAtacado(soCustos)).toBe(false);
    expect(podeEditarPrecoVarejo(soCustos)).toBe(false);
    expect(podeEditarPrecoAtacado(soCustos)).toBe(false);
  });

  it("ORTOGONAL a custos — cruzamento 2: vê preço / NÃO vê custo", () => {
    const soPreco = comChaves(CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO);
    expect(podeVerPrecoVarejo(soPreco)).toBe(true);
    expect(podeVerPrecoAtacado(soPreco)).toBe(true);
    expect(podeEditarPrecoVarejo(soPreco)).toBe(true);
    expect(podeEditarPrecoAtacado(soPreco)).toBe(true);
    expect(podeVerCustosServidor(soPreco)).toBe(false); // preço não concede custo
    for (const k of CHAVES_VER_CUSTOS) expect(soPreco(k)).toBe(false);
  });

  it("ORTOGONAL a custos — cruzamento 3: vê custo E preço (as duas famílias coexistem)", () => {
    const ambos = comChaves(...CHAVES_VER_CUSTOS, CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO);
    expect(podeVerCustosServidor(ambos)).toBe(true);
    expect(podeVerPrecoVarejo(ambos)).toBe(true);
    expect(podeVerPrecoAtacado(ambos)).toBe(true);
  });

  it("ORTOGONAL a custos — cruzamento 4: não vê custo NEM preço", () => {
    const nada = comChaves();
    expect(podeVerCustosServidor(nada)).toBe(false);
    expect(podeVerPrecoVarejo(nada)).toBe(false);
    expect(podeVerPrecoAtacado(nada)).toBe(false);
    expect(podeEditarPrecoVarejo(nada)).toBe(false);
    expect(podeEditarPrecoAtacado(nada)).toBe(false);
  });

  it("varejo e atacado são independentes entre si (vê um, não vê o outro)", () => {
    const soVarejo = comChaves(CHAVE_EDITAR_PRECO_VAREJO);
    expect(podeVerPrecoVarejo(soVarejo)).toBe(true);
    expect(podeEditarPrecoVarejo(soVarejo)).toBe(true);
    expect(podeVerPrecoAtacado(soVarejo)).toBe(false);
    expect(podeEditarPrecoAtacado(soVarejo)).toBe(false);
  });

  it("NÃO referencia custos no código-fonte (anti-drift)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/preco-permissao.ts", "utf8");
    expect(src).not.toMatch(/CHAVES_VER_CUSTOS|_pode_ver_custos|podeVerCustosServidor|podeVerCustos/);
  });
});
