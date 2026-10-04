/**
 * Reforço de segurança — sub-release S4 "Brechas de módulo" (C1 OTB, C2 Plan. Tecido), por cima da S3 (a S4 exige o estado da S3d nas
 * plan_tecido_*). Sem policy: gatilho de módulo + grants (ver s4-report.md). Aplica as 2 migrations DENTRO da transação do teste
 * (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado por `seg-s4.test.ts` e pelo gancho `S4_TXN=1` de `db.ts`.
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S4_FUNCOES } from "./seg-s4-dados";

export const S4_MIGS = [
  "supabase/migrations/20261101220000_seg_s4_grants_modulo.sql",
  "supabase/migrations/20261101230000_seg_s4_guarda_modulo.sql",
] as const;
export const S4_DOWNS = [...S4_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));
export const S4_DOWN_DROP = "supabase/rollback/20261101230000_seg_s4_guarda_modulo_down_drop.sql";
/** As 13 tabelas em que o CREATE TRIGGER da S4 pega ShareRowExclusive (suítes antigas filtram com S4_TXN=1). */
export const S4_TABELAS_TRAVA = S4_FUNCOES.flatMap((f) => f.tabelas).map((t) => `public.${t}`);

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Aplica a S4 (e a S3d antes, se ainda não estiver viva — a S4 exige o estado dela nas plan_tecido_*). */
export async function aplicaS4(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  const { aplicaS3d, s3dViva } = await import("./seg-s3d-helpers");
  if (!(await s3dViva(c))) await aplicaS3d(c);
  for (const m of S4_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

export async function voltaS4(c: Client, comDrop = false): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (20261101240000, grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  for (const m of S4_DOWNS) await aplicarArquivo(c, m);
  if (comDrop) await aplicarArquivo(c, S4_DOWN_DROP);
  await zeraTimeouts(c);
}

/** A S4 está viva NESTA txn? Pela função de gatilho do OTB. */
export async function s4Viva(c: Client): Promise<boolean> {
  const f = S4_FUNCOES.find((x) => x.modulo === "otb")!;
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [f.fn]);
  return r.rows[0]?.m === f.depois;
}

/** LIFO: quem volta a S3d (ou algo mais antigo) dentro da txn tira a S4 antes. */
export async function voltaS4SePreciso(c: Client): Promise<void> {
  if (!(await s4Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS4(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
