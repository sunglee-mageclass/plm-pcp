// Urgentes R2 T9 (plan-a Task 9, Rulings A12-A13) - lista "Insumos padrao" da loja (20261103174000): coluna
// tenant_config.insumos_padrao jsonb NOT NULL DEFAULT '[]' gravada SO por salvar_config_loja (compare-and-set POR COLUNA, como as
// outras 17). A RPC valida (array, <= 20, insumo/cor DA LOJA, consumo 0..9999 com <= 4 casas, sem par repetido) e normaliza
// ([{etiqueta_id, cor_id, consumo}] na mesma ordem) - fixture COMPARTILHADA com o espelho TS da T11:
// tests/fixtures/insumos-padrao-casos.ts. Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "174000") (pula se ja
// vivo). Os testes de trava/laco usam 2 conexoes, sempre em txn revertida. So na copia local.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaUrgA, urgAViva, voltaUrgAAcima, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import {
  CASOS_NORMALIZA,
  CASOS_RECUSA,
  IP_IDS,
  PREFIXO_ERRO_INSUMOS_PADRAO,
  type InsumoPadrao,
} from "../fixtures/insumos-padrao-casos";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SIG = "public.salvar_config_loja(uuid,jsonb,jsonb,boolean)";
const ANTES = "2d43c259135119b345a09a894091c2b5"; // tabela de fatos do plan-a (05/out) = 20261027130000 (L3)
const U_COMUM = "a9e10000-0000-4000-8000-0000000000a1"; // usuario SEM papel admin (criado na txn)
const U_ADMIN = "a9e10000-0000-4000-8000-0000000000a2"; // tenant_admin da Loja Teste (criado na txn)
const bloco = () => URG_A_MIGS.find((x) => x.id === "174000")?.b;
const depois = (): string | undefined => bloco()?.MD5[SIG]?.depois;

type Erro = { code?: string; message: string; detail?: string };
async function tenta(c: Client, sql: string, params: any[] = []): Promise<{ erro: Erro | null; rows: any[] }> {
  await c.query("SAVEPOINT t_ip");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT t_ip");
    return { erro: null, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT t_ip");
    return { erro: { code: e.code, message: e.message, detail: e.detail }, rows: [] };
  }
}
const CHAMA = "SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, $4::boolean) AS r";
const salvar = (c: Client, mud: object, base: object, chave: boolean | null = null) =>
  tenta(c, CHAMA, [T, JSON.stringify(mud), JSON.stringify(base), chave]);
async function linha(c: Client): Promise<Record<string, any>> {
  return (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id = $1", [T])).j;
}
/** aplica o arquivo na txn e devolve os timeouts do teste (o arquivo faz SET LOCAL transaction_timeout = 30s). */
async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarArquivo(c, rel);
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function colunaExiste(c: Client): Promise<boolean> {
  return (
    await um<{ n: number }>(
      c,
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'insumos_padrao'`,
    )
  ).n === 1;
}

/**
 * Os testes de TRAVA medem por diferenca e com 2a conexao: so fazem sentido com a coluna JA na copia (174000 aplicada de verdade).
 * Com a copia sem a 174000 (ex.: URG_A_TXN numa copia antiga), o aplicaUrgA faz o ADD COLUMN DENTRO da txn e ja segura o
 * AccessExclusive - o teste e pulado (o laco e a ida de verdade sao exercitados pelo psql -f do kit/relatorio).
 */
async function colunaNaCopia(): Promise<boolean> {
  const k = new Client({ connectionString: dbUrl()!, ssl: false });
  await k.connect();
  try {
    return await colunaExiste(k);
  } finally {
    await k.end();
  }
}

async function usuarioLoja(c: Client, uid: string, tenantAdmin: boolean): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `Teste ip ${uid.slice(-2)}`],
  );
  if (tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
}
const entra = (c: Client, uid: string) =>
  c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);

/** Bloco vivo na txn + insumos/cores FIXOS da fixture (Loja Teste e outra loja) + admin da loja logado. */
async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await aplicaUrgA(c, "174000");
  const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
  await c.query("SELECT set_config('request.jwt.claims', '', true)");
  for (const [id, tenant, nome] of [
    [IP_IDS.E1, T, "URG-A2 E1"],
    [IP_IDS.E2, T, "URG-A2 E2"],
    [IP_IDS.E_OUTRA, outra, "URG-A2 E OUTRA"],
  ]) {
    await c.query("INSERT INTO public.etiquetas (id, tenant_id, nome) VALUES ($1, $2, $3)", [id, tenant, nome]);
  }
  for (const [id, tenant, nome] of [
    [IP_IDS.C1, T, "URG-A2 C1"],
    [IP_IDS.C2, T, "URG-A2 C2"],
    [IP_IDS.C_OUTRA, outra, "URG-A2 C OUTRA"],
  ]) {
    await c.query("INSERT INTO public.cores (id, tenant_id, nome) VALUES ($1, $2, $3)", [id, tenant, nome]);
  }
  await comoUsuario(c); // fixa USER_TESTE na Loja Teste (txn)
  await usuarioLoja(c, U_ADMIN, true);
  await usuarioLoja(c, U_COMUM, false);
  await entra(c, U_ADMIN);
}

describe.skipIf(!RODA)("urg R2 T9 - tenant_config.insumos_padrao + salvar_config_loja (174000)", () => {
  it("bloco gerado; md5 antes = tabela de fatos; vivo = depois; coluna jsonb NOT NULL DEFAULT '[]'; ACL da RPC igual", async () => {
    expect(bloco(), "bloco 174000 em urg-a-dados.ts (gerar-a2.mjs)").toBeTruthy();
    expect(bloco()!.MD5[SIG]?.antes).toBe(ANTES);
    await withTx(async (c) => {
      await prepara(c);
      expect(await urgAViva(c, "174000")).toBe(true);
      expect(await md5Fn(c, SIG)).toBe(depois());
      const col = await um<{ t: string; n: string; d: string }>(
        c,
        `SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'insumos_padrao'`,
      );
      expect(col).toEqual({ t: "jsonb", n: "NO", d: "'[]'::jsonb" });
      const p = await um<{ acl: string; sd: boolean; cfg: string[]; vol: string }>(
        c,
        `SELECT proacl::text AS acl, prosecdef AS sd, proconfig AS cfg, provolatile::text AS vol FROM pg_proc WHERE oid = $1::regprocedure`,
        [SIG],
      );
      expect(p).toEqual({ acl: "{postgres=X/postgres,authenticated=X/postgres}", sd: true, cfg: ["search_path=public"], vol: "v" });
      const priv = await um<{ a: boolean; s: boolean }>(
        c,
        `SELECT has_column_privilege('anon', 'public.tenant_config', 'insumos_padrao', 'SELECT') AS a,
                has_column_privilege('authenticated', 'public.tenant_config', 'insumos_padrao', 'SELECT') AS s`,
      );
      expect(priv).toEqual({ a: false, s: true });
    });
  });

  it("normalizacao: cada caso da fixture grava e devolve o normalizado (so 3 chaves, mesma ordem)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const caso of CASOS_NORMALIZA) {
        const base = (await linha(c)).insumos_padrao;
        const r = await salvar(c, { insumos_padrao: caso.entrada }, { insumos_padrao: base });
        expect(r.erro, caso.nome).toBeNull();
        const out = r.rows[0].r;
        expect(out.gravadas, caso.nome).toEqual(["insumos_padrao"]);
        expect(out.valores.insumos_padrao, caso.nome).toEqual(caso.esperado);
        const gravado = (await linha(c)).insumos_padrao as InsumoPadrao[];
        expect(gravado, caso.nome).toEqual(caso.esperado);
        for (const it of gravado) expect(Object.keys(it).sort(), caso.nome).toEqual(["consumo", "cor_id", "etiqueta_id"]);
      }
    });
  });

  it("recusas: cada caso da fixture -> P0001 com o motivo; nada gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const inicial = [{ etiqueta_id: IP_IDS.E2, cor_id: null, consumo: 7 }];
      const ok = await salvar(c, { insumos_padrao: inicial }, { insumos_padrao: (await linha(c)).insumos_padrao });
      expect(ok.erro).toBeNull();
      for (const caso of CASOS_RECUSA) {
        const r = await salvar(c, { insumos_padrao: caso.entrada }, { insumos_padrao: inicial });
        expect(r.erro?.code, caso.nome).toBe("P0001");
        expect(r.erro?.message.startsWith(PREFIXO_ERRO_INSUMOS_PADRAO), `${caso.nome}: ${r.erro?.message}`).toBe(true);
        expect(r.erro?.message, caso.nome).toContain(caso.motivo);
        expect((await linha(c)).insumos_padrao, caso.nome).toEqual(inicial);
      }
    });
  });

  it("compare-and-set: base != servidor -> P0409 conflito_versao: config_loja (DETAIL insumos_padrao); convergido passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const outro = [{ etiqueta_id: IP_IDS.E1, cor_id: IP_IDS.C1, consumo: 2 }];
      // "outra aba" gravou antes (direto, como postgres)
      await c.query("UPDATE public.tenant_config SET insumos_padrao = $2::jsonb WHERE tenant_id = $1", [T, JSON.stringify(outro)]);
      const meu = [{ etiqueta_id: IP_IDS.E2, cor_id: null, consumo: 1 }];
      const r = await salvar(c, { insumos_padrao: meu, keywords: "kw-urg-a2" }, { insumos_padrao: [], keywords: (await linha(c)).keywords });
      expect(r.erro?.code).toBe("P0409");
      expect(r.erro?.message).toBe("conflito_versao: config_loja");
      expect(r.erro?.detail).toBe("insumos_padrao");
      const l = await linha(c);
      expect(l.insumos_padrao).toEqual(outro);
      expect(l.keywords).not.toBe("kw-urg-a2");
      // convergido: base velha, mas o que eu mando (normalizado) = o que ja esta la -> grava sem conflito
      const conv = await salvar(c, { insumos_padrao: [{ ...outro[0], etiqueta_id: IP_IDS.E1.toUpperCase(), extra: 1 }] }, { insumos_padrao: [] });
      expect(conv.erro).toBeNull();
      expect((await linha(c)).insumos_padrao).toEqual(outro);
    });
  });

  it("so a coluna enviada muda (as outras 17 e o resto da linha intocados); junto de outra coluna grava as duas", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const antes = await linha(c);
      const lista = [{ etiqueta_id: IP_IDS.E1, cor_id: null, consumo: 1 }];
      const r = await salvar(c, { insumos_padrao: lista }, { insumos_padrao: antes.insumos_padrao });
      expect(r.erro).toBeNull();
      const dep = await linha(c);
      const sem = (o: Record<string, any>) => {
        const { insumos_padrao: _i, updated_at: _u, ...resto } = o;
        return resto;
      };
      expect(sem(dep)).toEqual(sem(antes));
      expect(dep.insumos_padrao).toEqual(lista);
      // keywords + insumos_padrao no mesmo Salvar
      const r2 = await salvar(
        c,
        { insumos_padrao: [], keywords: "  kw-urg-a2  " },
        { insumos_padrao: lista, keywords: dep.keywords },
      );
      expect(r2.erro).toBeNull();
      expect(r2.rows[0].r.gravadas).toEqual(["insumos_padrao", "keywords"]);
      expect(r2.rows[0].r.valores).toEqual({ insumos_padrao: [], keywords: "kw-urg-a2" });
    });
  });

  it("usuario comum -> 42501 (nada gravado); super admin grava", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const lista = [{ etiqueta_id: IP_IDS.E1, cor_id: IP_IDS.C2, consumo: 4 }];
      await entra(c, U_COMUM);
      const r = await salvar(c, { insumos_padrao: lista }, { insumos_padrao: [] });
      expect(r.erro?.code).toBe("42501");
      expect((await linha(c)).insumos_padrao).toEqual([]);
      await entra(c, USER_TESTE);
      const s = await salvar(c, { insumos_padrao: lista }, { insumos_padrao: [] });
      expect(s.erro).toBeNull();
      expect((await linha(c)).insumos_padrao).toEqual(lista);
    });
  });

  it("ida re-aplicada com a coluna ja la: nenhuma trava > AccessShare em tenant_config; idempotente", async (ctx) => {
    if (!(await colunaNaCopia())) ctx.skip();
    await withTx(async (c) => {
      await prepara(c);
      await aplica(c, bloco()!.mig);
      const { rows } = await c.query(
        `SELECT mode FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'relation' AND relation = 'public.tenant_config'::regclass`,
      );
      for (const r of rows) expect(["AccessShareLock", "RowShareLock", "RowExclusiveLock"]).toContain(r.mode);
      expect(await md5Fn(c, SIG)).toBe(depois());
    });
  });

  it("_down devolve o texto de antes (coluna fica; insumos_padrao recusado pela lista branca); reaplicar volta ao depois", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await voltaUrgAAcima(c, "174000"); // [urg R2 T10] LIFO: a 175000 (por cima) sai antes
      await aplica(c, bloco()!.down);
      await c.query("SET LOCAL check_function_bodies = on");
      expect(await md5Fn(c, SIG)).toBe(ANTES);
      expect(await colunaExiste(c)).toBe(true);
      const r = await salvar(c, { insumos_padrao: [] }, { insumos_padrao: [] });
      expect(r.erro?.code).toBe("P0001");
      expect(r.erro?.message).toContain('"insumos_padrao"');
      await aplica(c, bloco()!.down); // idempotente
      expect(await md5Fn(c, SIG)).toBe(ANTES);
      await c.query("SET LOCAL check_function_bodies = on");
      await aplica(c, bloco()!.mig);
      expect(await md5Fn(c, SIG)).toBe(depois());
    });
  });

  it("_down_drop: recusa com a ida viva; com lista gravada exige a GUC; DROP + ida de novo -> travas novas: AccessExclusive SO em tenant_config (nada auth/storage/realtime)", async (ctx) => {
    if (!(await colunaNaCopia())) ctx.skip();
    await withTx(async (c) => {
      await prepara(c);
      const lista = [{ etiqueta_id: IP_IDS.E1, cor_id: null, consumo: 1 }];
      expect((await salvar(c, { insumos_padrao: lista }, { insumos_padrao: [] })).erro).toBeNull();
      await c.query("SELECT set_config('request.jwt.claims', '', true)");
      await expect(aplica(c, bloco()!.drop)).rejects.toThrow(/funcoes ainda citam/);
      await voltaUrgAAcima(c, "174000"); // [urg R2 T10] LIFO: a 175000 (por cima) sai antes
      await aplica(c, bloco()!.down);
      await c.query("SET LOCAL check_function_bodies = on");
      await expect(aplica(c, bloco()!.drop)).rejects.toThrow(/app\.confirmo_apagar_insumos_padrao/);
      await c.query("SELECT set_config('app.confirmo_apagar_insumos_padrao', 'sim', true)");
      const travas = async () =>
        (
          await c.query(
            `SELECT l.mode, coalesce(n.nspname || '.' || cl.relname, l.locktype) AS rel
               FROM pg_locks l LEFT JOIN pg_class cl ON cl.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = cl.relnamespace
              WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation'`,
          )
        ).rows.map((r) => `${r.rel}:${r.mode}`);
      // por DIFERENCA (R6 do Backend): a txn ainda nao travou tenant_config acima de RowExclusive (o Salvar acima)
      const antes = new Set(await travas());
      expect([...antes].filter((x) => /tenant_config:AccessExclusive/.test(x))).toEqual([]);
      await aplica(c, bloco()!.drop);
      expect(await colunaExiste(c)).toBe(false);
      await aplica(c, bloco()!.mig);
      const novas = (await travas()).filter((x) => !antes.has(x));
      expect(novas.filter((x) => /AccessExclusive/.test(x))).toEqual(["public.tenant_config:AccessExclusiveLock"]);
      expect(novas.filter((x) => /^(auth|storage|realtime)\./.test(x))).toEqual([]);
      expect(await colunaExiste(c)).toBe(true);
      expect(await md5Fn(c, SIG)).toBe(depois());
      // a coluna recriada nasce '[]' para todas as lojas
      const n = await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.tenant_config WHERE insumos_padrao <> '[]'::jsonb");
      expect(n.n).toBe(0);
    });
  });

  it("laco de trava (3 x 1500ms + 1s): outra sessao lendo tenant_config por ~2s -> a 2a tentativa pega; segurando ~7s -> 55P03, nada muda", async (ctx) => {
    if (!(await colunaNaCopia())) ctx.skip();
    exigeBancoLocal();
    const conecta = async () => {
      const k = new Client({ connectionString: dbUrl()!, ssl: false });
      await k.connect();
      return k;
    };
    const a = await conecta();
    const b = await conecta();
    try {
      for (const segura of [2200, 7000]) {
        await a.query("BEGIN");
        await a.query("SET LOCAL lock_timeout = '3s'");
        await a.query("SET LOCAL statement_timeout = '60s'");
        await aplicaUrgA(a, "174000");
        await voltaUrgAAcima(a, "174000"); // [urg R2 T10] LIFO: a 175000 (por cima) cita insumos_padrao e travaria o _down_drop
        await aplica(a, bloco()!.down); // o _down_drop exige a funcao sem a coluna
        await a.query("SET LOCAL check_function_bodies = on");
        await a.query("SELECT set_config('app.confirmo_apagar_insumos_padrao', 'sim', true)");
        await b.query("BEGIN");
        await b.query("SELECT 1 FROM public.tenant_config LIMIT 1"); // AccessShare ate o fim da txn de b
        const t0 = Date.now();
        const solta = new Promise<void>((ok) => setTimeout(() => b.query("ROLLBACK").then(() => ok(), () => ok()), segura));
        const r = await aplicarArquivo(a, bloco()!.drop).then(
          () => null,
          (e: any) => e,
        );
        const ms = Date.now() - t0;
        await solta;
        if (segura < 4000) {
          expect(r, String(r?.message)).toBeNull();
          expect(ms).toBeGreaterThanOrEqual(2200);
          expect(await colunaExiste(a)).toBe(false);
        } else {
          expect(r?.code).toBe("55P03");
          expect(ms).toBeGreaterThanOrEqual(6000);
          expect(await colunaExiste(a)).toBe(true);
        }
        await a.query("ROLLBACK");
      }
    } finally {
      for (const k of [a, b]) {
        await k.query("ROLLBACK").catch(() => undefined);
        await k.end();
      }
    }
  }, 60_000);
});
