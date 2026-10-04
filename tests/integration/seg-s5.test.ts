// Reforço de segurança — sub-release S5 ("Faxina de privilégios": ANON-3, PRIV-1, auxiliares do ANON-1), por cima da S4. Só GRANT/
// REVOKE. As migrations são aplicadas DENTRO da transação de cada teste (mig-txn) e tudo é revertido. SÓ na cópia local. Roda como os
// papéis do PostgREST (SET LOCAL ROLE anon/authenticated).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS5, voltaS5, s5Viva, S5_MIG, S5_DOWN } from "./seg-s5-helpers";
import { S5_ACL, S5_AUX, S5_ANON_LE } from "./seg-s5-dados";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
async function como(c: Client, role: "authenticated" | "anon" | "service_role" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s5w");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s5w");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s5w");
    await c.query("RELEASE SAVEPOINT s5w");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const jwt = (c: Client, uid: string | null) =>
  c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaS5(c);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [TENANT_TESTE, USER_TESTE]);
}
const relacoes = async (c: Client) => (await c.query(
  `select c.relname t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') order by 1`)).rows.map((r) => r.t as string);
// ACL normalizada (aclitems em ordem alfabética) — a mesma forma da guarda da migration
const faclDe = async (c: Client, f: string) =>
  (await um<{ a: string }>(c, `select coalesce((select string_agg(x::text, ',' order by x::text) from unnest(proacl) x), '') a from pg_proc where oid = to_regprocedure($1)`, [f])).a;
const aclTabela = async (c: Client, t: string): Promise<[string, string]> => {
  const r = await um<{ a: string; c: string }>(c, `select coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x), '') a,
      coalesce((select string_agg(a.attname || '=' || a.attacl::text, ' ' order by a.attnum) from pg_attribute a
                 where a.attrelid = c.oid and a.attacl is not null and not a.attisdropped), '') c
     from pg_class c where c.oid = to_regclass('public.' || $1)`, [t]);
  return [r.a, r.c];
};

describe.skipIf(!RODA)("seg S5 — ACL exata, idempotência, volta (lista exata) e recusas", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES (as 116 tabelas e os 4 auxiliares); ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const confere = async (lado: "antes" | "depois") => {
        for (const [t, a] of Object.entries(S5_ACL)) expect(await aclTabela(c, t), `${t} ${lado}`).toEqual([a[lado][0], a[lado][1]]);
        for (const [f, a] of Object.entries(S5_AUX)) expect(await faclDe(c, f), `${f} ${lado}`).toBe(a[lado]);
      };
      await aplicaS5(c);
      await confere("depois");
      await aplicarArquivo(c, S5_MIG);
      await confere("depois");
      await voltaS5(c);
      await confere("antes");
      await voltaS5(c);
      await confere("antes");
      await aplicarArquivo(c, S5_MIG);
      await confere("depois");
      expect(Object.keys(S5_ACL).length).toBe(116);
    });
  });

  it("recusa sem a S4/S3 por baixo (ACL fora do antes) e com ACL mexida (ida e volta), sem mudar nada", async () => {
    await withTx(async (c) => {
      await aplicaS5(c);
      await c.query("GRANT TRUNCATE ON public.modelos TO authenticated");
      await expect(aplicarArquivo(c, S5_MIG)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s5_privilegios: ACL inesperada em modelos/) });
      await expect(aplicarArquivo(c, S5_DOWN)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s5_privilegios_down: ACL inesperada em modelos/) });
      await c.query("REVOKE TRUNCATE ON public.modelos FROM authenticated");
      // sem a S4 (a volta dela tira a S5 antes, LIFO): a ACL das 13 do OTB não é nem o antes nem o depois → recusa
      const { voltaS4 } = await import("./seg-s4-helpers");
      await voltaS4(c);
      expect(await s5Viva(c)).toBe(false);
      await expect(aplicarArquivo(c, S5_MIG)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s5_privilegios: ACL inesperada em /) });
    });
  });
});

describe.skipIf(!RODA)("seg S5 — trava medida (pg_locks na txn revertida)", () => {
  it("GRANT/REVOKE em 116 tabelas + 4 funções: nenhuma tabela acima de AccessShare; nada em auth/storage/realtime", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows as { rel: string; mode: string }[];
      if (!(await s5Viva(c))) await aplicaS5(c); // a cadeia S3a..S4 por baixo
      await voltaS5(c);
      const base = new Set((await travas()).map((t) => `${t.rel}|${t.mode}`));
      const t0 = Date.now();
      await aplicarArquivo(c, S5_MIG);
      const ms = Date.now() - t0;
      expect((await travas()).filter((t) => !base.has(`${t.rel}|${t.mode}`))).toEqual([]);
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
      console.log(`[S5 trava] 20261101240000 aplicada em ${ms}ms, nenhuma trava de tabela`);
    });
  });
});

describe.skipIf(!RODA)("seg S5 — anon só lê a identidade; authenticated sem TRUNCATE/REFERENCES/TRIGGER; auxiliares fora do anon", () => {
  it("anti-drift: has_table_privilege('anon', t, x) = false para toda relação de public, menos SELECT em system_settings", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const sobrou: string[] = [];
      for (const t of await relacoes(c)) for (const p of PRIVS) {
        const v = (await um<{ v: boolean }>(c, `select has_table_privilege('anon', to_regclass('public.' || $1), $2) v`, [t, p])).v;
        if (v !== (S5_ANON_LE[t] ?? []).includes(p)) sobrou.push(`${t}:${p}=${v}`);
      }
      expect(sobrou).toEqual([]);
      expect(S5_ANON_LE).toEqual({ system_settings: ["SELECT"] });
    });
  });

  it("anti-drift: authenticated sem TRUNCATE/REFERENCES/TRIGGER em toda relação de public (e com SELECT/INSERT/UPDATE/DELETE onde já tinha)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const sobrou = (await c.query(
        `select c.relname, p from pg_class c cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p
          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and has_table_privilege('authenticated', c.oid, p)`)).rows;
      expect(sobrou).toEqual([]);
      // nada de SELECT/INSERT/UPDATE/DELETE de authenticated mudou na S5
      for (const [t, a] of Object.entries(S5_ACL)) {
        const sem = (acl: string) => (acl.match(/authenticated=([a-zA-Z]*)\//)?.[1] ?? "").replace(/[Dxt]/g, "");
        expect(sem(a.depois[0]), t).toBe(sem(a.antes[0]));
      }
    });
  });

  it("a tela de login/Home deslogada: anon LÊ system_settings; não grava nela nem lê nada além; logado segue lendo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await jwt(c, null);
      expect(txt(await como(c, "anon", `select nome_sistema from system_settings limit 1`))).toBe("PASSOU");
      expect(txt(await como(c, "anon", `select * from system_settings`))).toBe("PASSOU");
      for (const sql of [`update system_settings set nome_sistema = nome_sistema`, `insert into system_settings default values`,
        `select count(*) from modelos`, `select count(*) from tenants`, `select count(*) from user_permissions`, `select count(*) from tenant_config`]) {
        expect(txt(await como(c, "anon", sql)), sql).toMatch(/^42501 permission denied for table/);
      }
      await jwt(c, USER_TESTE);
      expect(txt(await como(c, "authenticated", `select count(*) from system_settings`))).toBe("PASSOU");
      expect(txt(await como(c, "authenticated", `select count(*) from modelos`))).toBe("PASSOU");
    });
  });

  it("os 4 auxiliares: anon NÃO executa (nem por PUBLIC); authenticated e service_role sim; RLS de quem está logado segue usando-os; nenhuma policy lida pelo anon os chama", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const f of Object.keys(S5_AUX)) {
        const r = await um<{ a: boolean; u: boolean; s: boolean }>(c,
          `select has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') a, has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') u,
                  has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE') s`, [f]);
        expect({ f, ...r }).toEqual({ f, a: false, u: true, s: true });
      }
      await jwt(c, null);
      expect(txt(await como(c, "anon", `select public.tenant_module_enabled('otb')`))).toMatch(/^42501 permission denied for function/);
      expect(txt(await como(c, "anon", `select public.meu_tenant_ativo()`))).toMatch(/^42501 permission denied for function/);
      await jwt(c, USER_TESTE);
      expect(txt(await como(c, "authenticated", `select public.tenant_module_enabled('criacao'), public.meu_tenant_ativo(),
          public.user_can_edit('criacao_planejamento'), public.user_can_view('criacao_planejamento')`))).toBe("PASSOU");
      // policies que o anon ainda avalia (as de papel anon/public nas tabelas que ele lê, e as do storage para anon) não usam os 4
      const usa = (await c.query(
        `select schemaname, tablename, policyname from pg_policies
          where (roles && array['anon','public']::name[])
            and ((schemaname = 'public' and tablename = any ($1::text[])) or schemaname = 'storage')
            and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(tenant_module_enabled|user_can_edit|user_can_view|meu_tenant_ativo)'`,
        [Object.keys(S5_ANON_LE)])).rows;
      expect(usa).toEqual([]);
    });
  });

  it("PRIV-2 (da S1) segue: tabela nova do postgres nasce sem anon e sem TRUNCATE/REFERENCES/TRIGGER para authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await c.query(`create table public.zz_s5_nova (id int)`);
      const r = await um<{ a: boolean; t: boolean }>(c, `select has_table_privilege('anon', 'public.zz_s5_nova', 'SELECT') a,
          has_table_privilege('authenticated', 'public.zz_s5_nova', 'TRUNCATE') t`);
      expect(r).toEqual({ a: false, t: false });
    });
  });
});
