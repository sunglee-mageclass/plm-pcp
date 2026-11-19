// Preço de atacado: EDITAR trancado no banco (ramo novo em fn_modelo_preco_venda_gate). VER NÃO é trancado (D1 A).
// Recompute derivado do comprado (GUC app.preco_comprado_sistema='on') passa; PATCH direto do cliente sem a chave = 42501.
// Backfill das 4 chaves concede a quem hoje vê/edita preço. SÓ na cópia local (ehBancoLocal) — DDL em txn.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const MIG = "supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql";
const DOWN = "supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql";
const T = TENANT_TESTE;
// md5 da função: "depois" da S1 (20261031120000) e "depois" desta frente. Quem reaplicar a S1 por cima desta frente precisa do _down antes.
const MD5_S1_DEPOIS = "e89be53c25f421724994e78b756a027d";
const MD5_ESTA_FRENTE = "2da90981f4d754de3e0a2c5e2c85a994";

/** Roda `sql` como o PAPEL authenticated (PostgREST) numa savepoint; devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT pp_t");
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT pp_t");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT pp_t");
  }
}

// USER_TESTE é SUPER ADMIN (fura user_can_edit): o gate só morde usuário COMUM. Cria um (role user, Loja Teste) com as páginas dadas
// (ver+editar) e o põe como identidade ativa. A preparação roda SEM JWT (como postgres). Txn revertida.
const U_COMUM = "0b0b0b0b-0000-4000-8000-00000000a7a1";
async function usuarioComum(c: Client, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PP comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [U_COMUM, T, `${U_COMUM}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [U_COMUM, T, paginas],
    );
  });
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_COMUM, role: "authenticated" })]);
}

// Cria um card comprado (revenda) da Loja Teste para o teste de PATCH de preco_atacado.
async function cardRevenda(c: Client): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, origem, preco_atacado)
       VALUES ($1, 'PP Atacado', 'revenda', 10) RETURNING id`,
    [T],
  );
  return r.id;
}

describe.skipIf(!RODA)("preço de atacado — gate de escrita", () => {
  it("PATCH direto de preco_atacado sem a chave → 42501; o recompute derivado (GUC) passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const modelo = await cardRevenda(c);
      // Usuário COMUM que edita o Planejamento (passa o portão de página de `modelos`) mas NÃO tem criacao_planejamento:preco_atacado.
      await usuarioComum(c, ["criacao_planejamento"]);
      // PATCH direto como authenticated, sem a GUC → 42501.
      const semChave = await tenta(c, `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]);
      expect(semChave.startsWith("42501")).toBe(true);
      expect(semChave).toMatch(/preco de atacado/); // a recusa é DESTE ramo, não do portão de página da S3d
      // Mesmo PATCH com a GUC do recompute derivado ligada → passa (não morde o recompute).
      await c.query("SAVEPOINT pp_guc");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('app.preco_comprado_sistema','on',true)");
      let passou = "PASSOU";
      try { await c.query(`UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]); }
      catch (e) { passou = `${(e as any).code} ${(e as any).message}`; }
      finally { await c.query("ROLLBACK TO SAVEPOINT pp_guc"); await c.query("RESET ROLE"); await c.query("RELEASE SAVEPOINT pp_guc"); }
      expect(passou).toBe("PASSOU");
    });
  });

  it("com a chave de atacado o PATCH direto passa", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const modelo = await cardRevenda(c);
      await usuarioComum(c, ["criacao_planejamento", "criacao_planejamento:preco_atacado"]);
      const r = await tenta(c, `UPDATE public.modelos SET preco_atacado = 99 WHERE id = $1`, [modelo]);
      expect(r).toBe("PASSOU");
    });
  });

  it("backfill concede VER varejo+atacado a quem vê custos e EDITAR atacado a quem edita o Planejamento", async () => {
    await withTx(async (c) => {
      // Semeia um usuário que HOJE vê custos (criacao_planejamento:custos ver=true) e edita o Planejamento.
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
           VALUES ($1,$2,'criacao_planejamento:custos',true,false),
                  ($1,$2,'criacao_planejamento:preco_venda',true,true)
         ON CONFLICT (user_id, pagina) DO NOTHING`,
        [USER_TESTE, T],
      );
      await aplicarArquivo(c, MIG);
      const q = async (pag: string) =>
        (await um<{ n: number }>(c,
          `SELECT count(*)::int n FROM public.user_permissions WHERE user_id=$1 AND pagina=$2 AND pode_ver=true`,
          [USER_TESTE, pag])).n;
      expect(await q("criacao_planejamento:ver_preco_venda")).toBe(1);
      expect(await q("criacao_planejamento:ver_preco_atacado")).toBe(1);
      const ed = (await um<{ n: number }>(c,
        `SELECT count(*)::int n FROM public.user_permissions
           WHERE user_id=$1 AND pagina='criacao_planejamento:preco_atacado' AND pode_editar=true`,
        [USER_TESTE])).n;
      expect(ed).toBe(1);
    });
  });

  it("backfill também concede nos PAPÉIS (papel_permissoes) e é idempotente", async () => {
    await withTx(async (c) => {
      const papel = (await um<{ id: string }>(c, `INSERT INTO public.papeis (tenant_id, nome) VALUES ($1, 'PP papel') RETURNING id`, [T])).id;
      await c.query(
        `INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
           VALUES ($1,$2,'dashboard_custos',true,false),
                  ($1,$2,'criacao_produto_acabado',true,true)`,
        [papel, T],
      );
      await aplicarArquivo(c, MIG);
      const q = async (pag: string, col: "pode_ver" | "pode_editar") =>
        (await um<{ n: number }>(c,
          `SELECT count(*)::int n FROM public.papel_permissoes WHERE papel_id=$1 AND pagina=$2 AND ${col}=true`,
          [papel, pag])).n;
      expect(await q("criacao_planejamento:ver_preco_venda", "pode_ver")).toBe(1);
      expect(await q("criacao_planejamento:ver_preco_atacado", "pode_ver")).toBe(1);
      expect(await q("criacao_planejamento:preco_atacado", "pode_editar")).toBe(1);
      // 2ª aplicação: ON CONFLICT DO NOTHING (não duplica nem troca o que a pessoa ajustou depois).
      await c.query(`UPDATE public.papel_permissoes SET pode_editar=false WHERE papel_id=$1 AND pagina='criacao_planejamento:preco_atacado'`, [papel]);
      await aplicarArquivo(c, MIG);
      expect(await q("criacao_planejamento:preco_atacado", "pode_editar")).toBe(0);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int n FROM public.papel_permissoes WHERE papel_id=$1 AND pagina LIKE 'criacao_planejamento:%preco_%'`, [papel])).n).toBe(3);
    });
  });

  it("a migration deixa a função no md5 desta frente (pino anti-drift)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      const m = (await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure)) m`)).m;
      expect(m).toBe(MD5_ESTA_FRENTE);
    });
  });

  it("down: devolve o corpo anterior do gatilho (sem o ramo de atacado)", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, MIG);
      await aplicarArquivo(c, DOWN);
      const src = (await um<{ s: string }>(c,
        `SELECT pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure) s`)).s;
      expect(src).not.toMatch(/criacao_planejamento:preco_atacado/);
      // volta ao texto EXATO da S1 (md5 pinado: quem reaplicar a S1 depois do _down desta frente a encontra como esperava)
      const m = (await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure)) m`)).m;
      expect(m).toBe(MD5_S1_DEPOIS);
    });
  });
});
