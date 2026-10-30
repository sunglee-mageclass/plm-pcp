/**
 * R13 (OC por fornecedor com VARIOS produtos) — a migration da R13 aplicada DENTRO da transacao do teste (mig-txn: sem
 * BEGIN/COMMIT, nunca \i), SO na copia local. Usado pelo gancho `URG_R13_TXN=1` de `db.ts` e pelos testes urg-r13-*.test.ts.
 *
 * CADEIA (onda 2): camada → urg-a → urgb → urgc (R9) → urgd (R11) → **urg-r13 (topo)**. O predecessor desta frente é `urgd-helpers.ts`
 * (R11), que delega a ela: `voltaUrgdSePreciso` tira a R13 PRIMEIRO, `dropUrgdSePreciso` roda o `dropR13SePreciso` primeiro e
 * `md5UrgdSucessor` continua em `md5R13Sucessor` (as frentes abaixo herdam a cadeia por urgd → urgc → urgb → urg-a).
 *
 * ⚠️ PREMISSA (brief R13 T1): este gancho so APLICA e REVERTE o elo R13. A copia4 e R11-FINAL assada como BASE (R9/R11 ja vivem no
 * banco); no worktree da onda 2 os arquivos da R9/R11 tambem existem, mas `URG_R13_TXN=1` NAO os re-aplica (use URGC_TXN/URGD_TXN
 * se a copia nao os tiver). Ordem dos ganchos em db.ts: URGC -> URGD -> URG_R13.
 *
 * Sucessores md5 (brief): `_custo_unitario_modelos_core` (pino 173000, urg-a) e `_estoque_extrato_insumo_core` (pino 177000,
 * urg-a) sao LEITORES que a R13 redefine na T2/T3 — na T1 a R13 NAO os toca, entao o md5 "depois da R13" = o VIVO R11-final
 * (identidade). `md5R13Sucessor` registra esse md5 como sucessor dos pinos antigos (via a cadeia urg-a -> urgb -> urgc -> urgd -> R13); quando a
 * T2/T3 redefinir esses leitores, acrescenta-se o md5 novo aqui.
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261105100000_urg_r13_oc_itens.sql";
const DOWN = "supabase/rollback/20261105100000_urg_r13_oc_itens_down.sql";
const DROP = "supabase/rollback/20261105100000_urg_r13_oc_itens_down_drop.sql";

// sentinela: R13 viva = a tabela de itens existe E `fn_oc_p_acabado_numero()` ja NAO esta no texto de antes da R13 (passo 0:
// md5 23493539...). So a tabela nao serve: o `_down` NEUTRO deixa as tabelas, e a 2a volta LIFO (cadeia urgb -> urgc -> urgd -> R13
// chama `voltaR13SePreciso` mais de uma vez na mesma txn) tentaria o `_down` de novo e ele recusaria ("nao esta no DEPOIS").
const R13_FN_ANTES = "23493539af3e477595c10fa882a9be38";
async function r13Viva(c: Client): Promise<boolean> {
  const r = await c.query(
    "SELECT to_regclass('public.ocs_p_acabado_itens') IS NOT NULL AS tab, md5(pg_get_functiondef(to_regprocedure('public.fn_oc_p_acabado_numero()'))) AS m",
  );
  const row = r.rows[0];
  return !!row?.tab && row.m !== null && row.m !== R13_FN_ANTES;
}

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Aplica a R13 DENTRO da txn do teste (so se o arquivo existir e a R13 ainda nao estiver viva). */
export async function aplicaR13(c: Client): Promise<void> {
  exigeBancoLocal();
  if (!existsSync(ROOT + MIG)) return;
  if (!(await r13Viva(c))) await aplicarArquivo(c, MIG);
  await zeraTimeouts(c);
}

/** Volta a R13 (so o `_down` NEUTRO: devolve as 4 funcoes + o ponteiro; as tabelas de itens FICAM inertes). */
export async function voltaR13(c: Client): Promise<void> {
  exigeBancoLocal();
  if (await r13Viva(c)) await aplicarArquivo(c, DOWN);
  await zeraTimeouts(c);
}

/** LIFO: quem volta/reaplica a R11 ou qualquer release anterior dentro da txn tira a R13 antes. */
export async function voltaR13SePreciso(c: Client): Promise<void> {
  if (!(await r13Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaR13(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/**
 * LIFO dos `_down_drop`: quem testa o `_down_drop` de uma frente ANTIGA (170000/Modularidade — cujas funcoes o extrato cita)
 * roda isto antes. O `_down_drop` da R13 so cai com as GUCs; aqui ligamos as 2 e dropamos as tabelas + funcoes novas.
 */
export async function dropR13SePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  await voltaR13SePreciso(c);
  if ((await c.query("SELECT to_regclass('public.ocs_p_acabado_itens') IS NOT NULL AS ok")).rows[0]?.ok) {
    await c.query("SET LOCAL app.confirmo_apagar_itens_oc_r13 = 'sim'");
    await c.query("SET LOCAL app.confirmo_apagar_backup_r13 = 'sim'");
    await aplicarArquivo(c, DROP);
  }
  await zeraTimeouts(c);
}

/** md5 que a R13 deixa (sucessor dos pinos antigos). T2: a R13 redefine os leitores compartilhados (lado PA + PI no JOIN); o md5
 * POS-R13 vem de mig/md5-r13.txt (POS_R13) e sobe pela cadeia urg-a -> urgb -> urgc -> urgd -> aqui ate os pinos 173000/177000. */
const R13_SUCESSOR: Record<string, string> = {
  "public._custo_unitario_modelos_core(uuid[])": "81de3239233d2efb3565ed3c5ce8cfb3", // pino 173000
  "public._estoque_extrato_insumo_core(uuid,uuid)": "227331479ecf99b9e39eeca40bbf4512", // pino 177000
};
export function md5R13Sucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  const d = R13_SUCESSOR[k];
  if (d && (!pinado || out.length)) if (!out.includes(d)) out.push(d);
  return out;
}
