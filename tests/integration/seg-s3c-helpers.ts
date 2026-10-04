/**
 * Reforço de segurança — sub-release S3c "Ficha técnica, CAD, M.O. e B3" (desenho .superpowers/sdd/2026-10-03-reforco-seguranca/
 * s3-desenho.md §6). Roda POR CIMA da S3a (usa o helper _seg_exige_pagina dela); independe da S3b. Aplica as 3 migrations DENTRO da
 * transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado por `seg-s3c.test.ts` e pelo gancho
 * `S3C_TXN=1` de `db.ts`. md5/ACL exatos em `seg-s3c-dados.ts` (GERADO pelo mig/gerar-s3c.mjs).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S3C_MD5 } from "./seg-s3c-dados";

export const S3C_MIGS = [
  "supabase/migrations/20261101160000_seg_s3c_gates_ficha.sql",
  "supabase/migrations/20261101170000_seg_s3c_grants_ficha.sql",
  "supabase/migrations/20261101180000_seg_s3c_guarda_ficha.sql",
] as const;
export const S3C_DOWNS = [...S3C_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));
export const S3C_DOWN_DROP = "supabase/rollback/20261101180000_seg_s3c_guarda_ficha_down_drop.sql";
/** As 2 tabelas em que o CREATE TRIGGER da S3c pega ShareRowExclusive (suítes antigas filtram com S3C_TXN=1). */
export const S3C_TABELAS_TRAVA = ["public.modelo_etiquetas", "public.modelo_observacoes"];

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Aplica a S3c (e a S3a antes, se ainda não estiver viva — a S3c exige o helper dela). */
export async function aplicaS3c(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers"); // import dinâmico: a S3a importa voltaS3cSePreciso daqui
  if (!(await s3aViva(c))) await aplicaS3a(c);
  for (const m of S3C_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

export async function voltaS3c(c: Client, comDrop = false): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (20261101240000, grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  for (const m of S3C_DOWNS) await aplicarArquivo(c, m);
  if (comDrop) await aplicarArquivo(c, S3C_DOWN_DROP);
  await zeraTimeouts(c);
}

/** A S3c está viva NESTA txn? Pelo wrapper-sentinela salvar_modelo_servico_mo. */
export async function s3cViva(c: Client): Promise<boolean> {
  const sig = "public.salvar_modelo_servico_mo(uuid,jsonb)";
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return r.rows[0]?.m === S3C_MD5[sig].depois;
}

/** LIFO: quem volta/reaplica a S3a, a S1 (ou algo mais antigo que guarde as mesmas funções) dentro da txn tira a S3c antes. */
export async function voltaS3cSePreciso(c: Client): Promise<void> {
  if (!(await s3cViva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS3c(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** md5 pinado por suíte antiga: aceita o texto de antes OU o da S3c. */
export function md5OuSucessorS3c(sig: string, md5Antes: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const s = S3C_MD5[k];
  return s && s.antes === md5Antes ? [md5Antes, s.depois] : [md5Antes];
}

/**
 * Suítes antigas que semeiam DE PROPÓSITO um vínculo de OUTRA loja (dado legado, de antes do B3 — a cópia tem 0 linhas assim)
 * para provar que o servidor não vaza o preço dele: com a S3c viva, o B3 do gatilho recusaria a semente (P0001 loja_diferente).
 * Desliga o gatilho SÓ durante a semente, dentro da txn revertida (cópia local), e religa.
 */
export async function semeiaLegadoSemB3<R>(c: Client, tabela: "modelo_etiquetas" | "modelo_observacoes", fn: () => Promise<R>): Promise<R> {
  exigeBancoLocal();
  const { rows } = await c.query(
    `SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || $1) AND tgname = 'trg_aaa_seg_pagina' AND tgenabled = 'O'`, [tabela]);
  if (!rows.length) return fn();
  await c.query(`ALTER TABLE public.${tabela} DISABLE TRIGGER trg_aaa_seg_pagina`);
  try {
    return await fn();
  } finally {
    await c.query(`ALTER TABLE public.${tabela} ENABLE TRIGGER trg_aaa_seg_pagina`);
  }
}
