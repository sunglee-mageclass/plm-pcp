import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Direcionamento multi-lojas — tudo em txn revertida (BEGIN…ROLLBACK): nada é gravado.
describe.skipIf(!hasDb)("Multi-lojas fase 1 — cadastro lojas_direcionamento", () => {
  it("todo tenant tem E-commerce (default, ordem 1) e Loja Física (ordem 2) semeadas", async () => {
    await withTx(async (c) => {
      const faltando = await um<{ n: string }>(
        c,
        `select count(*) as n from tenants t
          where not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.is_default and l.nome = 'E-commerce')
             or not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.nome = 'Loja Física')`,
      );
      expect(Number(faltando.n)).toBe(0);
      const seeds = await c.query(
        `select nome, ativo, is_default, ordem from lojas_direcionamento
          where tenant_id = $1 order by ordem`,
        [TENANT_TESTE],
      );
      expect(seeds.rows[0]).toMatchObject({ nome: "E-commerce", ativo: true, is_default: true, ordem: 1 });
      expect(seeds.rows[1]).toMatchObject({ nome: "Loja Física", ativo: true, is_default: false, ordem: 2 });
    });
  });

  it("_seed_tenant_defaults passou a semear lojas (loja nova/reset nasce com as 2)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('lojas_direcionamento' in pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("UNIQUE (tenant_id, nome) barra loja duplicada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(`insert into lojas_direcionamento (tenant_id, nome) values ($1, 'E-commerce')`, [TENANT_TESTE]),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_tenant_nome/);
    });
  });

  it("índice único parcial barra um 2º default no mesmo tenant", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(
          `insert into lojas_direcionamento (tenant_id, nome, is_default) values ($1, 'Outra Loja', true)`,
          [TENANT_TESTE],
        ),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_um_default/);
    });
  });
});

describe.skipIf(!hasDb)("Multi-lojas fase 2 — direcionamento_lojas + backfill + excluir", () => {
  it("backfill: linha E-commerce migrada é idêntica ao jsonb legado (e Loja Física idem)", async () => {
    await withTx(async (c) => {
      const leg = await um<{ cad_id: string; variante_numero: number; ecommerce: any; loja_fisica: any } | undefined>(
        c,
        `select cad_id, variante_numero, coalesce(ecommerce, '{}'::jsonb) as ecommerce,
                coalesce(loja_fisica, '{}'::jsonb) as loja_fisica
           from direcionamento limit 1`,
      );
      if (!leg) return; // sem legado → nada a migrar
      const ec = await um<{ grades: any }>(
        c,
        `select dl.grades from direcionamento_lojas dl
           join lojas_direcionamento l on l.id = dl.loja_id
          where dl.cad_id = $1 and dl.variante_numero = $2 and l.is_default`,
        [leg.cad_id, leg.variante_numero],
      );
      expect(ec.grades).toEqual(leg.ecommerce);
      const lf = await um<{ grades: any }>(
        c,
        `select dl.grades from direcionamento_lojas dl
           join lojas_direcionamento l on l.id = dl.loja_id
          where dl.cad_id = $1 and dl.variante_numero = $2 and l.nome = 'Loja Física'`,
        [leg.cad_id, leg.variante_numero],
      );
      expect(lf.grades).toEqual(leg.loja_fisica);
    });
  });

  it("trigger de rebaixe passou a olhar também direcionamento_lojas", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('direcionamento_lojas' in pg_get_functiondef('public.fn_rebaixa_direcionamento_grade()'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("excluir_loja_direcionamento: loja padrão dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const padrao = await um<{ id: string }>(
        c,
        `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`,
        [TENANT_TESTE],
      );
      await expect(
        c.query(`select excluir_loja_direcionamento($1)`, [padrao.id]),
      ).rejects.toThrow(/padrão/);
    });
  });

  it("excluir_loja_direcionamento: loja com linhas de direcionamento dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string } | undefined>(
        c, `select id from cad where tenant_id = $1 limit 1`, [TENANT_TESTE],
      );
      if (!cad) return;
      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ordem) values ($1, 'Atacado Teste', 9) returning id`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
         values ($1, $2, $3, 1, '{}'::jsonb)`,
        [TENANT_TESTE, cad.id, loja.id],
      );
      await expect(
        c.query(`select excluir_loja_direcionamento($1)`, [loja.id]),
      ).rejects.toThrow(/linha\(s\) de direcionamento/);
    });
  });

  it("excluir_loja_direcionamento: loja livre (sem uso, não-default) é excluída", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ordem) values ($1, 'Outlet Teste', 8) returning id`,
        [TENANT_TESTE],
      );
      await c.query(`select excluir_loja_direcionamento($1)`, [loja.id]);
      const n = await um<{ n: string }>(
        c, `select count(*) as n from lojas_direcionamento where id = $1`, [loja.id],
      );
      expect(Number(n.n)).toBe(0);
    });
  });
});
