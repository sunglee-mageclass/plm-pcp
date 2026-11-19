/**
 * Subcategoria de tecido (Task 2): `set_artigo_categorias(_artigo_id uuid, _pares jsonb)` grava a sub POR PAR, atômico
 * (delete-all + reinsert) e PRESERVA o portão B3 da S3c (só categoria da MESMA loja). A coerência sub<->categoria vem do
 * gatilho do Task 1 (P0001 `subcategoria_categoria_diferente`).
 * Migration: supabase/migrations/20261210110000_set_artigo_categorias_sub.sql (inverso em supabase/rollback/).
 *
 * ⚠️ SÓ na CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres), com as migrations do Task 1 e
 * do Task 2 JÁ aplicadas de verdade (psql -f). Cada teste em BEGIN…ROLLBACK: NADA é gravado. Nenhuma migration é aplicada
 * dentro de transação aqui.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, semUsuario, um, ehBancoLocal, TENANT_TESTE } from "./db";

const roda = hasDb && ehBancoLocal();

async function semear(c: Client) {
  const sfx = Math.random().toString(36).slice(2, 8);
  const catA = await um<{ id: string }>(c, `insert into categorias_tecido (nome) values ($1) returning id`, [`CAT-A-${sfx}`]);
  const catB = await um<{ id: string }>(c, `insert into categorias_tecido (nome) values ($1) returning id`, [`CAT-B-${sfx}`]);
  const subA = await um<{ id: string }>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('SA', $1) returning id`, [catA.id]);
  const subB = await um<{ id: string }>(c, `insert into subcategorias_tecido (nome, categoria_tecido_id) values ('SB', $1) returning id`, [catB.id]);
  const art = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida) values ($1,'metro') returning id`, [`ART-SETCAT-${sfx}`]);
  return { catA: catA.id, catB: catB.id, subA: subA.id, subB: subB.id, art: art.id, sfx };
}

/** Outra loja com uma categoria (e um tecido) próprios — para o portão B3 e o 'Tecido não encontrado'. */
async function outraLoja(c: Client) {
  const sfx = Math.random().toString(36).slice(2, 8);
  const t = await um<{ id: string }>(c, `insert into tenants (nome) values ($1) returning id`, [`ITEST SETCAT outra ${sfx}`]);
  const cat = await um<{ id: string }>(c, `insert into categorias_tecido (tenant_id, nome) values ($1, $2) returning id`, [t.id, `CAT-OUTRA-${sfx}`]);
  const art = await um<{ id: string }>(c, `insert into artigos (tenant_id, nome, unidade_medida) values ($1, $2, 'metro') returning id`, [t.id, `ART-OUTRA-${sfx}`]);
  return { tenant: t.id, cat: cat.id, art: art.id };
}

const par = (cat: string, sub: string | null) => ({ categoria_tecido_id: cat, subcategoria_tecido_id: sub });
const chamar = (c: Client, art: string, pares: unknown) =>
  c.query(`select public.set_artigo_categorias($1, $2::jsonb)`, [art, pares === null ? null : JSON.stringify(pares)]);
const ler = async (c: Client, art: string) =>
  (await c.query(`select categoria_tecido_id cat, subcategoria_tecido_id sub from artigo_categorias_tecido where artigo_id = $1 order by categoria_tecido_id`, [art])).rows as {
    cat: string;
    sub: string | null;
  }[];
const ordenado = (rows: { cat: string; sub: string | null }[]) => [...rows].sort((a, b) => a.cat.localeCompare(b.cat));
/** Roda `fn` num SAVEPOINT e devolve o erro (ou null); volta ao savepoint em qualquer caso de erro. */
async function erro(c: Client, fn: () => Promise<unknown>): Promise<any> {
  await c.query("SAVEPOINT sp_err");
  const e: any = await fn().then(() => null, (x) => x);
  if (e) await c.query("ROLLBACK TO SAVEPOINT sp_err");
  await c.query("RELEASE SAVEPOINT sp_err");
  return e;
}

describe.skipIf(!roda)("set_artigo_categorias(uuid, jsonb) — pares categoria+sub, atômico, portão B3", () => {
  it("1) grava pares COM e SEM sub e lê certo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      await chamar(c, s.art, [par(s.catA, s.subA), par(s.catB, null)]);
      expect(await ler(c, s.art)).toEqual(ordenado([{ cat: s.catA, sub: s.subA }, { cat: s.catB, sub: null }]));
      // tenant do par preenchido pelo gatilho de linha
      const t = await um<{ n: string }>(c, `select count(*)::text n from artigo_categorias_tecido where artigo_id=$1 and tenant_id=$2`, [s.art, TENANT_TESTE]);
      expect(t.n).toBe("2");
    });
  });

  it("2) regravar troca tudo (define → substitui a sub → remove uma categoria)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      await chamar(c, s.art, [par(s.catA, s.subA), par(s.catB, s.subB)]);
      expect(await ler(c, s.art)).toEqual(ordenado([{ cat: s.catA, sub: s.subA }, { cat: s.catB, sub: s.subB }]));
      await chamar(c, s.art, [par(s.catA, null)]); // tira a sub de A e remove B
      expect(await ler(c, s.art)).toEqual([{ cat: s.catA, sub: null }]);
    });
  });

  it("3) sub de OUTRA categoria é recusada: P0001 subcategoria_categoria_diferente (vem do gatilho do Task 1)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const e = await erro(c, () => chamar(c, s.art, [par(s.catA, s.subB)])); // subB é da categoria B
      expect(e).not.toBeNull();
      expect(e.code).toBe("P0001");
      expect(e.message).toBe("subcategoria_categoria_diferente");
      expect(await ler(c, s.art)).toEqual([]);
    });
  });

  it("4) ATÔMICO: um par inválido falha a chamada inteira e o tecido NÃO fica sem categoria", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      await chamar(c, s.art, [par(s.catA, s.subA), par(s.catB, s.subB)]);
      const antes = await c.query(`select id, categoria_tecido_id, subcategoria_tecido_id from artigo_categorias_tecido where artigo_id=$1 order by id`, [s.art]);
      expect(antes.rows).toHaveLength(2);
      // 1º par válido, 2º par com sub de outra categoria → a chamada inteira cai (o delete-all também é desfeito)
      const e = await erro(c, () => chamar(c, s.art, [par(s.catB, null), par(s.catA, s.subB)]));
      expect(e?.code).toBe("P0001");
      expect(e?.message).toBe("subcategoria_categoria_diferente");
      const depois = await c.query(`select id, categoria_tecido_id, subcategoria_tecido_id from artigo_categorias_tecido where artigo_id=$1 order by id`, [s.art]);
      expect(depois.rows).toEqual(antes.rows); // mesmas linhas, mesmos ids: nada foi deletado nem reinserido
    });
  });

  it("5) B3 (S3c): par de categoria de OUTRA loja é ignorado; os da loja entram; o tecido de outra loja é 'Tecido não encontrado'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const o = await outraLoja(c);
      await chamar(c, s.art, [par(s.catA, s.subA), par(o.cat, null), par(o.cat, s.subA)]);
      expect(await ler(c, s.art)).toEqual([{ cat: s.catA, sub: s.subA }]);
      // só categorias de outra loja → zera sem erro
      await chamar(c, s.art, [par(o.cat, null)]);
      expect(await ler(c, s.art)).toEqual([]);
      // tecido de OUTRA loja não pode ser mexido
      const e = await erro(c, () => chamar(c, o.art, [par(s.catA, null)]));
      expect(e?.message).toBe("Tecido não encontrado");
      expect((await ler(c, o.art)).length).toBe(0);
    });
  });

  it("6) portão de tenant preservado: sem login (tenant sentinela) e id inexistente → 'Tecido não encontrado'; 'Sem tenant' segue no corpo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      const inexistente = await erro(c, () => chamar(c, "00000000-0000-4000-8000-00000000dead", [par(s.catA, null)]));
      expect(inexistente?.message).toBe("Tecido não encontrado");
      await semUsuario(c);
      // get_user_tenant_id() devolve o sentinela nil (nunca NULL) sem login → o tecido da loja não é achado e nada é mexido
      const semLogin = await erro(c, () => chamar(c, s.art, [par(s.catA, null)]));
      expect(semLogin?.message).toBe("Tecido não encontrado");
      await comoUsuario(c);
      expect(await ler(c, s.art)).toEqual([]);
      // a guarda 'Sem tenant' (v_tenant is null) e a mensagem acentuada continuam no corpo, como na versão viva
      const def = await um<{ d: string }>(c, `select pg_get_functiondef('public.set_artigo_categorias(uuid,jsonb)'::regprocedure) d`);
      expect(def.d).toContain("raise exception 'Sem tenant'");
      expect(def.d).toContain("raise exception 'Tecido não encontrado'");
      expect(def.d).toContain("ct.tenant_id = v_tenant");
    });
  });

  it("7) _pares vazio ([]), jsonb null ('null') e SQL NULL zeram as categorias (sem inserir nada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      for (const vazio of [[], "null", null] as const) {
        await chamar(c, s.art, [par(s.catA, s.subA)]);
        expect(await ler(c, s.art)).toHaveLength(1);
        if (vazio === "null") await c.query(`select public.set_artigo_categorias($1, 'null'::jsonb)`, [s.art]);
        else await chamar(c, s.art, vazio);
        expect(await ler(c, s.art)).toEqual([]);
      }
    });
  });

  it("8) categoria repetida em _pares vira UM par (1ª ocorrência vale; não estoura a UNIQUE) e sub '' vira NULL", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      await chamar(c, s.art, [par(s.catA, s.subA), par(s.catA, null), par(s.catB, "")]);
      expect(await ler(c, s.art)).toEqual(ordenado([{ cat: s.catA, sub: s.subA }, { cat: s.catB, sub: null }]));
    });
  });

  it("9) chamável como `authenticated` (papel do PostgREST); sub ligada à categoria apagada some junto (cascade)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semear(c);
      await c.query("SET LOCAL ROLE authenticated");
      await chamar(c, s.art, [par(s.catA, s.subA)]);
      await c.query("RESET ROLE");
      expect(await ler(c, s.art)).toEqual([{ cat: s.catA, sub: s.subA }]);
      await c.query(`delete from categorias_tecido where id = $1`, [s.catA]);
      expect(await ler(c, s.art)).toEqual([]);
    });
  });

  it("10) ACL: anon NÃO executa; authenticated e service_role SIM; a versão (uuid, uuid[]) foi dropada (sem overload)", async () => {
    await withTx(async (c) => {
      const f = await um<any>(
        c,
        `select has_function_privilege('anon','public.set_artigo_categorias(uuid,jsonb)','EXECUTE') anon,
                has_function_privilege('authenticated','public.set_artigo_categorias(uuid,jsonb)','EXECUTE') auth,
                has_function_privilege('service_role','public.set_artigo_categorias(uuid,jsonb)','EXECUTE') svc,
                to_regprocedure('public.set_artigo_categorias(uuid,uuid[])') is null antiga_dropada,
                (select count(*)::int from pg_proc where proname='set_artigo_categorias' and pronamespace='public'::regnamespace) n`,
      );
      expect(f).toEqual({ anon: false, auth: true, svc: true, antiga_dropada: true, n: 1 });
      const d = await um<any>(c, `select prosecdef, proconfig from pg_proc where oid = 'public.set_artigo_categorias(uuid,jsonb)'::regprocedure`);
      expect(d.prosecdef).toBe(true);
      expect(d.proconfig).toContain("search_path=public");
      // anon de verdade: SET LOCAL ROLE anon → 42501
      await c.query("SAVEPOINT sp_anon");
      await c.query("SET LOCAL ROLE anon");
      const e: any = await c
        .query(`select public.set_artigo_categorias('00000000-0000-4000-8000-00000000dead', '[]'::jsonb)`)
        .then(() => null, (x) => x);
      await c.query("ROLLBACK TO SAVEPOINT sp_anon");
      await c.query("RESET ROLE");
      expect(e?.code).toBe("42501");
    });
  });
});
