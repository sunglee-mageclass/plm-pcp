/**
 * Reforço de segurança — sub-release S5 "Faxina de privilégios" (ANON-3, PRIV-1, auxiliares do ANON-1), por cima da S4 (o "antes" da
 * guarda é o estado de depois da S3a..S4). Só GRANT/REVOKE. Aplica DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) —
 * só na cópia local. Usado por `seg-s5.test.ts` e pelo gancho `S5_TXN=1` de `db.ts`.
 * Lição da S4: numa transação só, GRANT (que mexe na linha da tabela em pg_class) seguido de CREATE TRIGGER pode dar deadlock com o
 * autovacuum. Por isso, quando a cadeia S3a..S4 ainda não está viva, ela entra em ORDEM SEGURA (funções/gatilhos antes dos grants).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S5_ACL, S5_CADEIA_ORDEM_SEGURA } from "./seg-s5-dados";

export const S5_MIG = "supabase/migrations/20261101240000_seg_s5_privilegios.sql";
export const S5_DOWN = "supabase/rollback/20261101240000_seg_s5_privilegios_down.sql";

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

export async function aplicaS5(c: Client): Promise<void> {
  exigeBancoLocal();
  // traz o que faltar da cadeia S3a..S4 (outros ganchos podem ter aplicado só parte dela), em ORDEM SEGURA: os arquivos de funções/
  // gatilhos das sub-releases que faltam primeiro, depois os de grants
  const vivas: Record<string, boolean> = {
    s3a: await (await import("./seg-s3a-helpers")).s3aViva(c),
    s3b: await (await import("./seg-s3b-helpers")).s3bViva(c),
    s3c: await (await import("./seg-s3c-helpers")).s3cViva(c),
    s3d: await (await import("./seg-s3d-helpers")).s3dViva(c),
    s4: await (await import("./seg-s4-helpers")).s4Viva(c),
  };
  for (const m of S5_CADEIA_ORDEM_SEGURA) {
    const tag = m.match(/_seg_(s3[a-d]|s4)_/)?.[1];
    if (tag && !vivas[tag]) await aplicarArquivo(c, m);
  }
  await aplicarArquivo(c, S5_MIG);
  await zeraTimeouts(c);
}

export async function voltaS5(c: Client): Promise<void> {
  exigeBancoLocal();
  await aplicarArquivo(c, S5_DOWN);
  await zeraTimeouts(c);
}

/** A S5 está viva NESTA txn? Pela ACL de system_settings (anon só com SELECT). */
export async function s5Viva(c: Client): Promise<boolean> {
  const r = await c.query(`SELECT coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(relacl) x), '') AS a
                             FROM pg_class WHERE oid = 'public.system_settings'::regclass`);
  return r.rows[0]?.a === S5_ACL.system_settings.depois[0];
}

/** LIFO: quem volta (ou reaplica) qualquer grant da S1..S4 dentro da txn tira a S5 antes. */
export async function voltaS5SePreciso(c: Client): Promise<void> {
  // LIFO: a S6 (20261101250000, por cima de tudo) sai antes de qualquer volta/reaplicação da S1..S5 — todos os aplica*/volta* passam aqui
  await (await import("./seg-s6-helpers")).voltaS6SePreciso(c);
  if (!(await s5Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS5(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
