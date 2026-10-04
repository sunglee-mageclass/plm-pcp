/**
 * Frente Modularidade (plano .superpowers/sdd/2026-10-04-modularidade/plan.md §3 T1 e §13) — os 5 blocos de migration, aplicados
 * DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes mod-N-*.test.ts, pelo
 * gancho `MOD_TXN=1` de `db.ts` e pela cadeia S1..S6 (`voltaS6SePreciso` chama `voltaModSePreciso` PRIMEIRO: LIFO).
 *
 * Registro por `existsSync`: cada bloco só entra se o arquivo da migration existir — T2..T5 NÃO editam este arquivo.
 * Contrato do `tests/integration/mod-N-dados.ts` GERADO por cada `gerar-modN.mjs` (T1, T2, T3, T5):
 *   export const MOD_MD5: Record<"public.f(args)", { antes: string; depois: string }>;  // funções redefinidas
 *   export const MOD_SENTINELA: string;                                                 // uma chave de MOD_MD5 (bloco vivo?)
 * A T4 (CHECK em `modelos`, à mão, sem dados gerados) é reconhecida pela constraint; o `_down` dela é no-op documentado (só o
 * `_down_drop` remove), então `voltaMod*` NÃO a desfaz dentro da txn (nenhuma guarda da cadeia S olha `modelos` CHECK).
 *
 * ⚠️ `MOD_TXN=1` numa cópia que AINDA NÃO tem a T4 aplica o ADD CONSTRAINT dentro da txn do teste: a AccessExclusive em `modelos`
 * fica presa até o fim do teste e dá 55P03 FALSO em teste com 2ª conexão real em `modelos` (`preco-titulo-versao`,
 * `modelo-descricao-produto`) e acusa lock a mais nas medições de trava de `seg-s3d`/`seg-s4`. Não é regressão da frente
 * (D1/T4-M5): aplique a T4 na cópia (janela N3) ANTES de ensaiar com `MOD_TXN=1`; com a T4 viva a suíte inteira fica igual à base.
 * (Decisão da D1: documentar em vez de o `aplicaMod` pular a T4 — pular esconderia justamente o ensaio do CHECK sobre a suíte.)
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

type Dados = { MOD_MD5: Record<string, { antes: string; depois: string }>; MOD_SENTINELA: string };
export type BlocoMod = {
  n: 1 | 2 | 3 | 4 | 5;
  idas: string[];
  /** inversos NEUTROS na ordem em que rodam (vazio = nada a desfazer dentro da txn). */
  downs: string[];
  /** arquivo de dados gerado (md5) — ausente na T4. */
  dados?: string;
  /** como saber se o bloco está vivo quando não há dados (T4). */
  vivaSql?: string;
};

const MIG = (id: string) => `supabase/migrations/${id}.sql`;
const DOWN = (id: string) => `supabase/rollback/${id}_down.sql`;

/** Os 5 blocos NA ORDEM de aplicação (plano §1/§13). */
const TODOS: BlocoMod[] = [
  {
    n: 1,
    idas: [MIG("20261103100000_mod_gates_rpcs")],
    downs: [DOWN("20261103100000_mod_gates_rpcs")],
    dados: "mod-1-dados",
  },
  {
    n: 2,
    idas: [MIG("20261103110000_mod_lancar_colecao")],
    downs: [DOWN("20261103110000_mod_lancar_colecao")],
    dados: "mod-2-dados",
  },
  {
    n: 3,
    idas: [MIG("20261103120000_mod_kanban_colecao")],
    downs: [DOWN("20261103120000_mod_kanban_colecao")],
    dados: "mod-3-dados",
  },
  {
    n: 4,
    idas: [MIG("20261103130000_mod_reprovado_check"), MIG("20261103131000_mod_reprovado_validate")],
    downs: [],
    vivaSql: `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.modelos'::regclass
                AND conname IN ('modelos_status_dev_normalizado_chk', 'modelos_status_plan_normalizado_chk')) AS v`,
  },
  {
    n: 5,
    idas: [MIG("20261103200000_mod_rev_uma_vez")],
    downs: [DOWN("20261103200000_mod_rev_uma_vez")],
    dados: "mod-5-dados",
  },
];

/** Blocos cujo 1º arquivo de migration existe no repositório (na ordem de aplicação). */
export const MOD_MIGS: BlocoMod[] = TODOS.filter((b) => existsSync(ROOT + b.idas[0]));

// Dados gerados de cada bloco (import dinâmico tolerante a ausência; carregados uma vez).
const DADOS: Partial<Record<number, Dados>> = {};
for (const b of MOD_MIGS) {
  if (b.dados && existsSync(`${ROOT}tests/integration/${b.dados}.ts`)) {
    DADOS[b.n] = (await import(/* @vite-ignore */ `./${b.dados}.ts`)) as Dados;
  }
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

const bloco = (n: number): BlocoMod | undefined => MOD_MIGS.find((b) => b.n === n);

/** O bloco `n` está vivo NESTA txn? Pelo md5 da sentinela (ou pela constraint, na T4). Bloco sem arquivo = false. */
export async function modViva(c: Client, n: number): Promise<boolean> {
  const b = bloco(n);
  if (!b) return false;
  if (b.vivaSql) return !!(await c.query(b.vivaSql)).rows[0]?.v;
  const d = DADOS[n];
  if (!d) return false;
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
    d.MOD_SENTINELA,
  ]);
  return r.rows[0]?.m === d.MOD_MD5[d.MOD_SENTINELA]?.depois;
}

/** Aplica os blocos 1..`ate` que existem e ainda não estão vivos, NA ORDEM (idempotente). */
export async function aplicaMod(c: Client, ate = 5): Promise<void> {
  exigeBancoLocal();
  for (const b of MOD_MIGS) {
    if (b.n > ate) break;
    if (await modViva(c, b.n)) continue;
    for (const m of b.idas) await aplicarArquivo(c, m);
  }
  await zeraTimeouts(c);
}

/** Volta TODOS os blocos vivos, LIFO, pelos `_down` neutros (a T4 fica: o `_down` dela é no-op). */
export async function voltaMod(c: Client): Promise<void> {
  exigeBancoLocal();
  for (const b of [...MOD_MIGS].reverse()) {
    if (!b.downs.length || !(await modViva(c, b.n))) continue;
    for (const d of b.downs) await aplicarArquivo(c, d);
  }
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) a S6 ou qualquer release anterior dentro da txn tira esta frente antes (voltaS6SePreciso). */
export async function voltaModSePreciso(c: Client): Promise<void> {
  let viva = false;
  for (const b of MOD_MIGS) if (b.downs.length && (await modViva(c, b.n))) viva = true;
  if (!viva) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0]
    .v as string;
  await voltaMod(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/**
 * md5 pinado por suíte antiga: devolve o pinado + os "depois" desta frente que o sucedem (cadeia pelos blocos, na ordem: um bloco
 * só entra se o "antes" dele já está na lista). Sem `pinado`: todos os "depois" da função nos blocos existentes.
 */
export function md5ModSucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  for (const b of MOD_MIGS) {
    const s = DADOS[b.n]?.MOD_MD5[k];
    if (!s) continue;
    if (!pinado || out.includes(s.antes)) out.push(s.depois);
  }
  return out;
}
