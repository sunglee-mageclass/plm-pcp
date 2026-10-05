/**
 * Urgentes R4–R8 (plan-b: .superpowers/sdd/2026-10-05-urgentes/plan-b.md) — os blocos de migration da frente, aplicados DENTRO da
 * transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes urgb-*.test.ts, pelo gancho
 * `URGB_TXN=1` de `db.ts` e pela cadeia LIFO da Camada (`voltaCamadaSePreciso` chama `voltaUrgbSePreciso` PRIMEIRO; `md5CamadaSucessor`
 * continua em `md5UrgbSucessor`). O plan-a (170000–179000, `urga-helpers.ts`) entra ENTRE a Camada e esta frente quando existir:
 * aí o gancho da Camada passa a chamar o do plan-a, e o do plan-a chama este (ver Ruling 20 do plan-b).
 *
 * Contrato do `urgb-dados.ts` GERADO por `mig/gerar-b.mjs` (um gerador para os 5 blocos): `URGB_BLOCOS[bloco]` com `mig`/`down`/
 * `drop`, `URGB_MD5` (antes/depois de cada função redefinida), `URGB_SENTINELA` (bloco vivo = md5 da sentinela = "depois") e
 * `URGB_ACL`. Registro por `existsSync`: um bloco só entra se o arquivo de migration dele existir. Ordem do kit: 180000 (r4a) →
 * 181000 (r4b) → 185000 (r5) → 190000 (r8a) → 191000 (r8b); volta LIFO pelos `_down` NEUTROS (a coluna nova da r4a FICA — só o
 * `_down_drop` a remove, e ele nunca roda aqui).
 * ⚠️ `URGB_TXN=1` numa cópia SEM a r4a faz o ALTER TABLE dentro da txn do teste: a AccessExclusive em modelo_servico_mo (e a
 * ShareRowExclusive em empresas) fica presa até o fim do teste. Mesma classe da nota da C1 em camada-helpers.
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type UrgbId = "r4a" | "r4b" | "r5" | "r8a" | "r8b";
const ORDEM: UrgbId[] = ["r4a", "r4b", "r5", "r8a", "r8b"];

type Bloco = {
  mig: string;
  down: string;
  drop: string;
  URGB_SENTINELA: string;
  URGB_MD5: Record<string, { antes: string; depois: string }>;
  URGB_ACL: Record<string, string>;
  URGB_NOVAS?: Record<string, string>; // funções CRIADAS pelo bloco (o _down NEUTRO as deixa; só o _down_drop apaga)
};

const TODOS: Record<string, Bloco> = existsSync(`${ROOT}tests/integration/urgb-dados.ts`)
  ? ((await import(/* @vite-ignore */ "./urgb-dados.ts")) as { URGB_BLOCOS: Record<string, Bloco> }).URGB_BLOCOS
  : {};
for (const k of Object.keys(TODOS)) {
  if (!ORDEM.includes(k as UrgbId)) throw new Error(`urgb-helpers: bloco desconhecido em urgb-dados.ts: ${k}`);
}

/** Blocos cujo arquivo de migration existe no repositório, NA ORDEM do kit. */
export const URGB_MIGS: { id: UrgbId; b: Bloco }[] = ORDEM.filter(
  (id) => TODOS[id] && existsSync(ROOT + TODOS[id].mig),
).map((id) => ({ id, b: TODOS[id] }));

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return (r.rows[0]?.m as string | null) ?? null;
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** O bloco está vivo NESTA txn? (md5 da sentinela = "depois"). Bloco sem arquivo = false. */
export async function urgbViva(c: Client, bloco: UrgbId): Promise<boolean> {
  const e = URGB_MIGS.find((x) => x.id === bloco);
  if (!e) return false;
  const s = e.b.URGB_SENTINELA;
  return (await md5Fn(c, s)) === e.b.URGB_MD5[s].depois;
}

/** Aplica os blocos que existem e ainda não estão vivos, NA ORDEM (idempotente); `ate` = último bloco a aplicar. */
export async function aplicaUrgb(c: Client, ate?: UrgbId): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of URGB_MIGS) {
    if (!(await urgbViva(c, id))) await aplicarArquivo(c, b.mig);
    if (id === ate) break;
  }
  await zeraTimeouts(c);
}

/** Volta TODOS os blocos vivos, LIFO, pelos `_down` NEUTROS. */
export async function voltaUrgb(c: Client): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of [...URGB_MIGS].reverse()) {
    if (await urgbViva(c, id)) await aplicarArquivo(c, b.down);
  }
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) a Camada ou qualquer release anterior dentro da txn tira esta frente antes. */
export async function voltaUrgbSePreciso(c: Client): Promise<void> {
  let viva = false;
  for (const { id } of URGB_MIGS) if (await urgbViva(c, id)) viva = true;
  if (!viva) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaUrgb(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/**
 * LIFO dos `_down_drop`: o `_down` NEUTRO deixa as funções NOVAS de um bloco (URGB_NOVAS) — inertes, mas ainda citam helpers de
 * frentes antigas (ex.: `_servicos_da_mo_criar` da r4b chama `_tenant_modulo_ligado`, e o `_down_drop` da T1 da Modularidade recusa
 * enquanto alguma função o cita). Quem testa o `_down_drop` de uma frente ANTIGA roda isto antes: volta os blocos e aplica o
 * `_down_drop` de quem ainda tem função nova (DDL na txn do teste — só na cópia local).
 */
export async function dropUrgbSePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  await voltaUrgbSePreciso(c);
  for (const { b } of [...URGB_MIGS].reverse()) {
    if (!b.URGB_NOVAS) continue;
    let existe = false;
    for (const sig of Object.keys(b.URGB_NOVAS)) if ((await md5Fn(c, sig)) !== null) existe = true;
    if (existe) await aplicarArquivo(c, b.drop);
  }
  await zeraTimeouts(c);
}

/**
 * md5 pinado por suíte antiga: o pinado + os "depois" desta frente que o sucedem (cadeia pelos blocos, na ordem: um bloco só entra
 * se o "antes" dele já está na lista). Sem `pinado`: todos os "depois" da função nos blocos existentes.
 */
export function md5UrgbSucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  for (const { b } of URGB_MIGS) {
    const s = b.URGB_MD5[k];
    if (!s) continue;
    if (!pinado || out.includes(s.antes)) out.push(s.depois);
  }
  return out;
}
