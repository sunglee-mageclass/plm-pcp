/**
 * Distribuição por produto — migration ADITIVA 20261006100000 (spec 2026-09-25 §5.1; plano Task 4). Colunas
 * plan_tecido_variantes.distribuicao/atende, 5 funções redefinidas (_salvar_plan_tecido_core, _plan_tecido_gravar_bom_core,
 * _plan_tecido_snapshot, tenant_module_enabled, _plan_tecido_arvore_core) e a RPC nova direcionamento_plano_modelo (+ _core).
 * Arquivos GERADOS por .superpowers/distribuicao/mig/gerar_sql.py a partir do texto VIVO (não editar à mão).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela os blocos de banco
 * PULAM; com DIST_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta. NUNCA `\i` (o COMMIT do arquivo vazaria — 15/set).
 *  • DIST_MIG_TXN=1 — a cópia SEM a migration; cada teste aplica o arquivo DENTRO da txn (mig-txn.ts; as 2 travas SET LOCAL
 *    saem antes). Segura ACCESS EXCLUSIVE em plan_tecido_variantes durante o teste (N3 — dono avisado ANTES).
 *  • sem a variável — a migration JÁ aplicada na cópia (ensaio da Task 10 / Task 11); os testes do "antes" pulam.
 * O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261006100000_distribuicao_por_produto.sql";
const INV = "supabase/rollback/20261006100000_distribuicao_por_produto_down.sql";
// Ordem FIXA = md5-redef-*.txt = guardas do arquivo.
const REDEF = [
  { arq: "salvar", fn: "public._salvar_plan_tecido_core(uuid,jsonb,integer)", cria: "CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(" },
  { arq: "gravar_bom", fn: "public._plan_tecido_gravar_bom_core(uuid,jsonb)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_gravar_bom_core(" },
  { arq: "snapshot", fn: "public._plan_tecido_snapshot(uuid)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_snapshot(" },
  { arq: "modulo", fn: "public.tenant_module_enabled(text)", cria: "CREATE OR REPLACE FUNCTION public.tenant_module_enabled(" },
  { arq: "arvore", fn: "public._plan_tecido_arvore_core(uuid)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(" },
] as const;
const NOVAS = [
  { fn: "public._direcionamento_plano_modelo_core(uuid,uuid)", cria: "CREATE OR REPLACE FUNCTION public._direcionamento_plano_modelo_core(" },
  { fn: "public.direcionamento_plano_modelo(uuid)", cria: "CREATE OR REPLACE FUNCTION public.direcionamento_plano_modelo(" },
] as const;
// Trocas EXATAS (as MESMAS do gerar_sql.py — TROCAS). Cada âncora 1× no texto vivo.
const ANCORAS: Record<string, string[]> = {
  salvar: [
    "          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)\n",
    "                 w.multiplicador, w.grades, w.grade_total\n",
    "                coalesce((e->>'grade_total')::int,0)       as grade_total,\n",
  ],
  gravar_bom: [
    "declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n",
    "  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n",
    "      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)\n",
  ],
  snapshot: ["                      'grade_total', pv.grade_total\n"],
  modulo: ["    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')\n"],
  arvore: ["                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)\n"],
};
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.DIST_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL; achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);
/** Texto da função no arquivo: de "CREATE OR REPLACE FUNCTION …(" até o 2º "$function$" (o 1º é o "AS $function$"). */
function corpo(rel: string, inicio: string): string {
  const t = ler(rel);
  const i = t.indexOf(inicio);
  const a = i < 0 ? -1 : t.indexOf("$function$", i);
  const f = a < 0 ? -1 : t.indexOf("$function$", a + 10);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${inicio.slice(0, 60)}…)`);
  return t.slice(i, f + 10);
}
/** Guardas das REDEFINIDAS, na ordem: [{antes, depois}] (v_md5 NOT IN ('antes', 'depois')). */
const guardas = (rel: string) =>
  [...ler(rel).matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ antes: r[1], depois: r[2] }));
/** Guardas das NOVAS (só na migration): md5 do texto novo. */
const guardasNovas = (rel: string) => [...ler(rel).matchAll(/<> '([0-9a-f]{32})' THEN -- nova/g)].map((r) => r[1]);

describe("Distribuição A — arquivos (estático, sem banco)", () => {
  it("5 redefinidas: migration = inverso (texto vivo) com SÓ as trocas; âncoras 1×; guarda md5 EXATA nos 2 arquivos", () => {
    const gM = guardas(MIG), gI = guardas(INV);
    expect(gM).toHaveLength(5);
    expect(gI).toEqual(gM);
    REDEF.forEach((f, i) => {
      const antes = corpo(INV, f.cria), depois = corpo(MIG, f.cria);
      for (const a of ANCORAS[f.arq]) expect(antes.split(a).length - 1, `${f.arq}: ${a.slice(0, 50)}`).toBe(1);
      expect(depois, f.arq).not.toBe(antes);
      expect(gM[i], f.arq).toEqual({ antes: md5(antes + "\n"), depois: md5(depois + "\n") });
    });
    expect(corpo(MIG, REDEF[0].cria)).toContain("w.grade_total, w.distribuicao, w.atende");
    expect(corpo(MIG, REDEF[1].cria)).toContain("complementa_variante_ids");
    expect(corpo(MIG, REDEF[2].cria)).toContain("'distribuicao', pv.distribuicao, 'atende', pv.atende");
    expect(corpo(MIG, REDEF[3].cria)).toContain("'produto_importado', 'distribuicao')");
    expect(corpo(MIG, REDEF[4].cria)).toContain("'distribuicao', vv.distribuicao, 'atende', vv.atende");
  });
  it("2 novas: guarda = md5 do texto do arquivo; o inverso as DERRUBA", () => {
    const g = guardasNovas(MIG);
    expect(g).toEqual(NOVAS.map((n) => md5(corpo(MIG, n.cria) + "\n")));
    const v = ler(INV);
    expect(v).toContain("DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);");
    expect(v).toContain("DROP FUNCTION IF EXISTS public._direcionamento_plano_modelo_core(uuid, uuid);");
  });
  it("travas: encoding ANTES do BEGIN; 1 BEGIN/1 COMMIT e as 2 SET LOCAL logo depois; $pos$ → NOTIFY → COMMIT (PR10); NENHUMA DDL de policy; nada em tenant_config; nada da reorg", () => {
    for (const f of [MIG, INV]) {
      const t = ler(f);
      const linhas = t.split("\n");
      const i = linhas.findIndex((l) => l === "BEGIN;");
      expect(t.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith("SET client_encoding = 'UTF8';\nBEGIN;\n"), f).toBe(true);
      expect(linhas.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      const iPos = t.indexOf("DO $pos$"), iNot = t.indexOf("NOTIFY pgrst, 'reload schema';"), iCom = t.indexOf("\nCOMMIT;\n");
      expect(iPos, f).toBeGreaterThan(0);
      expect(iNot, f).toBeGreaterThan(t.indexOf("END $pos$;", iPos));
      expect(iCom, f).toBeGreaterThan(iNot);
      expect(t, f).toMatch(/Aplicar SÓ via \.superpowers\/distribuicao\/mig\//);
      expect(linhas.filter((l) => l === "BEGIN;"), f).toHaveLength(1);
      expect(linhas.filter((l) => l === "COMMIT;"), f).toHaveLength(1);
      expect(t, f).not.toMatch(/^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im);
      expect(t, f).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|COMMENT ON COLUMN) public\.tenant_config/);
      expect(t, f).not.toContain("_replicar_cards_plan_tecido_core");
      expect(t, f).not.toMatch(/(REVOKE|GRANT)[^;]*tenant_module_enabled/); // ACL INTOCADA (R5)
    }
  });
  it("ordem da migration: guarda → 4 redefinidas → core → wrapper → ACL → ALTER → CHECKs → COMMENT → árvore (sql) → $pos$ → NOTIFY → COMMIT", () => {
    const m = ler(MIG);
    const pos = (s: string) => m.indexOf(s);
    const ord = [
      "DO $guarda$", REDEF[0].cria, REDEF[1].cria, REDEF[2].cria, REDEF[3].cria, NOVAS[0].cria, NOVAS[1].cria,
      "REVOKE EXECUTE ON FUNCTION public._direcionamento_plano_modelo_core(uuid, uuid) FROM PUBLIC, anon, authenticated;",
      "ALTER TABLE public.plan_tecido_variantes\n  ADD COLUMN IF NOT EXISTS distribuicao jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "DO $ck$", "COMMENT ON COLUMN public.plan_tecido_variantes.distribuicao", REDEF[4].cria, "DO $pos$",
      "NOTIFY pgrst, 'reload schema';", "\nCOMMIT;\n",
    ].map(pos);
    ord.forEach((p, i) => expect(p, `item ${i}`).toBeGreaterThan(i === 0 ? m.indexOf("SET LOCAL transaction_timeout") : ord[i - 1]));
    expect(m).toContain("GRANT EXECUTE ON FUNCTION public.direcionamento_plano_modelo(uuid) TO authenticated;");
    expect(m).toContain("REVOKE ALL ON FUNCTION public.direcionamento_plano_modelo(uuid) FROM PUBLIC, anon;");
    for (const s of ["public._salvar_plan_tecido_core(uuid, jsonb, integer)", "public._plan_tecido_gravar_bom_core(uuid, jsonb)", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_arvore_core(uuid)"])
      expect(m).toContain(`REVOKE EXECUTE ON FUNCTION ${s} FROM PUBLIC, anon, authenticated;`);
    expect(m).not.toMatch(/DROP\s+(COLUMN|TABLE|FUNCTION)/i);
  });
  it("inverso: trava explícita → confirmação + LIFO (exige a tabela antiga) → árvore ANTES → demais → DROP das novas → DROP COLUMN POR ÚLTIMO → $pos$", () => {
    const v = ler(INV);
    const iLock = v.indexOf("LOCK TABLE public.plan_tecido_variantes IN ACCESS EXCLUSIVE MODE;"); // PR10: antes da guarda
    expect(iLock).toBeGreaterThan(v.indexOf("SET LOCAL transaction_timeout"));
    expect(iLock).toBeLessThan(v.indexOf("DO $guarda$"));
    expect(v).toContain("app.confirmo_apagar_distribuicao_por_produto");
    expect(v).toContain("to_regclass('public.distribuicao_tabelas') IS NULL");
    const iArv = v.indexOf(REDEF[4].cria), iSalvar = v.indexOf(REDEF[0].cria), iDrop = v.indexOf("DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);");
    const iAlter = v.indexOf("ALTER TABLE public.plan_tecido_variantes");
    expect(iArv).toBeGreaterThan(v.indexOf("DO $guarda$"));
    expect(iSalvar).toBeGreaterThan(iArv);
    expect(iDrop).toBeGreaterThan(iSalvar);
    expect(iAlter).toBeGreaterThan(iDrop);
    expect(v.slice(iAlter, v.indexOf("DO $pos$")).replace(/--[^\n]*/g, "").trim()).toBe(
      "ALTER TABLE public.plan_tecido_variantes\n  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_atende_array,\n  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_distribuicao_objeto,\n  DROP COLUMN IF EXISTS atende,\n  DROP COLUMN IF EXISTS distribuicao;");
  });
});

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query("select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null as ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN) await aplica(c, MIG);
}
const def = async (c: Client, fn: string) => (await um<{ d: string | null }>(c, "select pg_get_functiondef(to_regprocedure($1)) d", [fn])).d;
const privs = (c: Client, fn: string) =>
  um<{ pub: boolean; anon: boolean; auth: boolean; srv: boolean }>(c,
    `select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') srv
       from pg_proc p where p.oid = to_regprocedure($1)`, [fn]);
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT dist_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT dist_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT dist_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}
/** Liga criação/PCP/distribuição da Loja Teste e REBAIXA o super_admin do usuário de teste (txn revertida) — sem isso
 *  `tenant_module_enabled` devolve sempre true (is_super_admin). */
async function lojaComModulos(c: Client, distribuicao: boolean): Promise<void> {
  await comoUsuario(c);
  await c.query("delete from public.user_roles where user_id = $1 and role = 'super_admin'", [USER_TESTE]);
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, $2::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || $2::jsonb`,
    [TENANT_TESTE, JSON.stringify({ criacao: true, producao: true, otb: true, distribuicao })],
  );
}
type Cena = { col: string; artigo: string; vtMarrom: string; vtPreto: string; corMarrom: string; corPreto: string; corVinho: string; lojas: string[] };
async function cena(c: Client): Promise<Cena> {
  const T = TENANT_TESTE;
  const col = await um<{ id: string }>(c, "insert into colecoes (nome, status) values ('ITEST-DIST', 'rascunho') returning id");
  const artigo = await um<{ id: string }>(c, "insert into artigos (tenant_id, nome) values ($1, 'ITEST-DIST Crepe') returning id", [T]);
  const cor = async (n: string) => (await um<{ id: string }>(c, "insert into cores (tenant_id, nome) values ($1, $2) returning id", [T, n])).id;
  const corMarrom = await cor("ITEST-DIST Marrom"), corPreto = await cor("ITEST-DIST Preto"), corVinho = await cor("ITEST-DIST Vinho");
  const vt = async (corId: string) => (await um<{ id: string }>(c,
    "insert into variantes_tecido (tenant_id, artigo_id, cor_id) values ($1, $2, $3) returning id", [T, artigo.id, corId])).id;
  const lojas = (await c.query("select id from lojas_direcionamento where tenant_id = $1 and ativo order by is_default desc, ordem nulls last limit 2", [T])).rows.map((r) => r.id as string);
  if (lojas.length < 2) throw new Error("a Loja Teste precisa de 2 lojas ativas em lojas_direcionamento (cópia)");
  return { col: col.id, artigo: artigo.id, vtMarrom: await vt(corMarrom), vtPreto: await vt(corPreto), corMarrom, corPreto, corVinho, lojas };
}
const dist = (loja: string, base: number, grades: Record<string, number>, manuais: string[] = []) => ({ [loja]: { base, grades, manuais } });
const arvore = (slots: unknown[]) => ({ subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }] });
const ler1 = async (c: Client, col: string) => (await um<{ a: any }>(c, "select public.plan_tecido_arvore($1) a", [col])).a.subcolecoes[0].linhas[0].slots[0];

describe.skipIf(!PRONTO)("Distribuição A — banco (cópia local, txn revertida)", () => {
  it("colunas: distribuicao jsonb NOT NULL DEFAULT '{}', atende jsonb NULL; CHECKs recusam forma errada (23514)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query(
        `select a.attname nome, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = 'public.plan_tecido_variantes'::regclass and a.attname in ('distribuicao','atende') and not a.attisdropped order by 1`);
      expect(rows).toEqual([
        { nome: "atende", tipo: "jsonb", nn: false, def: null },
        { nome: "distribuicao", tipo: "jsonb", nn: true, def: "'{}'::jsonb" },
      ]);
      const pv = await um<{ id: string }>(c, "select id from plan_tecido_variantes limit 1");
      if (pv) {
        expect((await falha(c, "update plan_tecido_variantes set distribuicao = '[]'::jsonb where id = $1", [pv.id])).code).toBe("23514");
        expect((await falha(c, "update plan_tecido_variantes set atende = '{}'::jsonb where id = $1", [pv.id])).code).toBe("23514");
      }
    });
  });

  it("5 redefinidas e 2 novas: texto = o do arquivo (md5 'depois'); ACL (#9) — internas fechadas, wrapper só authenticated, tenant_module_enabled INTOCADA", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const g = guardas(MIG);
      for (const [i, f] of REDEF.entries()) {
        const d = (await def(c, f.fn))!;
        expect(d, f.arq).toBe(corpo(MIG, f.cria) + "\n");
        expect(md5(d), f.arq).toBe(g[i].depois);
      }
      for (const n of NOVAS) expect((await def(c, n.fn))!).toBe(corpo(MIG, n.cria) + "\n");
      for (const fn of ["public._salvar_plan_tecido_core(uuid,jsonb,integer)", "public._plan_tecido_gravar_bom_core(uuid,jsonb)", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_arvore_core(uuid)", "public._direcionamento_plano_modelo_core(uuid,uuid)"])
        expect(await privs(c, fn), fn).toEqual({ pub: false, anon: false, auth: false, srv: true });
      expect(await privs(c, "public.direcionamento_plano_modelo(uuid)")).toEqual({ pub: false, anon: false, auth: true, srv: true });
      expect(await privs(c, "public.tenant_module_enabled(text)")).toEqual({ pub: true, anon: true, auth: true, srv: true });
    });
  });

  it("tenant_module_enabled: 'distribuicao' ausente/false = desligado, 'true' = ligado; 'producao' ausente segue ligado; 'otb' ausente segue desligado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, false);
      const ve = async (m: string) => (await um<{ v: boolean }>(c, "select public.tenant_module_enabled($1) v", [m])).v;
      expect(await ve("distribuicao")).toBe(false);
      await c.query("update tenant_config set modules = modules - 'distribuicao' - 'producao' - 'otb' where tenant_id = $1", [TENANT_TESTE]);
      expect([await ve("distribuicao"), await ve("producao"), await ve("otb")]).toEqual([false, true, false]);
      await c.query("update tenant_config set modules = modules || '{\"distribuicao\":true}'::jsonb where tenant_id = $1", [TENANT_TESTE]);
      expect(await ve("distribuicao")).toBe(true);
    });
  });

  it("salvar + árvore: distribuição SÓ no T1 (objeto), 'atende' SÓ fora do T1 (array); forma errada vira default; DEDUP leva a da linha vencedora", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const dA = dist(k.lojas[0], 2, { "38|P": 2 }), dB = dist(k.lojas[1], 5, { "40|M": 5 });
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 2, distribuicao: dA, atende: [k.vtPreto] },
          { variante_tecido_id: k.vtMarrom, ordem: 2, multiplicador: 1, grades: {}, grade_total: 9, distribuicao: dB, atende: [k.vtPreto] },
          { variante_tecido_id: k.vtPreto, ordem: 3, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: "lixo" },
        ] },
        { artigo_id: k.artigo, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 9, distribuicao: dA, atende: [k.vtMarrom, `plan:${k.corVinho}|`] },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: {}, grade_total: 1, atende: { errado: true } },
        ] },
      ] }]))]);
      const s = await ler1(c, k.col);
      const t1 = s.materiais.find((m: any) => m.tipo === "tecido").variantes;
      expect(t1.map((v: any) => [v.variante_tecido_id, v.grade_total, v.distribuicao, v.atende])).toEqual([
        [k.vtMarrom, 9, dB, null],       // DEDUP: a de MAIOR grade_total vence e leva a SUA distribuição; T1 nunca tem 'atende'
        [k.vtPreto, 1, {}, null],        // forma errada → '{}'
      ]);
      const fr = s.materiais.find((m: any) => m.tipo === "forro").variantes;
      expect(fr.map((v: any) => [v.distribuicao, v.atende])).toEqual([
        [{}, [k.vtMarrom, `plan:${k.corVinho}|`]], // fora do T1: distribuição some, 'atende' fica (inclusive chave de cor planejada)
        [{}, null],                                 // 'atende' que não é array → NULL
      ]);
    });
  });

  it("blindagem: o snapshot do Salvar guarda distribuicao e atende", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const d = dist(k.lojas[0], 3, { "38|P": 3 });
      const arv = arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, distribuicao: d }] },
        { artigo_id: k.artigo, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [{ variante_tecido_id: k.vtPreto, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, atende: [k.vtMarrom] }] },
      ] }]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arv)]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arv)]); // 2º save snapshota o 1º
      const p = (await um<{ p: any }>(c, "select payload p from plan_tecido_snapshots where colecao_id = $1 order by created_at desc, id desc limit 1", [k.col])).p;
      const mats = p.arvore.subcolecoes[0].linhas[0].slots[0].materiais;
      expect(mats[0].variantes[0].distribuicao).toEqual(d);
      expect(mats[1].variantes[0].atende).toEqual([k.vtMarrom]);
    });
  });

  it("gravar BOM: casamento do payload (só ids REAIS do T1 do payload); T1 nunca casa; chave ausente PRESERVA só as cores que seguem no T1 (PR13); [] limpa (R3)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const m = await um<{ id: string }>(c, "insert into modelos (tenant_id, nome, origem) values ($1, 'ITEST-DIST BOM', 'interno') returning id", [TENANT_TESTE]);
      const outro = await um<{ id: string } | undefined>(c, "select id from variantes_tecido where tenant_id <> $1 limit 1", [TENANT_TESTE]);
      const payload = (forro: Record<string, unknown>) => JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: { "38|P": 5 }, grade_total: 5, complementa_variante_ids: [k.vtPreto] },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: { "38|P": 7 }, grade_total: 7 },
        ] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, ...forro }] },
      ]);
      const comp = async () => (await c.query(
        `select mt.tipo, mtv.variante_tecido_id v, mtv.complementa_variante_ids c from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id where mt.modelo_id = $1 order by mt.tipo desc, mtv.ordem`, [m.id])).rows
        .map((r) => [r.tipo, r.c ? [...r.c].sort() : null]);
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id,
        payload({ complementa_variante_ids: [k.vtPreto, k.vtMarrom, "lixo", ...(outro ? [outro.id] : [])] })]);
      expect(await comp()).toEqual([["tecido", null], ["tecido", null], ["forro", [k.vtMarrom, k.vtPreto].sort()]]);
      expect((await um<{ s: string }>(c, "select public._grade_soma_pares($1, $2::uuid[])::text s", [m.id, [k.vtMarrom, k.vtPreto]])).s).toBe("12");
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payload({})]); // SEM a chave
      expect((await comp())[2]).toEqual(["forro", [k.vtMarrom, k.vtPreto].sort()]);
      // PR13 (G-plano R4): SEM a chave e o Preto SAIU do Tecido 1 ⇒ o Preto sai do casamento; a reserva do forro segue pelo
      // que ficou (não zera em silêncio — #4).
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: { "38|P": 5 }, grade_total: 5 }] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1 }] },
      ])]);
      expect((await comp())[1]).toEqual(["forro", [k.vtMarrom]]);
      expect((await um<{ s: string }>(c,
        `select public._grade_soma_pares($1, mtv.complementa_variante_ids)::text s from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id where mt.modelo_id = $1 and mt.tipo = 'forro'`, [m.id])).s).toBe("5");
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payload({ complementa_variante_ids: [] })]);
      expect((await comp())[2]).toEqual(["forro", null]);
    });
  });

  it("direcionamento_plano_modelo: plano do modelo (variante_numero pelo BOM), sem correspondência, direcionados; IDOR; motivos", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const [L1, L2] = k.lojas;
      const mo = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Vestido', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      const irmao = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Irmão', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      await c.query("insert into cad (modelo_id, direcionamento_status) values ($1, 'separado')", [irmao.id]);
      const mt = await um<{ id: string }>(c, "insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id", [mo.id, k.artigo]);
      await c.query("insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1, $2, 1), ($1, $3, 2)", [mt.id, k.vtPreto, k.vtMarrom]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: mo.id, slot_index: 0, materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 7, distribuicao: { ...dist(L1, 5, { "38|P": 4, "40|M": 10 }, ["38|P"]), ...dist(L2, 1, { "38|P": 1.6 }) } },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: {}, grade_total: 3,
            distribuicao: { ...dist(L1, 3, { "38|P": 3 }), lixo: { base: 1, grades: { "38|P": 1 }, manuais: [] } } }, // N3: chave que não é uuid é ignorada
          { variante_tecido_id: null, cor_id: k.corVinho, ordem: 3, multiplicador: 1, grades: {}, grade_total: 2, distribuicao: dist(L2, 2, { "40|M": 2 }) },
          { variante_tecido_id: null, cor_id: k.corPreto, cor_apelido_id: null, ordem: 4, multiplicador: 1, grades: {}, grade_total: 0 },
        ] },
      ] }]))]);
      const r = (await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r;
      expect([r.subcolecao, r.direcionados, r.motivo_sem_plano]).toEqual(["Drop 1", 1, null]);
      expect(r.plano.variantes.map((v: any) => [v.variante_numero, v.cor_nome])).toEqual([[1, "ITEST-DIST Preto"], [2, "ITEST-DIST Marrom"], [null, "ITEST-DIST Vinho"]]);
      expect(r.plano.celulas).toEqual([
        { loja_id: L1, variante_numero: 1, grades: { "38|P": 3 } },
        { loja_id: L1, variante_numero: 2, grades: { "38|P": 4, "40|M": 10 } },
        { loja_id: L2, variante_numero: 2, grades: { "38|P": 2 } },            // 1.6 arredonda
      ]);
      expect(r.plano.sem_correspondencia).toEqual([{ cor_nome: "ITEST-DIST Vinho", apelido_nome: null, total: 2 }]);
      expect(r.plano.lojas.map((l: any) => l.loja_id)).toEqual([L1, L2]);
      expect(r.plano.tamanho_tipo).toBe("letra");
      // IDOR: modelo de outra loja
      const alheio = await um<{ id: string } | undefined>(c, "select id from modelos where tenant_id <> $1 limit 1", [TENANT_TESTE]);
      if (alheio) expect((await falha(c, "select public.direcionamento_plano_modelo($1)", [alheio.id])).code).toBe("P0001");
      // motivos
      await c.query("update modelos set origem = 'revenda' where id = $1", [mo.id]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r.motivo_sem_plano).toBe("comprado");
      await c.query("update modelos set origem = 'interno' where id = $1", [mo.id]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [irmao.id])).r).toMatchObject({ plano: null, motivo_sem_plano: "sem_plano_tecido", direcionados: 1 });
      await c.query("update tenant_config set modules = modules || '{\"distribuicao\":false}'::jsonb where tenant_id = $1", [TENANT_TESTE]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r).toMatchObject({ plano: null, motivo_sem_plano: "modulo_desligado", direcionados: 1 });
    });
  });

  it("guarda 'outra frente': se uma redefinida já mudou (md5 fora de antes/depois), a migration RECUSA (P0001)", async () => {
    if (!MIG_TXN) return; // só no modo txn (a cópia sem a migration)
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      const t = (await def(c, "public._plan_tecido_snapshot(uuid)"))!;
      await c.query(t.replace("retenção: 20 últimos", "retenção: 21 últimos")); // outra frente mexeu
      await c.query("SAVEPOINT g");
      let erro = "";
      try { await aplica(c, MIG); } catch (e) { erro = String((e as Error).message); }
      await c.query("ROLLBACK TO SAVEPOINT g");
      expect(erro).toMatch(/_plan_tecido_snapshot mudou/);
    });
  });

  it("PR10 — pós-condição: md5 'depois' adulterado (simula corrupção pós-CREATE) ⇒ a ida RECUSA e desfaz TUDO", async () => {
    if (!MIG_TXN) return; // só no modo txn (a cópia sem a migration)
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      const antes = await Promise.all(REDEF.map((f) => def(c, f.fn)));
      const mig = ler(MIG);
      const real = guardas(MIG)[2].depois; // _plan_tecido_snapshot — a função é CRIADA com o texto real; só o $pos$ exige outro
      const falso = real.slice(0, -1) + (real.at(-1) === "0" ? "1" : "0");
      const alvo = `IF v_md5 IS DISTINCT FROM '${real}' THEN\n    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou`;
      expect(mig.split(alvo).length - 1).toBe(1);
      const forjada = mig.replace(alvo, alvo.replace(real, falso));
      let erro = "";
      try { await aplicarSql(c, semTravas(forjada, "migration forjada"), "migration forjada"); } catch (e) { erro = String((e as Error).message); }
      expect(erro).toMatch(/pós-condição falhou/);
      expect(await Promise.all(REDEF.map((f) => def(c, f.fn)))).toEqual(antes);
      expect((await um<{ n: number }>(c, "select count(*)::int n from information_schema.columns where table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')")).n).toBe(0);
      expect((await um<{ ok: boolean }>(c, "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null ok")).ok).toBe(true);
    });
  });

  it("idempotência: aplicar 2× não falha; inverso (com confirmação) devolve as 5 ao texto de antes e tira colunas e RPCs; sem confirmação RECUSA", async () => {
    if (!MIG_TXN) return;
    await withTx(async (c) => {
      await prepara(c);
      await aplica(c, MIG); // 2ª vez
      const semConf = await (async () => { await c.query("SAVEPOINT s"); try { await aplica(c, INV); return ""; } catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return String((e as Error).message); } })();
      expect(semConf).toMatch(/confirmo_apagar_distribuicao_por_produto/);
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'");
      await aplica(c, INV);
      const g = guardas(INV);
      for (const [i, f] of REDEF.entries()) expect(md5((await def(c, f.fn))!), f.arq).toBe(g[i].antes);
      expect((await um<{ n: number }>(c, "select count(*)::int n from information_schema.columns where table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')")).n).toBe(0);
      expect((await um<{ n: boolean }>(c, "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null n")).n).toBe(true);
      await aplica(c, INV); // inverso 2× também não falha
    });
  });
});
