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
// Fix round 1 (achado 3, incidente 23/set): com KANBAN_AUTO_MIG_TXN=1 e banco configurado, o arquivo
// recusa JÁ NA COLETA (module load) se o banco não é a cópia local — antes de QUALQUER describe/it
// abrir conexão. `exigeBancoLocal` é `function` (hoisted), pode ser chamada aqui mesmo definida abaixo.
if (MIG_TXN && hasDb) exigeBancoLocal();
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

/** Fix round 1 (achado 1, incidente 23/set): a checagem de "controle de transação solto" precisa
 *  pegar `;`-separado na MESMA linha (`SELECT 2; COMMIT;`) e depois de comentário (`/* x *\/ COMMIT;`),
 *  não só início de linha. Âncora `(^|;)` em vez de `^` + comentários `--`/`/* *\/` apagados ANTES da
 *  checagem (depois do dollar-strip, que já cobre `BEGIN`/`END;`/`END IF`/`END LOOP` legítimos de
 *  plpgsql). `END` ganha lookahead negativo p/ NÃO capturar `END IF`/`END LOOP`/`END CASE`/`END WHILE`
 *  (terminador de bloco, não controle de transação) — defesa em profundidade: no SQL real do plano
 *  esses `END …` sempre vivem DENTRO de corpo `$…$` (já removido), mas a regex não deve depender só
 *  disso. Matriz provada em `semTransacao` (testes desta task) + manualmente contra o estilo real das
 *  migrations (`supabase/migrations/*.sql`, nenhum `END`/`BEGIN`/`COMMIT` sobra fora de corpo `$…$`). */
const RE_COMENTARIO_LINHA = /--[^\n]*/g;
const RE_COMENTARIO_BLOCO = /\/\*[\s\S]*?\*\//g;
const RE_TXN_CTRL_SOLTA =
  /(^|;)[ \t]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE|END(?!\s*(IF|LOOP|CASE|WHILE)\b))\b[^\n]*;/im;

/** Conteúdo de um arquivo de migration/inverso SEM o controle de transação, p/ rodar dentro do withTx.
 *  Exige exatamente 1 `BEGIN;` e 1 `COMMIT;` em linha própria e recusa qualquer outro controle de
 *  transação fora de corpo `$…$` (a checagem roda depois de apagar os corpos dollar-quoted, onde
 *  `BEGIN`/`END;` do plpgsql são legítimos, E depois de apagar comentários `--`/`/* *\/`, pra não deixar
 *  `SELECT 2; COMMIT;`/`/* x *\/ COMMIT;` passarem). */
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
  const foraDeCorpos = out
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "")
    .replace(RE_COMENTARIO_BLOCO, "")
    .replace(RE_COMENTARIO_LINHA, "");
  if (RE_TXN_CTRL_SOLTA.test(foraDeCorpos)) {
    throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  }
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

/** Roda o SQL dentro da txn aberta. O SAVEPOINT prova que a txn continua aberta no fim
 *  (se algo tivesse comitado, o RELEASE falharia alto).
 *  Fix round 1 (achado 2, incidente 23/set): a trava vira ESTRUTURAL — `exigeBancoLocal()` é a
 *  PRIMEIRA linha da função (não só chamada em `prepara`), então `aplicarArquivo`/qualquer chamador
 *  futuro herda a trava por construção, mesmo que esqueça de checar antes de chamar. */
async function aplicarSql(c: Client, sql: string, nome: string): Promise<void> {
  exigeBancoLocal();
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

  it("fix round 1 (achado 1): recusa controle de transação solto na MESMA linha ou após comentário, sem falso positivo no estilo real das migrations", () => {
    // Recusa — antes só pegava início de linha; achado: `;`-separado e comentário passavam batido.
    // O único `BEGIN;`/`COMMIT;` "próprios" (que satisfazem a contagem 1/1) ficam nas bordas; o
    // controle de transação SOLTO (`SELECT 2; COMMIT;` / `/* x */ COMMIT;`) vem no MEIO do corpo.
    expect(() => semTransacao("BEGIN;\nSELECT 2; ROLLBACK;\nSELECT 1;\nCOMMIT;", "e")).toThrow(
      /controle de transação/,
    );
    expect(() => semTransacao("BEGIN;\n/* x */ ROLLBACK;\nSELECT 1;\nCOMMIT;", "f")).toThrow(
      /controle de transação/,
    );
    // Sem falso positivo — terminador de bloco plpgsql (`END IF`/`END LOOP`/`END CASE`/`END WHILE`)
    // não é controle de transação, mesmo fora de corpo `$…$` (defesa em profundidade: no SQL real do
    // plano eles sempre vivem dentro de corpo dollar-quoted, já removido antes desta checagem).
    const semControleSolto = [
      "BEGIN;",
      "CREATE OR REPLACE FUNCTION public._probe_matriz() RETURNS int LANGUAGE plpgsql AS $function$",
      "BEGIN",
      "  IF true THEN",
      "    RETURN 1;",
      "  END IF;",
      "  RETURN 0;",
      "END;",
      "$function$;",
      "COMMIT;",
    ].join("\n");
    expect(() => semTransacao(semControleSolto, "g")).not.toThrow();
  });

  it("exigeBancoLocal: recusa, com erro claro, DDL/migration fora da cópia local (decisão 17)", () => {
    expect(() => exigeBancoLocal(false)).toThrow(/só na cópia local — ver banco-local/);
    expect(() => exigeBancoLocal(true)).not.toThrow();
  });

  it("fix round 1 (achado 2): aplicarSql chama exigeBancoLocal() estruturalmente (1ª linha, ANTES de qualquer .query) — prova por chamador fake que nunca deveria ser tocado quando não-local", async () => {
    // `aplicarSql` não recebe `local` por parâmetro (chama `exigeBancoLocal()` sem args, que lê o
    // `LOCAL` do módulo) — não dá pra "forçar" não-local nesta suíte sem mockar módulo. A prova
    // estrutural: um `Client` fake cujo `.query` lança se for chamado; ele SÓ deve ser invocado
    // quando `LOCAL` é true (o guard já passou) — nunca antes do guard, em NENHUM dos dois casos.
    const chamadas: string[] = [];
    const clienteFake = {
      query: async (sql: string) => {
        chamadas.push(sql);
        return { rows: [] };
      },
    } as unknown as Client;
    if (LOCAL) {
      await aplicarSql(clienteFake, "BEGIN;\nSELECT 1;\nCOMMIT;", "h");
      expect(chamadas).toContain("SAVEPOINT kanban_auto_prepara"); // passou do guard, chegou a .query
    } else {
      await expect(aplicarSql(clienteFake, "BEGIN;\nSELECT 1;\nCOMMIT;", "h")).rejects.toThrow(
        /só na cópia local — ver banco-local/,
      );
      expect(chamadas).toEqual([]); // guard barrou ANTES do 1º .query — nada tocou o banco
    }
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

// ─────────────────────────── Migration 1 — schema (Task 5) ───────────────────────────
const INDICES_NOVOS = [
  "idx_cad_tecidos_cad",
  "idx_cad_tecido_variantes_cad_tecido",
  "idx_cad_aviamentos_cad",
  "idx_cad_etiquetas_cad",
  "idx_modelo_aviamentos_modelo",
];

describe.skipIf(!PRONTO)("kanban-auto — migration 1: schema (Task 5)", () => {
  it("tenant_config.kanban_automatico: boolean NOT NULL default false e DESLIGADA em todas as lojas", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const col = await um<{ data_type: string; is_nullable: string; column_default: string }>(
        c,
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'kanban_automatico'`,
      );
      expect(col).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
      const n = await um<{ ligadas: string; total: string }>(
        c,
        `SELECT count(*) FILTER (WHERE kanban_automatico) AS ligadas, count(*) AS total FROM public.tenant_config`,
      );
      expect(Number(n.total)).toBeGreaterThanOrEqual(6);
      if (MIG_TXN) expect(n.ligadas).toBe("0");
    });
  });

  it("os 5 índices que faltavam existem", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const { rows } = await c.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY 1`,
        [INDICES_NOVOS],
      );
      expect(rows.map((r) => r.indexname)).toEqual([...INDICES_NOVOS].sort());
    });
  });

  it("histórico ganhou origem (linhas antigas = 'manual', CHECK nos 4 valores) e lote_id", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const r = await um<{ fora: string; sem_lote: string; total: string }>(
        c,
        `SELECT count(*) FILTER (WHERE origem <> 'manual') AS fora,
                count(*) FILTER (WHERE lote_id IS NULL) AS sem_lote, count(*) AS total
           FROM public.modelo_kanban_historico`,
      );
      if (MIG_TXN) {
        expect(r.fora).toBe("0");
        expect(r.sem_lote).toBe(r.total);
      }
      await c.query("SAVEPOINT chk");
      await expect(
        c.query(`UPDATE public.modelo_kanban_historico SET origem = 'xyz' WHERE id = (SELECT id FROM public.modelo_kanban_historico LIMIT 1)`),
      ).rejects.toMatchObject({ code: "23514" });
      await c.query("ROLLBACK TO SAVEPOINT chk");
    });
  });

  it("kanban_recalculo_fila e kanban_snapshot: RLS ligada, SEM policy, SEM grant p/ anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      for (const t of ["kanban_recalculo_fila", "kanban_snapshot"]) {
        const r = await um<{ rls: boolean; pols: string; anon: boolean; auth: boolean }>(
          c,
          `SELECT c.relrowsecurity AS rls,
                  (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS pols,
                  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
                  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth
             FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`,
          [t],
        );
        expect(r, t).toEqual({ rls: true, pols: "0", anon: false, auth: false });
      }
    });
  });

  it.skipIf(!MIG_TXN)("idempotente: aplicar a migration 1 de novo não falha nem duplica nada", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await aplicarArquivo(c, MIGRACOES[0]);
      const r = await um<{ n: string }>(
        c,
        `SELECT count(*) AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
        [INDICES_NOVOS],
      );
      expect(r.n).toBe("5");
    });
  });
});

// ─────────────────────────── Inverso 1 (Task 6) ───────────────────────────
async function retratoSchema1(c: Client) {
  const cols = await c.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('tenant_config', 'modelo_kanban_historico')
      ORDER BY table_name, column_name`,
  );
  const idx = await c.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND tablename IN ('cad_tecidos','cad_tecido_variantes','cad_aviamentos','cad_etiquetas','modelo_aviamentos')
      ORDER BY 1`,
  );
  const tabs = await um<{ fila: string | null; snap: string | null }>(
    c,
    `SELECT to_regclass('public.kanban_recalculo_fila')::text AS fila, to_regclass('public.kanban_snapshot')::text AS snap`,
  );
  return { cols: cols.rows, idx: idx.rows, tabs };
}

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — inverso da migration 1 (Task 6)", () => {
  it("aplica 1 e desfaz com o inverso: colunas, índices e tabelas voltam ao retrato de antes", async () => {
    await withTx(async (c) => {
      const antes = await retratoSchema1(c);
      await prepara(c, 1);
      expect((await retratoSchema1(c)).tabs.fila).toBe("kanban_recalculo_fila");
      await aplicarArquivo(c, INVERSOS[1]);
      expect(await retratoSchema1(c)).toEqual(antes);
      await aplicarArquivo(c, INVERSOS[1]); // idempotente
    });
  });
});
