// Shape do atributo `subcat_tecido` (Subcategoria de Tecido) em Cadastro > Atributos.
// Espelha o molde `subcat_aviamento`. O `value` = chave de permissao `cadastro_atributos:<value>`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/routes/_authenticated/cadastro.atributos.tsx", "utf8");

/** Bloco `{ value: "<v>", ... }` do array ATTRIBUTES (de `value:` ate o proximo `value:` de nivel de atributo). */
function bloco(value: string): string {
  const i = SRC.indexOf(`value: "${value}",`);
  expect(i, `atributo ${value} existe`).toBeGreaterThan(-1);
  const prox = SRC.indexOf('\n  {\n', i);
  return SRC.slice(i, prox === -1 ? undefined : prox);
}

describe("atributo subcat_tecido", () => {
  const b = bloco("subcat_tecido");

  it("grupo TECIDO, tabela subcategorias_tecido e rotulos", () => {
    expect(b).toContain('group: "TECIDO"');
    expect(b).toContain('table: "subcategorias_tecido"');
    expect(b).toContain('singular: "Subcategoria de Tecido"');
    expect(b).toContain('plural: "Subcategorias de Tecido"');
  });

  it("usage em artigo_categorias_tecido.subcategoria_tecido_id", () => {
    expect(b).toContain('{ table: "artigo_categorias_tecido", column: "subcategoria_tecido_id" }');
  });

  it("extra amarra a categoria_tecido_id / categorias_tecido (obrigatorio, extraFirst)", () => {
    expect(b).toContain("extraFirst: true");
    expect(b).toContain('field: "categoria_tecido_id"');
    expect(b).toContain('from: "categorias_tecido"');
    expect(b).toContain("required: true");
  });

  it("value casa com a chave de permissao do catalogo", () => {
    const cat = readFileSync("src/lib/permissions-catalog.ts", "utf8");
    expect(cat).toContain('"cadastro_atributos:subcat_tecido"');
  });

  it("vem logo apos cat_tecido (juntos no grupo TECIDO)", () => {
    expect(SRC.indexOf('value: "subcat_tecido"')).toBeGreaterThan(SRC.indexOf('value: "cat_tecido"'));
    expect(SRC.indexOf('value: "subcat_tecido"')).toBeLessThan(SRC.indexOf('value: "cat_aviamento"'));
  });

  it("cat_tecido.usage bloqueia excluir categoria em uso por subcategorias_tecido", () => {
    expect(bloco("cat_tecido")).toContain('{ table: "subcategorias_tecido", column: "categoria_tecido_id" }');
  });
});
