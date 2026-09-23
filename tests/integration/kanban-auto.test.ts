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

// ─────────────────── Migration 2A — _kanban_status_rows_raw (Task 7) ───────────────────
type LinhaBoard = { key: string; lbl: string };

async function boardSql(c: Client, raw: unknown): Promise<LinhaBoard[]> {
  const { rows } = await c.query(
    `SELECT key, lbl FROM public._kanban_status_rows_raw($1::jsonb) ORDER BY ord`,
    [raw === undefined ? null : JSON.stringify(raw)],
  );
  return rows;
}
const boardTs = (raw: unknown): LinhaBoard[] => normalizeKanbanStatuses(raw).map((s) => ({ key: s.key, lbl: s.label }));

// Divergências CONHECIDAS e aceitas (a F1 NÃO muda a saída de hoje): (1) elemento ARRAY dentro de
// status_kanban vira {key:'',label:''} no TS (typeof [] === 'object') e é descartado no SQL;
// (2) objeto SEM label/nome/name mas com id/value/slug: o TS usa a key como label, o SQL devolve
// lbl=''. Só a KEY entra na derivação — nos sintéticos a comparação é por key; nos boards REAIS
// (todos strings) é key+label. Nenhuma loja tem (1) ou (2).
const BOARDS_SINTETICOS: unknown[] = [
  null,
  [],
  "nao-e-array",
  { a: 1 },
  ["Em Modelagem", "Stand By", "Aprovado"],
  ["Prova de Roupa ", "  Stand By  ", "Corte de Piloto II", "Coleção Verão", "Ação/Reação"],
  ["Em Modelagem", "em_modelagem", "Em Modelagem"],
  [{ key: "aprovado", label: "Aprovado" }, { label: "Em Ajuste" }, { nome: "Stand By" }, { id: "x_1", name: "X" }, { value: "v" }, { slug: "s" }],
  [42, null, true, "Aprovado"],
];

describe.skipIf(!PRONTO)("kanban-auto — migration 2A: _kanban_status_rows_raw (Task 7)", () => {
  it("_kanban_status_rows devolve EXATAMENTE o mesmo de antes nas lojas reais", async () => {
    await withTx(async (c) => {
      const { rows: lojas } = await c.query(`SELECT tenant_id, status_kanban FROM public.tenant_config ORDER BY tenant_id`);
      const antes: Record<string, unknown[]> = {};
      for (const l of lojas) antes[l.tenant_id] = (await c.query(`SELECT * FROM public._kanban_status_rows($1)`, [l.tenant_id])).rows;
      await prepara(c, 2);
      for (const l of lojas) {
        const depois = (await c.query(`SELECT * FROM public._kanban_status_rows($1)`, [l.tenant_id])).rows;
        expect(depois, l.tenant_id).toEqual(antes[l.tenant_id]);
        const raw = (await c.query(`SELECT * FROM public._kanban_status_rows_raw($1::jsonb)`, [JSON.stringify(l.status_kanban)])).rows;
        expect(raw, l.tenant_id).toEqual(depois);
      }
    });
  });

  it("anti-drift: normalizeKanbanStatuses (TS) ≡ _kanban_status_rows_raw (SQL) nos boards REAIS das lojas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const { rows: lojas } = await c.query(`SELECT tenant_id, status_kanban FROM public.tenant_config ORDER BY tenant_id`);
      expect(lojas.length).toBeGreaterThanOrEqual(6);
      for (const l of lojas) expect(await boardSql(c, l.status_kanban), l.tenant_id).toEqual(boardTs(l.status_kanban));
    });
  });

  it("anti-drift: … e as KEYS em boards sintéticos (nulo, vazio, não-array, espaço final, acento, duplicado, objetos, lixo)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      for (const b of BOARDS_SINTETICOS) {
        expect((await boardSql(c, b)).map((x) => x.key), JSON.stringify(b)).toEqual(boardTs(b).map((x) => x.key));
      }
    });
  });
});

// ─────────────── Migration 2B — derivação pura: ANTI-DRIFT TS × SQL (Task 8) ───────────────
type Entrada = { fluxo: string[]; reqs: Record<string, string[]>; exc: Record<string, string[]>; cond: Record<string, boolean>; status: string | null; derivavel: boolean };
const argsPuros = (i: Entrada) => [i.fluxo, JSON.stringify(i.reqs), JSON.stringify(i.exc), JSON.stringify(i.cond), i.status, i.derivavel];

async function derivarSql(c: Client, i: Entrada) {
  return (await um<{ d: unknown }>(c,
    `SELECT public._kanban_derivar_puro($1::text[], $2::jsonb, $3::jsonb, $4::jsonb, $5, $6) AS d`, argsPuros(i))).d;
}
async function dropSql(c: Client, i: Entrada, para: string) {
  return (await um<{ d: unknown }>(c,
    `SELECT public._kanban_destino_drop_puro($1::text[], $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7) AS d`, [...argsPuros(i), para])).d;
}
async function faltandoSql(c: Client, i: Entrada, para: string) {
  return (await um<{ f: string[] }>(c,
    `SELECT public._kanban_faltando_para($1::text[], $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7) AS f`, [...argsPuros(i), para])).f;
}

describe.skipIf(!PRONTO)("kanban-auto — migration 2B: anti-drift TS×SQL com as fixtures (Task 8)", () => {
  it("_kanban_derivar_puro ≡ fixture ≡ statusDerivado, e _kanban_destino_drop_puro ≡ fixture ≡ destinoDrop (TODOS os casos)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      for (const caso of CASOS) {
        expect(await derivarSql(c, caso.input), caso.nome).toEqual(caso.esperado);
        expect(statusDerivado(caso.input), `${caso.nome} (TS)`).toEqual(caso.esperado);
        for (const a of caso.arrastes) {
          const esperado = { acao: a.acao, status: a.status, faltando: a.faltando };
          expect(await dropSql(c, caso.input, a.para), `${caso.nome} → ${a.para}`).toEqual(esperado);
          expect(destinoDrop(caso.input, a.para), `${caso.nome} → ${a.para} (TS)`).toEqual(esperado);
        }
      }
    });
  });

  it("_kanban_faltando_para ≡ faltandoPara (exceção, dedup/ordem, nada falha, antes da 1ª falha)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const exc: Entrada = { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a", derivavel: true };
      const dedup: Entrada = {
        fluxo: ["entrada", "a", "b", "stand_by", "c", "reprovado", "d"],
        reqs: { a: ["x"], b: ["y"], c: ["z", "x"], d: ["w"] }, exc: {}, cond: {}, status: null, derivavel: true,
      };
      const casos: [Entrada, string][] = [
        [exc, "c"], [exc, "a"], [{ ...exc, cond: { x: true, y: true, z: true } }, "c"], [dedup, "c"], [dedup, "d"], [dedup, "zzz"],
      ];
      for (const [i, para] of casos) {
        expect(await faltandoSql(c, i, para), `${JSON.stringify(i.cond)} → ${para}`).toEqual(faltandoPara(i, para));
      }
      expect(await faltandoSql(c, exc, "c")).toEqual(["y"]);
      expect(await faltandoSql(c, dedup, "c")).toEqual(["x", "y", "z"]);
    });
  });

  it("_kanban_fluxo ≡ boardDaLoja/fluxoDoModelo (config sintética com lixo + configs REAIS das lojas)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const sintetica = {
        status_kanban: ["Em Modelagem", "Stand By", "Em Modelagem", { key: "aprovado", label: "Aprovado" }, 42],
        revenda_kanban_colunas: ["stand_by", "aprovado", 7],
      };
      const { rows: reais } = await c.query(`SELECT tenant_id, status_kanban, revenda_kanban_colunas FROM public.tenant_config`);
      for (const cfgRaw of [sintetica, ...reais, { status_kanban: [] }, {}]) {
        const cfg = lerKanbanAutoConfig(cfgRaw);
        for (const origem of ["interno", "revenda", "importado"]) {
          const sql = (await um<{ f: string[] }>(c, `SELECT public._kanban_fluxo($1::jsonb, $2) AS f`,
            [JSON.stringify(cfgRaw), origem !== "interno"])).f;
          expect(sql, `${JSON.stringify(cfgRaw).slice(0, 60)} ${origem}`).toEqual(fluxoDoModelo(origem, cfg).map((k) => k.key));
        }
        const board = (await um<{ f: string[] }>(c, `SELECT public._kanban_fluxo($1::jsonb, false) AS f`, [JSON.stringify(cfgRaw)])).f;
        expect(board).toEqual(boardDaLoja(cfg).map((k) => k.key));
      }
    });
  });

  it("puras: _kanban_norm/_kanban_lista/_kanban_coluna_manual/_kanban_req_efetivos (reprovado sempre manual)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const r = await um<Record<string, unknown>>(c, `SELECT
          public._kanban_norm('  Stand_By ') AS norm,
          public._kanban_lista('["a", 1, null, "b", {"x":1}]'::jsonb) AS lista,
          public._kanban_lista('{"a":1}'::jsonb) AS lista_obj,
          public._kanban_coluna_manual('Reprovado', '{"reprovado":["x"]}'::jsonb) AS rep,
          public._kanban_coluna_manual('a', '{"a":["x"]}'::jsonb) AS auto,
          public._kanban_coluna_manual('a', '{"a":"nao-e-array"}'::jsonb) AS lixo,
          public._kanban_req_efetivos('c', ARRAY['a','b','c'], '{"a":["x"],"b":["y"],"c":["z","x"]}'::jsonb, '{"c":["y"]}'::jsonb) AS efet`);
      expect(r).toEqual({ norm: "stand_by", lista: ["a", "b"], lista_obj: [], rep: true, auto: false, lixo: true, efet: ["x", "z"] });
    });
  });
});

// ──────────── Migration 2C — config, chave, derivação em LOTE e gate (Task 9) ────────────
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";

describe.skipIf(!PRONTO)("kanban-auto — migration 2C: _kanban_derivar_lote / _kanban_status_gate (Task 9)", () => {
  it("_kanban_cfg espelha tenant_config; _kanban_ligado = false e _kanban_status_gate = status gravado (chave desligada)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const { rows: lojas } = await c.query(
        `SELECT tenant_id, kanban_automatico, status_kanban, kanban_requisitos, kanban_requisitos_excecoes,
                revenda_kanban_colunas, revenda_kanban_requisitos FROM public.tenant_config ORDER BY tenant_id`,
      );
      for (const l of lojas) {
        const cfg = (await um<{ c: any }>(c, `SELECT public._kanban_cfg($1) AS c`, [l.tenant_id])).c;
        expect(cfg.status_kanban, l.tenant_id).toEqual(l.status_kanban);
        expect(cfg.kanban_requisitos).toEqual(l.kanban_requisitos);
        expect(cfg.kanban_requisitos_excecoes).toEqual(l.kanban_requisitos_excecoes);
        expect(cfg.revenda_kanban_colunas).toEqual(l.revenda_kanban_colunas);
        expect(cfg.revenda_kanban_requisitos).toEqual(l.revenda_kanban_requisitos);
        expect((await um<{ v: boolean }>(c, `SELECT public._kanban_ligado($1) AS v`, [l.tenant_id])).v).toBe(l.kanban_automatico);
      }
      const { rows: ms } = await c.query(
        `SELECT m.id, m.tenant_id, m.status_desenvolvimento FROM public.modelos m
           JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND NOT tc.kanban_automatico LIMIT 50`,
      );
      for (const m of ms) {
        const g = await um<{ g: string | null }>(c, `SELECT public._kanban_status_gate($1, $2, $3) AS g`, [m.tenant_id, m.id, m.status_desenvolvimento]);
        expect(g.g).toBe(m.status_desenvolvimento);
      }
      expect((await um<{ c: unknown }>(c, `SELECT public._kanban_cfg('00000000-0000-0000-0000-000000000000') AS c`)).c).toBeNull();
    });
  });

  it("anti-drift em DADO REAL: _kanban_derivar_lote ≡ derivarModelo (TS) em TODOS os modelos de TODAS as lojas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const { rows: lojas } = await c.query(`SELECT * FROM public.tenant_config ORDER BY tenant_id`);
      for (const l of lojas) {
        const cfg = lerKanbanAutoConfig(l);
        const { rows: mods } = await c.query(
          `SELECT id, origem, status_desenvolvimento, ordem_criacao_enviada, lancado FROM public.modelos WHERE tenant_id = $1`,
          [l.tenant_id],
        );
        const elegiveis = mods.filter((m) => m.ordem_criacao_enviada && !m.lancado).map((m) => m.id);
        const cond = elegiveis.length
          ? (await um<{ c: Record<string, Record<string, boolean>> }>(c,
              `SELECT public._avaliar_condicoes_kanban_core($1, $2::uuid[]) AS c`, [l.tenant_id, elegiveis])).c
          : {};
        const { rows: lote } = await c.query(`SELECT * FROM public._kanban_derivar_lote($1, NULL)`, [l.tenant_id]);
        expect(lote.length, l.tenant_id).toBe(mods.length);
        for (const m of mods) {
          const s = lote.find((x) => x.modelo_id === m.id);
          const sql = {
            derivavel: s.derivavel, entrada: s.entrada, alvo: s.alvo, resultado: s.resultado,
            fixado: s.fixado, primeiraFalha: s.primeira_falha, faltando: s.faltando,
          };
          expect(sql, `${l.tenant_id} ${m.id}`).toEqual(derivarModelo(m, cfg, cond[m.id] ?? {}));
        }
      }
    });
  });

  it("desempenho: derivação da maior loja (Ave Rara, ~250 modelos) em < 3 s — 1 chamada ao core por lote", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const t0 = Date.now();
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM public._kanban_derivar_lote($1, NULL) WHERE derivavel`, [AVE_RARA]);
      const ms = Date.now() - t0;
      console.info(`[kanban-auto] _kanban_derivar_lote Ave Rara: ${r.n} deriváveis em ${ms} ms`);
      expect(ms).toBeLessThan(3000);
    });
  });
});

// ─────────────────────────── Inverso 2 (Task 9) ───────────────────────────
const FUNCOES_M2 = [
  "_kanban_status_rows_raw(jsonb)", "_kanban_norm(text)", "_kanban_lista(jsonb)", "_kanban_coluna_manual(text,jsonb)",
  "_kanban_req_efetivos(text,text[],jsonb,jsonb)", "_kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)",
  "_kanban_faltando_para(text[],jsonb,jsonb,jsonb,text,boolean,text)",
  "_kanban_destino_drop_puro(text[],jsonb,jsonb,jsonb,text,boolean,text)", "_kanban_fluxo(jsonb,boolean)",
  "_kanban_cfg(uuid)", "_kanban_ligado(uuid)", "_kanban_derivar_lote(uuid,uuid[],jsonb)", "_kanban_status_gate(uuid,uuid,text)",
];
async function defFuncao(c: Client, assinatura: string): Promise<string | null> {
  return (await um<{ d: string | null }>(c,
    `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE pg_get_functiondef(to_regprocedure($1)) END AS d`,
    ["public." + assinatura])).d;
}

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — inverso da migration 2 (Task 9)", () => {
  it("desfaz 2: _kanban_status_rows volta BYTE-A-BYTE e as 13 funções novas somem", async () => {
    await withTx(async (c) => {
      const antes = await defFuncao(c, "_kanban_status_rows(uuid)");
      await prepara(c, 2);
      expect(await defFuncao(c, "_kanban_status_rows(uuid)")).not.toBe(antes);
      await aplicarArquivo(c, INVERSOS[2]);
      expect(await defFuncao(c, "_kanban_status_rows(uuid)")).toBe(antes);
      for (const f of FUNCOES_M2) expect(await defFuncao(c, f), f).toBeNull();
      await aplicarArquivo(c, INVERSOS[1]);
    });
  });
});

// ─────────────────── Helpers do motor (Tasks 10–16) ───────────────────
const T = TENANT_TESTE;
const HOJE = "2026-09-01";
// Board sintético da Loja Teste (reescrito DENTRO da txn): entrada(manual) · etapa_a{ddt} · etapa_b{p1} ·
// stand_by(manual) · etapa_c{p2} · reprovado(manual) · aprovado{dap}. Keys: normalizeKanbanStatuses.
const BOARD = ["Entrada", "Etapa A", "Etapa B", "Stand By", "Etapa C", "Reprovado", "Aprovado"];
const REQS: Record<string, string[]> = {
  etapa_a: ["data_desenho_tecnico"], etapa_b: ["data_piloto1"], etapa_c: ["data_piloto2"], aprovado: ["data_aprovacao"],
};

/** Desliga a chave e reescreve a config da Loja Teste NA TXN (ligar é sempre explícito: `chave`). */
async function configurarBoard(c: Client, opts: { reqs?: Record<string, string[]>; exc?: Record<string, string[]>; ref?: string; explosao?: string } = {}) {
  await chave(c, false); // antes do board: com a chave ligada, mudar o board gravaria um lote 'config'
  await c.query(
    `UPDATE public.tenant_config
        SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = $4::jsonb,
            revenda_kanban_colunas = '[]'::jsonb, revenda_kanban_requisitos = '{}'::jsonb,
            ref_exibir_status = $5, explosao_envio_status = $6
      WHERE tenant_id = $1`,
    [T, JSON.stringify(BOARD), JSON.stringify(opts.reqs ?? REQS), JSON.stringify(opts.exc ?? {}), opts.ref ?? "etapa_c", opts.explosao ?? "etapa_c"],
  );
}
/** Liga/desliga a chave da Loja Teste como a RPC `kanban_definir_automatico` faz: GUC transação-local
 *  `app.kanban_chave='rpc'` (sem ele, `trg_kanban_chave_protegida` mantém o valor — decisão 16). */
async function chave(c: Client, ligada: boolean) {
  await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
  try {
    await c.query(`UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1`, [T, ligada]);
  } finally {
    await c.query(`SELECT set_config('app.kanban_chave', '', true)`);
  }
}
/** Escritas de PREPARAÇÃO do teste que não devem acionar enfileirador/guard (GUC não vazio). */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query(`SELECT set_config('app.kanban_sistema', 'teste', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.kanban_sistema', '', true)`);
  }
}
async function novoModelo(c: Client, campos: Record<string, unknown> = {}): Promise<string> {
  const base = await um<{ c: string | null; s: string | null }>(c,
    `SELECT categoria_principal_id AS c, subcategoria1_id AS s FROM public.modelos
      WHERE tenant_id = $1 AND categoria_principal_id IS NOT NULL AND subcategoria1_id IS NOT NULL LIMIT 1`, [T]);
  const cols: Record<string, unknown> = {
    tenant_id: T, nome: "KA teste", ordem_criacao_enviada: true, status_desenvolvimento: "entrada",
    categoria_principal_id: base?.c ?? null, subcategoria1_id: base?.s ?? null, ...campos,
  };
  const nomes = Object.keys(cols);
  const r = await um<{ id: string }>(c,
    `INSERT INTO public.modelos (${nomes.join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(cols));
  return r.id;
}
async function setar(c: Client, id: string, campos: Record<string, unknown>) {
  const nomes = Object.keys(campos);
  await c.query(`UPDATE public.modelos SET ${nomes.map((n, i) => `${n} = $${i + 2}`).join(", ")} WHERE id = $1`,
    [id, ...Object.values(campos)]);
}
async function lerModelo(c: Client, id: string) {
  const r = await um<{ status: string | null; rp: Record<string, unknown>; ref: string | null; ref_auto: string | null; rev: number; motivo: string | null }>(c,
    `SELECT status_desenvolvimento AS status, revisao_pendente AS rp, ref, ref_auto, rev, motivo_cancelamento AS motivo
       FROM public.modelos WHERE id = $1`, [id]);
  return { ...r, erro: r.rp?.kanban === true };
}
async function historico(c: Client, id: string): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT status, origem FROM public.modelo_kanban_historico WHERE modelo_id = $1 ORDER BY entrou_at, created_at`, [id]);
  return rows.map((r) => `${r.status}:${r.origem}`);
}
async function tamanhoFila(c: Client): Promise<number> {
  return Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.kanban_recalculo_fila`)).n);
}
async function envelhecerHistorico(c: Client, id: string) {
  await c.query(`UPDATE public.modelo_kanban_historico SET entrou_at = entrou_at - interval '1 minute' WHERE modelo_id = $1`, [id]);
}
/** Simula o COMMIT p/ o constraint trigger adiado e volta ao modo adiado. */
async function imediato(c: Client) {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function comoSemPermissao(c: Client, uid = "00000000-0000-4000-8000-00000000ab01") {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(`INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, 'KA Sem Perm')
                 ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [uid, T, `${uid}@teste`]);
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
async function guc(c: Client, valor: string) {
  await c.query(`SELECT set_config('app.kanban_sistema', $1, true)`, [valor]);
}

// ─────────────────── Migration 3A — histórico com origem e janela (Task 10) ───────────────────
describe.skipIf(!PRONTO)("kanban-auto — migration 3A: fn_kanban_historico (Task 10)", () => {
  it("escrita de fora do motor SEMPRE insere, com origem 'manual' (inclusive o INSERT do modelo)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await novoModelo(c);
      await setar(c, M, { status_desenvolvimento: "stand_by" });
      await setar(c, M, { status_desenvolvimento: "entrada" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "stand_by:manual", "entrada:manual"]);
    });
  });

  it("'auto' na janela de 10 s: ATUALIZA a última; voltar à penúltima APAGA; fora da janela INSERE", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await novoModelo(c);
      await guc(c, "auto");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:auto"]); // última não era auto → insere
      await setar(c, M, { status_desenvolvimento: "etapa_c" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_c:auto"]); // colapsa (atualiza)
      await setar(c, M, { status_desenvolvimento: "entrada" });
      expect(await historico(c, M)).toEqual(["entrada:manual"]); // voltou à penúltima → o transitório nunca existiu
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await envelhecerHistorico(c, M);
      await setar(c, M, { status_desenvolvimento: "etapa_b" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:auto", "etapa_b:auto"]); // fora da janela → insere
      await guc(c, "");
    });
  });

  it("'config'/'restauracao'/'manual' nunca colapsam e gravam o lote do GUC app.kanban_lote", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await novoModelo(c);
      const lote = "11111111-2222-4333-8444-555555555555";
      await c.query(`SELECT set_config('app.kanban_lote', $1, true)`, [lote]);
      await guc(c, "config");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await setar(c, M, { status_desenvolvimento: "etapa_b" });
      await guc(c, "restauracao");
      await setar(c, M, { status_desenvolvimento: "entrada" });
      await guc(c, "");
      await c.query(`SELECT set_config('app.kanban_lote', '', true)`);
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:config", "etapa_b:config", "entrada:restauracao"]);
      const { rows } = await c.query(
        `SELECT lote_id FROM public.modelo_kanban_historico WHERE modelo_id = $1 AND origem <> 'manual'`, [M]);
      expect(rows.every((r) => r.lote_id === lote)).toBe(true);
      // D14 (dono, 23/set): 'restauracao' p/ o status que a ÚLTIMA linha restante já tem NÃO insere
      // (kanban_restaurar apaga antes as linhas auto/config do lote — simulado aqui apagando a última)
      await guc(c, "config");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await c.query(
        `DELETE FROM public.modelo_kanban_historico WHERE id = (SELECT id FROM public.modelo_kanban_historico
          WHERE modelo_id = $1 ORDER BY entrou_at DESC, created_at DESC LIMIT 1)`, [M]);
      await guc(c, "restauracao");
      await setar(c, M, { status_desenvolvimento: "entrada" });
      await guc(c, "");
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:config", "etapa_b:config", "entrada:restauracao"]);
    });
  });
});

// ─────────────── Migration 3B — fila adiada, _kanban_aplicar e #Erro (Task 11) ───────────────
async function aplicar(c: Client, ids: string[] | null, origem = "auto"): Promise<number> {
  return (await um<{ n: number }>(c, `SELECT public._kanban_aplicar($1, $2::uuid[], $3) AS n`, [T, ids, origem])).n;
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3B: fila + _kanban_aplicar (Task 11)", () => {
  it("chave DESLIGADA: _kanban_aplicar devolve 0 e não muda nada; _kanban_enfileirar não insere", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE }));
      expect(await aplicar(c, [M])).toBe(0);
      expect(await aplicar(c, null, "config")).toBe(0);
      await c.query(`SELECT public._kanban_enfileirar(ARRAY[$1]::uuid[])`, [M]);
      expect(await tamanhoFila(c)).toBe(0);
      expect((await lerModelo(c, M)).status).toBe("entrada");
    });
  });

  it("fila ADIADA: entrar na fila não muda nada até o COMMIT; no COMMIT deriva o lote e esvazia", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      await c.query(`INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`, [M, T]);
      expect((await lerModelo(c, M)).status).toBe("entrada");
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      expect(await tamanhoFila(c)).toBe(0);
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:auto"]);
    });
  });

  it("cascata: avança só até a última automática satisfeita ANTES da 1ª que falha (não pula); GUC volta ao anterior", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto2: HOJE }));
      expect(await aplicar(c, [M])).toBe(1);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // c satisfeita, b não → preso antes de b
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE }));
      await aplicar(c, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_c"); // stand_by (manual) é pulada
      expect(await aplicar(c, [M])).toBe(0); // nada muda → não grava
      const g = await um<{ s: string; l: string }>(c,
        `SELECT current_setting('app.kanban_sistema', true) AS s, current_setting('app.kanban_lote', true) AS l`);
      expect(g).toEqual({ s: "", l: "" });
    });
  });

  it("exceção configurada NÃO pula coluna no motor (G-inicial #3): etapa_c ignora data_piloto1, mas etapa_b ainda exige", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { exc: { etapa_c: ["data_piloto1"] } });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto2: HOJE }));
      await aplicar(c, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // etapa_c estaria "satisfeita", mas etapa_b falha antes
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE }));
      await aplicar(c, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("#Erro (decisão 14): com a chave ligada o motor NUNCA acende nem apaga — recuo só devolve o card à coluna devida", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE, data_piloto2: HOJE }));
      await aplicar(c, [M]); // → etapa_c
      await envelhecerHistorico(c, M); // fora da janela de 10 s: recuo "real"
      await comoSistema(c, () => setar(c, M, { data_piloto1: null }));
      await aplicar(c, [M]);
      let m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_a", false]); // volta p/ a coluna devida, SEM #Erro
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE }));
      await aplicar(c, [M]); // → etapa_c
      await comoSistema(c, () => setar(c, M, { data_desenho_tecnico: null }));
      await aplicar(c, [M]); // recuo dentro da janela: idem
      m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["entrada", false]);
      // #Erro LEGADO (aceso quando a chave estava desligada) o motor não apaga: só o kanban_mover (Task 15) — D20
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET revisao_pendente = '{"kanban": true}' WHERE id = $1`, [M]));
      await comoSistema(c, () => setar(c, M, { data_desenho_tecnico: HOJE }));
      await aplicar(c, [M]); // avanço 'auto'
      m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_c", true]);
      await comoSistema(c, () => setar(c, M, { data_piloto1: null }));
      await aplicar(c, [M], "config"); // recuo por 'config': também não mexe
      m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_a", true]);
      expect((await historico(c, M)).at(-1)).toBe("etapa_a:config");
    });
  });

  it("fixado não anda; a REF dele é revelada quando a POSIÇÃO DERIVADA atinge ref_exibir_status", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { ref: "etapa_c" });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { status_desenvolvimento: "stand_by", data_desenho_tecnico: HOJE }));
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET ref = '' WHERE id = $1`, [M]));
      await aplicar(c, [M]);
      let m = await lerModelo(c, M);
      expect([m.status, m.ref ?? ""]).toEqual(["stand_by", ""]); // derivada = etapa_a < etapa_c
      expect(m.ref_auto ?? "").not.toBe("");
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE, data_piloto2: HOJE }));
      expect(await aplicar(c, [M])).toBe(0); // status não muda…
      m = await lerModelo(c, M);
      expect(m.status).toBe("stand_by");
      expect(m.ref).toBe(m.ref_auto); // …mas a REF é revelada
    });
  });

  // DDL próprio (sabotagem com CREATE OR REPLACE FUNCTION) → SÓ na cópia local (decisão 17), mesmo sem KANBAN_AUTO_MIG_TXN
  it.skipIf(!LOCAL)("erro na derivação vira WARNING: NÃO derruba o COMMIT e a fila esvazia", async () => {
    await withTx(async (c) => {
      const avisos: string[] = [];
      const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
      c.on("notice", ouvir);
      try {
        await prepara(c, 3);
        await configurarBoard(c);
        await chave(c, true);
        const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
        // sabotagem SÓ nesta txn (revertida): o motor passa a lançar erro
        await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                       RETURNS integer LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'sabotagem de teste'; END $f$`);
        await c.query(`INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [M, T]);
        await imediato(c); // não lança
        expect(avisos.some((a) => /recálculo ignorado/.test(a) && /sabotagem de teste/.test(a))).toBe(true);
        expect(await tamanhoFila(c)).toBe(0);
        expect((await lerModelo(c, M)).status).toBe("entrada");
      } finally {
        c.off("notice", ouvir);
      }
    });
  });

  // Fix round 1 (achado Important): WHEN OTHERS NÃO pega query_canceled (57014, de statement_timeout);
  // um lock esperando por outra conexão precisa estourar como lock_not_available (55P03, capturável)
  // ANTES do statement_timeout — daí o `SET lock_timeout TO '2s'` na própria função. SÓ na cópia local
  // (2ª conexão de verdade); sem KANBAN_AUTO_MIG_TXN não faz sentido (a trigger nova não existiria).
  //
  // Nota de design: a trava do brief pedia literalmente `SELECT … FOR UPDATE` numa linha de `modelos`
  // a partir de uma 2ª conexão. Isso é estruturalmente IMPOSSÍVEL de reproduzir aqui: `modelo_id` em
  // `kanban_recalculo_fila` é FK p/ `modelos(id)`, e QUALQUER INSERT nessa fila (inclusive o que a
  // própria `c` precisa fazer p/ enfileirar o modelo-alvo) exige um `FOR KEY SHARE` implícito na linha
  // referenciada — que fica retido pela transação de `c` (a `withTx` sob teste) até o ROLLBACK final,
  // não só durante o INSERT. Provado com 4 sondas isoladas (probe.mjs) fora deste arquivo: uma vez que
  // `c` segura esse `FOR KEY SHARE`, NENHUMA outra conexão consegue `FOR UPDATE`/`FOR NO KEY UPDATE`
  // na MESMA linha enquanto a txn de `c` seguir aberta — não importa a ORDEM das chamadas (a 2ª
  // conexão simplesmente FICA PENDURADA até o ROLLBACK de `c`, que é exatamente o que aconteceu na
  // 1ª tentativa desta prova: timeout de teste, não do banco). E a própria `c`, na MESMA sessão/txn,
  // nunca fica presa no seu PRÓPRIO `FOR KEY SHARE` (escalonamento de lock intra-transação nunca
  // bloqueia a si mesmo) — confirmado que o `UPDATE` de `c` sobre a MESMA linha, mesmo com uma 2ª
  // conexão já enfileirada esperando `FOR UPDATE`, retorna em ~4 ms, sem jamais dar à 2ª conexão uma
  // janela de contenção real.
  //
  // Substituto EQUIVALENTE, sem esse impasse: em vez de travar a LINHA de `modelos`, a 2ª conexão
  // prende um `pg_advisory_xact_lock` (mesmo mecanismo de espera, MESMO `lock_timeout`/`55P03` na
  // colisão — provado isoladamente: `pg_advisory_xact_lock` bloqueado por 2 s dá EXATAMENTE
  // `lock_not_available`/`55P03`, idêntico a um lock de linha) — sem NENHUM vínculo de FK, então não
  // há trava cruzada com o próprio `INSERT` de `c` na fila. `_kanban_aplicar` é sabotado (SÓ na cópia
  // local — mesmo padrão já usado no teste "erro na derivação vira WARNING" acima, `CREATE OR REPLACE
  // FUNCTION` dentro da txn revertida) p/ pedir esse MESMO advisory lock logo no início — reproduzindo
  // fielmente "uma espera de lock DENTRO do que `fn_kanban_processar_fila` chama" e provando que o
  // `SET lock_timeout TO '2s'` da função (Step 3) se aplica MESMO durante o disparo adiado do
  // constraint trigger (não herda um `lock_timeout` desligado/maior da txn externa).
  it.skipIf(!LOCAL)("lock concorrente (advisory, mesmo mecanismo de 55P03 de um lock de linha) no drenar vira WARNING — NÃO derruba o COMMIT do usuário", async () => {
    const CHAVE_ADVISORY = 918273465; // arbitrária; só precisa ser a MESMA nas 2 conexões
    const segunda = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await segunda.connect();
    try {
      await withTx(async (c) => {
        const avisos: string[] = [];
        const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
        c.on("notice", ouvir);
        try {
          await prepara(c, 3);
          await configurarBoard(c);
          await chave(c, true);
          const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));

          // Sabotagem SÓ nesta txn (revertida): `_kanban_aplicar` passa a pedir o MESMO advisory lock
          // que a 2ª conexão já segura, ANTES de fazer qualquer coisa — reproduz "uma espera de lock
          // dentro do que a trigger chama", sem tocar `modelos` (sem o impasse de FK documentado acima).
          await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                         RETURNS integer LANGUAGE plpgsql AS $f$
                         BEGIN
                           PERFORM pg_advisory_xact_lock(${CHAVE_ADVISORY});
                           RETURN 0;
                         END $f$`);

          // Só AGORA a 2ª conexão prende a trava conflitante, numa transação própria aberta (nunca
          // comitada aqui — segura o lock até o ROLLBACK do `finally`).
          await segunda.query("BEGIN");
          await segunda.query("SELECT pg_advisory_xact_lock($1)", [CHAVE_ADVISORY]);

          await c.query(`DELETE FROM public.kanban_recalculo_fila`);
          await c.query(`INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`, [M, T]);

          // Sobe o lock_timeout da TXN EXTERNA bem acima de 2s — se o `imediato()` abaixo ainda assim
          // resolver perto de ~2s (e não perto do valor daqui, nem do statement_timeout de 120s), é
          // porque o `SET lock_timeout TO '2s'` DENTRO da própria função (Step 3) está mandando, não
          // herdando o lock_timeout da transação que disparou o COMMIT/`imediato`.
          await c.query(`SET LOCAL lock_timeout = '30s'`);
          const t0 = Date.now();
          await imediato(c); // não lança — o lock_timeout de 2s DENTRO da função estoura ANTES do statement_timeout de 120s
          const ms = Date.now() - t0;
          expect(ms).toBeLessThan(10000); // não ficou preso até o lock_timeout de 30s da txn externa nem o statement_timeout
          expect(ms).toBeGreaterThanOrEqual(1900); // realmente esperou ~2s do lock_timeout DA FUNÇÃO (não herdou os 30s daqui)
          expect(avisos.some((a) => /recálculo ignorado/.test(a) && /55P03|lock/i.test(a))).toBe(true);
          expect(await tamanhoFila(c)).toBe(0);
          expect((await lerModelo(c, M)).status).toBe("entrada");
        } finally {
          c.off("notice", ouvir);
        }
      });
    } finally {
      await segunda.query("ROLLBACK").catch(() => {}); // libera a trava
      await segunda.end();
    }
  });

  it("origem inválida → P0001", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await expect(c.query(`SELECT public._kanban_aplicar($1, NULL, 'manual')`, [T])).rejects.toMatchObject({ code: "P0001" });
    });
  });
});

// ─────────────────── Migration 3E — enfileiradores (Task 12) ───────────────────
async function filaIds(c: Client): Promise<string[]> {
  return (await c.query(`SELECT modelo_id FROM public.kanban_recalculo_fila`)).rows.map((r) => r.modelo_id);
}
/** Um evento em CADA tabela-fonte das condições (13 + categorias). Cada item: [rótulo, sql, params]. */
async function eventosFonte(c: Client, M: string): Promise<[string, string, unknown[]][]> {
  const vt = await um<{ vid: string; aid: string }>(c, `SELECT id AS vid, artigo_id AS aid FROM public.variantes_tecido WHERE tenant_id = $1 LIMIT 1`, [T]);
  const av = await um<{ id: string }>(c, `SELECT id FROM public.aviamentos WHERE tenant_id = $1 LIMIT 1`, [T]);
  const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 AND ativo LIMIT 1`, [T]);
  return [
    ["modelos (coluna do WHEN)", `UPDATE public.modelos SET data_piloto3 = $2 WHERE id = $1`, [M, HOJE]],
    ["modelos.origem → revenda", `UPDATE public.modelos SET origem = 'revenda' WHERE id = $1`, [M]],
    ["modelos.origem → interno", `UPDATE public.modelos SET origem = 'interno' WHERE id = $1`, [M]],
    ["modelo_tecidos INSERT", `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido')`, [M, vt.aid]],
    ["modelo_tecido_variantes INSERT", `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem)
        SELECT id, $2, 1 FROM public.modelo_tecidos WHERE modelo_id = $1`, [M, vt.vid]],
    ["modelo_grades INSERT", `INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"P": 2}', 2)`, [M]],
    ["modelo_grades UPDATE", `UPDATE public.modelo_grades SET grade_total = 3 WHERE modelo_id = $1`, [M]],
    ["modelo_aviamentos INSERT", `INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero) VALUES ($1, $2, 1)`, [M, av.id]],
    ["modelo_aviamentos DELETE", `DELETE FROM public.modelo_aviamentos WHERE modelo_id = $1`, [M]],
    ["modelo_servico_mo INSERT", `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($3, $1, $2, 5)`, [M, cat.id, T]],
    ["cad INSERT", `INSERT INTO public.cad (modelo_id, tenant_id) VALUES ($1, $2)`, [M, T]],
    ["cad_tecidos INSERT", `INSERT INTO public.cad_tecidos (cad_id, artigo_id, numero, tipo) SELECT id, $2, 1, 'tecido' FROM public.cad WHERE modelo_id = $1`, [M, vt.aid]],
    ["cad_tecido_variantes INSERT", `INSERT INTO public.cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem)
        SELECT ct.id, $2, 1 FROM public.cad_tecidos ct JOIN public.cad c ON c.id = ct.cad_id WHERE c.modelo_id = $1`, [M, vt.vid]],
    ["cad_tecido_variantes UPDATE", `UPDATE public.cad_tecido_variantes SET quantidade_folhas = 2
        WHERE cad_tecido_id IN (SELECT ct.id FROM public.cad_tecidos ct JOIN public.cad c ON c.id = ct.cad_id WHERE c.modelo_id = $1)`, [M]],
    ["cad_aviamentos INSERT", `INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero) SELECT id, $2, 1 FROM public.cad WHERE modelo_id = $1`, [M, av.id]],
    ["cad_etiquetas INSERT", `INSERT INTO public.cad_etiquetas (cad_id) SELECT id FROM public.cad WHERE modelo_id = $1`, [M]],
    ["controle_qualidade INSERT", `INSERT INTO public.controle_qualidade (cad_id, tenant_id) SELECT id, $2 FROM public.cad WHERE modelo_id = $1`, [M, T]],
    ["controle_qualidade UPDATE", `UPDATE public.controle_qualidade SET status_pos = 'pendente' WHERE cad_id IN (SELECT id FROM public.cad WHERE modelo_id = $1)`, [M]],
    ["producao_terceirizados INSERT", `INSERT INTO public.producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id)
        SELECT id, $2, $3 FROM public.cad WHERE modelo_id = $1`, [M, T, cat.id]],
    ["cad UPDATE", `UPDATE public.cad SET enviado_corte = true WHERE modelo_id = $1`, [M]],
  ];
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3E: enfileiradores (Task 12)", () => {
  it("chave DESLIGADA: NENHUM evento em nenhuma tabela-fonte enfileira (fila vazia antes e depois do COMMIT)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c));
      for (const [nome, sql, params] of await eventosFonte(c, M)) {
        await c.query(sql, params);
        expect(await tamanhoFila(c), nome).toBe(0);
      }
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 LIMIT 1`, [T]);
      await c.query(`UPDATE public.categorias_terceirizado SET ativo = NOT ativo WHERE id = $1`, [cat.id]);
      expect(await tamanhoFila(c)).toBe(0);
      await imediato(c);
      expect(await tamanhoFila(c)).toBe(0);
      expect((await lerModelo(c, M)).status).toBe("entrada");
    });
  });

  it("chave LIGADA: cada tabela-fonte enfileira o modelo; coluna fora do WHEN (e escrita do sistema) não enfileira", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      for (const [nome, sql, params] of await eventosFonte(c, M)) {
        await c.query(`DELETE FROM public.kanban_recalculo_fila`);
        await c.query(sql, params);
        expect(await filaIds(c), nome).toContain(M);
      }
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      await setar(c, M, { observacoes_gerais: "fora do WHEN", revisao_pendente: { x: true } });
      expect(await tamanhoFila(c)).toBe(0);
      await comoSistema(c, () => setar(c, M, { data_piloto3: null }));
      expect(await tamanhoFila(c)).toBe(0);
      const N = await novoModelo(c, { ordem_criacao_enviada: false });
      expect(await filaIds(c)).not.toContain(N); // INSERT sem Ordem de Criação não entra
      const O = await novoModelo(c);
      expect(await filaIds(c)).toContain(O); // INSERT com Ordem de Criação entra
      await imediato(c);
      expect(await tamanhoFila(c)).toBe(0);
    });
  });

  it("categorias_terceirizado (etapa/nome/ativo) enfileira a LOJA inteira; `ordem` não", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 LIMIT 1`, [T]);
      await c.query(`UPDATE public.categorias_terceirizado SET ordem = ordem + 1 WHERE id = $1`, [cat.id]);
      expect(await tamanhoFila(c)).toBe(0);
      await c.query(`UPDATE public.categorias_terceirizado SET etapa = CASE WHEN etapa = 'pos_costura' THEN 'ate_costura' ELSE 'pos_costura' END WHERE id = $1`, [cat.id]);
      const elegiveis = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1 AND ordem_criacao_enviada AND NOT lancado`, [T]);
      expect(await tamanhoFila(c)).toBe(Number(elegiveis.n));
    });
  });

  it("motor por evento: avança/regride em cascata, reprovado SEMPRE manual, fixado não anda, colunas puladas sem linha", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { reqs: { ...REQS, reprovado: ["data_desenho_tecnico"] } });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      await setar(c, M, { data_desenho_tecnico: HOJE });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      await setar(c, M, { data_piloto2: HOJE });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // c sem b: não pula
      await setar(c, M, { data_piloto1: HOJE, data_aprovacao: HOJE });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("aprovado"); // reprovado (c/ requisito satisfeito) NUNCA é destino
      expect(await historico(c, M)).toEqual(["entrada:manual", "aprovado:auto"]); // janela: 1 linha auto, pulos sem linha
      await setar(c, M, { data_piloto1: null });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // regride p/ a última satisfeita antes de b
      expect((await lerModelo(c, M)).erro).toBe(false); // decisão 14: recuo automático não acende #Erro
      await setar(c, M, { data_piloto1: HOJE });
      await imediato(c);
      await setar(c, M, { status_desenvolvimento: "stand_by" }); // fixa (coluna manual)
      await imediato(c);
      await setar(c, M, { data_aprovacao: null, data_piloto2: null });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("stand_by"); // fixado não anda
    });
  });

  // DDL próprio (TEMP TABLE + função pg_temp + CREATE/DROP TRIGGER na fila) → SÓ na cópia local (decisão 17)
  it.skipIf(!LOCAL)("sem recursão: o UPDATE do motor não re-enfileira (1 inserção na fila, antes e depois do COMMIT)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      await c.query(`CREATE TEMP TABLE _ka_fila_log (profundidade int)`);
      await c.query(`CREATE FUNCTION pg_temp.fn_ka_fila_log() RETURNS trigger LANGUAGE plpgsql AS $f$
                     BEGIN INSERT INTO _ka_fila_log VALUES (pg_trigger_depth()); RETURN NULL; END $f$`);
      await c.query(`CREATE TRIGGER zz_ka_fila_log AFTER INSERT ON public.kanban_recalculo_fila
                     FOR EACH ROW EXECUTE FUNCTION pg_temp.fn_ka_fila_log()`);
      await setar(c, M, { data_desenho_tecnico: HOJE });
      const antes = await c.query(`SELECT profundidade FROM _ka_fila_log`);
      await imediato(c);
      const depois = await c.query(`SELECT profundidade FROM _ka_fila_log`);
      expect(antes.rows.length).toBe(1);
      expect(depois.rows).toEqual(antes.rows);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      // a trava: com GUC não vazio (escrita do motor/RPCs) o enfileirador sai cedo
      await guc(c, "auto");
      await c.query(`SELECT public._kanban_enfileirar(ARRAY[$1]::uuid[])`, [M]);
      await guc(c, "");
      expect(await tamanhoFila(c)).toBe(0);
      await c.query(`DROP TRIGGER zz_ka_fila_log ON public.kanban_recalculo_fila`);
    });
  });

  it("salvar_modelo_bom (apaga e reinsere o BOM) NÃO gera linha transitória nem muda o status", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c);
      await configurarBoard(c, { reqs: { etapa_a: ["tecido_com_variante"] } });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      const vt = await um<{ vid: string; aid: string }>(c, `SELECT id AS vid, artigo_id AS aid FROM public.variantes_tecido WHERE tenant_id = $1 LIMIT 1`, [T]);
      const bom = JSON.stringify([{ artigo_id: vt.aid, numero: 1, tipo: "tecido", variantes: [vt.vid] }]);
      const salvar = () => c.query(`SELECT public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb)`, [M, bom]);
      await salvar();
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      const hist = await historico(c, M);
      await salvar(); // DELETE de tudo + INSERT de novo na MESMA txn
      expect(await filaIds(c)).toContain(M);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // nada recalculado no meio
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      expect(await historico(c, M)).toEqual(hist);
      // o estado INTERMEDIÁRIO (sem variante) recuaria se o recálculo não fosse adiado:
      await c.query(`DELETE FROM public.modelo_tecido_variantes WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = $1)`, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      await salvar();
      await imediato(c);
      expect(await historico(c, M)).toEqual(hist);
    });
  });
});

// ─────────────── Migration 3F/3G — trava da chave, Config (snapshot no servidor) e guard (Task 13) ───────────────
async function lotes(c: Client): Promise<{ lote_id: string; motivo: string; n: number }[]> {
  // Na MESMA txn todos os lotes têm o mesmo criado_at (now()) → ordena por motivo (config < ligar).
  const { rows } = await c.query(
    `SELECT lote_id, motivo, count(*)::int AS n
       FROM public.kanban_snapshot WHERE tenant_id = $1 GROUP BY lote_id, motivo ORDER BY motivo, lote_id`, [T]);
  return rows.map((r) => ({ lote_id: r.lote_id, motivo: r.motivo, n: r.n }));
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3F: gatilho da Config grava o snapshot (Task 13)", () => {
  it("LIGAR: 1 lote 'ligar' com TODOS os deriváveis (status de antes) + recálculo 'config' com o lote no histórico", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      const elegiveis = Number((await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1 AND ordem_criacao_enviada AND NOT lancado`, [T])).n);
      await chave(c, true);
      const ls = await lotes(c);
      expect(ls.map((l) => [l.motivo, l.n])).toEqual([["ligar", elegiveis]]);
      const snapM = await um<{ s: string }>(c, `SELECT status_anterior AS s FROM public.kanban_snapshot WHERE modelo_id = $1`, [M]);
      expect(snapM.s).toBe("entrada");
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // recalculado NA MESMA txn do save
      const h = await um<{ origem: string; lote_id: string }>(c,
        `SELECT origem, lote_id FROM public.modelo_kanban_historico WHERE modelo_id = $1 ORDER BY entrou_at DESC, created_at DESC LIMIT 1`, [M]);
      expect(h).toEqual({ origem: "config", lote_id: ls[0].lote_id });
    });
  });

  it("com a chave ligada: board/requisitos/exceções/fluxo de revenda → lote 'config'; confeccao_prioridade só recalcula; upsert sem mudança e DESLIGAR não gravam nada", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      expect((await lotes(c)).length).toBe(1);
      await c.query(`UPDATE public.tenant_config SET kanban_requisitos_excecoes = '{"etapa_c": ["data_piloto1"]}' WHERE tenant_id = $1`, [T]);
      await c.query(`UPDATE public.tenant_config SET revenda_kanban_colunas = '["entrada", "aprovado"]' WHERE tenant_id = $1`, [T]);
      expect((await lotes(c)).map((l) => l.motivo)).toEqual(["config", "config", "ligar"]);
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 LIMIT 1`, [T]);
      await c.query(`UPDATE public.tenant_config SET confeccao_prioridade = jsonb_build_array($2::text) WHERE tenant_id = $1`, [T, cat.id]);
      // "upsert da linha inteira" como a tela de Config faz: mesmas colunas de kanban + outra coluna mudando
      await c.query(
        `UPDATE public.tenant_config SET status_kanban = status_kanban, kanban_requisitos = kanban_requisitos,
                kanban_automatico = kanban_automatico, estoque_critico_threshold = estoque_critico_threshold + 1
          WHERE tenant_id = $1`, [T]);
      expect((await lotes(c)).length).toBe(3);
      const antes = (await c.query(`SELECT id, status_desenvolvimento FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows;
      await chave(c, false);
      expect((await lotes(c)).length).toBe(3);
      expect((await c.query(`SELECT id, status_desenvolvimento FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows).toEqual(antes);
    });
  });
});

async function lerChave(c: Client) {
  return um<{ k: boolean; e: string }>(c,
    `SELECT kanban_automatico AS k, estoque_critico_threshold::text AS e FROM public.tenant_config WHERE tenant_id = $1`, [T]);
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3F: a chave só muda pela RPC (decisão 16, Task 13)", () => {
  it("UPDATE/upsert de aba VELHA não liga nem desliga a chave (e não grava lote nem recalcula)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      // aba velha tentando LIGAR: UPDATE direto e upsert da linha inteira (como a Config faz)
      await c.query(`UPDATE public.tenant_config SET kanban_automatico = true WHERE tenant_id = $1`, [T]);
      await c.query(
        `INSERT INTO public.tenant_config (tenant_id, kanban_automatico, estoque_critico_threshold) VALUES ($1, true, 7)
         ON CONFLICT (tenant_id) DO UPDATE SET kanban_automatico = EXCLUDED.kanban_automatico,
                                              estoque_critico_threshold = EXCLUDED.estoque_critico_threshold`, [T]);
      expect(await lerChave(c)).toEqual({ k: false, e: "7" }); // o resto do upsert grava; a chave não
      expect(await lotes(c)).toEqual([]);
      expect((await lerModelo(c, M)).status).toBe("entrada");
      // ligada pelo caminho certo (GUC da RPC); aba velha tentando DESLIGAR calada
      await chave(c, true);
      await c.query(`UPDATE public.tenant_config SET kanban_automatico = false, estoque_critico_threshold = 8 WHERE tenant_id = $1`, [T]);
      expect(await lerChave(c)).toEqual({ k: true, e: "8" });
      expect((await lotes(c)).map((l) => l.motivo)).toEqual(["ligar"]);
      expect((await um<{ g: string }>(c, `SELECT current_setting('app.kanban_chave', true) AS g`)).g).toBe("");
    });
  });

  it("INSERT de loja nova nasce com a chave DESLIGADA mesmo pedindo true", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      const L = await um<{ id: string }>(c, `INSERT INTO public.tenants (nome) VALUES ('KA loja nova') RETURNING id`);
      // o seed da loja (trg_criar_tenant_config) já criou a linha; recria pedindo a chave LIGADA
      await c.query(`DELETE FROM public.tenant_config WHERE tenant_id = $1`, [L.id]);
      await c.query(`INSERT INTO public.tenant_config (tenant_id, kanban_automatico) VALUES ($1, true)`, [L.id]);
      const r = await um<{ k: boolean }>(c, `SELECT kanban_automatico AS k FROM public.tenant_config WHERE tenant_id = $1`, [L.id]);
      expect(r.k).toBe(false);
    });
  });
});

describe.skipIf(!PRONTO)("kanban-auto — migration 3G: guard do status (Task 13)", () => {
  async function cenario(c: Client) {
    await prepara(c, 3);
    await configurarBoard(c);
    await chave(c, true);
    const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE, data_piloto2: HOJE }));
    await aplicar(c, [M]);
    expect((await lerModelo(c, M)).status).toBe("etapa_c");
    return M;
  }

  it("draft VELHO do Sheet do Dev (coluna automática) é ignorado; ''/NULL mantêm o atual", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await setar(c, M, { status_desenvolvimento: "etapa_a", observacoes_gerais: "salvar do Sheet do Dev" });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
      await setar(c, M, { status_desenvolvimento: "" });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
      await setar(c, M, { status_desenvolvimento: null });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("coluna MANUAL fixa (e fica no COMMIT); tirar de manual p/ automática SOLTA na posição derivada", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await setar(c, M, { status_desenvolvimento: "stand_by" });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("stand_by");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("ENTRADA é aceita e o COMMIT re-deriva (entrada nunca fixa)", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      await setar(c, M, { status_desenvolvimento: "entrada" });
      expect((await lerModelo(c, M)).status).toBe("entrada");
      expect(await filaIds(c)).toContain(M);
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("destino FORA do fluxo → P0001 com a mensagem do §3", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await c.query("SAVEPOINT sp");
      await expect(setar(c, M, { status_desenvolvimento: "zzz" })).rejects.toMatchObject({
        code: "P0001", message: 'A etapa "zzz" não faz parte do fluxo deste modelo.',
      });
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });

  it("passa direto (gravação livre como hoje): chave desligada, card não derivável, escrita do sistema", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      const N = await comoSistema(c, () => novoModelo(c, { ordem_criacao_enviada: false }));
      await setar(c, N, { status_desenvolvimento: "aprovado" });
      expect((await lerModelo(c, N)).status).toBe("aprovado");
      await guc(c, "manual");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await guc(c, "");
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      await chave(c, false);
      await setar(c, M, { status_desenvolvimento: "zzz" });
      expect((await lerModelo(c, M)).status).toBe("zzz");
    });
  });
});
