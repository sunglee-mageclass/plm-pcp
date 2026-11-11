import { describe, it, expect } from "vitest";
import {
  CAMPOS_EXPORT,
  CAMPO_EXPORT_BY_KEY,
  ordenarCamposExport,
  KEYS_VALIDAS,
} from "@/lib/integracao/campos-export";

describe("campos-export", () => {
  it("tem 27 campos: os 20 da Integração (sem foto) + os 7 extras", () => {
    const keys = CAMPOS_EXPORT.map((c) => c.key);
    expect(keys).toHaveLength(27);
    expect(new Set(keys).size).toBe(27);
    for (const k of [
      "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo",
      "cor_base", "cor_apelido", "tamanho", "titulo", "descricao", "keywords", "metatag",
      "comprimento", "largura", "altura", "colecao", "categoria_tecido", "linha",
    ]) expect(keys).toContain(k);
    for (const k of ["preco_atacado", "subcolecao", "grupo", "categoria", "subcategoria1", "subcategoria2", "origem"]) {
      expect(keys).toContain(k);
    }
  });
  it("NÃO tem 'foto' (decisão do dono)", () => {
    expect(CAMPOS_EXPORT.map((c) => c.key)).not.toContain("foto");
    expect(KEYS_VALIDAS.has("foto")).toBe(false);
    expect(CAMPO_EXPORT_BY_KEY.has("foto")).toBe(false);
  });
  it("soVariante só em cor_base, cor_apelido e tamanho", () => {
    const so = CAMPOS_EXPORT.filter((c) => c.soVariante).map((c) => c.key).sort();
    expect(so).toEqual(["cor_apelido", "cor_base", "tamanho"]);
  });
  it("todo campo tem rótulo não vazio", () => {
    for (const c of CAMPOS_EXPORT) expect(c.rotulo.trim().length).toBeGreaterThan(0);
  });
  it("ordenarCamposExport preserva a ordem do catálogo", () => {
    const ordem = CAMPOS_EXPORT.map((c) => c.key);
    const embaralhado = [...ordem].reverse();
    expect(ordenarCamposExport(embaralhado)).toEqual(ordem);
    expect(ordenarCamposExport(["origem", "nome"])).toEqual(["nome", "origem"]);
  });
  it("ordenarCamposExport descarta chaves inválidas", () => {
    expect(ordenarCamposExport(["xpto", "nome", "foto"])).toEqual(["nome"]);
  });
  it("KEYS_VALIDAS filtra inválidas", () => {
    expect(KEYS_VALIDAS.has("nome")).toBe(true);
    expect(KEYS_VALIDAS.has("xpto")).toBe(false);
  });
});
