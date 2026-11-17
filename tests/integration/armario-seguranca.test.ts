/**
 * F7 Armario - Task C4 (banco): ANTI-DRIFT de seguranca das RPCs da frente (A1 + A2 + C1 + C2 + C3 aplicadas DENTRO da txn, so na copia local).
 * Cobre TODAS as RPCs de ESCRITA (armario_salvar + os 6 do CRUD) e a de LEITURA (armario_variantes_disponiveis):
 *  - cada `_core`: SEM EXECUTE para anon e authenticated (e nenhum grant PUBLIC) - so o wrapper alcanca;
 *  - cada WRAPPER de escrita: DEFINER + search_path=public, anon sem EXECUTE, authenticated/service_role com; o corpo chama
 *    `_seg_exige_pagina('criacao_armario')`; usuario comum SEM a pagina = 42501 `sem_permissao_pagina` (e so VER nao basta);
 *  - a LEITURA NAO exige a pagina (segue loja/RLS): usuario sem a pagina consegue chamar;
 *  - VARREDURA do catalogo: toda funcao `armario*`/`_armario*` do schema public tem que estar nas listas abaixo - uma RPC nova sem
 *    classificar (sem teste de seguranca) derruba este teste (anti-drift).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semJwt, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const U_COMUM = "f7c40000-0000-4000-8000-0000000000c1";
const UID = "44444444-4444-4444-8444-444444444444";

async function aplica(c: Client): Promise<void> {
  // ANO/MES (20261204100000) troca as assinaturas de criar/salvar/variantes e re-emite duplicar/reordenar; vai POR CIMA do deploy do Armario.
  for (const f of ["20261202100000_armario_tabelas", "20261202110000_armario_trava_publicado", "20261202120000_armario_variantes_disponiveis", "20261202130000_armario_salvar", "20261202140000_armario_crud", "20261203100000_armario_variantes_filtros", "20261204100000_armario_ano_mes"]) {
    await aplicarArquivo(c, `supabase/migrations/${f}.sql`);
  }
}

/** [nome, assinatura (so tipos), chamada SQL com args "inocuos" (o portao de pagina barra antes de qualquer leitura/escrita)] */
const ESCRITA: { nome: string; args: string; call: string }[] = [
  { nome: "armario_salvar", args: "uuid,uuid,uuid,text,integer,text,jsonb", call: `public.armario_salvar(NULL, NULL, NULL, 'n', 5, NULL, '[]'::jsonb)` },
  { nome: "armario_criar", args: "uuid,uuid,text", call: `public.armario_criar(NULL, NULL, 'n')` },
  { nome: "armario_renomear", args: "uuid,text", call: `public.armario_renomear('${UID}', 'n')` },
  { nome: "armario_excluir", args: "uuid", call: `public.armario_excluir('${UID}')` },
  { nome: "armario_duplicar", args: "uuid,text", call: `public.armario_duplicar('${UID}', 'n')` },
  { nome: "armario_reordenar", args: "jsonb", call: `public.armario_reordenar('[]'::jsonb)` },
  { nome: "armario_status", args: "uuid,text", call: `public.armario_status('${UID}', 'pronto')` },
];
const LEITURA = { nome: "armario_variantes_disponiveis", args: "uuid", call: `public.armario_variantes_disponiveis(NULL)` };
const wrap = (r: { nome: string; args: string }) => `public.${r.nome}(${r.args})`;
const core = (r: { nome: string; args: string }) => `public._${r.nome}_core(${r.args})`;

async function usuarioComum(c: Client): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'F7 comum C4', 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [U_COMUM, T, `${U_COMUM}@teste`],
  );
}
async function perm(c: Client, pagina: string | null, editar = true): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
    if (pagina) await c.query(`INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)`, [U_COMUM, T, pagina, editar]);
  });
}
/** Chama como `authenticated` (PostgREST real); devolve null se passou ou "<code> <msg>". Sempre volta ao savepoint. */
async function chama(c: Client, call: string): Promise<string | null> {
  await c.query("SAVEPOINT seg_c4");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(`SELECT ${call}`);
    return null;
  } catch (e: any) {
    return `${e.code} ${e.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT seg_c4");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT seg_c4");
  }
}

describe.skipIf(!RODA)("Armario C4 - anti-drift de seguranca das RPCs", () => {
  it("cada _core de escrita: SEM EXECUTE para anon e authenticated (nem PUBLIC); chamar o _core direto como authenticated = 42501", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const priv = async (fn: string, role: string) => (await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [role, fn])).p;
      for (const r of ESCRITA) {
        const f = core(r);
        expect(await priv(f, "anon"), `${f} anon`).toBe(false);
        expect(await priv(f, "authenticated"), `${f} authenticated`).toBe(false);
        const publico = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure AND a.grantee = 0`, [f]);
        expect(Number(publico.n), `${f} PUBLIC`).toBe(0);
        const p = await um<any>(c, `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [f]);
        expect(p.prosecdef, `${f} definer`).toBe(true);
        expect(p.proconfig, `${f} search_path`).toEqual(["search_path=public"]);
      }
      // de verdade, pelo papel: _core direto = permission denied
      await comoUsuario(c);
      const nulos: Record<string, string> = {
        armario_salvar: "NULL, NULL, NULL, 'n', 5, NULL, '[]'::jsonb", armario_criar: "NULL, NULL, 'n'", armario_renomear: `'${UID}', 'n'`,
        armario_excluir: `'${UID}'`, armario_duplicar: `'${UID}', 'n'`, armario_reordenar: "'[]'::jsonb", armario_status: `'${UID}', 'pronto'`,
      };
      for (const r of ESCRITA) {
        const msg = await chama(c, `public._${r.nome}_core(${nulos[r.nome]})`);
        expect(msg, `_${r.nome}_core direto`).toMatch(/^42501 permission denied/);
      }
    });
  });

  it("cada WRAPPER de escrita: DEFINER+search_path, anon sem EXECUTE, authenticated/service_role com, e o corpo chama _seg_exige_pagina('criacao_armario') + login + modulo", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const priv = async (fn: string, role: string) => (await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [role, fn])).p;
      for (const r of ESCRITA) {
        const f = wrap(r);
        expect(await priv(f, "anon"), `${f} anon`).toBe(false);
        expect(await priv(f, "authenticated"), `${f} authenticated`).toBe(true);
        expect(await priv(f, "service_role"), `${f} service_role`).toBe(true);
        const p = await um<any>(
          c,
          `SELECT prosecdef, proconfig, prosrc, (SELECT count(*) FROM aclexplode(proacl) a WHERE a.grantee = 0) AS publico FROM pg_proc WHERE oid = $1::regprocedure`,
          [f],
        );
        expect(p.prosecdef, `${f} definer`).toBe(true);
        expect(p.proconfig, `${f} search_path`).toEqual(["search_path=public"]);
        expect(Number(p.publico), `${f} PUBLIC`).toBe(0);
        expect(p.prosrc, `${f} auth.uid`).toMatch(/auth\.uid\(\)\s+IS\s+NULL/i);
        expect(p.prosrc, `${f} modulo`).toMatch(/tenant_module_enabled\('criacao'\)/);
        expect(p.prosrc, `${f} pagina`).toMatch(/_seg_exige_pagina\('criacao_armario'\)/);
        expect(p.prosrc, `${f} chama o _core`).toContain(`_${r.nome}_core(`);
      }
    });
  });

  it("cada RPC de escrita: usuario comum SEM a pagina criacao_armario (ou so VER, ou outra pagina) = 42501 sem_permissao_pagina; COM a pagina o portao abre", async () => {
    await withTx(async (c) => {
      await aplica(c);
      await usuarioComum(c);
      await comoUsuario(c, U_COMUM);
      const SEM = "42501 sem_permissao_pagina: criacao_armario";
      for (const [rotulo, pagina, editar] of [["sem permissao nenhuma", null, true], ["so VER a pagina", "criacao_armario", false], ["outra pagina", "criacao_planejamento", true]] as const) {
        await perm(c, pagina, editar);
        for (const r of ESCRITA) expect(await chama(c, r.call), `${r.nome} (${rotulo})`).toBe(SEM);
      }
      // com a pagina (EDITAR) o portao abre: o erro, se houver, ja e do _core (nunca 42501 de pagina)
      await perm(c, "criacao_armario", true);
      for (const r of ESCRITA) expect(await chama(c, r.call), `${r.nome} (com a pagina)`).not.toBe(SEM);
    });
  });

  it("a RPC de LEITURA armario_variantes_disponiveis NAO exige a pagina: usuario sem permissao nenhuma consegue chamar; anon nao; sem login = 42501", async () => {
    await withTx(async (c) => {
      await aplica(c);
      await usuarioComum(c);
      const f = wrap(LEITURA);
      const priv = async (role: string) => (await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [role, f])).p;
      expect(await priv("anon")).toBe(false);
      expect(await priv("authenticated")).toBe(true);
      expect(await priv("service_role")).toBe(true);
      const src = (await um<{ prosrc: string }>(c, `SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [f])).prosrc;
      expect(src).not.toMatch(/_seg_exige_pagina/);
      await comoUsuario(c, U_COMUM);
      await perm(c, null);
      expect(await chama(c, LEITURA.call)).toBeNull();
      await perm(c, "criacao_planejamento", false);
      expect(await chama(c, LEITURA.call)).toBeNull();
      await semJwt(c, () => c.query(`SELECT 1`));
      await c.query("SELECT set_config('request.jwt.claims', '', true)");
      expect(await chama(c, LEITURA.call)).toBe("42501 armario_nao_autenticado");
    });
  });

  it("VARREDURA do catalogo: toda funcao armario*/_armario* do schema public esta classificada aqui (RPC nova sem teste de seguranca derruba)", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const reais = (await c.query(`SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname ~ '^_?armario'`)).rows.map((r: any) => r.n as string);
      const esperadas = [...ESCRITA.flatMap((r) => [r.nome, `_${r.nome}_core`]), LEITURA.nome].sort();
      expect([...reais].sort()).toEqual(esperadas);
      // e nenhuma delas e executavel por anon
      for (const n of reais) {
        const anon = await um<{ p: boolean }>(c, `SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS p FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = $1`, [n]);
        expect(anon.p, `${n} anon`).toBe(false);
      }
      // todo wrapper de escrita (corpo) leva o portao de pagina; todo _core tem o get_user_tenant_id() (anti-cross-tenant)
      const corpos = (await c.query(`SELECT p.proname AS n, p.prosrc AS s FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname ~ '^_?armario_' AND p.proname !~ 'variantes|trava'`)).rows;
      for (const { n, s } of corpos as { n: string; s: string }[]) {
        if (n.startsWith("_")) expect(s, `${n} tenant`).toMatch(/get_user_tenant_id\(\)/);
        else expect(s, `${n} pagina`).toMatch(/_seg_exige_pagina\('criacao_armario'\)/);
      }
    });
  });
});
