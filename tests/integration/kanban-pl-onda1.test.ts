/**
 * Kanban PL configurável — Onda 1 (SÓ BANCO + libs puras; nada muda na tela, `etapas_pl_automatico`
 * default false). UMA migration `supabase/migrations/20261126100000_kanban_pl_onda1.sql` com 3 blocos:
 *   A) estado persistido: `modelos.status_etapa_pl` + tabela `modelo_etapa_pl_historico` (RLS SELECT por tenant);
 *   B) 4 configs por loja em `tenant_config` + `salvar_config_loja` (lista branca + validação + UPDATE estático);
 *   D) seed idempotente `_kanban_pl_seed_etapas(tenant)` → `etapas_pl_kanban` com os LABELS da loja.
 *
 * Tudo em BEGIN…ROLLBACK (`withTx`) e SÓ na cópia local (`ehBancoLocal`): a migration é aplicada no banco
 * ANTES da suíte (pelo gate `psql -f`), e cada teste roda contra o estado vivo numa txn revertida. Os que
 * escrevem (gravar config, seed) são desfeitos no ROLLBACK. NUNCA `\i` migration em txn de teste (incidente
 * 15/set); DDL só na cópia local (incidente 23/set).
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, ehBancoLocal, TENANT_TESTE, USER_TESTE } from "./db";

const T = TENANT_TESTE;
const SIG = "public.salvar_config_loja(uuid,jsonb,jsonb,boolean)";
const CHAMA = "SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, $4::boolean) AS r";

/** admin da loja (tenant_admin, não super) — criado DENTRO da txn, igual ao config-loja-salvar.test.ts. */
const U_ADMIN = "d0f1d0f1-0000-4000-8000-00000000d0a2";
async function comoAdminLoja(c: Client): Promise<void> {
  await comoUsuario(c); // super admin dono, fixa TENANT_TESTE
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_ADMIN, `${U_ADMIN}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [U_ADMIN, T, `${U_ADMIN}@teste`, "Teste kpl admin"],
  );
  await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [U_ADMIN]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_ADMIN, role: "authenticated" })]);
}

/** Roda a query num SAVEPOINT; devolve o erro (ou null) e deixa a txn usável. */
async function tenta(c: Client, sql: string, params: any[] = []): Promise<{ erro: { code?: string; message: string } | null; rows: any[] }> {
  await c.query("SAVEPOINT t_kpl");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT t_kpl");
    return { erro: null, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT t_kpl");
    return { erro: { code: e.code, message: e.message }, rows: [] };
  }
}

// ───────────────────────── bloco A — estado persistido ─────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 1 — estado (bloco A)", () => {
  it("modelos.status_etapa_pl existe (text, nullable)", async () => {
    await withTx(async (c) => {
      const r = (
        await c.query(
          `select data_type, is_nullable from information_schema.columns
            where table_name='modelos' and column_name='status_etapa_pl'`,
        )
      ).rows;
      expect(r[0]?.data_type).toBe("text");
      expect(r[0]?.is_nullable).toBe("YES");
    });
  });

  it("modelo_etapa_pl_historico existe com RLS ligada, FK ON DELETE CASCADE e índices", async () => {
    await withTx(async (c) => {
      const n = (await um<{ n: number }>(c, `select count(*)::int n from information_schema.tables where table_name='modelo_etapa_pl_historico'`)).n;
      expect(n).toBe(1);
      const rls = (await um<{ r: boolean }>(c, `select relrowsecurity r from pg_class where relname='modelo_etapa_pl_historico'`)).r;
      expect(rls).toBe(true);
      // colunas exigidas pelo contrato
      const cols = (
        await c.query(
          `select column_name, data_type, is_nullable from information_schema.columns
            where table_name='modelo_etapa_pl_historico' order by ordinal_position`,
        )
      ).rows.map((x) => x.column_name);
      for (const col of ["id", "tenant_id", "modelo_id", "status", "entrou_at", "created_at", "origem", "lote_id"]) {
        expect(cols, col).toContain(col);
      }
      // FK p/ modelos ON DELETE CASCADE
      const fk = (
        await c.query(
          `select rc.delete_rule
             from information_schema.referential_constraints rc
             join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
            where tc.table_name = 'modelo_etapa_pl_historico'`,
        )
      ).rows;
      expect(fk.some((x) => x.delete_rule === "CASCADE")).toBe(true);
      // índices por modelo e por tenant
      const idx = (await c.query(`select indexname from pg_indexes where tablename='modelo_etapa_pl_historico'`)).rows.map((x) => x.indexname);
      expect(idx).toContain("idx_mepl_modelo");
      expect(idx).toContain("idx_mepl_tenant");
      // política de SELECT por tenant (sem policy de INSERT para o cliente — escrita só por DEFINER)
      const pol = (await c.query(`select polname, polcmd from pg_policy where polrelid='public.modelo_etapa_pl_historico'::regclass`)).rows;
      expect(pol.some((p) => p.polcmd === "r")).toBe(true); // 'r' = SELECT
    });
  });
});

// ───────────────────────── bloco B — configs por loja + salvar_config_loja ─────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 1 — configs (bloco B)", () => {
  it("as 4 colunas existem em tenant_config com os defaults certos", async () => {
    await withTx(async (c) => {
      const r = Object.fromEntries(
        (
          await c.query(
            `select column_name, data_type, is_nullable, column_default from information_schema.columns
              where table_name='tenant_config'
                and column_name in ('etapas_pl_kanban','etapas_pl_requisitos','etapas_pl_automatico','etapas_pl_aba_peca_teste_status')`,
          )
        ).rows.map((x) => [x.column_name, x]),
      );
      expect(r.etapas_pl_kanban?.data_type).toBe("jsonb");
      expect(r.etapas_pl_kanban?.is_nullable).toBe("NO");
      expect(r.etapas_pl_requisitos?.data_type).toBe("jsonb");
      expect(r.etapas_pl_requisitos?.is_nullable).toBe("NO");
      expect(r.etapas_pl_automatico?.data_type).toBe("boolean");
      expect(r.etapas_pl_automatico?.is_nullable).toBe("NO");
      expect(r.etapas_pl_aba_peca_teste_status?.data_type).toBe("text");
      expect(r.etapas_pl_aba_peca_teste_status?.is_nullable).toBe("YES");
    });
  });

  it("grava etapas_pl_kanban/_requisitos/_automatico/_aba via salvar_config_loja", async () => {
    await withTx(async (c) => {
      await comoAdminLoja(c);
      const atual = (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id=$1", [T])).j;
      const mud = {
        etapas_pl_kanban: ["Peça Teste", "Separação de Materiais"],
        etapas_pl_requisitos: { separacao: ["peca_teste_aprovada"] },
        etapas_pl_automatico: true,
        etapas_pl_aba_peca_teste_status: "peca_teste",
      };
      const base = {
        etapas_pl_kanban: atual.etapas_pl_kanban ?? null,
        etapas_pl_requisitos: atual.etapas_pl_requisitos ?? null,
        etapas_pl_automatico: atual.etapas_pl_automatico ?? null,
        etapas_pl_aba_peca_teste_status: atual.etapas_pl_aba_peca_teste_status ?? null,
      };
      const { erro } = await tenta(c, CHAMA, [T, JSON.stringify(mud), JSON.stringify(base), null]);
      expect(erro).toBeNull();
      const r = (
        await c.query(
          `select etapas_pl_kanban, etapas_pl_requisitos, etapas_pl_automatico, etapas_pl_aba_peca_teste_status
             from tenant_config where tenant_id=$1`,
          [T],
        )
      ).rows;
      expect(r[0].etapas_pl_kanban).toEqual(["Peça Teste", "Separação de Materiais"]);
      expect(r[0].etapas_pl_requisitos).toEqual({ separacao: ["peca_teste_aprovada"] });
      // T8 (Onda 2): a chave so muda pela RPC etapas_pl_definir_automatico; via salvar_config_loja a mudanca e IGNORADA (sem erro).
      expect(r[0].etapas_pl_automatico).toBe(atual.etapas_pl_automatico);
      expect(r[0].etapas_pl_aba_peca_teste_status).toBe("peca_teste");
    });
  });

  it("recusa etapas_pl_kanban não-array (P0001) e etapas_pl_requisitos não-objeto (P0001); nada grava", async () => {
    await withTx(async (c) => {
      await comoAdminLoja(c);
      const antes = (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id=$1", [T])).j;
      const k = await tenta(c, CHAMA, [T, '{"etapas_pl_kanban":"x"}', '{"etapas_pl_kanban":[]}', null]);
      expect(k.erro?.code).toBe("P0001");
      expect(k.erro?.message).toMatch(/Formato inv|etapas_pl_kanban/);
      const rq = await tenta(c, CHAMA, [T, '{"etapas_pl_requisitos":[]}', '{"etapas_pl_requisitos":{}}', null]);
      expect(rq.erro?.code).toBe("P0001");
      const au = await tenta(c, CHAMA, [T, '{"etapas_pl_automatico":"x"}', '{"etapas_pl_automatico":false}', null]);
      expect(au.erro?.code).toBe("P0001");
      const depois = (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id=$1", [T])).j;
      expect(depois.etapas_pl_kanban).toEqual(antes.etapas_pl_kanban);
      expect(depois.etapas_pl_automatico).toEqual(antes.etapas_pl_automatico);
    });
  });

  it("etapas_pl_aba_peca_teste_status aceita null (texto nullable)", async () => {
    await withTx(async (c) => {
      await comoAdminLoja(c);
      const atual = (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id=$1", [T])).j;
      const { erro } = await tenta(c, CHAMA, [
        T,
        '{"etapas_pl_aba_peca_teste_status":null}',
        JSON.stringify({ etapas_pl_aba_peca_teste_status: atual.etapas_pl_aba_peca_teste_status ?? null }),
        null,
      ]);
      expect(erro).toBeNull();
      const v = (await um<{ x: string | null }>(c, "select etapas_pl_aba_peca_teste_status x from tenant_config where tenant_id=$1", [T])).x;
      expect(v).toBeNull();
    });
  });
});

// ───────────────────────── bloco D — seed das 5 etapas ─────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 1 — seed (bloco D)", () => {
  it("loja com pcp_etapas customizado: etapas_pl_kanban nasce com os labels na ordem", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // dono (sem JWT importa pouco: o helper é DEFINER e recebe o tenant por parâmetro)
      await c.query(
        `update tenant_config set pcp_etapas='[{"key":"peca_teste","label":"Prova","ativa":true},{"key":"oficina","label":"Costura","ativa":true}]'::jsonb,
                                  etapas_pl_kanban='[]'::jsonb where tenant_id=$1`,
        [T],
      );
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = (await um<{ e: any }>(c, `select etapas_pl_kanban e from tenant_config where tenant_id=$1`, [T])).e;
      expect(r).toEqual(["Prova", "Costura"]);
    });
  });

  it("seed IGNORA etapa com ativa=false (só as ativas viram coluna)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set pcp_etapas='[{"key":"peca_teste","label":"Prova","ativa":true},{"key":"separacao","label":"Sep","ativa":false},{"key":"oficina","label":"Costura","ativa":true}]'::jsonb,
                                  etapas_pl_kanban='[]'::jsonb where tenant_id=$1`,
        [T],
      );
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = (await um<{ e: any }>(c, `select etapas_pl_kanban e from tenant_config where tenant_id=$1`, [T])).e;
      expect(r).toEqual(["Prova", "Costura"]); // "Sep" (ativa:false) ficou de fora
    });
  });

  it("loja sem pcp_etapas: etapas_pl_kanban nasce com os 5 labels default", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set pcp_etapas=null, etapas_pl_kanban='[]'::jsonb where tenant_id=$1`, [T]);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = (await um<{ e: any }>(c, `select etapas_pl_kanban e from tenant_config where tenant_id=$1`, [T])).e;
      expect(r).toEqual(["Peça Teste", "Separação de Materiais", "Retorno de Grade de Corte", "Oficina", "Finalização"]);
    });
  });

  it("loja com etapas_pl_kanban já preenchido: seed NÃO sobrescreve (idempotente)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_kanban='["X"]'::jsonb where tenant_id=$1`, [T]);
      await c.query(`select public._kanban_pl_seed_etapas($1)`, [T]);
      const r = (await um<{ e: any }>(c, `select etapas_pl_kanban e from tenant_config where tenant_id=$1`, [T])).e;
      expect(r).toEqual(["X"]);
    });
  });

  it("_kanban_pl_seed_etapas tem EXECUTE revogado dos 3 (PUBLIC/anon/authenticated)", async () => {
    await withTx(async (c) => {
      const r = await um<{ pub: boolean; anon: boolean; auth: boolean }>(
        c,
        `select has_function_privilege('public','public._kanban_pl_seed_etapas(uuid)','EXECUTE') pub,
                has_function_privilege('anon','public._kanban_pl_seed_etapas(uuid)','EXECUTE') anon,
                has_function_privilege('authenticated','public._kanban_pl_seed_etapas(uuid)','EXECUTE') auth`,
      );
      expect(r).toEqual({ pub: false, anon: false, auth: false });
    });
  });
});
