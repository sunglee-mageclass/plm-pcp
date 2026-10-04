// Reforço de segurança — sub-release S3d ("Planejamento, produtos, Plan. Tecido e importação"), a última da S3. Desenho:
// .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A). As
// migrations (S3a por baixo + S3d) são aplicadas DENTRO da transação de cada teste (mig-txn) e tudo é revertido: nada é gravado na
// cópia. SÓ na cópia local. Privilégio e gatilho rodam DE VERDADE como o papel do PostgREST (SET LOCAL ROLE authenticated) com JWT
// de usuário COMUM criado na txn, com permissões por página explícitas. modelos é gravada por muitas telas: há um ponta a ponta
// por tela que grava modelos (Sheet/Plan. Produto, Dev, Plan. Tecido, Produto Acabado, Produto Importado, Importar Dados).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS3d, voltaS3d, s3dViva, S3D_MIGS, S3D_DOWNS, S3D_DOWN_DROP, S3D_TABELAS_TRAVA } from "./seg-s3d-helpers";
import { S3D_MD5, S3D_PAGINAS, S3D_GATILHOS, S3D_ACL, S3D_COLUNAS_PRODUTO, S3D_SO_RPC, S3D_PLAN_TECIDO } from "./seg-s3d-dados";
import { aclTabela } from "./seg-s2-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0054-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0054-0000-4000-8000-0000000000a1";
const TABELAS = Object.keys(S3D_ACL);
const RAND = "00000000-5e9a-4054-8000-00000000dead";
const R = `'${RAND}'::uuid`;
const PLAN = "criacao_planejamento";
const DEV = "criacao_desenvolvimento";
const PLANTEC = "criacao_plan_tecido";
const PA = "criacao_produto_acabado";
const PI = "criacao_produto_importado";
const PRECO = "criacao_planejamento:preco_venda";
const MIX_ONLY = [PLAN, DEV, PLANTEC, PA, PI];

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | "service_role" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s3w");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s3w");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s3w");
    await c.query("RELEASE SAVEPOINT s3w");
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
    [uid, T, `${uid}@teste`, `S3d ${admin ? "admin" : "comum"}`],
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
  await aplicaS3d(c); // idempotente (aplica a S3a antes se faltar; S3D_TXN=1 já aplicou: a guarda aceita o "depois")
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_COMUM, false);
  await usuario(c, U_ADMIN, true);
  for (const m of ["entrada_saida", "financeiro", "criacao", "producao", "produto_acabado", "produto_importado", "otb"]) await modulo(c, m, true);
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}



// ───────────── fixture (como postgres, sem JWT) ─────────────
type Fx = { outra: string; grupo: string; cat: string; col: string; modelo: string; modelo2: string; modeloOutra: string;
  revenda: string; prodPA: string; prodPI: string; mix: string };
async function fixture(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const outra = (await um<{ id: string }>(c, `select id from tenants where id <> $1 order by id limit 1`, [T])).id;
    const grupo = (await um<{ id: string }>(c, `insert into grupos_produto (tenant_id, nome) values ($1, 'ITEST S3d grupo') returning id`, [T])).id;
    const cat = (await um<{ id: string }>(c, `insert into categorias_produto (tenant_id, nome) values ($1, 'ITEST S3d cat') returning id`, [T])).id;
    const col = (await um<{ id: string }>(c, `insert into colecoes (tenant_id, nome, status) values ($1, 'ITEST S3d col', 'rascunho') returning id`, [T])).id;
    const modelo = (await um<{ id: string }>(c,
      `insert into modelos (tenant_id, nome, colecao_id, categoria_principal_id) values ($1, 'ITEST-S3d card', $2, $3) returning id`, [T, col, cat])).id;
    const modelo2 = (await um<{ id: string }>(c,
      `insert into modelos (tenant_id, nome, colecao_id, categoria_principal_id) values ($1, 'ITEST-S3d card 2', $2, $3) returning id`, [T, col, cat])).id;
    const modeloOutra = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome, ref) values ($1, 'ITEST-S3d OUTRA', 'S3D-OUTRA') returning id`, [outra])).id;
    const revenda = (await um<{ id: string }>(c,
      `insert into modelos (tenant_id, nome, origem, categoria_principal_id) values ($1, 'ITEST-S3d revenda', 'revenda', $2) returning id`, [T, cat])).id;
    const prodPA = (await um<{ id: string }>(c,
      `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id) values ($1, 'ITEST S3d PA', $2, $3) returning id`, [T, grupo, cat])).id;
    const prodPI = (await um<{ id: string }>(c,
      `insert into produtos_importados (tenant_id, nome, grupo_id, categoria_id) values ($1, 'ITEST S3d PI', $2, $3) returning id`, [T, grupo, cat])).id;
    const mix = (await um<{ id: string }>(c,
      `insert into colecao_mixes (tenant_id, colecao_id, subcolecao, nome, ordem) values ($1, $2, null, 'ITEST S3d mix', 0) returning id`, [T, col])).id;
    return { outra, grupo, cat, col, modelo, modelo2, modeloOutra, revenda, prodPA, prodPI, mix };
  });
}

// ─────────────────────────────────────────── md5, ACL, idempotência, volta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3d — md5, ACL, idempotência e volta (LIFO)", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES (textos e ACL exatos); _down_drop apaga; ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const confereIda = async () => {
        for (const [sig, m] of Object.entries(S3D_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
        for (const g of S3D_GATILHOS) {
          expect(await md5(c, g.fn), g.fn).toBe(g.depois);
          const trg = await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgrelid = to_regclass('public.' || $1)
              and tgname = 'trg_aaa_seg_pagina' and tgenabled = 'O' and tgtype = $2`, [g.tabela, g.tgtype]);
          expect(trg.n, g.tabela).toBe(1);
        }
        for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3D_ACL[t].depois);
      };
      await aplicaS3d(c);
      await confereIda();
      await aplicaS3d(c);
      await confereIda();
      await voltaS3d(c);
      for (const [sig, m] of Object.entries(S3D_MD5)) expect(await md5(c, sig), sig).toBe(m.antes);
      for (const g of S3D_GATILHOS) expect(await md5(c, g.fn), g.fn).toBe(g.neutra);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3D_ACL[t].antes);
      expect((await um<{ l: string }>(c, `select l.lanname l from pg_proc p join pg_language l on l.oid = p.prolang
          where p.oid = 'public.excluir_colecao_mix(uuid)'::regprocedure`)).l).toBe("sql");
      await voltaS3d(c);
      await aplicarArquivo(c, S3D_DOWN_DROP);
      for (const g of S3D_GATILHOS) {
        expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [g.fn])).f).toBeNull();
        expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_aaa_seg_pagina'
            and tgrelid = to_regclass('public.' || $1)`, [g.tabela])).n).toBe(0);
      }
      await aplicarArquivo(c, S3D_DOWN_DROP);
      await aplicaS3d(c);
      await confereIda();
    });
  });

  it("recusas de ordem: _down_drop sem o _down; inverso sem a ida; S3d sem o helper da S3a", async () => {
    await withTx(async (c) => {
      await aplicaS3d(c);
      await expect(aplicarArquivo(c, S3D_DOWN_DROP)).rejects.toThrow(/s3d_guarda_down_drop: rode antes o _down/);
      await voltaS3d(c, true);
      await expect(aplicarArquivo(c, S3D_DOWNS[0])).rejects.toThrow(/s3d_guarda_down: .* com texto inesperado \(md5 ausente\)/);
      const { voltaS3a } = await import("./seg-s3a-helpers");
      await voltaS3a(c, true);
      await expect(aplicarArquivo(c, S3D_MIGS[0])).rejects.toThrow(/s3d_gates: rode antes a S3a 20261101100000/);
      await expect(aplicarArquivo(c, S3D_MIGS[2])).rejects.toThrow(/s3d_guarda: rode antes a S3a 20261101100000/);
    });
  });

  it("grants só sobre a ACL medida: ACL fora do antes/depois → ida E volta recusam P0001 sem mudar nada", async () => {
    await withTx(async (c) => {
      const IDA = S3D_MIGS[1];
      const VOLTA = S3D_DOWNS[1];
      await aplicaS3d(c);
      await c.query("GRANT INSERT ON public.plan_tecido_slots TO anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3d_grants: ACL inesperada em plan_tecido_slots/) });
      await expect(aplicarArquivo(c, VOLTA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3d_grants_down: ACL inesperada em plan_tecido_slots/) });
      await c.query("REVOKE INSERT ON public.plan_tecido_slots FROM anon");
      await aplicarArquivo(c, VOLTA);
      await c.query("REVOKE TRUNCATE ON public.modelos FROM anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3d_grants: ACL inesperada em modelos/) });
      await c.query("GRANT TRUNCATE ON public.modelos TO anon");
      await aplicarArquivo(c, IDA);
      await aplicarArquivo(c, IDA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3D_ACL[t].depois);
      await aplicarArquivo(c, VOLTA);
      await aplicarArquivo(c, VOLTA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3D_ACL[t].antes);
    });
  });
});

describe.skipIf(!RODA)("seg S3d — trava medida (pg_locks na txn revertida)", () => {
  it("RPCs e grants: catálogo; gatilhos: ShareRowExclusive SÓ em modelos, produtos_acabados e produtos_importados; nada em auth/storage", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows as { rel: string; mode: string }[];
      const chave = (t: { rel: string; mode: string }) => `${t.rel}|${t.mode}`;
      const TRES = [...S3D_TABELAS_TRAVA].sort().map((rel) => ({ rel, mode: "ShareRowExclusiveLock" }));
      let base: Set<string>;
      const novas = async () => (await travas()).filter((t) => !base.has(chave(t)));
      if (!(await s3dViva(c))) {
        const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers");
        if (!(await s3aViva(c))) await aplicaS3a(c);
        base = new Set((await travas()).map(chave));
        await aplicarArquivo(c, S3D_MIGS[0]);
        expect(await novas()).toEqual([]);
        await aplicarArquivo(c, S3D_MIGS[1]);
        expect(await novas()).toEqual([]);
        await aplicarArquivo(c, S3D_MIGS[2]);
        expect(await novas()).toEqual(TRES);
      } else {
        base = new Set((await travas()).map(chave));
        await aplicaS3d(c);
        expect(await novas()).toEqual([]);
        expect((await travas()).filter((t) => S3D_TABELAS_TRAVA.includes(t.rel))).toEqual(TRES);
      }
      // a de modelos é ShareRowExclusive (bloqueia INSERT/UPDATE/DELETE, não SELECT) — nada mais forte, em nenhuma tabela
      expect((await travas()).filter((t) => /AccessExclusive|^ExclusiveLock/.test(t.mode))).toEqual([]);
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
    });
  });

  // fix round (M1): as 3 travas vêm JUNTAS (LOCK TABLE produtos_acabados, produtos_importados, modelos) numa tentativa atômica.
  // Mede, com sessões REAIS segurando escrita: (a) quanto tempo uma escrita de usuário fica na fila; (b) que a migration solta tudo
  // entre as tentativas; (c) num deadlock de verdade, quem cai é a migration (40P01 tratado), nunca o usuário.
  const novaSessao = async () => {
    const { Client: PgClient } = await import("pg");
    const s = new PgClient({ connectionString: process.env.DATABASE_URL, ssl: false });
    await s.connect();
    return s;
  };
  const esperaMigrationNaFila = async (obs: { query: (q: string, p?: any[]) => Promise<any> }, pid: number) => {
    for (let i = 0; i < 100; i++) {
      const r = await obs.query("select count(*)::int n from pg_locks where pid = $1 and not granted", [pid]);
      if (r.rows[0].n > 0) return;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error("a migration não chegou a esperar trava");
  };
  const cronometra = async (s: { query: (q: string) => Promise<any> }, sql: string) => {
    const t0 = Date.now();
    await s.query(sql);
    return Date.now() - t0;
  };

  it("(a)+(b) escrita aberta em modelos noutra sessão: 3 tentativas atômicas e 55P03 (~6,5s); escritas de usuário em produtos/modelos esperam no máximo ~1,5s cada", async () => {
    const segura = await novaSessao();
    const usuario = await novaSessao();
    const obs = await novaSessao();
    try {
      await withTx(async (c) => {
        const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers");
        if (await s3dViva(c)) return; // gancho S3D_TXN: o gatilho já existe (nada a medir aqui)
        if (!(await s3aViva(c))) await aplicaS3a(c);
        await aplicarArquivo(c, S3D_MIGS[0]);
        await aplicarArquivo(c, S3D_MIGS[1]);
        const pid = (await um<{ p: number }>(c, "select pg_backend_pid() p")).p;
        await segura.query("BEGIN");
        await segura.query("UPDATE public.modelos SET nome = nome WHERE false"); // RowExclusive em modelos até o fim
        const t0 = Date.now();
        const mig = aplicarArquivo(c, S3D_MIGS[2]).then(() => "PASSOU", (e) => String(e.code));
        await esperaMigrationNaFila(obs, pid);
        const esperas: number[] = [];
        while (Date.now() - t0 < 6000) {
          esperas.push(await cronometra(usuario, "UPDATE public.produtos_acabados SET nome = nome WHERE false"));
          esperas.push(await cronometra(usuario, "UPDATE public.modelos SET nome = nome WHERE false"));
        }
        expect(await mig).toBe("55P03");
        const ms = Date.now() - t0;
        expect(ms).toBeGreaterThanOrEqual(3 * 1500 + 2 * 1000 - 300);
        expect(ms).toBeLessThan(15_000);
        // nenhuma escrita de usuário ficou na fila mais que uma janela de tentativa (1,5s + folga)
        expect(Math.max(...esperas)).toBeLessThan(1800);
        // entre as tentativas a migration não segura nada: pelo menos uma escrita passou na hora
        expect(Math.min(...esperas)).toBeLessThan(200);
        console.log(`[S3d trava] 55P03 em ${ms}ms; espera máx. de escrita do usuário ${Math.max(...esperas)}ms (${esperas.length} escritas)`);
        await segura.query("ROLLBACK");
      });
    } finally {
      for (const s of [segura, usuario, obs]) { await s.query("ROLLBACK").catch(() => {}); await s.end(); }
    }
  });

  it("(a') escrita aberta num PRODUTO noutra sessão: a migration espera o produto sem segurar modelos — escrita em modelos passa na hora; 55P03 no fim", async () => {
    const segura = await novaSessao();
    const usuario = await novaSessao();
    const obs = await novaSessao();
    try {
      await withTx(async (c) => {
        const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers");
        if (await s3dViva(c)) return;
        if (!(await s3aViva(c))) await aplicaS3a(c);
        await aplicarArquivo(c, S3D_MIGS[0]);
        await aplicarArquivo(c, S3D_MIGS[1]);
        const pid = (await um<{ p: number }>(c, "select pg_backend_pid() p")).p;
        await segura.query("BEGIN");
        await segura.query("UPDATE public.produtos_acabados SET nome = nome WHERE false"); // o produto está sendo salvo
        const t0 = Date.now();
        const mig = aplicarArquivo(c, S3D_MIGS[2]).then(() => "PASSOU", (e) => String(e.code));
        await esperaMigrationNaFila(obs, pid);
        const emModelos: number[] = [];
        while (Date.now() - t0 < 6000) emModelos.push(await cronometra(usuario, "UPDATE public.modelos SET nome = nome WHERE false"));
        expect(await mig).toBe("55P03");
        expect(Math.max(...emModelos)).toBeLessThan(200); // modelos nunca entrou na fila: a migration não a pediu sem ter os produtos
        console.log(`[S3d trava] produto segurado: 55P03 em ${Date.now() - t0}ms; espera máx. em modelos ${Math.max(...emModelos)}ms (${emModelos.length} escritas)`);
        await segura.query("ROLLBACK");
      });
    } finally {
      for (const s of [segura, usuario, obs]) { await s.query("ROLLBACK").catch(() => {}); await s.end(); }
    }
  });

  it("(c) deadlock de verdade (usuário segura modelos e pede produto): a migration cai (40P01 tratado), solta tudo, e passa na tentativa seguinte; o usuário NÃO vê 40P01", async () => {
    const usuario = await novaSessao();
    const obs = await novaSessao();
    try {
      await withTx(async (c) => {
        const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers");
        if (await s3dViva(c)) return;
        if (!(await s3aViva(c))) await aplicaS3a(c);
        await aplicarArquivo(c, S3D_MIGS[0]);
        await aplicarArquivo(c, S3D_MIGS[1]);
        const pid = (await um<{ p: number }>(c, "select pg_backend_pid() p")).p;
        await usuario.query("BEGIN");
        await usuario.query("UPDATE public.modelos SET nome = nome WHERE false");            // o Salvar do Sheet já gravou o card...
        const t0 = Date.now();
        const mig = aplicarArquivo(c, S3D_MIGS[2]).then(() => "PASSOU", (e) => String(e.code));
        await esperaMigrationNaFila(obs, pid);                                               // migration: produtos ok, esperando modelos
        const passo = await usuario.query("UPDATE public.produtos_acabados SET nome = nome WHERE false") // ...e o espelho pede o produto
          .then(() => "PASSOU", (e) => String(e.code));
        expect(passo).toBe("PASSOU");                                                        // quem caiu no ciclo foi a migration
        await usuario.query("ROLLBACK");
        expect(await mig).toBe("PASSOU");                                                    // e ela passou na tentativa seguinte
        const ms = Date.now() - t0;
        expect(ms).toBeLessThan(6000);
        console.log(`[S3d trava] deadlock: usuário passou; migration aplicada em ${ms}ms`);
        expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_aaa_seg_pagina'
            and tgrelid in ('public.modelos'::regclass, 'public.produtos_acabados'::regclass, 'public.produtos_importados'::regclass)`)).n).toBe(3);
      });
    } finally {
      for (const s of [usuario, obs]) { await s.query("ROLLBACK").catch(() => {}); await s.end(); }
    }
  });
});

// ─────────────────────────────────────────── grants (anti-drift) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3d — grants (has_table_privilege/has_column_privilege)", () => {
  it("anon sem escrita nas 19; modelos: I/U/D (sem TRUNCATE); produtos: só UPDATE de mix_id/modelo_id; o resto só SELECT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(TABELAS.length).toBe(19);
      expect(S3D_PLAN_TECIDO.length).toBe(13);
      const priv = async (papel: string, t: string, p: string) =>
        (await um<{ v: boolean }>(c, `select has_table_privilege($1, to_regclass('public.' || $2), $3) v`, [papel, t, p])).v;
      for (const t of TABELAS) {
        for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          expect({ t, p, anon: await priv("anon", t, p) }).toEqual({ t, p, anon: false });
          const esperado = t === "modelos" && p !== "TRUNCATE";
          expect({ t, p, auth: await priv("authenticated", t, p) }).toEqual({ t, p, auth: esperado });
        }
        expect(await priv("authenticated", t, "SELECT"), t).toBe(true);
        expect(await priv("service_role", t, "INSERT, UPDATE, DELETE, SELECT"), t).toBe(true);
        const { rows } = await c.query(
          `select a.attname from pg_attribute a where a.attrelid = to_regclass('public.' || $1) and a.attnum > 0 and not a.attisdropped
              and a.attacl is not null and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') order by 1`, [t]);
        const esperadas = ["produtos_acabados", "produtos_importados"].includes(t) ? [...S3D_COLUNAS_PRODUTO].sort() : [];
        expect({ t, cols: rows.map((r) => r.attname) }).toEqual({ t, cols: esperadas });
      }
      for (const t of ["produtos_acabados", "produtos_importados"]) {
        const tt = await um<{ v: boolean }>(c, `select has_column_privilege('authenticated', to_regclass('public.' || $1), 'tamanho_tipo', 'UPDATE') v`, [t]);
        expect({ t, tamanho_tipo: tt.v }).toEqual({ t, tamanho_tipo: false }); // TAM-1
      }
      for (const g of S3D_GATILHOS) {
        const r = await um<{ a: boolean; u: boolean; d: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u,
                  (select prosecdef from pg_proc where oid = to_regprocedure($1)) d`, [g.fn]);
        expect({ fn: g.fn, ...r }).toEqual({ fn: g.fn, a: false, u: false, d: false });
      }
    });
  });

  it("C-20: integracao_salvar chama o _core dos preços fixos (não o wrapper com o portão novo)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const d = (await um<{ d: string }>(c, `select pg_get_functiondef('public.integracao_salvar(jsonb,jsonb)'::regprocedure) d`)).d;
      expect(d).not.toMatch(/PERFORM public\.salvar_precos_fixo_produto_(acabado|importado)\(/);
      expect(d).toContain("PERFORM public._salvar_precos_fixo_produto_acabado_core(v_prod, false, NULL, true,");
      expect(d).toContain("PERFORM public._salvar_precos_fixo_produto_importado_core(v_prod, false, NULL, true,");
    });
  });
});

// ─────────────────────────────────────────── portão de página nas RPCs ───────────────────────────────────────────
const A0 = "array[]::uuid[]";
const CASOS: [string, string][] = [
  ["public.lancar_modelo(uuid,date,boolean)", `select public.lancar_modelo(${R}, null, false)`],
  ["public.conjunto_adicionar(uuid,uuid)", `select public.conjunto_adicionar(${R}, ${R})`],
  ["public.conjunto_remover(uuid)", `select public.conjunto_remover(${R})`],
  ["public.salvar_grade_revenda(uuid,jsonb,integer)", `select public.salvar_grade_revenda(${R}, '[]'::jsonb, null)`],
  ["public.salvar_produto_acabado(uuid,jsonb,jsonb)", `select public.salvar_produto_acabado(${R}, '{}'::jsonb, '[]'::jsonb)`],
  ["public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)", `select public.salvar_produto_acabado(${R}, '{}'::jsonb, '[]'::jsonb, 1)`],
  ["public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)", `select public.salvar_produto_importado(${R}, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)`],
  ["public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)", `select public.salvar_produto_importado(${R}, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 1)`],
  ["public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)", `select public.salvar_precos_fixo_produto_acabado(${R}, false, null, false, null)`],
  ["public.salvar_precos_fixo_produto_importado(uuid,boolean,numeric,boolean,numeric)", `select public.salvar_precos_fixo_produto_importado(${R}, false, null, false, null)`],
  ["public.salvar_markups_produto_acabado(uuid,numeric,numeric)", `select public.salvar_markups_produto_acabado(${R}, null, null)`],
  ["public.criar_card_produto_acabado(uuid)", `select public.criar_card_produto_acabado(${R})`],
  ["public.criar_cards_produto_acabado(uuid[])", `select public.criar_cards_produto_acabado(array[${R}])`],
  ["public.replicar_produtos_acabados(uuid,uuid,uuid[])", `select public.replicar_produtos_acabados(${R}, null, array[${R}])`],
  ["public.limpar_produto_acabado(uuid)", `select public.limpar_produto_acabado(${R})`],
  ["public.excluir_produto_acabado(uuid)", `select public.excluir_produto_acabado(${R})`],
  ["public.aplicar_produto_ao_modelo(uuid)", `select public.aplicar_produto_ao_modelo(${R})`],
  ["public.criar_card_produto_importado(uuid)", `select public.criar_card_produto_importado(${R})`],
  ["public.criar_cards_produto_importado(uuid[])", `select public.criar_cards_produto_importado(array[${R}])`],
  ["public.replicar_produtos_importados(uuid,uuid,uuid[])", `select public.replicar_produtos_importados(${R}, null, array[${R}])`],
  ["public.limpar_produto_importado(uuid)", `select public.limpar_produto_importado(${R})`],
  ["public.excluir_produto_importado(uuid)", `select public.excluir_produto_importado(${R})`],
  ["public.importar_modelo_linha(jsonb,jsonb)", `select public.importar_modelo_linha('{}'::jsonb, '[]'::jsonb)`],
  ["public.importar_produto_linha(jsonb,jsonb,text)", `select public.importar_produto_linha('{}'::jsonb, '[]'::jsonb, 'revenda')`],
  ["public.salvar_plan_tecido(uuid,jsonb,integer)", `select public.salvar_plan_tecido(${R}, '{}'::jsonb, null)`],
  ["public.plan_tecido_criar_cards(uuid,jsonb)", `select public.plan_tecido_criar_cards(${R}, '[]'::jsonb)`],
  ["public.plan_tecido_criar_card(uuid,jsonb)", `select public.plan_tecido_criar_card(${R}, '{}'::jsonb)`],
  ["public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)", `select public.plan_tecido_aplicar_ao_modelo(${R}, '[]'::jsonb, false)`],
  ["public.aplicar_plan_tecido_grade(uuid,jsonb)", `select public.aplicar_plan_tecido_grade(${R}, '[]'::jsonb)`],
  ["public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])", `select public.plan_tecido_fazer_pedido(${R}, '[]'::jsonb, ${A0})`],
  ["public.plan_tecido_desfazer_pedido(uuid)", `select public.plan_tecido_desfazer_pedido(${R})`],
  ["public.plan_tecido_set_oc_aplicada(uuid,uuid[])", `select public.plan_tecido_set_oc_aplicada(${R}, ${A0})`],
  ["public.plan_tecido_set_paleta(uuid,jsonb)", `select public.plan_tecido_set_paleta(${R}, '[]'::jsonb)`],
  ["public.plan_tecido_set_pedido_fotos(uuid,text,text[])", `select public.plan_tecido_set_pedido_fotos(${R}, 'x', array[]::text[])`],
  ["public.plan_tecido_set_referencia(uuid,text[])", `select public.plan_tecido_set_referencia(${R}, array[]::text[])`],
  ["public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])", `select public.plan_tecido_set_slot_oc(${R}, ${R}, ${A0})`],
  ["public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)", `select public.replicar_cards_plan_tecido(${R}, null, ${A0}, null)`],
  ["public.salvar_colecao_mix(uuid,uuid,text,text)", `select public.salvar_colecao_mix(null, ${R}, null, 'x')`],
  ["public.excluir_colecao_mix(uuid)", `select public.excluir_colecao_mix(${R})`],
];

describe.skipIf(!RODA)("seg S3d — portão de página nas RPCs (como authenticated, usuário comum)", () => {
  it("anti-drift: todo wrapper com página tem caso (39 RPCs + integracao_salvar e _salvar_plan_tecido_core sem página nova)", () => {
    const sigs = new Set(CASOS.map((x) => x[0]));
    const comPagina = Object.keys(S3D_MD5).filter((s) => S3D_PAGINAS[s].length > 0);
    expect(comPagina.filter((s) => !sigs.has(s))).toEqual([]);
    expect(comPagina.length).toBe(39);
    expect(Object.keys(S3D_MD5).filter((s) => S3D_PAGINAS[s].length === 0).sort())
      .toEqual(["public._salvar_plan_tecido_core(uuid,jsonb,integer)", "public.integracao_salvar(jsonb,jsonb)"]);
  });

  it("sem a página → 42501; só VER → 42501; página de outra área → 42501; com CADA página do OU (cruzamentos), admin e super → passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const falhas: string[] = [];
      for (const [sig, sql] of CASOS) {
        const paginas = S3D_PAGINAS[sig];
        await jwt(c, U_COMUM);
        await perms(c, U_COMUM, []);
        const r0 = txt(await como(c, "authenticated", sql));
        if (r0 !== NEG(paginas)) falhas.push(`${sig} sem página: ${r0}`);
        await perms(c, U_COMUM, paginas.map((p) => [p, false]));
        const r1 = txt(await como(c, "authenticated", sql));
        if (r1 !== NEG(paginas)) falhas.push(`${sig} só ver: ${r1}`);
        await perms(c, U_COMUM, edita("producao_terceirizados", "entrada_oc_tecido"));
        const r2 = txt(await como(c, "authenticated", sql));
        if (r2 !== NEG(paginas)) falhas.push(`${sig} com outra área: ${r2}`);
        for (const p of paginas) {
          await perms(c, U_COMUM, edita(p));
          const r = txt(await como(c, "authenticated", sql));
          if (/sem_permissao_pagina/.test(r)) falhas.push(`${sig} com ${p}: ${r}`);
        }
        for (const u of [U_ADMIN, SUPER]) {
          await jwt(c, u);
          const r = txt(await como(c, "authenticated", sql));
          if (/sem_permissao_pagina/.test(r)) falhas.push(`${sig} ${u === SUPER ? "super" : "admin"}: ${r}`);
        }
      }
      expect(falhas).toEqual([]);
      // C4: o fixo do Produto Acabado ganha o módulo (como o gêmeo importado); C8: o desfazer pedido ganha o entrada_saida
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita(PA, PLANTEC));
      await modulo(c, "produto_acabado", false);
      expect(txt(await como(c, "authenticated", `select public.salvar_precos_fixo_produto_acabado(${R}, false, null, false, null)`)))
        .toBe("42501 Módulo Produto Acabado não habilitado para esta loja");
      await modulo(c, "entrada_saida", false);
      expect(txt(await como(c, "authenticated", `select public.plan_tecido_desfazer_pedido(${R})`)))
        .toBe("42501 Módulo entrada_saida não habilitado");
      // C14: conjunto exige o módulo Criação
      await modulo(c, "criacao", false);
      await perms(c, U_COMUM, edita(PLAN));
      expect(txt(await como(c, "authenticated", `select public.conjunto_remover(${R})`))).toBe("42501 Módulo criacao não habilitado para esta loja");
    });
  });
});

// ─────────────────────────────────────────── escrita DIRETA em modelos/produtos ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3d — escrita direta em modelos (gatilho de página) e produtos (grant por coluna + gatilho)", () => {
  it("modelos: INSERT/DELETE = Planejamento; UPDATE = Planejamento OU Dev; só o mix_id = também Plan. Tecido/PA/PI; GUC da Explosão e servidor passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const ins = () => como(c, "authenticated", `insert into modelos (nome) values ('ITEST-S3d direto') returning id`);
      const upd = (set: string) => como(c, "authenticated", `update modelos set ${set} where id = $1`, [fx.modelo]);
      const NEG_UPD = NEG([PLAN, DEV]);
      const NEG_MIX = NEG(MIX_ONLY);
      for (const lista of [[], edita(DEV), edita(PLANTEC), edita(PA), [[PLAN, false]] as [string, boolean][]]) {
        await perms(c, U_COMUM, lista);
        expect(txt(await ins()), JSON.stringify(lista)).toBe(NEG([PLAN]));
      }
      await perms(c, U_COMUM, []);
      expect(txt(await upd(`nome = 'x'`))).toBe(NEG_UPD);
      expect(txt(await upd(`mix_id = '${fx.mix}'`))).toBe(NEG_MIX);
      await perms(c, U_COMUM, [[PLAN, false], [DEV, false], [PLANTEC, false], [PA, false], [PI, false]]);
      expect(txt(await upd(`mix_id = '${fx.mix}'`))).toBe(NEG_MIX);
      for (const p of [PLANTEC, PA, PI]) {
        await perms(c, U_COMUM, edita(p));
        expect(txt(await upd(`mix_id = '${fx.mix}'`)), p).toBe("PASSOU");
        expect(txt(await upd(`mix_id = null`)), p).toBe("PASSOU");
        expect(txt(await upd(`nome = 'x'`)), p).toBe(NEG_UPD);
        expect(txt(await upd(`mix_id = '${fx.mix}', nome = 'x'`)), p).toBe(NEG_UPD);
      }
      await perms(c, U_COMUM, edita(DEV));
      expect(txt(await upd(`nome = 'pelo Dev', status_desenvolvimento = 'desenho_tecnico'`))).toBe("PASSOU");
      expect(txt(await como(c, "authenticated", `delete from modelos where id = $1`, [fx.modelo2]))).toBe(NEG([PLAN]));
      await perms(c, U_COMUM, edita(PLAN));
      const novo = (await ok(c, `insert into modelos (nome) values ('ITEST-S3d direto') returning id`))[0].id;
      expect(txt(await upd(`nome = 'pelo Plan', mix_id = '${fx.mix}'`))).toBe("PASSOU");
      await ok(c, `delete from modelos where id = $1`, [novo]);
      expect(txt(await como(c, "authenticated", `truncate modelos`))).toMatch(/^42501 permission denied for table/);
      // admin passa; a GUC da S1 (voltar ao Dev da Explosão, INVOKER) passa sem página; servidor (postgres) e service_role passam
      await jwt(c, U_ADMIN);
      expect(txt(await upd(`nome = 'admin'`))).toBe("PASSOU");
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("producao_explosao"));
      expect(txt(await upd(`nome = 'sem pagina'`))).toBe(NEG_UPD);
      await c.query(`select set_config('app.explosao_sistema', 'on', true)`);
      expect(txt(await upd(`enviado_cad = false`))).toBe("PASSOU");
      await c.query(`select set_config('app.explosao_sistema', '', true)`);
      await jwt(c, null);
      expect(txt(await como(c, null, `update modelos set nome = 'servidor' where id = $1`, [fx.modelo]))).toBe("PASSOU");
      expect(txt(await como(c, "service_role", `update modelos set nome = 'service' where id = $1`, [fx.modelo]))).toBe("PASSOU");
    });
  });

  it("produtos_acabados/importados: só mix_id e modelo_id, pela página do produto OU o Planejamento; tamanho_tipo (TAM-1), INSERT e DELETE negados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      for (const [t, id, pag, outra] of [["produtos_acabados", fx.prodPA, PA, PI], ["produtos_importados", fx.prodPI, PI, PA]] as const) {
        const upd = (set: string) => como(c, "authenticated", `update ${t} set ${set} where id = $1`, [id]);
        await perms(c, U_COMUM, edita(outra, DEV));
        expect(txt(await upd(`mix_id = '${fx.mix}'`)), t).toBe(NEG([pag, PLAN]));
        for (const p of [pag, PLAN]) {
          await perms(c, U_COMUM, edita(p));
          expect(txt(await upd(`mix_id = '${fx.mix}'`)), `${t} ${p}`).toBe("PASSOU");
          expect(txt(await upd(`modelo_id = '${fx.revenda}'`)), `${t} ${p}`).toBe("PASSOU");
          expect(txt(await upd(`modelo_id = null, mix_id = null`)), `${t} ${p}`).toBe("PASSOU");
          expect(txt(await upd(`tamanho_tipo = 'letra'`)), `${t} ${p}`).toMatch(NEGADO_GRANT);
          expect(txt(await upd(`nome = 'x'`)), `${t} ${p}`).toMatch(NEGADO_GRANT);
        }
        await jwt(c, SUPER);
        expect(txt(await como(c, "authenticated", `delete from ${t} where id = $1`, [id]))).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `insert into ${t} select * from ${t} where false`))).toMatch(NEGADO_GRANT);
        await jwt(c, U_COMUM);
      }
    });
  });

  it("as 3 filhas de produto e as 13 plan_tecido_*: nem o super escreve direto; leitura segue (C2 da S4 dispensável para escrita)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await jwt(c, SUPER);
      expect(S3D_SO_RPC.length).toBe(16);
      for (const t of S3D_SO_RPC) {
        expect(txt(await como(c, "authenticated", `update ${t} set id = id where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `insert into ${t} select * from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "anon", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `select count(*) from ${t}`)), t).toBe("PASSOU");
      }
    });
  });
});

// ─────────────────────────────────────────── ponta a ponta: cada tela que grava modelos ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3d — ponta a ponta como o PAPEL authenticated, usuário comum com a página de cada tela", () => {
  it("Sheet do Planejamento / Plan. Produto: card novo, Salvar, Ordem, BulkEdit, família, preço, relacionado, Lançar, revenda, Duplicar, Excluir", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, [...edita(PLAN, PRECO)]);
      const card = (await ok(c, `insert into modelos (nome, colecao_id, categoria_principal_id) values ('ITEST-S3d Sheet', $1, $2) returning id`,
        [fx.col, fx.cat]))[0].id as string;
      await ok(c, `update modelos set nome = 'ITEST-S3d Sheet salvo', observacoes_tecnicas = 'obs', custos_adicionais = '[]'::jsonb where id = $1`, [card]);
      await ok(c, `update modelos set ordem_criacao_enviada = true where id = $1`, [card]);                 // Ordem de Criação
      await ok(c, `update modelos set colecao_id = $2 where id = any($1::uuid[])`, [[card, fx.modelo], fx.col]); // BulkEdit
      await ok(c, `update modelos set mix_id = $2 where id = any($1::uuid[])`, [[card, fx.modelo], fx.mix]);     // família (lista)
      await ok(c, `update modelos set preco_venda = 199.9 where id = $1`, [card]);                              // preço na lista
      await ok(c, `select public.conjunto_adicionar($1, $2)`, [card, fx.modelo]);
      await ok(c, `select public.conjunto_remover($1)`, [card]);
      await ok(c, `select public.lancar_modelo($1, null, false)`, [card]);                                      // desmarcar lançado
      // revenda no Sheet: produto pelo Sheet (salvar_produto_acabado), vínculo modelo_id direto, preço fixo e markup pela seção de preço
      const prod = (await ok(c, `select public.salvar_produto_acabado(null, $1::jsonb, '[]'::jsonb) id`,
        [JSON.stringify({ nome: "ITEST S3d revenda", grupo_id: fx.grupo, categoria_id: fx.cat })]))[0].id as string;
      await ok(c, `update produtos_acabados set modelo_id = $2 where id = $1`, [prod, fx.revenda]);
      await ok(c, `select public.salvar_precos_fixo_produto_acabado($1, false, null, true, 149.9)`, [prod]);
      await ok(c, `select public.salvar_markups_produto_acabado($1, 2.5, 3)`, [prod]);
      expect(txt(await como(c, "authenticated", `select public.salvar_grade_revenda($1, '[]'::jsonb, null)`, [fx.revenda])))
        .not.toMatch(/sem_permissao_pagina|permission denied/);
      // sem a seção de preço (só o Planejamento) o preço/markup do comprado para no portão
      await perms(c, U_COMUM, edita(PLAN));
      expect(txt(await como(c, "authenticated", `select public.salvar_precos_fixo_produto_acabado($1, false, null, true, 1)`, [prod]))).toBe(NEG([PA, PRECO]));
      expect(txt(await como(c, "authenticated", `select public.salvar_markups_produto_acabado($1, 2, 2)`, [prod]))).toBe(NEG([PA, PRECO]));
      // Duplicar + Excluir
      const copia = (await ok(c, `insert into modelos (nome, versao, colecao_id) values ('ITEST-S3d Sheet', 2, $1) returning id`, [fx.col]))[0].id;
      await ok(c, `delete from modelos where id = any($1::uuid[])`, [[copia, card]]);
      // Lançar também pela página de Lançamentos (desvio 2 do §0)
      await perms(c, U_COMUM, edita("producao_lancamentos"));
      await ok(c, `select public.lancar_modelo($1, null, false)`, [fx.modelo]);
    });
  });

  it("Desenvolvimento: arraste do kanban e 'Mover para…' (UPDATE) passam; criar/excluir card não", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita(DEV));
      await ok(c, `update modelos set status_desenvolvimento = 'desenho_tecnico' where id = $1`, [fx.modelo]);
      await ok(c, `update modelos set status_desenvolvimento = 'prova', observacoes_tecnicas = 'mover' where id = $1`, [fx.modelo]);
      expect(txt(await como(c, "authenticated", `insert into modelos (nome) values ('x')`))).toBe(NEG([PLAN]));
      expect(txt(await como(c, "authenticated", `delete from modelos where id = $1`, [fx.modelo]))).toBe(NEG([PLAN]));
    });
  });

  it("Plan. Tecido: salvar a árvore (B3: modelo de outra loja vira NULL), criar card, paleta, família (mix_id direto + RPCs de mix), replicar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita(PLANTEC));
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [
        { modelo_id: fx.modelo, slot_index: 0, nome: "MEU", materiais: [] },
        { modelo_id: fx.modeloOutra, slot_index: 1, nome: "DE OUTRA LOJA", materiais: [] },
        { modelo_id: null, slot_index: 2, nome: "VAGA", materiais: [] },
      ] }] }] };
      await ok(c, `select public.salvar_plan_tecido($1, $2::jsonb, null)`, [fx.col, JSON.stringify(arvore)]);
      const slots = await semJwt(c, async () => (await c.query(
        `select s.id, s.nome, s.modelo_id from plan_tecido_slots s join plan_tecido_linhas l on l.id = s.linha_ref_id
           join plan_tecido_subcolecoes sc on sc.id = l.sub_id join plan_tecido p on p.id = sc.plan_id
          where p.colecao_id = $1 order by s.slot_index`, [fx.col])).rows);
      expect(slots.map((s: any) => [s.nome, s.modelo_id])).toEqual([["MEU", fx.modelo], ["DE OUTRA LOJA", null], ["VAGA", null]]);
      const vaga = slots[2].id;
      const criados = (await ok(c, `select public.plan_tecido_criar_cards($1, $2::jsonb) r`,
        [fx.col, JSON.stringify([{ slot_id: vaga, nome: "Card do Plan. Tecido" }])]))[0].r;
      expect(JSON.stringify(criados)).toContain(vaga);
      await ok(c, `select public.plan_tecido_set_paleta($1, '[]'::jsonb)`, [fx.col]);
      const mix = (await ok(c, `select public.salvar_colecao_mix(null, $1, null, 'ITEST S3d família PT') id`, [fx.col]))[0].id;
      await ok(c, `update modelos set mix_id = $2 where id = $1`, [fx.modelo, mix]);                    // C-01 (só mix_id)
      expect(txt(await como(c, "authenticated", `update modelos set nome = 'x' where id = $1`, [fx.modelo]))).toBe(NEG([PLAN, DEV]));
      await ok(c, `update modelos set mix_id = null where id = $1`, [fx.modelo]);
      await ok(c, `select public.excluir_colecao_mix($1)`, [mix]);
      expect(txt(await como(c, "authenticated", `select public.replicar_cards_plan_tecido($1, null, $2::uuid[], null)`, [fx.col, [fx.modelo]])))
        .not.toMatch(/sem_permissao_pagina|permission denied/);
      // a escrita direta nas plan_tecido_* acabou (antes: UPDATE de plan_tecido_slots.modelo_id = qualquer uuid — B3)
      expect(txt(await como(c, "authenticated", `update plan_tecido_slots set modelo_id = $2 where id = $1`, [vaga, fx.modeloOutra]))).toMatch(NEGADO_GRANT);
    });
  });

  it("Produto Acabado: produto → card espelho → preço fixo e markup → aplicar ao modelo → família (produto e card) → limpar → excluir", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita(PA));
      const prod = (await ok(c, `select public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) id`, [
        JSON.stringify({ nome: "ITEST S3d PA e2e", grupo_id: fx.grupo, categoria_id: fx.cat, qtd_total: 10, grade_proporcao: { P: 1, M: 1 } }),
        JSON.stringify([{ ordem: 0, peso: 1, qtd: 10 }]),
      ]))[0].id as string;
      const card = (await ok(c, `select public.criar_card_produto_acabado($1) id`, [prod]))[0].id as string;
      await ok(c, `select public.salvar_precos_fixo_produto_acabado($1, true, 80, true, 159.9)`, [prod]);
      await ok(c, `select public.salvar_markups_produto_acabado($1, 2, 3)`, [prod]);
      await ok(c, `select public.aplicar_produto_ao_modelo($1)`, [prod]);
      await ok(c, `update produtos_acabados set mix_id = $2 where id = $1`, [prod, fx.mix]);    // Editar Família (rascunho)
      await ok(c, `update modelos set mix_id = $2 where id = $1`, [card, fx.mix]);              // Editar Família (card materializado)
      expect(txt(await como(c, "authenticated", `update modelos set nome = 'x' where id = $1`, [card]))).toBe(NEG([PLAN, DEV]));
      const mix = (await ok(c, `select public.salvar_colecao_mix(null, $1, null, 'ITEST S3d família PA') id`, [fx.col]))[0].id;
      await ok(c, `select public.excluir_colecao_mix($1)`, [mix]);
      expect(txt(await como(c, "authenticated", `select public.limpar_produto_acabado($1)`, [prod]))).not.toMatch(/sem_permissao_pagina|permission denied/);
      await ok(c, `select public.excluir_produto_acabado($1)`, [prod]);
      expect((await um<{ n: number }>(c, `select count(*)::int n from produtos_acabados where id = $1`, [prod])).n).toBe(0);
    });
  });

  it("Produto Importado: produto → cards espelho → preço fixo → família → excluir", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita(PI));
      const prod = (await ok(c, `select public.salvar_produto_importado(null, $1::jsonb, '[]'::jsonb, '[]'::jsonb, null) id`,
        [JSON.stringify({ nome: "ITEST S3d PI e2e", grupo_id: fx.grupo, categoria_id: fx.cat })]))[0].id as string;
      const r = await como(c, "authenticated", `select public.criar_cards_produto_importado(array[$1::uuid]) r`, [prod]);
      expect(txt(r)).not.toMatch(/sem_permissao_pagina|permission denied/);
      await ok(c, `select public.salvar_precos_fixo_produto_importado($1, true, 50, true, 120)`, [prod]);
      await ok(c, `update produtos_importados set mix_id = $2 where id = $1`, [prod, fx.mix]);
      await ok(c, `select public.excluir_produto_importado($1)`, [prod]);
    });
  });

  it("Importar Dados: a linha de modelo passa com a página Importar; sem ela, 42501", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const linha = () => como(c, "authenticated", `select public.importar_modelo_linha($1::jsonb, '[]'::jsonb) r`,
        [JSON.stringify({ nome: "ITEST S3d importado", categoria_principal_id: fx.cat })]);
      await perms(c, U_COMUM, edita(PLAN));
      expect(txt(await linha())).toBe(NEG(["importar"]));
      await perms(c, U_COMUM, edita("importar"));
      expect(txt(await linha())).toBe("PASSOU");
    });
  });
});
