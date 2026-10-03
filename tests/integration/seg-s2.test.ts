// Reforço de segurança — Release S2 ("Dinheiro e estoque"). Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md
// (§2 S2 — testes; RESPOSTAS DO DONO: P-232 = D3 A). As 3 migrations são aplicadas DENTRO da transação de cada teste (mig-txn:
// sem BEGIN/COMMIT, nunca \i) e tudo é revertido no fim: nada é gravado na cópia. SÓ na cópia local (ehBancoLocal).
// Os testes de privilégio rodam como o PAPEL do PostgREST (SET LOCAL ROLE authenticated/anon) — o resto da suíte roda como
// postgres (dono) e por isso não enxerga grant de tabela. Usuários de teste (comum e admin da loja) nascem DENTRO da txn:
// QA nunca só com super admin (C13: o super fura os gates de permissão).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaS2, voltaS2, S2_MD5, S2_PERM, S2_ACL, S2_DOWN_DROP, aclTabela } from "./seg-s2-helpers";
import { aplicarArquivo } from "./mig-txn";
import { voltaS3aSePreciso } from "./seg-s3a-helpers";

import { S3B_TABELAS_TRAVA } from "./seg-s3b-helpers";
const S3A_TABELAS_TRAVA = ["public.ocs_aviamento", "public.ocs_etiqueta", "public.ocs_tecido", "public.ocs_tecido_itens"];

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "5e9a0052-0000-4000-8000-0000000000c1";
const U_ADMIN = "5e9a0052-0000-4000-8000-0000000000a1";
const TABELAS = Object.keys(S2_ACL);

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real: authenticated/anon) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | "anon" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s2x");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s2x");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s2x");
    await c.query("RELEASE SAVEPOINT s2x");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
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
    [uid, T, `${uid}@teste`, `S2 ${admin ? "admin" : "comum"}`],
  );
  if (admin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [uid]);
}
/** Permissão por página do usuário comum (exceção explícita em user_permissions; troca a de antes). */
async function permissao(c: Client, uid: string, pagina: string, ver: boolean, editar: boolean): Promise<void> {
  await semJwt(c, () => c.query(
    `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, pagina) DO UPDATE SET pode_ver = excluded.pode_ver, pode_editar = excluded.pode_editar`,
    [uid, T, pagina, ver, editar],
  ));
}
async function semPermissoes(c: Client, uid: string): Promise<void> {
  await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]));
}
async function modulo(c: Client, chave: string, ligado: boolean): Promise<void> {
  await semJwt(c, () => c.query(
    `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE tenant_id = $1`,
    [T, chave, ligado],
  ));
}
/** Prepara: S2 aplicada na txn, super admin fixado na Loja Teste, os 2 usuários de teste, módulos da Entrada/Financeiro ligados. */
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '120s'");
  await aplicaS2(c); // idempotente (S2_TXN=1 já aplicou: a guarda aceita o "depois")
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuario(c, U_COMUM, false);
  await usuario(c, U_ADMIN, true);
  for (const m of ["entrada_saida", "financeiro", "criacao", "producao", "produto_acabado", "produto_importado", "otb"]) await modulo(c, m, true);
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function guc(c: Client, nome: string): Promise<string> {
  return (await um<{ v: string | null }>(c, "SELECT coalesce(current_setting($1, true), '') AS v", [nome])).v ?? "";
}

// ───────────── fixtures (como postgres, sem JWT) ─────────────
type Fx = {
  emp: string; art: string; vari: string; aviId: string; aviId2: string; aviEmp: string;
  etqId: string; etqVar: string | null; etqId2: string; etqVar2: string | null;
};
async function fixtures(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const emp = await um<{ id: string }>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [T]);
    const art = (await um<{ id: string }>(c,
      `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST-S2 tecido', 'metro', 10) returning id`, [T])).id;
    const vari = (await um<{ id: string }>(c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S2') returning id`, [T, art])).id;
    const avi = await um<{ id: string; emp: string }>(c,
      `select id, empresa_id emp from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id is not null
          and (select count(*) from variantes_aviamento v where v.aviamento_id = aviamentos.id) <= 1 order by id limit 1`, [T]);
    const etqs = (await c.query(
      `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
         from etiquetas e where e.tenant_id = $1 order by e.id limit 2`, [T])).rows as { id: string; var: string | null }[];
    // 2º aviamento do MESMO fornecedor, também com no máximo 1 cor (L9: com 2+ cores a cor é obrigatória na linha editada)
    const avi2 = avi && await um<{ id: string }>(c,
      `select id from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id = $2 and id <> $3
          and (select count(*) from variantes_aviamento v where v.aviamento_id = aviamentos.id) <= 1 order by id limit 1`,
      [T, avi.emp, avi.id]);
    if (!emp || !avi || !avi2 || etqs.length < 2) throw new Error("Loja Teste sem fixture (empresa / 2 aviamentos com preço / 2 insumos)");
    return {
      emp: emp.id, art, vari, aviId: avi.id, aviId2: avi2.id, aviEmp: avi.emp,
      etqId: etqs[0].id, etqVar: etqs[0].var, etqId2: etqs[1].id, etqVar2: etqs[1].var,
    };
  });
}
const OC_TECIDO = (fx: Fx, status = "recebido") => ({
  numero_pedido: "ITEST-S2-TEC", empresa_id: fx.emp, data_pedido: "2026-09-01", data_prevista_entrega: "2026-09-05",
  data_entrega: "2026-09-10", prazo_pagamento: "30/60/90", quantidade_prazos: 3, parcelas_recebimento: [],
  valor_previsto_total: 1000, valor_real_total: 1000, status,
});
const ITENS_TECIDO = (fx: Fx) => [{
  id: null, artigo_id: fx.art, artigo_numero: 1, variante_tecido_id: fx.vari, quantidade_pedida: 100, quantidade_recebida: 100,
  rendimento: null, cancelado: false, preco: 10,
}];
const OC_AVI = (fx: Fx, status = "recebido") => ({
  numero_pedido: "ITEST-S2-AVI", responsavel_nome: null, empresa_id: fx.aviEmp, representante_id: null, data_pedido: "2026-09-01",
  data_prevista_entrega: "2026-09-05", data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60/90",
  quantidade_prazos: 3, nf_url: null, parcelas_recebimento: [], status,
});
const ITENS_AVI = (fx: Fx, status = "recebido") => [{
  id: null, aviamento_id: fx.aviId, variante_aviamento_id: null, quantidade_pedida: 100,
  quantidade_recebida: status === "recebido" ? 100 : null, cancelado: false,
}];
const OC_INS = (fx: Fx) => ({
  numero_pedido: "ITEST-S2-INS", responsavel_nome: null, empresa_id: fx.emp, representante_id: null, data_pedido: "2026-09-01",
  data_prevista_entrega: "2026-09-05", data_entrega: "2026-09-10", prazo_pagamento: "30/60", quantidade_prazos: 2, nf_url: null,
  nfs: [], parcelas_recebimento: [], status: "recebido",
});
const ITENS_INS = (fx: Fx) => [{
  id: null, etiqueta_id: fx.etqId, variante_etiqueta_id: fx.etqVar, quantidade_pedida: 100, quantidade_recebida: 100, preco: 2.5,
  cancelado: false,
}];
/** Parcela de OC (tecido) gerada pelo servidor, a 1ª não paga. */
async function parcelaDeOc(c: Client, fx: Fx): Promise<{ oc: string; parcela: string }> {
  const oc = await semJwt(c, async () => {
    await jwt(c, SUPER);
    const id = (await um<{ id: string }>(c, `select public.salvar_oc_tecido(null, $1::jsonb, $2::jsonb, null) as id`,
      [JSON.stringify(OC_TECIDO(fx)), JSON.stringify(ITENS_TECIDO(fx))])).id;
    return id;
  });
  const p = await um<{ id: string }>(c, `select id from parcelas where oc_tecido_id = $1 order by numero_parcela limit 1`, [oc]);
  if (!p) throw new Error("salvar_oc_tecido não gerou parcela");
  return { oc, parcela: p.id };
}
/** Bloco de serviço externo entregue + parcelas geradas por servicos_financeiro (a "tela"). */
async function parcelaDeServico(c: Client): Promise<{ pt: string; parcela: string }> {
  return semJwt(c, async () => {
    const m = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'ITEST-S2 servico') returning id`, [T])).id;
    const cad = (await um<{ id: string }>(c, `insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, m])).id;
    const cat = (await um<{ id: string }>(c,
      `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1, $2, 'ate_costura') returning id`, [T, `Bordado S2 ${m.slice(0, 8)}`])).id;
    const emp = (await um<{ id: string }>(c,
      `insert into empresas (tenant_id, nome_fantasia, tipo, prazo_pagamento) values ($1, 'Emp S2', 'servico', '30/60') returning id`, [T])).id;
    const pt = (await um<{ id: string }>(c,
      `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, empresa_id, ativo, interno,
                                           preco_metro_unidade, quantidade_enviada, numero_parcelas, data_enviado, data_entregue)
       values ($1, $2, $3, $4, true, false, 10, 10, 2, '2026-09-01', '2026-09-10') returning id`, [cad, T, cat, emp])).id;
    await jwt(c, SUPER);
    await c.query(`select public.servicos_financeiro()`);
    await jwt(c, null);
    const p = await um<{ id: string }>(c, `select id from parcelas_servico where producao_terceirizado_id = $1 order by numero_parcela limit 1`, [pt]);
    if (!p) throw new Error("servicos_financeiro não gerou parcela de serviço");
    return { pt, parcela: p.id };
  });
}

// ─────────────────────────────────────────── md5, idempotência, volta ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S2 — md5, ACL, idempotência e volta (LIFO)", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES (textos e ACL exatos); _down_drop apaga o gatilho; ida de novo = DEPOIS", async () => {
    await withTx(async (c) => {
      const confereIda = async () => {
        for (const [sig, m] of Object.entries(S2_MD5)) expect(await md5(c, sig), sig).toBe(m.depois);
        expect(await md5(c, S2_PERM.fn)).toBe(S2_PERM.depois);
        for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S2_ACL[t].depois);
        const trg = await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgrelid = 'public.parcelas'::regclass
                                                  and tgname = 'trg_parcela_permissao' and tgenabled = 'O'`);
        expect(trg.n).toBe(1);
      };
      await aplicaS2(c);
      await confereIda();
      await aplicaS2(c); // idempotente
      await confereIda();
      await voltaS2(c);
      for (const [sig, m] of Object.entries(S2_MD5)) expect(await md5(c, sig), sig).toBe(m.antes);
      expect(await md5(c, S2_PERM.fn)).toBe(S2_PERM.neutra); // o gatilho FICA, inerte
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S2_ACL[t].antes);
      await voltaS2(c); // o inverso também é idempotente
      await aplicarArquivo(c, S2_DOWN_DROP);
      expect((await um<{ f: string | null }>(c, `select to_regprocedure($1)::text f`, [S2_PERM.fn])).f).toBeNull();
      expect((await um<{ n: number }>(c, `select count(*)::int n from pg_trigger where tgname = 'trg_parcela_permissao'`)).n).toBe(0);
      await aplicarArquivo(c, S2_DOWN_DROP); // idempotente
      await aplicaS2(c); // ida de novo depois da volta completa
      await confereIda();
    });
  });

  it("_down_drop recusa enquanto a função ainda confere (sem o _down antes)", async () => {
    await withTx(async (c) => {
      await aplicaS2(c);
      await c.query("SAVEPOINT d");
      await expect(aplicarArquivo(c, S2_DOWN_DROP)).rejects.toThrow(/s2_finaba_down_drop: rode antes o _down/);
      await c.query("ROLLBACK TO SAVEPOINT d");
    });
  });
});

describe.skipIf(!RODA)("seg S2 — B1 (fix round 1): grants só sobre a ACL medida (antes ou depois)", () => {
  const IDA = "supabase/migrations/20261031200000_seg_s2_grants_dinheiro.sql";
  const VOLTA = "supabase/rollback/20261031200000_seg_s2_grants_dinheiro_down.sql";
  it("ACL diferente do antes/depois (a produção difere da cópia) → ida E volta recusam P0001 antes de mudar qualquer coisa", async () => {
    await withTx(async (c) => {
      await aplicaS2(c); // estado DEPOIS
      // 1) depois + um grant a mais (ex.: alguém deu INSERT ao anon) → nem ida nem volta mexem
      await c.query("GRANT INSERT ON public.ocs_etiqueta_itens TO anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s2_grants: ACL inesperada em ocs_etiqueta_itens/) });
      await expect(aplicarArquivo(c, VOLTA)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s2_grants_down: ACL inesperada em ocs_etiqueta_itens/) });
      for (const t of TABELAS.filter((x) => x !== "ocs_etiqueta_itens")) expect(await aclTabela(c, t), t).toEqual(S2_ACL[t].depois);
      await c.query("REVOKE INSERT ON public.ocs_etiqueta_itens FROM anon");
      expect(await aclTabela(c, "ocs_etiqueta_itens")).toEqual(S2_ACL.ocs_etiqueta_itens.depois);
      // 2) antes, mas com MENOS privilégio que a cópia (ex.: anon sem TRUNCATE em parcelas) → a ida recusa (a volta daria a mais)
      await voltaS2(c);
      await c.query("REVOKE TRUNCATE ON public.parcelas FROM anon");
      await expect(aplicarArquivo(c, IDA)).rejects.toMatchObject({
        code: "P0001", message: expect.stringMatching(/^s2_grants: ACL inesperada em parcelas \(relacl .*anon=arwdxtm/) });
      for (const t of TABELAS.filter((x) => x !== "parcelas")) expect(await aclTabela(c, t), t).toEqual(S2_ACL[t].antes);
      // 3) estados exatos seguem passando (ida e volta idempotentes)
      await c.query("GRANT TRUNCATE ON public.parcelas TO anon");
      await aplicarArquivo(c, IDA);
      await aplicarArquivo(c, IDA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S2_ACL[t].depois);
      await aplicarArquivo(c, VOLTA);
      await aplicarArquivo(c, VOLTA);
      for (const t of TABELAS) expect(await aclTabela(c, t), t).toEqual(S2_ACL[t].antes);
    });
  });
});

describe.skipIf(!RODA)("seg S2 — trava medida (pg_locks na txn revertida)", () => {
  it("grants: nenhuma tabela fora do pg_catalog acima de AccessShare; financeiro_aba: só ShareRowExclusive em parcelas", async () => {
    await withTx(async (c) => {
      const travas = async () => (await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode
           FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')
            AND l.mode <> 'AccessShareLock' ORDER BY 1, 2`)).rows
        // S3A_TXN=1: o CREATE TRIGGER da S3a (4 tabelas de OC) já pegou trava no começo da txn — não é da S2
        .filter((r) => !S3A_TABELAS_TRAVA.includes(r.rel) && !S3B_TABELAS_TRAVA.includes(r.rel)); // idem S3B_TXN=1 (cad, CQ, Oficina)
      await voltaS3aSePreciso(c); // LIFO: a S3a redefine recalcular_parcelas por cima da S2 (a 220000 recusaria)
      const jaTinha = await travas(); // S2_TXN=1 já aplicou no começo da txn
      // Com a S2 aplicada DE VERDADE na cópia (o controlador aplicou), o gatilho já existe: o CREATE TRIGGER é pulado
      // (IF NOT EXISTS) e a 210000 não pega trava nenhuma — a trava medida só existe quando a txn cria o gatilho.
      const gatilhoNaCopia = jaTinha.length === 0 && (await um<{ n: number }>(c,
        `select count(*)::int n from pg_trigger where tgrelid = 'public.parcelas'::regclass and tgname = 'trg_parcela_permissao'`)).n > 0;
      const esperado = gatilhoNaCopia ? [] : [{ rel: "public.parcelas", mode: "ShareRowExclusiveLock" }];
      if (jaTinha.length === 0) {
        await aplicarArquivo(c, "supabase/migrations/20261031200000_seg_s2_grants_dinheiro.sql");
        expect(await travas()).toEqual([]);
        await aplicarArquivo(c, "supabase/migrations/20261031210000_seg_s2_financeiro_aba.sql");
        expect(await travas()).toEqual(esperado);
        await aplicarArquivo(c, "supabase/migrations/20261031220000_seg_s2_gate_financeiro.sql");
      }
      expect(await travas()).toEqual(esperado);
      const auth = await c.query(
        `SELECT n.nspname || '.' || k.relname AS rel, l.mode FROM pg_locks l JOIN pg_class k ON k.oid = l.relation
           JOIN pg_namespace n ON n.oid = k.relnamespace
          WHERE l.pid = pg_backend_pid() AND n.nspname IN ('auth', 'storage', 'realtime') AND l.mode <> 'AccessShareLock'`);
      expect(auth.rows).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────── grants (fin #11, EST-1, AVI-1) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S2 — grants (anti-drift has_table_privilege/has_column_privilege)", () => {
  it("anon e authenticated sem INSERT/UPDATE/DELETE/TRUNCATE nas 5; SELECT fica; UPDATE só nas 4 colunas de parcela; service_role intacto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const t of TABELAS) {
        for (const papel of ["anon", "authenticated"]) {
          for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
            const r = await um<{ v: boolean }>(c, `select has_table_privilege($1, to_regclass('public.' || $2), $3) v`, [papel, t, p]);
            expect({ t, papel, p, v: r.v }).toEqual({ t, papel, p, v: false });
          }
        }
        expect((await um<{ v: boolean }>(c, `select has_table_privilege('authenticated', to_regclass('public.' || $1), 'SELECT') v`, [t])).v).toBe(true);
        expect((await um<{ v: boolean }>(c,
          `select has_table_privilege('service_role', to_regclass('public.' || $1), 'INSERT, UPDATE, DELETE, SELECT') v`, [t])).v).toBe(true);
      }
      for (const t of ["parcelas", "parcelas_servico"]) {
        const { rows } = await c.query(
          `select a.attname, has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') u
             from pg_attribute a where a.attrelid = to_regclass('public.' || $1) and a.attnum > 0 and not a.attisdropped order by 1`, [t]);
        const livres = rows.filter((r) => r.u).map((r) => r.attname).sort();
        expect({ t, livres }).toEqual({ t, livres: ["comprovante_url", "data_pagamento", "data_vencimento", "status"] });
        expect((await um<{ v: boolean }>(c, `select has_any_column_privilege('anon', to_regclass('public.' || $1), 'UPDATE') v`, [t])).v).toBe(false);
      }
      // fora do alcance da S2 (achado registrado): itens de OC de TECIDO seguem com escrita do cliente (o front grava o CQ direto)
      expect((await um<{ v: boolean }>(c, `select has_table_privilege('authenticated', 'public.ocs_tecido_itens', 'UPDATE') v`)).v).toBe(true);
    });
  });

  it("como authenticated: INSERT/DELETE de parcela, ledger e itens de OC de aviamento/insumo → 42501; UPDATE de coluna derivada → 42501", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { oc, parcela } = await parcelaDeOc(c, fx);
      const ps = await parcelaDeServico(c);
      const item = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [oc])).id;
      await jwt(c, SUPER); // até o super admin: grant é do PAPEL, não da pessoa
      const negado = /^42501 permission denied for (table|column)/;
      expect(txt(await como(c, "authenticated",
        `insert into parcelas (tenant_id, oc_tecido_id, tipo_oc, numero_parcela, valor, data_vencimento) values ($1, $2, 'tecido', 9, 1, '2026-12-01')`,
        [T, oc]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `delete from parcelas where id = $1`, [parcela]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `update parcelas set valor = 1 where id = $1`, [parcela]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `update parcelas set numero_parcela = 7 where id = $1`, [parcela]))).toMatch(negado);
      expect(txt(await como(c, "authenticated",
        `insert into parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento) values ($1, $2, 9, '2026-12-01')`,
        [T, ps.pt]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `delete from parcelas_servico where id = $1`, [ps.parcela]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `update parcelas_servico set valor_pago = 999 where id = $1`, [ps.parcela]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `update parcelas_servico set numero_parcela = 9 where id = $1`, [ps.parcela]))).toMatch(negado);
      expect(txt(await como(c, "authenticated",
        `insert into estoque_tecido_baixas (tenant_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem) values ($1, $2, $3, 5, 'ajuste')`,
        [T, item, fx.vari]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `delete from estoque_tecido_baixas where tenant_id = $1`, [T]))).toMatch(negado);
      expect(txt(await como(c, "authenticated", `update estoque_tecido_baixas set quantidade = 0 where tenant_id = $1`, [T]))).toMatch(negado);
      for (const t of ["ocs_aviamento_itens", "ocs_etiqueta_itens"]) {
        expect(txt(await como(c, "authenticated", `delete from ${t} where false`))).toMatch(negado);
        expect(txt(await como(c, "authenticated", `update ${t} set quantidade_pedida = 1 where false`))).toMatch(negado);
      }
      expect(txt(await como(c, "authenticated", `insert into ocs_aviamento_itens (oc_aviamento_id, aviamento_id, quantidade_pedida) values ($1, $2, 1)`,
        [oc, fx.aviId]))).toMatch(negado);
      expect(txt(await como(c, "anon", `update parcelas set status = 'pago' where false`))).toMatch(negado);
      // SELECT segue (Financeiro, Home, Estoque e embeds leem direto)
      expect(txt(await como(c, "authenticated", `select count(*) from parcelas where id = $1`, [parcela]))).toBe("PASSOU");
      expect(txt(await como(c, "authenticated", `select count(*) from estoque_tecido_baixas`))).toBe("PASSOU");
    });
  });
});

// ─────────────────────────────────────────── FIN-ABA (P-232 = D3 A) ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S2 — FIN-ABA: Financeiro por aba no servidor", () => {
  it("parcela de OC: sem a aba → 42501 financeiro_sem_permissao; editar OCs OU Calendário → ok; só VER → 42501; admin da loja → ok", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { parcela } = await parcelaDeOc(c, fx);
      const pagar = () => como(c, "authenticated",
        `update parcelas set status = 'pago', data_pagamento = '2026-09-20', comprovante_url = 'x/y.pdf' where id = $1`, [parcela]);
      const vencer = () => como(c, "authenticated", `update parcelas set data_vencimento = '2026-12-24' where id = $1`, [parcela]);
      const desfazer = () => como(c, "authenticated", `update parcelas set status = 'a_pagar', data_pagamento = null where id = $1`, [parcela]);
      const NEG = "42501 financeiro_sem_permissao: sem permissao para editar parcelas de OC (Financeiro, abas OCs ou Calendario)";

      await jwt(c, U_COMUM);
      expect(txt(await pagar())).toBe(NEG);
      expect(txt(await vencer())).toBe(NEG);
      await permissao(c, U_COMUM, "financeiro_parcelas", true, false); // só VER
      expect(txt(await vencer())).toBe(NEG);
      await permissao(c, U_COMUM, "financeiro_servicos", true, true); // a aba de Serviços não vale para OCs
      expect(txt(await vencer())).toBe(NEG);
      await permissao(c, U_COMUM, "financeiro_parcelas", true, true);
      expect(txt(await vencer())).toBe("PASSOU");
      expect((await um<{ m: boolean }>(c, `select vencimento_manual m from parcelas where id = $1`, [parcela])).m).toBe(true);
      expect(txt(await pagar())).toBe("PASSOU");
      expect(txt(await desfazer())).toBe("PASSOU");
      await semPermissoes(c, U_COMUM);
      await permissao(c, U_COMUM, "financeiro_calendario", true, true);
      expect(txt(await pagar())).toBe("PASSOU");
      expect(txt(await desfazer())).toBe("PASSOU");
      // "Voltar ao cálculo automático" (P-171) segue: a RPC confere a aba e grava com a GUC do sistema
      expect(txt(await como(c, "authenticated", `select public.parcela_voltar_vencimento_automatico($1)`, [parcela]))).toBe("PASSOU");
      expect(await guc(c, "app.parcelas_sistema")).toBe("");

      await jwt(c, U_ADMIN); // admin da loja passa sem exceção explícita
      expect(txt(await vencer())).toBe("PASSOU");
      await jwt(c, SUPER);
      expect(txt(await pagar())).toBe("PASSOU");
    });
  });

  it("parcela de OC: caminho do sistema — GUC app.parcelas_sistema e sem JWT passam; a GUC não fica ligada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { parcela } = await parcelaDeOc(c, fx);
      await jwt(c, U_COMUM);
      await c.query(`select set_config('app.parcelas_sistema', 'on', true)`);
      expect(txt(await como(c, "authenticated", `update parcelas set data_vencimento = '2026-12-20' where id = $1`, [parcela]))).toBe("PASSOU");
      await c.query(`select set_config('app.parcelas_sistema', '', true)`);
      await jwt(c, null); // migration/psql
      expect(txt(await como(c, null, `update parcelas set data_vencimento = '2026-12-21' where id = $1`, [parcela]))).toBe("PASSOU");
    });
  });

  it("parcela de serviço: sem financeiro_servicos → 42501; com ela → paga/vence/anexa; aba de OCs não vale; INSERT do servidor segue", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { pt, parcela } = await parcelaDeServico(c);
      const pagar = () => como(c, "authenticated",
        `update parcelas_servico set status = 'pago', data_pagamento = '2026-09-20' where id = $1`, [parcela]);
      const vencer = () => como(c, "authenticated", `update parcelas_servico set data_vencimento = '2026-12-24' where id = $1`, [parcela]);
      const NEG = "42501 financeiro_servicos_sem_permissao: sem permissao para editar parcelas de Servicos (Financeiro, aba Servicos)";

      await jwt(c, U_COMUM);
      expect(txt(await pagar())).toBe(NEG);
      await permissao(c, U_COMUM, "financeiro_parcelas", true, true);
      await permissao(c, U_COMUM, "financeiro_calendario", true, true);
      expect(txt(await vencer())).toBe(NEG);
      await permissao(c, U_COMUM, "financeiro_servicos", true, false);
      expect(txt(await vencer())).toBe(NEG);
      await permissao(c, U_COMUM, "financeiro_servicos", true, true);
      expect(txt(await vencer())).toBe("PASSOU");
      expect(txt(await pagar())).toBe("PASSOU");
      const pg = await um<{ vp: string | null; m: boolean }>(c, `select valor_pago::text vp, vencimento_manual m from parcelas_servico where id = $1`, [parcela]);
      expect(Number(pg.vp)).toBeGreaterThan(0); // o gatilho congela o valor pago (contas certas A2) — nada mudou nisso
      expect(pg.m).toBe(true);
      expect(txt(await como(c, "authenticated", `update parcelas_servico set comprovante_url = 'x/z.pdf' where id = $1`, [parcela]))).toBe("PASSOU");
      expect(txt(await como(c, "authenticated", `update parcelas_servico set status = 'a_pagar', data_pagamento = null where id = $1`, [parcela]))).toBe("PASSOU");

      // A "tela" (servicos_financeiro) abre para quem só vê o Calendário: o servidor gera/move parcelas sem a aba Serviços
      await semPermissoes(c, U_COMUM);
      await permissao(c, U_COMUM, "financeiro_calendario", true, false);
      await semJwt(c, () => c.query(`update producao_terceirizados set data_entregue = '2026-09-15', numero_parcelas = 3 where id = $1`, [pt]));
      await semJwt(c, () => c.query(`update empresas set prazo_pagamento = '30/60/90' where id = (select empresa_id from producao_terceirizados where id = $1)`, [pt]));
      await semJwt(c, async () => {
        await c.query(`select set_config('app.parcelas_servico_sistema', 'on', true)`);
        await c.query(`update parcelas_servico set vencimento_manual = false where producao_terceirizado_id = $1`, [pt]);
        await c.query(`select set_config('app.parcelas_servico_sistema', '', true)`);
      });
      await jwt(c, U_COMUM);
      const r = await como(c, "authenticated", `select jsonb_array_length(public.servicos_financeiro()) n`);
      expect(txt(r)).toBe("PASSOU");
      const { rows } = await c.query(
        `select numero_parcela n, to_char(data_vencimento, 'YYYY-MM-DD') v from parcelas_servico where producao_terceirizado_id = $1 order by 1`, [pt]);
      expect(rows).toEqual([{ n: 1, v: "2026-10-15" }, { n: 2, v: "2026-11-14" }, { n: 3, v: "2026-12-14" }]);
      expect(await guc(c, "app.parcelas_servico_sistema")).toBe("");
      // "Voltar ao automático" do serviço segue exigindo a aba (RPC própria, inalterada)
      expect(txt(await como(c, "authenticated", `select public.parcela_servico_voltar_vencimento_automatico($1)`, [parcela])))
        .toMatch(/^42501/);
    });
  });
});

// ─────────────────────────────────────────── C6 — módulo Financeiro nas RPCs ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S2 — C6: módulo Financeiro", () => {
  it("desligado: servicos_financeiro devolve [] sem gravar; recalcular_parcelas → 42501; alerta de tecido segue refazendo parcelas", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const { oc } = await parcelaDeOc(c, fx);
      const { pt } = await parcelaDeServico(c);
      await semJwt(c, () => c.query(`delete from parcelas_servico where producao_terceirizado_id = $1`, [pt]));
      await modulo(c, "financeiro", false);
      await jwt(c, U_COMUM);
      const r = await como(c, "authenticated", `select public.servicos_financeiro() j`);
      expect(r.ok && r.rows[0].j).toEqual([]);
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas_servico where producao_terceirizado_id = $1`, [pt])).n).toBe(0);
      expect(txt(await como(c, "authenticated", `select public.recalcular_parcelas($1, 'tecido')`, [oc])))
        .toBe("42501 modulo_financeiro_desligado: o modulo Financeiro nao esta habilitado para esta loja");
      // Entrada (loja só-estoque): resolver alerta de tecido não depende do Financeiro e refaz as parcelas pelo _core
      const item = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [oc])).id;
      await semJwt(c, () => c.query(`update ocs_tecido_itens set cq_alerta_status = 'alertado' where id = $1`, [item]));
      await semJwt(c, () => c.query(`delete from parcelas where oc_tecido_id = $1`, [oc]));
      expect(txt(await como(c, "authenticated", `select public.aplicar_resolucao_alerta_tecido($1, 'estilo_ok', null, null, null)`, [item])))
        .toBe("PASSOU");
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_tecido_id = $1`, [oc])).n).toBe(3);
      // ligado de novo: tudo como antes
      await modulo(c, "financeiro", true);
      expect(txt(await como(c, "authenticated", `select public.recalcular_parcelas($1, 'tecido')`, [oc]))).toBe("PASSOU");
      const r2 = await como(c, "authenticated", `select jsonb_array_length(public.servicos_financeiro()) n`);
      expect(r2.ok && r2.rows[0].n).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────── ponta a ponta como authenticated ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S2 — ponta a ponta como o PAPEL authenticated (usuário comum, sem permissão de página)", () => {
  it("tecido: receber → parcelas; cortar → baixas; reverter corte; '- Metragem' + reverter ajuste; CQ do item direto; desmarcar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      await jwt(c, U_COMUM);
      const oc = (await ok(c, `select public.salvar_oc_tecido(null, $1::jsonb, $2::jsonb, null) as id`,
        [JSON.stringify(OC_TECIDO(fx)), JSON.stringify(ITENS_TECIDO(fx))]))[0].id as string;
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_tecido_id = $1`, [oc])).n).toBe(3);
      const item = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [oc])).id;
      // card com CAD (fixture como postgres) → corte pela RPC como authenticated
      const cad = await semJwt(c, async () => {
        const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'ITEST-S2 card') returning id`, [T])).id;
        const cadId = (await um<{ id: string }>(c,
          `insert into cad (tenant_id, modelo_id, data_enviado_corte) values ($1, $2, '2026-09-15') returning id`, [T, mod])).id;
        const ct = (await um<{ id: string }>(c,
          `insert into cad_tecidos (cad_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id`, [cadId, fx.art])).id;
        await c.query(`insert into cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem, metragem_enviada) values ($1, $2, 1, 20)`,
          [ct, fx.vari]);
        return cadId;
      });
      await ok(c, `select public.baixar_estoque_tecido_corte($1, null)`, [cad]);
      const baixas = async (where: string, p: any[]) =>
        Number((await um<{ t: string }>(c, `select coalesce(sum(quantidade), 0)::text t from estoque_tecido_baixas where ${where}`, p)).t);
      expect(await baixas("cad_id = $1", [cad])).toBe(20);
      await ok(c, `select public.reverter_corte_tecido($1)`, [cad]);
      expect(await baixas("cad_id = $1", [cad])).toBe(0);
      const aj = (await ok(c, `select public.remover_metragem_oc($1, 5, 'ITEST S2') as id`, [item]))[0].id as string;
      expect(await baixas("id = $1 and origem = 'ajuste'", [aj])).toBe(5);
      await ok(c, `select public.reverter_ajuste_estoque($1)`, [aj]);
      expect(await baixas("id = $1", [aj])).toBe(0);
      // a tabela que FICOU de fora: o CQ de tecido do front segue gravando direto (cq_*), como hoje
      await ok(c, `update ocs_tecido_itens set cq_observacao = 'S2 ok', cq_ok = true where id = $1`, [item]);
      await ok(c, `select public.desmarcar_recebimento_oc('tecido', $1)`, [oc]);
      expect((await um<{ s: string }>(c, `select status s from ocs_tecido where id = $1`, [oc])).s).not.toBe("recebido");
    });
  });

  it("aviamento e insumo: receber → itens + parcelas; desmarcar; excluir OC encomendada direto (cascade dos itens); Nota da OC de insumo direto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      await jwt(c, U_COMUM);
      const avi = (await ok(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_AVI(fx)), JSON.stringify(ITENS_AVI(fx))]))[0].id as string;
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_aviamento_itens where oc_aviamento_id = $1`, [avi])).n).toBe(1);
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_aviamento_id = $1`, [avi])).n).toBe(3);
      await ok(c, `select public.desmarcar_recebimento_oc('aviamento', $1)`, [avi]);
      const enc = (await ok(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify({ ...OC_AVI(fx, "encomendado"), numero_pedido: "ITEST-S2-AVI-ENC" }), JSON.stringify(ITENS_AVI(fx, "encomendado"))]))[0].id as string;
      await ok(c, `delete from ocs_aviamento where id = $1`, [enc]); // a lista de OC de aviamento exclui assim (FK CASCADE como dono)
      expect((await um<{ n: number }>(c, `select count(*)::int n from ocs_aviamento_itens where oc_aviamento_id = $1`, [enc])).n).toBe(0);

      const ins = (await ok(c, `select public.salvar_oc_etiqueta(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_INS(fx)), JSON.stringify(ITENS_INS(fx))]))[0].id as string;
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_etiqueta_id = $1`, [ins])).n).toBe(2);
      // OC de insumo recebida grava a Nota direto (oc-insumo.tsx) → o gatilho do servidor refaz os vencimentos
      await ok(c, `update ocs_etiqueta set data_nota_entrada = '2026-09-12' where id = $1`, [ins]);
      const v = await um<{ d: string }>(c, `select to_char(min(data_vencimento), 'YYYY-MM-DD') d from parcelas where oc_etiqueta_id = $1`, [ins]);
      expect(v.d).toBe("2026-10-12");
      await ok(c, `select public.desmarcar_recebimento_oc_etiqueta($1)`, [ins]);
    });
  });

  it("B5 (fix round 1): EDITAR OC de aviamento e de insumo já salvas (alterar 1 item, incluir 1, remover 1) — diff incremental, ids preservados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      await jwt(c, U_COMUM);
      type It = { id: string; q: number };
      const itens = async (tab: string, fk: string, oc: string, col: string) =>
        (await c.query(`select id, ${col} c, quantidade_pedida::int q from ${tab} where ${fk} = $1 order by quantidade_pedida`, [oc])).rows as
          (It & { c: string })[];
      // ── aviamento: OC recebida com 2 itens (A 100, B 50) → edita: A 120, remove B, inclui A2 30
      const linhaAvi = (aviamento_id: string, q: number, id: string | null = null) => ({
        id, aviamento_id, variante_aviamento_id: null, quantidade_pedida: q, quantidade_recebida: q, cancelado: false,
      });
      const avi = (await ok(c, `select public.salvar_oc_aviamento(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_AVI(fx)), JSON.stringify([linhaAvi(fx.aviId, 100), linhaAvi(fx.aviId2, 50)])]))[0].id as string;
      const antes = await itens("ocs_aviamento_itens", "oc_aviamento_id", avi, "aviamento_id");
      expect(antes.map((i) => [i.c, i.q])).toEqual([[fx.aviId2, 50], [fx.aviId, 100]]);
      const a = antes.find((i) => i.c === fx.aviId)!;
      await ok(c, `select public.salvar_oc_aviamento($1, $2::jsonb, $3::jsonb, null::int)`,
        [avi, JSON.stringify(OC_AVI(fx)), JSON.stringify([linhaAvi(fx.aviId, 120, a.id), linhaAvi(fx.aviId2, 30)])]);
      const depois = await itens("ocs_aviamento_itens", "oc_aviamento_id", avi, "aviamento_id");
      expect(depois.map((i) => [i.c, i.q])).toEqual([[fx.aviId2, 30], [fx.aviId, 120]]);
      expect(depois.find((i) => i.q === 120)!.id).toBe(a.id); // id do item alterado preservado (invariante 3)
      expect(depois.some((i) => antes.some((x) => x.id === i.id && x.q === 50))).toBe(false); // B removido
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_aviamento_id = $1`, [avi])).n).toBe(3);
      // ── insumo: OC recebida com 2 itens (E1 100, E2 50) → edita: E1 120, remove E2, inclui E2 30
      const linhaIns = (etiqueta_id: string, variante_etiqueta_id: string | null, q: number, id: string | null = null) => ({
        id, etiqueta_id, variante_etiqueta_id, quantidade_pedida: q, quantidade_recebida: q, preco: 2.5, cancelado: false,
      });
      const ins = (await ok(c, `select public.salvar_oc_etiqueta(null, $1::jsonb, $2::jsonb, null::int) as id`,
        [JSON.stringify(OC_INS(fx)), JSON.stringify([linhaIns(fx.etqId, fx.etqVar, 100), linhaIns(fx.etqId2, fx.etqVar2, 50)])]))[0].id as string;
      const antesI = await itens("ocs_etiqueta_itens", "oc_etiqueta_id", ins, "etiqueta_id");
      const e1 = antesI.find((i) => i.c === fx.etqId)!;
      await ok(c, `select public.salvar_oc_etiqueta($1, $2::jsonb, $3::jsonb, null::int)`,
        [ins, JSON.stringify(OC_INS(fx)), JSON.stringify([linhaIns(fx.etqId, fx.etqVar, 120, e1.id), linhaIns(fx.etqId2, fx.etqVar2, 30)])]);
      const depoisI = await itens("ocs_etiqueta_itens", "oc_etiqueta_id", ins, "etiqueta_id");
      expect(depoisI.map((i) => [i.c, i.q])).toEqual([[fx.etqId2, 30], [fx.etqId, 120]]);
      expect(depoisI.find((i) => i.q === 120)!.id).toBe(e1.id);
      expect(depoisI.some((i) => antesI.some((x) => x.id === i.id && x.q === 50))).toBe(false);
      // total refeito pelo servidor: Σ parcelas = (120 + 30) × 2,50
      const tot = await um<{ t: string }>(c, `select coalesce(sum(valor), 0)::numeric(12,2)::text t from parcelas where oc_etiqueta_id = $1`, [ins]);
      expect(Number(tot.t)).toBeCloseTo(375, 2);
    });
  });

  it("produto acabado e importado: produto → card → OC → receber (cad/CQ/parcelas) pelas RPCs", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const fx = await fixtures(c);
      const cat = await semJwt(c, async () => {
        const g = (await um<{ id: string }>(c, `insert into grupos_produto (tenant_id, nome) values ($1, 'Fem S2Test') returning id`, [T])).id;
        const k = (await um<{ id: string }>(c, `insert into categorias_produto (tenant_id, nome) values ($1, 'Vestido S2Test') returning id`, [T])).id;
        return { grupo_id: g, categoria_id: k };
      });
      await jwt(c, U_COMUM);
      // Produto Acabado (revenda)
      const pa = (await ok(c, `select public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify({ nome: "Vestido S2Test", ...cat, qtd_total: 20, grade_proporcao: { P: 1, M: 1 } }),
        JSON.stringify([{ ordem: 0, peso: 1, qtd: 20 }]),
      ]))[0].id as string;
      await ok(c, `select public.criar_card_produto_acabado($1) as id`, [pa]);
      const ocPa = (await ok(c, `select public.salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify({ nome_produto: "OC S2Test", produto_acabado_id: pa, empresa_id: fx.emp, data_pedido: "2026-09-01",
          prazo_pagamento: "30/60", qtd_total: 20, valor_unitario: 100, desconto_pct: 0 }),
        JSON.stringify({ "0": { P: { pedida: 10 }, M: { pedida: 10 } } }),
      ]))[0].id as string;
      const rec = (await ok(c, `select public.receber_oc_p_acabado($1, $2::jsonb, $3::jsonb) as v`, [
        ocPa, JSON.stringify({ data_entrega: "2026-09-10", nota_fiscal: "NF-S2" }),
        JSON.stringify({ "0": { P: { pedida: 10, recebida: 10, defeito: 0 }, M: { pedida: 10, recebida: 9, defeito: 1 } } }),
      ]))[0].v;
      expect(Number(rec.total_real)).toBe(18);
      expect((await um<{ s: string }>(c, `select status s from ocs_p_acabado where id = $1`, [ocPa])).s).toBe("recebido");
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_p_acabado_id = $1`, [ocPa])).n).toBe(2);

      // Produto Importado
      const pi = (await ok(c, `select public.salvar_produto_importado(null, $1::jsonb, $2::jsonb, $3::jsonb) as id`, [
        JSON.stringify({ nome: "Blusa S2Test", ...cat, valor_unitario_m1: 50, cotacao_ref: 5, cotacao_final: 5, peso_kg: 0,
          transporte_m2: 0, desconto_pct: 0, markup_atacado: 2, markup_varejo: 3 }),
        JSON.stringify([{ ordem: 1, peso: 1, qtd: 10 }]),
        JSON.stringify([{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }]),
      ]))[0].id as string;
      await ok(c, `select public.criar_card_produto_importado($1) as id`, [pi]);
      const ocPi = (await ok(c, `select public.salvar_oc_importado(null, $1::jsonb, $2::jsonb, $3::jsonb) as id`, [
        JSON.stringify({ nome_produto: "OC Blusa S2Test", produto_importado_id: pi, ...cat, qtd_total: 10, valor_unitario_m1: 50, cotacao_ref: 5,
          cotacao_final: 5, empresa_id: fx.emp, data_pedido: "2026-09-01" }),
        JSON.stringify({ "1": { P: { pedida: 10 } } }),
        JSON.stringify([{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: "2026-10-20", cotacao: 5 }]),
      ]))[0].id as string;
      expect((await um<{ n: number }>(c, `select count(*)::int n from parcelas where oc_importado_id = $1`, [ocPi])).n).toBeGreaterThan(0);
      await ok(c, `select public.receber_oc_importado($1, $2::jsonb, $3::jsonb) as v`, [
        ocPi, JSON.stringify({ data_entrega: "2026-09-10" }), JSON.stringify({ "1": { P: { pedida: 10, recebida: 10, defeito: 0 } } }),
      ]);
      expect((await um<{ s: string }>(c, `select status s from ocs_importado where id = $1`, [ocPi])).s).toBe("recebido");
    });
  });
});
