/**
 * Subcategoria de tecido (Task 1): tabela `subcategorias_tecido` + coluna `artigo_categorias_tecido.subcategoria_tecido_id`
 * + gatilho `trg_act_sub_mesma_categoria` (P0001 `subcategoria_categoria_diferente`).
 * Migration: supabase/migrations/20261210100000_subcategoria_tecido.sql (inverso em supabase/rollback/).
 *
 * ⚠️ SÓ na CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres), com a migration JÁ aplicada
 * de verdade (psql -f). Cada teste em BEGIN…ROLLBACK: NADA é gravado. Nenhuma migration é aplicada dentro de transação aqui.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal } from "./db";

const roda = hasDb && ehBancoLocal();

async function semear(c: Client) {
  const sfx = Math.random().toString(36).slice(2, 8);
  const catA = await um<{ id: string }>(c, `insert into categorias_tecido (nome) values ($1) returning id`, [`CAT-A-${sfx}`]);
  const catB = await um<{ id: string }>(c, `insert into categorias_tecido (nome) values ($1) returning id`, [`CAT-B-${sfx}`]);
  const art = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ($1,'metro') returning id`, [`ART-SUBTEC-${sfx}`]);
  return { catA: catA.id, catB: catB.id, art: art.id, sfx };
}

describe.skipIf(!roda)("subcategorias_tecido — tabela, coluna e gatilho mesma-categoria", () => {
  it("1) insere subcategoria para uma categoria (tenant preenchido pelo gatilho, ativo=true)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const sub = await um<any>(
        c,
        `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('Malha fria', $1) returning id, tenant_id, ativo`,
        [s.catA],
      );
      expect(sub.id).toBeTruthy();
      expect(sub.tenant_id).toBeTruthy();
      expect(sub.ativo).toBe(true);
    });
  });

  it("2) vincula (tecido, categoria) com sub da MESMA categoria", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const sub = await um<{ id: string }>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('S1', $1) returning id`, [s.catA]);
      const par = await um<any>(
        c,
        `insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id) values ($1,$2,$3) returning id, subcategoria_tecido_id`,
        [s.art, s.catA, sub.id],
      );
      expect(par.subcategoria_tecido_id).toBe(sub.id);
      // UPDATE para sub NULL continua permitido (sem sub = ok)
      await c.query(`update artigo_categorias_tecido set subcategoria_tecido_id = null where id = $1`, [par.id]);
    });
  });

  it("3) sub de OUTRA categoria é recusada: P0001 subcategoria_categoria_diferente (INSERT e UPDATE)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const subB = await um<{ id: string }>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('SB', $1) returning id`, [s.catB]);
      await c.query("SAVEPOINT sp_ins");
      const errIns: any = await c
        .query(`insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id) values ($1,$2,$3)`, [s.art, s.catA, subB.id])
        .then(() => null, (e) => e);
      expect(errIns).not.toBeNull();
      expect(errIns.code).toBe("P0001");
      expect(errIns.message).toBe("subcategoria_categoria_diferente");
      await c.query("ROLLBACK TO SAVEPOINT sp_ins");

      // UPDATE: par válido sem sub, depois tenta apontar para sub de outra categoria
      const par = await um<{ id: string }>(c, `insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id) values ($1,$2) returning id`, [s.art, s.catA]);
      await c.query("SAVEPOINT sp_upd");
      const errUpd: any = await c
        .query(`update artigo_categorias_tecido set subcategoria_tecido_id = $2 where id = $1`, [par.id, subB.id])
        .then(() => null, (e) => e);
      expect(errUpd?.code).toBe("P0001");
      expect(errUpd?.message).toBe("subcategoria_categoria_diferente");
      await c.query("ROLLBACK TO SAVEPOINT sp_upd");
    });
  });

  it("4) apagar a subcategoria: o par fica e a sub vira NULL (ON DELETE SET NULL)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const sub = await um<{ id: string }>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('S4', $1) returning id`, [s.catA]);
      const par = await um<{ id: string }>(
        c,
        `insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id) values ($1,$2,$3) returning id`,
        [s.art, s.catA, sub.id],
      );
      await c.query(`delete from subcategorias_tecido where id = $1`, [sub.id]);
      const r = await um<any>(c, `select id, subcategoria_tecido_id from artigo_categorias_tecido where id = $1`, [par.id]);
      expect(r).toBeTruthy();
      expect(r.subcategoria_tecido_id).toBeNull();
    });
  });

  it("5) apagar a categoria cascateia a subcategoria e o par (ON DELETE CASCADE)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const sub = await um<{ id: string }>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('S5', $1) returning id`, [s.catA]);
      const par = await um<{ id: string }>(
        c,
        `insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id) values ($1,$2,$3) returning id`,
        [s.art, s.catA, sub.id],
      );
      await c.query(`delete from categorias_tecido where id = $1`, [s.catA]);
      const nSub = await um<{ n: string }>(c, `select count(*)::text n from subcategorias_tecido where id = $1`, [sub.id]);
      const nPar = await um<{ n: string }>(c, `select count(*)::text n from artigo_categorias_tecido where id = $1`, [par.id]);
      expect(nSub.n).toBe("0");
      expect(nPar.n).toBe("0");
    });
  });

  it("extra) a função do gatilho não é executável por anon/authenticated e o RLS está ligado", async () => {
    await withTx(async (c) => {
      const f = await um<any>(
        c,
        `select has_function_privilege('authenticated','public.fn_act_sub_mesma_categoria()','EXECUTE') a,
                has_function_privilege('anon','public.fn_act_sub_mesma_categoria()','EXECUTE') n`,
      );
      expect(f.a).toBe(false);
      expect(f.n).toBe(false);
      const rls = await um<any>(c, `select relrowsecurity from pg_class where oid = 'public.subcategorias_tecido'::regclass`);
      expect(rls.relrowsecurity).toBe(true);
    });
  });
});
