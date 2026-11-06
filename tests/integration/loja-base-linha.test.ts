// F2 Tarefa A — base por loja x linha (loja_direcionamento_base_linha + RPC loja_base_linha_ler).
// Tudo em txn revertida (BEGIN…ROLLBACK): nada e gravado. A ESCRITA e a RLS rodam DE VERDADE como o
// papel do PostgREST (SET LOCAL ROLE authenticated) com o JWT de usuarios semeados DENTRO da txn —
// o super admin fura os gates, entao os casos de RLS usam usuario comum/admin de tenant explicito.
// Migration ja aplicada na copia local (supabase/migrations/20261114100000_loja_base_linha.sql).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um } from "./db";

const RODA = hasDb && ehBancoLocal();

// ids efemeros (revertidos no ROLLBACK)
const T1 = "7a5e0000-0000-4000-8000-00000000f201";
const T2 = "7a5e0000-0000-4000-8000-00000000f202";
const U_ADMIN = "7a5e0000-0000-4000-8000-0000000000a1"; // tenant_admin de T1
const U_COMUM = "7a5e0000-0000-4000-8000-0000000000c1"; // usuario comum de T1
const U_T2 = "7a5e0000-0000-4000-8000-0000000000c2"; // usuario comum de T2

/** Define o JWT (auth.uid()) transaction-local. */
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como `authenticated` (papel real do PostgREST) num SAVEPOINT; erro volta ao savepoint. */
async function comoAuth(c: Client, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT lblx");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT lblx");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("RESET ROLE").catch(() => {});
    await c.query("ROLLBACK TO SAVEPOINT lblx");
    await c.query("RELEASE SAVEPOINT lblx");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}

/** Cria um tenant com nome unico. */
async function tenant(c: Client, id: string, nome: string): Promise<void> {
  await c.query(`INSERT INTO public.tenants (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, nome]);
}
/** Cria usuario (auth + public) no tenant, opcionalmente tenant_admin. */
async function usuario(c: Client, uid: string, tenantId: string, admin: boolean): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, $4, 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, tenantId, `${uid}@teste`, `LBL ${admin ? "admin" : "comum"}`],
  );
  if (admin)
    await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [uid]);
}
/** Semeia loja + linha num tenant (como postgres, fora de RLS). Devolve ids. */
async function seedLojaLinha(c: Client, tenantId: string, nomeLoja: string, nomeLinha: string) {
  const loja = await um<{ id: string }>(
    c,
    `INSERT INTO public.lojas_direcionamento (nome, ativo, tenant_id) VALUES ($1, true, $2) RETURNING id`,
    [nomeLoja, tenantId],
  );
  const linha = await um<{ id: string }>(
    c,
    `INSERT INTO public.linhas (nome, tenant_id) VALUES ($1, $2) RETURNING id`,
    [nomeLinha, tenantId],
  );
  return { lojaId: loja.id, linhaId: linha.id };
}

describe.skipIf(!RODA)("loja_direcionamento_base_linha (F2 A)", () => {
  it("tenant_admin grava a base e a RPC le { loja_id: base } por linha", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await usuario(c, U_ADMIN, T1, true);
      const { lojaId, linhaId } = await seedLojaLinha(c, T1, "E-com", "Basica");

      await jwt(c, U_ADMIN);
      // escrita DE VERDADE pela RLS (role authenticated), igual a tela faz via supabase.from(...).upsert
      const ins = await comoAuth(
        c,
        `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, base) VALUES ($1,$2,40)`,
        [lojaId, linhaId],
      );
      expect(ins.ok, ins.ok ? "" : `${ins.code} ${ins.msg}`).toBe(true);

      // le via RPC (authenticated): { "<loja_id>": 40 }
      const r = await comoAuth(c, `SELECT public.loja_base_linha_ler($1) AS m`, [linhaId]);
      expect(r.ok, r.ok ? "" : `${r.code} ${r.msg}`).toBe(true);
      if (r.ok) expect(r.rows[0].m[lojaId]).toBe(40);
    });
  });

  it("RLS: usuario COMUM nao grava (so tenant_admin/super)", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await usuario(c, U_COMUM, T1, false);
      const { lojaId, linhaId } = await seedLojaLinha(c, T1, "E-com", "Basica");

      await jwt(c, U_COMUM);
      const ins = await comoAuth(
        c,
        `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, base) VALUES ($1,$2,10)`,
        [lojaId, linhaId],
      );
      expect(ins.ok).toBe(false);
      if (!ins.ok) expect(ins.code).toBe("42501"); // row-level security / permission denied
    });
  });

  it("RLS: outro tenant nao enxerga a base (tenant-scoped) — RPC devolve {}", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await tenant(c, T2, "__ITEST_LBL_T2__");
      await usuario(c, U_ADMIN, T1, true);
      await usuario(c, U_T2, T2, false);
      const { lojaId, linhaId } = await seedLojaLinha(c, T1, "E-com", "Basica");

      // admin de T1 grava a base
      await jwt(c, U_ADMIN);
      const ins = await comoAuth(
        c,
        `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, base) VALUES ($1,$2,55)`,
        [lojaId, linhaId],
      );
      expect(ins.ok, ins.ok ? "" : `${ins.code} ${ins.msg}`).toBe(true);

      // usuario de T2 le a linha de T1 pela RPC -> {} (a RPC filtra pelo tenant do chamador)
      await jwt(c, U_T2);
      const r = await comoAuth(c, `SELECT public.loja_base_linha_ler($1) AS m`, [linhaId]);
      expect(r.ok, r.ok ? "" : `${r.code} ${r.msg}`).toBe(true);
      if (r.ok) expect(r.rows[0].m).toEqual({});

      // e a leitura direta da tabela por T2 tambem nao ve a linha de T1 (RLS select tenant-scoped)
      const sel = await comoAuth(c, `SELECT base FROM public.loja_direcionamento_base_linha WHERE linha_id = $1`, [linhaId]);
      expect(sel.ok).toBe(true);
      if (sel.ok) expect(sel.rows.length).toBe(0);
    });
  });
});
