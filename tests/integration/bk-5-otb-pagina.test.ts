// Frente Backend B5 — OTB grava só com a página OTB (desenho item 9; P-258 = A; ruling R2). Plano:
// .superpowers/sdd/2026-10-05-backend/plan.md §10 B5 (+ §0 K5); feito no worktree camada (ruling R2 da Camada).
// Migration GERADA 20261103148000_bk_otb_pagina (gerar-bk5.mjs): (1) o gatilho trg_aaa_seg_modulo das 12 tabelas do OTB
// (fn_seg_modulo_otb, INVOKER, só morde authenticated/anon) ganha, DEPOIS da checagem do módulo, o portão de página
// `_seg_exige_pagina('otb')` — pega a escrita direta pela API e as 6 RPCs INVOKER do OTB; (2) as 9 RPCs SECURITY DEFINER do OTB
// (rodam como postgres: o gatilho não as morde) ganham o mesmo portão logo depois do módulo e ANTES de qualquer busca.
// Cada caso em transação revertida (withTx) e SÓ na cópia local: a migration é aplicada DENTRO da txn (bk-helpers/mig-txn, nunca
// \i). Escrita e RPCs rodam como o PAPEL do PostgREST (SET LOCAL ROLE authenticated) com JWT de usuário COMUM criado na txn;
// fixtures como postgres, sem JWT. Módulos ligados/desligados SEM claims (MOD-1).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaBk, bkViva, voltaBk } from "./bk-helpers";
import { aplicaMod, md5ModSucessor, voltaModSePreciso } from "./mod-helpers";
import {
  BK_MD5,
  BK_MIG,
  BK_DOWN,
  BK_SENTINELA,
  BK5_ACL,
  BK5_SEG,
  BK5_DEPS,
  BK5_TABELAS,
  BK5_RPCS,
  BK5_LEITURA,
  BK5_DEFINER_FORA,
  BK5_INVOKER,
} from "./bk-5-dados";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_VE = "b5b5b5b5-0000-4000-8000-0000000000c1"; // vê o OTB, NÃO edita
const U_EDITA = "b5b5b5b5-0000-4000-8000-0000000000c2"; // vê e edita o OTB
const U_PT = "b5b5b5b5-0000-4000-8000-0000000000c3"; // só Plan. Tecido (edita), sem a página OTB
const U_ADMIN = "b5b5b5b5-0000-4000-8000-0000000000a1"; // admin da loja (tenant_admin), sem user_permissions
const NADA = "00000000-b5b5-4000-8000-00000000dead"; // id que não existe em tabela nenhuma
const NEG = "42501 sem_permissao_pagina: otb";
const OTB_OFF = "42501 Módulo otb não habilitado para esta loja";

type Res = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint (a txn segue usável). */
async function como(
  c: Client,
  role: "authenticated" | "anon" | "service_role" | null,
  sql: string,
  params: unknown[] = [],
): Promise<Res> {
  await c.query("SAVEPOINT bk5");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT bk5");
    return { ok: true, rows: r.rows };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT bk5");
    await c.query("RELEASE SAVEPOINT bk5");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const cli = (c: Client, sql: string, params: unknown[] = []) =>
  como(c, "authenticated", sql, params);

async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}
/** Usuário da loja de teste (role user); `paginas` = [pagina, editar] (ver sempre true); admin = tenant_admin sem permissões. */
async function usuario(
  c: Client,
  uid: string,
  paginas: [string, boolean][],
  admin = false,
): Promise<void> {
  await semJwt(c, async () => {
    await c.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [uid, `${uid}@teste`],
    );
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'BK5', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, T, `${uid}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    for (const [pagina, editar] of paginas) {
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)`,
        [uid, T, pagina, editar],
      );
    }
    if (admin)
      await c.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`,
        [uid],
      );
  });
}
async function modulos(c: Client, mods: Record<string, boolean>): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`,
      [T, JSON.stringify(mods)],
    ),
  );
}
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c); // idempotente (cópia já com a Modularidade)
  await aplicaBk(c, "B5"); // idempotente (cópia já com a B5, ou BK_TXN=1: pula)
  expect(await bkViva(c, "B5")).toBe(true);
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_VE, [["otb", false]]);
  await usuario(c, U_EDITA, [["otb", true]]);
  await usuario(c, U_PT, [["criacao_plan_tecido", true]]);
  await usuario(c, U_ADMIN, [], true);
  await modulos(c, { otb: true, criacao: true });
}

// ───────────── fixture: uma linha em CADA uma das 12 tabelas do OTB (como postgres, sem JWT) ─────────────
type Fx = Record<string, string> & {
  col: string;
  sub: string;
  cat: string;
  padrao: string;
  sim: string;
  un: string;
};
let nFx = 0;
async function fixture(c: Client): Promise<Fx> {
  const k = ++nFx; // nomes únicos (a fixture roda mais de uma vez na mesma txn)
  return semJwt(c, async () => {
    const id = async (sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
    const cat = await id(
      `insert into categorias_produto (tenant_id, nome) values ($1, $2) returning id`,
      [T, `ITEST B5 cat ${k}`],
    );
    const col = await id(
      `insert into colecoes (tenant_id, nome, status) values ($1, $2, 'rascunho') returning id`,
      [T, `ITEST B5 col ${k}`],
    );
    const sub = await id(
      `insert into colecao_subcolecoes (tenant_id, colecao_id, nome) values ($1, $2, 'Sub B5') returning id`,
      [T, col],
    );
    const sem = await id(
      `insert into colecao_semanas (tenant_id, colecao_id, semana, subcolecao_id, qtd_planejada) values ($1, $2, '1', $3, 5) returning id`,
      [T, col, sub],
    );
    const semcat = await id(
      `insert into colecao_semana_categorias (tenant_id, colecao_id, semana, categoria_id, subcolecao_id, qtd) values ($1, $2, '1', $3, $4, 0) returning id`,
      [T, col, cat, sub],
    );
    const pv = await id(
      `insert into colecao_pv_itens (tenant_id, colecao_id, subcolecao_id) values ($1, $2, $3) returning id`,
      [T, col, sub],
    );
    const padrao = await id(
      `insert into mix_padroes (tenant_id, nome) values ($1, $2) returning id`,
      [T, `ITEST B5 padrão ${k}`],
    );
    const padraoLinha = await id(
      `insert into mix_padrao_linhas (tenant_id, padrao_id) values ($1, $2) returning id`,
      [T, padrao],
    );
    const sim = await id(
      `insert into otb_simulacoes (tenant_id, colecao_id, nome) values ($1, $2, 'ITEST B5 cenário') returning id`,
      [T, col],
    );
    // unidade da subcoleção: aplicar_simulacao (orçamento) reparte nas semanas dela — grava colecao_semanas
    const un = await id(
      `insert into otb_simulacao_unidades (tenant_id, simulacao_id, subcolecao_id) values ($1, $2, $3) returning id`,
      [T, sim, sub],
    );
    const simLinha = await id(
      `insert into otb_simulacao_linhas (tenant_id, unidade_id, num_modelos) values ($1, $2, 3) returning id`,
      [T, un],
    );
    const simModelo = await id(
      `insert into otb_simulacao_modelos (tenant_id, linha_ref_id) values ($1, $2) returning id`,
      [T, simLinha],
    );
    const simVar = await id(
      `insert into otb_simulacao_variantes (tenant_id, unidade_id) values ($1, $2) returning id`,
      [T, un],
    );
    return {
      col,
      sub,
      cat,
      padrao,
      sim,
      un,
      colecoes: col,
      colecao_subcolecoes: sub,
      colecao_semanas: sem,
      colecao_semana_categorias: semcat,
      colecao_pv_itens: pv,
      mix_padroes: padrao,
      mix_padrao_linhas: padraoLinha,
      otb_simulacoes: sim,
      otb_simulacao_unidades: un,
      otb_simulacao_linhas: simLinha,
      otb_simulacao_modelos: simModelo,
      otb_simulacao_variantes: simVar,
    } as Fx;
  });
}

/** As 6 RPCs INVOKER do OTB (o gatilho as morde), chamadas como a tela/simulador chamariam. */
const invoker = (fx: Fx): { fn: string; sql: string; p: unknown[] }[] => [
  {
    fn: "public.salvar_colecao_pv(uuid,jsonb,jsonb)",
    sql: `select public.salvar_colecao_pv(null, $1::jsonb, '[]'::jsonb)`,
    p: [JSON.stringify({ nome: "ITEST B5 PV" })],
  },
  {
    fn: "public.salvar_mix_padrao(uuid,text,jsonb,integer)",
    sql: `select public.salvar_mix_padrao(null, 'ITEST B5 P2', '[]'::jsonb, null)`,
    p: [],
  },
  {
    fn: "public.excluir_mix_padrao(uuid)",
    sql: `select public.excluir_mix_padrao($1)`,
    p: [fx.padrao],
  },
  {
    fn: "public.salvar_simulacao(uuid,jsonb,jsonb)",
    sql: `select public.salvar_simulacao(null, $1::jsonb, '[]'::jsonb)`,
    p: [JSON.stringify({ colecao_id: fx.col, nome: "ITEST B5 S2" })],
  },
  { fn: "public.excluir_simulacao(uuid)", sql: `select public.excluir_simulacao($1)`, p: [fx.sim] },
  {
    fn: "public.aplicar_simulacao(uuid,uuid)",
    sql: `select public.aplicar_simulacao($1, $2)`,
    p: [fx.sim, fx.un],
  },
];
/** As 9 RPCs DEFINER com o portão: `real` = com ids da fixture; `nada` = com id inexistente (sem oráculo: mesma recusa). */
const definer = (fx: Fx | null): { fn: string; sql: string; p: unknown[] }[] => {
  const col = fx?.col ?? NADA;
  const sub = fx?.sub ?? NADA;
  return [
    {
      fn: "public.otb_salvar_colecao(jsonb)",
      sql: `select public.otb_salvar_colecao($1::jsonb)`,
      p: [
        JSON.stringify(
          fx ? { id: col, nome: "ITEST B5 col", subs: [] } : { id: NADA, nome: "X", subs: [] },
        ),
      ],
    },
    { fn: "public.otb_confirmar(uuid)", sql: `select public.otb_confirmar($1)`, p: [col] },
    { fn: "public.otb_confirmar_pv(uuid)", sql: `select public.otb_confirmar_pv($1)`, p: [col] },
    { fn: "public.otb_desconfirmar(uuid)", sql: `select public.otb_desconfirmar($1)`, p: [col] },
    {
      fn: "public.otb_excluir_colecao(uuid)",
      sql: `select public.otb_excluir_colecao($1)`,
      p: [col],
    },
    { fn: "public.otb_importar_colecoes()", sql: `select public.otb_importar_colecoes()`, p: [] },
    {
      fn: "public.otb_atribuir_card(uuid,uuid,text)",
      sql: `select public.otb_atribuir_card($1, $2, '1')`,
      p: [NADA, sub],
    },
    {
      fn: "public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)",
      sql: `select public.aplicar_simulacao_modelo($1, null, '[]'::jsonb, '{}'::jsonb)`,
      p: [NADA],
    },
    {
      fn: "public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)",
      sql: `select public.criar_card_simulacao($1, $2, '1', null, null, null, '[]'::jsonb, '{}'::jsonb)`,
      p: [col, sub],
    },
  ];
};

/** Estado das 12 tabelas da fixture (para provar que a recusa não gravou nada). */
async function retrato(c: Client, fx: Fx): Promise<string> {
  const partes: string[] = [];
  for (const t of BK5_TABELAS) {
    const r = await c.query(
      `select to_jsonb(x) - 'updated_at' as j from public.${t} x where id = $1`,
      [fx[t]],
    );
    partes.push(`${t}:${JSON.stringify(r.rows[0]?.j ?? null)}`);
  }
  const n = await um<{ n: string }>(
    c,
    `select (select count(*) from colecoes where tenant_id = $1)::text || '/' ||
      (select count(*) from mix_padroes where tenant_id = $1)::text || '/' || (select count(*) from modelos where tenant_id = $1)::text AS n`,
    [T],
  );
  return partes.join("\n") + `\ncontagens:${n.n}`;
}

describe.skipIf(!RODA)("bk B5 — OTB grava só com a página OTB (P-258 A)", () => {
  it("comum que só VÊ o OTB: escrita direta nas 12, as 6 INVOKER e as 9 DEFINER → 42501 sem_permissao_pagina: otb; nada muda; leitura segue", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const antes = await retrato(c, fx);
      await jwt(c, U_VE);
      for (const t of BK5_TABELAS) {
        expect(
          txt(await cli(c, `update public.${t} set tenant_id = tenant_id where id = $1`, [fx[t]])),
          `UPDATE ${t}`,
        ).toBe(NEG);
        expect(
          txt(await cli(c, `delete from public.${t} where id = $1`, [fx[t]])),
          `DELETE ${t}`,
        ).toBe(NEG);
        // INSERT: o gatilho BEFORE recusa antes de NOT NULL/FK (linha vazia de propósito)
        expect(txt(await cli(c, `insert into public.${t} default values`)), `INSERT ${t}`).toBe(
          NEG,
        );
      }
      expect(
        txt(await cli(c, `insert into public.colecoes (nome, status) values ('API', 'rascunho')`)),
      ).toBe(NEG);
      for (const k of invoker(fx)) expect(txt(await cli(c, k.sql, k.p)), k.fn).toBe(NEG);
      for (const k of definer(fx)) expect(txt(await cli(c, k.sql, k.p)), k.fn).toBe(NEG);
      // sem oráculo: id inexistente dá a MESMA recusa
      for (const k of definer(null))
        expect(txt(await cli(c, k.sql, k.p)), `${k.fn} (id inexistente)`).toBe(NEG);
      expect(
        definer(fx)
          .map((k) => k.fn)
          .sort(),
      ).toEqual([...BK5_RPCS].sort());
      expect(
        invoker(fx)
          .map((k) => k.fn)
          .sort(),
      ).toEqual([...BK5_INVOKER].sort());
      // leitura segue: SELECT nas 12 e otb_orcamento (DEFINER de leitura, sem portão)
      for (const t of BK5_TABELAS)
        expect(
          txt(await cli(c, `select count(*) from public.${t} where id = $1`, [fx[t]])),
          t,
        ).toBe("PASSOU");
      expect(txt(await cli(c, `select public.otb_orcamento($1)`, [fx.col]))).toBe("PASSOU");
      expect(txt(await cli(c, `select public.sidebar_badges()`))).toBe("PASSOU");
      await jwt(c, null);
      expect(await retrato(c, fx)).toBe(antes);
    });
  });

  it("quem EDITA o OTB, o admin da loja e o super admin passam o portão (as recusas que sobram são as de sempre); servidor e service_role passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const u of [U_EDITA, U_ADMIN, SUPER]) {
        const fx = await fixture(c);
        await jwt(c, u);
        for (const t of BK5_TABELAS) {
          expect(
            txt(
              await cli(c, `update public.${t} set tenant_id = tenant_id where id = $1`, [fx[t]]),
            ),
            `${u} UPDATE ${t}`,
          ).toBe("PASSOU");
        }
        for (const k of [...invoker(fx), ...definer(fx), ...definer(null)]) {
          const r = txt(await cli(c, k.sql, k.p));
          expect(r, `${u} ${k.fn}`).not.toMatch(
            /sem_permissao_pagina|Módulo otb|permission denied/,
          );
        }
        await jwt(c, null);
      }
      // o caminho feliz de verdade (quem edita): salvar coleção, confirmar, desconfirmar, padrão do mix, PV, simulador
      const fx = await fixture(c);
      await jwt(c, U_EDITA);
      const col = (await cli(c, `select public.otb_salvar_colecao($1::jsonb) id`, [
        JSON.stringify({ nome: "ITEST B5 nova", subs: [] }),
      ])) as Res;
      expect(col.ok && col.rows[0]?.id).toBeTruthy();
      expect(txt(await cli(c, `select public.otb_confirmar($1)`, [fx.col]))).toBe("PASSOU");
      expect(txt(await cli(c, `select public.otb_desconfirmar($1)`, [fx.col]))).toBe("PASSOU");
      expect(
        txt(
          await cli(c, `select public.salvar_mix_padrao(null, 'ITEST B5 P3', '[]'::jsonb, null)`),
        ),
      ).toBe("PASSOU");
      expect(txt(await cli(c, `select public.aplicar_simulacao($1, $2)`, [fx.sim, fx.un]))).toBe(
        "PASSOU",
      );
      expect(
        (
          await um<{ q: number }>(c, `select qtd_planejada q from colecao_semanas where id = $1`, [
            fx.colecao_semanas,
          ])
        ).q,
      ).toBe(3);
      await jwt(c, null);
      expect(
        txt(await como(c, null, `update colecoes set nome = 'servidor' where id = $1`, [fx.col])),
      ).toBe("PASSOU");
      expect(
        txt(
          await como(c, "service_role", `update colecoes set nome = 'service' where id = $1`, [
            fx.col,
          ]),
        ),
      ).toBe("PASSOU");
    });
  });

  it("módulo OTB desligado: a mensagem do MÓDULO vem antes da de página (gatilho, INVOKER e as 9 DEFINER)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await modulos(c, { otb: false });
      await jwt(c, U_VE);
      for (const t of BK5_TABELAS) {
        expect(
          txt(await cli(c, `update public.${t} set tenant_id = tenant_id where id = $1`, [fx[t]])),
          t,
        ).toBe(OTB_OFF);
      }
      for (const k of invoker(fx))
        expect(txt(await cli(c, k.sql, k.p)), k.fn).toMatch(/^42501 Módulo otb não habilitado/);
      for (const k of [...definer(fx), ...definer(null)])
        expect(txt(await cli(c, k.sql, k.p)), k.fn).toBe(OTB_OFF);
    });
  });

  it("Plan. Tecido de quem NÃO tem a página OTB continua salvando (o bump de colecoes é DEFINER); direto em colecoes, não", async () => {
    await withTx(async (c) => {
      await prepara(c);
      // B2 (rev 1x por transação): a coleção nasce numa subtransação (SAVEPOINT) e o Salvar roda fora dela — senão o bump pula
      await c.query("SAVEPOINT bk5_col");
      const col = await semJwt(c, async () =>
        um<{ id: string; plan_rev: number }>(
          c,
          `insert into colecoes (tenant_id, nome) values ($1, 'ITEST B5 PT') returning id, plan_rev`,
          [T],
        ),
      );
      await c.query("RELEASE SAVEPOINT bk5_col");
      await jwt(c, U_PT);
      expect(
        txt(await cli(c, `select public.salvar_plan_tecido($1, '{}'::jsonb, null)`, [col.id])),
      ).toBe("PASSOU");
      await jwt(c, null);
      expect(
        (await um<{ r: number }>(c, `select plan_rev r from colecoes where id = $1`, [col.id])).r,
      ).toBe(col.plan_rev + 1);
      await jwt(c, U_PT);
      expect(txt(await cli(c, `update colecoes set nome = 'API' where id = $1`, [col.id]))).toBe(
        NEG,
      );
      expect(txt(await cli(c, `select public.otb_orcamento($1)`, [col.id]))).toBe("PASSOU");
    });
  });

  it("anti-drift (R2): DEFINER com o módulo otb = as 9 + leitura; INVOKER que gravam o OTB = as 6; o portão vem DEPOIS do módulo; gatilho nas 12", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const RE_TABS =
        "(colecoes|colecao_subcolecoes|colecao_semanas|colecao_semana_categorias|colecao_pv_itens|mix_padroes|mix_padrao_linhas|otb_simulacao_linhas|otb_simulacao_modelos|otb_simulacao_unidades|otb_simulacao_variantes|otb_simulacoes)";
      // MESMAS consultas do gerador (gerar-bk5.mjs) — manter iguais
      const esc = (
        await c.query<{ f: string; sd: boolean }>(
          `SELECT p.oid::regprocedure::text AS f, p.prosecdef AS sd FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
              AND lower(p.prosrc) ~ ('(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?' || $1 || '\\y') ORDER BY 1`,
          [RE_TABS],
        )
      ).rows;
      expect(
        esc
          .filter((r) => !r.sd)
          .map((r) => `public.${r.f}`)
          .sort(),
      ).toEqual([...BK5_INVOKER].sort());
      for (const r of esc.filter((x) => x.sd)) {
        expect(
          [...BK5_RPCS, ...BK5_DEFINER_FORA],
          `DEFINER ${r.f} grava o OTB fora da lista`,
        ).toContain(`public.${r.f}`);
      }
      const comMod = (
        await c.query<{ f: string; vol: string }>(
          `SELECT p.oid::regprocedure::text AS f, p.provolatile AS vol FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p') AND p.prosecdef
              AND p.prosrc ILIKE '%tenant_module_enabled(''otb'')%' ORDER BY 1`,
        )
      ).rows;
      expect(comMod.map((r) => `public.${r.f}`).sort()).toEqual(
        [...BK5_RPCS, ...BK5_LEITURA].sort(),
      );
      for (const r of comMod)
        if (BK5_LEITURA.includes(`public.${r.f}`)) expect(r.vol, r.f).toBe("s");
      // o portão: 1× em cada uma das 9 + gatilho, DEPOIS da checagem do módulo
      for (const fn of [BK_SENTINELA, ...BK5_RPCS]) {
        const d = (
          await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])
        ).d;
        expect(d.split("_seg_exige_pagina('otb')").length - 1, fn).toBe(1);
        expect(d.indexOf("_seg_exige_pagina('otb')"), fn).toBeGreaterThan(
          d.toLowerCase().indexOf("tenant_module_enabled('otb')"),
        );
      }
      // gatilho: as 12 tabelas, e só elas, chamam fn_seg_modulo_otb (BEFORE I/U/D por linha, ligado)
      const g = await c.query<{ t: string }>(
        `SELECT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
          WHERE NOT g.tgisinternal AND g.tgfoid = to_regprocedure($1) AND g.tgenabled = 'O' AND g.tgtype = 31 ORDER BY 1`,
        [BK_SENTINELA],
      );
      expect(g.rows.map((r) => r.t)).toEqual([...BK5_TABELAS].sort());
      for (const [sig, m] of Object.entries(BK5_DEPS)) expect(await md5Fn(c, sig), sig).toBe(m);
    });
  });

  it("migration: guarda/pós (md5, ACL, SECURITY, search_path, authenticated), ida 2× / _down 2× / ida; só catálogo nas travas", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaMod(c);
      await aplicaBk(c);
      await voltaBk(c); // estado de ANTES desta frente (B5 inclusa) dentro da txn
      await aplicaBk(c, "B3"); // os blocos anteriores à B5 de volta (B4/F2.1 nunca saem)
      for (const [fn, m] of Object.entries(BK_MD5)) expect(await md5Fn(c, fn), fn).toBe(m.antes);
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      // Travas vistas de FORA (2ª sessão), só a DIFERENÇA que o aplicarArquivo da B5 pegou.
      type Trava = { rel: string | null; nsp: string | null; mode: string };
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      const travas = async (): Promise<Trava[]> =>
        (
          await b.query(
            `SELECT c.relname AS rel, n.nspname AS nsp, l.mode
               FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation'`,
            [pid],
          )
        ).rows;
      const chave = (t: Trava) => `${t.nsp}.${t.rel}|${t.mode}`;
      let novas: Trava[] = [];
      try {
        const antes = new Set((await travas()).map(chave));
        await aplicarArquivo(c, BK_MIG);
        novas = (await travas()).filter((t) => !antes.has(chave(t)));
      } finally {
        await b.end();
      }
      expect(
        novas.filter((t) =>
          /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp ?? ""),
        ),
      ).toEqual([]);
      expect(novas.filter((t) => t.nsp === "public" && t.mode !== "AccessShareLock")).toEqual([]);
      expect(novas.filter((t) => t.mode === "AccessExclusiveLock")).toEqual([]);
      const confere = async (lado: "antes" | "depois") => {
        for (const [fn, m] of Object.entries(BK_MD5)) {
          expect(await md5Fn(c, fn), fn).toBe(m[lado]);
          const p = await um(
            c,
            `SELECT coalesce(proacl::text, '') AS acl, prosecdef AS sd, array_to_string(proconfig, '|') AS cfg,
                    has_function_privilege('anon', oid, 'EXECUTE') AS anon,
                    has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
               FROM pg_proc WHERE oid = to_regprocedure($1)`,
            [fn],
          );
          expect(p, fn).toEqual({
            acl: BK5_ACL[fn],
            sd: BK5_SEG[fn].secdef,
            cfg: BK5_SEG[fn].cfg,
            anon: false,
            auth: BK5_SEG[fn].authenticated,
          });
          const d = (
            await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])
          ).d;
          expect(d.includes("_seg_exige_pagina('otb')"), fn).toBe(lado === "depois");
        }
      };
      await confere("depois");
      await aplicarArquivo(c, BK_MIG); // idempotente
      await confere("depois");
      await aplicarArquivo(c, BK_DOWN);
      await confere("antes");
      await aplicarArquivo(c, BK_DOWN); // idempotente
      await confere("antes");
      await aplicarArquivo(c, BK_MIG);
      await confere("depois");
    });
  });

  it("guarda: recusa (P0001) com texto inesperado numa das 10 ou dependência mudada; nada muda", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaMod(c);
      await aplicaBk(c);
      await voltaBk(c);
      await aplicaBk(c, "B3");
      const FN = "public.otb_confirmar(uuid)";
      const antes = (
        await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])
      ).d;
      await c.query(antes.replace("begin\n", "begin\n  -- sonda\n"));
      await expect(aplicarArquivo(c, BK_MIG)).rejects.toThrow(
        /bk5_otb_pagina: public\.otb_confirmar\(uuid\) com texto inesperado/,
      );
      await expect(aplicarArquivo(c, BK_DOWN)).rejects.toThrow(
        /bk5_otb_pagina_down: public\.otb_confirmar\(uuid\) com texto inesperado/,
      );
      await c.query(antes);
      // dependência (helper do portão) com outro texto: a ida recusa
      const DEP = "public._seg_exige_pagina(text[])";
      const dep = (
        await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [DEP])
      ).d;
      await c.query(dep.replace("BEGIN\n", "BEGIN\n  -- sonda\n"));
      await expect(aplicarArquivo(c, BK_MIG)).rejects.toThrow(
        /bk5_otb_pagina: dependencia public\._seg_exige_pagina\(text\[\]\)/,
      );
      await c.query(dep);
      for (const [fn, m] of Object.entries(BK_MD5)) expect(await md5Fn(c, fn), fn).toBe(m.antes);
    });
  });

  it("cadeia LIFO dos testes: md5ModSucessor (Mod T2 → B5) e s4Viva aceitam a B5; voltaModSePreciso/voltaS4SePreciso tiram a B5 primeiro", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const X = "public.otb_excluir_colecao(uuid)";
      expect(md5ModSucessor(X, BK_MD5[X].antes)).toEqual([BK_MD5[X].antes, BK_MD5[X].depois]);
      expect(md5ModSucessor(BK_SENTINELA, BK_MD5[BK_SENTINELA].antes)).toEqual([
        BK_MD5[BK_SENTINELA].antes,
        BK_MD5[BK_SENTINELA].depois,
      ]);
      await aplicaMod(c);
      await aplicaBk(c, "B5");
      expect(await bkViva(c, "B5")).toBe(true);
      const { s4Viva, voltaS4SePreciso } = await import("./seg-s4-helpers");
      expect(await s4Viva(c)).toBe(true); // a S4 segue "viva" com o gatilho da B5 por cima
      await voltaModSePreciso(c);
      expect(await bkViva(c, "B5")).toBe(false);
      expect(await md5Fn(c, BK_SENTINELA)).toBe(BK_MD5[BK_SENTINELA].antes);
      await aplicaMod(c); // a volta da Mod foi além da B3 (Mod T1): a Mod volta antes do Backend
      await aplicaBk(c, "B5");
      expect(await bkViva(c, "B5")).toBe(true);
      await voltaS4SePreciso(c); // LIFO: tira o Backend (B5) e depois a S4 — sem recusa de md5
      expect(await bkViva(c, "B5")).toBe(false);
      expect(await s4Viva(c)).toBe(false);
    });
  });
});
