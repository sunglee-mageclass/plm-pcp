/**
 * Release I3 — anti-drift catálogo TS (src/lib/integracao/campos.ts) × SQL da I3b (supabase/migrations/20261030110000_integracao_3_campos.sql):
 * layout (21 chaves na ordem), rótulos, `_integracao_padrao()` = CAMPOS_PADRAO e `_integracao_opcionais()` = CAMPOS_OPCIONAIS.
 * ⚠️ Escrito contra o CONTRATO do front da I3 (branch i3/front: CampoKey + colecao/categoria_tecido/linha; CampoDef + padrao/
 * obrigatorio; CAMPOS_PADRAO = filter(padrao); CAMPOS_OPCIONAIS = filter(!obrigatorio)) — só passa depois da junção
 * (release/i3). O teste de banco (tests/integration/integracao-9-tres-campos.test.ts) prova o MESMO no texto vivo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as campos from "@/lib/integracao/campos";

const SQL = readFileSync("supabase/migrations/20261030110000_integracao_3_campos.sql", "utf8");

/** Corpo (entre AS $function$ e $function$) da função `nome` na I3b — exatamente 1 definição. */
function corpo(nome: string): string {
  const cria = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = SQL.indexOf(cria);
  expect(i, nome).toBeGreaterThan(-1);
  expect(SQL.indexOf(cria, i + 1), `${nome} 2×`).toBe(-1);
  const a = SQL.indexOf("AS $function$", i) + "AS $function$".length;
  return SQL.slice(a, SQL.indexOf("$function$", a));
}
const chaves = (txt: string): string[] => [...txt.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const semComentarios = (txt: string): string => txt.replace(/--[^\n]*/g, "");

const LAYOUT_SQL = chaves(semComentarios(corpo("_integracao_layout")).match(/ARRAY\[([\s\S]*?)\]::text\[\]/)![1]);
const ROTULOS_SQL: Record<string, string> = Object.fromEntries(
  [...semComentarios(corpo("_integracao_rotulos")).matchAll(/'([a-z_]+)', '([^']+)'/g)].map((m) => [m[1], m[2]]),
);
/** _integracao_padrao() = concatenação de fatias [i:j] (1-based, inclusivas) do layout. */
const PADRAO_SQL: string[] = [...semComentarios(corpo("_integracao_padrao")).matchAll(/\[(\d+):(\d+)\]/g)]
  .flatMap((m) => LAYOUT_SQL.slice(Number(m[1]) - 1, Number(m[2])));
const OPCIONAIS_SQL = chaves(semComentarios(corpo("_integracao_opcionais")).match(/ARRAY\[([\s\S]*?)\]::text\[\]/)![1]);

describe("integracao/campos × I3b (anti-drift; passa após a junção com o front da I3)", () => {
  it("SQL da I3b: 21 chaves; 19–21 = colecao, categoria_tecido, linha; padrão = 1–17 + 19–21; opcionais = os 3", () => {
    expect(LAYOUT_SQL).toHaveLength(21);
    expect(LAYOUT_SQL.slice(17)).toEqual(["foto", "colecao", "categoria_tecido", "linha"]);
    expect(PADRAO_SQL).toEqual([...LAYOUT_SQL.slice(0, 17), "colecao", "categoria_tecido", "linha"]);
    expect(OPCIONAIS_SQL).toEqual(["colecao", "categoria_tecido", "linha"]);
    expect(ROTULOS_SQL).toMatchObject({ colecao: "Coleção", categoria_tecido: "Categoria do Tecido Principal", linha: "Linha" });
    expect(Object.keys(ROTULOS_SQL).sort()).toEqual([...LAYOUT_SQL].sort());
  });
  it("LAYOUT_KEYS (TS) = _integracao_layout() (I3b), na MESMA ordem", () => {
    expect(campos.LAYOUT_KEYS).toEqual(LAYOUT_SQL);
  });
  it("rótulos (TS) = _integracao_rotulos() (I3b)", () => {
    for (const c of campos.CAMPOS) expect(c.rotulo, c.key).toBe(ROTULOS_SQL[c.key]);
  });
  it("CAMPOS_PADRAO (TS) = _integracao_padrao(); CAMPOS_OPCIONAIS (TS) = _integracao_opcionais()", () => {
    const m = campos as unknown as { CAMPOS_PADRAO: string[]; CAMPOS_OPCIONAIS?: string[] };
    expect(m.CAMPOS_PADRAO).toEqual(PADRAO_SQL);
    expect(m.CAMPOS_OPCIONAIS).toEqual(OPCIONAIS_SQL);
  });
});
