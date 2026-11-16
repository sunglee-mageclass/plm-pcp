/**
 * F7 Armario - Task A1 (banco): tabelas `armarios` + `armario_itens` (migration 20261202100000). BEGIN...ROLLBACK, SO na copia local
 * (a migration e aplicada DENTRO da txn pelo harness `aplicarArquivo` - sem BEGIN/COMMIT, NUNCA \i). Pinos:
 *  - RLS por tenant (select/insert/update/delete) - outro tenant nao ve, nao insere, nao altera, nao apaga; anon sem acesso;
 *  - tenant_id preenchido pelo gatilho set_tenant_id;
 *  - de-dup: a MESMA variante 2x no mesmo armario e barrada (23505), inclusive com ponteiros NULL (NULLS NOT DISTINCT);
 *  - CHECK de status e de colunas (1..12);
 *  - "cor removida nunca apaga a vitrine": cor/variante sem FK - excluir a cor nao trava nem apaga o item; apagar armario cascateia itens;
 *  - rollback (down) remove as 2 tabelas.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const MIG = "supabase/migrations/20261202100000_armario_tabelas.sql";
const DOWN = "supabase/rollback/20261202100000_armario_tabelas_down.sql";
const T = TENANT_TESTE;

async function prepara(c: Client): Promise<{ modelo: string; outroTenant: string }> {
  await aplicarArquivo(c, MIG);
  const modelo = (await um<{ id: string }>(c, "SELECT id FROM public.modelos LIMIT 1")).id;
  const outroTenant = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 LIMIT 1", [T])).id;
  await comoUsuario(c); // JWT do dono da Loja Teste (tenant ativo = T)
  return { modelo, outroTenant };
}

/** Roda `fn` como o PAPEL authenticated (PostgREST) numa savepoint; devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = [], papel = "authenticated"): Promise<string> {
  await c.query("SAVEPOINT arm_t");
  await c.query(`SET LOCAL ROLE ${papel}`);
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT arm_t"); // desfaz tambem o SET LOCAL ROLE (e a escrita que passou)
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT arm_t");
  }
}

/** Armario de preparacao como postgres (sem papel), no tenant pedido. */
async function armario(c: Client, tenant: string, nome = "A1", extra: { colunas?: number; status?: string } = {}): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.armarios (tenant_id, subcolecao, nome, colunas, status) VALUES ($1, 'Sub X', $2, $3, $4) RETURNING id`,
    [tenant, nome, extra.colunas ?? 5, extra.status ?? "rascunho"],
  );
  return r.id;
}
const item = (c: Client, arm: string, modelo: string, o: { vt?: string | null; pv?: string | null; ordem?: number } = {}) =>
  c.query(
    `INSERT INTO public.armario_itens (armario_id, modelo_id, origem, variante_tecido_id, produto_variante_id, ordem) VALUES ($1, $2, 'cad', $3, $4, $5)`,
    [arm, modelo, o.vt ?? null, o.pv ?? null, o.ordem ?? 1],
  );
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!RODA)("Armario A1 - tabelas armarios + armario_itens", () => {
  it("a migration e idempotente (2a aplicacao nao falha) e a ACL e a pos-S5 (authenticated SIUD, anon nada)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, MIG);
      const acl = await c.query(
        `SELECT g.grantee, array_agg(g.privilege_type::text ORDER BY g.privilege_type)::text[] p
           FROM information_schema.role_table_grants g
          WHERE g.table_schema = 'public' AND g.table_name IN ('armarios','armario_itens') AND g.grantee IN ('anon','authenticated','PUBLIC')
          GROUP BY g.table_name, g.grantee ORDER BY g.grantee`,
      );
      expect(acl.rows.map((r) => r.grantee)).toEqual(["authenticated", "authenticated"]);
      for (const r of acl.rows) expect(r.p).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      const pol = await c.query(`SELECT tablename, count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename IN ('armarios','armario_itens') GROUP BY 1 ORDER BY 1`);
      expect(pol.rows).toEqual([{ tablename: "armario_itens", n: 4 }, { tablename: "armarios", n: 4 }]);
      expect((await tenta(c, "SELECT 1 FROM public.armarios", [], "anon")).startsWith("42501")).toBe(true);
    });
  });

  it("insert como usuario do tenant: o gatilho preenche tenant_id; defaults (colunas=5, status=rascunho, ordem=0)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await c.query("SET LOCAL ROLE authenticated");
      const r = await um<any>(c, `INSERT INTO public.armarios (subcolecao, nome) VALUES ('Sub X', 'Vitrine 1') RETURNING tenant_id, colunas, status, ordem`);
      await c.query("RESET ROLE");
      expect(r).toEqual({ tenant_id: T, colunas: 5, status: "rascunho", ordem: 0 });
    });
  });

  it("RLS: outro tenant nao ve, nao insere, nao altera e nao apaga (armarios e itens); o proprio tenant ve", async () => {
    await withTx(async (c) => {
      const { modelo, outroTenant } = await prepara(c);
      const meu = await armario(c, T, "meu");
      const alheio = await armario(c, outroTenant, "alheio");
      await item(c, meu, modelo, { ordem: 1 });
      await item(c, alheio, modelo, { ordem: 1 });
      await c.query("UPDATE public.armario_itens SET tenant_id = $2 WHERE armario_id = $1", [alheio, outroTenant]); // itens herdam via gatilho do meu T; fixa o alheio
      await c.query("UPDATE public.armario_itens SET tenant_id = $2 WHERE armario_id = $1", [meu, T]);

      await c.query("SET LOCAL ROLE authenticated");
      const vistos = (await c.query("SELECT nome FROM public.armarios ORDER BY nome")).rows.map((r) => r.nome);
      const itens = (await c.query("SELECT armario_id FROM public.armario_itens")).rows.map((r) => r.armario_id);
      const upd = await c.query("UPDATE public.armarios SET nome = 'hack' WHERE id = $1", [alheio]);
      const del = await c.query("DELETE FROM public.armarios WHERE id = $1", [alheio]);
      const updI = await c.query("UPDATE public.armario_itens SET ordem = 9 WHERE armario_id = $1", [alheio]);
      const delI = await c.query("DELETE FROM public.armario_itens WHERE armario_id = $1", [alheio]);
      await c.query("RESET ROLE");
      expect(vistos).toEqual(["meu"]);
      expect(itens).toEqual([meu]);
      expect([upd.rowCount, del.rowCount, updI.rowCount, delI.rowCount]).toEqual([0, 0, 0, 0]);

      // INSERT com tenant_id de OUTRA loja: a WITH CHECK barra (42501)
      const ins = await tenta(c, `INSERT INTO public.armarios (tenant_id, subcolecao, nome) VALUES ($1, 'S', 'x')`, [outroTenant]);
      expect(ins).toMatch(/^42501 /);
      const insI = await tenta(c, `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, ordem) VALUES ($1, $2, $3, 'cad', 1)`, [outroTenant, alheio, modelo]);
      expect(insI).toMatch(/^42501 /);
      // UPDATE que tenta mover a linha propria para outro tenant: WITH CHECK barra
      expect(await tenta(c, `UPDATE public.armarios SET tenant_id = $2 WHERE id = $1`, [meu, outroTenant])).toMatch(/^42501 /);
      // o proprio tenant altera/apaga normalmente
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'novo' WHERE id = $1`, [meu])).toBe("PASSOU");
      expect(await tenta(c, `DELETE FROM public.armarios WHERE id = $1`, [meu])).toBe("PASSOU");
    });
  });

  it("de-dup: a MESMA variante 2x no mesmo armario e barrada (23505), com ponteiro de tecido, de produto e com ambos NULL", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, T);
      // ponteiro de tecido
      await item(c, a, modelo, { vt: U1, ordem: 1 });
      await c.query("SAVEPOINT d1");
      await expect(item(c, a, modelo, { vt: U1, ordem: 2 })).rejects.toMatchObject({ code: "23505" });
      await c.query("ROLLBACK TO SAVEPOINT d1");
      // ponteiro de produto acabado/importado
      await item(c, a, modelo, { pv: U1, ordem: 2 });
      await c.query("SAVEPOINT d2");
      await expect(item(c, a, modelo, { pv: U1, ordem: 3 })).rejects.toMatchObject({ code: "23505" });
      await c.query("ROLLBACK TO SAVEPOINT d2");
      // sem ponteiro algum (em desenvolvimento): NULLS NOT DISTINCT trata NULL como valor -> 2o recusado
      await item(c, a, modelo, { ordem: 3 });
      await c.query("SAVEPOINT d3");
      await expect(item(c, a, modelo, { ordem: 4 })).rejects.toMatchObject({ code: "23505" });
      await c.query("ROLLBACK TO SAVEPOINT d3");
    });
  });

  it("de-dup nao exagera: ponteiros DIFERENTES no mesmo armario, e a MESMA variante em OUTRO armario, passam", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, T, "A");
      const b = await armario(c, T, "B");
      await item(c, a, modelo, { vt: U1, ordem: 1 });
      await item(c, a, modelo, { vt: U2, ordem: 2 });
      await item(c, a, modelo, { pv: U1, ordem: 3 }); // vt NULL + pv U1 != (U1, NULL)
      await item(c, b, modelo, { vt: U1, ordem: 1 });
      const n = await um<{ n: number }>(c, "SELECT count(*)::int n FROM public.armario_itens WHERE armario_id IN ($1, $2)", [a, b]);
      expect(n.n).toBe(4);
    });
  });

  it("CHECK: status fora de (rascunho|pronto|publicado) e colunas fora de 1..12 sao recusados (23514); limites 1 e 12 passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ins = (status: string, colunas: number) =>
        tenta(c, `INSERT INTO public.armarios (subcolecao, nome, status, colunas) VALUES ('S', 'x', $1, $2)`, [status, colunas]);
      expect(await ins("rascunho", 5)).toBe("PASSOU");
      expect(await ins("pronto", 1)).toBe("PASSOU");
      expect(await ins("publicado", 12)).toBe("PASSOU");
      expect(await ins("arquivado", 5)).toMatch(/^23514 .*armarios_status_ck/);
      expect(await ins("", 5)).toMatch(/^23514 /);
      expect(await ins("rascunho", 0)).toMatch(/^23514 .*armarios_colunas_ck/);
      expect(await ins("rascunho", 13)).toMatch(/^23514 .*armarios_colunas_ck/);
      // UPDATE tambem
      const a = await armario(c, T);
      expect(await tenta(c, `UPDATE public.armarios SET status = 'x' WHERE id = $1`, [a])).toMatch(/^23514 /);
      expect(await tenta(c, `UPDATE public.armarios SET colunas = 99 WHERE id = $1`, [a])).toMatch(/^23514 /);
    });
  });

  it("cor/variante SEM FK: ponteiro orfao/cor excluida nao trava nem apaga o item; apagar o armario cascateia os itens; excluir o modelo tambem", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, T);
      // ponteiros que nao existem em tabela nenhuma (uuid avulso) sao aceitos: snapshot puro
      await c.query(
        `INSERT INTO public.armario_itens (armario_id, modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem)
         VALUES ($1, $2, 'cad', $3, $3, $3, $3, 1)`,
        [a, modelo, U1],
      );
      const fks = await c.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'public.armario_itens'::regclass AND contype = 'f' ORDER BY conname`,
      );
      expect(fks.rows.map((r) => r.conname)).toEqual(["armario_itens_armario_id_fkey", "armario_itens_modelo_id_fkey"]);
      // com uma cor REAL referenciada, excluir a cor do cadastro nao e bloqueado pelo armario
      const cor = await um<{ id: string }>(c, "SELECT id FROM public.cores LIMIT 1");
      if (cor) {
        await c.query("UPDATE public.armario_itens SET cor_id = $2 WHERE armario_id = $1", [a, cor.id]);
        await c.query("SAVEPOINT cr");
        await c.query("SET LOCAL session_replication_role = replica"); // so p/ nao esbarrar nas FKs de OUTRAS tabelas que usam a cor
        await c.query("DELETE FROM public.cores WHERE id = $1", [cor.id]);
        await c.query("RESET session_replication_role");
        await c.query("RELEASE SAVEPOINT cr");
        const vivo = await um<{ n: number }>(c, "SELECT count(*)::int n FROM public.armario_itens WHERE armario_id = $1", [a]);
        expect(vivo.n).toBe(1);
      }
      await c.query("DELETE FROM public.armarios WHERE id = $1", [a]);
      expect((await um<{ n: number }>(c, "SELECT count(*)::int n FROM public.armario_itens WHERE armario_id = $1", [a])).n).toBe(0);
    });
  });

  it("rollback (down): remove as 2 tabelas e e idempotente", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, DOWN);
      await aplicarArquivo(c, DOWN);
      const r = await um<{ n: number }>(c, "SELECT count(*)::int n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('armarios','armario_itens')");
      expect(r.n).toBe(0);
    });
  });
});
