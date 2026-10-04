/**
 * Reforço de segurança — sub-release S3b "Produção, Expedição e Explosão" (desenho .superpowers/sdd/2026-10-03-reforco-seguranca/
 * s3-desenho.md §6). Roda POR CIMA da S3a (usa o helper _seg_exige_pagina dela). Aplica as 3 migrations DENTRO da transação do teste
 * (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado por `seg-s3b.test.ts` e pelo gancho `S3B_TXN=1` de `db.ts`.
 * md5/ACL exatos em `seg-s3b-dados.ts` (GERADO pelo mig/gerar-s3b.mjs).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S3B_MD5 } from "./seg-s3b-dados";

export const S3B_MIGS = [
  "supabase/migrations/20261101130000_seg_s3b_gates_producao.sql",
  "supabase/migrations/20261101140000_seg_s3b_grants_producao.sql",
  "supabase/migrations/20261101150000_seg_s3b_guarda_producao.sql",
] as const;
export const S3B_DOWNS = [...S3B_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));
/** As 3 tabelas em que o CREATE TRIGGER da S3b pega ShareRowExclusive (suítes antigas filtram com S3B_TXN=1). */
export const S3B_TABELAS_TRAVA = ["public.cad", "public.controle_qualidade", "public.producao_oficina"];
export const S3B_DOWN_DROP = "supabase/rollback/20261101150000_seg_s3b_guarda_producao_down_drop.sql";

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Aplica a S3b (e a S3a antes, se ainda não estiver viva — a S3b exige o helper dela). */
export async function aplicaS3b(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers"); // import dinâmico: a S3a importa voltaS3bSePreciso daqui
  if (!(await s3aViva(c))) await aplicaS3a(c);
  for (const m of S3B_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

export async function voltaS3b(c: Client, comDrop = false): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (20261101240000, grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  for (const m of S3B_DOWNS) await aplicarArquivo(c, m);
  if (comDrop) await aplicarArquivo(c, S3B_DOWN_DROP);
  await zeraTimeouts(c);
}

/** A S3b está viva NESTA txn? Pelo wrapper-sentinela salvar_cq. */
export async function s3bViva(c: Client): Promise<boolean> {
  const sig = "public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)";
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return r.rows[0]?.m === S3B_MD5[sig].depois;
}

/** LIFO: quem volta/reaplica a S3a (ou algo mais antigo) dentro da txn tira a S3b antes. */
export async function voltaS3bSePreciso(c: Client): Promise<void> {
  if (!(await s3bViva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS3b(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** md5 pinado por suíte antiga: aceita o texto de antes OU o da S3b. */
export function md5OuSucessorS3b(sig: string, md5Antes: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const s = S3B_MD5[k];
  return s && s.antes === md5Antes ? [md5Antes, s.depois] : [md5Antes];
}
