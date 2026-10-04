/**
 * Reforço de segurança — Release S2 "Dinheiro e estoque" (plano .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md §2 S2).
 * Aplica as 3 migrations DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local.
 * Usado por `seg-s2.test.ts` e pelo gancho `S2_TXN=1` de `db.ts` (ensaio da suíte inteira com a S2 aplicada, sem tocar a cópia).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { voltaS3aSePreciso } from "./seg-s3a-helpers";

export const S2_MIGS = [
  "supabase/migrations/20261031200000_seg_s2_grants_dinheiro.sql",
  "supabase/migrations/20261031210000_seg_s2_financeiro_aba.sql",
  "supabase/migrations/20261031220000_seg_s2_gate_financeiro.sql",
] as const;

/** Inversos em ordem LIFO (o mais novo primeiro). O `_down_drop` da 210000 é separado (opcional, horário calmo). */
export const S2_DOWNS = [...S2_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));
export const S2_DOWN_DROP = "supabase/rollback/20261031210000_seg_s2_financeiro_aba_down_drop.sql";

/** md5 de ANTES|DEPOIS de cada função redefinida (o mesmo das guardas/pós-condições das migrations). */
export const S2_MD5: Record<string, { antes: string; depois: string }> = {
  "public.fn_servico_parcela_valor_pago()": { antes: "de9914b310477de1331f076a874696f1", depois: "b81d725dc25994eae29e7dfa8337f621" },
  "public.servicos_financeiro()": { antes: "a06f4cc32646cc41ed249d91a68dcd51", depois: "85fbaba16664cb6f585e533b5041a139" },
  "public.recalcular_parcelas(uuid,text)": { antes: "5db77cc2c9c3dcf8bae6fc297457978a", depois: "aa6df4729aeaa0f7bd08a2c0833d8b52" },
  "public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)": {
    antes: "e16c604d1ce06fe77151118870c1257c", depois: "d0933c6d48292b7309c6b2ac9e783466",
  },
  "public._receber_reposicao_troca_core(uuid,date,numeric)": { antes: "95fa0b06c2a5835789c8d0c3d10a8eb5", depois: "887c95f8f439a87eec9d1dd7a1303e3d" },
};
/** Função NOVA (gatilho trg_parcela_permissao): texto da ida e o texto NEUTRO que o `_down` deixa. */
export const S2_PERM = { fn: "public.fn_parcela_permissao()", depois: "f52b8d610577554a756fc2125844e5b2", neutra: "d532e403362f93bcee9240f4c15bc840" };

/** ACL das 5 tabelas ANTES/DEPOIS (relacl | colunas com attacl), lidos da cópia pelo gerador (mig/md5-s2.txt). */
const COLS4 = "data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}";
const COLS4_PS = "data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}";
const CHEIA = "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
const FECHADA = "{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}";
export const S2_ACL: Record<string, { antes: [string, string | null]; depois: [string, string | null] }> = {
  parcelas: {
    antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=ardDxtm/postgres,service_role=arwdDxtm/postgres}", COLS4],
    depois: [FECHADA, COLS4],
  },
  parcelas_servico: { antes: [CHEIA, null], depois: [FECHADA, COLS4_PS] },
  estoque_tecido_baixas: { antes: [CHEIA, null], depois: [FECHADA, null] },
  ocs_aviamento_itens: { antes: [CHEIA, null], depois: [FECHADA, null] },
  ocs_etiqueta_itens: { antes: [CHEIA, null], depois: [FECHADA, null] },
};

export async function aclTabela(c: Client, t: string): Promise<[string, string | null]> {
  const { rows } = await c.query(
    `SELECT coalesce(c.relacl::text, '') AS acl,
            (SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS cols
       FROM pg_class c WHERE c.oid = to_regclass('public.' || $1)`,
    [t],
  );
  return [rows[0].acl, rows[0].cols];
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

export async function aplicaS2(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  await voltaS3aSePreciso(c); // LIFO: a S3a (20261101100000..120000) redefine recalcular_parcelas por cima da S2 — sai antes
  for (const m of S2_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

export async function voltaS2(c: Client, comDrop = false): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  await voltaS3aSePreciso(c); // LIFO: a S3a sai antes da S2
  for (const m of S2_DOWNS) await aplicarArquivo(c, m);
  if (comDrop) await aplicarArquivo(c, S2_DOWN_DROP);
  await zeraTimeouts(c);
}

/**
 * md5 pinado por suíte antiga: aceita o texto de antes OU o da S2 (padrão do `md5OuSucessorS1`). Com a S2 aplicada (gancho
 * `S2_TXN=1` ou depois que o controlador aplicar na cópia) a função tem o texto da S2; sem ela, o de antes.
 */
export function md5OuSucessorS2(sig: string, md5Antes: string): string[] {
  const s = S2_MD5[sig];
  if (!s || s.antes !== md5Antes) return [md5Antes];
  return [md5Antes, s.depois];
}

/** Volta a S2 dentro da txn quando ela estiver aplicada (suítes que voltam releases ANTIGAS na txn — a cadeia é LIFO). */
export async function voltaS2SePreciso(c: Client): Promise<void> {
  await voltaS3aSePreciso(c); // LIFO: a S3a (mais nova) sai antes
  const { rows } = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure('public.servicos_financeiro()'))) AS m");
  if (rows[0]?.m === S2_MD5["public.servicos_financeiro()"].depois) await voltaS2(c);
}
