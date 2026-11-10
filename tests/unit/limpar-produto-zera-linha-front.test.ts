// "Limpar produto" zera a Linha no banco (migration 20261118140000) — o front tem de rebaselinar os DOIS lados (linhaId + linhaIdBase),
// senão a tela mostra a Linha antiga com o banco em null e o Salvar não corrige (classe L-2, igual ao tamanho_tipo). Teste de fonte.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ler = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

/** Trecho do `onLimpo`/`limpo` até o fim do objeto literal (primeiro `};` depois do início). */
function bloco(src: string, inicio: string): string {
  const i = src.indexOf(inicio);
  expect(i).toBeGreaterThan(-1);
  const f = src.indexOf("};", i);
  expect(f).toBeGreaterThan(i);
  return src.slice(i, f);
}

describe("Limpar produto zera linhaId/linhaIdBase no draft", () => {
  it("PA: o `limpo` do onLimpo traz linhaId: null + linhaIdBase: null (e não toca o status)", () => {
    const b = bloco(ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx"), "const limpo: ProdutoDraft = {");
    expect(b).toMatch(/linhaId:\s*null,\s*linhaIdBase:\s*null/);
    expect(b).not.toMatch(/statusProduto\s*:/);
  });
  it("PI: o `limpo` do onLimpo traz linhaId: null + linhaIdBase: null (preserva o status)", () => {
    const b = bloco(ler("src/components/produto-importado/ProdutoImportadoSheet.tsx"), "const limpo: ProdutoImportadoDraft = {");
    expect(b).toMatch(/linhaId:\s*null,\s*linhaIdBase:\s*null/);
    expect(b).not.toMatch(/linhaId:\s*d\.linhaId/);
    expect(b).toMatch(/statusProduto:\s*d\.statusProduto/);
  });
});
