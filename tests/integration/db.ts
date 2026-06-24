// Ferramenta dos testes de integração do sisTrama.
//
// Cada teste roda numa transação (BEGIN…ROLLBACK): NADA é gravado no banco — mesmo
// os testes que escrevem (corromper parcela, inserir baixa) são desfeitos no fim.
// As credenciais vêm de DATABASE_URL ou, se ausente, de /tmp/dburl.txt (Session
// pooler). Sem credencial, os testes de integração se auto-pulam (ver hasDb).
//
// ⚠️ Roda contra o banco de PRODUÇÃO em transação revertida — seguro para dados,
// mas é local/manual. NÃO ligar num CI contra produção; para CI, usar um banco
// dedicado (branch do Supabase) e apontar DATABASE_URL pra ele.
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";

export const TENANT_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b"; // "Loja Teste"
export const USER_TESTE = "f1378ea4-5f6a-47ed-8ac4-95accd03326e"; // usuário da Loja Teste

export function dbUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  try {
    if (existsSync("/tmp/dburl.txt")) return readFileSync("/tmp/dburl.txt", "utf8").trim();
  } catch {
    /* ignore */
  }
  return null;
}

export const hasDb = !!dbUrl();

type TxFn = (c: Client) => Promise<void>;

/** Abre conexão, BEGIN, roda fn, e SEMPRE faz ROLLBACK + fecha. */
export async function withTx(fn: TxFn): Promise<void> {
  const client = new Client({ connectionString: dbUrl()!, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    await client.end();
  }
}

/** Define o contexto JWT (auth.uid()) para as RPCs/RLS. Transaction-local. */
export async function comoUsuario(c: Client, userId: string = USER_TESTE): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

/** Sem usuário autenticado (auth.uid() nulo). */
export async function semUsuario(c: Client): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', '', true)");
}

/** Atalho: primeira linha de uma query. */
export async function um<T = any>(c: Client, sql: string, params: any[] = []): Promise<T> {
  const { rows } = await c.query(sql, params);
  return rows[0] as T;
}
