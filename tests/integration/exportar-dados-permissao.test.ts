// Exportar dados vira item proprio na sidebar - BANCO (plano docs/superpowers/plans/2026-11-16-exportar-dados-sidebar.md, Tasks 1 e 2).
// Migration 20261201130000_exportar_dados_permissao (+ inverso em supabase/rollback/). SO na copia local (exigeBancoLocal), cada caso em
// txn revertida (withTx). Se a copia ainda nao tem a migration, ela e aplicada DENTRO da txn pelo harness (mig-txn: sem BEGIN/COMMIT,
// NUNCA \i). As RPCs rodam como o PAPEL do PostgREST (SET LOCAL ROLE authenticated) com claims de usuario.
// Regra: usa a exportacao o super admin OU quem tem a linha `exportar_dados` (ver) NO PROPRIO USUARIO, dada SO pelo super admin;
// tenant_admin NAO fura (sem bypass); papel nunca a carrega; a permissao `integracao` NAO basta mais.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, semUsuario, um } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { LOCAL, ROOT, T, U, comoUsuarioCom } from "./integracao-helpers";

const MIG_BASE = "supabase/migrations/20261122100000_exportar_dados.sql";
const MIG = "supabase/migrations/20261201130000_exportar_dados_permissao.sql";
const DOWN = "supabase/rollback/20261201130000_exportar_dados_permissao_down.sql";
const SIG_EXP = "public.exportar_produtos(text,text,text[],text[],integer)";
const SIG_SUB = "public.exportar_subcolecoes(text)";
const SIG_CORE = "public._exportar_produtos_core(uuid,text,text,text[],text[],integer)";
const MD5_CORE = "36501a76de5616cda4a3aa59a0d71a5a";
const MD5_ANTES = { exp: "1fa3443f73c47729224efb78c4adb1ae", sub: "b3559f1ab77995640ee278eb4bd8cf1a" } as const;
const MD5_DEPOIS = { exp: "c3bbc11117ac9366dc11923d1f79e390", sub: "d45677cb21a5ee47b01b3b82065e193a" } as const;

// usuarios de teste (criados na txn)
const COMUM = "e0000000-0000-4000-8000-0000000000a1"; // usuario comum SEM exportar_dados
const ADMIN = "e0000000-0000-4000-8000-0000000000b1"; // tenant_admin da loja
const ALVO = "e0000000-0000-4000-8000-0000000000c1"; // usuario comum, alvo das concessoes
const EXCL = "e0000000-0000-4000-8000-0000000000d1"; // usuario que sera excluido

const md5 = (s: string): string => createHash("md5").update(s).digest("hex");

/** Funcoes vivas NESTA txn: base da exportacao + permissao (se a copia ainda nao tem, a ida roda dentro da txn). */
async function viva(c: Client): Promise<void> {
  try {
    if ((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('${SIG_EXP}') IS NOT NULL AS ok`)).ok === false) await aplicarArquivo(c, MIG_BASE);
    if ((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public._exportar_exige()') IS NOT NULL AS ok`)).ok === false) await aplicarArquivo(c, MIG);
  } finally {
    // as migrations fazem SET LOCAL lock_timeout/transaction_timeout (valeriam para a txn INTEIRA do teste)
    await c.query("SET LOCAL transaction_timeout = 0");
    await c.query("SET LOCAL lock_timeout = '3s'");
  }
}

async function criaUsuario(c: Client, uid: string, o: { tenantAdmin?: boolean; papel?: string } = {}): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, papel_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, papel_id = excluded.papel_id`,
    [uid, T, `${uid}@teste`, `Teste Exp ${uid.slice(-2)}`, o.papel ?? null],
  );
  if (o.tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
}
async function como(c: Client, uid: string): Promise<void> {
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
/** Grava a linha `exportar_dados` do usuario COMO o super admin (USER_TESTE); deixa o JWT do super ligado. */
async function concedePeloSuper(c: Client, uid: string, ver = true, editar = false): Promise<void> {
  await comoUsuario(c, U);
  await c.query(
    `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'exportar_dados', $3, $4)`,
    [uid, T, ver, editar],
  );
}
async function permsDe(c: Client, uid: string): Promise<Record<string, [boolean, boolean]>> {
  const r = await c.query(`SELECT pagina, pode_ver, pode_editar FROM public.user_permissions WHERE user_id = $1 ORDER BY pagina`, [uid]);
  return Object.fromEntries(r.rows.map((x) => [x.pagina, [x.pode_ver, x.pode_editar]]));
}
/** Roda `sql` como o PAPEL authenticated (PostgREST) e devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT ex_p");
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT ex_p"); // desfaz tambem o SET LOCAL ROLE; depois do erro a txn so aceita isto
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT ex_p");
  }
}
const EXPORTA = `SELECT public.exportar_produtos('QA-EXP-PERM', NULL, ARRAY['nome']::text[], ARRAY['1']::text[], NULL)`;
const SUBS = `SELECT public.exportar_subcolecoes('QA-EXP-PERM')`;

describe.skipIf(!hasDb || !LOCAL)("exportar dados - permissao propria `exportar_dados` (so super admin concede)", () => {
  // ------------------------------------------------------------------ Task 1: portao
  it("usuario comum SEM exportar_dados: exportar_produtos e exportar_subcolecoes dao 42501", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuarioCom(c, COMUM, [["criacao_planejamento", true, true]]);
      expect(await tenta(c, EXPORTA)).toBe("42501 Sem permissão para exportar dados.");
      expect(await tenta(c, SUBS)).toBe("42501 Sem permissão para exportar dados.");
      expect((await um<{ p: boolean }>(c, `SELECT public._exportar_pode() AS p`)).p).toBe(false);
    });
  });

  it("sem login = 42501 'Nao autenticado'; loja inativa/sem loja = 42501", async () => {
    await withTx(async (c) => {
      await viva(c);
      await semUsuario(c);
      expect(await tenta(c, EXPORTA)).toBe("42501 Não autenticado.");
      expect(await tenta(c, SUBS)).toBe("42501 Não autenticado.");
      // usuario com a permissao mas SEM loja (tenant_id NULL): 42501 de loja, antes mesmo do portao de permissao
      await criaUsuario(c, ALVO);
      await concedePeloSuper(c, ALVO);
      await c.query(`UPDATE public.users SET tenant_id = NULL WHERE id = $1`, [ALVO]);
      await como(c, ALVO);
      expect(await tenta(c, EXPORTA)).toBe("42501 Loja inativa ou sem loja — operação não permitida.");
      expect(await tenta(c, SUBS)).toBe("42501 Loja inativa ou sem loja — operação não permitida.");
    });
  });

  it("COM exportar_dados dada pelo super admin: passa (nao e 42501) nos dois; a Integracao NAO basta mais", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ALVO);
      await concedePeloSuper(c, ALVO);
      await como(c, ALVO);
      expect(await tenta(c, EXPORTA)).toBe("PASSOU");
      expect(await tenta(c, SUBS)).toBe("PASSOU");
      expect((await um<{ p: boolean }>(c, `SELECT public._exportar_pode() AS p`)).p).toBe(true);
      // `integracao` (ver+editar) sem `exportar_dados`: recusado
      await comoUsuarioCom(c, COMUM, [["integracao", true, true]]);
      expect(await tenta(c, EXPORTA)).toBe("42501 Sem permissão para exportar dados.");
      expect(await tenta(c, SUBS)).toBe("42501 Sem permissão para exportar dados.");
    });
  });

  it("exportar_dados com pode_ver = false NAO passa (o portao e o ver)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ALVO);
      await concedePeloSuper(c, ALVO, false, true);
      await como(c, ALVO);
      expect(await tenta(c, EXPORTA)).toMatch(/^42501 /);
    });
  });

  it("tenant_admin SEM a key: 42501 (nao fura - sem bypass de admin); COM a key dada pelo super: passa; super admin passa sem linha", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ADMIN, { tenantAdmin: true });
      await como(c, ADMIN);
      // o atalho de admin CONTINUA em user_can_view (nao mudou) - mas a exportacao nao o usa
      expect((await um<{ v: boolean }>(c, `SELECT public.user_can_view('exportar_dados') AS v`)).v).toBe(true);
      expect((await um<{ p: boolean }>(c, `SELECT public._exportar_pode() AS p`)).p).toBe(false);
      expect(await tenta(c, EXPORTA)).toBe("42501 Sem permissão para exportar dados.");
      expect(await tenta(c, SUBS)).toBe("42501 Sem permissão para exportar dados.");
      await concedePeloSuper(c, ADMIN);
      await como(c, ADMIN);
      expect(await tenta(c, EXPORTA)).toBe("PASSOU");
      // super admin: sem nenhuma linha de permissao
      await comoUsuario(c, U);
      expect(await permsDe(c, U)).not.toHaveProperty("exportar_dados");
      expect(await tenta(c, EXPORTA)).toBe("PASSOU");
      expect(await tenta(c, SUBS)).toBe("PASSOU");
    });
  });

  it("privilegios: as 2 funcoes do portao e as 2 do gatilho NAO sao executaveis por PUBLIC/anon/authenticated; wrappers: authenticated sim, anon nao; core intocado", async () => {
    await withTx(async (c) => {
      await viva(c);
      const p = async (role: string, sig: string) =>
        (await um<{ ok: boolean }>(c, `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig])).ok;
      for (const sig of ["public._exportar_pode()", "public._exportar_exige()", "public.fn_exportar_dados_perm_user()", "public.fn_exportar_dados_perm_papel()"]) {
        for (const role of ["public", "anon", "authenticated"]) expect(await p(role, sig), `${role} ${sig}`).toBe(false);
      }
      for (const sig of [SIG_EXP, SIG_SUB]) {
        expect(await p("authenticated", sig), sig).toBe(true);
        expect(await p("anon", sig), sig).toBe(false);
        expect(await p("public", sig), sig).toBe(false);
      }
      for (const role of ["public", "anon", "authenticated"]) expect(await p(role, SIG_CORE), `${role} core`).toBe(false);
      // chamada direta do portao como authenticated: permission denied (42501 de ACL, nao o RAISE)
      await comoUsuario(c, U);
      expect(await tenta(c, `SELECT public._exportar_exige()`)).toMatch(/^42501 permission denied/);
    });
  });

  it("md5: _exportar_produtos_core INTOCADO; wrappers = texto de DEPOIS, e so a linha do portao difere do de ANTES; nenhum usa _integracao_exige", async () => {
    await withTx(async (c) => {
      await viva(c);
      const def = async (sig: string) =>
        (await um<{ d: string }>(c, `SELECT pg_get_functiondef('${sig}'::regprocedure) AS d`)).d;
      expect(md5(await def(SIG_CORE))).toBe(MD5_CORE);
      const exp = await def(SIG_EXP);
      const sub = await def(SIG_SUB);
      expect(md5(exp)).toBe(MD5_DEPOIS.exp);
      expect(md5(sub)).toBe(MD5_DEPOIS.sub);
      // trocando SO a linha do portao de volta, o texto vivo vira o de ANTES (md5 do arquivo da migration base)
      const volta = (s: string, de: string, para: string) => {
        expect(s.split(de).length - 1, `linha do portao em ${de}`).toBe(1);
        return s.replace(de, para);
      };
      expect(md5(volta(exp, "public._exportar_exige();  -- login + loja ativa + permissao `exportar_dados`",
        "public._integracao_exige(false);  -- login + loja ativa + permissao de VER a Integracao"))).toBe(MD5_ANTES.exp);
      expect(md5(volta(sub, "public._exportar_exige();  -- mesmo portao da exportacao",
        "public._integracao_exige(false);  -- mesmo portao da exportacao"))).toBe(MD5_ANTES.sub);
      expect(exp + sub).not.toMatch(/_integracao_exige/);
    });
  });

  // ------------------------------------------------------------------ Task 2: so o super admin concede
  it("usuario NAO-super (admin da loja) grava exportar_dados em user_permissions: no-op silencioso; o resto grava normal; _exportar_pode segue false", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ADMIN, { tenantAdmin: true });
      await criaUsuario(c, ALVO);
      await como(c, ADMIN);
      // escrita direta (INSERT)
      const ins = await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'exportar_dados', true, true)`,
        [ALVO, T],
      );
      expect(ins.rowCount).toBe(0);
      // set_user_permissions do admin com exportar_dados + outra pagina: so a outra entra
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [ALVO, T, JSON.stringify([
        { pagina: "exportar_dados", pode_ver: true, pode_editar: true },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, ALVO)).toEqual({ criacao_planejamento: [true, false] });
      await como(c, ALVO);
      expect((await um<{ p: boolean }>(c, `SELECT public._exportar_pode() AS p`)).p).toBe(false);
      expect(await tenta(c, EXPORTA)).toMatch(/^42501 /);
    });
  });

  it("a linha dada pelo super admin: o admin da loja NAO apaga, NAO altera, NAO renomeia (UPDATE/DELETE ignorados; set_user_permissions sem a key preserva)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ADMIN, { tenantAdmin: true });
      await criaUsuario(c, ALVO);
      await concedePeloSuper(c, ALVO, true, false);
      await como(c, ADMIN);
      // set_user_permissions do admin SEM a key ("desmarca"): a do super continua
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [ALVO, T, JSON.stringify([
        { pagina: "cadastro_tecidos", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, ALVO)).toEqual({ cadastro_tecidos: [true, false], exportar_dados: [true, false] });
      // escrita DIRETA como authenticated (RLS de tenant_admin): UPDATE/DELETE/renomear ignorados
      await c.query("SAVEPOINT r");
      await c.query("SET LOCAL ROLE authenticated");
      const upd = await c.query(`UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'exportar_dados'`, [ALVO]);
      const del = await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'exportar_dados'`, [ALVO]);
      const ren = await c.query(`UPDATE public.user_permissions SET pagina = 'exportar_dados' WHERE user_id = $1 AND pagina = 'cadastro_tecidos'`, [ALVO]);
      await c.query("RESET ROLE");
      await c.query("RELEASE SAVEPOINT r");
      expect([upd.rowCount, del.rowCount, ren.rowCount]).toEqual([0, 0, 0]);
      expect(await permsDe(c, ALVO)).toEqual({ cadastro_tecidos: [true, false], exportar_dados: [true, false] });
      await como(c, ALVO);
      expect(await tenta(c, EXPORTA)).toBe("PASSOU");
    });
  });

  it("super admin concede e retira pelo set_user_permissions (e o usuario passa/deixa de passar)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ALVO);
      await comoUsuario(c, U);
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [ALVO, T, JSON.stringify([
        { pagina: "exportar_dados", pode_ver: true, pode_editar: false },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, ALVO)).toEqual({ criacao_planejamento: [true, false], exportar_dados: [true, false] });
      await como(c, ALVO);
      expect(await tenta(c, EXPORTA)).toBe("PASSOU");
      await comoUsuario(c, U);
      await c.query(`SELECT public.set_user_permissions($1, $2, $3::jsonb)`, [ALVO, T, JSON.stringify([
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
      ])]);
      expect(await permsDe(c, ALVO)).toEqual({ criacao_planejamento: [true, false] });
      await como(c, ALVO);
      expect(await tenta(c, EXPORTA)).toMatch(/^42501 /);
    });
  });

  it("papel NUNCA carrega exportar_dados: salvar_papel (admin da loja e super admin) grava o resto sem a linha; UPDATE para a key ignorado; usuario do papel nao passa", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ADMIN, { tenantAdmin: true });
      const payload = JSON.stringify([
        { pagina: "exportar_dados", pode_ver: true, pode_editar: true },
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: true },
      ]);
      await como(c, ADMIN);
      const p1 = (await um<{ id: string }>(c, `SELECT public.salvar_papel(NULL, $1, 'Papel EXP loja', NULL, $2::jsonb) AS id`, [T, payload])).id;
      await comoUsuario(c, U);
      const p2 = (await um<{ id: string }>(c, `SELECT public.salvar_papel(NULL, $1, 'Papel EXP super', NULL, $2::jsonb) AS id`, [T, payload])).id;
      const r = await c.query(`SELECT papel_id, pagina FROM public.papel_permissoes WHERE papel_id = ANY($1::uuid[]) ORDER BY 1, 2`, [[p1, p2]]);
      expect(r.rows.map((x) => x.pagina)).toEqual(["criacao_planejamento", "criacao_planejamento"]);
      // INSERT direto da key no papel (nem o super admin): bloqueado (RETURN NULL)
      const ins = await c.query(
        `INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'exportar_dados', true, true)`,
        [p2, T],
      );
      expect(ins.rowCount).toBe(0);
      // UPDATE direto de uma linha do papel para a key: ignorado
      const upd = await c.query(`UPDATE public.papel_permissoes SET pagina = 'exportar_dados' WHERE papel_id = $1`, [p2]);
      expect(upd.rowCount).toBe(0);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.papel_permissoes WHERE pagina = 'exportar_dados'`)).n).toBe("0");
      await criaUsuario(c, ALVO, { papel: p1 });
      await como(c, ALVO);
      expect((await um<{ p: boolean }>(c, `SELECT public._exportar_pode() AS p`)).p).toBe(false);
      expect(await tenta(c, EXPORTA)).toMatch(/^42501 /);
    });
  });

  it("igualdade exata: 'exportar_dados_x' / 'exportar_dadosXYZ' NAO sao interceptadas pelos gatilhos", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, ADMIN, { tenantAdmin: true });
      await criaUsuario(c, ALVO);
      await como(c, ADMIN);
      for (const pg of ["exportar_dados_x", "exportar_dadosXYZ", "exportar"]) {
        const ins = await c.query(
          `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, false)`,
          [ALVO, T, pg],
        );
        expect(ins.rowCount, pg).toBe(1);
      }
    });
  });

  it("excluir um usuario que tem exportar_dados funciona (DELETE explicito como service_role pula a linha; cascata do users/auth.users leva)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await criaUsuario(c, EXCL);
      await concedePeloSuper(c, EXCL);
      await criaUsuario(c, ALVO);
      await concedePeloSuper(c, ALVO);
      await semUsuario(c);
      await c.query("SAVEPOINT s");
      await c.query("SET LOCAL ROLE service_role");
      await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [EXCL]);
      const sobrou = await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.user_permissions WHERE user_id = $1`, [EXCL]);
      await c.query(`DELETE FROM public.user_roles WHERE user_id = $1`, [EXCL]);
      await c.query(`DELETE FROM public.users WHERE id = $1`, [EXCL]);
      await c.query("RESET ROLE");
      await c.query("RELEASE SAVEPOINT s");
      expect(sobrou.n).toBe("1");
      await c.query(`DELETE FROM auth.users WHERE id = $1`, [EXCL]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.user_permissions WHERE user_id = $1`, [EXCL])).n).toBe("0");
      // cascata de auth.users com JWT de admin da loja
      await criaUsuario(c, ADMIN, { tenantAdmin: true });
      await como(c, ADMIN);
      await c.query(`DELETE FROM auth.users WHERE id = $1`, [ALVO]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.user_permissions WHERE user_id = $1`, [ALVO])).n).toBe("0");
    });
  });

  it("gatilhos presentes e ENABLE padrao; a limpeza nao deixa linha exportar_dados em papel_permissoes", async () => {
    await withTx(async (c) => {
      await viva(c);
      const r = await c.query(
        `SELECT t.tgname, t.tgrelid::regclass::text AS tab, t.tgtype FROM pg_trigger t
          WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgname IN ('trg_exportar_dados_perm_user', 'trg_exportar_dados_perm_papel')
          ORDER BY t.tgname`,
      );
      expect(r.rows.map((x) => [x.tgname, x.tab])).toEqual([
        ["trg_exportar_dados_perm_papel", "papel_permissoes"],
        ["trg_exportar_dados_perm_user", "user_permissions"],
      ]);
      // user_permissions: BEFORE (2) + ROW (1) + INSERT (4) + DELETE (8) + UPDATE (16) = 31; papel: BEFORE + ROW + INSERT + UPDATE = 23
      expect(r.rows.find((x) => x.tgname === "trg_exportar_dados_perm_user")!.tgtype).toBe(31);
      expect(r.rows.find((x) => x.tgname === "trg_exportar_dados_perm_papel")!.tgtype).toBe(23);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.papel_permissoes WHERE pagina = 'exportar_dados'`)).n).toBe("0");
    });
  });

  // ------------------------------------------------------------------ inverso
  it("o inverso devolve os 2 wrappers ao portao da Integracao (texto de ANTES) e derruba as 4 funcoes + 2 gatilhos; ida de novo (idempotente)", async () => {
    await withTx(async (c) => {
      await viva(c);
      const down = readFileSync(`${ROOT}${DOWN}`, "utf8");
      expect(down).toMatch(/_integracao_exige\(false\)/);
      await aplicarArquivo(c, DOWN);
      await c.query("SET LOCAL lock_timeout = '3s'");
      const ex = async (sig: string) => (await um<{ ok: boolean }>(c, `SELECT to_regprocedure('${sig}') IS NOT NULL AS ok`)).ok;
      for (const sig of ["public._exportar_pode()", "public._exportar_exige()", "public.fn_exportar_dados_perm_user()", "public.fn_exportar_dados_perm_papel()"]) {
        expect(await ex(sig), sig).toBe(false);
      }
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'trg_exportar_dados_perm_%'`)).n).toBe("0");
      const def = async (sig: string) => (await um<{ d: string }>(c, `SELECT pg_get_functiondef('${sig}'::regprocedure) AS d`)).d;
      expect(md5(await def(SIG_EXP))).toBe(MD5_ANTES.exp);
      expect(md5(await def(SIG_SUB))).toBe(MD5_ANTES.sub);
      expect(md5(await def(SIG_CORE))).toBe(MD5_CORE);
      // ACL dos wrappers segue (authenticated sim, anon nao)
      expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('authenticated', '${SIG_EXP}', 'EXECUTE') AS ok`)).ok).toBe(true);
      expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('anon', '${SIG_EXP}', 'EXECUTE') AS ok`)).ok).toBe(false);
      // volta: a ida reaplica limpa; e o inverso de novo e idempotente
      await aplicarArquivo(c, MIG);
      expect(md5(await def(SIG_EXP))).toBe(MD5_DEPOIS.exp);
      await aplicarArquivo(c, MIG);
      expect(md5(await def(SIG_SUB))).toBe(MD5_DEPOIS.sub);
      await aplicarArquivo(c, DOWN);
      await aplicarArquivo(c, DOWN);
      expect(md5(await def(SIG_EXP))).toBe(MD5_ANTES.exp);
    });
  });
});
