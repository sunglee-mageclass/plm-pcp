// Frente Backend B1 — "Lançado só pelo botão" (desenho item 1). Plano: .superpowers/sdd/2026-10-05-backend/plan.md §2 B1 (+ §0 K1).
// Migration GERADA 20261103140000_bk_lancado_protegido (gerar-bk1.mjs): fn_seg_pagina_modelos (gatilho trg_aaa_seg_pagina, INVOKER,
// só morde authenticated/anon) recusa INSERT com lancado = true e UPDATE que muda lancado (42501 `lancado_protegido:`). Cada caso em
// transação revertida (withTx) e SÓ na cópia local: a migration é aplicada DENTRO da txn (bk-helpers/mig-txn, nunca \i). Escrita
// direta e RPCs rodam como o PAPEL do PostgREST (SET LOCAL ROLE authenticated) com JWT de usuário COMUM criado na txn; fixtures
// semeadas como postgres, sem JWT. Módulos ligados SEM claims (MOD-1).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaBk, bkViva, voltaBk } from "./bk-helpers";
import { aplicaMod, md5ModSucessor, voltaModSePreciso } from "./mod-helpers";
import {
  BK_MD5,
  BK_MIG,
  BK_DOWN,
  BK_SENTINELA,
  BK1_ACL,
  BK1_DEPS,
  BK1_GATILHO,
} from "./bk-1-dados";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_COMUM = "0b1e1000-0000-4000-8000-0000000000c1"; // Planejamento + Desenvolvimento (ver+editar)
const U_PROD = "0b1e1000-0000-4000-8000-0000000000c2"; // CQ + PCP Serviços + Explosão (ver+editar)
const FN = BK_SENTINELA; // public.fn_seg_pagina_modelos()
const DATA = "2026-10-10";
const PROTEGIDO = "42501 lancado_protegido: use o botao Lancar do card";

type Linha = Record<string, unknown>;
type Res = { ok: true; rows: Linha[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint (a txn segue usável). */
async function como(
  c: Client,
  role: "authenticated" | "anon" | "service_role" | null,
  sql: string,
  params: unknown[] = [],
): Promise<Res> {
  await c.query("SAVEPOINT bk1");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT bk1");
    return { ok: true, rows: r.rows };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT bk1");
    await c.query("RELEASE SAVEPOINT bk1");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);

async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}
/** Usuário COMUM (role user) da loja de teste com só as páginas dadas (ver+editar). */
async function usuarioComum(c: Client, uid: string, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [uid, `${uid}@teste`],
    );
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'BK1 comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, T, `${uid}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [uid, T, paginas],
    );
  });
}
async function modulos(c: Client, mods: Record<string, boolean>): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`,
      [T, JSON.stringify(mods)],
    ),
  );
}
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  // a cadeia LIFO dos ganchos S*_TXN tira a Modularidade (e o Backend) antes de reaplicar a S3a..S4: devolve o estado da cópia
  // (Mod T2 = Lançar sem Produção) antes da B1. Idempotente: na cópia tudo já está vivo e nada roda.
  await aplicaMod(c);
  await aplicaBk(c, "B1"); // idempotente (cópia já com a B1, ou BK_TXN=1: pula)
  expect(await bkViva(c, "B1")).toBe(true);
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuarioComum(c, U_COMUM, ["criacao_planejamento", "criacao_desenvolvimento"]);
  await usuarioComum(c, U_PROD, ["producao_cq", "producao_terceirizados", "producao_explosao"]);
  await modulos(c, { criacao: true, producao: true, entrada_saida: true });
}

/** Card de teste (como postgres, sem JWT — manutenção passa). Opções: já lançado; CAD com CQ. */
async function card(
  c: Client,
  o: { lancado?: boolean; cq?: "pendente" | "confirmado"; nome?: string } = {},
): Promise<{ id: string; cad: string | null }> {
  return semJwt(c, async () => {
    const id = (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, versao, status_planejamento, lancado, data_lancamento)
         VALUES ($1, $2, 1, 'em_planejamento', $3, $4) RETURNING id`,
        [T, o.nome ?? "BK1 card", !!o.lancado, o.lancado ? DATA : null],
      )
    ).id;
    let cad: string | null = null;
    if (o.cq) {
      cad = (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.cad (tenant_id, modelo_id) VALUES ($1, $2) RETURNING id`,
          [T, id],
        )
      ).id;
      await c.query(
        `INSERT INTO public.controle_qualidade (tenant_id, cad_id, status) VALUES ($1, $2, $3)`,
        [T, cad, o.cq],
      );
    }
    return { id, cad };
  });
}
const lancado = async (c: Client, id: string): Promise<boolean> =>
  (await um<{ l: boolean }>(c, `SELECT lancado AS l FROM public.modelos WHERE id = $1`, [id])).l;

describe.skipIf(!RODA)("bk B1 — modelos.lancado só muda pelo servidor (lancado_protegido)", () => {
  it("escrita DIRETA do cliente (authenticated, comum com Planejamento+Desenvolvimento): mudar lancado/criar lançado = 42501; o resto passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await card(c); // lancado = false
      const l = await card(c, { lancado: true });
      await jwt(c, U_COMUM);
      const upd = (sql: string, id: string) => como(c, "authenticated", sql, [id]);
      expect(txt(await upd(`UPDATE public.modelos SET lancado = true WHERE id = $1`, a.id))).toBe(
        PROTEGIDO,
      );
      expect(txt(await upd(`UPDATE public.modelos SET lancado = NULL WHERE id = $1`, a.id))).toBe(
        PROTEGIDO,
      );
      expect(
        txt(
          await upd(
            `UPDATE public.modelos SET lancado = false, data_lancamento = NULL WHERE id = $1`,
            l.id,
          ),
        ),
      ).toBe(PROTEGIDO);
      expect(await lancado(c, a.id)).toBe(false);
      expect(await lancado(c, l.id)).toBe(true);
      // outra coluna, com lancado IGUAL (inclusive repetindo o valor no payload, como um PATCH da linha inteira) → passa
      expect(
        txt(await upd(`UPDATE public.modelos SET nome = 'BK1 renomeado' WHERE id = $1`, a.id)),
      ).toBe("PASSOU");
      expect(
        txt(
          await upd(
            `UPDATE public.modelos SET nome = 'BK1 x', lancado = false WHERE id = $1`,
            a.id,
          ),
        ),
      ).toBe("PASSOU");
      expect(
        txt(
          await upd(`UPDATE public.modelos SET nome = 'BK1 y', lancado = true WHERE id = $1`, l.id),
        ),
      ).toBe("PASSOU");
      // K1: a GUC da Explosão NÃO é porta para mudar lancado (a checagem vem antes do atalho)
      await c.query("SELECT set_config('app.explosao_sistema', 'on', true)");
      expect(txt(await upd(`UPDATE public.modelos SET lancado = true WHERE id = $1`, a.id))).toBe(
        PROTEGIDO,
      );
      await c.query("SELECT set_config('app.explosao_sistema', '', true)");
      // INSERT: card já lançado = 42501; sem a chave (default false) ou false explícito → passa (Planejamento cria)
      const ins = (cols: string, vals: string) =>
        como(
          c,
          "authenticated",
          `INSERT INTO public.modelos (tenant_id, nome${cols}) VALUES ($1, 'BK1 novo'${vals}) RETURNING lancado`,
          [T],
        );
      expect(txt(await ins(", lancado", ", true"))).toBe(PROTEGIDO);
      const semChave = await ins("", "");
      expect(txt(semChave)).toBe("PASSOU");
      expect(semChave.ok && semChave.rows[0].lancado).toBe(false);
      expect(txt(await ins(", lancado", ", false"))).toBe("PASSOU");
      // anon não grava modelos de jeito nenhum (S5: sem privilégio de tabela) — o gatilho nem chega a rodar
      await jwt(c, null);
      const anon = await como(c, "anon", `UPDATE public.modelos SET lancado = true WHERE id = $1`, [
        a.id,
      ]);
      expect(anon.ok).toBe(false);
      expect(anon.ok ? "" : anon.code).toBe("42501"); // sem privilégio de tabela (não um erro qualquer)
      expect(await lancado(c, a.id)).toBe(false);
    });
  });

  it("caminhos do SERVIDOR seguem mudando lancado: lancar_modelo (com e sem Produção), desmarcar_cq, reverter_corte_tecido, voltar_cq_para_servico", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const rpc = async (uid: string, sql: string, params: unknown[]) => {
        await jwt(c, uid);
        return txt(await como(c, "authenticated", sql, params));
      };
      const lancar = (id: string, data: string | null, send: boolean) =>
        rpc(U_COMUM, `SELECT public.lancar_modelo($1, $2::date, $3)`, [id, data, send]);
      // Produção ligada: CQ liberado + M.O. (sem linha = liberada) + data → lança; _send=false desfaz
      const a = await card(c, { cq: "confirmado" });
      expect(await lancar(a.id, DATA, true)).toBe("PASSOU");
      expect(await lancado(c, a.id)).toBe(true);
      expect(await lancar(a.id, null, false)).toBe("PASSOU");
      expect(await lancado(c, a.id)).toBe(false);
      // loja sem Produção (molde mod-2-regras): M.O. liberada + data → lança sem CQ
      await modulos(c, { producao: false });
      const b = await card(c);
      expect(await lancar(b.id, DATA, true)).toBe("PASSOU");
      expect(await lancado(c, b.id)).toBe(true);
      expect(await lancar(b.id, null, false)).toBe("PASSOU");
      expect(await lancado(c, b.id)).toBe(false);
      await modulos(c, { producao: true });
      // desmarcar o CQ de um card lançado → trg_rebaixa_lancado_cq (DEFINER) rebaixa
      const d = await card(c, { lancado: true, cq: "confirmado" });
      expect(await rpc(U_PROD, `SELECT public.desmarcar_cq($1)`, [d.cad])).toBe("PASSOU");
      expect(await lancado(c, d.id)).toBe(false);
      // reverter o corte de um card lançado
      const r = await card(c, { lancado: true, cq: "confirmado" });
      expect(await rpc(U_PROD, `SELECT public.reverter_corte_tecido($1)`, [r.cad])).toBe("PASSOU");
      expect(await lancado(c, r.id)).toBe(false);
      // voltar o CQ ao serviço num card lançado
      const v = await card(c, { lancado: true, cq: "confirmado" });
      expect(await rpc(U_PROD, `SELECT public.voltar_cq_para_servico($1)`, [v.cad])).toBe("PASSOU");
      expect(await lancado(c, v.id)).toBe(false);
    });
  });

  it("manutenção: sem claims (postgres) e service_role mudam lancado direto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await card(c);
      await jwt(c, null);
      expect(
        txt(await como(c, null, `UPDATE public.modelos SET lancado = true WHERE id = $1`, [a.id])),
      ).toBe("PASSOU");
      expect(await lancado(c, a.id)).toBe(true);
      expect(
        txt(
          await como(c, "service_role", `UPDATE public.modelos SET lancado = false WHERE id = $1`, [
            a.id,
          ]),
        ),
      ).toBe("PASSOU");
      expect(await lancado(c, a.id)).toBe(false);
      // super admin pela API também é cliente: recusa igual (o botão Lançar é o caminho)
      await jwt(c, SUPER);
      expect(
        txt(
          await como(c, "authenticated", `UPDATE public.modelos SET lancado = true WHERE id = $1`, [
            a.id,
          ]),
        ),
      ).toBe(PROTEGIDO);
    });
  });

  it("anti-drift: toda função/procedure de public que grava modelos.lancado é SECURITY DEFINER (INVOKER nova seria barrada pela B1)", async () => {
    await withTx(async (c) => {
      // Mesma consulta da pré-checagem do gerador (mig/gerar-bk1.mjs, ESCRITORAS_SQL) — fix round 1 (review M1). Pega:
      //   UPDATE … modelos … lancado =    |  UPDATE … modelos … SET (…, lancado, …) =
      //   INSERT INTO modelos (… lancado …)  |  INSERT INTO modelos SELECT/VALUES/WITH/TABLE… SEM lista de colunas
      //   função de gatilho de modelos que atribui NEW.lancado (:= ou =; comparação também casa — falso positivo conservador)
      //   funções (prokind f) E procedures (p).
      const Q = `SELECT p.oid::regprocedure::text AS f, p.prosecdef AS sd FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
                    AND (p.prosrc ~* 'update[^;]*\\ymodelos\\y[^;]*\\ylancado\\y\\s*='
                         OR p.prosrc ~* 'update[^;]*\\ymodelos\\y[^;]*\\yset\\s*\\([^)]*\\ylancado\\y'
                         OR p.prosrc ~* 'insert\\s+into\\s+(public\\.)?modelos\\s*\\([^)]*\\ylancado\\y'
                         OR p.prosrc ~* 'insert\\s+into\\s+(public\\.)?modelos\\s+(as\\s+\\w+\\s+)?(select|values|with|table|default|overriding)\\y'
                         OR ((p.oid IN (SELECT t.tgfoid FROM pg_trigger t WHERE t.tgrelid = 'public.modelos'::regclass AND NOT t.tgisinternal)
                              OR p.proname = ANY($1::text[]))
                             AND p.prosrc ~* 'new\\.lancado\\s*:?='))
                  ORDER BY 1`;
      // $1 = funções tratadas COMO SE fossem gatilho de modelos (só o controle negativo usa; sem CREATE TRIGGER no teste — não
      // pegar trava de gatilho em modelos/auth). Em uso real: [].
      const escritoras = (await c.query(Q, [[]])).rows as { f: string; sd: boolean }[];
      // os 4 escritores do desenho (UPDATE) + o Replicar do Plan. Tecido (INSERT com lancado = false) — todos DEFINER
      expect(escritoras.map((r) => r.f)).toEqual(
        expect.arrayContaining([
          "lancar_modelo(uuid,date,boolean)",
          "fn_rebaixa_lancado_cq()",
          "_reverter_corte_tecido_core(uuid)",
          "_voltar_cq_para_servico_core(uuid)",
          "_replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)",
        ]),
      );
      expect(escritoras.filter((r) => !r.sd)).toEqual([]);
      // SQL dinâmico (EXECUTE) não é analisável por regex: toda função/procedure INVOKER de public que usa EXECUTE e cita
      // modelos fica numa lista de REVISÃO MANUAL. Hoje vazia; se aparecer uma, revise se grava lancado (se gravar, tem de ser
      // DEFINER) e só então acrescente-a aqui com o motivo.
      const dinamicasRevisadas: string[] = [];
      const dinamicas = (
        await c.query(
          `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p') AND NOT p.prosecdef
              AND p.prosrc ~* '\\yexecute\\y' AND p.prosrc ~* '\\ymodelos\\y' ORDER BY 1`,
        )
      ).rows.map((r: { f: string }) => r.f);
      expect(dinamicas).toEqual(dinamicasRevisadas);
      // controles negativos (criados e revertidos na txn — só na cópia local): cada forma é pega como INVOKER
      const sondas = [
        `CREATE FUNCTION public._bk1_sonda_upd(_id uuid) RETURNS void LANGUAGE sql
           AS $f$ UPDATE public.modelos SET lancado = true WHERE id = _id $f$`,
        `CREATE FUNCTION public._bk1_sonda_tupla(_id uuid) RETURNS void LANGUAGE sql
           AS $f$ UPDATE public.modelos SET (lancado, data_lancamento) = (true, now()::date) WHERE id = _id $f$`,
        `CREATE FUNCTION public._bk1_sonda_ins_sel(_id uuid) RETURNS void LANGUAGE sql
           AS $f$ INSERT INTO public.modelos SELECT * FROM public.modelos WHERE id = _id $f$`,
        `CREATE PROCEDURE public._bk1_sonda_proc(_id uuid) LANGUAGE sql
           AS $f$ UPDATE public.modelos SET lancado = true WHERE id = _id $f$`,
        `CREATE FUNCTION public._bk1_sonda_trg() RETURNS trigger LANGUAGE plpgsql
           AS $f$ BEGIN NEW.lancado := true; RETURN NEW; END $f$`,
      ];
      for (const sql of sondas) await c.query(sql);
      const comSonda = (await c.query(Q, [["_bk1_sonda_trg"]])).rows as {
        f: string;
        sd: boolean;
      }[];
      expect(comSonda.filter((r) => !r.sd).map((r) => r.f)).toEqual([
        "_bk1_sonda_ins_sel(uuid)",
        "_bk1_sonda_proc(uuid)",
        "_bk1_sonda_trg()",
        "_bk1_sonda_tupla(uuid)",
        "_bk1_sonda_upd(uuid)",
      ]);
    });
  });

  it("migration: guarda/pós (md5, ACL, INVOKER, search_path, deps, gatilho), ida 2× / _down 2× / ida; só catálogo nas travas", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      // Travas vistas de FORA (2ª sessão). Fix round 1 (review I1): compara SÓ a DIFERENÇA que o aplicarArquivo da B1 pegou —
      // os ganchos *_TXN (S3a..S4, BK_TXN com a B4/índice) já seguram travas próprias desde o começo da txn e não contam aqui.
      type Trava = { rel: string | null; nsp: string | null; mode: string; locktype: string };
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      const travas = async (): Promise<Trava[]> =>
        (
          await b.query(
            `SELECT c.relname AS rel, n.nspname AS nsp, l.mode, l.locktype
               FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation'`,
            [pid],
          )
        ).rows;
      const chave = (t: Trava) => `${t.nsp}.${t.rel}|${t.mode}`;
      let novas: Trava[] = [];
      try {
        const antes = new Set((await travas()).map(chave));
        await aplicarArquivo(c, BK_MIG);
        novas = (await travas()).filter((t) => !antes.has(chave(t)));
      } finally {
        await b.end();
      }
      expect(
        novas.filter((t) =>
          /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp ?? ""),
        ),
      ).toEqual([]);
      expect(novas.filter((t) => t.nsp === "public" && t.mode !== "AccessShareLock")).toEqual([]);
      expect(novas.filter((t) => t.mode === "AccessExclusiveLock")).toEqual([]);
      const confere = async (m: string) => {
        expect(await md5Fn(c, FN)).toBe(m);
        const p = await um(
          c,
          `SELECT coalesce(proacl::text, '') AS acl, prosecdef AS sd, proconfig AS cfg,
                  has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
             FROM pg_proc WHERE oid = to_regprocedure($1)`,
          [FN],
        );
        expect(p).toEqual({
          acl: BK1_ACL[FN],
          sd: false,
          cfg: ["search_path=public"],
          anon: false,
          auth: false,
        });
      };
      await confere(BK_MD5[FN].depois);
      for (const [s, m] of Object.entries(BK1_DEPS)) expect(await md5Fn(c, s)).toBe(m);
      const g = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = to_regclass('public.' || $1) AND tgname = $2
            AND tgfoid = to_regprocedure($3) AND tgenabled = 'O' AND tgtype = $4`,
        [BK1_GATILHO.tabela, BK1_GATILHO.nome, FN, BK1_GATILHO.tgtype],
      );
      expect(g.n).toBe(1);
      await aplicarArquivo(c, BK_MIG); // idempotente
      await confere(BK_MD5[FN].depois);
      await aplicarArquivo(c, BK_DOWN);
      await confere(BK_MD5[FN].antes);
      await aplicarArquivo(c, BK_DOWN); // idempotente
      await confere(BK_MD5[FN].antes);
      await aplicarArquivo(c, BK_MIG);
      await confere(BK_MD5[FN].depois);
    });
  });

  it("guarda: recusa (P0001) com texto inesperado na função e com a dependência mexida; nada muda", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await voltaBk(c);
      const antes = (
        await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])
      ).d;
      // texto inesperado: um comentário a mais
      await c.query(antes.replace("BEGIN\n", "BEGIN\n  -- sonda\n"));
      await expect(aplicarArquivo(c, BK_MIG)).rejects.toThrow(
        /bk1_lancado_protegido: public\.fn_seg_pagina_modelos\(\) com texto inesperado/,
      );
      await expect(aplicarArquivo(c, BK_DOWN)).rejects.toThrow(
        /bk1_lancado_protegido_down: public\.fn_seg_pagina_modelos\(\) com texto inesperado/,
      );
      await c.query(antes);
      // dependência mexida
      const dep = Object.keys(BK1_DEPS)[0];
      const dd = (
        await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [dep])
      ).d;
      await c.query(dd.replace(/\$function\$\n/, "$function$\n-- sonda\n"));
      await expect(aplicarArquivo(c, BK_MIG)).rejects.toThrow(
        /bk1_lancado_protegido: dependencia public\._seg_exige_pagina/,
      );
      expect(await md5Fn(c, FN)).toBe(BK_MD5[FN].antes);
    });
  });

  it("cadeia LIFO dos testes: md5ModSucessor inclui o 'depois' da B1; voltaModSePreciso tira a B1 primeiro", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      expect(md5ModSucessor(FN, BK_MD5[FN].antes)).toEqual([BK_MD5[FN].antes, BK_MD5[FN].depois]);
      await aplicaBk(c, "B1");
      expect(await md5Fn(c, FN)).toBe(BK_MD5[FN].depois);
      await voltaModSePreciso(c);
      expect(await md5Fn(c, FN)).toBe(BK_MD5[FN].antes);
      expect(await bkViva(c, "B1")).toBe(false);
    });
  });
});
