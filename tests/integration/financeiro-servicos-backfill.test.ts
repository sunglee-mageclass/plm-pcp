/**
 * F5c (P-112 A) — backfill SÓ DE DADOS da chave `financeiro_servicos`
 * (supabase/migrations/20261009100000_financeiro_servicos_backfill.sql + inverso em supabase/rollback/).
 * Regra (review I-3): ver = OR ver(calendario, parcelas, resumo); editar = OR editar(parcelas, calendario) — Resumo NÃO escala.
 * Papel: das próprias linhas. Usuário: do EFETIVO (usuário senão papel), linha só onde difere do papel já backfillado.
 * Tudo em BEGIN…ROLLBACK (withTx) e SÓ na cópia local (aplicarArquivo → exigeBancoLocal): a migration cria a tabela de registro
 * (DDL) e o arquivo é aplicado SEM o BEGIN/COMMIT dele (mig-txn.ts) — nunca `\i`.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, um, ehBancoLocal } from "./db";
import { aplicarArquivo } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const MIG = "supabase/migrations/20261009100000_financeiro_servicos_backfill.sql";
const INV = "supabase/rollback/20261009100000_financeiro_servicos_backfill_down.sql";
// prévia do kit de produção (gitignored — o teste dela só roda onde o kit existe)
const PREVIA = ".superpowers/f5/mig/preview-financeiro-servicos.sql";
const T = "37889b78-fffb-404b-8c75-18b7e50a1d9b"; // Loja Teste

// papéis
const PA = "f5c00000-0000-4000-8000-00000000a0a0"; // parcelas ver+editar, resumo ver
const PR = "f5c00000-0000-4000-8000-00000000a0b0"; // SÓ resumo ver+editar
const PX = "f5c00000-0000-4000-8000-00000000a0c0"; // já tem financeiro_servicos (t,f) + parcelas (t,t)
const PN = "f5c00000-0000-4000-8000-00000000a0d0"; // sem financeiro
// usuários
const U1 = "f5c00000-0000-4000-8000-0000000000b1"; // papel PA, sem exceção
const U2 = "f5c00000-0000-4000-8000-0000000000b2"; // papel PA, exceção parcelas (f,f) — rebaixa
const U3 = "f5c00000-0000-4000-8000-0000000000b3"; // papel PA, exceção calendario (t,f) — soma (caso do review)
const U4 = "f5c00000-0000-4000-8000-0000000000b4"; // sem papel, parcelas (t,f) + calendario (t,t)
const U5 = "f5c00000-0000-4000-8000-0000000000b5"; // sem papel, SÓ resumo (t,t)
const U6 = "f5c00000-0000-4000-8000-0000000000b6"; // sem papel, já tem financeiro_servicos (t,f) + parcelas (t,t)
const U7 = "f5c00000-0000-4000-8000-0000000000b7"; // papel PA, exceções parcelas (f,f) + resumo (f,f) — tudo negado
const U8 = "f5c00000-0000-4000-8000-0000000000b8"; // papel PR (resumo editor), exceção parcelas (t,t)
const U9 = "f5c00000-0000-4000-8000-0000000000b9"; // sem papel, sem financeiro
const UX = "f5c00000-0000-4000-8000-0000000000ba"; // papel PX, sem exceção (herda a linha deliberada do papel)

const TODOS_U = [U1, U2, U3, U4, U5, U6, U7, U8, U9, UX];
const TODOS_P = [PA, PR, PX, PN];

async function papel(c: Client, id: string, perms: [string, boolean, boolean][]): Promise<void> {
  await c.query(`INSERT INTO public.papeis (id, tenant_id, nome) VALUES ($1, $2, $3)`, [id, T, `F5c teste ${id.slice(-4)}`]);
  for (const [pagina, v, e] of perms) {
    await c.query(
      `INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)`,
      [id, T, pagina, v, e],
    );
  }
}
async function usuario(c: Client, id: string, papelId: string | null, perms: [string, boolean, boolean][]): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, `${id}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, papel_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, papel_id = excluded.papel_id`,
    [id, T, `${id}@teste`, `F5c teste ${id.slice(-2)}`, papelId],
  );
  for (const [pagina, v, e] of perms) {
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)`,
      [id, T, pagina, v, e],
    );
  }
}
async function semeia(c: Client): Promise<void> {
  await papel(c, PA, [["financeiro_parcelas", true, true], ["financeiro_resumo", true, false]]);
  await papel(c, PR, [["financeiro_resumo", true, true]]);
  await papel(c, PX, [["financeiro_servicos", true, false], ["financeiro_parcelas", true, true]]);
  await papel(c, PN, [["modelos", true, true]]);
  await usuario(c, U1, PA, []);
  await usuario(c, U2, PA, [["financeiro_parcelas", false, false]]);
  await usuario(c, U3, PA, [["financeiro_calendario", true, false]]);
  await usuario(c, U4, null, [["financeiro_parcelas", true, false], ["financeiro_calendario", true, true]]);
  await usuario(c, U5, null, [["financeiro_resumo", true, true]]);
  await usuario(c, U6, null, [["financeiro_servicos", true, false], ["financeiro_parcelas", true, true]]);
  await usuario(c, U7, PA, [["financeiro_parcelas", false, false], ["financeiro_resumo", false, false]]);
  await usuario(c, U8, PR, [["financeiro_parcelas", true, true]]);
  await usuario(c, U9, null, [["modelos", true, false]]);
  await usuario(c, UX, PX, []);
}

/** Linha financeiro_servicos crua (null = sem linha). */
async function linhaU(c: Client, uid: string): Promise<[boolean, boolean] | null> {
  const r = await c.query(
    `SELECT pode_ver, pode_editar FROM public.user_permissions WHERE user_id = $1 AND pagina = 'financeiro_servicos'`, [uid]);
  return r.rows[0] ? [r.rows[0].pode_ver, r.rows[0].pode_editar] : null;
}
async function linhaP(c: Client, pid: string): Promise<[boolean, boolean] | null> {
  const r = await c.query(
    `SELECT pode_ver, pode_editar FROM public.papel_permissoes WHERE papel_id = $1 AND pagina = 'financeiro_servicos'`, [pid]);
  return r.rows[0] ? [r.rows[0].pode_ver, r.rows[0].pode_editar] : null;
}
/** Efetivo (o que o front recebe via minhas_permissoes_efetivas) p/ financeiro_servicos. */
async function efetivo(c: Client, uid: string): Promise<[boolean, boolean]> {
  const r = await c.query(
    `SELECT pode_ver, pode_editar FROM public._perm_efetiva($1) WHERE pagina = 'financeiro_servicos'`, [uid]);
  return r.rows[0] ? [r.rows[0].pode_ver, r.rows[0].pode_editar] : [false, false];
}
/** md5 do conteúdo ordenado das 2 tabelas (byte a byte). */
async function retrato(c: Client): Promise<string> {
  return (
    await um<{ h: string }>(
      c,
      `SELECT md5(
         (SELECT coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', id, user_id, tenant_id, pagina, pode_ver, pode_editar, created_at), E'\\n' ORDER BY id), '')
            FROM public.user_permissions)
         || '#' ||
         (SELECT coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', id, papel_id, tenant_id, pagina, pode_ver, pode_editar, created_at), E'\\n' ORDER BY id), '')
            FROM public.papel_permissoes)
       ) AS h`,
    )
  ).h;
}
async function contaServicos(c: Client): Promise<{ p: number; u: number }> {
  return um(
    c,
    `SELECT (SELECT count(*)::int FROM public.papel_permissoes WHERE pagina = 'financeiro_servicos') AS p,
            (SELECT count(*)::int FROM public.user_permissions WHERE pagina = 'financeiro_servicos') AS u`,
  );
}
async function temRegistro(c: Client): Promise<boolean> {
  return (await um<{ t: boolean }>(c, `SELECT to_regclass('public._bkp_financeiro_servicos_backfill') IS NOT NULL AS t`)).t;
}

describe.skipIf(!hasDb || !ehBancoLocal())("financeiro_servicos — backfill de permissão (F5c)", () => {
  it("papéis e usuários recebem exatamente o acesso de hoje; ninguém perde, ninguém ganha edição", async () => {
    await withTx(async (c) => {
      await semeia(c);
      await aplicarArquivo(c, MIG);

      // papéis
      expect(await linhaP(c, PA)).toEqual([true, true]); // parcelas editar → servicos ver+editar
      expect(await linhaP(c, PR)).toEqual([true, false]); // Resumo-only editor NÃO escala p/ editar
      expect(await linhaP(c, PX)).toEqual([true, false]); // linha que já existia: intocada
      expect(await linhaP(c, PN)).toBeNull(); // sem financeiro: nada

      // usuários (linha crua)
      expect(await linhaU(c, U1)).toBeNull(); // papel sem exceção → herda, sem linha
      expect(await linhaU(c, U2)).toEqual([true, false]); // rebaixou parcelas → efetivo (resumo ver) ≠ papel
      expect(await linhaU(c, U3)).toBeNull(); // exceção só soma VER → efetivo = papel (t,t) → sem linha (não rebaixa)
      expect(await linhaU(c, U4)).toEqual([true, true]); // sem papel → das próprias linhas
      expect(await linhaU(c, U5)).toEqual([true, false]); // Resumo-only editor sem papel → ver, sem editar
      expect(await linhaU(c, U6)).toEqual([true, false]); // já existia: intocada
      expect(await linhaU(c, U7)).toEqual([false, false]); // tudo negado → exceção NEGATIVA explícita
      expect(await linhaU(c, U8)).toEqual([true, true]); // papel Resumo (t,f) + exceção parcelas editar → (t,t)
      expect(await linhaU(c, U9)).toBeNull();
      expect(await linhaU(c, UX)).toBeNull(); // papel com linha deliberada, sem exceção → herda

      // efetivo
      const esperado: Record<string, [boolean, boolean]> = {
        [U1]: [true, true], [U2]: [true, false], [U3]: [true, true], [U4]: [true, true], [U5]: [true, false],
        [U6]: [true, false], [U7]: [false, false], [U8]: [true, true], [U9]: [false, false], [UX]: [true, false],
      };
      for (const uid of TODOS_U) expect([uid, await efetivo(c, uid)]).toEqual([uid, esperado[uid]]);

      // registro = exatamente as linhas inseridas (dos nossos: 2 papéis + 5 usuários)
      const reg = await c.query(
        `SELECT tabela, dono_id FROM public._bkp_financeiro_servicos_backfill WHERE dono_id = ANY($1::uuid[]) ORDER BY 1, 2`,
        [[...TODOS_U, ...TODOS_P]],
      );
      expect(reg.rows).toEqual(
        [
          ...[PA, PR].sort().map((d) => ({ tabela: "papel_permissoes", dono_id: d })),
          ...[U2, U4, U5, U7, U8].sort().map((d) => ({ tabela: "user_permissions", dono_id: d })),
        ],
      );
      // tabela de registro: RLS ligada, sem policy, sem grant p/ anon/authenticated
      const acl = await um<{ rls: boolean; pol: number; anon: boolean; auth: boolean }>(
        c,
        `SELECT c.relrowsecurity AS rls,
                (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS pol,
                has_table_privilege('anon', c.oid, 'SELECT') AS anon,
                has_table_privilege('authenticated', c.oid, 'SELECT') AS auth
           FROM pg_class c WHERE c.oid = 'public._bkp_financeiro_servicos_backfill'::regclass`,
      );
      expect(acl).toEqual({ rls: true, pol: 0, anon: false, auth: false });
    });
  });

  it("rodar 2× = nada muda; inverso volta as 2 tabelas byte a byte e tira a tabela de registro", async () => {
    await withTx(async (c) => {
      await semeia(c);
      const antes = await retrato(c);
      await aplicarArquivo(c, MIG);
      const depois1 = await retrato(c);
      expect(depois1).not.toBe(antes);
      const nReg1 = (await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public._bkp_financeiro_servicos_backfill`)).n;
      await aplicarArquivo(c, MIG);
      expect(await retrato(c)).toBe(depois1);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public._bkp_financeiro_servicos_backfill`)).n).toBe(nReg1);
      await aplicarArquivo(c, INV);
      expect(await retrato(c)).toBe(antes);
      expect(await temRegistro(c)).toBe(false);
      // inverso 2× (sem registro) = não faz nada
      await aplicarArquivo(c, INV);
      expect(await retrato(c)).toBe(antes);
    });
  });

  it("inverso NÃO apaga linha regravada por admin depois do backfill (id novo)", async () => {
    await withTx(async (c) => {
      await semeia(c);
      await aplicarArquivo(c, MIG);
      // admin "salva" U4 no front novo: delete + insert (id novo) — mesmo formato do set_user_permissions
      await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'financeiro_servicos'`, [U4]);
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'financeiro_servicos', true, false)`,
        [U4, T],
      );
      await aplicarArquivo(c, INV);
      expect(await linhaU(c, U4)).toEqual([true, false]); // decisão do admin fica
      expect(await linhaU(c, U2)).toBeNull(); // a do backfill sai
      expect(await linhaP(c, PA)).toBeNull();
      expect(await linhaP(c, PX)).toEqual([true, false]); // pré-existente fica
      expect(await linhaU(c, U6)).toEqual([true, false]);
    });
  });

  it.skipIf(!existsSync(ROOT + PREVIA))("prévia só-leitura (.superpowers/f5/mig) conta exatamente o que a migration insere", async () => {
    await withTx(async (c) => {
      await semeia(c);
      const previa = (await c.query(readFileSync(ROOT + PREVIA, "utf8"))).rows;
      const total = previa.find((r: any) => r.loja === "TOTAL");
      const antes = await contaServicos(c);
      await aplicarArquivo(c, MIG);
      const depois = await contaServicos(c);
      expect({ p: Number(total.papeis), u: Number(total.usuarios) }).toEqual({ p: depois.p - antes.p, u: depois.u - antes.u });
      const loja = previa.find((r: any) => r.loja === T);
      expect({ p: Number(loja.papeis), u: Number(loja.usuarios), neg: Number(loja.usuarios_negativos) }).toEqual({ p: 2, u: 5, neg: 1 });
    });
  });
});
