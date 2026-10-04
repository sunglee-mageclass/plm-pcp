/**
 * Reforço de segurança — sub-release S3d "Planejamento, produtos, Plan. Tecido e importação" (desenho .superpowers/sdd/2026-10-03-reforco-seguranca/
 * s3-desenho.md §6). Roda POR CIMA da S3a (usa o helper _seg_exige_pagina dela); independe da S3b/S3c. Aplica as 3 migrations DENTRO da
 * transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado por `seg-s3d.test.ts` e pelo gancho
 * `S3D_TXN=1` de `db.ts`. md5/ACL exatos em `seg-s3d-dados.ts` (GERADO pelo mig/gerar-s3d.mjs).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S3D_MD5 } from "./seg-s3d-dados";

export const S3D_MIGS = [
  "supabase/migrations/20261101190000_seg_s3d_gates_planejamento.sql",
  "supabase/migrations/20261101200000_seg_s3d_grants_planejamento.sql",
  "supabase/migrations/20261101210000_seg_s3d_guarda_modelos.sql",
] as const;
export const S3D_DOWNS = [...S3D_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));
export const S3D_DOWN_DROP = "supabase/rollback/20261101210000_seg_s3d_guarda_modelos_down_drop.sql";
/** As 3 tabelas em que o CREATE TRIGGER da S3d pega ShareRowExclusive (suítes antigas filtram com S3D_TXN=1). */
export const S3D_TABELAS_TRAVA = ["public.modelos", "public.produtos_acabados", "public.produtos_importados"];

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Aplica a S3d (e a S3a antes, se ainda não estiver viva — a S3d exige o helper dela). */
export async function aplicaS3d(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers"); // import dinâmico: a S3a importa voltaS3dSePreciso daqui
  if (!(await s3aViva(c))) await aplicaS3a(c);
  for (const m of S3D_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

export async function voltaS3d(c: Client, comDrop = false): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (20261101240000, grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  const { voltaS4SePreciso } = await import("./seg-s4-helpers"); // LIFO: a S4 (20261101220000..230000) sai antes
  await voltaS4SePreciso(c);
  for (const m of S3D_DOWNS) await aplicarArquivo(c, m);
  if (comDrop) await aplicarArquivo(c, S3D_DOWN_DROP);
  await zeraTimeouts(c);
}

/** A S3d está viva NESTA txn? Pelo wrapper-sentinela lancar_modelo. */
export async function s3dViva(c: Client): Promise<boolean> {
  const sig = "public.lancar_modelo(uuid,date,boolean)";
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return r.rows[0]?.m === S3D_MD5[sig].depois;
}

/** LIFO: quem volta/reaplica a S3a, a S1 (ou algo mais antigo que guarde as mesmas funções) dentro da txn tira a S3d antes. */
export async function voltaS3dSePreciso(c: Client): Promise<void> {
  if (!(await s3dViva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS3d(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** md5 pinado por suíte antiga: aceita o texto de antes OU o da S3d. */
export function md5OuSucessorS3d(sig: string, md5Antes: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const s = S3D_MD5[k];
  return s && s.antes === md5Antes ? [md5Antes, s.depois] : [md5Antes];
}

