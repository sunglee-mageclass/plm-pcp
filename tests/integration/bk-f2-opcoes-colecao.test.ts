// Frente Backend F2.1 — RPC de LEITURA nova public.opcoes_colecao_modelos() (desenho itens 4a/4c). Plano:
// .superpowers/sdd/2026-10-05-backend/plan.md §6 F2.1 (+ §0 K6/K9). Migration À MÃO 20261103145000_bk_opcoes_colecao (objeto
// novo): devolve {colecoes, subcolecoes} da loja ATIVA do usuário — Coleção pela MESMA regra de _modelo_colecao_rotulo (Mod T3) e de
// rotuloColecaoDoModelo (TS). `_down` = no-op documentado; `_down_drop` = DROP FUNCTION (opcional).
// Cada caso em transação revertida (withTx) e SÓ na cópia local: migration/inversos aplicados DENTRO da txn (mig-txn/bk-helpers,
// nunca \i). Fixtures (renomear coleção, mexer em card, inativar loja) são UPDATEs dentro da txn, como postgres e SEM claims —
// tudo volta no ROLLBACK. Funciona nos 2 estados da cópia (com ou sem a RPC já aplicada de verdade).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semUsuario, USER_TESTE, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaBk, bkViva, voltaBkSePreciso } from "./bk-helpers";
import {
  BK_MIG,
  BK_DOWN,
  BK_DOWN_DROP,
  BK_MD5,
  BK_SENTINELA,
  BK_F21_DEP_ROTULO,
} from "./bk-f21-dados";
import { rotuloColecaoDoModelo } from "../../src/lib/colecao-rotulo";

const RODA = hasDb && ehBancoLocal();
const IDA = BK_MD5[BK_SENTINELA].depois;
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const QA_LOJA = "0a0d1000-0000-4000-8000-00000000a001";
const QA_COMUM = "0a0d1000-0000-4000-8000-00000000b001";
const AVE_RARA_COMUM = "174518a5-569f-4954-9010-24204b345508"; // alan.lima (sem super_admin)

type Opcoes = { colecoes: string[]; subcolecoes: string[] };
const ord = (a: Iterable<string>) => [...a].sort();

/** aplicarArquivo que devolve "PASSOU" ou "<code> <message>" (o aplicarArquivo já volta ao savepoint dele). */
async function aplica(c: Client, rel: string): Promise<string> {
  try {
    await aplicarArquivo(c, rel);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    // as migrations fazem SET LOCAL transaction_timeout (valeria para a txn INTEIRA do teste)
    await c.query("SET LOCAL transaction_timeout = 0");
    await c.query("SET LOCAL lock_timeout = '3s'");
  }
}
/** Roda `sql` num SAVEPOINT; erro volta ao savepoint e vira "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT f21");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT f21");
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT f21");
    await c.query("RELEASE SAVEPOINT f21");
    return `${er.code} ${er.message}`;
  }
}
async function md5Rpc(c: Client): Promise<string | null> {
  return (
    await um<{ m: string | null }>(
      c,
      "SELECT md5(pg_get_functiondef(to_regprocedure('public.opcoes_colecao_modelos()'))) AS m",
    )
  ).m;
}
/** RPC viva NESTA txn (a ida dentro da txn, se a cópia ainda não a tem). */
async function viva(c: Client): Promise<void> {
  await aplicaBk(c, "F21");
  expect(await bkViva(c, "F21")).toBe(true);
  expect(await md5Rpc(c)).toBe(IDA);
}
/** Claims de `uid` com a loja ativa `tenant` (users.tenant_id mudado na txn, sem claims — o ROLLBACK desfaz). */
async function como(c: Client, uid: string, tenant?: string): Promise<void> {
  await semUsuario(c);
  if (tenant) await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [tenant, uid]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}
/** Chama a RPC como o PAPEL authenticated (como o PostgREST faz), com as claims já postas. */
async function opcoes(c: Client): Promise<Opcoes> {
  await c.query("SET LOCAL ROLE authenticated");
  try {
    return (await um<{ r: Opcoes }>(c, "SELECT public.opcoes_colecao_modelos() AS r")).r;
  } finally {
    await c.query("RESET ROLE");
  }
}
/** O que a TELA monta hoje (PCP › Etapas / Comercial): select de TODOS os cards com o embed colecoes(nome), pela RLS do papel
 *  authenticated (o embed do PostgREST = subconsulta de colecoes sob a mesma RLS), e rotuloColecaoDoModelo + filter(Boolean). */
async function esperadoTela(c: Client): Promise<Opcoes> {
  await c.query("SET LOCAL ROLE authenticated");
  try {
    const { rows } = await c.query<{
      colecao: string | null;
      subcolecao: string | null;
      colecoes: unknown;
    }>(
      `SELECT m.colecao, m.subcolecao,
              (SELECT json_build_object('nome', c.nome) FROM public.colecoes c WHERE c.id = m.colecao_id) AS colecoes
         FROM public.modelos m`,
    );
    return {
      colecoes: ord(new Set(rows.map((r) => rotuloColecaoDoModelo(r)).filter(Boolean) as string[])),
      subcolecoes: ord(new Set(rows.map((r) => r.subcolecao).filter(Boolean) as string[])),
    };
  } finally {
    await c.query("RESET ROLE");
  }
}
/** Os rótulos distintos não vazios pelo helper SQL da Mod T3 (a regra única), para a loja `tenant`. */
async function esperadoHelper(c: Client, tenant: string): Promise<string[]> {
  const { rows } = await c.query<{ r: string }>(
    `SELECT DISTINCT public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) AS r
       FROM public.modelos m WHERE m.tenant_id = $1`,
    [tenant],
  );
  return ord(rows.map((x) => x.r).filter((x) => x !== null && x !== ""));
}
async function confere(c: Client, tenant: string): Promise<Opcoes> {
  const r = await opcoes(c);
  const tela = await esperadoTela(c);
  expect(ord(r.colecoes), `colecoes x tela (${tenant})`).toEqual(tela.colecoes);
  expect(ord(r.subcolecoes), `subcolecoes x tela (${tenant})`).toEqual(tela.subcolecoes);
  expect(ord(r.colecoes), `colecoes x helper (${tenant})`).toEqual(await esperadoHelper(c, tenant));
  // distintos e sem vazio
  expect(new Set(r.colecoes).size).toBe(r.colecoes.length);
  expect(new Set(r.subcolecoes).size).toBe(r.subcolecoes.length);
  expect(r.colecoes.some((x) => x.trim() === "")).toBe(false);
  expect(r.subcolecoes.includes("")).toBe(false);
  return r;
}

describe.skipIf(!RODA)("Backend F2.1 — RPC opcoes_colecao_modelos()", () => {
  it("objeto: md5 = IDA, SECURITY DEFINER + search_path=public, STABLE, jsonb; EXECUTE só authenticated/service_role", async () => {
    await withTx(async (c) => {
      await viva(c);
      const p = await um<{
        secdef: boolean;
        config: string[];
        vol: string;
        ret: string;
        anon: boolean;
        auth: boolean;
        srv: boolean;
        pub: number;
        acl: string;
      }>(
        c,
        `SELECT p.prosecdef AS secdef, p.proconfig AS config, p.provolatile AS vol, p.prorettype::regtype::text AS ret,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS srv,
                (SELECT count(*)::int FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub, p.proacl::text AS acl
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.opcoes_colecao_modelos()')`,
      );
      expect(p).toMatchObject({
        secdef: true,
        config: ["search_path=public"],
        vol: "s",
        ret: "jsonb",
        anon: false,
        auth: true,
        srv: true,
        pub: 0,
      });
      expect(p.acl).not.toMatch(/(^|[{,])=X|anon=/);
      // anon chamando de fato (papel anon, como o PostgREST sem login) = 42501
      await c.query("SET LOCAL ROLE anon");
      const r = await tenta(c, "SELECT public.opcoes_colecao_modelos()");
      await c.query("RESET ROLE");
      expect(r).toMatch(/^42501 /);
      // dependência fixada pela guarda = a regra do rótulo (Mod T3)
      expect(
        (
          await um<{ m: string }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
            BK_F21_DEP_ROTULO.sig,
          ])
        ).m,
      ).toBe(BK_F21_DEP_ROTULO.md5);
    });
  });

  it("toda loja com cards (super admin com a loja ativa): colecoes ≡ helper SQL ≡ tela (rotuloColecaoDoModelo); subcolecoes ≡ tela", async () => {
    await withTx(async (c) => {
      await viva(c);
      const { rows: lojas } = await c.query<{ id: string; n: number; rot: number }>(
        `SELECT m.tenant_id AS id, count(*)::int AS n,
                count(*) FILTER (WHERE public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) IS NOT NULL)::int AS rot
           FROM public.modelos m GROUP BY 1 ORDER BY 2 DESC`,
      );
      expect(lojas.length).toBeGreaterThan(1);
      for (const l of lojas) {
        await como(c, USER_TESTE, l.id);
        const r = await confere(c, l.id);
        if (l.rot > 0) expect(r.colecoes.length, l.id).toBeGreaterThan(0);
      }
      // usuários COMUNS (sem super_admin) da própria loja: mesma resposta
      for (const [uid, loja] of [
        [AVE_RARA_COMUM, AVE_RARA],
        [QA_COMUM, QA_LOJA],
      ] as const) {
        await como(c, uid);
        expect((await um<{ s: boolean }>(c, "SELECT public.is_super_admin() AS s")).s).toBe(false);
        expect(
          (await um<{ t: string }>(c, "SELECT public.get_user_tenant_id()::text AS t")).t,
        ).toBe(loja);
        const r = await confere(c, loja);
        expect(r.colecoes.length).toBeGreaterThan(0);
      }
    });
  });

  it("regra do rótulo (fixtures na txn): nome do OTB ganha do texto; texto com trim; branco/'' ficam fora; coleção de OUTRA loja cai no texto", async () => {
    await withTx(async (c) => {
      await viva(c);
      await semUsuario(c);
      const { rows: cards } = await c.query<{ id: string }>(
        "SELECT id FROM public.modelos WHERE tenant_id = $1 ORDER BY id LIMIT 4",
        [TENANT_TESTE],
      );
      expect(cards.length).toBe(4);
      const colLoja = await um<{ id: string; nome: string }>(
        c,
        "SELECT id, nome FROM public.colecoes WHERE tenant_id = $1 ORDER BY nome LIMIT 1",
        [TENANT_TESTE],
      );
      const colOutra = await um<{ id: string; nome: string }>(
        c,
        "SELECT id, nome FROM public.colecoes WHERE tenant_id = $1 ORDER BY nome LIMIT 1",
        [AVE_RARA],
      );
      expect(
        (
          await um<{ n: number }>(
            c,
            "SELECT count(*)::int AS n FROM public.colecoes WHERE tenant_id = $1 AND nome = $2",
            [TENANT_TESTE, colOutra.nome],
          )
        ).n,
      ).toBe(0);
      const upd = (
        id: string,
        colecao_id: string | null,
        colecao: string | null,
        sub: string | null,
      ) =>
        c.query(
          "UPDATE public.modelos SET colecao_id = $2, colecao = $3, subcolecao = $4 WHERE id = $1",
          [id, colecao_id, colecao, sub],
        );
      await upd(cards[0].id, colLoja.id, "Texto Perdedor F21", "");
      await upd(cards[1].id, null, "  Texto Livre F21  ", "Sub F21");
      await upd(cards[2].id, null, "   ", "   ");
      await upd(cards[3].id, colOutra.id, "Fallback F21", null);

      await como(c, USER_TESTE, TENANT_TESTE);
      const r = await confere(c, TENANT_TESTE);
      expect(r.colecoes).toContain(colLoja.nome);
      expect(r.colecoes).not.toContain("Texto Perdedor F21");
      expect(r.colecoes).toContain("Texto Livre F21");
      expect(r.colecoes).not.toContain("  Texto Livre F21  ");
      expect(r.colecoes).toContain("Fallback F21");
      expect(r.colecoes).not.toContain(colOutra.nome);
      expect(r.subcolecoes).toContain("Sub F21");
      expect(r.subcolecoes).not.toContain("");
      // subcoleção só de espaços: a tela de hoje (.filter(Boolean)) mantém; a RPC também (mesma regra, sem trim)
      expect(r.subcolecoes).toContain("   ");
    });
  });

  it("isolamento: só a loja ATIVA — nome exclusivo de outra loja não aparece; super admin troca de loja e vê só a nova", async () => {
    await withTx(async (c) => {
      await viva(c);
      await semUsuario(c);
      const colAve = await um<{ id: string }>(
        c,
        `SELECT c.id FROM public.colecoes c WHERE c.tenant_id = $1
            AND EXISTS (SELECT 1 FROM public.modelos m WHERE m.colecao_id = c.id AND m.tenant_id = c.tenant_id)
          ORDER BY c.nome LIMIT 1`,
        [AVE_RARA],
      );
      await c.query("UPDATE public.colecoes SET nome = 'ZZ So Ave Rara F21' WHERE id = $1", [
        colAve.id,
      ]);

      await como(c, USER_TESTE, TENANT_TESTE);
      const teste = await confere(c, TENANT_TESTE);
      expect(teste.colecoes).not.toContain("ZZ So Ave Rara F21");

      await como(c, AVE_RARA_COMUM);
      const ave = await confere(c, AVE_RARA);
      expect(ave.colecoes).toContain("ZZ So Ave Rara F21");

      await como(c, USER_TESTE, AVE_RARA);
      const superAve = await opcoes(c);
      expect(ord(superAve.colecoes)).toEqual(ord(ave.colecoes));
      expect(ord(superAve.subcolecoes)).toEqual(ord(ave.subcolecoes));
      for (const x of teste.colecoes.filter((n) => !ave.colecoes.includes(n)))
        expect(superAve.colecoes).not.toContain(x);
    });
  });

  it("loja INATIVA (usuário comum) → listas vazias; sem JWT e service_role → vazias (sentinela)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await como(c, QA_COMUM);
      const antes = await opcoes(c);
      expect(antes.colecoes.length).toBeGreaterThan(0);

      await semUsuario(c);
      await c.query("UPDATE public.tenants SET ativo = false WHERE id = $1", [QA_LOJA]);
      await como(c, QA_COMUM);
      expect(await opcoes(c)).toEqual({ colecoes: [], subcolecoes: [] });

      await semUsuario(c);
      expect((await um<{ r: Opcoes }>(c, "SELECT public.opcoes_colecao_modelos() AS r")).r).toEqual(
        {
          colecoes: [],
          subcolecoes: [],
        },
      );
      await c.query("SET LOCAL ROLE service_role");
      const srv = (await um<{ r: Opcoes }>(c, "SELECT public.opcoes_colecao_modelos() AS r")).r;
      await c.query("RESET ROLE");
      expect(srv).toEqual({ colecoes: [], subcolecoes: [] });
    });
  });

  it("volta LIFO: a RPC viva NÃO trava os _down_drop antigos (o corpo não cita auxiliares que eles varrem no prosrc) — _down_drop da Mod T3 passa", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = (
        await um<{ s: string }>(
          c,
          "SELECT prosrc AS s FROM pg_proc WHERE oid = to_regprocedure('public.opcoes_colecao_modelos()')",
        )
      ).s;
      // nomes que os _down_drop (Mod T1/T3/T4, S3a) procuram no prosrc de TODA função de public, INCLUSIVE comentários
      for (const n of [
        "_modelo_colecao_rotulo",
        "_kanban_cond_modulos",
        "_kanban_cond_na",
        "_exige_modulos",
        "_tenant_modulo_ligado",
        "_modelo_eh_reprovado",
        "_seg_exige_pagina",
      ])
        expect(s.includes(n), n).toBe(false);
      // prova direta: com a RPC viva, o _down + _down_drop da Mod T3 (que varre _modelo_colecao_rotulo) passam na txn
      await voltaBkSePreciso(c);
      expect(await aplica(c, "supabase/rollback/20261103120000_mod_kanban_colecao_down.sql")).toBe(
        "PASSOU",
      );
      expect(
        await aplica(c, "supabase/rollback/20261103120000_mod_kanban_colecao_down_drop.sql"),
      ).toBe("PASSOU");
      expect(await md5Rpc(c)).toBe(IDA);
    });
  });

  it("anti-drift de TEXTO: a expressão do rótulo na RPC = corpo de _modelo_colecao_rotulo com os parâmetros trocados pelas colunas", async () => {
    await withTx(async (c) => {
      await viva(c);
      const src = async (sig: string) =>
        (
          await um<{ s: string }>(
            c,
            "SELECT prosrc AS s FROM pg_proc WHERE oid = to_regprocedure($1)",
            [sig],
          )
        ).s;
      const norm = (s: string) =>
        s
          .replace(/--[^\n]*/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const helper = norm(await src(BK_F21_DEP_ROTULO.sig))
        .replace(/^SELECT /i, "")
        .replace(/\b_colecao_id\b/g, "m.colecao_id")
        .replace(/\b_tenant\b/g, "m.tenant_id")
        .replace(/\b_colecao\b/g, "m.colecao");
      expect(helper).toMatch(
        /^coalesce\(\(SELECT c\.nome::text FROM public\.colecoes c WHERE c\.id = m\.colecao_id/,
      );
      const rpc = norm(await src(BK_SENTINELA));
      expect(rpc).toContain(`SELECT ${helper} AS col`);
      expect(rpc).toContain("WHERE m.tenant_id = public.get_user_tenant_id()");
    });
  });

  it("migration: ida 2× (idempotente) / _down 2× (no-op, a RPC fica) / _down_drop recusa se outra função cita / _down_drop 2× / ida de novo", async () => {
    await withTx(async (c) => {
      await viva(c);
      expect(await aplica(c, BK_MIG)).toBe("PASSOU");
      expect(await aplica(c, BK_MIG)).toBe("PASSOU");
      expect(await md5Rpc(c)).toBe(IDA);
      expect(await aplica(c, BK_DOWN)).toBe("PASSOU");
      expect(await aplica(c, BK_DOWN)).toBe("PASSOU");
      expect(await md5Rpc(c)).toBe(IDA);

      await c.query(
        "CREATE FUNCTION public.zz_f21_cita() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT public.opcoes_colecao_modelos() $f$",
      );
      expect(await aplica(c, BK_DOWN_DROP)).toMatch(
        /^P0001 bk_f21_drop: funcoes ainda citam opcoes_colecao_modelos: (public\.)?zz_f21_cita\(\)/,
      );
      expect(await md5Rpc(c)).toBe(IDA);
      await c.query("DROP FUNCTION public.zz_f21_cita()");

      expect(await aplica(c, BK_DOWN_DROP)).toBe("PASSOU");
      expect(await md5Rpc(c)).toBeNull();
      expect(await bkViva(c, "F21")).toBe(false);
      expect(await aplica(c, BK_DOWN_DROP)).toBe("PASSOU"); // já removida = nada a fazer
      expect(await aplica(c, BK_DOWN)).toBe("PASSOU"); // ausente = nada a conferir

      expect(await aplica(c, BK_MIG)).toBe("PASSOU");
      expect(await md5Rpc(c)).toBe(IDA);
      const g = await um<{ anon: boolean; auth: boolean }>(
        c,
        `SELECT has_function_privilege('anon', 'public.opcoes_colecao_modelos()', 'EXECUTE') AS anon,
                has_function_privilege('authenticated', 'public.opcoes_colecao_modelos()', 'EXECUTE') AS auth`,
      );
      expect(g).toEqual({ anon: false, auth: true });
    });
  });

  it("guarda: RPC com outro texto → ida, _down e _down_drop recusam (P0001); sobrecarga com argumentos e helper do rótulo mudado → ida recusa", async () => {
    await withTx(async (c) => {
      await viva(c);
      await c.query(
        "CREATE OR REPLACE FUNCTION public.opcoes_colecao_modelos() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT '{}'::jsonb $f$",
      );
      const outro = await md5Rpc(c);
      expect(outro).not.toBe(IDA);
      expect(await aplica(c, BK_MIG)).toMatch(/^P0001 bk_f21_diferente: /);
      expect(await aplica(c, BK_DOWN)).toMatch(/^P0001 bk_f21_down: /);
      expect(await aplica(c, BK_DOWN_DROP)).toMatch(/^P0001 bk_f21_drop: .*outro texto/);
      expect(await md5Rpc(c)).toBe(outro);
      await c.query("DROP FUNCTION public.opcoes_colecao_modelos()");

      await c.query(
        "CREATE FUNCTION public.opcoes_colecao_modelos(_x int) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$",
      );
      expect(await aplica(c, BK_MIG)).toMatch(/^P0001 bk_f21_sobrecarga: 1 /);
      await c.query("DROP FUNCTION public.opcoes_colecao_modelos(int)");

      // a regra do rótulo mudou (outro texto no helper) → a ida recusa: a cópia da regra na RPC teria de ser gerada de novo
      await c.query(`CREATE OR REPLACE FUNCTION public._modelo_colecao_rotulo(_tenant uuid, _colecao_id uuid, _colecao text)
        RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
        AS $f$ SELECT nullif(btrim(coalesce(_colecao, '')), '') $f$`);
      expect(await aplica(c, BK_MIG)).toMatch(/^P0001 bk_f21_dep: _modelo_colecao_rotulo md5 /);
      expect(await md5Rpc(c)).toBeNull();
    });
  });

  it("trava da ida: só catálogo + AccessShare em tabela (nada além de AccessShareLock em public; nada em auth/storage/realtime)", async () => {
    await withTx(async (c) => {
      await viva(c);
      expect(await aplica(c, BK_DOWN_DROP)).toBe("PASSOU"); // ida de verdade (cria a função) dentro da txn
      const locks = async () =>
        (
          await c.query<{ k: string }>(
            `SELECT n.nspname || '.' || cl.relname || ':' || l.mode AS k
               FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
              WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname <> 'pg_catalog'
                AND n.nspname NOT LIKE 'pg_toast%'`,
          )
        ).rows.map((r) => r.k);
      const antes = new Set(await locks());
      expect(await aplica(c, BK_MIG)).toBe("PASSOU");
      const depois = await locks();
      const novos = depois.filter((k) => !antes.has(k));
      expect(
        novos.filter((k) => !k.endsWith(":AccessShareLock")),
        novos.join(", "),
      ).toEqual([]);
      // a medição enxerga a validação do corpo SQL (AccessShare nas 2 tabelas lidas), na ida ou já antes nesta txn
      expect(depois).toEqual(
        expect.arrayContaining([
          "public.modelos:AccessShareLock",
          "public.colecoes:AccessShareLock",
        ]),
      );
      expect(novos.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      expect(await md5Rpc(c)).toBe(IDA);
    });
  });

  it("desempenho (registro): RPC na maior loja (usuário comum), mediana de 15 chamadas", async () => {
    await withTx(async (c) => {
      await viva(c);
      await como(c, AVE_RARA_COMUM);
      await c.query("SET LOCAL ROLE authenticated");
      const ms: number[] = [];
      for (let i = 0; i < 16; i++) {
        const t0 = performance.now();
        await c.query("SELECT public.opcoes_colecao_modelos()");
        if (i > 0) ms.push(performance.now() - t0);
      }
      await c.query("RESET ROLE");
      ms.sort((a, b) => a - b);
      const med = ms[Math.floor(ms.length / 2)];
      const n = (
        await um<{ n: number }>(
          c,
          "SELECT count(*)::int AS n FROM public.modelos WHERE tenant_id = $1",
          [AVE_RARA],
        )
      ).n;
      console.log(
        `[F2.1 desempenho] opcoes_colecao_modelos() Ave Rara (${n} cards): mediana ${med.toFixed(1)} ms (ida e volta)`,
      );
      expect(med).toBeLessThan(500);
    });
  });
});
