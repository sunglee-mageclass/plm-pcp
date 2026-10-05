/**
 * Urgentes R1–R3 (plan-a: .superpowers/sdd/2026-10-05-urgentes/plan-a.md) — os blocos de migration da frente, aplicados DENTRO da
 * transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes urg-a*.test.ts, pelo gancho
 * `URG_A_TXN=1` de `db.ts` e pela cadeia LIFO (Ruling 20 do plan-b): camada → urg-a → urgb. `voltaCamadaSePreciso` chama
 * `voltaUrgASePreciso`, que tira o plan-b (`voltaUrgbSePreciso`) PRIMEIRO e depois esta frente; `md5CamadaSucessor` continua em
 * `md5UrgASucessor`, que continua em `md5UrgbSucessor`.
 *
 * Contrato do `urg-a-dados.ts` GERADO por `mig/gerar-a1.mjs`: `URG_A_BLOCOS[bloco]` com `mig`/`down`/`drop`, `sentinela` (bloco
 * vivo = md5 da sentinela = `depois`), `MD5` (antes/depois de cada função EXISTENTE redefinida — a cadeia de sucessores), `NOVAS`
 * (funções criadas pelo bloco: md5 de depois) e `volta` (o `_down` desfaz algo? false = no-op documentado, ex.: 170000, cuja
 * coluna e helpers ficam inertes). Registro por `existsSync`: um bloco só entra se o arquivo de migration dele existir.
 * Ordem do kit: 170000 → 170500 → 171000 … 178000 (a 178000 é CONCURRENTLY, fora de txn — nunca entra aqui).
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type UrgAId =
  | "170000"
  | "170500"
  | "171000"
  | "172000"
  | "173000"
  | "174000"
  | "175000"
  | "176000"
  | "177000";
const ORDEM: UrgAId[] = ["170000", "170500", "171000", "172000", "173000", "174000", "175000", "176000", "177000"];

type Bloco = {
  mig: string;
  down: string;
  drop: string;
  sentinela: string;
  volta: boolean;
  MD5: Record<string, { antes: string; depois: string }>;
  NOVAS: Record<string, string>;
  NEUTRO?: Record<string, string>; // md5 do texto NEUTRO que o _down deixa (funções novas neutralizadas)
};

// Frente por CIMA desta no kit (urgentes plan-b, 180000..199000). Import dinâmico tolerante a ausência.
type Sucessora = {
  voltaSePreciso: (c: Client) => Promise<void>;
  md5Sucessor: (sig: string, pinado?: string) => string[];
};
const SUCESSORA: Sucessora | null = existsSync(`${ROOT}tests/integration/urgb-helpers.ts`)
  ? await import(/* @vite-ignore */ "./urgb-helpers.ts").then((m) => ({
      voltaSePreciso: m.voltaUrgbSePreciso as Sucessora["voltaSePreciso"],
      md5Sucessor: m.md5UrgbSucessor as Sucessora["md5Sucessor"],
    }))
  : null;

const TODOS: Record<string, Bloco> = existsSync(`${ROOT}tests/integration/urg-a-dados.ts`)
  ? ((await import(/* @vite-ignore */ "./urg-a-dados.ts")) as { URG_A_BLOCOS: Record<string, Bloco> }).URG_A_BLOCOS
  : {};
for (const k of Object.keys(TODOS)) {
  if (!ORDEM.includes(k as UrgAId)) throw new Error(`urg-a-helpers: bloco desconhecido em urg-a-dados.ts: ${k}`);
}

/** Blocos cujo arquivo de migration existe no repositório, NA ORDEM do kit. */
export const URG_A_MIGS: { id: UrgAId; b: Bloco }[] = ORDEM.filter(
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

function depoisDe(b: Bloco, sig: string): string {
  const d = b.MD5[sig]?.depois ?? b.NOVAS[sig];
  if (!d) throw new Error(`urg-a-helpers: sentinela ${sig} sem md5 de depois`);
  return d;
}

/** O bloco está vivo NESTA txn? (md5 da sentinela = "depois"). Bloco sem arquivo = false. */
export async function urgAViva(c: Client, bloco: UrgAId): Promise<boolean> {
  const e = URG_A_MIGS.find((x) => x.id === bloco);
  if (!e) return false;
  return (await md5Fn(c, e.b.sentinela)) === depoisDe(e.b, e.b.sentinela);
}

/** Aplica os blocos que existem e ainda não estão vivos, NA ORDEM (idempotente); `ate` = último bloco a aplicar. */
export async function aplicaUrgA(c: Client, ate?: UrgAId): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of URG_A_MIGS) {
    if (!(await urgAViva(c, id))) await aplicarArquivo(c, b.mig);
    if (id === ate) break;
  }
  await zeraTimeouts(c);
}

/** Volta, LIFO, os blocos vivos cujo `_down` desfaz algo (`volta`); os no-op (170000) ficam. */
export async function voltaUrgA(c: Client): Promise<void> {
  exigeBancoLocal();
  // o _down da 171000 faz SET LOCAL check_function_bodies = off (devolve o texto que ja estava vivo, sem trava de tabela); na txn do
  // teste o SET LOCAL vazaria para o resto do teste (re-aplicar migration antiga sem validar corpo) - devolve o valor de antes.
  const cfb = (await c.query("SELECT current_setting('check_function_bodies') AS v")).rows[0].v as string;
  for (const { id, b } of [...URG_A_MIGS].reverse()) {
    if (b.volta && (await urgAViva(c, id))) await aplicarArquivo(c, b.down);
  }
  await c.query("SELECT set_config('check_function_bodies', $1, true)", [cfb]);
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) a Camada ou qualquer release anterior dentro da txn tira esta frente antes (e o plan-b antes dela). */
export async function voltaUrgASePreciso(c: Client): Promise<void> {
  if (SUCESSORA) await SUCESSORA.voltaSePreciso(c); // LIFO: o plan-b (por cima) sai antes, mesmo com esta frente fora
  let viva = false;
  for (const { id, b } of URG_A_MIGS) if (b.volta && (await urgAViva(c, id))) viva = true;
  if (!viva) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaUrgA(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/**
 * md5 pinado por suíte antiga: o pinado + os "depois" desta frente que o sucedem (cadeia pelos blocos, na ordem: um bloco só entra
 * se o "antes" dele já está na lista) e, por fim, os do plan-b que sucedem o último texto desta cadeia.
 */
export function md5UrgASucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  for (const { b } of URG_A_MIGS) {
    const s = b.MD5[k];
    if (!s) continue;
    if (!pinado || out.includes(s.antes)) out.push(s.depois);
  }
  if (SUCESSORA) {
    const ultimo = out.length ? out[out.length - 1] : undefined;
    for (const m of SUCESSORA.md5Sucessor(k, ultimo)) if (!out.includes(m)) out.push(m);
  }
  return out;
}
