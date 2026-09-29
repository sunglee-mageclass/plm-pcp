/**
 * Distribuição antiga — Parte 2 (banco): migration DESTRUTIVA 20261010100000 (tira `distribuicao_tabelas` + 4 RPCs antigas)
 * e o inverso (recria estrutura + 4 funções byte a byte; os DADOS voltam do dump do kit).
 *
 * • Bloco "estático" (só os arquivos) roda sempre.
 * • Bloco de banco: SÓ na cópia local E com DIST2_MIG_TXN=1 — aplica os arquivos DENTRO da txn (mig-txn.ts tira o
 *   BEGIN/COMMIT; as travas SET LOCAL do arquivo saem) e o withTx faz ROLLBACK. NUNCA `\i` (o COMMIT vazaria — 15/set).
 *   Funciona com a cópia nos DOIS estados (objetos antigos presentes ou já removidos): quando já saíram, o teste os
 *   recria na txn com o inverso antes de exercitar a ida.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, um, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261010100000_distribuicao_antiga_drop.sql";
const INV = "supabase/rollback/20261010100000_distribuicao_antiga_drop_down.sql";
const FNS = [
  "public.distribuicao_resumo(uuid,text)",
  "public.salvar_distribuicao_tabela(jsonb)",
  "public.excluir_distribuicao_tabela(uuid)",
  "public.direcionamento_resumo_subcolecao(uuid)",
] as const;
const DB_TXN = process.env.DIST2_MIG_TXN === "1";
if (DB_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const semComentarios = (s: string) => s.replace(/--[^\n]*/g, "");
const naoAscii = (s: string) => [...s].some((ch) => ch.charCodeAt(0) > 127);
const RE_TRAVAS = /^SET LOCAL (lock_timeout|statement_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(rel: string): string {
  const sql = ler(rel);
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 3) throw new Error(`${rel}: esperado as 3 travas SET LOCAL; achei ${n}`);
  return sql.replace(
    RE_TRAVAS,
    "-- [teste] trava do arquivo removida (a txn do teste tem as suas)",
  );
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(rel), rel);
/** md5 esperados = os que a pós-condição do inverso crava (na ordem de FNS). */
const md5Inverso = () =>
  [...ler(INV).matchAll(/v_md5 IS DISTINCT FROM '([0-9a-f]{32})'/g)].map((r) => r[1]);

describe("Distribuição antiga — Parte 2: arquivos (estático)", () => {
  it("ida: 1 BEGIN/1 COMMIT, travas SET LOCAL, confirmação + LOCK/recontagem na guarda, 4 DROP FUNCTION exatos, DROP TABLE por último (no $pos$), sem CASCADE", () => {
    const m = ler(MIG);
    const sc = semComentarios(m);
    expect(sc.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(sc.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(sc).toContain("SET LOCAL lock_timeout = '500ms';");
    expect(sc).toContain("SET LOCAL statement_timeout = '5s';");
    expect(sc).toContain("SET LOCAL transaction_timeout = '10s';");
    expect(sc.indexOf("SET client_encoding = 'UTF8';")).toBeLessThan(sc.indexOf("BEGIN;"));
    // I-1: a confirmação é a 1ª coisa da guarda; M-1: trava EXCLUSIVE + recontagem vs o backup, ANTES do scan
    const iGuarda = sc.indexOf("DO $guarda$");
    const iConf = sc.indexOf("current_setting('app.confirmo_apagar_distribuicao_antiga', true)");
    const iLock = sc.indexOf("LOCK TABLE public.distribuicao_tabelas IN EXCLUSIVE MODE;");
    const iConta = sc.indexOf("current_setting('app.dist_linhas_backup', true)");
    expect(iConf).toBeGreaterThan(iGuarda);
    expect(iConf).toBeLessThan(iConta);
    expect(iConta).toBeLessThan(iLock);
    expect(iLock).toBeLessThan(sc.indexOf("SELECT string_agg(p.oid::regprocedure::text"));
    const drops = [
      "DROP FUNCTION IF EXISTS public.direcionamento_resumo_subcolecao(uuid);",
      "DROP FUNCTION IF EXISTS public.distribuicao_resumo(uuid, text);",
      "DROP FUNCTION IF EXISTS public.salvar_distribuicao_tabela(jsonb);",
      "DROP FUNCTION IF EXISTS public.excluir_distribuicao_tabela(uuid);",
    ];
    const iTab = sc.indexOf("  DROP TABLE IF EXISTS public.distribuicao_tabelas;");
    for (const d of drops) {
      expect(sc.split(d).length - 1, d).toBe(1);
      expect(sc.indexOf(d), d).toBeGreaterThan(sc.indexOf("END $guarda$;"));
      expect(sc.indexOf(d), d).toBeLessThan(iTab);
    }
    // a tabela sai DENTRO do $pos$ (1º comando), e depois dele só o COMMIT
    expect(iTab).toBeGreaterThan(sc.indexOf("DO $pos$"));
    expect(iTab).toBeLessThan(sc.indexOf("END $pos$;"));
    expect(sc.slice(sc.indexOf("END $pos$;") + "END $pos$;".length).trim()).toBe("COMMIT;");
    expect(sc.match(/^DROP /gm)?.length).toBe(4); // as 4 funções no nível do arquivo
    expect(sc.match(/\bDROP\s+TABLE\b/g)?.length).toBe(1); // e só a tabela antiga
    expect(sc).not.toMatch(/CASCADE/i);
    expect(sc).not.toMatch(/CREATE OR REPLACE FUNCTION/i); // nenhuma função redefinida
    expect(sc.indexOf("NOTIFY pgrst, 'reload schema';")).toBeLessThan(sc.indexOf("DO $pos$"));
  });

  it("ida e inverso: mensagens de RAISE só ASCII (PostgREST 5xx); a ida inteira é ASCII", () => {
    expect(naoAscii(ler(MIG))).toBe(false);
    for (const rel of [MIG, INV]) {
      const raises = ler(rel)
        .split("\n")
        .filter((l) => /RAISE (EXCEPTION|NOTICE)/.test(l) && !l.trim().startsWith("--"));
      expect(raises.length, rel).toBeGreaterThan(0);
      // as RAISE das 4 funções recriadas (texto original, com acento) não entram: só as do próprio inverso
      for (const l of raises.filter((x) => x.includes("distribuicao_antiga_drop")))
        expect(naoAscii(l), l).toBe(false);
    }
  });

  it("inverso: recria tabela + policy + gatilho + índice + 4 funções; md5 da pós-condição = md5 do texto de cada função no arquivo", () => {
    const v = ler(INV);
    const sc = semComentarios(v);
    expect(sc.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(sc.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(sc).toContain("CREATE TABLE IF NOT EXISTS public.distribuicao_tabelas (");
    expect(sc).toContain(
      "CREATE POLICY distribuicao_tabelas_tenant ON public.distribuicao_tabelas",
    );
    expect(sc).toContain(
      "CREATE TRIGGER set_tenant_id_distribuicao BEFORE INSERT ON public.distribuicao_tabelas",
    );
    expect(sc).toContain("CREATE INDEX IF NOT EXISTS idx_distribuicao_tabelas_tenant_colecao");
    expect(sc).toContain("ALTER TABLE public.distribuicao_tabelas ENABLE ROW LEVEL SECURITY;");
    expect(sc).not.toMatch(/\bDROP (TABLE|FUNCTION)\b/);
    expect(sc).toContain("SET LOCAL transaction_timeout = '10s';");
    // I-2: DDL de policy POR ÚLTIMO — depois de toda função/GRANT, logo antes do $pos$
    const iPolDrop = sc.indexOf("DROP POLICY IF EXISTS distribuicao_tabelas_tenant");
    const iPolCria = sc.indexOf("CREATE POLICY distribuicao_tabelas_tenant");
    expect(iPolDrop).toBeGreaterThan(sc.lastIndexOf("GRANT EXECUTE ON FUNCTION"));
    expect(iPolDrop).toBeGreaterThan(sc.lastIndexOf("$function$"));
    expect(iPolCria).toBeGreaterThan(iPolDrop);
    expect(sc.slice(iPolCria, sc.indexOf("DO $pos$")).split(";").length - 1).toBe(1); // só o próprio CREATE POLICY no meio
    const esperados = md5Inverso();
    expect(esperados.length).toBe(4);
    const nomes = [
      "distribuicao_resumo",
      "salvar_distribuicao_tabela",
      "excluir_distribuicao_tabela",
      "direcionamento_resumo_subcolecao",
    ];
    nomes.forEach((n, i) => {
      const ini = v.indexOf(`CREATE OR REPLACE FUNCTION public.${n}(`);
      const a = v.indexOf("$function$", ini);
      const f = v.indexOf("$function$", a + 10);
      expect(ini, n).toBeGreaterThan(0);
      // pg_get_functiondef termina em "$function$\n"
      expect(md5(v.slice(ini, f + 10) + "\n"), n).toBe(esperados[i]);
      for (const g of [
        `REVOKE ALL ON FUNCTION public.${n}(`,
        `GRANT EXECUTE ON FUNCTION public.${n}(`,
      ])
        expect(v, g).toContain(g);
    });
  });
});

describe.skipIf(!(hasDb && ehBancoLocal() && DB_TXN))(
  "Distribuição antiga — Parte 2: banco (cópia, txn revertida)",
  () => {
    async function presente(c: Client): Promise<boolean> {
      return (
        await um<{ ok: boolean }>(
          c,
          "select to_regclass('public.distribuicao_tabelas') is not null ok",
        )
      ).ok;
    }
    async function contagens(c: Client) {
      return um<{ f: number; t: number; p: number; r: number }>(
        c,
        `select
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') f,
      (select count(*)::int from pg_trigger t join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace
        where n.nspname = 'public' and not t.tgisinternal) t,
      (select count(*)::int from pg_policies where schemaname = 'public') p,
      (select count(*)::int from pg_class k join pg_namespace n on n.oid = k.relnamespace where n.nspname = 'public' and k.relkind = 'r') r`,
      );
    }
    /** Assinatura da tabela: colunas/defaults, constraints, índices, gatilhos, policy, RLS, ACL, dono. */
    async function assinaturaTabela(c: Client): Promise<string> {
      const r = await c.query(`
      select 'col:' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') s
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'public.distribuicao_tabelas'::regclass and a.attnum > 0 and not a.attisdropped
      union all select 'con:' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.distribuicao_tabelas'::regclass
      union all select 'idx:' || pg_get_indexdef(indexrelid) from pg_index where indrelid = 'public.distribuicao_tabelas'::regclass
      union all select 'tg:' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.distribuicao_tabelas'::regclass and not tgisinternal
      union all select 'pol:' || polname || ':' || polcmd::text || ':' || polpermissive || ':' || coalesce(pg_get_expr(polqual, polrelid), '') || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
        from pg_policy where polrelid = 'public.distribuicao_tabelas'::regclass
      union all select 'rel:' || relrowsecurity || ':' || relforcerowsecurity || ':' || relowner::regrole || ':' || relacl::text from pg_class where oid = 'public.distribuicao_tabelas'::regclass
      order by 1`);
      return r.rows.map((x) => x.s).join("\n");
    }
    async function fnsInfo(c: Client) {
      const out: string[] = [];
      for (const f of FNS)
        out.push(
          (
            await um<{ s: string | null }>(
              c,
              "select md5(pg_get_functiondef(p.oid)) || '|' || p.proowner::regrole || '|' || p.proacl::text s from pg_proc p where p.oid = to_regprocedure($1)",
              [f],
            )
          )?.s ?? "AUSENTE",
        );
      return out;
    }
    async function preparaPresente(c: Client): Promise<void> {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '60s'");
      if (!(await presente(c))) await aplica(c, INV); // cópia já sem os objetos: recria na txn
    }
    /** I-1/M-1: a confirmação + o nº de linhas "do backup" (por padrão, a contagem atual), como o kit faz com -c SET. */
    async function confirma(c: Client, linhas?: string): Promise<void> {
      const n =
        linhas ??
        (await um<{ n: string }>(c, "select count(*)::text n from public.distribuicao_tabelas")).n;
      await c.query("select set_config('app.confirmo_apagar_distribuicao_antiga', 'sim', true)");
      await c.query("select set_config('app.dist_linhas_backup', $1, true)", [n]);
    }
    async function erroDaIda(c: Client): Promise<string> {
      try {
        await aplica(c, MIG);
        return "";
      } catch (e) {
        return String((e as Error).message);
      }
    }

    it("ida remove tabela + 4 RPCs (−4 funções, −1 gatilho, −1 policy, −1 tabela), 2× não falha; inverso devolve tudo igual (md5, ACL, estrutura)", async () => {
      await withTx(async (c) => {
        await preparaPresente(c);
        const fAntes = await fnsInfo(c);
        expect(fAntes.map((s) => s.split("|")[0])).toEqual(md5Inverso());
        const tAntes = await assinaturaTabela(c);
        const cAntes = await contagens(c);
        await confirma(c);
        await aplica(c, MIG);
        expect(await presente(c)).toBe(false);
        expect(await fnsInfo(c)).toEqual(["AUSENTE", "AUSENTE", "AUSENTE", "AUSENTE"]);
        const cDepois = await contagens(c);
        expect(cDepois).toEqual({
          f: cAntes.f - 4,
          t: cAntes.t - 1,
          p: cAntes.p - 1,
          r: cAntes.r - 1,
        });
        // a Distribuição NOVA segue de pé
        expect(
          (
            await um<{ ok: boolean }>(
              c,
              "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null ok",
            )
          ).ok,
        ).toBe(true);
        // reset/excluir loja: o LOOP dinâmico do _wipe_tenant_core roda sem a tabela (tenant inexistente = 0 linhas)
        await c.query("SAVEPOINT w");
        await c.query(
          "select public._wipe_tenant_core('11111111-2222-3333-4444-555555555555'::uuid, false)",
        );
        await c.query("ROLLBACK TO SAVEPOINT w");
        await aplica(c, MIG); // 2ª vez: IF EXISTS
        await aplica(c, INV);
        expect(await fnsInfo(c)).toEqual(fAntes);
        expect(await assinaturaTabela(c)).toBe(tAntes);
        expect(await contagens(c)).toEqual(cAntes);
        await aplica(c, INV); // inverso 2× também não falha
        expect(await fnsInfo(c)).toEqual(fAntes);
      });
    });

    it("guarda: função VIVA que usa a tabela antiga ⇒ a ida RECUSA (P0001) e não remove nada; menção só em comentário não trava", async () => {
      await withTx(async (c) => {
        await preparaPresente(c);
        // menção em comentário (como a de _direcionamento_plano_modelo_core) NÃO é uso
        await c.query(`create function public._itest_dist2_comentario() returns int language plpgsql as $f$
        begin -- a RPC antiga direcionamento_resumo_subcolecao fazia isto
          return 1; end $f$`);
        await c.query(`create function public._itest_dist2_usa() returns bigint language plpgsql as $f$
        begin return (select count(*) from public.distribuicao_tabelas); end $f$`);
        await confirma(c);
        const erro = await erroDaIda(c);
        expect(erro).toMatch(
          /funcao viva ainda usa a Distribuicao antiga \(_itest_dist2_usa\(\)\)/,
        );
        expect(erro).not.toMatch(/_itest_dist2_comentario/);
        expect(await presente(c)).toBe(true);
        expect((await fnsInfo(c)).every((s) => s !== "AUSENTE")).toBe(true);
      });
    });
    it("I-1/M-1: sem confirmação, sem nº de linhas ou com nº diferente do backup ⇒ a ida RECUSA (P0001) e não remove nada", async () => {
      await withTx(async (c) => {
        await preparaPresente(c);
        const intacto = async () => {
          expect(await presente(c)).toBe(true);
          expect((await fnsInfo(c)).every((s) => s !== "AUSENTE")).toBe(true);
        };
        // 1) nada setado (um `psql -f` solto fora do kit)
        expect(await erroDaIda(c)).toMatch(
          /falta SET app\.confirmo_apagar_distribuicao_antiga = sim/,
        );
        await intacto();
        // 2) confirmação sem o nº de linhas do backup
        await c.query("select set_config('app.confirmo_apagar_distribuicao_antiga', 'sim', true)");
        await c.query("select set_config('app.dist_linhas_backup', '', true)");
        expect(await erroDaIda(c)).toMatch(/falta SET app\.dist_linhas_backup/);
        await intacto();
        // 3) alguém gravou depois do backup (backup tinha 1 linha a menos)
        const n = Number(
          (await um<{ n: string }>(c, "select count(*)::text n from public.distribuicao_tabelas"))
            .n,
        );
        await confirma(c, String(n + 1));
        expect(await erroDaIda(c)).toMatch(/alguem gravou depois do backup/);
        await intacto();
        // 4) certo ⇒ sai
        await confirma(c);
        expect(await erroDaIda(c)).toBe("");
        expect(await presente(c)).toBe(false);
      });
    });
  },
);
