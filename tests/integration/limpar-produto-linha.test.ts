/**
 * Paridade PA/PI (complemento "Linha tambem sem card", nov/2026): LIMPAR o produto (sem card) zera tambem a LINHA.
 *  `_limpar_produto_acabado_core` / `_limpar_produto_importado_core` ganham `linha_id = null` no UPDATE de "limpar".
 * Migration: supabase/migrations/20261118140000_limpar_produto_zera_linha.sql (inverso em supabase/rollback/).
 *
 * Os blocos de banco SO rodam na COPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres), com a
 * migration JA aplicada (psql -f). Cada teste em BEGIN...ROLLBACK. Nenhum arquivo de migration e aplicado dentro de txn aqui.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261118140000_limpar_produto_zera_linha.sql";
const INV = "supabase/rollback/20261118140000_limpar_produto_zera_linha_down.sql";
const T = TENANT_TESTE;
const LOCAL = hasDb && ehBancoLocal();

const FUNCS: Record<string, { sig: string; antes: string; depois: string }> = {
  limparPA: { sig: "public._limpar_produto_acabado_core(uuid)", antes: "da3d5e8e14c3609fc97f9e73bc8db08d", depois: "b5ef31d7274ec7887d6741b93b8ee71e" },
  limparPI: { sig: "public._limpar_produto_importado_core(uuid)", antes: "d863544b621523cf9c1d4532b4909759", depois: "c45ebb23ad4d2d905bd88af34c0bcaa6" },
};

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
function corpo(rel: string, nome: string): string {
  const t = ler(rel);
  const inicio = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = t.indexOf(inicio);
  expect(i, `${rel}: ${nome} ausente`).toBeGreaterThanOrEqual(0);
  expect(t.indexOf(inicio, i + 1), `${rel}: ${nome} 2x`).toBe(-1);
  const a = t.indexOf("$function$", i);
  const f = t.indexOf("$function$", a + 10);
  return t.slice(i, f + 10);
}
const nomeDe = (sig: string) => sig.replace("public.", "").split("(")[0];

describe("limpar produto zera a Linha — arquivos (estatico)", () => {
  it("ida: guarda aceita ANTES e DEPOIS; corpos = md5 pinado; `linha_id = null` no UPDATE; REVOKE dos 2 cores", () => {
    const m = ler(MIG);
    for (const [k, f] of Object.entries(FUNCS)) {
      expect(m, k).toContain(`'${f.antes}', '${f.depois}'`);
      expect(md5(corpo(MIG, nomeDe(f.sig)) + "\n"), k).toBe(f.depois);
      expect(corpo(MIG, nomeDe(f.sig)), k).toMatch(/linha_id = null,[^\n]*\n\s+updated_at = now\(\)/);
      expect(m).toContain(`REVOKE EXECUTE ON FUNCTION ${f.sig} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("inverso: guarda aceita DEPOIS e ANTES; devolve os 2 corpos (md5 de ANTES, sem linha_id)", () => {
    const v = ler(INV);
    for (const [k, f] of Object.entries(FUNCS)) {
      expect(v, k).toContain(`'${f.antes}', '${f.depois}'`);
      expect(md5(corpo(INV, nomeDe(f.sig)) + "\n"), k).toBe(f.antes);
      expect(corpo(INV, nomeDe(f.sig)), k).not.toContain("linha_id");
    }
  });

  it("RAISE da migration (fora dos corpos herdados) so ASCII", () => {
    for (const rel of [MIG, INV]) {
      const linhas = ler(rel).split("\n").filter((l) => /RAISE EXCEPTION '/.test(l) && !l.includes("$function$"));
      // os corpos das funcoes herdam RAISE com acento do vivo; so as guardas/pos do arquivo (prefixo limpar_produto_zera_linha) sao novas
      for (const l of linhas.filter((x) => x.includes("limpar_produto_zera_linha"))) expect(/^[\x20-\x7e]*$/.test(l), l).toBe(true);
    }
  });
});

describe.skipIf(!LOCAL)("limpar produto zera a Linha — banco (copia local)", () => {
  async function prepara(c: Client) {
    await c.query("SET LOCAL lock_timeout = '3s'");
    await c.query("SET LOCAL statement_timeout = '60s'");
    await comoUsuario(c);
    const k = await um<any>(c, `
      SELECT (SELECT id FROM public.grupos_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS grupo,
             (SELECT id FROM public.categorias_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS cat`, [T]);
    expect(k.grupo && k.cat).toBeTruthy();
    return k as { grupo: string; cat: string };
  }
  const novaLinha = async (c: Client, nome: string) =>
    (await um<{ id: string }>(c, "INSERT INTO public.linhas (tenant_id, nome) VALUES ($1, $2) RETURNING id", [T, nome])).id;

  it("migration aplicada: md5 vivo = DEPOIS; EXECUTE negado a PUBLIC/anon/authenticated (inv. #9)", async () => {
    await withTx(async (c) => {
      for (const [k, f] of Object.entries(FUNCS)) {
        const r = await um<any>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [f.sig]);
        expect(r.m, k).toBe(f.depois);
        const a = await um<any>(c, `SELECT has_function_privilege('public', to_regprocedure($1), 'EXECUTE') AS p,
            has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS a,
            has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS u`, [f.sig]);
        expect(a, k).toEqual({ p: false, a: false, u: false });
      }
    });
  });

  const TIPOS = [
    {
      nome: "PA", tabela: "produtos_acabados", limpar: "_limpar_produto_acabado_core",
      salvar: (c: Client, d: Record<string, unknown>) => um<{ id: string }>(c, "SELECT public._salvar_produto_acabado_core(NULL::uuid, $1::jsonb, '[]'::jsonb) AS id", [JSON.stringify(d)]),
    },
    {
      nome: "PI", tabela: "produtos_importados", limpar: "_limpar_produto_importado_core",
      salvar: (c: Client, d: Record<string, unknown>) => um<{ id: string }>(c, "SELECT public._salvar_produto_importado_core(NULL::uuid, $1::jsonb, '[]'::jsonb, '[]'::jsonb) AS id", [JSON.stringify(d)]),
    },
  ];

  for (const tp of TIPOS) {
    it(`${tp.nome}: limpar o produto (sem card) com Linha -> ${tp.tabela}.linha_id = null (nome e categoria tambem zeram)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const l = await novaLinha(c, `LPL Linha ${tp.nome}`);
        const pid = (await tp.salvar(c, { nome: `LPL ${tp.nome} Vestido`, grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0, linha_id: l })).id;
        const antes = await um<any>(c, `SELECT linha_id, modelo_id, nome FROM public.${tp.tabela} WHERE id = $1`, [pid]);
        expect(antes).toMatchObject({ linha_id: l, modelo_id: null });
        await c.query(`SELECT public.${tp.limpar}($1)`, [pid]);
        const dep = await um<any>(c, `SELECT linha_id, nome, categoria_id FROM public.${tp.tabela} WHERE id = $1`, [pid]);
        expect(dep.linha_id).toBeNull();
        expect(dep.nome).toBe("");
        expect(dep.categoria_id).toBeNull();
      });
    });

    it(`${tp.nome}: limpar produto que JA estava sem Linha segue funcionando (null -> null)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const pid = (await tp.salvar(c, { nome: `LPL ${tp.nome} Sem Linha`, grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0 })).id;
        await c.query(`SELECT public.${tp.limpar}($1)`, [pid]);
        expect((await um<any>(c, `SELECT linha_id FROM public.${tp.tabela} WHERE id = $1`, [pid])).linha_id).toBeNull();
      });
    });
  }
});
