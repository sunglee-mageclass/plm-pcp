// [modularidade R11 · Parte 12 · D1/B1] Anti-drift: nenhuma tela lê `modelos.colecao` CRU para filtrar ou mostrar.
// Regras (por LITERAL, não por arquivo — um 2º select no mesmo arquivo também é cobrado):
//  1. todo select que pede a coluna `colecao` (lista longa OU curta, ex. "colecao, colecoes(nome)", OU `.select("colecao")`) traz no
//     MESMO literal o embed `colecoes(nome)`;
//  2. `.select("*")` em `modelos` também é leitura crua (sem o embed não há rótulo): só passa com `*, colecoes(nome)`, salvo as telas de
//     EDIÇÃO da lista EDITORES (a coluna é o valor editável do formulário, não exibição);
//  3. nenhum filtro/ordem por `colecao` (`.eq/.neq/.in/.ilike/.like/.or/.not/.is/.gt…("colecao", …)` nem `colecao.eq.x` dentro de
//     `.or(...)`): quem filtra, filtra pelo rótulo no cliente;
//  4. quem lê passa pelo rótulo (`@/lib/colecao-rotulo`).
// A lista de exceções do leitor ficou VAZIA (B2: `versoes-familia-query.ts` passou a usar `rotuloColecaoDoModelo`).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "src";
// Telas que apenas ESCREVEM `colecao`/texto livre (edição em massa, importar, duplicar) ou dado que já vem do servidor como rótulo.
// NÃO acrescentar tela de leitura/exibição. (Vazia hoje.)
const EXCECOES = new Set<string>([]);
// Telas de EDIÇÃO que carregam a linha inteira (`select("*")`) como rascunho: `colecao` é o campo editável do formulário.
const EDITORES = new Set<string>([
  "src/components/planejamento/PlanejamentoDetail.tsx", // Sheet do Planejamento: draft.colecao (texto) + colecao_id, gravados de volta
  "src/components/desenvolvimento/ModeloDetailPanel.tsx", // Sheet do Desenvolvimento: idem
]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(n) && !n.endsWith(".d.ts") ? [p] : [];
  });
}

// Literal de string de UMA linha (aspas simples, duplas ou crase).
const LITERAL = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
// `colecao` isolado (não colecao_id/subcolecao/colecoes): começo, espaço, vírgula ou "(" antes; vírgula, ")", fim ou espaço+vírgula depois.
const COLECAO_TOKEN = /(^|[\s,(])colecao(?=\s*(,|$|\)))/;
// `colecao.ilike.x` / `colecao.in.(a,b)` dentro de um `.or("...")` / `.filter("colecao", "eq", x)`.
const COLECAO_FILTRO_EMBUTIDO =
  /(^|[\s,(])colecao\.(eq|neq|in|ilike|like|is|not|gt|gte|lt|lte|cs|cd|ov|fts)\b/;
const FILTRO_COM_COLUNA =
  /\.(eq|neq|in|ilike|like|or|not|is|gt|gte|lt|lte|match|filter|contains|order|textSearch)\(\s*["'`]colecao["'`]/;

export type Achado = {
  regra: "select-sem-embed" | "select-estrela" | "filtro-cru";
  trecho: string;
};

/** Varre o texto-fonte e devolve as violações (sem considerar exceções de arquivo). */
export function leituraCrua(fonte: string): Achado[] {
  const achados: Achado[] = [];
  // comentários não contam (docs falam de `colecao`); `//` só depois de espaço/início de linha para não cortar URL em string
  const src = fonte
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  for (const m of src.matchAll(LITERAL)) {
    const txt = m[2];
    const antes = src.slice(Math.max(0, m.index! - 40), m.index!);
    const dentroDeSelect = /\.select\(\s*$/.test(antes);
    // objeto literal / prosa: "colecao: x", frases com espaços e sem vírgula de coluna
    const pareceLista = txt.includes(",") && /^[\w\s,():.!>*:-]+$/.test(txt) && !/\s{2,}/.test(txt);

    if (
      COLECAO_TOKEN.test(txt) &&
      (dentroDeSelect || pareceLista) &&
      !/:\s*[^\w(]/.test(txt.replace(/\w+:\w+\(/g, ""))
    ) {
      if (!/colecoes\(nome\)/.test(txt))
        achados.push({ regra: "select-sem-embed", trecho: txt.slice(0, 80) });
    }
    if (COLECAO_FILTRO_EMBUTIDO.test(txt) && /\.or\(\s*$/.test(antes))
      achados.push({ regra: "filtro-cru", trecho: txt.slice(0, 80) });
  }

  // `.eq("colecao", …)`, `.in("colecao", …)`, `.ilike(...)`, `.not("colecao", …)`, `.order("colecao")`…
  for (const m of src.matchAll(new RegExp(FILTRO_COM_COLUNA.source, "g")))
    achados.push({ regra: "filtro-cru", trecho: m[0] });

  // `from("modelos")…select("*")` (a cadeia pode quebrar linha): sem embed = leitura crua
  for (const m of src.matchAll(/from\(\s*["'`]modelos["'`][^)]*\)/g)) {
    const cadeia = src.slice(m.index! + m[0].length, m.index! + 700).split(/;|\.from\(/)[0]; // só a cadeia desta tabela
    if (/\.select\(\s*["'`]\*["'`]\s*[,)]/.test(cadeia))
      achados.push({ regra: "select-estrela", trecho: cadeia.slice(0, 80).replace(/\s+/g, " ") });
  }
  return achados;
}

const norm = (p: string) => p.split("\\").join("/");

describe("colecao pelo rótulo: detector (o detector enxerga os buracos que o F3 re-review apontou)", () => {
  const regras = (src: string) => leituraCrua(src).map((a) => a.regra);
  it("select CURTO sem o embed é pego; com o embed passa", () => {
    expect(regras('supabase.from("modelos").select("colecao, colecoes(nome)")')).toEqual([]);
    expect(regras('supabase.from("modelos").select("colecao, subcolecao")')).toEqual([
      "select-sem-embed",
    ]);
    expect(regras('supabase.from("modelos").select("colecao")')).toEqual(["select-sem-embed"]);
    expect(regras('supabase.from("modelos").select("id, colecao")')).toEqual(["select-sem-embed"]);
  });
  it("select de lista longa sem o embed é pego", () => {
    expect(regras('.select("id, ref, nome, colecao, subcolecao")')).toEqual(["select-sem-embed"]);
  });
  it("2º select no mesmo arquivo: o literal sem embed é pego mesmo que o 1º esteja certo", () => {
    const src = 'a.select("id, colecao, colecoes(nome)");\nb.select("id, colecao, subcolecao");';
    expect(regras(src)).toEqual(["select-sem-embed"]);
  });
  it('`from("modelos").select("*")` é pego (também quebrado em linhas); `*, colecoes(nome)` passa', () => {
    expect(regras('supabase.from("modelos").select("*").eq("id", x)')).toEqual(["select-estrela"]);
    expect(
      regras('supabase\n  .from("modelos")\n  .select(\n    "*"\n  )\n  .eq("id", x);'),
    ).toEqual(["select-estrela"]);
    expect(regras('supabase.from("modelos").select("*, colecoes(nome)").eq("id", x)')).toEqual([]);
    expect(regras('supabase.from("cad").select("*").eq("id", x)')).toEqual([]); // outra tabela
  });
  it("filtros por `colecao` (.in/.ilike/.or/.not/.neq/.is/.like/.order) são pegos", () => {
    expect(regras('q.in("colecao", lista)')).toEqual(["filtro-cru"]);
    expect(regras('q.ilike("colecao", "%x%")')).toEqual(["filtro-cru"]);
    expect(regras('q.not("colecao", "is", null)')).toEqual(["filtro-cru"]);
    expect(regras("q.neq('colecao', x)")).toEqual(["filtro-cru"]);
    expect(regras('q.order("colecao")')).toEqual(["filtro-cru"]);
    expect(regras('q.or("colecao.ilike.%x%,nome.ilike.%x%")')).toEqual(["filtro-cru"]);
    expect(regras('q.or("colecao.in.(a,b)")')).toEqual(["filtro-cru"]);
    expect(regras('q.eq("colecao", x)')).toEqual(["filtro-cru"]);
  });
  it("não dá falso alarme em colecao_id, subcolecao, colecoes, chaves de objeto, rótulos e queryKeys", () => {
    expect(regras('q.eq("colecao_id", x).in("colecao_id", l).order("subcolecao")')).toEqual([]);
    expect(regras('.select("id, colecao_id, subcolecao, colecoes(nome)")')).toEqual([]);
    expect(
      regras('const o = { colecao: "", colecao_id: null }; fl("colecao"); labels("colecao");'),
    ).toEqual([]);
    expect(regras('queryKey: ["colecao-nome", id]')).toEqual([]);
    expect(
      regras('"Os campos colecao (Coleção), categoria_tecido e linha são informativos"'),
    ).toEqual([]);
  });
});

describe("colecao pelo rótulo: nenhuma leitura crua de modelos.colecao nas telas", () => {
  const todos = arquivos(RAIZ).map((p) => ({ p: norm(p), src: readFileSync(p, "utf8") }));

  it("sanidade: a varredura não está cega (acha os leitores conhecidos e a lista de exceções está vazia)", () => {
    const comColecaoNoSelect = todos.filter(
      (f) => /colecoes\(nome\)/.test(f.src) && /(^|[\s,(])colecao(?=\s*,)/m.test(f.src),
    );
    expect(comColecaoNoSelect.length).toBeGreaterThanOrEqual(12);
    expect(EXCECOES.size).toBe(0);
  });

  it("nenhum literal/filtro cru em src/ (cada achado = um select sem `colecoes(nome)` ou um filtro por `colecao`)", () => {
    const violacoes: string[] = [];
    for (const f of todos) {
      if (EXCECOES.has(f.p)) continue;
      for (const a of leituraCrua(f.src)) {
        if (a.regra === "select-estrela" && EDITORES.has(f.p)) continue;
        violacoes.push(`${f.p}: [${a.regra}] ${a.trecho}`);
      }
    }
    expect(violacoes).toEqual([]);
  });

  it("quem pede `colecoes(nome)` usa o rótulo (@/lib/colecao-rotulo) — sem isso o embed é decorativo", () => {
    for (const f of todos) {
      if (f.p === "src/lib/colecao-rotulo.ts") continue;
      const pede = [...f.src.matchAll(LITERAL)].some(
        (m) => /colecoes\(nome\)/.test(m[2]) && /(^|[\s,(*])(colecao|\*)\s*,/.test(m[2]),
      );
      if (!pede) continue;
      expect(f.src, `${f.p}: falta importar o rótulo`).toMatch(/from "@\/lib\/colecao-rotulo"/);
      expect(f.src, `${f.p}: falta chamar o rótulo`).toMatch(
        /rotuloColecao(DoModelo)?\(|comRotuloColecao(Lista)?\(/,
      );
    }
  });

  it('os editores de `select("*")` continuam sendo leitores de rascunho (a lista não apodrece: o arquivo existe e ainda faz select("*") em modelos)', () => {
    for (const p of EDITORES) {
      const src = todos.find((f) => f.p === p)?.src ?? "";
      expect(src, p).not.toBe("");
      expect(
        leituraCrua(src).some((a) => a.regra === "select-estrela"),
        `${p} já não precisa estar na lista`,
      ).toBe(true);
    }
  });
});
