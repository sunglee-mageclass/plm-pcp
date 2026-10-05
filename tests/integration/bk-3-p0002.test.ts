// Frente Backend B3 — mensagens "não encontrado" (RAISE … P0002) em ASCII (desenho item 20; P-259 = A). Plano:
// .superpowers/sdd/2026-10-05-backend/plan.md §9 B3 (+ §0 K4); feito no worktree camada (ruling R2 da Camada).
// Migration GERADA 20261103147000_bk_p0002_ascii (gerar-bk3.mjs): só a MENSAGEM do único RAISE … P0002 de 11 funções muda, de PT
// acentuado para `nao_encontrado: <entidade>`. Por quê: o PostgREST devolve P0* (exceto P0001) como HTTP 500 e, com caractere
// não-ASCII, responde text/plain "Something went wrong" — a tela perde o code. Cada caso em transação revertida (withTx) e SÓ na
// cópia local: a migration é aplicada DENTRO da txn (bk-helpers/mig-txn, nunca \i). As RPCs rodam como o PAPEL do PostgREST
// (SET LOCAL ROLE authenticated) com o JWT do super admin da Loja Teste (os portões de módulo/página/admin passam: o teste é da
// mensagem do "não encontrado", não da permissão); fixtures como postgres, sem JWT.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaBk, bkViva, voltaBk } from "./bk-helpers";
import { aplicaMod, md5ModSucessor, voltaModSePreciso } from "./mod-helpers";
import { kanbanChaveDesligada } from "./loja-fixture";
import { BK_MD5, BK_MIG, BK_DOWN, BK_SENTINELA, BK3_ACL, BK3_SEG, BK3_MSG } from "./bk-3-dados";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const NADA = "00000000-0000-4000-8000-0000000b3b30"; // id que não existe em tabela nenhuma

type Res = { ok: true } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel do PostgREST (`authenticated`) num SAVEPOINT; erro volta ao savepoint (a txn segue usável). */
async function comoCliente(c: Client, sql: string, params: unknown[] = []): Promise<Res> {
  await c.query("SAVEPOINT bk3");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT bk3");
    return { ok: true };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT bk3");
    await c.query("RELEASE SAVEPOINT bk3");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c); // idempotente (cópia já com a Modularidade)
  await aplicaBk(c, "B3"); // idempotente (cópia já com a B3, ou BK_TXN=1: pula)
  expect(await bkViva(c, "B3")).toBe(true);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SUPER, role: "authenticated" })]);
}

/** Cada uma das 11 pela porta que a tela usa (RPC pública; as 6 `_core` pelo wrapper), com id inexistente. */
const CASOS: { fn: string; sql: string; antes?: (c: Client) => Promise<void> }[] = [
  { fn: "public._excluir_oc_tecido_core(uuid)", sql: "SELECT public.excluir_oc_tecido($1)" },
  { fn: "public._excluir_oc_importado_core(uuid)", sql: "SELECT public.excluir_oc_importado($1)" },
  { fn: "public._excluir_oc_p_acabado_core(uuid)", sql: "SELECT public.excluir_oc_p_acabado($1)" },
  { fn: "public._excluir_produto_acabado_core(uuid)", sql: "SELECT public.excluir_produto_acabado($1)" },
  { fn: "public._limpar_produto_acabado_core(uuid)", sql: "SELECT public.limpar_produto_acabado($1)" },
  { fn: "public._limpar_produto_importado_core(uuid)", sql: "SELECT public.limpar_produto_importado($1)" },
  { fn: "public.voltar_modelo_desenvolvimento(uuid)", sql: "SELECT public.voltar_modelo_desenvolvimento($1)" },
  { fn: "public.kanban_mover(uuid,text)", sql: "SELECT public.kanban_mover($1, 'stand_by')" },
  { fn: "public.kanban_previa_restauracao(uuid)", sql: "SELECT public.kanban_previa_restauracao($1)" },
  {
    fn: "public.kanban_restaurar(uuid)",
    sql: "SELECT public.kanban_restaurar($1)",
    antes: (c) => semJwt(c, () => kanbanChaveDesligada(c, T)), // com a chave ligada a recusa (P0001) vem antes do "não encontrado"
  },
  {
    fn: "public.kanban_definir_automatico(boolean)",
    sql: "SELECT public.kanban_definir_automatico(true)",
    // "não encontrado" aqui = a loja ativa sem linha em tenant_config (nenhuma FK aponta para ela; a txn é revertida)
    antes: (c) => semJwt(c, async () => void (await c.query("DELETE FROM public.tenant_config WHERE tenant_id = $1", [T]))),
  },
];

// RAISE … (do 'raise' ao ';', com a mensagem literal) e o errcode explícito.
const RAISE_RE = /raise\s+exception\s+'((?:[^']|'')*)'[^;]*;/gi;
/** O PostgREST (14.x) responde 5xx para estes SQLSTATE (tabela de erros do PostgREST): P0* exceto P0001, 08/09/25/2D/38/39/3B/40/
 *  53/54/55/57/58/F0/HV/XX e 42P17 (25006 = 405). Nomes de condição: os de P0/40/55/57 que o PL/pgSQL aceita. */
const NOME_5XX = /^(no_data_found|too_many_rows|assert_failure|plpgsql_error|serialization_failure|deadlock_detected|lock_not_available|query_canceled|object_in_use)$/i;
function vira5xx(code: string): boolean {
  if (NOME_5XX.test(code)) return true;
  const c = code.toUpperCase();
  if (!/^[0-9A-Z]{5}$/.test(c)) return false;
  if (c === "P0001" || c === "25006") return false;
  return /^(P0|08|09|25|2D|38|39|3B|40|53|54|55|57|58|F0|HV|XX)/.test(c) || c === "42P17";
}

describe.skipIf(!RODA)("bk B3 — RAISE … P0002 'não encontrado' em ASCII (nao_encontrado: <entidade>)", () => {
  it("as 11, chamadas pela RPC da tela com id inexistente (papel authenticated): P0002 com a mensagem ASCII exata", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS) {
        if (k.antes) await k.antes(c);
        const r = await comoCliente(c, k.sql, k.sql.includes("$1") ? [NADA] : []);
        expect(txt(r), k.fn).toBe(`P0002 ${BK3_MSG[k.fn].depois}`);
        expect(/^[\x20-\x7e]*$/.test(r.ok ? "" : r.msg), k.fn).toBe(true);
      }
      expect(CASOS.map((k) => k.fn).sort()).toEqual(Object.keys(BK_MD5).sort());
    });
  });

  it("anti-drift: nenhuma função de public tem RAISE com errcode que o PostgREST devolve como 5xx e mensagem não-ASCII", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query<{ f: string; d: string }>(
        `SELECT p.oid::regprocedure::text AS f, pg_get_functiondef(p.oid) AS d
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')`,
      );
      const ruins: string[] = [];
      let p0002 = 0;
      for (const r of rows) {
        for (const m of r.d.matchAll(RAISE_RE)) {
          const code = /errcode\s*=\s*'([^']+)'/i.exec(m[0])?.[1];
          if (code?.toUpperCase() === "P0002") p0002++;
          if (code && vira5xx(code) && !/^[\x20-\x7e]*$/.test(m[1])) ruins.push(`${r.f}: ${m[0]}`);
        }
      }
      expect(ruins).toEqual([]);
      expect(p0002).toBeGreaterThanOrEqual(11); // as 11 seguem P0002 (só a mensagem mudou)
      // a mesma regra pelo regex do Postgres (fronteira \y, NUNCA \b): RAISE … P0002/P0409 com byte não-ASCII = 0
      const pg = await um<{ n: string }>(
        c,
        `SELECT count(*) AS n
           FROM pg_proc p, regexp_matches(pg_get_functiondef(p.oid), '(raise\\s+exception\\s+''(?:[^'']|'''')*''[^;]*;)', 'gi') AS m
          WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
            AND m[1] ~* 'errcode\\s*=\\s*''P0(002|409)\\y' AND m[1] ~ '[^\\x01-\\x7e]'`,
      );
      expect(pg.n).toBe("0");
    });
  });

  it("migration: guarda/pós (md5, ACL, SECURITY, search_path, authenticated), ida 2× / _down 2× / ida; só catálogo nas travas", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaMod(c);
      await aplicaBk(c);
      await voltaBk(c); // estado de ANTES desta frente (B3 inclusa) dentro da txn
      await aplicaBk(c, "F21"); // os blocos anteriores à B3 de volta (B4/F2.1 nunca saem)
      for (const [fn, m] of Object.entries(BK_MD5)) expect(await md5Fn(c, fn), fn).toBe(m.antes);
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      // Travas vistas de FORA (2ª sessão), só a DIFERENÇA que o aplicarArquivo da B3 pegou (os ganchos *_TXN já seguram as deles).
      type Trava = { rel: string | null; nsp: string | null; mode: string };
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      const travas = async (): Promise<Trava[]> =>
        (
          await b.query(
            `SELECT c.relname AS rel, n.nspname AS nsp, l.mode
               FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation'`,
            [pid],
          )
        ).rows;
      const chave = (t: Trava) => `${t.nsp}.${t.rel}|${t.mode}`;
      let novas: Trava[] = [];
      try {
        const antes = new Set((await travas()).map(chave));
        await aplicarArquivo(c, BK_MIG);
        novas = (await travas()).filter((t) => !antes.has(chave(t)));
      } finally {
        await b.end();
      }
      expect(novas.filter((t) => /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp ?? ""))).toEqual([]);
      expect(novas.filter((t) => t.nsp === "public" && t.mode !== "AccessShareLock")).toEqual([]);
      expect(novas.filter((t) => t.mode === "AccessExclusiveLock")).toEqual([]);
      const confere = async (lado: "antes" | "depois") => {
        for (const [fn, m] of Object.entries(BK_MD5)) {
          expect(await md5Fn(c, fn), fn).toBe(m[lado]);
          const p = await um(
            c,
            `SELECT coalesce(proacl::text, '') AS acl, prosecdef AS sd, array_to_string(proconfig, '|') AS cfg,
                    has_function_privilege('anon', oid, 'EXECUTE') AS anon,
                    has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
               FROM pg_proc WHERE oid = to_regprocedure($1)`,
            [fn],
          );
          expect(p, fn).toEqual({
            acl: BK3_ACL[fn],
            sd: BK3_SEG[fn].secdef,
            cfg: BK3_SEG[fn].cfg,
            anon: false,
            auth: BK3_SEG[fn].authenticated,
          });
          const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])).d;
          expect(d.includes(`'${BK3_MSG[fn][lado]}'`), fn).toBe(true);
        }
      };
      await confere("depois");
      await aplicarArquivo(c, BK_MIG); // idempotente
      await confere("depois");
      await aplicarArquivo(c, BK_DOWN);
      await confere("antes");
      await aplicarArquivo(c, BK_DOWN); // idempotente
      await confere("antes");
      await aplicarArquivo(c, BK_MIG);
      await confere("depois");
    });
  });

  it("guarda: recusa (P0001) com texto inesperado numa das 11; nada muda", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaMod(c);
      await aplicaBk(c);
      await voltaBk(c);
      const FN = "public.kanban_mover(uuid,text)";
      const antes = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])).d;
      await c.query(antes.replace("BEGIN\n", "BEGIN\n  -- sonda\n"));
      await expect(aplicarArquivo(c, BK_MIG)).rejects.toThrow(/bk3_p0002_ascii: public\.kanban_mover\(uuid,text\) com texto inesperado/);
      await expect(aplicarArquivo(c, BK_DOWN)).rejects.toThrow(
        /bk3_p0002_ascii_down: public\.kanban_mover\(uuid,text\) com texto inesperado/,
      );
      await c.query(antes);
      for (const [fn, m] of Object.entries(BK_MD5)) expect(await md5Fn(c, fn), fn).toBe(m.antes);
    });
  });

  it("cadeia LIFO dos testes: md5ModSucessor (Mod T1 → B3) inclui o 'depois' da B3; voltaModSePreciso tira a B3 primeiro", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const V = "public.voltar_modelo_desenvolvimento(uuid)";
      expect(md5ModSucessor(V, BK_MD5[V].antes)).toEqual([BK_MD5[V].antes, BK_MD5[V].depois]);
      expect(md5ModSucessor(BK_SENTINELA, BK_MD5[BK_SENTINELA].antes)).toEqual([
        BK_MD5[BK_SENTINELA].antes,
        BK_MD5[BK_SENTINELA].depois,
      ]);
      await aplicaMod(c);
      await aplicaBk(c, "B3");
      expect(await bkViva(c, "B3")).toBe(true);
      await voltaModSePreciso(c);
      expect(await bkViva(c, "B3")).toBe(false);
      for (const [fn, m] of Object.entries(BK_MD5)) {
        // voltar_modelo_desenvolvimento: a volta da Mod T1 vai além da B3 (texto de antes da T1)
        if (fn === V) expect(await md5Fn(c, fn)).not.toBe(m.depois);
        else expect(await md5Fn(c, fn), fn).toBe(m.antes);
      }
    });
  });
});
