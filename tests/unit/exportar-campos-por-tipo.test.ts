import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CAMPOS_TECIDO, CAMPOS_AVIAMENTO, CAMPOS_INSUMO, catalogoDoTipo } from "@/lib/exportar/campos-por-tipo";

const MIG = readFileSync("supabase/migrations/20261212100000_exportar_por_tipo.sql", "utf8");

/** Extrai o array literal do v_catalogo do _core daquele tipo (a partir do CREATE FUNCTION, nao do comentario do cabecalho). */
function vCatalogo(tipo: "tecidos" | "aviamentos" | "insumos"): string[] {
  const i = MIG.indexOf(`FUNCTION public._exportar_${tipo}_core`);
  if (i < 0) throw new Error(`_exportar_${tipo}_core nao encontrado`);
  const trecho = MIG.slice(i, i + 3000);
  const m = trecho.match(/v_catalogo\s+constant\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/);
  if (!m) throw new Error(`v_catalogo de ${tipo} nao encontrado`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("catalogos de export por tipo", () => {
  it("TECIDO: chaves exatas e soVariante", () => {
    expect(CAMPOS_TECIDO.map((c) => c.key)).toEqual([
      "nome","unidade","composicao","rendimento","ncm","preco","preco_por_metro","largura","fornecedor","mes","ano",
      "categorias","subcategoria_tecido","cor_base","cor_apelido","codigo_variante",
    ]);
    expect(CAMPOS_TECIDO.filter((c) => c.soVariante).map((c) => c.key)).toEqual(["cor_base","cor_apelido","codigo_variante"]);
  });
  it("AVIAMENTO: 'nome' presente (vem de codigo_nome no SQL) e soVariante", () => {
    expect(CAMPOS_AVIAMENTO.map((c) => c.key)).toEqual([
      "nome","codigo","ncm","composicao","preco","categoria","subcategoria","material","fornecedor",
      "cor_base_cab","cor_apelido_cab","cor_base","cor_apelido","codigo_variante","preco_variante",
    ]);
    expect(CAMPOS_AVIAMENTO.filter((c) => c.soVariante).map((c) => c.key))
      .toEqual(["cor_base","cor_apelido","codigo_variante","preco_variante"]);
  });
  it("INSUMO: cor x tamanho (sem apelido)", () => {
    expect(CAMPOS_INSUMO.map((c) => c.key)).toEqual([
      "nome","unidade","tipo_insumo","formato_tamanho","preco","fornecedor","observacoes","cor","tamanho","preco_variante",
    ]);
    expect(CAMPOS_INSUMO.filter((c) => c.soVariante).map((c) => c.key)).toEqual(["cor","tamanho","preco_variante"]);
  });

  it("anti-drift TS<->SQL: as chaves do catalogo TS == v_catalogo do _core (mesmo conjunto)", () => {
    const pares: [string, readonly { key: string }[]][] = [
      ["tecidos", CAMPOS_TECIDO], ["aviamentos", CAMPOS_AVIAMENTO], ["insumos", CAMPOS_INSUMO],
    ];
    for (const [tipo, cat] of pares) {
      expect([...cat.map((c) => c.key)].sort()).toEqual([...vCatalogo(tipo as any)].sort());
    }
  });

  it("catalogoDoTipo('produto') reusa o catalogo do produto (intocado)", () => {
    expect(catalogoDoTipo("produto").some((c) => c.key === "subcategoria1")).toBe(true);
  });
});
