/**
 * R12 (Onda 3) - aprovar o custo automaticamente quando a versao nao ficar mais cara. A migration
 * `20261106100000_r12_custo_auto_por_versao` e o TOPO da cadeia de helpers: camada -> urg-a -> urgb -> urgc -> urgd -> urg-r13 -> **r12**.
 * O predecessor (`urg-r13-helpers.ts`) delega a este: `voltaR13SePreciso` tira a R12 PRIMEIRO, `dropR13SePreciso` roda o
 * `dropR12SePreciso` primeiro e `md5R13Sucessor` continua em `md5R12Sucessor` (as frentes de baixo herdam a cadeia).
 *
 * A R12 redefine 3 funcoes (salvar_config_loja, _mo_liberada(uuid), fn_modelo_mo_flag_derivada); os md5 ANTES/DEPOIS vem de
 * .superpowers/sdd/2026-11-03-r12/mig/md5-r12.txt (gerador gerar.py). Pino antigo sobre uma delas passa a aceitar tambem o DEPOIS da R12
 * (so quando o texto anterior da cadeia e o ANTES dela): o pino segue sendo GUARD, nenhum numero e trocado "no olho".
 * Sem gancho de ida (`R12_TXN`): a R12 so cria coluna + funcoes e o teste dela exige a migration aplicada na copia (psql -f).
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NOME = "20261106100000_r12_custo_auto_por_versao";
const MIG = `supabase/migrations/${NOME}.sql`;
const DOWN = `supabase/rollback/${NOME}_down.sql`;
const DROP = `supabase/rollback/${NOME}_down_drop.sql`;

/** md5 ANTES -> DEPOIS (pg_get_functiondef) das 3 funcoes que a R12 redefine. */
const R12_MD5: Record<string, { antes: string; depois: string }> = {
  "public.salvar_config_loja(uuid,jsonb,jsonb,boolean)": {
    antes: "27fdf9f2c9b2d1fe49577e9d30eaa574",
    depois: "4525360afafe5fde02502dc2a5941af6",
  },
  "public._mo_liberada(uuid)": {
    antes: "c54a262df580e35a64222eedfa5f3a50",
    depois: "9fb23d074c6cd1bda585cbb02f085605",
  },
  "public.fn_modelo_mo_flag_derivada()": {
    antes: "3a771d9f2f9fde46ee0c540c29b9a3b0",
    depois: "0fc2e7695fa33eb1f33564d12260660c",
  },
};

/** R12 viva = o gatilho do card ja chama o overload de 3 argumentos (o `_down` NEUTRO devolve o texto de antes e deixa os helpers). */
async function r12Viva(c: Client): Promise<boolean> {
  const r = await c.query(
    `SELECT md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_mo_flag_derivada()'))) AS m,
            md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) AS s,
            md5(pg_get_functiondef(to_regprocedure('public._mo_liberada(uuid)'))) AS l`,
  );
  const row = r.rows[0];
  return (
    !!row &&
    (row.m === R12_MD5["public.fn_modelo_mo_flag_derivada()"].depois ||
      row.s === R12_MD5["public.salvar_config_loja(uuid,jsonb,jsonb,boolean)"].depois ||
      row.l === R12_MD5["public._mo_liberada(uuid)"].depois)
  );
}

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Volta a R12 (so o `_down` NEUTRO: devolve os 3 textos; coluna e helpers FICAM inertes). So atua se ha algo vivo. */
export async function voltaR12(c: Client): Promise<void> {
  exigeBancoLocal();
  if (existsSync(ROOT + DOWN) && (await r12Viva(c))) await aplicarArquivo(c, DOWN);
  await zeraTimeouts(c);
}

/** LIFO: quem volta/reaplica a R13 ou qualquer release anterior dentro da txn tira a R12 antes (so se estiver viva). */
export async function voltaR12SePreciso(c: Client): Promise<void> {
  if (!(await r12Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaR12(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** LIFO dos `_down_drop`: volta a R12 e, se os helpers/a coluna ainda existem, aplica o `_down_drop` (com a GUC do toggle ligado). */
export async function dropR12SePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  await voltaR12SePreciso(c);
  if (!existsSync(ROOT + DROP)) return;
  const ha = (
    await c.query(
      `SELECT to_regprocedure('public._mo_custo_auto_liberado(uuid)') IS NOT NULL
           OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass
                         AND attname = 'aprovar_custo_auto_por_versao' AND NOT attisdropped) AS ok`,
    )
  ).rows[0]?.ok;
  if (ha) {
    await c.query("SET LOCAL app.confirmo_apagar_toggle_custo_auto = 'sim'");
    await aplicarArquivo(c, DROP);
  }
  await zeraTimeouts(c);
}

/** Pino antigo + o DEPOIS da R12 quando o texto anterior da cadeia e o ANTES dela (ou sem pino: so o DEPOIS). */
export function md5R12Sucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  const s = R12_MD5[k];
  if (s && (!pinado || pinado === s.antes) && !out.includes(s.depois)) out.push(s.depois);
  return out;
}
