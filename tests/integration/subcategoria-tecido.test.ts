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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal, TENANT_TESTE } from "./db";

const MIG = fileURLToPath(new URL("../../supabase/migrations/20261210100000_subcategoria_tecido.sql", import.meta.url));
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

  it("RLS por atributo: INSERT sem cadastro_atributos:subcat_tecido é recusado (42501); com a permissão passa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c); // categoria criada como super_admin
      const uid = "0c0c0c0c-0000-4000-8000-0000000000cc";
      await c.query(`insert into auth.users (id, email) values ($1,'subtec-rls@teste') on conflict (id) do nothing`, [uid]);
      await c.query(
        `insert into public.users (id, tenant_id, email, nome) values ($1,$2,'subtec-rls@teste','Sub Tec RLS')
         on conflict (id) do update set tenant_id=excluded.tenant_id`,
        [uid, TENANT_TESTE],
      );
      // usuário comum do tenant: sem papel e sem permissão de atributo
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
      await c.query("SAVEPOINT sp_rls");
      await c.query("SET LOCAL ROLE authenticated");
      const err: any = await c
        .query(`insert into subcategorias_tecido (nome, categoria_tecido_id) values ('Sem perm', $1)`, [s.catA])
        .then(() => null, (e) => e);
      await c.query("ROLLBACK TO SAVEPOINT sp_rls");
      await c.query("RESET ROLE");
      expect(err).not.toBeNull();
      expect(err.code).toBe("42501");

      // concede a permissão do atributo (como postgres) e repete
      await c.query(
        `insert into public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
         values ($1,$2,'cadastro_atributos:subcat_tecido',true,true)`,
        [uid, TENANT_TESTE],
      );
      await c.query("SET LOCAL ROLE authenticated");
      const ok = await um<any>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('Com perm', $1) returning id, tenant_id`, [s.catA]);
      await c.query("RESET ROLE");
      expect(ok.id).toBeTruthy();
      expect(ok.tenant_id).toBe(TENANT_TESTE);
    });
  });

  it("as 4 policies espelham o molde: tenant + user_can_edit('cadastro_atributos:subcat_tecido') na escrita", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select polname, polcmd, coalesce(pg_get_expr(polqual,polrelid),'') q, coalesce(pg_get_expr(polwithcheck,polrelid),'') w
           from pg_policy where polrelid='public.subcategorias_tecido'::regclass order by polname`,
      );
      expect(rows.map((r: any) => r.polname)).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
      const por = Object.fromEntries(rows.map((r: any) => [r.polname, r]));
      const key = "user_can_edit('cadastro_atributos:subcat_tecido'";
      expect(por.tenant_select.q).not.toContain("user_can_edit");
      expect(por.tenant_insert.w).toContain(key);
      expect(por.tenant_insert.w).toContain("tenant_id IS NULL");
      expect(por.tenant_update.q).toContain(key);
      expect(por.tenant_update.w).toContain(key);
      expect(por.tenant_delete.q).toContain(key);
    });
  });

  it("backfill: quem edita cadastro_atributos ganha cadastro_atributos:subcat_tecido (user e papel); idempotente", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // Executa SÓ as 2 instruções de backfill extraídas do arquivo da migration (nunca o arquivo inteiro: tem BEGIN/COMMIT).
      const sql = readFileSync(MIG, "utf8");
      const stmts = sql.match(/INSERT INTO public\.(?:user_permissions|papel_permissoes)[\s\S]*?ON CONFLICT[^;]*;/g) ?? [];
      expect(stmts).toHaveLength(2);
      const uid = "0d0d0d0d-0000-4000-8000-0000000000dd";
      await c.query(`insert into auth.users (id, email) values ($1,'subtec-bf@teste') on conflict (id) do nothing`, [uid]);
      await c.query(
        `insert into public.users (id, tenant_id, email, nome) values ($1,$2,'subtec-bf@teste','Sub Tec BF')
         on conflict (id) do update set tenant_id=excluded.tenant_id`,
        [uid, TENANT_TESTE],
      );
      await c.query(
        `insert into public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) values ($1,$2,'cadastro_atributos',true,true)`,
        [uid, TENANT_TESTE],
      );
      const papel = await um<{ id: string }>(c, `insert into public.papeis (tenant_id, nome) values ($1,'Papel BF subtec') returning id`, [TENANT_TESTE]);
      await c.query(
        `insert into public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar) values ($1,$2,'cadastro_atributos',true,true)`,
        [papel.id, TENANT_TESTE],
      );
      const contar = async () => ({
        u: (await um<{ n: string }>(c, `select count(*)::text n from user_permissions where user_id=$1 and pagina='cadastro_atributos:subcat_tecido' and pode_editar`, [uid])).n,
        p: (await um<{ n: string }>(c, `select count(*)::text n from papel_permissoes where papel_id=$1 and pagina='cadastro_atributos:subcat_tecido' and pode_editar`, [papel.id])).n,
      });
      expect(await contar()).toEqual({ u: "0", p: "0" });
      for (const st of stmts) await c.query(st);
      expect(await contar()).toEqual({ u: "1", p: "1" });
      for (const st of stmts) await c.query(st); // reaplicar não duplica
      expect(await contar()).toEqual({ u: "1", p: "1" });
    });
  });
});
