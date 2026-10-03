// Contas certas D5a (P-168 A): RPC NOVA, só leitura, plan_tecido_vinculos_detalhe(_colecao_id) +
// _plan_tecido_vinculos_detalhe_core(_tenant, _colecao_id) — migration 20261019400000. Uma linha por vínculo card × item
// de OC, com prioridade e quantidade_m, para o Plan. Tecido repartir a demanda na ordem do corte (D5b).
// Integração em BEGIN…ROLLBACK (withTx): nada é gravado. Só roda na cópia local (as fixtures mexem em
// prioridade/quantidade_m e em tenant_config dentro da transação revertida).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal, semJwt } from "./db";

const RODA = hasDb && ehBancoLocal();
const CORE = "public._plan_tecido_vinculos_detalhe_core(uuid,uuid)";
const WRAP = "public.plan_tecido_vinculos_detalhe(uuid)";
const COLS = [
  "modelo_id",
  "tipo",
  "numero",
  "ordem",
  "variante_tecido_id",
  "oc_tecido_item_id",
  "oc_tecido_id",
  "artigo_id",
  "prioridade",
  "quantidade_m",
];

type Alvo = { tenant: string; colecao: string; user: string; n: number };

/** Coleção com vínculos numa loja DIFERENTE da Loja Teste + um usuário comum (não super_admin) dessa loja. */
async function alvo(c: Client): Promise<Alvo | undefined> {
  return um<Alvo | undefined>(
    c,
    `select m.tenant_id tenant, m.colecao_id colecao, u.id "user", count(*)::int n
       from modelo_tecido_oc_links l
       join modelos m on m.id = l.modelo_id and m.tenant_id = l.tenant_id
       join lateral (select u.id from users u
                      where u.tenant_id = m.tenant_id
                        and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'super_admin')
                      order by u.id limit 1) u on true
      where m.colecao_id is not null and m.tenant_id <> $1
      group by 1, 2, 3
      order by count(*) desc, 2
      limit 1`,
    [TENANT_TESTE],
  );
}

/** Esperado, calculado direto das tabelas (independente da função). */
async function esperado(c: Client, tenant: string, colecao: string) {
  const { rows } = await c.query(
    `select l.modelo_id, l.tipo::text tipo, l.numero, l.ordem, l.variante_tecido_id, l.oc_tecido_item_id,
            it.oc_tecido_id, it.artigo_id, l.prioridade, l.quantidade_m::text quantidade_m
       from modelo_tecido_oc_links l
       join modelos m on m.id = l.modelo_id
       join ocs_tecido_itens it on it.id = l.oc_tecido_item_id
       join ocs_tecido oc on oc.id = it.oc_tecido_id
      where l.tenant_id = $1 and m.tenant_id = $1 and oc.tenant_id = $1 and m.colecao_id = $2
      order by l.modelo_id, l.tipo, l.numero, l.ordem, l.variante_tecido_id, l.prioridade, l.oc_tecido_item_id, l.id`,
    [tenant, colecao],
  );
  return rows;
}

async function rpcComoAuthenticated(c: Client, colecao: string) {
  await c.query("SAVEPOINT sp_rpc");
  await c.query("SET LOCAL ROLE authenticated");
  const { rows } = await c.query(
    `select modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, oc_tecido_id, artigo_id, prioridade,
            quantidade_m::text quantidade_m
       from public.plan_tecido_vinculos_detalhe($1)`,
    [colecao],
  );
  await c.query("RESET ROLE");
  await c.query("RELEASE SAVEPOINT sp_rpc");
  return rows;
}

describe.skipIf(!RODA)("plan_tecido_vinculos_detalhe (D5a)", () => {
  it("ACL: _core revogado de PUBLIC/anon/authenticated; wrapper só authenticated (anon sem EXECUTE)", async () => {
    await withTx(async (c) => {
      const r = await um<Record<string, boolean>>(
        c,
        `select has_function_privilege('public', $1, 'EXECUTE') core_public,
                has_function_privilege('anon', $1, 'EXECUTE') core_anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') core_auth,
                has_function_privilege('public', $2, 'EXECUTE') wrap_public,
                has_function_privilege('anon', $2, 'EXECUTE') wrap_anon,
                has_function_privilege('authenticated', $2, 'EXECUTE') wrap_auth,
                (select prosecdef from pg_proc where oid = $1::regprocedure) core_definer,
                (select provolatile::text from pg_proc where oid = $1::regprocedure) core_vol`,
        [CORE, WRAP],
      );
      expect(r).toMatchObject({
        core_public: false,
        core_anon: false,
        core_auth: false,
        wrap_public: false,
        wrap_anon: false,
        wrap_auth: true,
        core_definer: true,
        core_vol: "s",
      });
      // anon chamando de verdade -> permission denied
      await c.query("SAVEPOINT sp_anon");
      await c.query("SET LOCAL ROLE anon");
      await expect(c.query("select * from public.plan_tecido_vinculos_detalhe(gen_random_uuid())")).rejects.toMatchObject({
        code: "42501",
      });
      await c.query("ROLLBACK TO SAVEPOINT sp_anon");
      // authenticated não chama o _core direto
      await c.query("SET LOCAL ROLE authenticated");
      await expect(
        c.query("select * from public._plan_tecido_vinculos_detalhe_core(gen_random_uuid(), gen_random_uuid())"),
      ).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT sp_anon");
    });
  });

  it("formato = VinculoDetalhe (10 colunas, nesta ordem)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select unnest(proargnames[2:]) nome from pg_proc where oid = $1::regprocedure`,
        [WRAP],
      );
      expect(rows.map((r) => r.nome)).toEqual(COLS);
    });
  });

  it("usuário da loja vê os vínculos da coleção, com prioridade/quantidade_m, em ordem determinística", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      if (!a) throw new Error("cópia sem vínculo fora da Loja Teste (fixture)");
      await comoUsuario(c, a.user);
      // fixa prioridade/quantidade_m não triviais em 2 vínculos (revertido no ROLLBACK)
      const dois = (
        await c.query(
          `select l.id from modelo_tecido_oc_links l join modelos m on m.id = l.modelo_id
            where l.tenant_id = $1 and m.colecao_id = $2 order by l.id limit 2`,
          [a.tenant, a.colecao],
        )
      ).rows as { id: string }[];
      await c.query(`update modelo_tecido_oc_links set prioridade = 7, quantidade_m = 12.345 where id = $1`, [dois[0].id]);
      if (dois[1])
        await c.query(`update modelo_tecido_oc_links set prioridade = 3, quantidade_m = 0 where id = $1`, [dois[1].id]);

      const exp = await esperado(c, a.tenant, a.colecao);
      const got = await rpcComoAuthenticated(c, a.colecao);
      expect(got.length).toBe(a.n);
      expect(got).toEqual(exp);
      expect(got.some((r) => r.prioridade === 7 && r.quantidade_m === "12.345")).toBe(true);
      // determinístico: 2ª chamada devolve exatamente a mesma sequência
      expect(await rpcComoAuthenticated(c, a.colecao)).toEqual(got);
      // _core com a loja certa = mesma coisa
      const core = await c.query(
        `select modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, oc_tecido_id, artigo_id, prioridade,
                quantidade_m::text quantidade_m from public._plan_tecido_vinculos_detalhe_core($1, $2)`,
        [a.tenant, a.colecao],
      );
      expect(core.rows).toEqual(exp);
    });
  });

  it("segura por loja: coleção de outra loja não devolve nada (wrapper e _core)", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      if (!a) throw new Error("cópia sem vínculo fora da Loja Teste (fixture)");
      expect(a.tenant).not.toBe(TENANT_TESTE);
      await comoUsuario(c); // usuário da Loja Teste (super_admin, mas a loja ativa é a Loja Teste)
      expect(await rpcComoAuthenticated(c, a.colecao)).toEqual([]);
      const { rows } = await c.query(`select * from public._plan_tecido_vinculos_detalhe_core($1, $2)`, [
        TENANT_TESTE,
        a.colecao,
      ]);
      expect(rows).toEqual([]);
      // loja que não é dona da coleção (qualquer outra) não recebe nada: a loja entra por parâmetro no _core
      const { rows: r2 } = await c.query(
        `select * from public._plan_tecido_vinculos_detalhe_core(gen_random_uuid(), $1)`,
        [a.colecao],
      );
      expect(r2).toEqual([]);
    });
  });

  it("módulo criacao desligado -> vazio", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      if (!a) throw new Error("cópia sem vínculo fora da Loja Teste (fixture)");
      await comoUsuario(c, a.user);
      expect((await rpcComoAuthenticated(c, a.colecao)).length).toBe(a.n);
      await semJwt(c, () => c.query( // S1 MOD-1: módulo só muda sem JWT (ou super admin)
        `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":false}'::jsonb)
         on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":false}'::jsonb`,
        [a.tenant],
      ));
      expect(await rpcComoAuthenticated(c, a.colecao)).toEqual([]);
    });
  });

  it("sem usuário (loja nil) -> vazio", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      if (!a) throw new Error("cópia sem vínculo fora da Loja Teste (fixture)");
      await c.query("select set_config('request.jwt.claims', '', true)");
      // tenant_module_enabled('criacao') sem usuário = default ON; a loja nil não casa com nada
      expect(await rpcComoAuthenticated(c, a.colecao)).toEqual([]);
    });
  });
});
