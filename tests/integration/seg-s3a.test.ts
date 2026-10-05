// Reforço de segurança — sub-release S3a ("Dinheiro, OCs e estoque de OC"). Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/
// s3-desenho.md (§1 mecanismo, §2.1–2.3 mapa, §3 cruzamentos, §6 S3a); plano: plan.md (P-231 = D2 A). As 3 migrations são aplicadas
// DENTRO da transação de cada teste (mig-txn: sem BEGIN/COMMIT, nunca \i) e tudo é revertido no fim: nada é gravado na cópia.
// SÓ na cópia local (ehBancoLocal). Privilégio e gatilho de página rodam DE VERDADE como o papel do PostgREST (SET LOCAL ROLE
// authenticated/anon) com o JWT de um usuário COMUM (nasce dentro da txn, com permissões por página explícitas) — o resto da suíte
// roda como postgres e não enxerga nada disso. QA nunca só com super admin (ele fura os gates).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS3a, voltaS3a, s3aViva, voltaGerarJsonSePreciso, S3A_MIGS, S3A_DOWNS, S3A_DOWN_DROPS } from "./seg-s3a-helpers";
import { S3A_MD5, S3A_PAGINAS, S3A_HELPER, S3A_GATILHOS, S3A_ACL, S3A_COLUNAS } from "./seg-s3a-dados";
import { aclTabela } from "./seg-s2-helpers";
import { aplicarArquivo } from "./mig-txn";
import { S3B_TABELAS_TRAVA } from "./seg-s3b-helpers";
import { S3C_TABELAS_TRAVA } from "./seg-s3c-helpers";
import { S3D_TABELAS_TRAVA } from "./seg-s3d-helpers";
import { S4_TABELAS_TRAVA } from "./seg-s4-helpers";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0053-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0053-0000-4000-8000-0000000000a1";
const TABELAS = Object.keys(S3A_ACL);
const RAND = "00000000-5e9a-4053-8000-00000000dead"; // id que não existe (portão vem ANTES de qualquer busca)

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | "service_role" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s3x");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s3x");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s3x");
    await c.query("RELEASE SAVEPOINT s3x");
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
    [uid, T, `${uid}@teste`, `S3a ${admin ? "admin" : "comum"}`],
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
  await aplicaS3a(c); // idempotente (S3A_TXN=1 já aplicou: a guarda aceita o "depois")
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_COMUM, false);
  await usuario(c, U_ADMIN, true);
  for (const m of ["entrada_saida", "financeiro", "criacao", "producao", "produto_acabado", "produto_importado", "otb"]) await modulo(c, m, true);
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

// ───────────── fixtures (como postgres, sem JWT) ─────────────
type Fx = { emp: string; art: string; vari: string; vari2: string; aviId: string; aviId2: string; aviEmp: string; etqId: string; etqVar: string | null };
async function fixtures(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const emp = await um<{ id: string }>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [T]);
    const art = (await um<{ id: string }>(c,
      `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST S3a tecido', 'metro', 10) returning id`, [T])).id;
    const vari = (await um<{ id: string }>(c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S3a A') returning id`, [T, art])).id;
    const vari2 = (await um<{ id: string }>(c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S3a B') returning id`, [T, art])).id;
    const avi = await um<{ id: string; emp: string }>(c,
      `select id, empresa_id emp from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id is not null
          and (select count(*) from variantes_aviamento v where v.aviamento_id = aviamentos.id) <= 1 order by id limit 1`, [T]);
    const avi2 = avi && await um<{ id: string }>(c,
      `select id from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id = $2 and id <> $3
          and (select count(*) from variantes_aviamento v where v.aviamento_id = aviamentos.id) <= 1 order by id limit 1`,
      [T, avi.emp, avi.id]);
    const etq = await um<{ id: string; var: string | null }>(c,
      `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
         from etiquetas e where e.tenant_id = $1 order by e.id limit 1`, [T]);
    if (!emp || !avi || !avi2 || !etq) throw new Error("Loja Teste sem fixture (empresa / 2 aviamentos com preço / insumo)");
    return { emp: emp.id, art, vari, vari2, aviId: avi.id, aviId2: avi2.id, aviEmp: avi.emp, etqId: etq.id, etqVar: etq.var };
  });
}
const OC_TECIDO = (fx: Fx, status: string, extra: Record<string, unknown> = {}) => ({
  numero_pedido: "ITEST-S3A-TEC", empresa_id: fx.emp, data_pedido: "2026-09-01", data_prevista_entrega: "2026-09-05",
  data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60/90", quantidade_prazos: 3, parcelas_recebimento: [],
  valor_previsto_total: 1500, valor_real_total: 1500, status, ...extra,
});
const ITEM_TEC = (fx: Fx, vari: string, q: number, status: string, id: string | null = null) => ({
  id, artigo_id: fx.art, artigo_numero: 1, variante_tecido_id: vari, quantidade_pedida: q,
  quantidade_recebida: status === "recebido" ? q : null, rendimento: null, cancelado: false, preco: 10,
});
const OC_AVI = (fx: Fx, status = "recebido", numero = "ITEST-S3A-AVI") => ({
  numero_pedido: numero, responsavel_nome: null, empresa_id: fx.aviEmp, representante_id: null, data_pedido: "2026-09-01",
  data_prevista_entrega: "2026-09-05", data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60/90",
  quantidade_prazos: 3, nf_url: null, parcelas_recebimento: [], status,
});
const ITEM_AVI = (aviamento_id: string, q: number, status = "recebido", id: string | null = null) => ({
  id, aviamento_id, variante_aviamento_id: null, quantidade_pedida: q, quantidade_recebida: status === "recebido" ? q : null, cancelado: false,
});
const OC_INS = (fx: Fx, status = "recebido", numero = "ITEST-S3A-INS") => ({
  numero_pedido: numero, responsavel_nome: null, empresa_id: fx.emp, representante_id: null, data_pedido: "2026-09-01",
  data_prevista_entrega: "2026-09-05", data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60",
  quantidade_prazos: 2, nf_url: null, nfs: [], parcelas_recebimento: [], status,
});
const ITENS_INS = (fx: Fx) => [{
  id: null, etiqueta_id: fx.etqId, variante_etiqueta_id: fx.etqVar, quantidade_pedida: 100, quantidade_recebida: 100, preco: 2.5, cancelado: false,
}];
/** OC de tecido recebida (pelo super admin, pela RPC) — devolve OC e 1º item. */
async function ocTecidoRecebida(c: Client, fx: Fx): Promise<{ oc: string; item: string }> {
  await jwt(c, SUPER);
  const oc = (await um<{ id: string }>(c, `select public.salvar_oc_tecido(null, $1::jsonb, $2::jsonb, null) as id`,
    [JSON.stringify(OC_TECIDO(fx, "recebido")), JSON.stringify([ITEM_TEC(fx, fx.vari, 100, "recebido")])])).id;
  const item = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [oc])).id;
  await jwt(c, null);
  return { oc, item };
}

// ─────────────────────────────────────────── md5, ACL, idempotência, volta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3a — md5, ACL, idempotência e volta (LIFO)", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES (textos e ACL exatos); _down_drop apaga; ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const confereIda = async () => {
        for (const [sig, m] of Object.entries(S3A_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
        expect(await md5(c, S3A_HELPER.fn)).toBe(S3A_HELPER.depois);
        for (const g of S3A_GATILHOS) {
          expect(await md5(c, g.fn), g.fn).toBe(g.depois);
          const trg = await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgrelid = to_regclass('public.' || $1)
                                                    and tgname = 'trg_aaa_seg_pagina' and tgenabled = 'O' and tgtype = 31`, [g.tabela]);
          expect(trg.n, g.tabela).toBe(1);
        }
        for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3A_ACL[t].depois);
      };
      await aplicaS3a(c);
      await confereIda();
      await aplicaS3a(c); // idempotente
      await confereIda();
      await voltaS3a(c);
      for (const [sig, m] of Object.entries(S3A_MD5)) expect(await md5(c, sig), sig).toBe(m.antes);
      expect(await md5(c, S3A_HELPER.fn)).toBe(S3A_HELPER.depois); // o helper FICA (inerte)
      for (const g of S3A_GATILHOS) expect(await md5(c, g.fn), g.fn).toBe(g.neutra); // os gatilhos FICAM, neutros
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3A_ACL[t].antes);
      await voltaS3a(c); // o inverso também é idempotente
      await voltaGerarJsonSePreciso(c); // T1: LIFO — o Gerar JSON (mais novo) cita _seg_exige_pagina num comentário e trava o DROP do helper
      for (const d of S3A_DOWN_DROPS) await aplicarArquivo(c, d);
      expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [S3A_HELPER.fn])).f).toBeNull();
      for (const g of S3A_GATILHOS) expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [g.fn])).f).toBeNull();
      expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_aaa_seg_pagina'
          and tgrelid = any (select to_regclass('public.' || x) from unnest($1::text[]) x)`, [S3A_GATILHOS.map((g) => g.tabela)])).n).toBe(0);
      for (const d of S3A_DOWN_DROPS) await aplicarArquivo(c, d); // idempotente
      await aplicaS3a(c); // ida de novo depois da volta completa
      await confereIda();
    });
  });

  it("recusas de ordem: _down_drop sem o _down; 120000 sem o helper da 100000", async () => {
    await withTx(async (c) => {
      await aplicaS3a(c);
      await expect(aplicarArquivo(c, S3A_DOWN_DROPS[0])).rejects.toThrow(/s3a_guarda_down_drop: rode antes o _down/);
      await expect(aplicarArquivo(c, S3A_DOWN_DROPS[1])).rejects.toThrow(/s3a_gates_down_drop: rode antes os inversos/);
      await voltaS3a(c, true); // volta completa (com os drops)
      await expect(aplicarArquivo(c, S3A_MIGS[2])).rejects.toThrow(/s3a_guarda: rode antes a 20261101100000/);
      // inverso sem a ida: recusa (a função de gatilho não existe)
      await expect(aplicarArquivo(c, S3A_DOWNS[0])).rejects.toThrow(/s3a_guarda_down: .* com texto inesperado \(md5 ausente\)/);
    });
  });

  it("grants só sobre a ACL medida: ACL fora do antes/depois → ida E volta recusam P0001 sem mudar nada", async () => {
    await withTx(async (c) => {
      const IDA = S3A_MIGS[1];
      const VOLTA = S3A_DOWNS[1];
      await aplicaS3a(c); // DEPOIS
      await c.query("GRANT INSERT ON public.ordens_saida_tecido TO anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s3a_grants: ACL inesperada em ordens_saida_tecido/) });
      await expect(aplicarArquivo(c, VOLTA)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s3a_grants_down: ACL inesperada em ordens_saida_tecido/) });
      for (const t of TABELAS.filter((x) => x !== "ordens_saida_tecido")) expect(await aclTabela(c, t), t).toEqual(S3A_ACL[t].depois);
      await c.query("REVOKE INSERT ON public.ordens_saida_tecido FROM anon");
      // ANTES, mas com MENOS privilégio que a cópia (a produção difere) → a ida recusa (a volta daria a mais)
      await aplicarArquivo(c, VOLTA);
      await c.query("REVOKE TRUNCATE ON public.ocs_tecido FROM anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s3a_grants: ACL inesperada em ocs_tecido/) });
      await c.query("GRANT TRUNCATE ON public.ocs_tecido TO anon");
      await aplicarArquivo(c, IDA);
      await aplicarArquivo(c, IDA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3A_ACL[t].depois);
      await aplicarArquivo(c, VOLTA);
      await aplicarArquivo(c, VOLTA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S3A_ACL[t].antes);
    });
  });
});

describe.skipIf(!RODA)("seg S3a — trava medida (pg_locks na txn revertida)", () => {
  it("helper+wrappers e grants: catálogo; gatilhos: ShareRowExclusive SÓ nas 4 OCs; nada em auth/storage/realtime", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows as { rel: string; mode: string }[];
      const QUATRO = ["public.ocs_aviamento", "public.ocs_etiqueta", "public.ocs_tecido", "public.ocs_tecido_itens"]
        .map((rel) => ({ rel, mode: "ShareRowExclusiveLock" }));
      // S3B_TXN=1: o CREATE TRIGGER da S3b (cad, controle_qualidade, producao_oficina) já pegou trava no começo da txn — não é da S3a
      // (idem S3C_TXN=1: modelo_etiquetas, modelo_observacoes)
      const foraS3b = (t: { rel: string }) => ![...S3B_TABELAS_TRAVA, ...S3C_TABELAS_TRAVA, ...S3D_TABELAS_TRAVA, ...S4_TABELAS_TRAVA].includes(t.rel); // + S3D/S4_TXN=1
      const antes = (await travas()).filter(foraS3b); // S2_TXN=1 (parcelas) / S3A_TXN=1 (as 4) já aplicados no começo da txn
      if (!(await s3aViva(c)) && antes.length === 0) {
        await aplicarArquivo(c, S3A_MIGS[0]);
        expect((await travas()).filter(foraS3b)).toEqual([]);
        await aplicarArquivo(c, S3A_MIGS[1]);
        expect((await travas()).filter(foraS3b)).toEqual([]);
        await aplicarArquivo(c, S3A_MIGS[2]);
        expect((await travas()).filter(foraS3b)).toEqual(QUATRO);
      } else {
        // T1 (backend, 05/out): com a S3a JÁ aplicada na cópia, os gatilhos já existem e o arquivo reaplicado não cria nenhum (sem CREATE TRIGGER →
        // nenhuma trava de tabela). As 4 ShareRowExclusive só aparecem na txn quando o gancho S3A_TXN=1 aplicou a ida NESTA txn (ou no ramo acima,
        // banco sem a S3a). Regra medida (inalterada): a reaplicação não pega trava nova; o que estava seguro no começo da txn é exatamente as 4 ou nada.
        const seguras = (ts: { rel: string; mode: string }[]) => ts.filter((t) => t.rel !== "public.parcelas" && foraS3b(t)); // parcelas = o CREATE TRIGGER da S2_TXN
        expect([[], QUATRO]).toContainEqual(seguras(antes));
        await aplicaS3a(c); // idempotente: não pega trava nova
        const depois = seguras(await travas());
        expect(depois).toEqual(seguras(antes));
      }
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────── grants (anti-drift) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3a — grants (has_table_privilege/has_column_privilege)", () => {
  it("anon sem escrita nas 11; authenticated: só SELECT (+ DELETE em ocs_aviamento/ocs_etiqueta) e UPDATE só nas colunas da tela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const priv = async (papel: string, t: string, p: string) =>
        (await um<{ v: boolean }>(c, `select has_table_privilege($1, to_regclass('public.' || $2), $3) v`, [papel, t, p])).v;
      for (const t of TABELAS) {
        for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          expect({ t, p, anon: await priv("anon", t, p) }).toEqual({ t, p, anon: false });
          const esperado = p === "DELETE" && (t === "ocs_aviamento" || t === "ocs_etiqueta");
          expect({ t, p, auth: await priv("authenticated", t, p) }).toEqual({ t, p, auth: esperado });
        }
        expect(await priv("authenticated", t, "SELECT"), t).toBe(true);
        expect(await priv("service_role", t, "INSERT, UPDATE, DELETE, SELECT"), t).toBe(true);
        const { rows } = await c.query(
          `select a.attname from pg_attribute a where a.attrelid = to_regclass('public.' || $1) and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') order by 1`, [t]);
        expect({ t, cols: rows.map((r) => r.attname) }).toEqual({ t, cols: [...S3A_COLUNAS[t]].sort() });
        expect((await um<{ v: boolean }>(c, `select has_any_column_privilege('anon', to_regclass('public.' || $1), 'UPDATE') v`, [t])).v).toBe(false);
      }
      // helper: authenticated/service_role executam (os gatilhos INVOKER chamam como o cliente); anon e PUBLIC não
      const ex = async (papel: string) => (await um<{ v: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') v`, [papel, S3A_HELPER.fn])).v;
      expect([await ex("anon"), await ex("authenticated"), await ex("service_role")]).toEqual([false, true, true]);
      for (const g of S3A_GATILHOS) {
        const r = await um<{ a: boolean; u: boolean; d: boolean }>(c,
          `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u,
                  (select prosecdef from pg_proc where oid = to_regprocedure($1)) d`, [g.fn]);
        expect({ fn: g.fn, ...r }).toEqual({ fn: g.fn, a: false, u: false, d: false }); // INVOKER e sem EXECUTE (só dispara)
      }
    });
  });
});

// ─────────────────────────────────────────── portão de página nas 34 RPCs ───────────────────────────────────────────
// [assinatura, chamada (dummy: id que não existe — o portão vem antes de qualquer busca), páginas esperadas na recusa (OU)]
const R = `'${RAND}'::uuid`;
const CASOS: [string, string, string[]][] = [
  ["public.recalcular_parcelas(uuid,text)", `select public.recalcular_parcelas(${R}, 'tecido')`, ["financeiro_parcelas", "financeiro_calendario"]],
  ["public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)", `select public.salvar_oc_tecido(${R}, '{}'::jsonb, '[]'::jsonb, null)`, ["entrada_oc_tecido"]],
  ["public.excluir_oc_tecido(uuid)", `select public.excluir_oc_tecido(${R})`, ["entrada_oc_tecido"]],
  ["public.desmarcar_recebimento_oc(text,uuid)", `select public.desmarcar_recebimento_oc('tecido', ${R})`, ["entrada_oc_tecido"]],
  ["public.desmarcar_recebimento_oc(text,uuid)", `select public.desmarcar_recebimento_oc('aviamento', ${R})`, ["entrada_oc_aviamento"]],
  ["public.gerar_rolos_recebimento(uuid,jsonb)", `select public.gerar_rolos_recebimento(${R}, '[]'::jsonb)`, ["entrada_oc_tecido"]],
  ["public.reverter_rolos_oc(uuid)", `select public.reverter_rolos_oc(${R})`, ["entrada_oc_tecido"]],
  ["public.salvar_oc_aviamento(uuid,jsonb,jsonb)", `select public.salvar_oc_aviamento(${R}, '{}'::jsonb, '[]'::jsonb)`, ["entrada_oc_aviamento"]],
  ["public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)", `select public.salvar_oc_aviamento(${R}, '{}'::jsonb, '[]'::jsonb, null::int)`, ["entrada_oc_aviamento"]],
  // a sobrecarga de 3 args é INALCANÇÁVEL por chamada (ambígua com a de 4 args, que tem DEFAULT): portão conferido pelo texto abaixo
  ["public.salvar_oc_etiqueta(uuid,jsonb,jsonb)", "", ["entrada_oc_insumo"]],
  ["public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)", `select public.salvar_oc_etiqueta(${R}, '{}'::jsonb, '[]'::jsonb, null::int)`, ["entrada_oc_insumo"]],
  ["public.desmarcar_recebimento_oc_etiqueta(uuid)", `select public.desmarcar_recebimento_oc_etiqueta(${R})`, ["entrada_oc_insumo"]],
  ["public.salvar_oc_p_acabado(uuid,jsonb,jsonb)", `select public.salvar_oc_p_acabado(${R}, '{}'::jsonb, '{}'::jsonb)`, ["entrada_oc_p_acabado", "criacao_produto_acabado"]],
  ["public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)", `select public.salvar_oc_p_acabado(${R}, '{}'::jsonb, '{}'::jsonb, null::int)`, ["entrada_oc_p_acabado", "criacao_produto_acabado"]],
  ["public.receber_oc_p_acabado(uuid,jsonb,jsonb)", `select public.receber_oc_p_acabado(${R}, '{}'::jsonb, '{}'::jsonb)`, ["entrada_oc_p_acabado"]],
  ["public.excluir_oc_p_acabado(uuid)", `select public.excluir_oc_p_acabado(${R})`, ["entrada_oc_p_acabado"]],
  ["public.vincular_oc_p_acabado(uuid,uuid)", `select public.vincular_oc_p_acabado(${R}, ${R})`, ["criacao_produto_acabado", "entrada_oc_p_acabado"]],
  ["public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb)", `select public.salvar_oc_importado(${R}, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)`, ["entrada_oc_p_importado", "criacao_produto_importado"]],
  ["public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)", `select public.salvar_oc_importado(${R}, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, null::int)`, ["entrada_oc_p_importado", "criacao_produto_importado"]],
  ["public.receber_oc_importado(uuid,jsonb,jsonb)", `select public.receber_oc_importado(${R}, '{}'::jsonb, '{}'::jsonb)`, ["entrada_oc_p_importado"]],
  ["public.excluir_oc_importado(uuid)", `select public.excluir_oc_importado(${R})`, ["entrada_oc_p_importado"]],
  ["public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)", `select public.aplicar_resolucao_alerta_tecido(${R}, 'estilo_ok', null, null, null)`, ["entrada_alertas_tecido", "entrada_oc_tecido"]],
  ["public.receber_reposicao_troca(uuid,date,numeric)", `select public.receber_reposicao_troca(${R}, '2026-10-01', 1)`, ["entrada_alertas_tecido", "entrada_oc_tecido"]],
  ["public.cancelar_rolo(uuid)", `select public.cancelar_rolo(${R})`, ["entrada_alertas_tecido", "entrada_oc_tecido"]],
  ["public.reabrir_rolo(uuid)", `select public.reabrir_rolo(${R})`, ["entrada_alertas_tecido", "entrada_oc_tecido"]],
  ["public.trocar_rolo(uuid,numeric)", `select public.trocar_rolo(${R}, null)`, ["entrada_alertas_tecido", "entrada_oc_tecido"]],
  ["public.criar_rolo(text,uuid,jsonb,uuid,text,text)", `select public.criar_rolo('ITEST', ${R}, '[]'::jsonb, null, null, null)`, ["entrada_oc_tecido"]],
  ["public.excluir_rolo(uuid)", `select public.excluir_rolo(${R})`, ["entrada_oc_tecido"]],
  ["public.ajustar_rolo(uuid,numeric)", `select public.ajustar_rolo(${R}, 1)`, ["entrada_oc_tecido"]],
  ["public.proximo_codigo_rolo(uuid)", `select public.proximo_codigo_rolo(null)`, ["entrada_oc_tecido", "entrada_alertas_tecido"]],
  ["public.remover_metragem_oc(uuid,numeric,text)", `select public.remover_metragem_oc(${R}, 1, null)`, ["entrada_oc_tecido"]],
  ["public.reverter_ajuste_estoque(uuid)", `select public.reverter_ajuste_estoque(${R})`, ["entrada_oc_tecido"]],
  ["public.salvar_os(text,uuid,jsonb,jsonb)", `select public.salvar_os('tecido', null, '{}'::jsonb, '[]'::jsonb)`, ["entrada_os_tecido"]],
  ["public.salvar_os(text,uuid,jsonb,jsonb)", `select public.salvar_os('aviamento', null, '{}'::jsonb, '[]'::jsonb)`, ["entrada_os_aviamento"]],
  ["public.baixar_os(text,uuid,jsonb)", `select public.baixar_os('tecido', ${R}, '{}'::jsonb)`, ["entrada_os_tecido"]],
  ["public.baixar_os(text,uuid,jsonb)", `select public.baixar_os('aviamento', ${R}, '{}'::jsonb)`, ["entrada_os_aviamento"]],
  ["public.desmarcar_os(text,uuid)", `select public.desmarcar_os('tecido', ${R})`, ["entrada_os_tecido"]],
  ["public.desmarcar_os(text,uuid)", `select public.desmarcar_os('aviamento', ${R})`, ["entrada_os_aviamento"]],
];

describe.skipIf(!RODA)("seg S3a — portão de página nas 34 RPCs (como authenticated, usuário comum)", () => {
  it("anti-drift: todo wrapper redefinido tem caso; as páginas dos casos = as do gerador", () => {
    const sigs = new Set(CASOS.map((x) => x[0]));
    expect([...Object.keys(S3A_MD5)].filter((s) => !sigs.has(s))).toEqual([]);
    expect(Object.keys(S3A_MD5).length).toBe(34);
    for (const [sig, , paginas] of CASOS) for (const p of paginas) expect(S3A_PAGINAS[sig], sig).toContain(p);
  });

  it("sem a página → 42501 sem_permissao_pagina; só VER → 42501; com CADA página do OU → passa do portão; admin da loja e super → passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const falhas: string[] = [];
      for (const [sig, sql, paginas] of CASOS) {
        if (!sql) {
          const corpo = (await um<{ d: string }>(c, `select pg_get_functiondef(to_regprocedure($1)) d`, [sig])).d;
          if (!corpo.includes(`PERFORM public._seg_exige_pagina(${paginas.map((p) => `'${p}'`).join(", ")});`)) falhas.push(`${sig}: sem o portão no texto`);
          continue;
        }
        await jwt(c, U_COMUM);
        await perms(c, U_COMUM, []);
        const r0 = txt(await como(c, "authenticated", sql));
        if (r0 !== NEG(paginas)) falhas.push(`${sig} sem página: ${r0}`);
        await perms(c, U_COMUM, paginas.map((p) => [p, false]));
        const r1 = txt(await como(c, "authenticated", sql));
        if (r1 !== NEG(paginas)) falhas.push(`${sig} só ver: ${r1}`);
        // páginas de OUTRAS áreas não abrem (ex.: Financeiro não abre OC; OC Tecido não abre OS)
        const outra = paginas.includes("financeiro_parcelas") ? "entrada_oc_tecido" : "financeiro_parcelas";
        await perms(c, U_COMUM, edita(outra));
        const r2 = txt(await como(c, "authenticated", sql));
        if (r2 !== NEG(paginas)) falhas.push(`${sig} com ${outra}: ${r2}`);
        for (const p of paginas) {
          await perms(c, U_COMUM, edita(p));
          const r = txt(await como(c, "authenticated", sql));
          if (/sem_permissao_pagina/.test(r)) falhas.push(`${sig} com ${p}: ${r}`);
        }
        for (const u of [U_ADMIN, SUPER]) {
          await jwt(c, u);
          const r = txt(await como(c, "authenticated", sql));
          if (/sem_permissao_pagina/.test(r)) falhas.push(`${sig} ${u === SUPER ? "super" : "admin da loja"}: ${r}`);
        }
      }
      expect(falhas).toEqual([]);
      // sem JWT (servidor chamando o wrapper por engano) não passa: o caminho do servidor é o _core
      await jwt(c, null);
      expect(txt(await como(c, null, `select public.excluir_oc_tecido(${R})`))).toBe(NEG(["entrada_oc_tecido"]));
    });
  });
});

// ─────────────────────────────────────────── escrita DIRETA (grant + gatilho de página) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3a — escrita direta da tela (grant por coluna + gatilho de página, como authenticated)", () => {
  it("ocs_tecido: colunas da tela só com OC Tecido (endereço do rolo também pelo Cadastro › Tecidos); derivadas/INSERT/DELETE negados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { oc } = await ocTecidoRecebida(c, fx);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, []);
      const upd = (set: string) => como(c, "authenticated", `update ocs_tecido set ${set} where id = $1`, [oc]);
      expect(txt(await upd(`nfs = '[{"numero":"x"}]'::jsonb`))).toBe(NEG(["entrada_oc_tecido"]));
      expect(txt(await upd(`rolo_rua = 'A', rolo_prateleira = '1'`))).toBe(NEG(["entrada_oc_tecido", "cadastro_tecidos"]));
      for (const set of [`valor_real_total = 1`, `status = 'encomendado'`, `data_nota_entrada = '2026-09-12'`, `valor_previsto_total = 1`, `is_rolo = true`]) {
        expect(txt(await upd(set)), set).toMatch(NEGADO_GRANT);
      }
      expect(txt(await como(c, "authenticated", `delete from ocs_tecido where id = $1`, [oc]))).toMatch(NEGADO_GRANT);
      expect(txt(await como(c, "authenticated", `insert into ocs_tecido (tenant_id, numero_pedido) values ($1, 'X')`, [T]))).toMatch(NEGADO_GRANT);
      // Cadastro › Tecidos (C-22): só o endereço do rolo
      await perms(c, U_COMUM, edita("cadastro_tecidos"));
      expect(txt(await upd(`rolo_rua = 'B', rolo_prateleira = '2'`))).toBe("PASSOU");
      expect(txt(await upd(`rolo_rua = 'B', nfs = '[{"numero":"y"}]'::jsonb`))).toBe(NEG(["entrada_oc_tecido"]));
      // OC Tecido: as 7 colunas da tela
      await perms(c, U_COMUM, edita("entrada_oc_tecido"));
      expect(txt(await upd(`nfs = '[{"numero":"1"}]'::jsonb, recebimento_responsavel_id = null, recebimento_responsavel_nome = 'S3a'`))).toBe("PASSOU");
      expect(txt(await upd(`rolo_rua = 'C', rolo_prateleira = '3'`))).toBe("PASSOU");
      // B3 (fix round 1): nº do pedido / código direto só em ROLO — OC comum muda o número só pelo salvar_oc_tecido
      const NUM = "42501 oc_numero_so_pela_rpc: numero_pedido/rolo_codigo de OC que nao e rolo so mudam pelo salvar da OC Tecido";
      expect(txt(await upd(`numero_pedido = 'ITEST-S3A-X'`))).toBe(NUM);
      expect(txt(await upd(`rolo_codigo = 'R1'`))).toBe(NUM);
      expect(txt(await upd(`numero_pedido = numero_pedido, rolo_codigo = rolo_codigo, nfs = '[]'::jsonb`))).toBe("PASSOU"); // sem mudar o nº
      const rolo = await semJwt(c, async () => {
        await jwt(c, SUPER);
        const item = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [oc])).id;
        const r = (await um<{ id: string }>(c, `select public.criar_rolo('ITEST-S3A-R', $1, $2::jsonb, $3) id`,
          [fx.art, JSON.stringify([{ variante_tecido_id: fx.vari, metragem: 10 }]), item])).id;
        return r;
      });
      await jwt(c, U_COMUM);
      expect(txt(await como(c, "authenticated", `update ocs_tecido set rolo_codigo = 'R-NOVO', numero_pedido = 'R-NOVO' where id = $1`, [rolo])))
        .toBe("PASSOU"); // diálogo do rolo (Rolos.tsx)
      await perms(c, U_COMUM, edita("cadastro_tecidos"));
      expect(txt(await como(c, "authenticated", `update ocs_tecido set rolo_codigo = 'R-X' where id = $1`, [rolo])))
        .toBe(NEG(["entrada_oc_tecido"])); // o Cadastro › Tecidos só mexe no endereço
      await perms(c, U_COMUM, edita("entrada_oc_tecido"));
      expect(txt(await upd(`valor_real_total = 1`))).toMatch(NEGADO_GRANT); // derivada segue fechada mesmo com a página
      // só VER a página não basta; admin da loja passa
      await perms(c, U_COMUM, [["entrada_oc_tecido", false]]);
      expect(txt(await upd(`nfs = '[{"numero":"z"}]'::jsonb`))).toBe(NEG(["entrada_oc_tecido"]));
      await jwt(c, U_ADMIN);
      expect(txt(await upd(`nfs = '[]'::jsonb`))).toBe("PASSOU");
      // service_role (Worker) e o servidor (postgres, sem JWT) não são mordidos pelo gatilho
      await jwt(c, null);
      expect(txt(await como(c, "service_role", `update ocs_tecido set nfs = '[]'::jsonb where id = $1`, [oc]))).toBe("PASSOU");
      expect(txt(await como(c, null, `update ocs_tecido set valor_real_total = valor_real_total where id = $1`, [oc]))).toBe("PASSOU");
    });
  });

  it("ocs_tecido_itens (adiado da S2): CQ só com OC Tecido OU Alertas de Tecido; quantidade/preço/INSERT/DELETE negados; o bump de rev da OC (DEFINER) não morde", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { oc, item } = await ocTecidoRecebida(c, fx);
      const rev0 = (await um<{ r: number }>(c, `select rev r from ocs_tecido where id = $1`, [oc])).r;
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, []);
      const upd = (set: string) => como(c, "authenticated", `update ocs_tecido_itens set ${set} where id = $1`, [item]);
      expect(txt(await upd(`cq_ok = true`))).toBe(NEG(["entrada_oc_tecido", "entrada_alertas_tecido"]));
      for (const set of [`quantidade_recebida = 1`, `preco = 1`, `quantidade_pedida = 1`, `artigo_id = artigo_id`]) expect(txt(await upd(set)), set).toMatch(NEGADO_GRANT);
      expect(txt(await como(c, "authenticated", `delete from ocs_tecido_itens where id = $1`, [item]))).toMatch(NEGADO_GRANT);
      expect(txt(await como(c, "authenticated", `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1, $2, 1)`,
        [oc, fx.art]))).toMatch(NEGADO_GRANT);
      // só Alertas de Tecido (C-23): CQ + alerta + cancelado (o "Estilo OK" do rolo grava direto)
      await perms(c, U_COMUM, edita("entrada_alertas_tecido"));
      expect(txt(await upd(`cq_ok = true, cq_observacao = 'S3a'`))).toBe("PASSOU");
      expect(txt(await upd(`cq_alerta_status = 'estilo_ok', cancelado = false`))).toBe("PASSOU");
      // o gatilho fn_colab_bump_oc (DEFINER) subiu o rev de ocs_tecido sem a página OC Tecido: o gatilho de página só morde o cliente
      expect((await um<{ r: number }>(c, `select rev r from ocs_tecido where id = $1`, [oc])).r).toBeGreaterThan(rev0);
      await perms(c, U_COMUM, edita("entrada_oc_tecido"));
      expect(txt(await upd(`cq_alerta_status = 'alertado'`))).toBe("PASSOU");
      await perms(c, U_COMUM, edita("financeiro_parcelas"));
      expect(txt(await upd(`cq_ok = false`))).toBe(NEG(["entrada_oc_tecido", "entrada_alertas_tecido"]));
    });
  });

  it("ocs_aviamento e ocs_etiqueta: nfs / Nota de Entrada e excluir OC só com a página; status/Nota de aviamento/INSERT negados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      await jwt(c, SUPER);
      const avi = (await um<{ id: string }>(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_AVI(fx, "encomendado")), JSON.stringify([ITEM_AVI(fx.aviId, 10, "encomendado")])])).id;
      const ins = (await um<{ id: string }>(c, `select public.salvar_oc_etiqueta(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_INS(fx)), JSON.stringify(ITENS_INS(fx))])).id;
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("entrada_oc_insumo")); // a página VIZINHA não abre a OC de aviamento
      expect(txt(await como(c, "authenticated", `update ocs_aviamento set nfs = '[]'::jsonb where id = $1`, [avi]))).toBe(NEG(["entrada_oc_aviamento"]));
      expect(txt(await como(c, "authenticated", `delete from ocs_aviamento where id = $1`, [avi]))).toBe(NEG(["entrada_oc_aviamento"]));
      for (const set of [`status = 'recebido'`, `data_nota_entrada = '2026-09-12'`]) {
        expect(txt(await como(c, "authenticated", `update ocs_aviamento set ${set} where id = $1`, [avi])), set).toMatch(NEGADO_GRANT);
      }
      expect(txt(await como(c, "authenticated", `insert into ocs_aviamento (tenant_id, numero_pedido) values ($1, 'X')`, [T]))).toMatch(NEGADO_GRANT);
      await perms(c, U_COMUM, edita("entrada_oc_aviamento"));
      expect(txt(await como(c, "authenticated", `update ocs_aviamento set nfs = '[]'::jsonb where id = $1`, [avi]))).toBe("PASSOU");
      expect(txt(await como(c, "authenticated", `delete from ocs_aviamento where id = $1`, [avi]))).toBe("PASSOU");
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_aviamento_itens where oc_aviamento_id = $1`, [avi])).n).toBe(0);
      // insumo: a Nota segue gravável direto (oc-insumo.tsx), só com a página; o servidor refaz os vencimentos
      expect(txt(await como(c, "authenticated", `update ocs_etiqueta set data_nota_entrada = '2026-09-12' where id = $1`, [ins])))
        .toBe(NEG(["entrada_oc_insumo"]));
      for (const set of [`status = 'encomendado'`, `rev = rev + 1`]) {
        expect(txt(await como(c, "authenticated", `update ocs_etiqueta set ${set} where id = $1`, [ins])), set).toMatch(NEGADO_GRANT);
      }
      await perms(c, U_COMUM, edita("entrada_oc_insumo"));
      expect(txt(await como(c, "authenticated", `update ocs_etiqueta set data_nota_entrada = '2026-09-12' where id = $1 returning id, rev`, [ins]))).toBe("PASSOU");
      const v = await um<{ d: string }>(c, `select to_char(min(data_vencimento), 'YYYY-MM-DD') d from parcelas where oc_etiqueta_id = $1`, [ins]);
      expect(v.d).toBe("2026-10-12");
      await jwt(c, SUPER);
      const insEnc = (await um<{ id: string }>(c, `select public.salvar_oc_etiqueta(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_INS(fx, "encomendado", "ITEST-S3A-INS-ENC")), JSON.stringify(ITENS_INS(fx))])).id;
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("entrada_oc_aviamento"));
      expect(txt(await como(c, "authenticated", `delete from ocs_etiqueta where id = $1`, [insEnc]))).toBe(NEG(["entrada_oc_insumo"]));
      await perms(c, U_COMUM, edita("entrada_oc_insumo"));
      expect(txt(await como(c, "authenticated", `delete from ocs_etiqueta where id = $1`, [insEnc]))).toBe("PASSOU");
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_etiqueta_itens where oc_etiqueta_id = $1`, [insEnc])).n).toBe(0);
    });
  });

  it("as 7 tabelas só-RPC: INSERT/UPDATE/DELETE do cliente negados (até o super admin — grant é do PAPEL); anon idem; SELECT fica", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await jwt(c, SUPER);
      for (const t of ["ocs_p_acabado", "ocs_importado", "ocs_importado_etapas", "ordens_saida_tecido", "ordens_saida_tecido_itens",
        "ordens_saida_aviamento", "ordens_saida_aviamento_itens"]) {
        expect(txt(await como(c, "authenticated", `update ${t} set tenant_id = tenant_id where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `insert into ${t} select * from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "anon", `delete from ${t} where false`)), t).toMatch(NEGADO_GRANT);
        expect(txt(await como(c, "authenticated", `select count(*) from ${t}`)), t).toBe("PASSOU");
      }
    });
  });
});

// ─────────────────────────────────────────── ponta a ponta (usuário comum COM a página) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S3a — ponta a ponta como o PAPEL authenticated, usuário comum COM a página", () => {
  it("OC Tecido: criar → editar itens (ids preservados) → receber → Nota → nfs/CQ direto → rolo (criar/ajustar/excluir) → '- Metragem' + estorno → corte + estorno → desmarcar → excluir", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("entrada_oc_tecido"));
      // criar (encomendada, 2 itens) e editar: A 100→120 (id preservado), B removido, C novo
      const oc = (await ok(c, `select public.salvar_oc_tecido(null, $1::jsonb, $2::jsonb, null) as id`,
        [JSON.stringify(OC_TECIDO(fx, "encomendado")), JSON.stringify([ITEM_TEC(fx, fx.vari, 100, "encomendado"), ITEM_TEC(fx, fx.vari2, 50, "encomendado")])]))[0].id as string;
      const itens = async () => (await c.query(`select id, variante_tecido_id v, quantidade_pedida::int q from ocs_tecido_itens where oc_tecido_id = $1 order by q`, [oc])).rows;
      const a = (await itens()).find((i) => i.v === fx.vari)!;
      await ok(c, `select public.salvar_oc_tecido($1, $2::jsonb, $3::jsonb, null)`,
        [oc, JSON.stringify(OC_TECIDO(fx, "encomendado")), JSON.stringify([ITEM_TEC(fx, fx.vari, 120, "encomendado", a.id), ITEM_TEC(fx, fx.vari2, 30, "encomendado")])]);
      const depois = await itens();
      expect(depois.map((i) => [i.v, i.q])).toEqual([[fx.vari2, 30], [fx.vari, 120]]);
      expect(depois.find((i) => i.q === 120)!.id).toBe(a.id);
      // receber (itens antes do status — invariante 1) + Nota de Entrada pela RPC → 3 parcelas a partir da Nota
      const itensRec = depois.map((i) => ITEM_TEC(fx, i.v, i.q, "recebido", i.id));
      await ok(c, `select public.salvar_oc_tecido($1, $2::jsonb, $3::jsonb, null)`,
        [oc, JSON.stringify(OC_TECIDO(fx, "recebido", { data_nota_entrada: "2026-09-12" })), JSON.stringify(itensRec)]);
      expect((await um<{ s: string }>(c, `select status s from ocs_tecido where id = $1`, [oc])).s).toBe("recebido");
      const parc = (await c.query(`select to_char(data_vencimento, 'YYYY-MM-DD') v from parcelas where oc_tecido_id = $1 order by numero_parcela`, [oc])).rows;
      expect(parc.map((p) => p.v)).toEqual(["2026-10-12", "2026-11-11", "2026-12-11"]);
      // a Nota NÃO muda mais por UPDATE direto (N8) — só pela RPC
      expect(txt(await como(c, "authenticated", `update ocs_tecido set data_nota_entrada = '2026-09-13' where id = $1`, [oc]))).toMatch(NEGADO_GRANT);
      // nfs/responsável (oc-tecido.tsx) e CQ do item (CqTecido.tsx) direto
      await ok(c, `update ocs_tecido set nfs = '[{"numero":"NF1"}]'::jsonb, recebimento_responsavel_nome = 'Fulana' where id = $1`, [oc]);
      const itemA = a.id as string;
      await ok(c, `update ocs_tecido_itens set cq_ok = true, cq_observacao = 'ok S3a' where id = $1`, [itemA]);
      // rolo: código → criar (40 m do item A) → endereço direto (Rolos.tsx) → ajustar → excluir (rolo livre)
      const cod = (await ok(c, `select public.proximo_codigo_rolo($1) c`, [fx.art]))[0].c as string;
      expect(cod).toMatch(/^R/);
      const rolo = (await ok(c, `select public.criar_rolo($1, $2, $3::jsonb, $4) id`,
        [cod, fx.art, JSON.stringify([{ variante_tecido_id: fx.vari, metragem: 40 }]), itemA]))[0].id as string;
      await ok(c, `update ocs_tecido set rolo_rua = 'A', rolo_prateleira = '2' where id = $1`, [rolo]);
      await ok(c, `select public.ajustar_rolo($1, 35)`, [rolo]);
      await ok(c, `select public.excluir_rolo($1)`, [rolo]);
      // rolos do recebimento (proximo_codigo_rolo por dentro) → reverter
      const nRolos = (await ok(c, `select public.gerar_rolos_recebimento($1, $2::jsonb) n`,
        [oc, JSON.stringify([{ origem_item_id: itemA, artigo_id: fx.art, variante_tecido_id: fx.vari, metragem: 10 }])]))[0].n;
      expect(Number(nRolos)).toBe(1);
      await ok(c, `select public.reverter_rolos_oc($1)`, [oc]);
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_tecido where is_rolo and rolo_origem_item_id = $1`, [itemA])).n).toBe(0);
      // "- Metragem" + estorno
      const baixas = async (where: string, p: any[]) =>
        Number((await um<{ t: string }>(c, `select coalesce(sum(quantidade), 0)::text t from estoque_tecido_baixas where ${where}`, p)).t);
      const aj = (await ok(c, `select public.remover_metragem_oc($1, 5, 'ITEST S3a') as id`, [itemA]))[0].id as string;
      expect(await baixas("id = $1 and origem = 'ajuste'", [aj])).toBe(5);
      await ok(c, `select public.reverter_ajuste_estoque($1)`, [aj]);
      expect(await baixas("id = $1", [aj])).toBe(0);
      // corte + estorno (RPCs da Explosão/Serviços — S3b; aqui só confirmam que o estoque da OC segue)
      const cad = await semJwt(c, async () => {
        const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'ITEST-S3a card') returning id`, [T])).id;
        const cadId = (await um<{ id: string }>(c, `insert into cad (tenant_id, modelo_id, data_enviado_corte) values ($1, $2, '2026-09-15') returning id`, [T, mod])).id;
        const ct = (await um<{ id: string }>(c, `insert into cad_tecidos (cad_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id`, [cadId, fx.art])).id;
        await c.query(`insert into cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem, metragem_enviada) values ($1, $2, 1, 20)`, [ct, fx.vari]);
        return cadId;
      });
      // (a S3b exige EDITAR a Explosão para o corte e PCP Serviços OU Explosão para o estorno — dá as duas a este usuário)
      await perms(c, U_COMUM, edita("entrada_oc_tecido", "producao_explosao"));
      await ok(c, `select public.baixar_estoque_tecido_corte($1, null)`, [cad]);
      expect(await baixas("cad_id = $1", [cad])).toBe(20);
      await perms(c, U_COMUM, edita("entrada_oc_tecido", "producao_terceirizados"));
      await ok(c, `select public.reverter_corte_tecido($1)`, [cad]);
      expect(await baixas("cad_id = $1", [cad])).toBe(0);
      await perms(c, U_COMUM, edita("entrada_oc_tecido"));
      // desmarcar → encomendada (parcelas não pagas saem) → excluir
      await ok(c, `select public.desmarcar_recebimento_oc('tecido', $1)`, [oc]);
      expect((await um<{ s: string }>(c, `select status s from ocs_tecido where id = $1`, [oc])).s).not.toBe("recebido");
      await ok(c, `select public.excluir_oc_tecido($1)`, [oc]);
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_tecido where id = $1`, [oc])).n).toBe(0);
    });
  });

  it("Alertas de Tecido (só a página Alertas): alerta → Estilo OK; rolo: cancelar → reabrir → trocar (proximo_codigo_rolo por dentro)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { item } = await ocTecidoRecebida(c, fx);
      await jwt(c, SUPER);
      const rolo = (await um<{ id: string }>(c, `select public.criar_rolo('ITEST-S3A-ROLO', $1, $2::jsonb, $3) id`,
        [fx.art, JSON.stringify([{ variante_tecido_id: fx.vari, metragem: 30 }]), item])).id;
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("entrada_alertas_tecido"));
      await ok(c, `update ocs_tecido_itens set cq_alerta_status = 'alertado' where id = $1`, [item]);
      await ok(c, `select public.aplicar_resolucao_alerta_tecido($1, 'estilo_ok', null, null, null)`, [item]);
      expect((await um<{ s: string }>(c, `select cq_alerta_status s from ocs_tecido_itens where id = $1`, [item])).s).toBe("estilo_ok");
      await ok(c, `select public.cancelar_rolo($1)`, [rolo]);
      expect((await um<{ s: string }>(c, `select cq_alerta_status s from ocs_tecido_itens where oc_tecido_id = $1`, [rolo])).s).toBe("cancelado");
      await ok(c, `select public.reabrir_rolo($1)`, [rolo]);
      const novo = (await ok(c, `select public.trocar_rolo($1, 25) id`, [rolo]))[0].id as string;
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_tecido where id = $1 and is_rolo and rolo_codigo like 'R%'`, [novo])).n).toBe(1);
      // a página Alertas NÃO abre o resto da OC Tecido
      expect(txt(await como(c, "authenticated", `select public.remover_metragem_oc($1, 1, null)`, [item]))).toBe(NEG(["entrada_oc_tecido"]));
    });
  });

  it("OC Aviamento e OC Insumo: criar → editar → receber (parcelas) → nfs/Nota direto → desmarcar → excluir encomendada direto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("entrada_oc_aviamento", "entrada_oc_insumo"));
      const avi = (await ok(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_AVI(fx, "encomendado")), JSON.stringify([ITEM_AVI(fx.aviId, 100, "encomendado"), ITEM_AVI(fx.aviId2, 50, "encomendado")])]))[0].id as string;
      const its = (await c.query(`select id, aviamento_id a, quantidade_pedida::int q from ocs_aviamento_itens where oc_aviamento_id = $1`, [avi])).rows;
      const a = its.find((i) => i.a === fx.aviId)!;
      await ok(c, `select public.salvar_oc_aviamento($1, $2::jsonb, $3::jsonb, null::int)`,
        [avi, JSON.stringify(OC_AVI(fx, "recebido")), JSON.stringify([ITEM_AVI(fx.aviId, 120, "recebido", a.id)])]);
      expect((await um<{ id: string }>(c, `select id from ocs_aviamento_itens where oc_aviamento_id = $1`, [avi])).id).toBe(a.id);
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_aviamento_id = $1`, [avi])).n).toBe(3);
      await ok(c, `update ocs_aviamento set nfs = '[{"numero":"NF-A"}]'::jsonb where id = $1`, [avi]);
      await ok(c, `select public.desmarcar_recebimento_oc('aviamento', $1)`, [avi]);
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_aviamento_id = $1`, [avi])).n).toBe(0);
      await ok(c, `delete from ocs_aviamento where id = $1`, [avi]);

      const ins = (await ok(c, `select public.salvar_oc_etiqueta(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_INS(fx)), JSON.stringify(ITENS_INS(fx))]))[0].id as string;
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_etiqueta_id = $1`, [ins])).n).toBe(2);
      await ok(c, `update ocs_etiqueta set data_nota_entrada = '2026-09-20' where id = $1`, [ins]);
      expect((await um<{ d: string }>(c, `select to_char(min(data_vencimento), 'YYYY-MM-DD') d from parcelas where oc_etiqueta_id = $1`, [ins])).d).toBe("2026-10-20");
      await ok(c, `select public.desmarcar_recebimento_oc_etiqueta($1)`, [ins]);
      await ok(c, `delete from ocs_etiqueta where id = $1`, [ins]);
      // Financeiro: Recalcular parcelas exige editar OCs OU Calendário (QA S2 obs.1) — a OC não abre
      const ocT = (await ok(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_AVI(fx, "recebido", "ITEST-S3A-AVI2")), JSON.stringify([ITEM_AVI(fx.aviId, 10)])]))[0].id as string;
      expect(txt(await como(c, "authenticated", `select public.recalcular_parcelas($1, 'aviamento')`, [ocT])))
        .toBe(NEG(["financeiro_parcelas", "financeiro_calendario"]));
      await perms(c, U_COMUM, [["financeiro_parcelas", false], ["financeiro_calendario", true]]);
      expect(txt(await como(c, "authenticated", `select public.recalcular_parcelas($1, 'aviamento')`, [ocT]))).toBe("PASSOU");
    });
  });

  it("Produto Acabado/Importado: OC pelo card do produto (C-16/C-17, só criacao_produto_*); receber só com a OC da página de Entrada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const cat = await semJwt(c, async () => {
        const g = (await um<{ id: string }>(c, `insert into grupos_produto (tenant_id, nome) values ($1, 'Fem S3aTest') returning id`, [T])).id;
        const k = (await um<{ id: string }>(c, `insert into categorias_produto (tenant_id, nome) values ($1, 'Vestido S3aTest') returning id`, [T])).id;
        return { grupo_id: g, categoria_id: k };
      });
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("criacao_produto_acabado", "criacao_produto_importado"));
      const pa = (await ok(c, `select public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify({ nome: "Vestido S3aTest", ...cat, qtd_total: 20, grade_proporcao: { P: 1, M: 1 } }),
        JSON.stringify([{ ordem: 0, peso: 1, qtd: 20 }]),
      ]))[0].id as string;
      await ok(c, `select public.criar_card_produto_acabado($1) as id`, [pa]);
      const ocPa = (await ok(c, `select public.salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify({ nome_produto: "OC S3aTest", produto_acabado_id: pa, empresa_id: fx.emp, data_pedido: "2026-09-01",
          prazo_pagamento: "30/60", qtd_total: 20, valor_unitario: 100, desconto_pct: 0 }),
        JSON.stringify({ "0": { P: { pedida: 10 }, M: { pedida: 10 } } }),
      ]))[0].id as string;
      const GRADE_PA = JSON.stringify({ "0": { P: { pedida: 10, recebida: 10, defeito: 0 }, M: { pedida: 10, recebida: 9, defeito: 1 } } });
      expect(txt(await como(c, "authenticated", `select public.receber_oc_p_acabado($1, $2::jsonb, $3::jsonb)`,
        [ocPa, JSON.stringify({ data_entrega: "2026-09-10" }), GRADE_PA]))).toBe(NEG(["entrada_oc_p_acabado"]));
      await perms(c, U_COMUM, edita("entrada_oc_p_acabado", "entrada_oc_p_importado"));
      const rec = (await ok(c, `select public.receber_oc_p_acabado($1, $2::jsonb, $3::jsonb) as v`,
        [ocPa, JSON.stringify({ data_entrega: "2026-09-10", nota_fiscal: "NF-S3a" }), GRADE_PA]))[0].v;
      expect(Number(rec.total_real)).toBe(18);
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_p_acabado_id = $1`, [ocPa])).n).toBe(2);

      await perms(c, U_COMUM, edita("criacao_produto_importado"));
      const pi = (await ok(c, `select public.salvar_produto_importado(null, $1::jsonb, $2::jsonb, $3::jsonb) as id`, [
        JSON.stringify({ nome: "Blusa S3aTest", ...cat, valor_unitario_m1: 50, cotacao_ref: 5, cotacao_final: 5, peso_kg: 0,
          transporte_m2: 0, desconto_pct: 0, markup_atacado: 2, markup_varejo: 3 }),
        JSON.stringify([{ ordem: 1, peso: 1, qtd: 10 }]),
        JSON.stringify([{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }]),
      ]))[0].id as string;
      await ok(c, `select public.criar_card_produto_importado($1) as id`, [pi]);
      const ocPi = (await ok(c, `select public.salvar_oc_importado(null, $1::jsonb, $2::jsonb, $3::jsonb) as id`, [
        JSON.stringify({ nome_produto: "OC Blusa S3aTest", produto_importado_id: pi, ...cat, qtd_total: 10, valor_unitario_m1: 50, cotacao_ref: 5,
          cotacao_final: 5, empresa_id: fx.emp, data_pedido: "2026-09-01" }),
        JSON.stringify({ "1": { P: { pedida: 10 } } }),
        JSON.stringify([{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: "2026-10-20", cotacao: 5 }]),
      ]))[0].id as string;
      await perms(c, U_COMUM, edita("entrada_oc_p_importado"));
      await ok(c, `select public.receber_oc_importado($1, $2::jsonb, $3::jsonb) as v`, [
        ocPi, JSON.stringify({ data_entrega: "2026-09-10" }), JSON.stringify({ "1": { P: { pedida: 10, recebida: 10, defeito: 0 } } }),
      ]);
      expect((await um<{ s: string }>(c, `select status s from ocs_importado where id = $1`, [ocPi])).s).toBe("recebido");
    });
  });

  it("OS do modo só-estoque (aviamento): salvar → baixar → desmarcar só com OS Aviamento; OS Tecido não abre", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const aviOs = await semJwt(c, async () => (await um<{ id: string }>(c,
        `insert into aviamentos (tenant_id, codigo_nome, empresa_id) values ($1, 'ITEST-S3A-OS', $2) returning id`, [T, fx.aviEmp])).id);
      await jwt(c, SUPER);
      await um(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_AVI(fx, "recebido", "ITEST-S3A-OS")), JSON.stringify([ITEM_AVI(aviOs, 50)])]);
      await jwt(c, U_COMUM);
      await perms(c, U_COMUM, edita("entrada_os_tecido"));
      const salvar = `select public.salvar_os('aviamento', null, $1::jsonb, $2::jsonb) as id`;
      const args = [JSON.stringify({ responsavel: "S3a" }), JSON.stringify([{ itemId: aviOs, reserva: 4 }])];
      expect(txt(await como(c, "authenticated", salvar, args))).toBe(NEG(["entrada_os_aviamento"]));
      await perms(c, U_COMUM, edita("entrada_os_aviamento"));
      const os = (await ok(c, salvar, args))[0].id as string;
      const it = (await um<{ id: string }>(c, `select id from ordens_saida_aviamento_itens where ordem_saida_id = $1`, [os])).id;
      await ok(c, `select public.baixar_os('aviamento', $1, $2::jsonb)`, [os, JSON.stringify({ [it]: 3 })]);
      expect((await um<{ b: boolean }>(c, `select baixado b from ordens_saida_aviamento where id = $1`, [os])).b).toBe(true);
      await ok(c, `select public.desmarcar_os('aviamento', $1)`, [os]);
      expect((await um<{ b: boolean }>(c, `select baixado b from ordens_saida_aviamento where id = $1`, [os])).b).toBe(false);
      // a tela não grava a OS direto (grant fechado)
      expect(txt(await como(c, "authenticated", `update ordens_saida_aviamento set baixado = true where id = $1`, [os]))).toMatch(NEGADO_GRANT);
    });
  });
});
