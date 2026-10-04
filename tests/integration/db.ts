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
import { parse as parseConnectionString } from "pg-connection-string";

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

/**
 * true quando o banco em uso é a CÓPIA LOCAL (Docker em localhost:54422/127.0.0.1:54422 — ver
 * `PLM + Criação/banco-local/`). Testes que aplicam DDL/migration SÓ podem rodar nela:
 * DDL em transação contra produção trava o app de todas as lojas mesmo com ROLLBACK
 * (incidente 23/set/2026 — AccessExclusive em tenant_config).
 *
 * Fix round 1 (achado 4, incidente 23/set): decide via `pg-connection-string` (o MESMO parser que
 * o driver `pg` usa pra abrir a conexão de verdade), não `new URL()` — `new URL(url).hostname` IGNORA
 * um `?host=` na query string, que o `pg`/libpq HONRAM (troca o host efetivo da conexão). Uma
 * DATABASE_URL como `postgresql://postgres:postgres@127.0.0.1:54422/postgres?host=db.pooler...`
 * teria hostname da URL = "127.0.0.1" (local) mas a conexão REAL iria pro host da query — `new URL`
 * daria falso positivo de "é a cópia local". Exige host ∈ {localhost,127.0.0.1,::1} E porta==="54422"
 * (a porta da cópia local no Docker) — sem porta explícita ou porta diferente não conta.
 */
export function ehBancoLocal(): boolean {
  const url = dbUrl();
  if (!url) return false;
  try {
    const { host, port } = parseConnectionString(url);
    return !!host && ["localhost", "127.0.0.1", "::1"].includes(host) && port === "54422";
  } catch {
    return false;
  }
}

/** A cópia local (Docker) não tem SSL; produção (pooler do Supabase) exige. */
function sslDoBanco(): false | { rejectUnauthorized: boolean } {
  return ehBancoLocal() ? false : { rejectUnauthorized: false };
}

type TxFn = (c: Client) => Promise<void>;

/** Abre conexão, BEGIN, roda fn, e SEMPRE faz ROLLBACK + fecha. */
export async function withTx(fn: TxFn): Promise<void> {
  const client = new Client({ connectionString: dbUrl()!, ssl: sslDoBanco() });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Release I3 (ensaio do estado "depois" sem tocar a cópia): com I3_TXN=1 a I3a/I3b/I3c é aplicada DENTRO desta txn
    // (mig-txn: sem BEGIN/COMMIT, nunca \i) antes do teste. Só na cópia local (exigeBancoLocal dentro de aplicaI3).
    if (process.env.I3_TXN === "1") {
      const { aplicaI3 } = await import("./integracao-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaI3(client);
    }
    // Reforço de segurança S1 (mesmo ensaio): com S1_TXN=1 as 6 migrations da S1 são aplicadas DENTRO desta txn antes do teste.
    if (process.env.S1_TXN === "1") {
      const { aplicaS1 } = await import("./seg-s1-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS1(client);
    }
    // Reforço de segurança S2 (mesmo ensaio): com S2_TXN=1 as 3 migrations da S2 são aplicadas DENTRO desta txn antes do teste.
    if (process.env.S2_TXN === "1") {
      const { aplicaS2 } = await import("./seg-s2-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS2(client);
    }
    // Reforço de segurança S3a (mesmo ensaio): com S3A_TXN=1 as 3 migrations da S3a são aplicadas DENTRO desta txn antes do teste.
    if (process.env.S3A_TXN === "1") {
      const { aplicaS3a } = await import("./seg-s3a-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS3a(client);
    }
    // Reforço de segurança S3b (mesmo ensaio; aplica a S3a antes se ainda não estiver viva).
    if (process.env.S3B_TXN === "1") {
      const { aplicaS3b } = await import("./seg-s3b-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS3b(client);
    }
    // Reforço de segurança S3c (mesmo ensaio; aplica a S3a antes se ainda não estiver viva).
    if (process.env.S3C_TXN === "1") {
      const { aplicaS3c } = await import("./seg-s3c-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS3c(client);
    }
    // Reforço de segurança S3d (mesmo ensaio; aplica a S3a antes se ainda não estiver viva).
    if (process.env.S3D_TXN === "1") {
      const { aplicaS3d } = await import("./seg-s3d-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS3d(client);
    }
    // Reforço de segurança S4 (mesmo ensaio; aplica a S3d — e a S3a — antes se ainda não estiverem vivas).
    if (process.env.S4_TXN === "1") {
      const { aplicaS4 } = await import("./seg-s4-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS4(client);
    }
    // Reforço de segurança S5 (só GRANT/REVOKE; traz a cadeia S3a..S4 em ordem segura se faltar — lição do deadlock da S4).
    if (process.env.S5_TXN === "1") {
      const { aplicaS5 } = await import("./seg-s5-helpers");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await aplicaS5(client);
    }
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
  // Determinístico: fixa o tenant ativo do usuário-dono em TENANT_TESTE DENTRO da
  // transação (revertida no ROLLBACK). Sem isso, se o super_admin trocar de loja no
  // app (setActiveTenant muda users.tenant_id), os testes acoplados a TENANT_TESTE
  // quebrariam — exatamente o que aconteceu quando o dono passou a ver outra loja.
  // Não toca o estado real (txn revertida).
  if (userId === USER_TESTE) {
    await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [TENANT_TESTE, USER_TESTE]);
  }
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

/**
 * Roda `fn` SEM JWT (como migration/manutenção) e devolve os claims de antes. Reforço de segurança S1 (MOD-1, P-233 A):
 * com JWT, só o super admin muda `tenant_config.modules` (o gatilho devolve o valor de antes, sem erro) — teste que
 * liga/desliga módulo DENTRO da txn usa isto. Só para escrita de PREPARAÇÃO feita como `postgres` (sem SET ROLE).
 */
export async function semJwt<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  const ant = (await um<{ v: string | null }>(c, "SELECT current_setting('request.jwt.claims', true) AS v")).v ?? "";
  await c.query("SELECT set_config('request.jwt.claims', '', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [ant]);
  }
}
