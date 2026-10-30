/**
 * R13 (OC por fornecedor com VARIOS produtos) — a migration da R13 aplicada DENTRO da transacao do teste (mig-txn: sem
 * BEGIN/COMMIT, nunca \i), SO na copia local. Usado pelo gancho `URG_R13_TXN=1` de `db.ts` e pelos testes urg-r13-*.test.ts.
 *
 * ⚠️ PREMISSA (brief R13 T1, "Base R9/R11 ja esta NO BANCO"): a copia4 e R11-FINAL assada como BASE — R9/R11 NAO vivem nos
 * arquivos deste worktree (nasceu de producao 909eea0b; os .sql da R9/R11 estao no branch r9/peca-teste). A cadeia LIFO do kit e
 * R13 -> R11 -> URGC(R9) -> URGB -> ...; aqui, porem, os elos INFERIORES ja estao na copia como base, entao este gancho so
 * APLICA e REVERTE o elo R13. NAO portar os helpers/arquivos da R9/R11 para ca e NAO re-aplicar R9/R11 no gancho.
 *
 * Sucessores md5 (brief): `_custo_unitario_modelos_core` (pino 173000, urg-a) e `_estoque_extrato_insumo_core` (pino 177000,
 * urg-a) sao LEITORES que a R13 redefine na T2/T3 — na T1 a R13 NAO os toca, entao o md5 "depois da R13" = o VIVO R11-final
 * (identidade). `md5R13Sucessor` registra esse md5 como sucessor dos pinos antigos (via a cadeia urg-a -> urgb -> R13); quando a
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

// sentinela: a tabela de itens existe sse a R13 esta viva nesta txn.
async function r13Viva(c: Client): Promise<boolean> {
  const r = await c.query("SELECT to_regclass('public.ocs_p_acabado_itens') IS NOT NULL AS ok");
  return !!r.rows[0]?.ok;
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

/** md5 que a R13 deixa (sucessor dos pinos antigos). Na T1 a R13 nao redefine leitor nenhum => nada a acrescentar ainda. */
const R13_SUCESSOR: Record<string, string> = {
  // T2/T3 acrescentarao aqui, p.ex.:
  // "public._custo_unitario_modelos_core(uuid[])": "<md5 depois da R13>",
  // "public._estoque_extrato_insumo_core(uuid,uuid)": "<md5 depois da R13>",
};
export function md5R13Sucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  const d = R13_SUCESSOR[k];
  if (d && (!pinado || out.length)) if (!out.includes(d)) out.push(d);
  return out;
}
