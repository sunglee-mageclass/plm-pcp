/**
 * Harness mínimo p/ aplicar um arquivo de migration/inverso DENTRO da transação do `withTx`
 * (F3.1 — `modelos.descricao_produto`). Mesmas travas do harness da F1 (tests/integration/kanban-auto.test.ts:56-128,
 * que é local àquele arquivo e não é mexido aqui):
 *   • SÓ na cópia local (decisão 17 do dono; incidente 23/set: DDL em txn contra produção trava o app
 *     de todas as lojas mesmo com ROLLBACK) — `exigeBancoLocal()` é a 1ª linha de `aplicarSql`;
 *   • exatamente 1 `BEGIN;` e 1 `COMMIT;` em linha própria, que são removidos; nenhum outro controle de
 *     transação fora de corpo `$…$`; nenhum meta-comando psql. NUNCA `\i` (o COMMIT do arquivo fecharia a
 *     txn e VAZARIA — incidente 15/set).
 *   • SAVEPOINT em volta: se o SQL falhar, volta ao savepoint e relança (a txn do teste segue usável).
 */
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ehBancoLocal } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");
const RE_COMENTARIO_LINHA = /--[^\n]*/g;
const RE_COMENTARIO_BLOCO = /\/\*[\s\S]*?\*\//g;
const RE_TXN_CTRL_SOLTA =
  /(^|;)[ \t]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE|END(?!\s*(IF|LOOP|CASE|WHILE)\b))\b[^\n]*;/im;

export function exigeBancoLocal(): void {
  if (!ehBancoLocal()) {
    throw new Error(
      "DDL/migration só na cópia local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). " +
        "DDL em transação contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

export function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) {
    throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  }
  const out = sql
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido");
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

export async function aplicarSql(c: Client, sql: string, nome: string): Promise<void> {
  exigeBancoLocal();
  await c.query("SAVEPOINT f31_mig");
  try {
    await c.query(semTransacao(sql, nome));
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT f31_mig");
    throw e;
  }
  await c.query("RELEASE SAVEPOINT f31_mig");
}

export async function aplicarArquivo(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, readFileSync(ROOT + rel, "utf8"), rel);
}
