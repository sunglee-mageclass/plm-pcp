// F2 Tarefa A' — base por (linha x QUANTIDADE) -> loja (loja_direcionamento_base_linha + RPC loja_base_linha_ler).
// RPC devolve { "<quantidade>": { "<loja_id>": base } } com TODAS as quantidades da linha.
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
  it("tenant_admin grava por (linha, quantidade, loja) e a RPC le { quantidade: { loja_id: base } }", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await usuario(c, U_ADMIN, T1, true);
      const { lojaId, linhaId } = await seedLojaLinha(c, T1, "E-com", "Day Chic");
      const loja2 = await um<{ id: string }>(
        c,
        `INSERT INTO public.lojas_direcionamento (nome, ativo, tenant_id) VALUES ('Atacado', true, $1) RETURNING id`,
        [T1],
      );

      await jwt(c, U_ADMIN);
      // escrita DE VERDADE pela RLS (role authenticated), igual a tela faz via supabase.from(...).upsert
      const ins = await comoAuth(
        c,
        `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES
           ($1,$3,100,3), ($2,$3,100,2), ($1,$3,64,1)`,
        [lojaId, loja2.id, linhaId],
      );
      expect(ins.ok, ins.ok ? "" : `${ins.code} ${ins.msg}`).toBe(true);

      const r = await comoAuth(c, `SELECT public.loja_base_linha_ler($1) AS m`, [linhaId]);
      expect(r.ok, r.ok ? "" : `${r.code} ${r.msg}`).toBe(true);
      if (r.ok) {
        expect(r.rows[0].m).toEqual({
          "100": { [lojaId]: 3, [loja2.id]: 2 },
          "64": { [lojaId]: 1 },
        });
      }
    });
  });

  it("linha sem config -> {} ; linha nula -> {}", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await usuario(c, U_ADMIN, T1, true);
      const { linhaId } = await seedLojaLinha(c, T1, "E-com", "Vazia");
      await jwt(c, U_ADMIN);
      const r = await comoAuth(c, `SELECT public.loja_base_linha_ler($1) AS m, public.loja_base_linha_ler(NULL) AS n`, [linhaId]);
      expect(r.ok, r.ok ? "" : `${r.code} ${r.msg}`).toBe(true);
      if (r.ok) { expect(r.rows[0].m).toEqual({}); expect(r.rows[0].n).toEqual({}); }
    });
  });

  it("UNIQUE (loja, linha, quantidade); CHECK quantidade >= 1 e base >= 0", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await usuario(c, U_ADMIN, T1, true);
      const { lojaId, linhaId } = await seedLojaLinha(c, T1, "E-com", "Basica");
      await jwt(c, U_ADMIN);
      const ok1 = await comoAuth(c, `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,96,0)`, [lojaId, linhaId]);
      expect(ok1.ok, ok1.ok ? "" : `${ok1.code} ${ok1.msg}`).toBe(true); // base 0 e valida (quantidade materializada)
      const dup = await comoAuth(c, `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,96,5)`, [lojaId, linhaId]);
      expect(dup.ok).toBe(false);
      if (!dup.ok) expect(dup.code).toBe("23505");
      const q0 = await comoAuth(c, `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,0,1)`, [lojaId, linhaId]);
      expect(q0.ok).toBe(false);
      if (!q0.ok) expect(q0.code).toBe("23514");
      const bneg = await comoAuth(c, `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,48,-1)`, [lojaId, linhaId]);
      expect(bneg.ok).toBe(false);
      if (!bneg.ok) expect(bneg.code).toBe("23514");
    });
  });

  it("admin renomeia/remove uma quantidade (todas as lojas); renomear p/ existente -> 23505", async () => {
    await withTx(async (c) => {
      await tenant(c, T1, "__ITEST_LBL_T1__");
      await usuario(c, U_ADMIN, T1, true);
      const { lojaId, linhaId } = await seedLojaLinha(c, T1, "E-com", "Day Chic");
      await jwt(c, U_ADMIN);
      await comoAuth(c, `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,100,3),($1,$2,64,1)`, [lojaId, linhaId]);
      const dup = await comoAuth(c, `UPDATE public.loja_direcionamento_base_linha SET quantidade = 64 WHERE linha_id = $1 AND quantidade = 100`, [linhaId]);
      expect(dup.ok).toBe(false);
      if (!dup.ok) expect(dup.code).toBe("23505");
      const ren = await comoAuth(c, `UPDATE public.loja_direcionamento_base_linha SET quantidade = 96 WHERE linha_id = $1 AND quantidade = 100`, [linhaId]);
      expect(ren.ok, ren.ok ? "" : `${ren.code} ${ren.msg}`).toBe(true);
      const del = await comoAuth(c, `DELETE FROM public.loja_direcionamento_base_linha WHERE linha_id = $1 AND quantidade = 64`, [linhaId]);
      expect(del.ok).toBe(true);
      const r = await comoAuth(c, `SELECT public.loja_base_linha_ler($1) AS m`, [linhaId]);
      if (r.ok) expect(r.rows[0].m).toEqual({ "96": { [lojaId]: 3 } });
    });
  });

  it("privilegios: wrapper so authenticated (nao anon); _core revogado dos 3", async () => {
    await withTx(async (c) => {
      const r = await c.query(
        `SELECT
           has_function_privilege('anon', 'public.loja_base_linha_ler(uuid)', 'EXECUTE') AS w_anon,
           has_function_privilege('authenticated', 'public.loja_base_linha_ler(uuid)', 'EXECUTE') AS w_auth,
           has_function_privilege('public', 'public._loja_base_linha_ler_core(uuid,uuid)', 'EXECUTE') AS c_public,
           has_function_privilege('anon', 'public._loja_base_linha_ler_core(uuid,uuid)', 'EXECUTE') AS c_anon,
           has_function_privilege('authenticated', 'public._loja_base_linha_ler_core(uuid,uuid)', 'EXECUTE') AS c_auth`,
      );
      expect(r.rows[0]).toEqual({ w_anon: false, w_auth: true, c_public: false, c_anon: false, c_auth: false });
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
        `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,100,10)`,
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
        `INSERT INTO public.loja_direcionamento_base_linha (loja_id, linha_id, quantidade, base) VALUES ($1,$2,100,55)`,
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
