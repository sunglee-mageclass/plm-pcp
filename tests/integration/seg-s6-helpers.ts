/**
 * Reforço de segurança — sub-release S6 "OCs: recebida só volta pelo Desmarcar" (P-236 = D7 A), por cima da S5 (o "antes" de
 * salvar_oc_etiqueta é o texto da S3a). Só CREATE OR REPLACE FUNCTION (catálogo). Aplica DENTRO da transação do teste (mig-txn: sem
 * BEGIN/COMMIT, nunca \i) — só na cópia local. Usado por `seg-s6.test.ts` e pelo gancho `S6_TXN=1` de `db.ts`.
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S6_MD5 } from "./seg-s6-dados";

export const S6_MIG = "supabase/migrations/20261101250000_seg_s6_oc_status.sql";
export const S6_DOWN = "supabase/rollback/20261101250000_seg_s6_oc_status_down.sql";
const SENTINELA = "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)";

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

export async function aplicaS6(c: Client): Promise<void> {
  exigeBancoLocal();
  // a S6 roda por cima da S3a (salvar_oc_etiqueta no texto dela): sem a S3a viva, traz a cadeia inteira S3a..S5 pela ORDEM SEGURA
  // do aplicaS5 (lição do deadlock da S4: nenhum GRANT antes de CREATE TRIGGER na mesma txn)
  const { s3aViva } = await import("./seg-s3a-helpers");
  if (!(await s3aViva(c))) await (await import("./seg-s5-helpers")).aplicaS5(c);
  await aplicarArquivo(c, S6_MIG);
  await zeraTimeouts(c);
}

export async function voltaS6(c: Client): Promise<void> {
  exigeBancoLocal();
  await aplicarArquivo(c, S6_DOWN);
  await zeraTimeouts(c);
}

/** A S6 está viva NESTA txn? Pelo texto de _salvar_oc_tecido_core. */
export async function s6Viva(c: Client): Promise<boolean> {
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [SENTINELA]);
  return r.rows[0]?.m === S6_MD5[SENTINELA].depois;
}

/** LIFO: quem volta (ou reaplica) a S5 ou qualquer release anterior dentro da txn tira a S6 antes (chamado por voltaS5SePreciso). */
export async function voltaS6SePreciso(c: Client): Promise<void> {
  if (!(await s6Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS6(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** md5 pinado por suíte antiga: aceita o texto de antes OU o da S6. */
export function md5OuSucessorS6(sig: string, md5Antes: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const s = S6_MD5[k];
  return s && s.antes === md5Antes ? [md5Antes, s.depois] : [md5Antes];
}
