/**
 * Camada intermediária (desenho .superpowers/sdd/2026-10-05-camada/desenho.md §2.4) — os blocos de migration da frente, aplicados
 * DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes camada-*.test.ts,
 * pelo gancho `CAMADA_TXN=1` de `db.ts` e pela cadeia do Backend (`voltaBk`/`voltaBkSePreciso` chamam `voltaCamadaSePreciso`
 * PRIMEIRO: LIFO — a Camada roda DEPOIS do Backend B5 148000 no kit e ANTES da T5 200000, que não toca nenhuma função daqui).
 *
 * C1 = 2 arquivos: `20261103160000_camada_estado_vazio` (6 wrappers, só catálogo) e `20261103161000_camada_parcela_paga` (função de
 * gatilho + CREATE TRIGGER BEFORE DELETE em producao_terceirizados). O `_down` do 161000 é NEUTRO (a função vira passa-direto; o
 * gatilho FICA) — "viva" = md5 da função = IDA. Contrato do `camada-1-dados.ts` GERADO por `mig/gerar-c1.mjs`.
 * ⚠️ `CAMADA_TXN=1` numa cópia SEM o gatilho cria o gatilho dentro da txn do teste: a ShareRowExclusive em producao_terceirizados
 * fica presa até o fim do teste (só escrita concorrente nessa tabela espera). Mesma classe da nota da T4 em mod-helpers.
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

type Dados = {
  CAMADA_MD5: Record<string, { antes: string; depois: string }>;
  CAMADA_SENTINELA: string;
  CAMADA_GAT: {
    fn: string;
    ida: string;
    neutro: string;
    nome: string;
    tabela: string;
    tgtype: number;
  };
  CAMADA_MIG: string;
  CAMADA_DOWN: string;
  CAMADA_MIG_GAT: string;
  CAMADA_DOWN_GAT: string;
};

const DADOS: Dados | null =
  existsSync(`${ROOT}supabase/migrations/20261103160000_camada_estado_vazio.sql`) &&
  existsSync(`${ROOT}tests/integration/camada-1-dados.ts`)
    ? ((await import(/* @vite-ignore */ "./camada-1-dados.ts")) as Dados)
    : null;

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return (r.rows[0]?.m as string | null) ?? null;
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** 160000 vivo NESTA txn? (md5 da sentinela = "depois"). Sem os arquivos = false. */
export async function camadaVazioViva(c: Client): Promise<boolean> {
  if (!DADOS) return false;
  return (
    (await md5Fn(c, DADOS.CAMADA_SENTINELA)) === DADOS.CAMADA_MD5[DADOS.CAMADA_SENTINELA].depois
  );
}
/** 161000 vivo NESTA txn? (função do gatilho = IDA; neutra ou ausente = false). */
export async function camadaGatViva(c: Client): Promise<boolean> {
  if (!DADOS) return false;
  return (await md5Fn(c, DADOS.CAMADA_GAT.fn)) === DADOS.CAMADA_GAT.ida;
}
export async function camadaViva(c: Client): Promise<boolean> {
  return (await camadaVazioViva(c)) || (await camadaGatViva(c));
}

/** Aplica os blocos da C1 que ainda não estão vivos, NA ORDEM (idempotente). */
export async function aplicaCamada(c: Client): Promise<void> {
  if (!DADOS) return;
  exigeBancoLocal();
  if (!(await camadaVazioViva(c))) await aplicarArquivo(c, DADOS.CAMADA_MIG);
  if (!(await camadaGatViva(c))) await aplicarArquivo(c, DADOS.CAMADA_MIG_GAT);
  await zeraTimeouts(c);
}

/** Volta a C1, LIFO, pelos `_down` NEUTROS (o gatilho fica, com a função passa-direto). */
export async function voltaCamada(c: Client): Promise<void> {
  if (!DADOS) return;
  exigeBancoLocal();
  if (await camadaGatViva(c)) await aplicarArquivo(c, DADOS.CAMADA_DOWN_GAT);
  if (await camadaVazioViva(c)) await aplicarArquivo(c, DADOS.CAMADA_DOWN);
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) o Backend ou qualquer release anterior dentro da txn tira a Camada antes. */
export async function voltaCamadaSePreciso(c: Client): Promise<void> {
  if (!(await camadaViva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0]
    .v as string;
  await voltaCamada(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/** md5 pinado por suíte antiga: o pinado + o "depois" da C1 quando o "antes" dela é o pinado (cadeia). */
export function md5CamadaSucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  const s = DADOS?.CAMADA_MD5[k];
  if (s && (!pinado || out.includes(s.antes))) out.push(s.depois);
  return out;
}
