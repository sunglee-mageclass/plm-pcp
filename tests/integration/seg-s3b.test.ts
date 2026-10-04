// Reforço de segurança — sub-release S3b ("Produção, Expedição e Explosão"). Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/
// s3-desenho.md (§2.3 corte/Explosão, §2.4, §3 cruzamentos C-03..C-12, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A). As
// migrations (S3a por baixo + S3b) são aplicadas DENTRO da transação de cada teste (mig-txn) e tudo é revertido: nada é gravado na
// cópia. SÓ na cópia local. Privilégio e gatilho de página rodam DE VERDADE como o papel do PostgREST (SET LOCAL ROLE authenticated)
// com JWT de usuário COMUM criado na txn, com permissões por página explícitas. Os gatilhos de rev (colab), rebaixa do CQ/
// Direcionamento, #Erro e Grade Cortada são DEFINER: rodam como o dono e não podem ser mordidos — o ponta a ponta prova.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS3b, voltaS3b, s3bViva, S3B_MIGS, S3B_DOWNS, S3B_DOWN_DROP } from "./seg-s3b-helpers";
import { S3B_MD5, S3B_PAGINAS, S3B_ETAPAS, S3B_ETAPA_OUTRA, S3B_GATILHOS, S3B_ACL, S3B_COLUNAS } from "./seg-s3b-dados";
import { aclTabela } from "./seg-s2-helpers";
import { aplicarArquivo } from "./mig-txn";
import { S4_TABELAS_TRAVA } from "./seg-s4-helpers";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0054-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0054-0000-4000-8000-0000000000a1";
const TABELAS = Object.keys(S3B_ACL);
const RAND = "00000000-5e9a-4054-8000-00000000dead";
const R = `'${RAND}'::uuid`;
const TAM = "38";

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | "service_role" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s3y");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s3y");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s3y");
    await c.query("RELEASE SAVEPOINT s3y");
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
    [uid, T, `${uid}@teste`, `S3b ${admin ? "admin" : "comum"}`],
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
  await aplicaS3b(c); // idempotente (aplica a S3a antes se faltar; S3B_TXN=1 já aplicou: a guarda aceita o "depois")
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_COMUM, false);
  await usuario(c, U_ADMIN, true);
  for (const m of ["entrada_saida", "financeiro", "criacao", "producao", "produto_acabado", "produto_importado", "otb"]) await modulo(c, m, true);
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}


// ───────────── fixture de produção (como postgres, sem JWT) ─────────────
type Fx = { art: string; vari: string; modelo: string; cad: string; ct: string; ctv: string; catOf: string; catPos: string; loja: string };
/** Card com CAD (tecido 1 + 1 variante + grade planejada 10 no 38), OC de tecido recebida (100 m) e 2 serviços cadastrados
 *  (oficina = bloco-fonte da Grade Cortada; lavanderia = pós-costura). */
async function fixture(c: Client): Promise<Fx> {
  const r = await semJwt(c, async () => {
    const emp = await um<{ id: string }>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [T]);
    const art = (await um<{ id: string }>(c,
      `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST S3b tecido', 'metro', 10) returning id`, [T])).id;
    const vari = (await um<{ id: string }>(c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S3b') returning id`, [T, art])).id;
    const modelo = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'ITEST-S3b card') returning id`, [T])).id;
    const cad = (await um<{ id: string }>(c, `insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, modelo])).id;
    const ct = (await um<{ id: string }>(c,
      `insert into cad_tecidos (cad_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id`, [cad, art])).id;
    const ctv = (await um<{ id: string }>(c,
      `insert into cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem, metragem_enviada) values ($1, $2, 1, 0) returning id`,
      [ct, vari])).id;
    await c.query(`insert into cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada) values ($1, 1, $2::jsonb, 10)`,
      [cad, JSON.stringify({ [TAM]: 10 })]);
    const catOf = (await um<{ id: string }>(c,
      `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1, 'Oficina S3b', true) returning id`, [T])).id;
    const catPos = (await um<{ id: string }>(c,
      `insert into categorias_terceirizado (tenant_id, nome, ativo, etapa) values ($1, 'Lavanderia S3b', true, 'pos_costura') returning id`, [T])).id;
    const loja = (await um<{ id: string }>(c, `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`, [T])).id;
    return { emp: emp.id, art, vari, modelo, cad, ct, ctv, catOf, catPos, loja };
  });
  // estoque: OC de tecido recebida (100 m) pela RPC, como o super admin
  await jwt(c, SUPER);
  await c.query(`select public.salvar_oc_tecido(null, $1::jsonb, $2::jsonb, null)`, [
    JSON.stringify({ numero_pedido: "ITEST-S3B", empresa_id: r.emp, data_pedido: "2026-09-01", data_prevista_entrega: "2026-09-05",
      data_entrega: "2026-09-10", prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], valor_previsto_total: 1000,
      valor_real_total: 1000, status: "recebido" }),
    JSON.stringify([{ id: null, artigo_id: r.art, artigo_numero: 1, variante_tecido_id: r.vari, quantidade_pedida: 100,
      quantidade_recebida: 100, rendimento: null, cancelado: false, preco: 10 }]),
  ]);
  await jwt(c, null);
  return r;
}
const blocos = (fx: Fx, recebida = 10) => JSON.stringify([
  { categoria_terceirizado_id: fx.catOf, ativo: true, detalhado: true,
    grade_detalhe: { [fx.vari]: { [TAM]: { cortada: 10, enviada: 10, recebida, defeito: 0 } } } },
  { categoria_terceirizado_id: fx.catPos, ativo: true },
]);
const variantesCq = (n: number) => JSON.stringify([{ variante_numero: 1, etapa: "recebimento", grades: { [TAM]: n }, grade_total: n }]);
const reaisCq = (n: number) => JSON.stringify([{ variante_numero: 1, grades: { [TAM]: n }, grade_total: n }]);

// ─────────────────────────────────────────── md5, ACL, idempotência, volta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3b — md5, ACL, idempotência e volta (LIFO)", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES (textos e ACL exatos); _down_drop apaga; ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const confereIda = async () => {
        for (const [sig, m] of Object.entries(S3B_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
        for (const g of S3B_GATILHOS) {
          expect(await md5(c, g.fn), g.fn).toBe(g.depois);
          const trg = await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgrelid = to_regclass('public.' || $1)
              and tgname = 'trg_aaa_seg_pagina' and tgenabled = 'O' and tgtype = $2`, [g.tabela, g.tgtype]);
          expect(trg.n, g.tabela).toBe(1);
        }
        for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3B_ACL[t].depois);
      };
      await aplicaS3b(c);
      await confereIda();
      await aplicaS3b(c);
      await confereIda();
      await voltaS3b(c);
      for (const [sig, m] of Object.entries(S3B_MD5)) expect(await md5(c, sig), sig).toBe(m.antes);
      for (const g of S3B_GATILHOS) expect(await md5(c, g.fn), g.fn).toBe(g.neutra);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3B_ACL[t].antes);
      await voltaS3b(c);
      await aplicarArquivo(c, S3B_DOWN_DROP);
      for (const g of S3B_GATILHOS) {
        expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [g.fn])).f).toBeNull();
        expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_aaa_seg_pagina'
            and tgrelid = to_regclass('public.' || $1)`, [g.tabela])).n).toBe(0);
      }
      await aplicarArquivo(c, S3B_DOWN_DROP);
      await aplicaS3b(c);
      await confereIda();
    });
  });

  it("recusas de ordem: _down_drop sem o _down; S3b sem o helper da S3a; inverso sem a ida", async () => {
    await withTx(async (c) => {
      await aplicaS3b(c);
      await expect(aplicarArquivo(c, S3B_DOWN_DROP)).rejects.toThrow(/s3b_guarda_down_drop: rode antes o _down/);
      await voltaS3b(c, true);
      await expect(aplicarArquivo(c, S3B_DOWNS[0])).rejects.toThrow(/s3b_guarda_down: .* com texto inesperado \(md5 ausente\)/);
      // sem o helper da S3a (volta completa da S3a com os drops) a S3b recusa
      const { voltaS3a } = await import("./seg-s3a-helpers");
      await voltaS3a(c, true);
      await expect(aplicarArquivo(c, S3B_MIGS[0])).rejects.toThrow(/s3b_gates: rode antes a S3a 20261101100000/);
      await expect(aplicarArquivo(c, S3B_MIGS[2])).rejects.toThrow(/s3b_guarda: rode antes a S3a 20261101100000/);
    });
  });

  it("grants só sobre a ACL medida: ACL fora do antes/depois → ida E volta recusam P0001 sem mudar nada", async () => {
    await withTx(async (c) => {
      const IDA = S3B_MIGS[1];
      const VOLTA = S3B_DOWNS[1];
      await aplicaS3b(c);
      await c.query("GRANT INSERT ON public.lancamentos TO anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3b_grants: ACL inesperada em lancamentos/) });
      await expect(aplicarArquivo(c, VOLTA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3b_grants_down: ACL inesperada em lancamentos/) });
      await c.query("REVOKE INSERT ON public.lancamentos FROM anon");
      await aplicarArquivo(c, VOLTA);
      await c.query("REVOKE TRUNCATE ON public.cad FROM anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^s3b_grants: ACL inesperada em cad/) });
      await c.query("GRANT TRUNCATE ON public.cad TO anon");
      await aplicarArquivo(c, IDA);
      await aplicarArquivo(c, IDA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3B_ACL[t].depois);
      await aplicarArquivo(c, VOLTA);
      await aplicarArquivo(c, VOLTA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3B_ACL[t].antes);
    });
  });
});

describe.skipIf(!RODA)("seg S3b — trava medida (pg_locks na txn revertida)", () => {
  it("RPCs e grants: catálogo; gatilhos: ShareRowExclusive SÓ em cad, controle_qualidade e producao_oficina; nada em auth/storage", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows as { rel: string; mode: string }[];
      const TRES = ["public.cad", "public.controle_qualidade", "public.producao_oficina"].map((rel) => ({ rel, mode: "ShareRowExclusiveLock" }));
      const s3b = (x: { rel: string }) => TRES.some((t) => t.rel === x.rel);
      if (!(await s3bViva(c))) {
        const { aplicaS3a } = await import("./seg-s3a-helpers");
        await aplicaS3a(c); // por baixo (as travas dela são nas 4 OCs, separadas abaixo)
        const antes = (await travas()).filter(s3b);
        expect(antes).toEqual([]);
        await aplicarArquivo(c, S3B_MIGS[0]);
        expect((await travas()).filter(s3b)).toEqual([]);
        await aplicarArquivo(c, S3B_MIGS[1]);
        expect((await travas()).filter(s3b)).toEqual([]);
        await aplicarArquivo(c, S3B_MIGS[2]);
      } else {
        await aplicaS3b(c); // idempotente: não pega trava nova
      }
      expect((await travas()).filter(s3b)).toEqual(TRES);
      // fora das 3 da S3b só pode haver as da S3a (4 OCs) e a da S2 (parcelas) — ganchos/camada de baixo
      const outras = (await travas()).filter((t) => !s3b(t)).map((t) => t.rel);
      // (+ S3C_TXN=1: modelo_etiquetas/modelo_observacoes, gatilhos da S3c)
      expect(outras.every((r) => ["public.ocs_tecido", "public.ocs_tecido_itens", "public.ocs_aviamento", "public.ocs_etiqueta", "public.parcelas",
        "public.modelo_etiquetas", "public.modelo_observacoes", "public.modelos", "public.produtos_acabados", "public.produtos_importados",
        ...S4_TABELAS_TRAVA].includes(r)), outras.join(",")).toBe(true); // (+ S4_TXN=1: as 13 do OTB/mix)
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────── grants (anti-drift) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3b — grants (has_table_privilege/has_column_privilege)", () => {
  it("anon sem escrita nas 8; authenticated: só SELECT (+ INSERT/UPDATE na Oficina) e UPDATE só nas colunas da tela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const priv = async (papel: string, t: string, p: string) =>
        (await um<{ v: boolean }>(c, `select has_table_privilege($1, to_regclass('public.' || $2), $3) v`, [papel, t, p])).v;
      for (const t of TABELAS) {
        for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          expect({ t, p, anon: await priv("anon", t, p) }).toEqual({ t, p, anon: false });
          const esperado = t === "producao_oficina" && (p === "INSERT" || p === "UPDATE");
          expect({ t, p, auth: await priv("authenticated", t, p) }).toEqual({ t, p, auth: esperado });
        }
        expect(await priv("authenticated", t, "SELECT"), t).toBe(true);
        expect(await priv("service_role", t, "INSERT, UPDATE, DELETE, SELECT"), t).toBe(true);
        const cols = S3B_COLUNAS[t];
        if (cols) {
          const { rows } = await c.query(
            `select a.attname from pg_attribute a where a.attrelid = to_regclass('public.' || $1) and a.attnum > 0 and not a.attisdropped
                and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') order by 1`, [t]);
          expect({ t, cols: rows.map((r) => r.attname) }).toEqual({ t, cols: [...cols].sort() });
        }
      }
      for (const g of S3B_GATILHOS) {
        const r = await um<{ a: boolean; u: boolean; d: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u,
                  (select prosecdef from pg_proc where oid = to_regprocedure($1)) d`, [g.fn]);
        expect({ fn: g.fn, ...r }).toEqual({ fn: g.fn, a: false, u: false, d: false });
      }
    });
  });
});

// ─────────────────────────────────────────── portão de página nas 17 RPCs ───────────────────────────────────────────
const CASOS: [string, string, string[]][] = [
  ["public.baixar_estoque_tecido_corte(uuid,integer)", `select public.baixar_estoque_tecido_corte(${R}, null)`, ["producao_explosao"]],
  ["public.salvar_explosao_metragem(uuid,jsonb,integer)", `select public.salvar_explosao_metragem(${R}, '[]'::jsonb, null)`, ["producao_explosao"]],
  ["public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)", `select public.salvar_explosao_aviamento_separar(${R}, '[]'::jsonb, null)`, ["producao_explosao"]],
  ["public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)", `select public.salvar_explosao_etiqueta_enviar(${R}, '[]'::jsonb, null)`, ["producao_explosao"]],
  ["public.voltar_modelo_desenvolvimento(uuid)", `select public.voltar_modelo_desenvolvimento(${R})`, ["producao_explosao"]],
  ["public.reverter_corte_tecido(uuid)", `select public.reverter_corte_tecido(${R})`, ["producao_terceirizados", "producao_explosao"]],
  ["public.salvar_terceirizados(uuid,jsonb,text,jsonb)", `select public.salvar_terceirizados(${R}, '[]'::jsonb, null, null)`, ["producao_terceirizados", "producao_etapas"]],
  ["public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)", `select public.salvar_cq(${R}, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null)`, ["producao_cq"]],
  ["public.desmarcar_cq(uuid)", `select public.desmarcar_cq(${R})`, ["producao_cq"]],
  ["public.voltar_cq_para_servico(uuid)", `select public.voltar_cq_para_servico(${R})`, ["producao_cq"]],
  ["public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)", `select public.salvar_cq_pos(${R}, '{}'::jsonb, '[]'::jsonb, false)`, ["producao_cq"]],
  ["public.desmarcar_cq_pos(uuid)", `select public.desmarcar_cq_pos(${R})`, ["producao_cq"]],
  ["public.salvar_direcionamento(uuid,jsonb)", `select public.salvar_direcionamento(${R}, '[]'::jsonb)`, ["producao_direcionamento"]],
  ["public.salvar_direcionamento(uuid,jsonb,jsonb)", `select public.salvar_direcionamento(${R}, '[]'::jsonb, '{}'::jsonb)`, ["producao_direcionamento"]],
  ["public.confirmar_direcionamento(uuid,jsonb)", `select public.confirmar_direcionamento(${R}, '[]'::jsonb)`, ["producao_direcionamento"]],
  ["public.confirmar_direcionamento(uuid,jsonb,jsonb)", `select public.confirmar_direcionamento(${R}, '[]'::jsonb, '{}'::jsonb)`, ["producao_direcionamento"]],
  ...Object.entries(S3B_ETAPAS).map(([etapa, paginas]) =>
    ["public.marcar_etapa_verificada(uuid,text)", `select public.marcar_etapa_verificada(${R}, '${etapa}')`, paginas] as [string, string, string[]]),
  ["public.marcar_etapa_verificada(uuid,text)", `select public.marcar_etapa_verificada(${R}, 'cad')`, S3B_ETAPA_OUTRA],
];

describe.skipIf(!RODA)("seg S3b — portão de página nas 17 RPCs (como authenticated, usuário comum)", () => {
  it("anti-drift: todo wrapper redefinido tem caso; as páginas dos casos = as do gerador", () => {
    const sigs = new Set(CASOS.map((x) => x[0]));
    expect(Object.keys(S3B_MD5).filter((s) => !sigs.has(s))).toEqual([]);
    expect(Object.keys(S3B_MD5).length).toBe(17);
    for (const [sig, , paginas] of CASOS) for (const p of paginas) expect(S3B_PAGINAS[sig], sig).toContain(p);
  });

  it("sem a página → 42501; só VER → 42501; página de outra área → 42501; com CADA página do OU, admin e super → passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const falhas: string[] = [];
      for (const [sig, sql, paginas] of CASOS) {
        await jwt(c, U_COMUM);
        await perms(c, U_COMUM, []);
        const r0 = txt(await como(c, "authenticated", sql));
        if (r0 !== NEG(paginas)) falhas.push(`${sql} sem página: ${r0}`);
        await perms(c, U_COMUM, paginas.map((p) => [p, false]));
        const r1 = txt(await como(c, "authenticated", sql));
        if (r1 !== NEG(paginas)) falhas.push(`${sql} só ver: ${r1}`);
        await perms(c, U_COMUM, edita("entrada_oc_tecido"));
        const r2 = txt(await como(c, "authenticated", sql));
        if (r2 !== NEG(paginas)) falhas.push(`${sql} com entrada_oc_tecido: ${r2}`);
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
      // marcar_etapa_verificada exige o módulo Criação OU Produção (C14)
      await modulo(c, "criacao", false);
      await modulo(c, "producao", false);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("producao_cq"));
      expect(txt(await como(c, "authenticated", `select public.marcar_etapa_verificada(${R}, 'cq')`)))
        .toBe("42501 Módulo criacao/producao não habilitado para esta loja");
      await modulo(c, "producao", true);
      expect(txt(await como(c, "authenticated", `select public.marcar_etapa_verificada(${R}, 'cq')`))).toBe("PASSOU");
    });
  });
});

// ─────────────────────────────────────────── escrita DIRETA ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3b — escrita direta da tela (grant por coluna + gatilho de página, como authenticated)", () => {
  it("cad POR COLUNA: direcionamento_* = Direcionamento; sem_acabamento = PCP Serviços; observacoes_molde = Oficina OU Serviços; derivadas negadas", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const upd = (set: string) => como(c, "authenticated", `update cad set ${set} where id = $1`, [fx.cad]);
      await perms(c, U_COMUM, []);
      expect(txt(await upd(`direcionamento_status = 'separado'`))).toBe(NEG(["producao_direcionamento"]));
      expect(txt(await upd(`sem_acabamento = true`))).toBe(NEG(["producao_terceirizados"]));
      expect(txt(await upd(`observacoes_molde = 'frente/costas'`))).toBe(NEG(["producao_oficina", "producao_terceirizados"]));
      for (const set of [`enviado_corte = true`, `modelo_id = modelo_id`, `data_enviado_corte = '2026-09-01'`, `tenant_id = tenant_id`]) {
        expect(txt(await upd(set)), set).toMatch(NEGADO_GRANT);
      }
      expect(txt(await como(c, "authenticated", `delete from cad where id = $1`, [fx.cad]))).toMatch(NEGADO_GRANT);
      expect(txt(await como(c, "authenticated", `insert into cad (tenant_id) values ($1)`, [T]))).toMatch(NEGADO_GRANT);
      // cada página só abre a SUA coluna
      await perms(c, U_COMUM, edita("producao_direcionamento"));
      expect(txt(await upd(`direcionamento_status = 'pendente', direcionamento_confirmado_at = null`))).toBe("PASSOU");
      expect(txt(await upd(`sem_acabamento = true`))).toBe(NEG(["producao_terceirizados"]));
      await perms(c, U_COMUM, edita("producao_terceirizados"));
      expect(txt(await upd(`sem_acabamento = true`))).toBe("PASSOU");
      expect(txt(await upd(`observacoes_molde = 'pelo PCP'`))).toBe("PASSOU");
      expect(txt(await upd(`direcionamento_status = 'separado'`))).toBe(NEG(["producao_direcionamento"]));
      await perms(c, U_COMUM, edita("producao_oficina"));
      expect(txt(await upd(`observacoes_molde = 'pela Oficina'`))).toBe("PASSOU");
      expect(txt(await upd(`sem_acabamento = false`))).toBe(NEG(["producao_terceirizados"]));
      // 2 grupos de uma vez = exige os 2
      await perms(c, U_COMUM, edita("producao_oficina", "producao_terceirizados"));
      expect(txt(await upd(`sem_acabamento = false, observacoes_molde = null`))).toBe("PASSOU");
      // só VER não basta; admin passa; servidor e service_role passam
      await perms(c, U_COMUM, [["producao_terceirizados", false]]);
      expect(txt(await upd(`sem_acabamento = true`))).toBe(NEG(["producao_terceirizados"]));
      await jwt(c, U_ADMIN);
      expect(txt(await upd(`sem_acabamento = true`))).toBe("PASSOU");
      await jwt(c, null);
      expect(txt(await como(c, "service_role", `update cad set sem_acabamento = false where id = $1`, [fx.cad]))).toBe("PASSOU");
      expect(txt(await como(c, null, `update cad set enviado_corte = enviado_corte where id = $1`, [fx.cad]))).toBe("PASSOU");
    });
  });

  it("controle_qualidade (fotografado = Lançamentos), producao_oficina (Oficina) e as 5 tabelas só-RPC", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      const cq = await semJwt(c, async () => (await um<{ id: string }>(c,
        `insert into controle_qualidade (cad_id, tenant_id) values ($1, $2) returning id`, [fx.cad, T])).id);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("producao_cq"));
      const foto = () => como(c, "authenticated", `update controle_qualidade set fotografado_variantes = '{"1": true}'::jsonb where id = $1`, [cq]);
      expect(txt(await foto())).toBe(NEG(["producao_lancamentos"]));
      for (const set of [`status = 'confirmado'`, `status_pos = 'confirmado'`, `rev = rev + 1`]) {
        expect(txt(await como(c, "authenticated", `update controle_qualidade set ${set} where id = $1`, [cq])), set).toMatch(NEGADO_GRANT);
      }
      await perms(c, U_COMUM, edita("producao_lancamentos"));
      expect(txt(await foto())).toBe("PASSOU");
      // Oficina: a tela grava o formulário inteiro direto (INSERT/UPDATE) — só com a página; DELETE nunca
      const ins = `insert into producao_oficina (cad_id, status, quantidade_enviada) values ($1, 'pendente', 10) returning id`;
      await perms(c, U_COMUM, edita("producao_terceirizados"));
      expect(txt(await como(c, "authenticated", ins, [fx.cad]))).toBe(NEG(["producao_oficina"]));
      await perms(c, U_COMUM, edita("producao_oficina"));
      const of = (await ok(c, ins, [fx.cad]))[0].id as string;
      await ok(c, `update producao_oficina set quantidade_recebida = 9, status = 'entregue' where id = $1`, [of]);
      expect(txt(await como(c, "authenticated", `delete from producao_oficina where id = $1`, [of]))).toMatch(NEGADO_GRANT);
      await perms(c, U_COMUM, [["producao_oficina", false]]);
      expect(txt(await como(c, "authenticated", `update producao_oficina set observacao = 'x' where id = $1`, [of]))).toBe(NEG(["producao_oficina"]));
      // as 5 só-RPC: nem o super escreve direto (grant é do PAPEL)
      await jwt(c, SUPER);
      for (const t of ["cq_variantes", "cq_pos_variantes", "direcionamento_controle", "lancamentos", "producao_terceirizados"]) {
        expect(txt(await como(c, "authenticated", `update ${t} set id = id where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `insert into ${t} select * from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "anon", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `select count(*) from ${t}`)), t).toBe("PASSOU");
      }
    });
  });

  it("discriminador: RPC DEFINER de outra página que grava a tabela NÃO é mordida; a única INVOKER (voltar ao Dev) passa com a GUC da S1", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      // só PCP Serviços: salvar_terceirizados grava producao_terceirizados + cad.observacoes_molde (DEFINER) → passa;
      // o mesmo usuário NÃO grava producao_terceirizados direto
      await perms(c, U_COMUM, edita("producao_terceirizados"));
      await ok(c, `select public.salvar_terceirizados($1, $2::jsonb, 'molde pelo PCP', null)`, [fx.cad, blocos(fx)]);
      expect((await um<{ m: string }>(c, `select observacoes_molde m from cad where id = $1`, [fx.cad])).m).toBe("molde pelo PCP");
      expect(txt(await como(c, "authenticated", `update producao_terceirizados set quantidade_enviada = 1 where cad_id = $1`, [fx.cad])))
        .toMatch(NEGADO_GRANT);
      // Etapas PL (C-09) também salva os serviços
      await perms(c, U_COMUM, edita("producao_etapas"));
      const pt = await um<{ id: string; rev: number }>(c, `select id, rev from producao_terceirizados where cad_id = $1 and categoria_terceirizado_id = $2`, [fx.cad, fx.catOf]);
      await ok(c, `select public.salvar_terceirizados($1, $2::jsonb, null, $3::jsonb)`, [fx.cad,
        JSON.stringify([{ id: pt.id, categoria_terceirizado_id: fx.catOf, ativo: true, detalhado: true,
          grade_detalhe: { [fx.vari]: { [TAM]: { cortada: 10, enviada: 10, recebida: 10, defeito: 0 } } } }]),
        JSON.stringify({ [pt.id]: pt.rev })]);
      // só Explosão: voltar ao Desenvolvimento (INVOKER) grava modelos.enviado_cad com a GUC app.explosao_sistema da S1
      await semJwt(c, async () => {
        await c.query(`select set_config('app.explosao_sistema', 'on', true)`);
        await c.query(`update modelos set enviado_cad = true where id = $1`, [fx.modelo]);
        await c.query(`select set_config('app.explosao_sistema', '', true)`);
      });
      await perms(c, U_COMUM, edita("producao_explosao"));
      await ok(c, `select public.voltar_modelo_desenvolvimento($1)`, [fx.modelo]);
      expect((await um<{ e: boolean }>(c, `select enviado_cad e from modelos where id = $1`, [fx.modelo])).e).toBe(false);
      await perms(c, U_COMUM, edita("producao_cq"));
      expect(txt(await como(c, "authenticated", `select public.voltar_modelo_desenvolvimento($1)`, [fx.modelo]))).toBe(NEG(["producao_explosao"]));
    });
  });
});

// ─────────────────────────────────────────── ponta a ponta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3b — ponta a ponta como o PAPEL authenticated, usuário comum COM as páginas", () => {
  it("corte → PCP Serviços → CQ Pré/Pós → Direcionamento (+ desmarcar direto) → Lançamentos (fotografado) → Lançar; Oficina; Verificar #Erro; reverter corte", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixture(c);
      await jwt(c, U_COMUM);
      const baixas = async () =>
        Number((await um<{ t: string }>(c, `select coalesce(sum(quantidade), 0)::text t from estoque_tecido_baixas where cad_id = $1`, [fx.cad])).t);
      // 1) Explosão: metragem + corte (baixa no ledger)
      await perms(c, U_COMUM, edita("producao_explosao"));
      await ok(c, `select public.salvar_explosao_metragem($1, $2::jsonb, null)`, [fx.cad, JSON.stringify([{ id: fx.ctv, metragem_enviada: 20 }])]);
      await ok(c, `select public.salvar_explosao_aviamento_separar($1, '[]'::jsonb, null)`, [fx.cad]);
      await ok(c, `select public.salvar_explosao_etiqueta_enviar($1, '[]'::jsonb, null)`, [fx.cad]);
      await ok(c, `select public.baixar_estoque_tecido_corte($1, null)`, [fx.cad]);
      expect(await baixas()).toBe(20);
      // 2) PCP Serviços: bloco-fonte (Grade Cortada) + pós-costura; "Sem acabamento" direto ida e volta
      await perms(c, U_COMUM, edita("producao_terceirizados"));
      await ok(c, `select public.salvar_terceirizados($1, $2::jsonb, null, null)`, [fx.cad, blocos(fx)]);
      await ok(c, `update cad set sem_acabamento = true where id = $1`, [fx.cad]);
      await ok(c, `update cad set sem_acabamento = false where id = $1`, [fx.cad]);
      const pos = (await um<{ id: string }>(c, `select id from producao_terceirizados where cad_id = $1 and categoria_terceirizado_id = $2`, [fx.cad, fx.catPos])).id;
      // 3) CQ Pré (grava o grade_detalhe do bloco-fonte e a Grade Real, DEFINER) e Pós
      await perms(c, U_COMUM, edita("producao_cq"));
      const pre = (await ok(c, `select public.salvar_cq($1, '{}'::jsonb, $2::jsonb, $3::jsonb, true, null) r`, [fx.cad, variantesCq(10), reaisCq(10)]))[0].r;
      expect(pre.status).toBe("confirmado");
      const real = await um<{ g: any }>(c, `select grades_reais g from cad_grades where cad_id = $1 and variante_numero = 1`, [fx.cad]);
      expect(Number(real.g?.[TAM])).toBe(10);
      const posR = (await ok(c, `select public.salvar_cq_pos($1, '{}'::jsonb, $2::jsonb, true) r`, [fx.cad,
        JSON.stringify([{ producao_terceirizado_id: pos, variante_numero: 1, etapa: "acabamento", grades: { [TAM]: 10 } }])]))[0].r;
      expect(posR.status_pos).toBe("confirmado");
      // 4) Direcionamento: rascunho → confirmar (exige CQ liberado) → desmarcar direto → confirmar de novo
      await perms(c, U_COMUM, edita("producao_direcionamento"));
      const rows = JSON.stringify([{ loja_id: fx.loja, variante_numero: 1, grades: { [TAM]: 10 } }]);
      // (as sobrecargas de 2 args já estão quebradas no banco — 42725 _salvar_direcionamento_core ambígua, ANTES da S3b; a tela usa as de 3)
      await ok(c, `select public.salvar_direcionamento($1, $2::jsonb, '{}'::jsonb)`, [fx.cad, rows]);
      await ok(c, `select public.confirmar_direcionamento($1, $2::jsonb, '{}'::jsonb)`, [fx.cad, rows]);
      expect((await um<{ s: string }>(c, `select direcionamento_status s from cad where id = $1`, [fx.cad])).s).toBe("separado");
      await ok(c, `update cad set direcionamento_status = 'pendente', direcionamento_confirmado_at = null where id = $1`, [fx.cad]);
      await ok(c, `select public.confirmar_direcionamento($1, $2::jsonb, '{}'::jsonb)`, [fx.cad, rows]);
      // 5) Lançamentos: fotografado direto
      await perms(c, U_COMUM, edita("producao_lancamentos"));
      await ok(c, `update controle_qualidade set fotografado_variantes = '{"1": true}'::jsonb where cad_id = $1`, [fx.cad]);
      // 6) Lançar (Planejamento — gate de página fica para a S3d; aqui prova que o fluxo inteiro fecha)
      await perms(c, U_COMUM, edita("criacao_planejamento"));
      await ok(c, `select public.lancar_modelo($1, '2026-10-01', true)`, [fx.modelo]);
      expect((await um<{ l: boolean }>(c, `select lancado l from modelos where id = $1`, [fx.modelo])).l).toBe(true);
      // 7) Oficina: formulário + "Partes do Molde" no CAD
      await perms(c, U_COMUM, edita("producao_oficina"));
      const of = (await ok(c, `insert into producao_oficina (cad_id, status, quantidade_enviada) values ($1, 'pendente', 10) returning id`, [fx.cad]))[0].id;
      await ok(c, `update producao_oficina set quantidade_recebida = 10, status = 'entregue' where id = $1`, [of]);
      await ok(c, `update cad set observacoes_molde = 'frente, costas, manga' where id = $1`, [fx.cad]);
      // 8) #Erro: só quem edita a página da etapa marca verificado
      await semJwt(c, () => c.query(`update modelos set revisao_pendente = '{"cq": true, "terceirizados": true}'::jsonb where id = $1`, [fx.modelo]));
      await perms(c, U_COMUM, edita("producao_cq"));
      await ok(c, `select public.marcar_etapa_verificada($1, 'cq')`, [fx.modelo]);
      expect(txt(await como(c, "authenticated", `select public.marcar_etapa_verificada($1, 'terceirizados')`, [fx.modelo])))
        .toBe(NEG(["producao_terceirizados"]));
      expect((await um<{ rp: any }>(c, `select revisao_pendente rp from modelos where id = $1`, [fx.modelo])).rp).toEqual({ terceirizados: true });
      // 9) CQ desmarca (rebaixa Lançado + #Erro, DEFINER) e o PCP reverte o corte (C-06)
      await ok(c, `select public.desmarcar_cq_pos($1)`, [fx.cad]);
      await ok(c, `select public.desmarcar_cq($1)`, [fx.cad]);
      expect((await um<{ l: boolean }>(c, `select lancado l from modelos where id = $1`, [fx.modelo])).l).toBe(false);
      await ok(c, `select public.voltar_cq_para_servico($1)`, [fx.cad]);
      await perms(c, U_COMUM, edita("producao_terceirizados"));
      await ok(c, `select public.reverter_corte_tecido($1)`, [fx.cad]);
      expect(await baixas()).toBe(0);
    });
  });
});
