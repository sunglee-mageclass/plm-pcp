// Reforço de segurança — sub-release S4 ("Brechas de módulo": C1 OTB, C2 Plan. Tecido), REAVALIADA sem CREATE POLICY (s4-report.md):
// C1 = gatilho de módulo (INVOKER, só authenticated/anon) nas 12 tabelas do OTB ('otb') e em colecao_mixes ('criacao') + TRUNCATE fora;
// C2 = já fechado pela S3d (as plan_tecido_* sem escrita do cliente + as RPCs conferem 'criacao') — a S4 exige esse estado e prova aqui.
// As migrations são aplicadas DENTRO da transação de cada teste (mig-txn) e tudo é revertido. SÓ na cópia local. Roda como o papel do
// PostgREST (SET LOCAL ROLE authenticated) com JWT de usuário COMUM criado na txn.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS4, voltaS4, s4Viva, S4_MIGS, S4_DOWNS, S4_DOWN_DROP, S4_TABELAS_TRAVA } from "./seg-s4-helpers";
import { S4_FUNCOES, S4_ACL, S4_OTB, S4_MIX, S4_PLAN_TECIDO, S4_POLICIES_ANTES } from "./seg-s4-dados";
import { aclTabela } from "./seg-s2-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0054-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0054-0000-4000-8000-0000000000a1";
const TABELAS = Object.keys(S4_ACL);
const RAND = "00000000-5e9a-4054-8000-00000000dead";
const R = `'${RAND}'::uuid`;
const OTB_OFF = "42501 Módulo otb não habilitado para esta loja";
const CRIACAO_OFF = "42501 Módulo criacao não habilitado para esta loja";

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | "service_role" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s4w");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s4w");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s4w");
    await c.query("RELEASE SAVEPOINT s4w");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const NEG = (paginas: string[]) => `42501 sem_permissao_pagina: ${paginas.join("|")}`;
const NEGADO_GRANT = /^42501 permission denied for (table|column)/;
/** Como `authenticated` e TEM de passar: devolve as linhas (falha do teste mostra o erro real). */
async function ok(c: Client, sql: string, params: any[] = []): Promise<any[]> {
  const r = await como(c, "authenticated", sql, params);
  if (!r.ok) throw new Error(`esperava passar: ${sql}\n→ ${r.code} ${r.msg}`);
  return r.rows;
}
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function usuario(c: Client, uid: string, admin: boolean): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, $4, 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `S4 ${admin ? "admin" : "comum"}`],
  );
  if (admin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [uid]);
}
/** Permissões por página do usuário comum: TROCA todas as de antes pelas dadas ([pagina, editar]). */
async function perms(c: Client, uid: string, lista: [string, boolean][]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    for (const [pagina, editar] of lista) {
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)`,
        [uid, T, pagina, editar]);
    }
  });
}
const edita = (...ps: string[]): [string, boolean][] => ps.map((p) => [p, true]);
async function modulo(c: Client, chave: string, ligado: boolean): Promise<void> {
  await semJwt(c, () => c.query(
    `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE tenant_id = $1`,
    [T, chave, ligado],
  ));
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaS4(c); // idempotente (aplica a S3d/S3a antes se faltarem; S4_TXN=1 já aplicou: a guarda aceita o "depois")
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_COMUM, false);
  await usuario(c, U_ADMIN, true);
  for (const m of ["entrada_saida", "financeiro", "criacao", "producao", "produto_acabado", "produto_importado", "otb"]) await modulo(c, m, true);
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}



// ───────────── fixture: uma linha em CADA uma das 13 tabelas (como postgres, sem JWT) ─────────────
type Fx = Record<string, string> & { col: string; cat: string; padrao: string; sim: string; un: string; art: string; vari: string };
async function fixture(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const id = async (sql: string, p: any[]) => (await um<{ id: string }>(c, sql, p)).id;
    const cat = await id(`insert into categorias_produto (tenant_id, nome) values ($1, 'ITEST S4 cat') returning id`, [T]);
    const col = await id(`insert into colecoes (tenant_id, nome, status) values ($1, 'ITEST S4 col', 'rascunho') returning id`, [T]);
    const sub = await id(`insert into colecao_subcolecoes (tenant_id, colecao_id, nome) values ($1, $2, 'Sub S4') returning id`, [T, col]);
    const sem = await id(`insert into colecao_semanas (tenant_id, colecao_id, semana, subcolecao_id) values ($1, $2, 1, $3) returning id`, [T, col, sub]);
    const semcat = await id(`insert into colecao_semana_categorias (tenant_id, colecao_id, semana, categoria_id, subcolecao_id) values ($1, $2, 1, $3, $4) returning id`, [T, col, cat, sub]);
    const pv = await id(`insert into colecao_pv_itens (tenant_id, colecao_id, subcolecao_id) values ($1, $2, $3) returning id`, [T, col, sub]);
    const padrao = await id(`insert into mix_padroes (tenant_id, nome) values ($1, 'ITEST S4 padrão') returning id`, [T]);
    const padraoLinha = await id(`insert into mix_padrao_linhas (tenant_id, padrao_id) values ($1, $2) returning id`, [T, padrao]);
    const sim = await id(`insert into otb_simulacoes (tenant_id, colecao_id, nome) values ($1, $2, 'ITEST S4 cenário') returning id`, [T, col]);
    const un = await id(`insert into otb_simulacao_unidades (tenant_id, simulacao_id) values ($1, $2) returning id`, [T, sim]);
    const simLinha = await id(`insert into otb_simulacao_linhas (tenant_id, unidade_id) values ($1, $2) returning id`, [T, un]);
    const simModelo = await id(`insert into otb_simulacao_modelos (tenant_id, linha_ref_id) values ($1, $2) returning id`, [T, simLinha]);
    const simVar = await id(`insert into otb_simulacao_variantes (tenant_id, unidade_id) values ($1, $2) returning id`, [T, un]);
    const mix = await id(`insert into colecao_mixes (tenant_id, colecao_id, subcolecao, nome, ordem) values ($1, $2, null, 'ITEST S4 família', 0) returning id`, [T, col]);
    const art = await id(`insert into artigos (tenant_id, nome, unidade_medida, rendimento) values ($1, 'ITEST S4 art', 'metro', 1) returning id`, [T]);
    const vari = await id(`insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S4') returning id`, [T, art]);
    return {
      col, cat, padrao, sim, un, art, vari,
      colecoes: col, colecao_subcolecoes: sub, colecao_semanas: sem, colecao_semana_categorias: semcat, colecao_pv_itens: pv,
      mix_padroes: padrao, mix_padrao_linhas: padraoLinha, otb_simulacoes: sim, otb_simulacao_unidades: un,
      otb_simulacao_linhas: simLinha, otb_simulacao_modelos: simModelo, otb_simulacao_variantes: simVar, colecao_mixes: mix,
    } as Fx;
  });
}

// ─────────────────────────────────────────── md5, ACL, idempotência, volta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S4 — md5, ACL, idempotência e volta (LIFO); NENHUMA policy", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES; _down_drop apaga; ida de novo = DEPOIS; policies nunca mudam", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const politicas = async () => (await um<{ n: number }>(c, `select count(*)::int n from pg_policy`)).n;
      const confereIda = async () => {
        for (const f of S4_FUNCOES) {
          expect(await md5(c, f.fn), f.fn).toBe(f.depois);
          for (const t of f.tabelas) {
            const trg = await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgrelid = to_regclass('public.' || $1)
                and tgname = 'trg_aaa_seg_modulo' and tgenabled = 'O' and tgtype = 31 and tgfoid = to_regprocedure($2)`, [t, f.fn]);
            expect(trg.n, t).toBe(1);
          }
        }
        for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S4_ACL[t].depois);
      };
      const { aplicaS3d, s3dViva } = await import("./seg-s3d-helpers");
      if (!(await s3dViva(c))) await aplicaS3d(c);
      const pol0 = await politicas();
      await aplicaS4(c);
      await confereIda();
      await aplicaS4(c);
      await confereIda();
      expect(await politicas()).toBe(pol0);
      await voltaS4(c);
      for (const f of S4_FUNCOES) expect(await md5(c, f.fn), f.fn).toBe(f.neutra);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S4_ACL[t].antes);
      await voltaS4(c);
      await aplicarArquivo(c, S4_DOWN_DROP);
      for (const f of S4_FUNCOES) expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [f.fn])).f).toBeNull();
      expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_aaa_seg_modulo'`)).n).toBe(0);
      await aplicarArquivo(c, S4_DOWN_DROP);
      await aplicaS4(c);
      await confereIda();
      expect(await politicas()).toBe(pol0);
    });
  });

  it("recusas: _down_drop sem o _down; inverso sem a ida; S4 sem a S3d (C2 ainda aberto) recusa", async () => {
    await withTx(async (c) => {
      await aplicaS4(c);
      await expect(aplicarArquivo(c, S4_DOWN_DROP)).rejects.toThrow(/s4_guarda_down_drop: rode antes o _down/);
      await voltaS4(c, true);
      await expect(aplicarArquivo(c, S4_DOWNS[0])).rejects.toThrow(/s4_guarda_down: .* com texto inesperado \(md5 ausente\)/);
      await aplicarArquivo(c, S4_DOWNS[1]); // grants de volta (idempotente)
      const { voltaS3d } = await import("./seg-s3d-helpers");
      await voltaS3d(c);
      await expect(aplicarArquivo(c, S4_MIGS[0])).rejects.toThrow(/s4_grants: rode antes a S3d 20261101200000/);
    });
  });

  it("grants só sobre a ACL medida: ACL fora do antes/depois → ida E volta recusam P0001", async () => {
    await withTx(async (c) => {
      await aplicaS4(c);
      await c.query("GRANT TRUNCATE ON public.colecoes TO authenticated");
      await expect(aplicarArquivo(c, S4_MIGS[0])).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s4_grants: ACL inesperada em colecoes/) });
      await expect(aplicarArquivo(c, S4_DOWNS[1])).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s4_grants_down: ACL inesperada em colecoes/) });
      await c.query("REVOKE TRUNCATE ON public.colecoes FROM authenticated");
      await aplicarArquivo(c, S4_DOWNS[1]);
      await aplicarArquivo(c, S4_DOWNS[1]);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S4_ACL[t].antes);
      await aplicarArquivo(c, S4_MIGS[0]);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S4_ACL[t].depois);
    });
  });
});

describe.skipIf(!RODA)("seg S4 — fix round: ordem de volta (S5 → S4 → S3d) e policies antes = depois", () => {
  const S3D_200_DOWN = "supabase/rollback/20261101200000_seg_s3d_grants_planejamento_down.sql";

  it("B1: a volta dos grants da S3d RECUSA com o gatilho de módulo da S4 ativo; passa depois do 230000_down (funções neutras)", async () => {
    await withTx(async (c) => {
      await aplicaS4(c);
      await expect(aplicarArquivo(c, S3D_200_DOWN)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s3d_grants_down: rode antes a volta da S4 20261101230000_down\/220000_down/) });
      await aplicarArquivo(c, S4_DOWNS[0]); // 230000_down: gatilhos de módulo neutros
      await aplicarArquivo(c, S3D_200_DOWN); // agora passa (C2 já não é exigido por ninguém)
      expect((await um<{ v: boolean }>(c, `select has_table_privilege('authenticated', 'public.plan_tecido_slots', 'INSERT') v`)).v).toBe(true);
    });
  });

  it("B2: a pós-condição da 220000 compara a contagem de policies ANTES × DEPOIS da própria execução (sem número fixo)", async () => {
    await withTx(async (c) => {
      await aplicaS4(c);
      await c.query(`create policy zz_s4_fix_round on public.colecoes for select to authenticated using (false)`); // outra frente
      await aplicarArquivo(c, S4_MIGS[0]); // antes: 97 fixas recusaria; agora passa
      const src = (await import("node:fs")).readFileSync(S4_MIGS[0], "utf8");
      expect(src).toContain("current_setting('seg_s4.policies_antes')");
      expect(src).not.toMatch(/\) <> \d+ THEN/);
    });
  });

  it("LIFO S5: com a S5 no banco, os inversos da S4 (230000/220000) e o dos grants da S3d RECUSAM; sem ela, passam", async () => {
    await withTx(async (c) => {
      // LIFO: o Backend sai antes (a B5, 20261103148000, redefine fn_seg_modulo_otb — o inverso da S4 recusaria pelo md5 dela,
      // não pela S5 que este caso prova)
      const { voltaBkSePreciso } = await import("./bk-helpers");
      await voltaBkSePreciso(c);
      const { aplicaS5, voltaS5 } = await import("./seg-s5-helpers");
      await aplicaS5(c);
      await expect(aplicarArquivo(c, S4_DOWNS[0])).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s4_guarda_down: rode antes a volta da S5 20261101240000_down/) });
      await expect(aplicarArquivo(c, S4_DOWNS[1])).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s4_grants_down: rode antes a volta da S5 20261101240000_down/) });
      // a da S3d: sem o gatilho de módulo da S4 no caminho (renomeado só aqui, na txn), quem barra é a S5
      await c.query(`alter function public.fn_seg_modulo_otb() rename to fn_seg_modulo_otb_fora`);
      await expect(aplicarArquivo(c, S3D_200_DOWN)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s3d_grants_down: rode antes a volta da S5 20261101240000_down/) });
      await c.query(`alter function public.fn_seg_modulo_otb_fora() rename to fn_seg_modulo_otb`);
      await voltaS5(c);
      await aplicarArquivo(c, S4_DOWNS[0]);
      await aplicarArquivo(c, S4_DOWNS[1]);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S4_ACL[t].antes);
    });
  });
});

describe.skipIf(!RODA)("seg S4 — trava medida (pg_locks na txn revertida) e Realtime", () => {
  it("grants: catálogo; gatilhos: ShareRowExclusive SÓ nas 13 tabelas; nada em auth/storage/realtime; nenhuma AccessExclusive", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows as { rel: string; mode: string }[];
      const chave = (t: { rel: string; mode: string }) => `${t.rel}|${t.mode}`;
      // Ruling R6 (frente Backend): travas que os ganchos MOD_TXN/BK_TXN já pegaram no começo da txn (ex.: o índice novo da B4
      // numa cópia sem ela) não são da S4 — a checagem "nenhuma AccessExclusive" olha só o que veio depois daqui.
      const inicio = new Set((await travas()).map(chave));
      const TREZE = [...S4_TABELAS_TRAVA].sort().map((rel) => ({ rel, mode: "ShareRowExclusiveLock" }));
      const { aplicaS3d, s3dViva } = await import("./seg-s3d-helpers");
      let base: Set<string>;
      const novas = async () => (await travas()).filter((t) => !base.has(chave(t)));
      if (!(await s4Viva(c))) {
        if (!(await s3dViva(c))) await aplicaS3d(c);
        base = new Set((await travas()).map(chave));
        await aplicarArquivo(c, S4_MIGS[0]);
        expect(await novas()).toEqual([]);
        await aplicarArquivo(c, S4_MIGS[1]);
        expect(await novas()).toEqual(TREZE);
      } else {
        base = new Set((await travas()).map(chave));
        await aplicaS4(c);
        expect(await novas()).toEqual([]);
      }
      expect((await travas()).filter((t) => !inicio.has(chave(t)) && /AccessExclusive|^ExclusiveLock/.test(t.mode))).toEqual([]);
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
    });
  });

  it("Realtime: nenhuma policy nova (nem de SELECT) nas 13 do OTB/mix nem nas plan_tecido_*; SELECT do cliente intacto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const n = await um<{ n: number }>(c, `select count(*)::int n from pg_policy where polrelid = any ($1::regclass[])`,
        [[...TABELAS, ...S4_PLAN_TECIDO].map((t) => `public.${t}`)]);
      expect(n.n).toBe(S4_POLICIES_ANTES);
      expect((await um<{ n: number }>(c, `select count(*)::int n from pg_policy where polname like 'modgate%'
          and polrelid = any ($1::regclass[])`, [[...TABELAS, ...S4_PLAN_TECIDO].map((t) => `public.${t}`)])).n).toBe(0);
      const fx = await fixture(c);
      await modulo(c, "otb", false);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("otb"));
      for (const t of TABELAS) expect(txt(await como(c, "authenticated", `select count(*) from ${t} where id = $1`, [fx[t]])), t).toBe("PASSOU");
    });
  });
});

// ─────────────────────────────────────────── C1: OTB ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S4 — C1: com o OTB desligado a loja não grava nada de OTB (direto nem por RPC); ligado, tudo funciona", () => {
  it("OTB desligado: UPDATE/DELETE/INSERT direto nas 12 → 42501; RPCs INVOKER (inclusive excluir_mix_padrao, que não conferia) → 42501; super passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await modulo(c, "otb", false);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("otb"));
      for (const t of S4_OTB) {
        expect(txt(await como(c, "authenticated", `update ${t} set tenant_id = tenant_id where id = $1`, [fx[t]])), t).toBe(OTB_OFF);
      }
      expect(txt(await como(c, "authenticated", `delete from otb_simulacao_variantes where id = $1`, [fx.otb_simulacao_variantes]))).toBe(OTB_OFF);
      expect(txt(await como(c, "authenticated", `insert into colecoes (nome, status) values ('API', 'rascunho')`))).toBe(OTB_OFF);
      expect(txt(await como(c, "authenticated", `insert into mix_padroes (nome) values ('API')`))).toBe(OTB_OFF);
      for (const t of TABELAS) expect(txt(await como(c, "authenticated", `truncate ${t}`)), t).toMatch(/^42501 permission denied for table/);
      // RPCs: a de excluir_mix_padrao (INVOKER) NÃO conferia o módulo — agora o gatilho confere
      expect(txt(await como(c, "authenticated", `select public.excluir_mix_padrao($1)`, [fx.padrao]))).toBe(OTB_OFF);
      expect(txt(await como(c, "authenticated", `select public.salvar_mix_padrao(null, 'X', '[]'::jsonb, null)`))).toMatch(/^42501 Módulo otb não habilitado/);
      expect(txt(await como(c, "authenticated", `select public.excluir_simulacao($1)`, [fx.sim]))).toMatch(/^42501 Módulo otb não habilitado/);
      expect(txt(await como(c, "authenticated", `select public.otb_salvar_colecao($1::jsonb)`, [JSON.stringify({ nome: "X", subs: [] })])))
        .toMatch(/^42501 Módulo otb não habilitado/);
      expect((await um<{ n: number }>(c, `select count(*)::int n from mix_padroes where id = $1`, [fx.padrao])).n).toBe(1);
      // super admin passa (tenant_module_enabled = true para ele); servidor e service_role passam
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", `update colecoes set nome = 'super' where id = $1`, [fx.col]))).toBe("PASSOU");
      await jwt(c, null);
      expect(txt(await como(c, null, `update colecoes set nome = 'servidor' where id = $1`, [fx.col]))).toBe("PASSOU");
      expect(txt(await como(c, "service_role", `update colecoes set nome = 'service' where id = $1`, [fx.col]))).toBe("PASSOU");
    });
  });

  it("a brecha existia: SEM a S4, com o OTB desligado, o usuário grava direto e exclui padrão pela RPC; COM a S4, 42501", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const { voltaS4SePreciso } = await import("./seg-s4-helpers");
      await voltaS4SePreciso(c);
      await modulo(c, "otb", false);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("otb"));
      const tentar = async () => [
        txt(await como(c, "authenticated", `update colecoes set nome = 'pela API' where id = $1`, [fx.col])),
        txt(await como(c, "authenticated", `update mix_padroes set nome = 'pela API' where id = $1`, [fx.padrao])),
      ];
      expect(await tentar()).toEqual(["PASSOU", "PASSOU"]); // a brecha (C1)
      await jwt(c, null);
      await aplicaS4(c);
      await jwt(c, U_COMUM);
      expect(await tentar()).toEqual([OTB_OFF, OTB_OFF]);
    });
  });

  it("OTB ligado (usuário comum com a página OTB): coleção, Poder de Venda, Padrão do mix, simulador (salvar/aplicar/excluir) e as 12 tabelas direto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("otb"));
      for (const t of S4_OTB) {
        expect(txt(await como(c, "authenticated", `update ${t} set tenant_id = tenant_id where id = $1`, [fx[t]])), t).toBe("PASSOU");
      }
      // Coleção (DEFINER)
      const col = (await ok(c, `select public.otb_salvar_colecao($1::jsonb) id`,
        [JSON.stringify({ nome: "ITEST S4 coleção", subs: [{ nome: "SubA", weeks: { "1": 10 }, cats: { "1": { [fx.cat]: 4 } } }] })]))[0].id;
      expect(col).toBeTruthy();
      // Padrão do mix (INVOKER)
      const padrao = (await ok(c, `select public.salvar_mix_padrao(null, 'ITEST S4 padrão 2', '[]'::jsonb, null) id`))[0].id;
      await ok(c, `select public.excluir_mix_padrao($1)`, [padrao]);
      // Poder de Venda (INVOKER)
      expect(txt(await como(c, "authenticated", `select public.salvar_colecao_pv(null, $1::jsonb, '[]'::jsonb)`,
        [JSON.stringify({ nome: "ITEST S4 PV" })]))).not.toMatch(/Módulo|permission denied/);
      // Simulador (INVOKER): salvar → aplicar → excluir
      const oc = await semJwt(c, async () => (await um<{ id: string }>(c,
        `insert into ocs_tecido (tenant_id, numero_pedido, status) values ($1, 'ITEST-S4', 'rascunho') returning id`, [T])).id);
      const item = await semJwt(c, async () => (await um<{ id: string }>(c,
        `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1, $2, 100) returning id`, [oc, fx.art])).id);
      const simId = (await ok(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) id`, [
        JSON.stringify({ colecao_id: fx.col, nome: "ITEST S4 cenário 2" }),
        JSON.stringify([{ subcolecao_id: null, oc_tecido_id: oc, variantes: [{ oc_tecido_item_id: item }],
          linhas: [{ linha_id: null, prof_cor: 8, cores: 1, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 1.2 }] }] }]),
      ]))[0].id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id = $1`, [simId])).id;
      expect(txt(await como(c, "authenticated", `select public.aplicar_simulacao($1, $2)`, [simId, unId]))).not.toMatch(/Módulo|permission denied/);
      await ok(c, `select public.excluir_simulacao($1)`, [simId]);
    });
  });

  it("colecao_mixes (famílias) segue o módulo Criação, não o OTB: Plan. Tecido sem OTB grava família; Criação desligada → 42501", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await modulo(c, "otb", false);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("criacao_plan_tecido"));
      const mix = (await ok(c, `select public.salvar_colecao_mix(null, $1, null, 'ITEST S4 família PT') id`, [fx.col]))[0].id;
      await ok(c, `select public.excluir_colecao_mix($1)`, [mix]);
      await modulo(c, "criacao", false);
      expect(txt(await como(c, "authenticated", `select public.salvar_colecao_mix(null, $1, null, 'X')`, [fx.col]))).toBe(CRIACAO_OFF);
      expect(txt(await como(c, "authenticated", `select public.excluir_colecao_mix($1)`, [fx.colecao_mixes]))).toBe(CRIACAO_OFF);
      expect(txt(await como(c, "authenticated", `update colecao_mixes set nome = 'x' where id = $1`, [fx.colecao_mixes]))).toBe(CRIACAO_OFF);
    });
  });
});

// ─────────────────────────────────────────── C2: Plan. Tecido ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S4 — C2: Plan. Tecido (fechado pela S3d; provado aqui)", () => {
  it("as 12 plan_tecido_* graváveis: nem o super escreve direto; com a Criação desligada as RPCs recusam 42501; ligada, o salvar funciona", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, SUPER);
      for (const t of S4_PLAN_TECIDO) {
        expect(txt(await como(c, "authenticated", `update ${t} set id = id where false`)), t).toMatch(/^42501 permission denied for table/);
        expect(txt(await como(c, "authenticated", `insert into ${t} select * from ${t} where false`)), t).toMatch(/^42501 permission denied for table/);
        expect(txt(await como(c, "authenticated", `delete from ${t} where false`)), t).toMatch(/^42501 permission denied for table/);
      }
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("criacao_plan_tecido"));
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, nome: "S4", materiais: [] }] }] }] };
      await ok(c, `select public.salvar_plan_tecido($1, $2::jsonb, null)`, [fx.col, JSON.stringify(arvore)]);
      await modulo(c, "criacao", false);
      for (const sql of [
        `select public.salvar_plan_tecido(${R}, '{}'::jsonb, null)`,
        `select public.plan_tecido_criar_cards(${R}, '[]'::jsonb)`,
        `select public.plan_tecido_set_paleta(${R}, '[]'::jsonb)`,
        `select public.replicar_cards_plan_tecido(${R}, null, array[]::uuid[], null)`,
      ]) expect(txt(await como(c, "authenticated", sql)), sql).toMatch(/^42501 Módulo (criacao|de Criação)/);
    });
  });
});
