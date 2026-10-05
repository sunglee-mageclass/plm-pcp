/**
 * Reforço de segurança — sub-release S3a "Dinheiro, OCs e estoque de OC" (desenho .superpowers/sdd/2026-10-03-reforco-seguranca/
 * s3-desenho.md §6). Aplica as 3 migrations DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local.
 * Usado por `seg-s3a.test.ts` e pelo gancho `S3A_TXN=1` de `db.ts` (ensaio da suíte inteira com a S3a aplicada, sem tocar a cópia).
 * Os md5/ACL exatos vêm de `seg-s3a-dados.ts` (GERADO pelo mig/gerar-s3a.mjs).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { S3A_MD5, S3A_HELPER } from "./seg-s3a-dados";
import { voltaS3bSePreciso } from "./seg-s3b-helpers";
import { voltaS3cSePreciso } from "./seg-s3c-helpers";
import { voltaS3dSePreciso } from "./seg-s3d-helpers";
import { md5ModSucessor } from "./mod-helpers"; // cadeia Mod → Backend → Camada (C1 redefine o wrapper-sentinela salvar_oc_tecido)

export const S3A_MIGS = [
  "supabase/migrations/20261101100000_seg_s3a_helper_gates_entrada.sql",
  "supabase/migrations/20261101110000_seg_s3a_grants_oc.sql",
  "supabase/migrations/20261101120000_seg_s3a_guarda_oc.sql",
] as const;

/** Inversos em ordem LIFO (o mais novo primeiro). Os `_down_drop` são separados (opcionais, horário calmo). */
export const S3A_DOWNS = [...S3A_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));
export const S3A_DOWN_DROPS = [
  "supabase/rollback/20261101120000_seg_s3a_guarda_oc_down_drop.sql",
  "supabase/rollback/20261101100000_seg_s3a_helper_gates_entrada_down_drop.sql",
] as const;

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

export async function aplicaS3a(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  for (const m of S3A_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

/** Inverso (neutralizador) do Gerar JSON (20261102100000), que roda DEPOIS da S3a/S6 no kit. */
const GERAR_JSON_DOWN = "supabase/rollback/20261102100000_integracao_gerar_json_down.sql";

/**
 * T1 (backend, 05/out): o `_down_drop` da S3a (DROP de `_seg_exige_pagina`) recusa enquanto QUALQUER função de `public` cita o nome em
 * `prosrc` — e a `integracao_gerar_json_ler` do Gerar JSON (mais NOVO que a S3a) o cita num COMENTÁRIO ("D7: ... NAO _seg_exige_pagina").
 * LIFO real (rollback do kit): o `_down` do Gerar JSON é o 1º inverso do banco e o texto neutralizado não cita o helper. O teste, que só
 * volta a S3a, precisa fazer o mesmo antes dos drops. Idempotente (o inverso aceita o texto da ida OU o já neutralizado); sem efeito
 * quando o Gerar JSON não está aplicado ou o arquivo não existe.
 */
export async function voltaGerarJsonSePreciso(c: Client): Promise<void> {
  const viva = await c.query(
    `SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.integracao_gerar_json_ler(uuid[],uuid)') AND p.prosrc LIKE '%_seg_exige_pagina%'`,
  );
  if (!viva.rowCount) return;
  await aplicarArquivo(c, GERAR_JSON_DOWN);
  await zeraTimeouts(c);
}

export async function voltaS3a(c: Client, comDrop = false): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  await voltaS3dSePreciso(c); // LIFO: a S3d (20261101190000..210000) usa o helper da S3a — sai antes
  await voltaS3cSePreciso(c); // LIFO: a S3c (20261101160000..180000) usa o helper da S3a — sai antes
  await voltaS3bSePreciso(c); // LIFO: a S3b (20261101130000..150000) roda por cima da S3a — sai antes
  for (const m of S3A_DOWNS) await aplicarArquivo(c, m);
  if (comDrop) {
    await voltaGerarJsonSePreciso(c); // LIFO: o Gerar JSON (mais novo) sai antes dos drops
    for (const m of S3A_DOWN_DROPS) await aplicarArquivo(c, m);
  }
  await zeraTimeouts(c);
}

/** A S3a está viva NESTA txn (S3A_TXN=1 ou a cópia com a S3a aplicada)? Pelo wrapper-sentinela salvar_oc_tecido. */
export async function s3aViva(c: Client): Promise<boolean> {
  const sig = "public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)";
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  // viva = o texto da S3a OU um sucessor dele (Camada C1 160000 redefine salvar_oc_tecido por cima da S3a)
  return md5ModSucessor(sig, S3A_MD5[sig].depois).includes(r.rows[0]?.m);
}

/**
 * LIFO para quem VOLTA/reaplica a S2 (ou releases mais antigas) dentro da txn: a S3a é mais nova e redefine
 * `recalcular_parcelas` por cima da S2 — as guardas md5 da S2 recusam enquanto ela estiver viva. Volta a S3a primeiro.
 */
export async function voltaS3aSePreciso(c: Client): Promise<void> {
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  await voltaS3dSePreciso(c); // LIFO: a S3d (mais nova) sai antes
  await voltaS3cSePreciso(c); // LIFO: a S3c (mais nova) sai antes
  await voltaS3bSePreciso(c); // LIFO: a S3b (mais nova) sai antes
  if (!(await s3aViva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS3a(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** md5 pinado por suíte antiga: aceita o texto de antes OU o da S3a (padrão `md5OuSucessorS2`). */
export function md5OuSucessorS3a(sig: string, md5Antes: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const s = S3A_MD5[k];
  const base = s && s.antes === md5Antes ? [md5Antes, s.depois] : [md5Antes];
  // + os sucessores das frentes de cima (Mod → Backend → Camada C1), na cadeia do último texto
  for (const m of md5ModSucessor(k, base[base.length - 1])) if (!base.includes(m)) base.push(m);
  return base;
}

export { S3A_HELPER };
