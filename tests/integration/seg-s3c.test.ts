// Reforço de segurança — sub-release S3c ("Ficha técnica, CAD, M.O. e B3"). Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/
// s3-desenho.md (§2.5, §2.7 B3, §5 M1/D6/C14/B3, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B — valores de M.O. SÓ quem EDITA o
// Planejamento E vê custos). As migrations (S3a por baixo + S3c) são aplicadas DENTRO da transação de cada teste (mig-txn) e tudo é
// revertido: nada é gravado na cópia. SÓ na cópia local. Privilégio e gatilho rodam DE VERDADE como o papel do PostgREST (SET LOCAL
// ROLE authenticated) com JWT de usuário COMUM criado na txn, com permissões por página explícitas.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS3c, voltaS3c, s3cViva, S3C_MIGS, S3C_DOWNS, S3C_DOWN_DROP, S3C_TABELAS_TRAVA } from "./seg-s3c-helpers";
import { S3C_MD5, S3C_PAGINAS, S3C_PAGINA_MO, S3C_GATILHOS, S3C_ACL, S3C_DIRETAS, S3C_SO_RPC } from "./seg-s3c-dados";
import { aclTabela } from "./seg-s2-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0054-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0054-0000-4000-8000-0000000000a1";
const TABELAS = Object.keys(S3C_ACL);
const RAND = "00000000-5e9a-4054-8000-00000000dead";
const R = `'${RAND}'::uuid`;
const DEV = "criacao_desenvolvimento";
const PLAN = "criacao_planejamento";
const CUSTOS_PLAN: [string, boolean] = ["criacao_planejamento:custos", false];
const CUSTOS_DEV: [string, boolean] = ["criacao_desenvolvimento:custos", false];

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | "service_role" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s3z");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s3z");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s3z");
    await c.query("RELEASE SAVEPOINT s3z");
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
    [uid, T, `${uid}@teste`, `S3c ${admin ? "admin" : "comum"}`],
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
  await aplicaS3c(c); // idempotente (aplica a S3a antes se faltar; S3C_TXN=1 já aplicou: a guarda aceita o "depois")
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
type Fx = { art: string; vari: string; etq: string; cor: string; modelo: string; catServ: string; cat: string;
  outra: string; etqOutra: string; corOutra: string; modeloOutra: string; catOutra: string };
async function fixture(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const outra = (await um<{ id: string }>(c, `select id from tenants where id <> $1 order by id limit 1`, [T])).id;
    const art = (await um<{ id: string }>(c,
      `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST S3c tecido', 'metro', 10) returning id`, [T])).id;
    const vari = (await um<{ id: string }>(c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S3c') returning id`, [T, art])).id;
    const etq = (await um<{ id: string }>(c, `insert into etiquetas (tenant_id, nome) values ($1, 'ITEST S3c etiqueta') returning id`, [T])).id;
    const cor = (await um<{ id: string }>(c, `insert into cores (tenant_id, nome) values ($1, 'ITEST S3c cor') returning id`, [T])).id;
    const modelo = (await um<{ id: string }>(c,
      `insert into modelos (tenant_id, nome, ordem_criacao_enviada) values ($1, 'ITEST-S3c card', true) returning id`, [T])).id;
    const catServ = (await um<{ id: string }>(c,
      `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1, 'Costura S3c', true) returning id`, [T])).id;
    const cat = (await um<{ id: string }>(c, `insert into categorias_tecido (tenant_id, nome) values ($1, 'ITEST S3c cat') returning id`, [T])).id;
    const etqOutra = (await um<{ id: string }>(c, `insert into etiquetas (tenant_id, nome) values ($1, 'ITEST S3c OUTRA') returning id`, [outra])).id;
    const corOutra = (await um<{ id: string }>(c, `insert into cores (tenant_id, nome) values ($1, 'ITEST S3c OUTRA') returning id`, [outra])).id;
    const modeloOutra = (await um<{ id: string }>(c,
      `insert into modelos (tenant_id, nome, ref) values ($1, 'ITEST-S3c OUTRA', 'S3C-OUTRA') returning id`, [outra])).id;
    const catOutra = (await um<{ id: string }>(c, `insert into categorias_tecido (tenant_id, nome) values ($1, 'ITEST S3c OUTRA') returning id`, [outra])).id;
    return { art, vari, etq, cor, modelo, catServ, cat, outra, etqOutra, corOutra, modeloOutra, catOutra };
  });
}
const tecidosBom = (fx: Fx) => JSON.stringify([{ artigo_id: fx.art, numero: 1, tipo: "tecido", consumo: 1.2, variantes: [fx.vari] }]);
const tecidosCad = (fx: Fx) => JSON.stringify([{ artigo_id: fx.art, numero: 1, tipo: "tecido", consumo: 1.2, variantes: [{ variante_tecido_id: fx.vari, ordem: 1 }] }]);
const gradesBom = JSON.stringify([{ variante_numero: 1, grades: { P: 5, M: 5 }, grade_total: 10 }]);
const linhasMo = (fx: Fx, valor: number, id: string | null = null) =>
  JSON.stringify([{ id, categoria_terceirizado_id: fx.catServ, valor, observacoes: null }]);

// ─────────────────────────────────────────── md5, ACL, idempotência, volta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3c — md5, ACL, idempotência e volta (LIFO)", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES (textos e ACL exatos); _down_drop apaga; ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const confereIda = async () => {
        for (const [sig, m] of Object.entries(S3C_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
        for (const g of S3C_GATILHOS) {
          expect(await md5(c, g.fn), g.fn).toBe(g.depois);
          const trg = await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgrelid = to_regclass('public.' || $1)
              and tgname = 'trg_aaa_seg_pagina' and tgenabled = 'O' and tgtype = $2`, [g.tabela, g.tgtype]);
          expect(trg.n, g.tabela).toBe(1);
        }
        for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3C_ACL[t].depois);
      };
      await aplicaS3c(c);
      await confereIda();
      await aplicaS3c(c);
      await confereIda();
      await voltaS3c(c);
      for (const [sig, m] of Object.entries(S3C_MD5)) expect(await md5(c, sig), sig).toBe(m.antes);
      for (const g of S3C_GATILHOS) expect(await md5(c, g.fn), g.fn).toBe(g.neutra);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3C_ACL[t].antes);
      // as 2 sql voltam como LANGUAGE sql (marcar_revisao_pendente) e com o texto de antes (árvore)
      expect((await um<{ l: string }>(c, `select l.lanname l from pg_proc p join pg_language l on l.oid = p.prolang
          where p.oid = 'public.marcar_revisao_pendente(uuid,text[])'::regprocedure`)).l).toBe("sql");
      await voltaS3c(c);
      await aplicarArquivo(c, S3C_DOWN_DROP);
      for (const g of S3C_GATILHOS) {
        expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [g.fn])).f).toBeNull();
        expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_aaa_seg_pagina'
            and tgrelid = to_regclass('public.' || $1)`, [g.tabela])).n).toBe(0);
      }
      await aplicarArquivo(c, S3C_DOWN_DROP);
      await aplicaS3c(c);
      await confereIda();
    });
  });

  it("recusas de ordem: _down_drop sem o _down; inverso sem a ida; S3c sem o helper da S3a", async () => {
    await withTx(async (c) => {
      await aplicaS3c(c);
      await expect(aplicarArquivo(c, S3C_DOWN_DROP)).rejects.toThrow(/s3c_guarda_down_drop: rode antes o _down/);
      await voltaS3c(c, true);
      await expect(aplicarArquivo(c, S3C_DOWNS[0])).rejects.toThrow(/s3c_guarda_down: .* com texto inesperado \(md5 ausente\)/);
      const { voltaS3a } = await import("./seg-s3a-helpers");
      await voltaS3a(c, true);
      await expect(aplicarArquivo(c, S3C_MIGS[0])).rejects.toThrow(/s3c_gates: rode antes a S3a 20261101100000/);
      await expect(aplicarArquivo(c, S3C_MIGS[2])).rejects.toThrow(/s3c_guarda: rode antes a S3a 20261101100000/);
    });
  });

  it("grants só sobre a ACL medida: ACL fora do antes/depois → ida E volta recusam P0001 sem mudar nada", async () => {
    await withTx(async (c) => {
      const IDA = S3C_MIGS[1];
      const VOLTA = S3C_DOWNS[1];
      await aplicaS3c(c);
      await c.query("GRANT INSERT ON public.modelo_servico_mo TO anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3c_grants: ACL inesperada em modelo_servico_mo/) });
      await expect(aplicarArquivo(c, VOLTA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3c_grants_down: ACL inesperada em modelo_servico_mo/) });
      await c.query("REVOKE INSERT ON public.modelo_servico_mo FROM anon");
      await aplicarArquivo(c, VOLTA);
      await c.query("REVOKE TRUNCATE ON public.modelo_etiquetas FROM anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3c_grants: ACL inesperada em modelo_etiquetas/) });
      await c.query("GRANT TRUNCATE ON public.modelo_etiquetas TO anon");
      await aplicarArquivo(c, IDA);
      await aplicarArquivo(c, IDA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3C_ACL[t].depois);
      await aplicarArquivo(c, VOLTA);
      await aplicarArquivo(c, VOLTA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3C_ACL[t].antes);
    });
  });
});

describe.skipIf(!RODA)("seg S3c — trava medida (pg_locks na txn revertida)", () => {
  it("RPCs e grants: catálogo; gatilhos: ShareRowExclusive SÓ em modelo_etiquetas e modelo_observacoes; nada em auth/storage", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows as { rel: string; mode: string }[];
      const chave = (t: { rel: string; mode: string }) => `${t.rel}|${t.mode}`;
      const DUAS = S3C_TABELAS_TRAVA.map((rel) => ({ rel, mode: "ShareRowExclusiveLock" }));
      let base: Set<string>;
      const novas = async () => (await travas()).filter((t) => !base.has(chave(t)));
      if (!(await s3cViva(c))) {
        const { aplicaS3a, s3aViva } = await import("./seg-s3a-helpers");
        if (!(await s3aViva(c))) await aplicaS3a(c); // por baixo (as travas dela são nas 4 OCs — ficam na linha de base)
        base = new Set((await travas()).map(chave));
        await aplicarArquivo(c, S3C_MIGS[0]);
        expect(await novas()).toEqual([]);
        await aplicarArquivo(c, S3C_MIGS[1]);
        expect(await novas()).toEqual([]);
        await aplicarArquivo(c, S3C_MIGS[2]);
        expect(await novas()).toEqual(DUAS);
      } else {
        // T1 (backend, 05/out): com a S3c JÁ aplicada na cópia, os gatilhos já existem e o arquivo reaplicado não cria nenhum (sem CREATE TRIGGER → nenhuma
        // trava de tabela). As 2 ShareRowExclusive só aparecem na txn quando o gancho S3C_TXN=1 aplicou a ida NESTA txn (ou no ramo acima, banco sem a S3c).
        // Regra medida (inalterada): a ida/reaplicação não pega trava nova; o que estava seguro no começo
        // da txn é exatamente as DUAS ou nada.
        const seguradasNoInicio = (await travas()).filter((t) => S3C_TABELAS_TRAVA.includes(t.rel));
        expect([[], DUAS]).toContainEqual(seguradasNoInicio);
        base = new Set((await travas()).map(chave));
        await aplicaS3c(c); // idempotente: não pega trava nova
        expect(await novas()).toEqual([]);
        expect((await travas()).filter((t) => S3C_TABELAS_TRAVA.includes(t.rel))).toEqual(seguradasNoInicio);
      }
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────── grants (anti-drift) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3c — grants (has_table_privilege)", () => {
  it("anon sem escrita nas 14; authenticated: só SELECT nas 12 só-RPC; I/U/D (sem TRUNCATE) em etiquetas/observações", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const priv = async (papel: string, t: string, p: string) =>
        (await um<{ v: boolean }>(c, `select has_table_privilege($1, to_regclass('public.' || $2), $3) v`, [papel, t, p])).v;
      expect([...S3C_DIRETAS, ...S3C_SO_RPC].sort()).toEqual([...TABELAS].sort());
      for (const t of TABELAS) {
        for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          expect({ t, p, anon: await priv("anon", t, p) }).toEqual({ t, p, anon: false });
          const esperado = S3C_DIRETAS.includes(t) && p !== "TRUNCATE";
          expect({ t, p, auth: await priv("authenticated", t, p) }).toEqual({ t, p, auth: esperado });
        }
        expect(await priv("authenticated", t, "SELECT"), t).toBe(true);
        expect(await priv("service_role", t, "INSERT, UPDATE, DELETE, SELECT"), t).toBe(true);
        const cols = await um<{ n: number }>(c, `select count(*)::int n from pg_attribute where attrelid = to_regclass('public.' || $1) and attacl is not null`, [t]);
        expect({ t, cols: cols.n }).toEqual({ t, cols: 0 });
      }
      for (const g of S3C_GATILHOS) {
        const r = await um<{ a: boolean; u: boolean; d: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u,
                  (select prosecdef from pg_proc where oid = to_regprocedure($1)) d`, [g.fn]);
        expect({ fn: g.fn, ...r }).toEqual({ fn: g.fn, a: false, u: false, d: false });
      }
      // as RPCs seguem com EXECUTE para authenticated (a árvore interna, não)
      for (const sig of Object.keys(S3C_MD5)) {
        const r = await um<{ a: boolean; u: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u`, [sig]);
        expect({ sig, ...r }).toEqual({ sig, a: false, u: !sig.startsWith("public._") });
      }
    });
  });
});

// ─────────────────────────────────────────── portão de página nas RPCs ───────────────────────────────────────────
const CASOS: [string, string, string[]][] = [
  // modelo inexistente = sem BOM → vale a exceção do BOM inicial (Desenvolvimento OU Planejamento)
  ["public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb,integer)", `select public.salvar_modelo_bom(${R}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null)`, [DEV, PLAN]],
  ["public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)", `select public.salvar_cad_completo(${R}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, null, null)`, [DEV]],
  ["public.enviar_modelo_para_cad(uuid,text,text)", `select public.enviar_modelo_para_cad(${R})`, [DEV]],
  ["public.excluir_cad(uuid)", `select public.excluir_cad(${R})`, [DEV]],
  ["public.prova_comentar(uuid,text,uuid)", `select public.prova_comentar(${R}, 'oi', null)`, [DEV]],
  ["public.prova_resolver(uuid,boolean)", `select public.prova_resolver(${R}, true)`, [DEV]],
  ["public.prova_excluir(uuid)", `select public.prova_excluir(${R})`, [DEV]],
  ["public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)", `select public.marcar_revisao_por_mudanca(${R}, true, false, false)`, [PLAN, DEV, "criacao_plan_tecido"]],
  ["public.marcar_revisao_pendente(uuid,text[])", `select public.marcar_revisao_pendente(${R}, array['cq'])`, [PLAN, DEV, "criacao_plan_tecido"]],
];

describe.skipIf(!RODA)("seg S3c — portão de página nas RPCs (como authenticated, usuário comum)", () => {
  it("anti-drift: todo wrapper com página tem caso; as páginas dos casos = as do gerador; M.O. e B3 têm testes próprios", () => {
    const sigs = new Set(CASOS.map((x) => x[0]));
    const comPagina = Object.keys(S3C_MD5).filter((s) => S3C_PAGINAS[s].length > 0 && s !== "public.salvar_modelo_servico_mo(uuid,jsonb)");
    expect(comPagina.filter((s) => !sigs.has(s))).toEqual([]);
    expect(Object.keys(S3C_MD5).length).toBe(12); // 11 RPCs + a árvore (B3)
    for (const [sig, , paginas] of CASOS) expect([...S3C_PAGINAS[sig]].sort(), sig).toEqual([...paginas].sort());
    expect(S3C_PAGINAS["public.salvar_modelo_servico_mo(uuid,jsonb)"]).toEqual([S3C_PAGINA_MO]);
  });

  it("sem a página → 42501; só VER → 42501; página de outra área → 42501; com CADA página do OU, admin e super → passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const falhas: string[] = [];
      for (const [, sql, paginas] of CASOS) {
        await jwt(c, U_COMUM);
        await perms(c, U_COMUM, []);
        const r0 = txt(await como(c, "authenticated", sql));
        if (r0 !== NEG(paginas)) falhas.push(`${sql} sem página: ${r0}`);
        await perms(c, U_COMUM, paginas.map((p) => [p, false]));
        const r1 = txt(await como(c, "authenticated", sql));
        if (r1 !== NEG(paginas)) falhas.push(`${sql} só ver: ${r1}`);
        await perms(c, U_COMUM, edita("producao_terceirizados", "entrada_oc_tecido"));
        const r2 = txt(await como(c, "authenticated", sql));
        if (r2 !== NEG(paginas)) falhas.push(`${sql} com outra área: ${r2}`);
        for (const p of paginas) {
          await perms(c, U_COMUM, edita(p));
          const r = txt(await como(c, "authenticated", sql));
          if (/sem_permissao_pagina/.test(r)) falhas.push(`${sql} com ${p}: ${r}`);
        }
        for (const u of [U_ADMIN, SUPER]) {
          await jwt(c, u);
          const r = txt(await como(c, "authenticated", sql));
          if (/sem_permissao_pagina/.test(r)) falhas.push(`${sql} ${u === SUPER ? "super" : "admin"}: ${r}`);
        }
      }
      expect(falhas).toEqual([]);
      // C14: prova e #Erro por mudança exigem o módulo Criação (mensagem de sempre)
      await modulo(c, "criacao", false);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita(DEV, PLAN));
      for (const sql of [`select public.prova_comentar(${R}, 'oi', null)`, `select public.prova_resolver(${R}, true)`,
        `select public.prova_excluir(${R})`, `select public.marcar_revisao_por_mudanca(${R}, true, false, false)`,
        `select public.marcar_revisao_pendente(${R}, array['cq'])`]) {
        expect(txt(await como(c, "authenticated", sql)), sql).toBe("42501 Módulo criacao não habilitado para esta loja");
      }
    });
  });

  it("M1: o BOM de modelo que JÁ tem tecido/aviamento exige o Desenvolvimento (o Planejamento só grava o BOM inicial)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const bom = (tec: string) => como(c, "authenticated",
        `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, null)`, [fx.modelo, tec]);
      await perms(c, U_COMUM, edita(PLAN));
      expect(txt(await bom(tecidosBom(fx)))).toBe("PASSOU"); // BOM inicial (card novo / Duplicar)
      expect(txt(await bom(tecidosBom(fx)))).toBe(NEG([DEV])); // já tem tecido
      expect(txt(await bom("[]"))).toBe(NEG([DEV]));           // apagar o BOM também é do Dev
      await perms(c, U_COMUM, edita(DEV));
      expect(txt(await bom(tecidosBom(fx)))).toBe("PASSOU");
    });
  });
});

// ─────────────────────────────────────────── M.O. (P-244 = B) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3c — valores de M.O. (P-244 = B: EDITAR o Planejamento E ver custos)", () => {
  it("Planejamento sem custos → 42501; só Dev com custos → 42501; PA/PI com custos → 42501; Planejamento + custos → ok; aprovador sem editar valor aprova", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const MO_NEG = "42501 mao_obra_sem_permissao: editar criacao_planejamento e ver custos";
      // a lista inteira é reenviada (o servidor casa por id): reenvia a linha que já existe (sem id, apagaria a pendente — outra regra)
      const idAtual = async () => (await c.query(`select id from modelo_servico_mo where modelo_id = $1`, [fx.modelo])).rows[0]?.id ?? null;
      const salva = async (valor: number) =>
        como(c, "authenticated", `select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [fx.modelo, linhasMo(fx, valor, await idAtual())]);
      const casos: [string, [string, boolean][], string][] = [
        ["nada", [], MO_NEG],
        ["Planejamento sem custos", edita(PLAN), MO_NEG],
        ["Planejamento só VER + custos", [[PLAN, false], CUSTOS_PLAN], MO_NEG],
        ["só Desenvolvimento + custos (caso Alan)", [...edita(DEV), CUSTOS_DEV], MO_NEG],
        ["Produto Acabado + custos", [...edita("criacao_produto_acabado"), CUSTOS_PLAN], MO_NEG],
        ["Produto Importado + custos", [...edita("criacao_produto_importado"), CUSTOS_PLAN], MO_NEG],
        ["aprovador (sem editar valor)", [...edita("producao_servico_aprovacao"), CUSTOS_PLAN], MO_NEG],
        ["Planejamento + custos do Planejamento", [...edita(PLAN), CUSTOS_PLAN], "PASSOU"],
        ["Planejamento + custos do Dev", [...edita(PLAN), CUSTOS_DEV], "PASSOU"],
        ["Planejamento + preços do PCP", [...edita(PLAN), ["producao_terceirizados:precos", false]], "PASSOU"],
        ["Planejamento + Dashboard Comercial", [...edita(PLAN), ["dashboard_comercial", false]], "PASSOU"],
      ];
      for (const [nome, lista, esperado] of casos) {
        await perms(c, U_COMUM, lista);
        expect(txt(await salva(10)), nome).toBe(esperado);
      }
      for (const u of [U_ADMIN, SUPER]) {
        await jwt(c, u);
        expect(txt(await salva(12)), u).toBe("PASSOU");
      }
      // aprovar/reprovar NÃO é editar valor (inv. 12): o aprovador sem o Planejamento aprova a linha
      const linha = (await um<{ id: string }>(c, `select id from modelo_servico_mo where modelo_id = $1`, [fx.modelo])).id;
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("producao_servico_aprovacao"));
      expect(txt(await como(c, "authenticated", `select public.aprovar_servico_mo($1, $2, true, null)`, [fx.modelo, linha]))).toBe("PASSOU");
      expect((await um<{ a: boolean }>(c, `select aprovado a from modelo_servico_mo where id = $1`, [linha])).a).toBe(true);
      expect(txt(await salva(99))).toBe(MO_NEG);
      // e o PATCH direto em modelo_servico_mo (que furava o D6) acabou — nem o super escreve direto
      await jwt(c, SUPER);
      expect(txt(await como(c, "authenticated", `update modelo_servico_mo set valor = 1 where id = $1`, [linha]))).toMatch(NEGADO_GRANT);
      expect(txt(await como(c, "authenticated", `delete from modelo_servico_mo where id = $1`, [linha]))).toMatch(NEGADO_GRANT);
      // sem JWT (servidor chamando o wrapper) não passa — o servidor chama o _core (inv. 9)
      await jwt(c, null);
      expect(txt(await salva(1))).toBe(MO_NEG);
    });
  });
});

// ─────────────────────────────────────────── escrita DIRETA + B3 ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3c — escrita direta (etiquetas/observações) com gatilho de página + B3; 12 tabelas só-RPC", () => {
  it("modelo_etiquetas: Desenvolvimento; B3 etiqueta/cor/modelo de outra loja → P0001 (cliente E servidor)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const ins = (etq: string, cor: string | null, modelo = fx.modelo) => como(c, "authenticated",
        `insert into modelo_etiquetas (modelo_id, etiqueta_id, cor_id, numero, consumo) values ($1, $2, $3, 1, 1) returning id`, [modelo, etq, cor]);
      for (const lista of [[], edita(PLAN), edita("producao_terceirizados"), [[DEV, false]] as [string, boolean][]]) {
        await perms(c, U_COMUM, lista);
        expect(txt(await ins(fx.etq, fx.cor)), JSON.stringify(lista)).toBe(NEG([DEV]));
      }
      await perms(c, U_COMUM, edita(DEV));
      const id = (await ok(c, `insert into modelo_etiquetas (modelo_id, etiqueta_id, cor_id, numero, consumo) values ($1, $2, $3, 1, 1) returning id`,
        [fx.modelo, fx.etq, fx.cor]))[0].id as string;
      expect((await um<{ t: string }>(c, `select tenant_id t from modelo_etiquetas where id = $1`, [id])).t).toBe(T);
      await ok(c, `update modelo_etiquetas set consumo = 2, numero = 2 where id = $1`, [id]);
      expect(txt(await ins(fx.etqOutra, null))).toBe("P0001 loja_diferente: etiqueta_id");
      expect(txt(await ins(fx.etq, fx.corOutra))).toBe("P0001 loja_diferente: cor_id");
      expect(txt(await ins(fx.etq, null, fx.modeloOutra))).toBe("P0001 loja_diferente: modelo_id");
      expect(txt(await como(c, "authenticated", `update modelo_etiquetas set etiqueta_id = $2 where id = $1`, [id, fx.etqOutra])))
        .toBe("P0001 loja_diferente: etiqueta_id");
      expect(txt(await como(c, "authenticated", `update modelo_etiquetas set cor_id = $2 where id = $1`, [id, fx.corOutra])))
        .toBe("P0001 loja_diferente: cor_id");
      expect(txt(await como(c, "authenticated", `truncate modelo_etiquetas`))).toMatch(/^42501 permission denied for table/);
      await perms(c, U_COMUM, edita(PLAN));
      expect(txt(await como(c, "authenticated", `delete from modelo_etiquetas where id = $1`, [id]))).toBe(NEG([DEV]));
      await perms(c, U_COMUM, edita(DEV));
      await ok(c, `delete from modelo_etiquetas where id = $1`, [id]);
      // B3 vale também para o SERVIDOR (postgres): etiqueta de outra loja num modelo desta loja
      await jwt(c, null);
      const srv = (etq: string, cor: string | null, tenant: string | null) => como(c, null,
        `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo) values ($1, $2, $3, $4, 1, 1)`, [tenant, fx.modelo, etq, cor]);
      expect(txt(await srv(fx.etqOutra, null, T))).toBe("P0001 loja_diferente: etiqueta_id");
      expect(txt(await srv(fx.etq, fx.corOutra, T))).toBe("P0001 loja_diferente: cor_id");
      expect(txt(await srv(fx.etq, fx.cor, fx.outra))).toBe("P0001 loja_diferente: modelo_id");
      expect(txt(await srv(fx.etq, fx.cor, T))).toBe("PASSOU");
      // UPDATE do servidor que NÃO mexe no vínculo (ex.: recálculo do custo) não confere B3 nem página
      expect(txt(await como(c, null, `update modelo_etiquetas set custo_previsto = 1 where modelo_id = $1`, [fx.modelo]))).toBe("PASSOU");
    });
  });

  it("modelo_observacoes: Desenvolvimento OU PCP Serviços (C-07); B3 modelo de outra loja → P0001", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const NEG_OBS = NEG([DEV, "producao_terceirizados"]);
      const ins = (modelo = fx.modelo) => como(c, "authenticated",
        `insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1, 1, 'Composição', '100% algodão') returning id`, [modelo]);
      for (const lista of [[], edita(PLAN), [[DEV, false], ["producao_terceirizados", false]] as [string, boolean][]]) {
        await perms(c, U_COMUM, lista);
        expect(txt(await ins()), JSON.stringify(lista)).toBe(NEG_OBS);
      }
      for (const p of [DEV, "producao_terceirizados"]) {
        await perms(c, U_COMUM, edita(p));
        const id = (await ok(c, `insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1, 1, 'Comp', 'x') returning id`, [fx.modelo]))[0].id;
        await ok(c, `update modelo_observacoes set observacao = 'y' where id = $1`, [id]);
        await ok(c, `delete from modelo_observacoes where id = $1`, [id]);
      }
      expect(txt(await ins(fx.modeloOutra))).toBe("P0001 loja_diferente: modelo_id");
      expect(txt(await como(c, "authenticated", `truncate modelo_observacoes`))).toMatch(/^42501 permission denied for table/);
      await jwt(c, null);
      expect(txt(await como(c, null, `insert into modelo_observacoes (tenant_id, modelo_id, ordem) values ($1, $2, 1)`, [T, fx.modeloOutra])))
        .toBe("P0001 loja_diferente: modelo_id");
    });
  });

  it("as 12 tabelas só-RPC: nem o super escreve direto; leitura segue", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await jwt(c, SUPER);
      for (const t of S3C_SO_RPC) {
        expect(txt(await como(c, "authenticated", `update ${t} set id = id where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `insert into ${t} select * from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "anon", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `select count(*) from ${t}`)), t).toBe("PASSOU");
      }
    });
  });
});

// ─────────────────────────────────────────── B3 nas RPCs ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3c — B3: categorias do tecido e árvore do Plan. Tecido", () => {
  it("set_artigo_categorias ignora categoria de outra loja; a árvore não mostra nome/ref de modelo de outra loja", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, SUPER);
      await ok(c, `select public.set_artigo_categorias($1, $2::uuid[])`, [fx.art, [fx.cat, fx.catOutra]]);
      const cats = await c.query(`select categoria_tecido_id from artigo_categorias_tecido where artigo_id = $1`, [fx.art]);
      expect(cats.rows.map((r) => r.categoria_tecido_id)).toEqual([fx.cat]);
      // árvore: slot apontando para modelo de OUTRA loja (dado antigo/forjado) cai no nome do slot
      const arvore = await semJwt(c, async () => {
        const col = (await um<{ id: string }>(c, `insert into colecoes (tenant_id, nome) values ($1, 'ITEST S3c col') returning id`, [T])).id;
        const plan = (await um<{ id: string }>(c, `insert into plan_tecido (tenant_id, colecao_id) values ($1, $2) returning id`, [T, col])).id;
        const sub = (await um<{ id: string }>(c, `insert into plan_tecido_subcolecoes (tenant_id, plan_id, ordem) values ($1, $2, 1) returning id`, [T, plan])).id;
        const lin = (await um<{ id: string }>(c, `insert into plan_tecido_linhas (tenant_id, sub_id, ordem) values ($1, $2, 1) returning id`, [T, sub])).id;
        await c.query(`insert into plan_tecido_slots (tenant_id, linha_ref_id, slot_index, nome, modelo_id) values ($1, $2, 0, 'SLOT OUTRA', $3), ($1, $2, 1, 'SLOT MEU', $4)`,
          [T, lin, fx.modeloOutra, fx.modelo]);
        return (await um<{ a: any }>(c, `select public._plan_tecido_arvore_core($1) a`, [col])).a;
      });
      const slots = arvore.subcolecoes[0].linhas[0].slots;
      expect(slots.length).toBe(2);
      expect(slots[0].nome).toBe("SLOT OUTRA");
      expect(slots[0].ref ?? null).toBeNull();
      expect(slots[1].nome).toBe("ITEST-S3c card");
    });
  });
});

// ─────────────────────────────────────────── ponta a ponta do Sheet ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3c — ponta a ponta do Sheet do Planejamento como o PAPEL authenticated, usuário comum COM as páginas", () => {
  it("card novo (BOM inicial + M.O.) → ficha (BOM/grade/etiquetas/observações/#Erro/CAD/prova) → Importar dados → Enviar → excluir CAD; Duplicar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const SO_PLAN: [string, boolean][] = [...edita(PLAN), CUSTOS_PLAN];
      const PLAN_DEV: [string, boolean][] = [...edita(PLAN, DEV), CUSTOS_PLAN];
      // 1) Dialog "Novo Modelo" (quem edita só o Planejamento): INSERT do card + BOM inicial (Tecido 1 só com o artigo) + M.O.
      await perms(c, U_COMUM, SO_PLAN);
      const card = (await ok(c, `insert into modelos (nome, ordem_criacao_enviada) values ('ITEST-S3c Sheet', true) returning id`))[0].id as string;
      await ok(c, `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, null)`,
        [card, JSON.stringify([{ artigo_id: fx.art, numero: 1, tipo: "tecido", variantes: [] }])]);
      await ok(c, `select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [card, linhasMo(fx, 15)]);
      // a ficha do Dev já não é dele
      expect(txt(await como(c, "authenticated", `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, null)`,
        [card, tecidosBom(fx)]))).toBe(NEG([DEV]));
      expect(txt(await como(c, "authenticated", `insert into modelo_etiquetas (modelo_id, etiqueta_id, numero) values ($1, $2, 1)`,
        [card, fx.etq]))).toBe(NEG([DEV]));
      // 2) Salvar do Sheet com a ficha (Planejamento + Desenvolvimento): BOM com variante e grade, etiquetas, observações, #Erro, CAD
      await perms(c, U_COMUM, PLAN_DEV);
      await ok(c, `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, $3::jsonb, null)`, [card, tecidosBom(fx), gradesBom]);
      const etq = (await ok(c, `insert into modelo_etiquetas (modelo_id, etiqueta_id, cor_id, numero, consumo) values ($1, $2, $3, 1, 1) returning id`,
        [card, fx.etq, fx.cor]))[0].id;
      await ok(c, `update modelo_etiquetas set consumo = 3 where id = $1`, [etq]);
      const obs = (await ok(c, `insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1, 1, 'Composição', '100% algodão') returning id`,
        [card]))[0].id;
      await ok(c, `update modelo_observacoes set observacao = '98% algodão' where id = $1`, [obs]);
      await ok(c, `select public.salvar_modelo_servico_mo($1, $2::jsonb)`,
        [card, linhasMo(fx, 18, (await um<{ id: string }>(c, `select id from modelo_servico_mo where modelo_id = $1`, [card])).id)]);
      await ok(c, `select public.marcar_revisao_por_mudanca($1, true, false, false)`, [card]);
      await ok(c, `select public.salvar_cad_completo($1, $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, null, null)`,
        [card, tecidosCad(fx), gradesBom]);
      const cad = (await um<{ id: string }>(c, `select id from cad where modelo_id = $1`, [card])).id;
      // Ajustes na Prova (seção da ficha)
      const fio = (await ok(c, `select public.prova_comentar($1, 'apertar a cintura', null) id`, [card]))[0].id;
      await ok(c, `select public.prova_comentar($1, 'ok, ajustado', $2)`, [card, fio]);
      await ok(c, `select public.prova_resolver($1, true)`, [fio]);
      const resp = (await um<{ id: string }>(c, `select id from modelo_prova_comentarios where parent_id = $1`, [fio])).id;
      await ok(c, `select public.prova_excluir($1)`, [resp]);
      // aprovar a M.O. (outra pessoa: aprovador sem editar valor)
      const linha = (await um<{ id: string }>(c, `select id from modelo_servico_mo where modelo_id = $1`, [card])).id;
      await perms(c, U_COMUM, edita("producao_servico_aprovacao"));
      await ok(c, `select public.aprovar_servico_mo($1, $2, true, null)`, [card, linha]);
      await perms(c, U_COMUM, PLAN_DEV);
      // 3) Importar dados de outro modelo: Observações (bloco) substituem na hora (DELETE + INSERT direto) e o BOM no Salvar
      await semJwt(c, () => c.query(`insert into modelo_observacoes (tenant_id, modelo_id, ordem, descricao, observacao) values ($1, $2, 1, 'Lavagem', 'à mão')`,
        [T, fx.modelo]));
      await ok(c, `delete from modelo_observacoes where modelo_id = $1`, [card]);
      await ok(c, `insert into modelo_observacoes (modelo_id, ordem, descricao, observacao)
                   select $1, ordem, descricao, observacao from modelo_observacoes where modelo_id = $2`, [card, fx.modelo]);
      await ok(c, `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, $3::jsonb, null)`, [card, tecidosBom(fx), gradesBom]);
      expect((await um<{ d: string }>(c, `select descricao d from modelo_observacoes where modelo_id = $1`, [card])).d).toBe("Lavagem");
      // 4) Enviar à Explosão (a RPC do Dev): passa o portão e chega à regra de negócio dela (etapa do kanban/requisitos da loja —
      //    fora do escopo; o OK completo do Enviar está em explosao-envio/kanban-reprovado-gate). Sem o Dev, para no portão.
      const envio = txt(await como(c, "authenticated", `select public.enviar_modelo_para_cad($1) id`, [card]));
      expect(["PASSOU", 'P0001 O modelo precisa estar na etapa "Aprovado" (ou posterior) para ser enviado à Explosão.']).toContain(envio);
      await perms(c, U_COMUM, SO_PLAN);
      expect(txt(await como(c, "authenticated", `select public.enviar_modelo_para_cad($1) id`, [card]))).toBe(NEG([DEV]));
      expect(txt(await como(c, "authenticated", `select public.excluir_cad($1)`, [cad]))).toBe(NEG([DEV]));
      await perms(c, U_COMUM, PLAN_DEV);
      // 5) Excluir o CAD rascunho (sem corte) devolve o card
      await ok(c, `select public.excluir_cad($1)`, [cad]);
      expect((await um<{ n: number }>(c, `select count(*)::int n from cad where id = $1`, [cad])).n).toBe(0);
      // 6) Duplicar (quem edita só o Planejamento): INSERT da cópia + BOM inicial + M.O.; a ficha da cópia volta a ser do Dev
      await perms(c, U_COMUM, SO_PLAN);
      const copia = (await ok(c, `insert into modelos (nome, versao) values ('ITEST-S3c Sheet', 2) returning id`))[0].id as string;
      await ok(c, `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, null)`,
        [copia, JSON.stringify([{ artigo_id: fx.art, numero: 1, tipo: "tecido", variantes: [] }])]);
      await ok(c, `select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [copia, linhasMo(fx, 15)]);
      expect(txt(await como(c, "authenticated", `select public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, null)`,
        [copia, tecidosBom(fx)]))).toBe(NEG([DEV]));
      expect(txt(await como(c, "authenticated", `select public.marcar_revisao_pendente($1, array['cq'])`, [copia]))).toBe("PASSOU");
    });
  });
});
