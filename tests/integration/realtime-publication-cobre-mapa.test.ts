// ANTI-DRIFT mapa x publicação (Realtime Onda 1, fix round 1). O hook global `useRealtimeInvalidation` assina UMA
// `postgres_changes` por tabela de REALTIME_INVALIDATION_TABLES num canal só (`tenant-sync`): se UMA tabela do mapa não está
// na publicação `supabase_realtime`, o servidor recusa a assinatura e o canal INTEIRO falha em silêncio (nenhuma tabela mais
// reflete ao vivo). Ou seja: site novo + banco sem a migration de publicação = tudo para de atualizar. Este teste fixa
// REALTIME_INVALIDATION_TABLES ⊆ pg_publication_tables(supabase_realtime, public). Leitura pura de catálogo (sem txn, sem escrita).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { dbUrl, hasDb } from "./db";
import { REALTIME_INVALIDATION_TABLES } from "../../src/lib/realtime-invalidation-map";

describe.skipIf(!hasDb)("realtime: a publicação supabase_realtime cobre TODAS as tabelas do mapa", () => {
  it("REALTIME_INVALIDATION_TABLES ⊆ pg_publication_tables", async () => {
    const c = new Client({ connectionString: dbUrl()! });
    await c.connect();
    try {
      const { rows } = await c.query<{ tablename: string }>(
        `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`,
      );
      const publicadas = new Set(rows.map((r) => r.tablename));
      const faltando = REALTIME_INVALIDATION_TABLES.filter((t) => !publicadas.has(t));
      expect(
        faltando,
        "tabela(s) do mapa SEM publicação em supabase_realtime — aplique a migration de publicação ANTES do site (senão o canal tenant-sync inteiro falha)",
      ).toEqual([]);
    } finally {
      await c.end();
    }
  });
});
