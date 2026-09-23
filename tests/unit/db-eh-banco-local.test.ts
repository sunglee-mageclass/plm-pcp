/**
 * Fix round 1 (Task 4, achado 4, incidente 23/set) — `ehBancoLocal()` (tests/integration/db.ts)
 * decide via `pg-connection-string` (o MESMO parser do driver `pg`), não `new URL()`. `new URL(url)
 * .hostname` ignora um `?host=` na query string, que o `pg`/libpq HONRAM — sem esse fix, uma
 * DATABASE_URL com hostname local na autoridade mas `?host=<pooler>` na query enganaria a trava de
 * "só DDL na cópia local" (decisão 17 do dono). Teste puro, SEM banco — só string parsing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { ehBancoLocal } from "../integration/db";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function comUrl(url: string | undefined, fn: () => void) {
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
  try {
    fn();
  } finally {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
}

describe("ehBancoLocal (fix round 1, achado 4) — decide via pg-connection-string, não new URL()", () => {
  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  });

  it("URL local (127.0.0.1:54422) → true", () => {
    comUrl("postgresql://postgres:postgres@127.0.0.1:54422/postgres", () => {
      expect(ehBancoLocal()).toBe(true);
    });
  });

  it("host local na autoridade + ?host=<pooler> na query → false (pg/libpq honram o ?host=)", () => {
    comUrl(
      "postgresql://postgres:postgres@127.0.0.1:54422/postgres?host=db.exemplo.pooler.supabase.com",
      () => {
        expect(ehBancoLocal()).toBe(false);
      },
    );
  });

  it("host local, porta ERRADA (≠ 54422) → false", () => {
    comUrl("postgresql://postgres:postgres@127.0.0.1:5432/postgres", () => {
      expect(ehBancoLocal()).toBe(false);
    });
  });

  it("URL de pooler (produção) → false", () => {
    comUrl(
      "postgresql://postgres.xxx:senha@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      () => {
        expect(ehBancoLocal()).toBe(false);
      },
    );
  });
});
