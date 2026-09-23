/**
 * KANBAN AUTOMÁTICO — F1 (banco). Integração em BEGIN…ROLLBACK: NADA é gravado.
 * Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 4–17, §3).
 *
 * HARNESS (Task 4). Com KANBAN_AUTO_MIG_TXN=1, `prepara(c, n)` aplica as migrations
 * 20260930120000…150000 (1..n) DENTRO da transação do `withTx`, tirando as linhas `BEGIN;`/`COMMIT;`
 * e o `pg_notify` do arquivo — NUNCA `\i` (o COMMIT do arquivo fecharia a txn e VAZARIA: incidente
 * 15/set). Sem a variável, as migrations precisam já estar aplicadas (ensaio da Task 18 na cópia
 * local) e `prepara` só ajusta os timeouts. Sem banco, a suíte se auto-pula.
 *
 * ⚠️ DDL SÓ NA CÓPIA LOCAL (decisão 17 do dono, 23/set). DDL dentro da txn segura locks até o
 * ROLLBACK — ACCESS EXCLUSIVE em tenant_config, que as policies RLS de TODAS as lojas leem: o app
 * inteiro para (incidente 23/set). Com KANBAN_AUTO_MIG_TXN=1, `prepara` LANÇA erro se o banco não é
 * a cópia local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres); teste que faz
 * DDL por conta própria ou escreve numa loja real usa `skipIf(!LOCAL)`.
 *
 * O recálculo do motor é ADIADO para o COMMIT (constraint trigger deferred) e o COMMIT nunca
 * acontece aqui: `imediato(c)` = SET CONSTRAINTS ALL IMMEDIATE (dispara os pendentes) + DEFERRED.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";
import { CASOS } from "../fixtures/kanban-auto-casos";
import {
  boardDaLoja, derivarModelo, destinoDrop, faltandoPara, fluxoDoModelo, lerKanbanAutoConfig, statusDerivado,
} from "../../src/lib/kanban-auto";
import { normalizeKanbanStatuses } from "../../src/lib/kanban-status";

// ─────────────────────────────── Harness (Task 4) ───────────────────────────────
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG_TXN = process.env.KANBAN_AUTO_MIG_TXN === "1";
/** Banco em uso é a CÓPIA LOCAL (Docker 127.0.0.1:54422)? DDL só nela (decisão 17 do dono, 23/set). */
const LOCAL = ehBancoLocal();
/** SSL dos `Client` abertos fora do `withTx`: a cópia local não tem SSL; o pooler de produção exige. */
const SSL = LOCAL ? false : { rejectUnauthorized: false };
const MIGRACOES = [
  "supabase/migrations/20260930120000_kanban_auto_1_schema.sql",
  "supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql",
  "supabase/migrations/20260930140000_kanban_auto_3_motor.sql",
  "supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql",
] as const;
const INVERSOS = {
  1: "supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql",
  2: "supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql",
  3: "supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql",
  4: "supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql",
} as const;

// Sem flag `g` nas constantes (regex global guarda lastIndex entre chamadas); `todas()` cria a versão global.
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const RE_NOTIFY = /^[ \t]*select[ \t]+pg_notify\('pgrst',[ \t]*'reload schema'\)[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");

/** Conteúdo de um arquivo de migration/inverso SEM o controle de transação, p/ rodar dentro do withTx.
 *  Exige exatamente 1 `BEGIN;` e 1 `COMMIT;` em linha própria e recusa qualquer outro controle de
 *  transação fora de corpo `$…$` (a checagem roda depois de apagar os corpos dollar-quoted, onde
 *  `BEGIN`/`END;` do plpgsql são legítimos). */
function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) {
    throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  }
  const out = sql
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido")
    .replace(todas(RE_NOTIFY), "-- [harness] notify removido");
  const foraDeCorpos = out.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");
  if (/^[ \t]*(BEGIN|COMMIT|ROLLBACK|END|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE)\b[^\n]*;/im.test(foraDeCorpos)) {
    throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  }
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

/** Roda o SQL dentro da txn aberta. O SAVEPOINT prova que a txn continua aberta no fim
 *  (se algo tivesse comitado, o RELEASE falharia alto). */
async function aplicarSql(c: Client, sql: string, nome: string): Promise<void> {
  await c.query("SAVEPOINT kanban_auto_prepara");
  await c.query(semTransacao(sql, nome));
  await c.query("RELEASE SAVEPOINT kanban_auto_prepara");
}

async function aplicarArquivo(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, readFileSync(ROOT + rel, "utf8"), rel);
}

/** DDL/migration SÓ na cópia local (decisão 17 do dono; incidente 23/set). */
function exigeBancoLocal(local: boolean = LOCAL): void {
  if (!local) {
    throw new Error(
      "DDL/migration só na cópia local — ver banco-local (/Users/sunglee/PLM + Criação/banco-local; " +
        "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). DDL em transação contra " +
        "produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

/** (com KANBAN_AUTO_MIG_TXN=1: recusa banco que não é a cópia local) + timeouts + migrations 1..ate na txn. */
async function prepara(c: Client, ate: 1 | 2 | 3 | 4 = 4): Promise<void> {
  if (MIG_TXN) exigeBancoLocal(); // ANTES de qualquer comando: DDL nunca fora da cópia local
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  if (!MIG_TXN) return;
  for (const rel of MIGRACOES.slice(0, ate)) await aplicarArquivo(c, rel);
}

async function migracoesJaAplicadas(): Promise<boolean> {
  if (!hasDb || MIG_TXN || !LOCAL) return false; // produção: a suíte não roda lá nem depois do apply (D21) — nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: SSL });
  await c.connect();
  try {
    const r = await c.query("SELECT to_regprocedure('public.kanban_mover(uuid,text)') IS NOT NULL AS ok");
    return r.rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}

/** Suíte do motor roda: com banco E (migrations na txn — `prepara` exige a cópia local — OU já aplicadas NA CÓPIA LOCAL, ensaio da Task 18). */
const PRONTO = hasDb && (MIG_TXN || (await migracoesJaAplicadas()));

describe("kanban-auto — harness: semTransacao (Task 4)", () => {
  const MIG = [
    "-- cabeçalho que cita BEGIN e COMMIT em comentário",
    "BEGIN;",
    "CREATE OR REPLACE FUNCTION public._kanban_harness_probe() RETURNS int LANGUAGE plpgsql AS $function$",
    "BEGIN",
    "  RETURN 1;",
    "END;",
    "$function$;",
    "DO $do$ BEGIN PERFORM 1; END $do$;",
    "COMMIT;",
    "",
    "select pg_notify('pgrst', 'reload schema');",
  ].join("\n");

  it("tira BEGIN;/COMMIT;/pg_notify de linha própria e preserva o BEGIN/END do plpgsql", () => {
    const out = semTransacao(MIG, "probe");
    expect(out).not.toMatch(RE_BEGIN);
    expect(out).not.toMatch(RE_COMMIT);
    expect(out).not.toMatch(RE_NOTIFY);
    expect(out).toContain("BEGIN\n  RETURN 1;\nEND;");
    expect(out).toContain("DO $do$ BEGIN PERFORM 1; END $do$;");
  });

  it("recusa arquivo sem BEGIN/COMMIT, com 2 COMMIT ou com controle de transação solto", () => {
    expect(() => semTransacao("CREATE TABLE x();", "a")).toThrow(/esperado 1/);
    expect(() => semTransacao("BEGIN;\nCOMMIT;\nCOMMIT;", "b")).toThrow(/esperado 1/);
    expect(() => semTransacao("BEGIN;\nROLLBACK;\nCOMMIT;", "c")).toThrow(/controle de transação/);
    expect(() => semTransacao("BEGIN;\n\\i outro.sql\nCOMMIT;", "d")).toThrow(/meta-comando/);
  });

  it("exigeBancoLocal: recusa, com erro claro, DDL/migration fora da cópia local (decisão 17)", () => {
    expect(() => exigeBancoLocal(false)).toThrow(/só na cópia local — ver banco-local/);
    expect(() => exigeBancoLocal(true)).not.toThrow();
  });

  it.skipIf(!hasDb || !LOCAL)("aplicarSql roda DENTRO da txn — depois do ROLLBACK nada existe no banco", async () => {
    await withTx(async (c) => {
      await aplicarSql(c, MIG, "probe");
      expect((await um<{ v: number }>(c, "SELECT public._kanban_harness_probe() AS v")).v).toBe(1);
      expect((await um<{ s: boolean }>(c, "SELECT txid_current_if_assigned() IS NOT NULL AS s")).s).toBe(true);
    });
    const c2 = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await c2.connect();
    try {
      const r = await c2.query("SELECT to_regprocedure('public._kanban_harness_probe()') AS f");
      expect(r.rows[0].f).toBeNull();
    } finally {
      await c2.end();
    }
  });
});
