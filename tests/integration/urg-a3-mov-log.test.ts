// Urgentes R3 T13 (plan-a, migration 20261103176000_urg_r3_estoque_mov_log): log NOVO `estoque_mov_log` que guarda, DAQUI EM DIANTE,
// data/quem de cada mudanca do "a separar/a enviar" (cad_aviamentos / cad_etiquetas) de CAD ja ENVIADO ao PCP (cad.enviado_corte).
// Tabela-ledger (RLS sem policy + REVOKE ALL de PUBLIC/anon/authenticated: so DEFINER le/escreve) + fn_estoque_mov_log() (DEFINER) +
// 6 gatilhos AFTER de STATEMENT com transicao (ins/upd/del nas 2 tabelas). Contribuicao do aviamento = a MESMA expressao do baixa_cad
// do _estoque_aviamento_core; insumo = quantidade_enviar + enviar_por_tamanho crus (o extrato da T14 aplica a regra do core).
// Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "176000") (pula se ja vivo na copia). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaUrgA, urgAViva, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const bloco = () => URG_A_MIGS.find((x) => x.id === "176000")?.b;
const FN = "public.fn_estoque_mov_log()";
const TABELA = "public.estoque_mov_log";
const ACL_TABELA = "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
const NOMES = ["trg_estoque_mov_log_del", "trg_estoque_mov_log_ins", "trg_estoque_mov_log_upd"] as const;
const ALVOS = ["cad_aviamentos", "cad_etiquetas"] as const;

let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function zera(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
async function existeTabela(c: Client): Promise<boolean> {
  return (await um<{ o: string | null }>(c, "SELECT to_regclass($1)::text AS o", [TABELA])).o !== null;
}
/** Tira a 176000 de vez NESTA txn (neutraliza; apaga gatilhos, funcao E a tabela) — estado "antes" da ida. */
async function semBloco(c: Client): Promise<void> {
  const b = bloco()!;
  if (await urgAViva(c, "176000")) await aplicarArquivo(c, b.down);
  if ((await md5Fn(c, FN)) !== null || (await existeTabela(c))) {
    await c.query("SELECT set_config('app.confirmo_apagar_estoque_mov_log', 'sim', true)");
    await aplicarArquivo(c, b.drop);
    await c.query("SELECT set_config('app.confirmo_apagar_estoque_mov_log', '', true)");
  }
  await zera(c);
}
async function gatilhos(c: Client) {
  const { rows } = await c.query(
    `SELECT t.tgrelid::regclass::text AS tab, t.tgname AS nome,
            CASE WHEN (t.tgtype & 4) = 4 THEN 'INSERT' WHEN (t.tgtype & 8) = 8 THEN 'DELETE' WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END AS ev,
            (t.tgtype & 1) = 1 AS por_linha, (t.tgtype & 2) = 2 AS before, (t.tgtype & (4|8|16|32)) AS eventos,
            t.tgoldtable AS velha, t.tgnewtable AS nova, t.tgenabled AS hab, cardinality(t.tgattr::int2[]) AS nattr,
            t.tgqual IS NULL AS sem_when, t.tgfoid = to_regprocedure($1) AS fn
       FROM pg_trigger t
      WHERE t.tgrelid IN ('public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass) AND NOT t.tgisinternal
        AND t.tgname LIKE 'trg\\_estoque\\_mov\\_log\\_%'
      ORDER BY 1, 2`,
    [FN],
  );
  return rows;
}
const ESPERADO_TRG = ALVOS.flatMap((tab) =>
  NOMES.map((nome) => {
    const ev = nome.endsWith("_ins") ? "INSERT" : nome.endsWith("_del") ? "DELETE" : "UPDATE";
    return {
      tab, nome, ev, por_linha: false, before: false, eventos: { INSERT: 4, DELETE: 8, UPDATE: 16 }[ev],
      velha: ev === "INSERT" ? null : "antigas", nova: ev === "DELETE" ? null : "novas", hab: "O", nattr: 0, sem_when: true, fn: true,
    };
  }),
);
const LOCKS = `SELECT n.nspname || '.' || cl.relname AS rel, l.mode
                 FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
async function locks(c: Client): Promise<Set<string>> {
  return new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
}
async function novasTravas(c: Client, antes: Set<string>): Promise<string[]> {
  return [...(await locks(c))].filter((k) => !antes.has(k)).sort();
}
/** Rejeita com o SQLSTATE dado dentro de um SAVEPOINT (a txn do teste segue usavel). */
async function recusa(c: Client, sql: string, params: unknown[] = [], antes?: string): Promise<string> {
  await c.query("SAVEPOINT urg_a3_t");
  try {
    if (antes) await c.query(antes);
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT urg_a3_t");
    return (e as { code?: string }).code ?? "?";
  }
  await c.query("ROLLBACK TO SAVEPOINT urg_a3_t");
  return "PASSOU";
}

type Linha = {
  familia: string; item: string; var: string | null; cor: string | null; antes: number; depois: number;
  ept_antes: unknown; ept_depois: unknown;
};
async function log(c: Client, cad: string): Promise<Linha[]> {
  const { rows } = await c.query(
    `SELECT familia, item_id AS item, variante_id AS var, cor_id AS cor, antes::float8 AS antes, depois::float8 AS depois,
            ept_antes, ept_depois
       FROM public.estoque_mov_log WHERE cad_id = $1
      ORDER BY familia, item_id, coalesce(variante_id::text, ''), antes, depois`,
    [cad],
  );
  return rows as Linha[];
}
async function nLog(c: Client, cad: string): Promise<number> {
  return Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.estoque_mov_log WHERE cad_id = $1`, [cad])).n);
}

/** aviamento + variante, insumo, card interno com Ordem de Criacao e o CAD (enviado ao PCP ou nao). */
async function cenario(c: Client, enviado: boolean) {
  const s = suf();
  const av = (await um<{ id: string }>(c, `INSERT INTO public.aviamentos (tenant_id, codigo_nome) VALUES ($1, $2) RETURNING id`,
    [T, `URG-A3 AV ${s}`])).id;
  const va = (await um<{ id: string }>(c,
    `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, nome_variante) VALUES ($1, $2, $3) RETURNING id`,
    [T, av, `URG-A3 VAR ${s}`])).id;
  const etq = (await um<{ id: string }>(c, `INSERT INTO public.etiquetas (tenant_id, nome, preco) VALUES ($1, $2, 1) RETURNING id`,
    [T, `URG-A3 ETQ ${s}`])).id;
  const m = (await um<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id`,
    [T, `URG-A3 card ${s}`])).id;
  await c.query(`UPDATE public.modelos SET ordem_criacao_enviada = true WHERE id = $1`, [m]);
  const cad = (await um<{ id: string }>(c,
    `INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, $3) RETURNING id`, [T, m, enviado])).id;
  return { av, va, etq, m, cad };
}

describe.skipIf(!RODA)("urg R3 T13 — estoque_mov_log (176000)", () => {
  it("o bloco 176000 existe: funcao NOVA (depois + neutro), _down volta (neutraliza), _down_drop separado (gerado por mig/gerar-a3.mjs)", () => {
    const b = bloco();
    expect(b).toBeTruthy();
    expect(b!.mig).toBe("supabase/migrations/20261103176000_urg_r3_estoque_mov_log.sql");
    expect(b!.volta).toBe(true);
    expect(b!.sentinela).toBe(FN);
    expect(b!.MD5).toEqual({});
    expect(Object.keys(b!.NOVAS)).toEqual([FN]);
    expect(b!.NOVAS[FN]).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.NEUTRO?.[FN]).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.NEUTRO?.[FN]).not.toBe(b!.NOVAS[FN]);
    expect(b!.drop).toMatch(/_down_drop\.sql$/);
  });

  it("aplicada: tabela-ledger (colunas, CHECK, indice, RLS sem policy, ACL so postgres/service_role); funcao DEFINER revogada; 6 gatilhos; 2x nao muda; _down neutraliza (gatilhos e tabela ficam); reaplica", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await semBloco(c);
      expect(await md5Fn(c, FN)).toBeNull();
      expect(await existeTabela(c)).toBe(false);
      expect(await gatilhos(c)).toEqual([]);
      await aplicaUrgA(c, "176000");
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      const cols = (await c.query(
        `SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [TABELA])).rows;
      expect(cols).toEqual([
        { col: "id", tipo: "uuid", nn: true, def: "gen_random_uuid()" },
        { col: "tenant_id", tipo: "uuid", nn: true, def: null },
        { col: "familia", tipo: "text", nn: true, def: null },
        { col: "cad_id", tipo: "uuid", nn: true, def: null },
        { col: "item_id", tipo: "uuid", nn: true, def: null },
        { col: "variante_id", tipo: "uuid", nn: false, def: null },
        { col: "cor_id", tipo: "uuid", nn: false, def: null },
        { col: "antes", tipo: "numeric", nn: true, def: null },
        { col: "depois", tipo: "numeric", nn: true, def: null },
        { col: "ept_antes", tipo: "jsonb", nn: false, def: null },
        { col: "ept_depois", tipo: "jsonb", nn: false, def: null },
        { col: "txid", tipo: "bigint", nn: true, def: "txid_current()" },
        { col: "created_at", tipo: "timestamp with time zone", nn: true, def: "now()" },
        { col: "created_by", tipo: "uuid", nn: false, def: "auth.uid()" },
      ]);
      const t = await um(c,
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, coalesce(c.relacl::text, '') AS acl,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS pol,
                (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f') AS fks,
                (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'c') AS chk,
                (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indrelid = c.oid AND NOT i.indisprimary) AS idx
           FROM pg_class c WHERE c.oid = $1::regclass`, [TABELA]);
      expect(t).toEqual({
        rls: true, force: false, acl: ACL_TABELA, pol: 0, fks: 0,
        chk: "CHECK ((familia = ANY (ARRAY['aviamento'::text, 'insumo'::text])))",
        idx: "CREATE INDEX idx_estoque_mov_log_item ON public.estoque_mov_log USING btree (tenant_id, familia, item_id, created_at)",
      });
      const meta = await um(c,
        `SELECT p.prosecdef AS sd, array_to_string(p.proconfig, '|') AS cfg, p.provolatile::text AS vol, coalesce(p.proacl::text, '') AS acl,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [FN]);
      expect(meta).toEqual({ sd: true, cfg: "search_path=public", vol: "v", acl: "{postgres=X/postgres,service_role=X/postgres}",
        anon: false, auth: false, pub: false });
      expect(await gatilhos(c)).toEqual(ESPERADO_TRG);
      // o laco dinamico do _wipe_tenant_core (reset/excluir loja) apaga toda tabela de public com tenant_id: entra sozinha
      expect((await c.query(
        `SELECT 1 FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = 'public' AND table_name = 'estoque_mov_log'
            AND table_name NOT IN ('tenant_config', 'users', 'user_permissions')`)).rows.length).toBe(1);
      await aplicarArquivo(c, b!.mig);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      expect(await gatilhos(c)).toEqual(ESPERADO_TRG);
      await aplicarArquivo(c, b!.down);
      await aplicarArquivo(c, b!.down); // idempotente
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NEUTRO![FN]);
      expect(await urgAViva(c, "176000")).toBe(false);
      expect(await gatilhos(c)).toEqual(ESPERADO_TRG); // ficam, inertes
      expect(await existeTabela(c)).toBe(true);
      // neutra: nada grava
      const { cad, av } = await cenario(c, true);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 7)`, [cad, av]);
      expect(await nLog(c, cad)).toBe(0);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      expect(await urgAViva(c, "176000")).toBe(true);
    });
  });

  it("a contribuicao do aviamento e a MESMA expressao do baixa_cad do _estoque_aviamento_core (por texto); o insumo grava os campos que o _estoque_etiqueta_core le", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const core = (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public._estoque_aviamento_core(uuid)'::regprocedure) AS d`)).d;
      const fn = (await um<{ d: string }>(c, `SELECT pg_get_functiondef(to_regprocedure($1)) AS d`, [FN])).d;
      const RE = /COALESCE\(NULLIF\((\w+)\.quantidade_separar, 0\), \1\.quantidade_enviar, 0\)/g;
      const noCore = [...core.matchAll(RE)].map((m) => m[0].split(`${m[1]}.`).join("X."));
      expect(noCore).toEqual(["COALESCE(NULLIF(X.quantidade_separar, 0), X.quantidade_enviar, 0)"]);
      const naFn = [...fn.matchAll(RE)].map((m) => m[0].split(`${m[1]}.`).join("X."));
      expect(naFn.length).toBeGreaterThan(0);
      expect(new Set(naFn)).toEqual(new Set(noCore));
      const etq = (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public._estoque_etiqueta_core(uuid)'::regprocedure) AS d`)).d;
      expect(etq).toContain("ce.enviar_por_tamanho");
      expect(etq).toContain("coalesce(ce.quantidade_enviar, 0)");
      expect(etq).toContain("c.enviado_corte");
      expect(fn).toContain("coalesce(x.quantidade_enviar, 0)");
      expect(fn).toContain("x.enviar_por_tamanho");
    });
  });

  it("aviamento, CAD ENVIADO: INSERT (antes 0), UPDATE 10->8 (1 linha, quem = sub das claims, txid da txn), coluna sem efeito = nada, separar 0 cai no enviar, troca de variante = sai/entra, DELETE (depois 0)", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const { av, va, cad } = await cenario(c, true);
      await comoUsuario(c);
      const id = (await um<{ id: string }>(c,
        `INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
         VALUES ($1, $2, 1, 1, 5, 10, $3) RETURNING id`, [cad, av, va])).id;
      expect(await log(c, cad)).toEqual([
        { familia: "aviamento", item: av, var: va, cor: null, antes: 0, depois: 10, ept_antes: null, ept_depois: null },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`UPDATE public.cad_aviamentos SET quantidade_separar = 8 WHERE id = $1`, [id]);
      const um1 = await um(c,
        `SELECT antes::float8 AS antes, depois::float8 AS depois, created_by, tenant_id, familia, txid = txid_current() AS mesma_txn,
                created_at = now() AS agora
           FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      expect(um1).toEqual({ antes: 10, depois: 8, created_by: USER_TESTE, tenant_id: T, familia: "aviamento", mesma_txn: true, agora: true });
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`UPDATE public.cad_aviamentos SET consumo = 3, numero = 2 WHERE id = $1`, [id]);
      expect(await nLog(c, cad)).toBe(0);
      await c.query(`UPDATE public.cad_aviamentos SET quantidade_separar = 0 WHERE id = $1`, [id]); // NULLIF(0) -> cai no enviar (5)
      expect(await log(c, cad)).toEqual([
        { familia: "aviamento", item: av, var: va, cor: null, antes: 8, depois: 5, ept_antes: null, ept_depois: null },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`UPDATE public.cad_aviamentos SET variante_aviamento_id = NULL WHERE id = $1`, [id]); // muda o bucket
      expect(await log(c, cad)).toEqual([
        { familia: "aviamento", item: av, var: null, cor: null, antes: 0, depois: 5, ept_antes: null, ept_depois: null },
        { familia: "aviamento", item: av, var: va, cor: null, antes: 5, depois: 0, ept_antes: null, ept_depois: null },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`DELETE FROM public.cad_aviamentos WHERE id = $1`, [id]);
      expect(await log(c, cad)).toEqual([
        { familia: "aviamento", item: av, var: null, cor: null, antes: 5, depois: 0, ept_antes: null, ept_depois: null },
      ]);
      // linha sem contribuicao (0 / 0) nao loga ao entrar nem ao sair
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_enviar, quantidade_separar) VALUES ($1, $2, 3, 0, 0)`, [cad, av]);
      await c.query(`DELETE FROM public.cad_aviamentos WHERE cad_id = $1`, [cad]);
      expect(await nLog(c, cad)).toBe(0);
    });
  });

  it("CAD NAO enviado ao PCP: nada loga (insert/update/delete nas 2 tabelas); excluir o CAD enviado (cascata) nao loga", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const { av, etq, cad } = await cenario(c, false);
      await comoUsuario(c);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 10)`, [cad, av]);
      await c.query(`UPDATE public.cad_aviamentos SET quantidade_separar = 8 WHERE cad_id = $1`, [cad]);
      await c.query(`INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, quantidade_enviar) VALUES ($1, $2, 4)`, [cad, etq]);
      await c.query(`UPDATE public.cad_etiquetas SET quantidade_enviar = 6, enviar_por_tamanho = '{"M": 6}' WHERE cad_id = $1`, [cad]);
      await c.query(`DELETE FROM public.cad_aviamentos WHERE cad_id = $1`, [cad]);
      await c.query(`DELETE FROM public.cad_etiquetas WHERE cad_id = $1`, [cad]);
      expect(await nLog(c, cad)).toBe(0);
      const e = await cenario(c, true);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 10)`, [e.cad, e.av]);
      await c.query(`INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, quantidade_enviar) VALUES ($1, $2, 4)`, [e.cad, e.etq]);
      expect(await nLog(c, e.cad)).toBe(2);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [e.cad]);
      await c.query(`DELETE FROM public.cad WHERE id = $1`, [e.cad]); // ON DELETE CASCADE nas 2 filhas
      expect(await nLog(c, e.cad)).toBe(0);
      expect(Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.cad_aviamentos WHERE cad_id = $1`, [e.cad])).n)).toBe(0);
    });
  });

  it("insumo (cad_etiquetas), CAD ENVIADO: quantidade_enviar e enviar_por_tamanho -> antes/depois e ept_antes/ept_depois; coluna sem efeito = nada; DELETE leva o ept", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const { etq, cad } = await cenario(c, true);
      const cor = (await c.query(`SELECT id FROM public.cores WHERE tenant_id = $1 ORDER BY id LIMIT 1`, [T])).rows[0]?.id ?? null;
      await comoUsuario(c);
      const id = (await um<{ id: string }>(c,
        `INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar)
         VALUES ($1, $2, $3, 1, 6, 6) RETURNING id`, [cad, etq, cor])).id;
      expect(await log(c, cad)).toEqual([
        { familia: "insumo", item: etq, var: null, cor, antes: 0, depois: 6, ept_antes: null, ept_depois: {} },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`UPDATE public.cad_etiquetas SET enviar_por_tamanho = '{"M": 2, "G": 4}' WHERE id = $1`, [id]);
      expect(await log(c, cad)).toEqual([
        { familia: "insumo", item: etq, var: null, cor, antes: 6, depois: 6, ept_antes: {}, ept_depois: { M: 2, G: 4 } },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`UPDATE public.cad_etiquetas SET quantidade_planejada = 9, consumo = 2 WHERE id = $1`, [id]);
      expect(await nLog(c, cad)).toBe(0);
      await c.query(`UPDATE public.cad_etiquetas SET quantidade_enviar = 4 WHERE id = $1`, [id]);
      expect(await log(c, cad)).toEqual([
        { familia: "insumo", item: etq, var: null, cor, antes: 6, depois: 4, ept_antes: { M: 2, G: 4 }, ept_depois: { M: 2, G: 4 } },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await c.query(`DELETE FROM public.cad_etiquetas WHERE id = $1`, [id]);
      expect(await log(c, cad)).toEqual([
        { familia: "insumo", item: etq, var: null, cor, antes: 4, depois: 0, ept_antes: { M: 2, G: 4 }, ept_depois: null },
      ]);
    });
  });

  it("caminho real: salvar_cad_completo regravando IGUAL o CAD enviado = -X/+X com o MESMO txid (soma 0 por item); regravando com outro valor soma a diferenca", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const { av, va, etq, m, cad } = await cenario(c, true);
      await c.query(
        `INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
         VALUES ($1, $2, 1, 1, 5, 10, $3)`, [cad, av, va]);
      await c.query(
        `INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, consumo, quantidade_planejada, quantidade_enviar, enviar_por_tamanho)
         VALUES ($1, $2, 1, 6, 6, '{"M": 6}')`, [cad, etq]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await comoUsuario(c);
      const avs = (q: number) => JSON.stringify([{ aviamento_id: av, numero: 1, consumo: 1, quantidade_enviar: 5, quantidade_separar: q, variante_aviamento_id: va }]);
      const ets = JSON.stringify([{ etiqueta_id: etq, consumo: 1, quantidade_planejada: 6, quantidade_enviar: 6, enviar_por_tamanho: { M: 6 } }]);
      const salva = (q: number) =>
        c.query(`SELECT public.salvar_cad_completo($1, '[]'::jsonb, '[]'::jsonb, $2::jsonb, $3::jsonb, '{}'::jsonb, NULL, NULL)`, [m, avs(q), ets]);
      await salva(10);
      const r = (await c.query(
        `SELECT familia, item_id AS item, count(*)::int AS n, sum(depois - antes)::float8 AS soma, count(DISTINCT txid)::int AS txids,
                bool_and(txid = txid_current()) AS desta_txn, bool_and(created_by = $2) AS quem
           FROM public.estoque_mov_log WHERE cad_id = $1 GROUP BY 1, 2 ORDER BY 1`, [cad, USER_TESTE])).rows;
      expect(r).toEqual([
        { familia: "aviamento", item: av, n: 2, soma: 0, txids: 1, desta_txn: true, quem: true },
        { familia: "insumo", item: etq, n: 2, soma: 0, txids: 1, desta_txn: true, quem: true },
      ]);
      await c.query(`DELETE FROM public.estoque_mov_log WHERE cad_id = $1`, [cad]);
      await salva(7);
      const r2 = (await c.query(
        `SELECT familia, sum(depois - antes)::float8 AS soma FROM public.estoque_mov_log WHERE cad_id = $1 GROUP BY 1 ORDER BY 1`, [cad])).rows;
      expect(r2).toEqual([{ familia: "aviamento", soma: -3 }, { familia: "insumo", soma: 0 }]);
    });
  });

  it("o cliente NAO le nem grava a tabela (authenticated e anon: 42501); has_table_privilege tudo false", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const { cad, av } = await cenario(c, true);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 7)`, [cad, av]);
      expect(await nLog(c, cad)).toBe(1);
      await comoUsuario(c);
      for (const papel of ["authenticated", "anon"]) {
        const role = `SET LOCAL ROLE ${papel}`;
        expect(await recusa(c, `SELECT count(*) FROM public.estoque_mov_log`, [], role)).toBe("42501");
        expect(await recusa(c,
          `INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, antes, depois) VALUES ($1, 'aviamento', $2, $3, 0, 1)`,
          [T, cad, av], role)).toBe("42501");
        expect(await recusa(c, `UPDATE public.estoque_mov_log SET depois = 99`, [], role)).toBe("42501");
        expect(await recusa(c, `DELETE FROM public.estoque_mov_log`, [], role)).toBe("42501");
        const p = await um<{ n: string }>(c,
          `SELECT count(*) AS n FROM unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) x
            WHERE has_table_privilege($1, 'public.estoque_mov_log', x)`, [papel]);
        expect(Number(p.n)).toBe(0);
        expect((await um<{ x: boolean }>(c, `SELECT has_function_privilege($1, $2, 'EXECUTE') AS x`, [papel, FN])).x).toBe(false);
      }
      expect(await nLog(c, cad)).toBe(1);
    });
  });

  it("guarda: funcao com texto inesperado = P0001 na ida e no _down; _down_drop recusa com a funcao viva; gatilho de mesmo nome em outra funcao recusa; tabela com forma inesperada recusa", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      // _down_drop com a funcao VIVA (nao neutra) recusa
      await c.query("SAVEPOINT g1");
      await expect(aplicarArquivo(c, b!.drop)).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT g1");
      // texto inesperado
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_estoque_mov_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
                       SET search_path TO 'public' AS $f$ BEGIN RETURN NULL; END; $f$`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toMatchObject({ code: "P0001" });
      await expect(aplicarArquivo(c, b!.down)).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT g1");
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      // gatilho de mesmo nome chamando outra funcao
      await c.query("SAVEPOINT g2");
      await c.query(`CREATE FUNCTION public.zz_urg_a3_outra() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END; $f$`);
      await c.query(`CREATE OR REPLACE TRIGGER trg_estoque_mov_log_upd AFTER UPDATE ON public.cad_etiquetas
                       FOR EACH STATEMENT EXECUTE FUNCTION public.zz_urg_a3_outra()`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT g2");
      // tabela com forma inesperada (coluna a mais)
      await c.query("SAVEPOINT g3");
      await c.query(`ALTER TABLE public.estoque_mov_log ADD COLUMN zz_extra int`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT g3");
      await zera(c);
      expect(await urgAViva(c, "176000")).toBe(true);
    });
  });

  it("_down_drop: com a funcao NEUTRA apaga os 6 gatilhos e a funcao; a TABELA so cai com app.confirmo_apagar_estoque_mov_log='sim'; idempotente; a ida recria tudo", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      const { cad, av } = await cenario(c, true);
      await c.query(`INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) VALUES ($1, $2, 1, 7)`, [cad, av]);
      expect(await nLog(c, cad)).toBe(1);
      await aplicarArquivo(c, b!.down);
      await aplicarArquivo(c, b!.drop); // sem a GUC: gatilhos + funcao caem, a tabela FICA com as linhas
      await aplicarArquivo(c, b!.drop); // idempotente
      await zera(c);
      expect(await md5Fn(c, FN)).toBeNull();
      expect(await gatilhos(c)).toEqual([]);
      expect(await existeTabela(c)).toBe(true);
      expect(await nLog(c, cad)).toBe(1);
      // a ida recria funcao + gatilhos sobre a tabela que ficou (mesma forma)
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      expect(await gatilhos(c)).toEqual(ESPERADO_TRG);
      expect(await nLog(c, cad)).toBe(1);
      await aplicarArquivo(c, b!.down);
      await c.query("SELECT set_config('app.confirmo_apagar_estoque_mov_log', 'sim', true)");
      await aplicarArquivo(c, b!.drop); // com a GUC: a tabela cai
      await c.query("SELECT set_config('app.confirmo_apagar_estoque_mov_log', '', true)");
      await zera(c);
      expect(await existeTabela(c)).toBe(false);
      expect(await md5Fn(c, FN)).toBeNull();
      await aplicarArquivo(c, b!.drop); // idempotente sem nada
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      expect(await existeTabela(c)).toBe(true);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
    });
  });

  it("travas (por DIFERENCA): ida = ShareRowExclusive em cad_aviamentos e cad_etiquetas (+ a tabela nova e catalogo), nada em auth/storage/realtime, tambem ao reaplicar; _down = nenhuma; _down_drop medido", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    const SRE = ["public.cad_aviamentos|ShareRowExclusiveLock", "public.cad_etiquetas|ShareRowExclusiveLock"];
    const fortesDe = (xs: string[]) =>
      xs.filter((k) => !k.startsWith("information_schema.") && !k.endsWith("|AccessShareLock") && !/^public\.(estoque_mov_log|idx_estoque_mov_log_item)/.test(k));
    await withTx(async (c) => {
      await semBloco(c);
      const antes = await locks(c);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      const ida = await novasTravas(c, antes);
      expect(ida.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      const ja = SRE.filter((k) => antes.has(k));
      expect(fortesDe(ida)).toEqual(SRE.filter((k) => !antes.has(k)));
      console.log(`[urg-a3-mov-log] travas da ida${ja.length ? ` (txn ja segurava ${ja.join(", ")})` : ""}: ${ida.join(", ")}`);
    });
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000"); // reaplicar com tudo ja existente (CREATE OR REPLACE TRIGGER; tabela nao e recriada)
      const antes = await locks(c);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      const re = await novasTravas(c, antes);
      expect(re.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      expect(fortesDe(re)).toEqual(SRE.filter((k) => !antes.has(k)));
      expect(re.filter((k) => /^public\.estoque_mov_log\|/.test(k) && !k.endsWith("|AccessShareLock"))).toEqual([]);
      console.log(`[urg-a3-mov-log] travas ao reaplicar: ${re.join(", ")}`);
    });
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      let antes = await locks(c);
      await aplicarArquivo(c, b!.down);
      await zera(c);
      expect(await novasTravas(c, antes)).toEqual([]);
      antes = await locks(c);
      await aplicarArquivo(c, b!.drop);
      await zera(c);
      const drop = await novasTravas(c, antes);
      expect(drop).toContain("public.cad_aviamentos|AccessExclusiveLock");
      expect(drop).toContain("public.cad_etiquetas|AccessExclusiveLock");
      expect(drop.filter((k) => !/^(public\.(cad_aviamentos|cad_etiquetas|estoque_mov_log|idx_estoque_mov_log_item)|auth\.|storage\.|realtime\.|information_schema\.)/.test(k))).toEqual([]);
      console.log(`[urg-a3-mov-log] travas do _down_drop sem a GUC (${drop.length}): ${drop.join(", ")}`);
      antes = await locks(c);
      await c.query("SELECT set_config('app.confirmo_apagar_estoque_mov_log', 'sim', true)");
      await aplicarArquivo(c, b!.drop);
      await zera(c);
      const tab = await novasTravas(c, antes);
      console.log(`[urg-a3-mov-log] travas do _down_drop com a GUC depois do drop sem a GUC (tabela; ${tab.length}): ${tab.join(", ")}`);
    });
    // so a TABELA (o que o _down_drop com a GUC soma ao DROP dos gatilhos): mede numa txn propria
    await withTx(async (c) => {
      await aplicaUrgA(c, "176000");
      // a relacao apagada some do pg_class desta txn: resolve os oids da tabela/indices ANTES e le pg_locks sem o join
      const nomes = new Map((await c.query(
        `SELECT c.oid::text AS oid, 'public.' || c.relname AS nome FROM pg_class c
          WHERE c.oid IN ('public.estoque_mov_log'::regclass, 'public.estoque_mov_log_pkey'::regclass, 'public.idx_estoque_mov_log_item'::regclass)
         UNION ALL
         SELECT t.reltoastrelid::text, 'public.estoque_mov_log(toast)' FROM pg_class t WHERE t.oid = 'public.estoque_mov_log'::regclass
         UNION ALL
         SELECT i.indexrelid::text, 'public.estoque_mov_log(toast_idx)' FROM pg_class t JOIN pg_index i ON i.indrelid = t.reltoastrelid
          WHERE t.oid = 'public.estoque_mov_log'::regclass`))
        .rows.map((r) => [r.oid as string, r.nome as string]));
      const cru = async () => new Set((await c.query(
        `SELECT coalesce(n.nspname || '.' || cl.relname, l.relation::text) AS rel, l.mode, n.nspname AS nsp
           FROM pg_locks l LEFT JOIN pg_class cl ON cl.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation'`)).rows
        .filter((r) => !["pg_catalog", "pg_toast"].includes(r.nsp))
        .map((r) => `${nomes.get(r.rel) ?? r.rel}|${r.mode}`));
      const antes = await cru();
      await c.query("SAVEPOINT so_tabela");
      await c.query("DROP TABLE public.estoque_mov_log");
      const tab = [...(await cru())].filter((k) => !antes.has(k)).sort();
      await c.query("ROLLBACK TO SAVEPOINT so_tabela");
      expect(tab.filter((k) => !/^(public\.(estoque_mov_log|idx_estoque_mov_log_item)|auth\.|storage\.|realtime\.|information_schema\.)/.test(k))).toEqual([]);
      console.log(`[urg-a3-mov-log] travas do DROP TABLE estoque_mov_log sozinho (${tab.length}): ${tab.join(", ")}`);
    });
  });

  it("custo: maior loja da copia, TODO CAD com aviamento/insumo dado como enviado ao PCP — Salvar (DELETE + INSERT linha a linha nas 2 tabelas) com o log vivo x neutro", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '300s'");
      await aplicaUrgA(c, "176000");
      const loja = await um<{ id: string; nome: string }>(c,
        `SELECT t.id, t.nome FROM public.cad c JOIN public.tenants t ON t.id = c.tenant_id
          WHERE EXISTS (SELECT 1 FROM public.cad_aviamentos a WHERE a.cad_id = c.id) OR EXISTS (SELECT 1 FROM public.cad_etiquetas e WHERE e.cad_id = c.id)
          GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 1`);
      // pior caso: TODO CAD da loja vira "enviado" (o log so grava CAD enviado). Sem disparar os outros gatilhos de cad: so a coluna.
      await c.query(`ALTER TABLE public.cad DISABLE TRIGGER USER`);
      await c.query(`UPDATE public.cad SET enviado_corte = true WHERE tenant_id = $1`, [loja.id]);
      await c.query(`ALTER TABLE public.cad ENABLE TRIGGER USER`);
      const cads = (await c.query(
        `SELECT c.id FROM public.cad c WHERE c.tenant_id = $1
            AND (EXISTS (SELECT 1 FROM public.cad_aviamentos a WHERE a.cad_id = c.id) OR EXISTS (SELECT 1 FROM public.cad_etiquetas e WHERE e.cad_id = c.id))
          ORDER BY 1`, [loja.id])).rows.map((r) => r.id as string);
      const contrib = Number((await um<{ n: string }>(c,
        `SELECT (SELECT count(*) FROM public.cad_aviamentos a JOIN public.cad c ON c.id = a.cad_id
                  WHERE c.tenant_id = $1 AND a.aviamento_id IS NOT NULL AND COALESCE(NULLIF(a.quantidade_separar, 0), a.quantidade_enviar, 0) <> 0)
              + (SELECT count(*) FROM public.cad_etiquetas e JOIN public.cad c ON c.id = e.cad_id
                  WHERE c.tenant_id = $1 AND e.etiqueta_id IS NOT NULL
                    AND (coalesce(e.quantidade_enviar, 0) <> 0 OR coalesce(e.enviar_por_tamanho, '{}'::jsonb) <> '{}'::jsonb)) AS n`, [loja.id])).n);
      const salvarTodos = async (): Promise<{ ms: number; linhas: number }> => {
        let ms = 0, linhas = 0;
        for (const cad of cads) {
          const t0 = performance.now();
          const av = (await c.query(`DELETE FROM public.cad_aviamentos WHERE cad_id = $1 RETURNING *`, [cad])).rows;
          const et = (await c.query(`DELETE FROM public.cad_etiquetas WHERE cad_id = $1 RETURNING *`, [cad])).rows;
          for (const r of av) {
            await c.query(
              `INSERT INTO public.cad_aviamentos (id, cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [r.id, r.cad_id, r.aviamento_id, r.numero, r.consumo, r.quantidade_enviar, r.quantidade_separar, r.variante_aviamento_id, r.created_at]);
          }
          for (const r of et) {
            await c.query(
              `INSERT INTO public.cad_etiquetas (id, cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar, enviar_por_tamanho, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
              [r.id, r.cad_id, r.etiqueta_id, r.cor_id, r.consumo, r.quantidade_planejada, r.quantidade_enviar, JSON.stringify(r.enviar_por_tamanho), r.created_at]);
          }
          ms += performance.now() - t0;
          linhas += av.length + et.length;
        }
        return { ms, linhas };
      };
      const antesLog = Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.estoque_mov_log`)).n);
      await salvarTodos(); // aquece
      const vivo = await salvarTodos();
      const depoisLog = Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.estoque_mov_log`)).n);
      // cada Salvar loga -X/+X por linha com contribuicao (2 Salvar)
      expect(depoisLog - antesLog).toBe(4 * contrib);
      const soma = Number((await um<{ s: string }>(c, `SELECT coalesce(sum(depois - antes), 0) AS s FROM public.estoque_mov_log`)).s);
      expect(soma).toBe(0);
      await aplicarArquivo(c, b!.down);
      await zera(c);
      await c.query("SET LOCAL statement_timeout = '300s'");
      await salvarTodos();
      const neutro = await salvarTodos();
      expect(Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.estoque_mov_log`)).n)).toBe(depoisLog);
      const por = (x: { ms: number }) => x.ms / cads.length;
      console.log(`[urg-a3-mov-log] loja ${loja.nome}: ${cads.length} CADs (todos dados como enviados), ${vivo.linhas} linhas, ${contrib} com contribuicao; ` +
        `Salvar por CAD: log vivo ${por(vivo).toFixed(2)} ms x neutro ${por(neutro).toFixed(2)} ms (diferenca ${(por(vivo) - por(neutro)).toFixed(2)} ms); ` +
        `${2 * contrib} linhas de log por rodada`);
      // teto folgado (medicao de tempo varia com a carga da maquina; medido 4-6 ms com a copia quieta): so pega regressao grosseira
      expect(por(vivo) - por(neutro)).toBeLessThan(Math.max(50, 2 * por(neutro)));
    });
  }, 600_000);
});
