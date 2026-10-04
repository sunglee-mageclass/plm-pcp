// [modularidade R11 · Parte 12] Anti-drift: nenhuma tela lê `modelos.colecao` CRU para filtrar ou mostrar. Quem seleciona a coluna
// `colecao` de `modelos` (lista de colunas num literal) tem de trazer também o embed `colecoes(nome)` e passar pelo rótulo
// (`@/lib/colecao-rotulo`): sem isso o card que só tem `colecao_id` some do filtro e da exibição.
// Quem só ESCREVE a coluna (edição em massa, duplicar, importar) ou já recebe o rótulo do servidor fica na lista de exceções.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "src";
// Escrita de `colecao`/texto livre, ou dado que já vem do servidor como rótulo (RPC/_integracao_extras). NÃO acrescentar tela de leitura.
const EXCECOES = new Set([
  "src/lib/versoes-familia-query.ts", // já embute colecoes(nome) e resolve o rótulo ao montar a família
]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(n) && !n.endsWith(".d.ts") ? [p] : [];
  });
}

// Literal de string de UMA linha que parece lista de colunas do PostgREST com o token `colecao` isolado (não colecao_id/subcolecao).
const LITERAL = /(["`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const COLECAO_TOKEN = /(^|[\s,(])colecao(?=\s*(,|$|\)))/;
function leColecaoCrua(src: string): string[] {
  const achados: string[] = [];
  for (const m of src.matchAll(LITERAL)) {
    const txt = m[2];
    if (txt.length < 20 || !txt.includes(",")) continue;
    if (!/(^|[\s,])(id|nome|ref)\s*,/.test(txt)) continue; // precisa parecer select de colunas
    if (/[=:]/.test(txt.replace(/\w+:\w+\(/g, "").replace(/\w+\([^)]*\)/g, "")) && /\bcolecao:/.test(txt)) continue; // objeto literal, não select
    if (COLECAO_TOKEN.test(txt)) achados.push(txt.slice(0, 80));
  }
  return achados;
}

describe("colecao pelo rótulo: nenhuma leitura crua de modelos.colecao nas telas", () => {
  const todos = arquivos(RAIZ);
  const leitores = todos
    .map((p) => ({ p: p.split("\\").join("/"), src: readFileSync(p, "utf8") }))
    .filter((f) => !EXCECOES.has(f.p) && leColecaoCrua(f.src).length > 0);

  it("acha as telas que selecionam `colecao` (sanidade: a varredura não está cega)", () => {
    expect(leitores.length).toBeGreaterThanOrEqual(12);
  });

  for (const f of leitores) {
    it(`${f.p}: traz colecoes(nome) e usa o rótulo`, () => {
      expect(f.src, "falta o embed colecoes(nome) no select").toMatch(/colecoes\(nome\)/);
      expect(f.src, "falta o rótulo (@/lib/colecao-rotulo)").toMatch(/from "@\/lib\/colecao-rotulo"/);
      expect(f.src, "falta chamar o rótulo").toMatch(/rotuloColecao(DoModelo)?\(|comRotuloColecao(Lista)?\(/);
    });
  }

  it("as listas/filtros passam o rótulo, não o texto: nenhum `.eq(\"colecao\", …)` em modelos nas telas", () => {
    for (const f of todos.map((p) => ({ p, src: readFileSync(p, "utf8") }))) {
      if (EXCECOES.has(f.p.split("\\").join("/"))) continue;
      expect(f.src, f.p).not.toMatch(/\.eq\(\s*["']colecao["']/);
    }
  });
});
