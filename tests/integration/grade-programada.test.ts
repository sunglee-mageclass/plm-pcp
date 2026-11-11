// F5-2 "Grade por fase" - Task 2: RPC `salvar_grade_programada` (migration 20261120100000, mesma da coluna `grades_programada`).
// A Programada e a meta oficial da grade (`modelo_grades.grades_programada`); a RPC EDITA essa meta, por variante, com portao de
// modulo/pagina, posse do card por loja e trava otimista (`_rev_base`, P0409). O `_core` tem EXECUTE revogado dos 3.
//
// TUDO em BEGIN...ROLLBACK (`withTx`), SO na copia local (`ehBancoLocal`). Padrao de `salvar-card-planejamento.test.ts`: a RPC roda
// como o papel `authenticated` (SET LOCAL ROLE, como o PostgREST) com JWT de usuarios COMUNS criados na txn e permissoes por pagina.
import { describe, it, expect } from "vitest";
import type { Client as PgClient } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_PLAN = "6a1de000-0000-4000-8000-0000000000a1"; // so Planejamento
const U_DEV = "6a1de000-0000-4000-8000-0000000000a2"; // so Desenvolvimento
const U_NADA = "6a1de000-0000-4000-8000-0000000000a3"; // permissoes de OUTRAS areas
const PLAN = "criacao_planejamento";
const DEV = "criacao_desenvolvimento";
const RAND = "6a1de000-0000-4000-8000-00000000dead";

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel dado num SAVEPOINT; erro volta ao savepoint (= a txn de uma requisicao que falhou). */
async function como(c: PgClient, role: "authenticated" | "anon" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT gp_z");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT gp_z");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT gp_z");
    await c.query("RELEASE SAVEPOINT gp_z");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
async function jwt(c: PgClient, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function usuario(c: PgClient, uid: string): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'GP comum', 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`],
  );
}
async function perms(c: PgClient, uid: string, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    for (const pagina of paginas) {
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, true)`,
        [uid, T, pagina],
      );
    }
  });
}
async function prepara(c: PgClient): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '120s'");
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  for (const u of [U_PLAN, U_DEV, U_NADA]) await usuario(c, u);
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"criacao": true}'::jsonb WHERE tenant_id = $1`,
      [T],
    ),
  );
  await perms(c, U_PLAN, [PLAN]);
  await perms(c, U_DEV, [DEV]);
  await perms(c, U_NADA, ["producao_terceirizados", "entrada_oc_tecido"]);
}

/** Card da Loja Teste com 2 variantes na grade (planejada/Real em `grades`); Ordem ja enviada (as linhas nascem DEPOIS = programada NULL, M3). */
async function novoCard(c: PgClient, tenant: string = T): Promise<string> {
  return semJwt(c, async () => {
    await c.query("SAVEPOINT gp_card");
    const id = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, ordem_criacao_enviada) values ($1, 'ITEST-GP card', true) returning id`, [tenant])).id;
    await c.query("RELEASE SAVEPOINT gp_card");
    await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1, 1, '{"P":5,"M":5}'::jsonb, 10), ($1, 2, '{"P":2,"M":3}'::jsonb, 5)`, [id]);
    return id;
  });
}
const rev = async (c: PgClient, m: string): Promise<number> => (await um<{ rev: number }>(c, `select rev from modelos where id = $1`, [m])).rev;
const linhas = async (c: PgClient, m: string) =>
  (await c.query(`select variante_numero v, grades, grades_programada p, grade_total from modelo_grades where modelo_id = $1 order by variante_numero`, [m])).rows;
const SQL = `select public.salvar_grade_programada($1::uuid, $2::jsonb, $3::int) as r`;
const salva = (c: PgClient, m: string, grades: any, revBase: number | null) => como(c, "authenticated", SQL, [m, JSON.stringify(grades), revBase]);
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);

describe.skipIf(!RODA)("salvar_grade_programada (F5-2 Task 2)", () => {
  it("usuario so do Planejamento grava a Programada (sem tocar a grade atual) e recebe o rev novo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      const antes = await linhas(c, m);
      expect(antes.every((l: any) => l.p === null)).toBe(true); // M3: linhas criadas depois do envio da Ordem = NULL
      const r0 = await rev(c, m);
      await jwt(c, U_PLAN);
      const r = await salva(c, m, [{ variante_numero: 1, grades: { P: 7, M: 8 } }], r0);
      expect(txt(r)).toBe("PASSOU");
      if (!r.ok) return;
      const out = r.rows[0].r;
      expect(out.modelo_id).toBe(m);
      expect(out.rev).toBe(await rev(c, m));
      // (o bump de rev pelo gatilho da filha nao e visivel aqui: card e grade nascem na MESMA txn do teste - limite (iii) da T5)
      expect(out.rev).toBeGreaterThanOrEqual(r0);
      const depois = await linhas(c, m);
      expect(depois[0].p).toEqual({ P: 7, M: 8 });
      expect(depois[0].grades).toEqual({ P: 5, M: 5 }); // a grade atual nao muda
      expect(depois[0].grade_total).toBe(10);
    });
  });

  it("grava SO a variante enviada (estado por variante): as demais ficam como estavam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      await semJwt(c, () => c.query(`update modelo_grades set grades_programada = '{"P":9,"M":9}'::jsonb where modelo_id = $1 and variante_numero = 2`, [m]));
      await jwt(c, U_PLAN);
      expect(txt(await salva(c, m, [{ variante_numero: 1, grades: { P: 1, M: 2 } }], await rev(c, m)))).toBe("PASSOU");
      let l = await linhas(c, m);
      expect(l[0].p).toEqual({ P: 1, M: 2 });
      expect(l[1].p).toEqual({ P: 9, M: 9 }); // variante 2 ausente do array: intocada (nem apagada)
      // enviar so a variante 2 nao mexe na 1
      expect(txt(await salva(c, m, [{ variante_numero: 2, grades: { P: 4, M: 4 } }], await rev(c, m)))).toBe("PASSOU");
      l = await linhas(c, m);
      expect(l[0].p).toEqual({ P: 1, M: 2 });
      expect(l[1].p).toEqual({ P: 4, M: 4 });
      // variante que nao existe: nada a gravar, sem erro e sem criar linha
      expect(txt(await salva(c, m, [{ variante_numero: 99, grades: { G: 1 } }], await rev(c, m)))).toBe("PASSOU");
      expect(await linhas(c, m)).toHaveLength(2);
    });
  });

  it("usuario so do Desenvolvimento tambem grava (OU entre as 2 paginas)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      await jwt(c, U_DEV);
      expect(txt(await salva(c, m, [{ variante_numero: 1, grades: { P: 3 } }], await rev(c, m)))).toBe("PASSOU");
      expect((await linhas(c, m))[0].p).toEqual({ P: 3 });
    });
  });

  it("sem permissao de pagina = 42501 sem_permissao_pagina (e nada e gravado)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      await jwt(c, U_NADA);
      const r = await salva(c, m, [{ variante_numero: 1, grades: { P: 7 } }], await rev(c, m));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe("42501");
      expect(r.msg).toMatch(/sem_permissao_pagina/);
      expect((await linhas(c, m))[0].p).toBeNull();
      // sem oraculo: id inexistente da o MESMO erro
      const r2 = await salva(c, RAND, [{ variante_numero: 1, grades: { P: 7 } }], null);
      expect(r2.ok === false && r2.code).toBe("42501");
    });
  });

  it("_rev_base defasado = P0409 conflito_versao e nada e gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      const r0 = await rev(c, m);
      await jwt(c, U_PLAN);
      const r = await salva(c, m, [{ variante_numero: 1, grades: { P: 7 } }], r0 - 1);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe("P0409");
      expect(r.msg).toMatch(/^conflito_versao: card$/);
      expect(r.msg).toMatch(/^[\x20-\x7e]*$/); // ASCII puro (5xx do PostgREST)
      expect((await linhas(c, m))[0].p).toBeNull();
      expect(await rev(c, m)).toBe(r0);
      // _rev_base correto passa; null (manutencao/testes) tambem
      expect(txt(await salva(c, m, [{ variante_numero: 1, grades: { P: 7 } }], r0))).toBe("PASSOU");
      expect(txt(await salva(c, m, [{ variante_numero: 1, grades: { P: 8 } }], null))).toBe("PASSOU");
    });
  });

  it("card de OUTRA loja e inexistente = P0002 nao_encontrado (posse por tenant); payload invalido = P0001", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const outra = await semJwt(c, async () => (await um<{ id: string }>(c, `select id from tenants where id <> $1 order by id limit 1`, [T])).id);
      const mo = await novoCard(c, outra);
      await jwt(c, U_PLAN);
      const r = await salva(c, mo, [{ variante_numero: 1, grades: { P: 7 } }], null);
      expect(r.ok === false && r.code).toBe("P0002");
      expect(r.ok === false && r.msg).toMatch(/^nao_encontrado: modelo$/);
      expect((await linhas(c, mo))[0].p).toBeNull();
      const m = await novoCard(c);
      for (const ruim of [{ variante_numero: 1 }, [{ grades: { P: 1 } }], [{ variante_numero: 1, grades: [1] }], [7]]) {
        const rr = await salva(c, m, ruim, null);
        expect(rr.ok === false && rr.code).toBe("P0001");
        expect(rr.ok === false && rr.msg).toMatch(/^grade_invalida/);
      }
      expect((await linhas(c, m))[0].p).toBeNull();
    });
  });

  it("modulo Criacao desligado = 42501; o _core nao e chamavel por authenticated/anon", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      for (const role of ["authenticated", "anon"] as const) {
        const rc = await como(c, role, `select public._salvar_grade_programada_core($1::uuid, '[]'::jsonb)`, [m]);
        expect(rc.ok === false && rc.code).toBe("42501");
      }
      const p = await um<{ a: boolean; b: boolean; w: boolean; x: boolean }>(
        c,
        `select has_function_privilege('anon','public._salvar_grade_programada_core(uuid,jsonb)','EXECUTE') a,
                has_function_privilege('authenticated','public._salvar_grade_programada_core(uuid,jsonb)','EXECUTE') b,
                has_function_privilege('anon','public.salvar_grade_programada(uuid,jsonb,integer)','EXECUTE') w,
                has_function_privilege('authenticated','public.salvar_grade_programada(uuid,jsonb,integer)','EXECUTE') x`,
      );
      expect(p).toEqual({ a: false, b: false, w: false, x: true });
      await semJwt(c, () => c.query(`UPDATE public.tenant_config SET modules = coalesce(modules,'{}'::jsonb) || '{"criacao": false}'::jsonb WHERE tenant_id = $1`, [T]));
      await jwt(c, U_PLAN);
      const r = await salva(c, m, [{ variante_numero: 1, grades: { P: 7 } }], null);
      expect(r.ok === false && r.code).toBe("42501");
    });
  });
});

// Task 7 (fix load-bearing): o Salvar do BOM (`_salvar_modelo_bom_core`, chamado pelo wrapper `salvar_modelo_bom`) faz
// delete-and-reinsert de `modelo_grades` e tem de PRESERVAR `grades_programada` (a meta oficial congelada da F5-2) por
// variante_numero. Antes do fix, todo Salvar pos-Ordem ZERAVA a Programada.
const salvaBom = (c: PgClient, m: string, grades: any, revBase: number | null) =>
  como(c, "authenticated", `select public.salvar_modelo_bom($1::uuid, '[]'::jsonb, '[]'::jsonb, $2::jsonb, $3::int)`, [m, JSON.stringify(grades), revBase]);

describe.skipIf(!RODA)("salvar_modelo_bom preserva grades_programada (F5-2 Task 7)", () => {
  it("regravar a grade planejada NAO zera a Programada congelada; variante que saiu do BOM perde a linha (programada junto)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c); // variante 1 = {P:5,M:5}; variante 2 = {P:2,M:3}
      // Congela a Programada da variante 1 = {P:3,M:4} (meta oficial, como o envio da Ordem faria).
      await semJwt(c, () =>
        c.query(`update modelo_grades set grades_programada = '{"P":3,"M":4}'::jsonb where modelo_id = $1 and variante_numero = 1`, [m]),
      );
      const antes = await linhas(c, m);
      expect(antes[0].p).toEqual({ P: 3, M: 4 });
      expect(antes[1].p).toBeNull();

      // Salvar do BOM regravando SO a variante 1 com uma grade planejada diferente ({P:9}); a variante 2 sai do BOM.
      await jwt(c, U_DEV);
      expect(txt(await salvaBom(c, m, [{ variante_numero: 1, grades: { P: 9 }, grade_total: 9 }], await rev(c, m)))).toBe("PASSOU");

      const depois = await linhas(c, m);
      // variante 1: grade planejada substituida por {P:9}, MAS a Programada congelada {P:3,M:4} PRESERVADA.
      expect(depois).toHaveLength(1);
      expect(depois[0].v).toBe(1);
      expect(depois[0].grades).toEqual({ P: 9 });
      expect(depois[0].grade_total).toBe(9);
      expect(depois[0].p).toEqual({ P: 3, M: 4 });
      // variante 2 saiu do BOM (nao reinserida): a linha some e a Programada vai junto — aceitavel (a variante nao existe mais).
    });
  });

  it("variante que fica no BOM mas nunca teve Programada permanece com grades_programada NULL", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await novoCard(c);
      await semJwt(c, () =>
        c.query(`update modelo_grades set grades_programada = '{"P":3,"M":4}'::jsonb where modelo_id = $1 and variante_numero = 1`, [m]),
      );
      await jwt(c, U_DEV);
      // Regrava AS DUAS variantes; so a 1 tinha Programada.
      expect(
        txt(
          await salvaBom(
            c,
            m,
            [
              { variante_numero: 1, grades: { P: 1, M: 1 }, grade_total: 2 },
              { variante_numero: 2, grades: { G: 4 }, grade_total: 4 },
            ],
            await rev(c, m),
          ),
        ),
      ).toBe("PASSOU");
      const l = await linhas(c, m);
      expect(l[0].p).toEqual({ P: 3, M: 4 }); // preservada
      expect(l[1].p).toBeNull(); // variante 2 nunca teve Programada
    });
  });
});
