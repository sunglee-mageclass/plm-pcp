import { describe, it, expect } from "vitest";
import {
  podeVerPrecoVarejo, podeVerPrecoAtacado, podeEditarPrecoVarejo, podeEditarPrecoAtacado,
  CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO, CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO,
} from "@/lib/preco-permissao";
import { CHAVES_VER_CUSTOS, podeVerCustosServidor } from "@/lib/mao-obra";
import { ALL_PAGE_KEYS } from "@/lib/permissions-catalog";

// Fábrica de canView/canEdit a partir de um conjunto de chaves true.
const comChaves = (...ks: string[]) => (k: string) => ks.includes(k);

describe("preco-permissao — chaves próprias, independentes de custos", () => {
  it("as chaves são as da seção criacao_planejamento", () => {
    expect(CHAVE_VER_PRECO_VAREJO).toBe("criacao_planejamento:ver_preco_venda");
    expect(CHAVE_VER_PRECO_ATACADO).toBe("criacao_planejamento:ver_preco_atacado");
    expect(CHAVE_EDITAR_PRECO_VAREJO).toBe("criacao_planejamento:preco_venda");
    expect(CHAVE_EDITAR_PRECO_ATACADO).toBe("criacao_planejamento:preco_atacado");
  });

  it("as 4 chaves existem no catálogo de permissões (ALL_PAGE_KEYS)", () => {
    for (const k of [CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO, CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO]) {
      expect(ALL_PAGE_KEYS).toContain(k);
    }
  });

  it("ver varejo/atacado = SÓ a chave própria", () => {
    expect(podeVerPrecoVarejo(comChaves(CHAVE_VER_PRECO_VAREJO))).toBe(true);
    expect(podeVerPrecoVarejo(comChaves(CHAVE_VER_PRECO_ATACADO))).toBe(false);
    expect(podeVerPrecoAtacado(comChaves(CHAVE_VER_PRECO_ATACADO))).toBe(true);
    expect(podeVerPrecoAtacado(comChaves(CHAVE_VER_PRECO_VAREJO))).toBe(false);
    expect(podeVerPrecoVarejo(comChaves())).toBe(false);
    expect(podeVerPrecoAtacado(comChaves())).toBe(false);
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
    const soPreco = comChaves(CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO, CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO);
    expect(podeVerPrecoVarejo(soPreco)).toBe(true);
    expect(podeVerPrecoAtacado(soPreco)).toBe(true);
    expect(podeEditarPrecoVarejo(soPreco)).toBe(true);
    expect(podeEditarPrecoAtacado(soPreco)).toBe(true);
    expect(podeVerCustosServidor(soPreco)).toBe(false); // preço não concede custo
    for (const k of CHAVES_VER_CUSTOS) expect(soPreco(k)).toBe(false);
  });

  it("ORTOGONAL a custos — cruzamento 3: vê custo E preço (as duas famílias coexistem)", () => {
    const ambos = comChaves(...CHAVES_VER_CUSTOS, CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO);
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
    const soVarejo = comChaves(CHAVE_VER_PRECO_VAREJO, CHAVE_EDITAR_PRECO_VAREJO);
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
