/**
 * Integração + API — DELTA 7 (P-107 A, 28/set): a Integração só com a permissão por USUÁRIO dada pelo SUPER ADMIN.
 * Plano: .superpowers/sdd/2026-09-26-tela-integracao-api/delta7-plan.md "D7-banco". Migration
 * supabase/migrations/20261008100000_integracao_7_permissao_super.sql (+ inverso em supabase/rollback/).
 * Tudo em BEGIN…ROLLBACK (withTx) e SÓ na cópia local (exigeBancoLocal). Com INTEGRACAO_MIG_TXN=1 o delta 7 é aplicado
 * DENTRO da txn quando a cópia ainda não o tem (e os testes de ida/volta rodam) — janela N3 (n3.sh antes/depois). Sem a
 * variável, o delta 7 precisa JÁ estar na cópia (copia-delta7.sh ida).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, semUsuario, um } from "./db";
import { DEF, LOCAL, MIG_TXN, ROOT, T, U, aplica, modeloInterno, prepara } from "./integracao-helpers";
import { readFileSync } from "node:fs";

const MIG_D7 = "supabase/migrations/20261008100000_integracao_7_permissao_super.sql";
const INV_D7 = "supabase/rollback/20261008100000_integracao_7_permissao_super_down.sql";
const MARCA_D7 = "to_regprocedure('public._integracao_pode(boolean)') IS NOT NULL";
const REDEF = [
  { nome: "_integracao_exige", sig: "_integracao_exige(boolean)", antes: "7ed9fb6de2ba2a615e11dacf1578bf78", trocas: 2 },
  { nome: "_integracao_gates", sig: "_integracao_gates(uuid)", antes: "30449c555718f76cdb2747267e54caf2", trocas: 1 },
  { nome: "integracao_listar", sig: "integracao_listar(text,jsonb,integer)", antes: "f840c67870a924fc3983243c52102da6", trocas: 1 },
] as const;
const NOVAS = ["_integracao_pode(boolean)", "fn_integracao_perm_user()", "fn_integracao_perm_papel()"] as const;

// usuários de teste (criados na txn)
const TA = "d7000000-0000-4000-8000-0000000000a1"; // admin da loja SEM a permissão
const TB = "d7000000-0000-4000-8000-0000000000b1"; // admin da loja; a permissão é dada pelo super admin
const X = "d7000000-0000-4000-8000-0000000000c1"; // usuário comum (alvo do set_user_permissions)
const Y = "d7000000-0000-4000-8000-0000000000d1"; // usuário comum que será excluído

/** Texto de antes (pg_get_functiondef de produção = cópia; gerado por dump_antes_d7.sh) SEM o "\n" que o psql acrescenta. */
function antes(nome: string): string {
  const t = readFileSync(`${ROOT}.superpowers/integracao/mig/antes-d7/${nome}.sql`, "utf8");
  return t.slice(0, -1);
}
/** O MESMO texto com SÓ as expressões de permissão trocadas — o que o delta 7 tem de deixar no banco. */
function esperadoDepois(nome: string): string {
  return antes(nome)
    .replaceAll("public.user_can_edit('integracao')", "public._integracao_pode(true)")
    .replaceAll("public.user_can_view('integracao')", "public._integracao_pode(false)");
}

async function temD7(c: Client): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, `SELECT ${MARCA_D7} AS ok`)).ok;
}
/**
 * Integração 1..6 + delta 7. Com MIG_TXN o delta 7 é SEMPRE (re)aplicado na txn: `prepara` reaplica a migration 2, que devolve
 * _integracao_exige/_integracao_gates/integracao_listar ao texto de antes mesmo com o delta 7 na cópia (a guarda do delta 7 aceita
 * o texto de antes OU o de depois — idempotente). Sem MIG_TXN, o delta 7 precisa já estar na cópia.
 */
async function preparaD7(c: Client): Promise<void> {
  await prepara(c, 6);
  if (MIG_TXN) {
    await aplica(c, MIG_D7);
    return;
  }
  if (!(await temD7(c))) throw new Error("delta 7 ausente na cópia — rode com INTEGRACAO_MIG_TXN=1 (janela N3) ou copia-delta7.sh ida");
}
async function erro(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await c.query(sql, params);
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    return { code: e.code, message: e.message };
  }
  await c.query("RELEASE SAVEPOINT e");
  throw new Error(`esperava erro em: ${sql}`);
}
async function criaUsuario(c: Client, uid: string, o: { tenantAdmin?: boolean; papel?: string } = {}): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, papel_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, papel_id = excluded.papel_id`,
    [uid, T, `${uid}@teste`, `Teste D7 ${uid.slice(-2)}`, o.papel ?? null],
  );
  if (o.tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
}
async function como(c: Client, uid: string): Promise<void> {
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
/** Grava a linha `integracao` do usuário COMO o super admin (USER_TESTE) e volta ao JWT anterior de propósito (nenhum). */
async function concedePeloSuper(c: Client, uid: string, ver: boolean, editar: boolean): Promise<void> {
  await comoUsuario(c, U);
  await c.query(
    `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'integracao', $3, $4)`,
    [uid, T, ver, editar],
  );
}
async function permsDe(c: Client, uid: string): Promise<Record<string, [boolean, boolean]>> {
  const r = await c.query(`SELECT pagina, pode_ver, pode_editar FROM public.user_permissions WHERE user_id = $1 ORDER BY pagina`, [uid]);
  return Object.fromEntries(r.rows.map((x) => [x.pagina, [x.pode_ver, x.pode_editar]]));
}
async function exige(c: Client, editar: boolean): Promise<string> {
  return (await um<{ t: string }>(c, `SELECT public._integracao_exige($1) AS t`, [editar])).t;
}

describe.skipIf(!hasDb || !LOCAL)("integracao — delta 7: permissão só pelo super admin", () => {
  it("tenant_admin SEM a permissão: _integracao_exige (ver e editar) e integracao_listar recusam 42501; gates dizem 'precisa da permissão'", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      await criaUsuario(c, TA, { tenantAdmin: true });
      await como(c, TA);
      // o atalho de admin CONTINUA em user_can_* (não mudou) — mas a Integração não o usa mais
      expect((await um<{ v: boolean }>(c, `SELECT public.user_can_view('integracao') AS v`)).v).toBe(true);
      expect((await um<{ p: boolean }>(c, `SELECT public._integracao_pode(false) AS p`)).p).toBe(false);
      expect(await erro(c, `SELECT public._integracao_exige(false)`)).toEqual({ code: "42501", message: "Sem permissão para ver a Integração." });
      expect(await erro(c, `SELECT public._integracao_exige(true)`)).toEqual({ code: "42501", message: "Sem permissão para editar a Integração." });
      expect((await erro(c, `SELECT public.integracao_listar('nao_integrados', '{}'::jsonb, 1)`)).code).toBe("42501");
      expect((await erro(c, `SELECT public.integracao_previa(ARRAY[$1::uuid])`, [m.id])).code).toBe("42501");
      const g = (await um<{ g: any }>(c, `SELECT public._integracao_gates($1) AS g`, [m.id])).g;
      expect(g.planejamento).toMatchObject({ ok: false, motivo: "Precisa da permissão de editar a Integração." });
    });
  });

  it("tenant_admin COM a permissão dada pelo super admin: ver-só passa no ver e recusa editar; ver+editar passa nos dois; listar diz pode.editar", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await criaUsuario(c, TB, { tenantAdmin: true });
      await concedePeloSuper(c, TB, true, false);
      await como(c, TB);
      expect(await exige(c, false)).toBe(T);
      expect((await erro(c, `SELECT public._integracao_exige(true)`)).code).toBe("42501");
      const l1 = (await um<{ r: any }>(c, `SELECT public.integracao_listar('nao_integrados', '{}'::jsonb, 1) AS r`)).r;
      expect(l1.pode.editar).toBe(false);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'integracao'`, [TB]);
      await como(c, TB);
      expect(await exige(c, true)).toBe(T);
      const l2 = (await um<{ r: any }>(c, `SELECT public.integracao_listar('nao_integrados', '{}'::jsonb, 1) AS r`)).r;
      expect(l2.pode.editar).toBe(true);
      // usuário COMUM com a permissão dada pelo super admin também passa (a regra é a linha do usuário, não o papel de admin)
      await criaUsuario(c, X);
      await concedePeloSuper(c, X, true, true);
      await como(c, X);
      expect(await exige(c, true)).toBe(T);
    });
  });

  it("super admin passa sem nenhuma linha de permissão", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await comoUsuario(c, U);
      expect(await permsDe(c, U)).not.toHaveProperty("integracao");
      expect(await exige(c, false)).toBe(T);
      expect(await exige(c, true)).toBe(T);
      const l = (await um<{ r: any }>(c, `SELECT public.integracao_listar('nao_integrados', '{}'::jsonb, 1) AS r`)).r;
      expect(l.pode).toMatchObject({ editar: true, super: true });
    });
  });

  it("tenant_admin no set_user_permissions de outro usuário: não concede, não apaga nem muda a do super admin; o resto grava normal", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await criaUsuario(c, TA, { tenantAdmin: true });
      await criaUsuario(c, X);
      await concedePeloSuper(c, X, true, false);
      await como(c, TA);
      // 1) payload do admin da loja COM integracao ver+editar e outra página → integracao fica a do super (ver-só)
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [X, T, JSON.stringify([
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: true },
      ])]);
      expect(await permsDe(c, X)).toEqual({ criacao_planejamento: [true, true], integracao: [true, false] });
      // 2) payload SEM integracao (o admin da loja "desmarca") → a do super admin continua
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [X, T, JSON.stringify([
        { pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, X)).toEqual({ cadastro_tecidos: [true, false], integracao: [true, false] });
      // 3) escrita DIRETA (RLS tenant_admin_user_permissions) na linha do super admin: UPDATE/DELETE ignorados
      await c.query("SAVEPOINT r");
      await c.query("SET LOCAL ROLE authenticated");
      const upd = await c.query(`UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'integracao'`, [X]);
      const del = await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'integracao'`, [X]);
      const renomeia = await c.query(`UPDATE public.user_permissions SET pagina = 'integracao' WHERE user_id = $1 AND pagina = 'cadastro_tecidos'`, [X]);
      await c.query("RESET ROLE");
      await c.query("RELEASE SAVEPOINT r");
      expect([upd.rowCount, del.rowCount, renomeia.rowCount]).toEqual([0, 0, 0]);
      expect(await permsDe(c, X)).toEqual({ cadastro_tecidos: [true, false], integracao: [true, false] });
      // 4) usuário SEM a permissão: o admin da loja não consegue conceder (nem por RPC nem por INSERT direto)
      await criaUsuario(c, Y);
      await como(c, TA);
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [Y, T, JSON.stringify([
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
      ])]);
      const ins = await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'integracao:produtos', true, true)`,
        [Y, T]);
      expect(ins.rowCount).toBe(0);
      expect(await permsDe(c, Y)).toEqual({ criacao_planejamento: [true, false] });
      await como(c, Y);
      expect((await erro(c, `SELECT public._integracao_exige(false)`)).code).toBe("42501");
    });
  });

  it("super admin concede e retira pelo set_user_permissions (e o usuário passa/deixa de passar)", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await criaUsuario(c, X);
      await comoUsuario(c, U);
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [X, T, JSON.stringify([
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, X)).toEqual({ criacao_planejamento: [true, false], integracao: [true, true] });
      await como(c, X);
      expect(await exige(c, true)).toBe(T);
      await comoUsuario(c, U);
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [X, T, JSON.stringify([
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, X)).toEqual({ criacao_planejamento: [true, false] });
      await como(c, X);
      expect((await erro(c, `SELECT public._integracao_exige(false)`)).code).toBe("42501");
    });
  });

  it("papel NUNCA carrega integracao: salvar_papel (admin da loja e super admin) grava o resto sem a linha; usuário do papel não entra", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await criaUsuario(c, TA, { tenantAdmin: true });
      const payload = JSON.stringify([
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "integracao:produtos", pode_ver: true, pode_editar: true },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: true },
      ]);
      await como(c, TA);
      const p1 = (await um<{ id: string }>(c, `SELECT public.salvar_papel(NULL, $1, 'Papel D7 loja', NULL, $2::jsonb) AS id`, [T, payload])).id;
      await comoUsuario(c, U);
      const p2 = (await um<{ id: string }>(c, `SELECT public.salvar_papel(NULL, $1, 'Papel D7 super', NULL, $2::jsonb) AS id`, [T, payload])).id;
      const r = await c.query(`SELECT papel_id, pagina FROM public.papel_permissoes WHERE papel_id = ANY($1::uuid[]) ORDER BY 1, 2`, [[p1, p2]]);
      expect(r.rows.map((x) => x.pagina)).toEqual(["criacao_planejamento", "criacao_planejamento"]);
      // UPDATE direto de uma linha do papel para 'integracao' (nem o super admin): ignorado
      const upd = await c.query(`UPDATE public.papel_permissoes SET pagina = 'integracao' WHERE papel_id = $1`, [p2]);
      expect(upd.rowCount).toBe(0);
      await criaUsuario(c, X, { papel: p1 });
      await como(c, X);
      expect((await um<{ p: boolean }>(c, `SELECT public._integracao_pode(false) AS p`)).p).toBe(false);
      expect((await erro(c, `SELECT public._integracao_exige(false)`)).code).toBe("42501");
    });
  });

  it("A-M1: só 'integracao' e 'integracao:*' são da Integração — 'integracaoXYZ'/'integracao_marketplace' NÃO são interceptadas", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await criaUsuario(c, TA, { tenantAdmin: true });
      await criaUsuario(c, X);
      await como(c, TA);
      for (const pagina of ["integracaoXYZ", "integracao_marketplace", "integracao:produtos", "integracao"]) {
        await c.query(
          `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, true)`,
          [X, T, pagina]);
      }
      // as 2 de fora do padrão entram (admin da loja); as 2 da Integração são ignoradas
      expect(await permsDe(c, X)).toEqual({ integracaoXYZ: [true, true], integracao_marketplace: [true, true] });
      // e o admin da loja apaga/muda as de fora do padrão normalmente
      const upd = await c.query(`UPDATE public.user_permissions SET pode_editar = false WHERE user_id = $1 AND pagina = 'integracaoXYZ'`, [X]);
      const del = await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'integracao_marketplace'`, [X]);
      expect([upd.rowCount, del.rowCount]).toEqual([1, 1]);
      // papel: 'integracaoXYZ' grava; 'integracao' e 'integracao:produtos' não
      const p = (await um<{ id: string }>(c, `SELECT public.salvar_papel(NULL, $1, 'Papel D7 XYZ', NULL, $2::jsonb) AS id`, [T, JSON.stringify([
        { pagina: "integracaoXYZ", pode_ver: true, pode_editar: false },
        { pagina: "integracao", pode_ver: true, pode_editar: true },
        { pagina: "integracao:produtos", pode_ver: true, pode_editar: true },
      ])])).id;
      expect((await c.query(`SELECT pagina FROM public.papel_permissoes WHERE papel_id = $1 ORDER BY 1`, [p])).rows.map((x) => x.pagina))
        .toEqual(["integracaoXYZ"]);
      // e 'integracaoXYZ' não abre a Integração
      await como(c, X);
      expect((await um<{ p: boolean }>(c, `SELECT public._integracao_pode(false) AS p`)).p).toBe(false);
    });
  });

  it("excluir um usuário que tem integracao funciona (deleteUser/deleteStoreUser: DELETE explícito + cascata; e a cascata de auth.users)", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      await criaUsuario(c, Y);
      await concedePeloSuper(c, Y, true, true);
      await criaUsuario(c, X);
      await concedePeloSuper(c, X, true, false);
      // (a) como o servidor faz (service_role, sem JWT de super admin): o DELETE explícito PULA a linha integracao
      //     (quem apaga não é super admin), e o DELETE do users leva a linha pela cascata
      await semUsuario(c);
      await c.query("SAVEPOINT s");
      await c.query("SET LOCAL ROLE service_role");
      await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [Y]);
      const sobrou = await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.user_permissions WHERE user_id = $1`, [Y]);
      await c.query(`DELETE FROM public.user_roles WHERE user_id = $1`, [Y]);
      await c.query(`DELETE FROM public.users WHERE id = $1`, [Y]);
      await c.query("RESET ROLE");
      await c.query("RELEASE SAVEPOINT s");
      expect(sobrou.n).toBe("1");
      await c.query(`DELETE FROM auth.users WHERE id = $1`, [Y]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.user_permissions WHERE user_id = $1`, [Y])).n).toBe("0");
      // (b) apagar direto o auth.users (cascata auth.users → users → user_permissions), com JWT de admin da loja
      await criaUsuario(c, TA, { tenantAdmin: true });
      await como(c, TA);
      await c.query(`DELETE FROM auth.users WHERE id = $1`, [X]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.user_permissions WHERE user_id = $1`, [X])).n).toBe("0");
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.users WHERE id = $1`, [X])).n).toBe("0");
    });
  });

  it("reset_loja/_wipe_tenant_core: com session_replication_role = replica o gatilho não dispara (o wipe apaga a linha)", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      const wipe = (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public._wipe_tenant_core'::regproc) AS d`)).d;
      expect(wipe).toMatch(/SET LOCAL session_replication_role = replica;/);
      expect(wipe).toMatch(/DELETE FROM public\.user_permissions WHERE tenant_id = _tid;/);
      const tg = await c.query(
        `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('trg_integracao_perm_user', 'trg_integracao_perm_papel') ORDER BY 1`);
      expect(tg.rows).toEqual([{ tgname: "trg_integracao_perm_papel", tgenabled: "O" }, { tgname: "trg_integracao_perm_user", tgenabled: "O" }]);
      await criaUsuario(c, X);
      await concedePeloSuper(c, X, true, true);
      await criaUsuario(c, TA, { tenantAdmin: true });
      await como(c, TA);
      await c.query("SAVEPOINT w");
      await c.query("SET LOCAL session_replication_role = replica");
      const del = await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'integracao'`, [X]);
      await c.query("RELEASE SAVEPOINT w");
      await c.query("SET LOCAL session_replication_role = origin");
      expect(del.rowCount).toBe(1);
    });
  });

  it("ACL (#9): as 3 novas e as internas redefinidas fechadas p/ PUBLIC/anon/authenticated; integracao_listar só authenticated", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      for (const f of [...NOVAS, "_integracao_exige(boolean)", "_integracao_gates(uuid)"]) {
        const r = await um<{ p: boolean; a: boolean; u: boolean }>(c,
          `SELECT has_function_privilege('public', $1, 'EXECUTE') AS p, has_function_privilege('anon', $1, 'EXECUTE') AS a,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS u`, [`public.${f}`]);
        expect(r, f).toEqual({ p: false, a: false, u: false });
      }
      // P-130 A (20261013100000): integracao_listar pode estar com a assinatura NOVA (+ _limite) — confere a que existir (é 1 só)
      const l = await um<{ a: boolean; u: boolean }>(c,
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'integracao_listar'`);
      expect(l).toEqual({ a: false, u: true });
      // nenhuma função da frente usa mais o atalho de admin
      const n = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '%integracao%'
            AND pg_get_functiondef(p.oid) ~ 'user_can_(view|edit)\\(''integracao'`);
      expect(n.n).toBe("0");
    });
  });

  it("as 3 funções redefinidas diferem do texto de antes SÓ nas expressões de permissão (pg_get_functiondef)", async () => {
    await withTx(async (c) => {
      await preparaD7(c);
      for (const f of REDEF) {
        const a = antes(f.nome);
        const d = await DEF(c, f.sig);
        expect(d, f.nome).toBe(esperadoDepois(f.nome));
        const la = a.split("\n");
        const ld = d.split("\n");
        expect(ld.length).toBe(la.length);
        const mudou = la.map((x, i) => [x, ld[i]] as const).filter(([x, y]) => x !== y);
        expect(mudou.length, f.nome).toBe(f.trocas);
        for (const [x, y] of mudou) {
          expect(x).toMatch(/public\.user_can_(view|edit)\('integracao'\)/);
          expect(y).toMatch(/public\._integracao_pode\((true|false)\)/);
        }
      }
    });
  });

  it.skipIf(!MIG_TXN)("limpeza: linhas integracao/integracao:* de papel_permissoes existentes ANTES do delta são apagadas pela ida (integracaoXYZ fica)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await c.query("SET LOCAL statement_timeout = '120s'");
      if (await temD7(c)) await aplica(c, INV_D7);
      await comoUsuario(c, U);
      const p = (await um<{ id: string }>(c,
        `SELECT public.salvar_papel(NULL, $1, 'Papel D7 antigo', NULL, $2::jsonb) AS id`,
        [T, JSON.stringify([{ pagina: "integracao", pode_ver: true, pode_editar: true }, { pagina: "integracao:produtos", pode_ver: true, pode_editar: false },
          { pagina: "integracaoXYZ", pode_ver: true, pode_editar: false }, { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false }])])).id;
      expect((await c.query(`SELECT pagina FROM public.papel_permissoes WHERE papel_id = $1 ORDER BY pagina COLLATE "C"`, [p])).rows.map((x) => x.pagina))
        .toEqual(["criacao_planejamento", "integracao", "integracao:produtos", "integracaoXYZ"]);
      await aplica(c, MIG_D7);
      expect((await c.query(`SELECT pagina FROM public.papel_permissoes WHERE papel_id = $1 ORDER BY pagina COLLATE "C"`, [p])).rows.map((x) => x.pagina))
        .toEqual(["criacao_planejamento", "integracaoXYZ"]);
    });
  });

  it.skipIf(!MIG_TXN)("volta: o inverso restaura as 3 funções byte a byte e tira as novas; ida/volta 2× (idempotente)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await c.query("SET LOCAL statement_timeout = '180s'");
      const retrato = async () => um<{ f: string; g: string; md5: string; novas: string; tg: string }>(c,
        `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS f,
                (SELECT count(*) FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS g,
                (SELECT string_agg(md5(pg_get_functiondef(p.oid)), '|' ORDER BY p.proname COLLATE "C") FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('_integracao_exige', '_integracao_gates', 'integracao_listar')) AS md5,
                (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('_integracao_pode', 'fn_integracao_perm_user', 'fn_integracao_perm_papel')) AS novas,
                (SELECT string_agg(md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname, k.relname) FROM pg_trigger t
                  JOIN pg_class k ON k.oid = t.tgrelid WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS tg`);
      await aplica(c, MIG_D7); // prepara reaplicou a 2 (texto de antes nas 3); a ida é idempotente
      const ida = await retrato();
      for (const f of REDEF) expect(await DEF(c, f.sig), f.nome).toBe(esperadoDepois(f.nome));
      await aplica(c, INV_D7);
      const volta = await retrato();
      expect(volta.md5).toBe(REDEF.map((f) => f.antes).join("|"));
      for (const f of REDEF) expect(await DEF(c, f.sig), f.nome).toBe(antes(f.nome));
      expect(volta.novas).toBe("0");
      expect(Number(ida.f) - Number(volta.f)).toBe(3);
      expect(Number(ida.g) - Number(volta.g)).toBe(2);
      expect(await temD7(c)).toBe(false);
      await aplica(c, INV_D7); // 2ª volta: idempotente
      expect(await retrato()).toEqual(volta);
      await aplica(c, MIG_D7);
      expect(await retrato()).toEqual(ida);
      for (const f of REDEF) expect(await DEF(c, f.sig), f.nome).toBe(esperadoDepois(f.nome));
      await aplica(c, MIG_D7); // 2ª ida: idempotente
      expect(await retrato()).toEqual(ida);
      await aplica(c, INV_D7);
      expect(await retrato()).toEqual(volta);
      await aplica(c, MIG_D7);
      expect(await retrato()).toEqual(ida);
    });
  });
});
