// Modularidade T4 — "reprovado" com uma regra só (Parte 13, X2). Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md §0 M11 e
// §6 T4. Migrations escritas à mão: 20261103130000_mod_reprovado_check (helper _modelo_eh_reprovado + 2 CHECK NOT VALID em
// modelos) e 20261103131000_mod_reprovado_validate (VALIDATE). Cada caso em transação revertida (withTx) e SÓ na cópia local: a
// migration é aplicada DENTRO da txn (mod-helpers/mig-txn, nunca \i). Nenhuma função antiga é redefinida: o CHECK garante pelo
// DADO que as 4 grafias de "reprovado" do SQL dão o mesmo resultado (teste "uma regra só") e o anti-drift barra grafia nova.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaMod, modViva } from "./mod-helpers";
import { ehReprovadoNoGate, ehReprovadoStatus } from "../../src/lib/reprovado";
import { normalizeKanbanStatuses, resolveStatusKey } from "../../src/lib/kanban-status";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261103130000_mod_reprovado_check.sql";
const VAL = "supabase/migrations/20261103131000_mod_reprovado_validate.sql";
const DOWN = "supabase/rollback/20261103130000_mod_reprovado_check_down.sql";
const DOWN_DROP = "supabase/rollback/20261103130000_mod_reprovado_check_down_drop.sql";
const HELPER = "public._modelo_eh_reprovado(text,text)";
const HELPER_MD5 = "aa2a5c1672a70f0316660cb3c5f86f23";
const KANBAN_NORM_MD5 = "74606b6e06de34fa23fd0642d1ebafbb";
const CHK = {
  dev: "modelos_status_dev_normalizado_chk",
  plan: "modelos_status_plan_normalizado_chk",
} as const;
const EXPR = {
  dev: "((status_desenvolvimento)::text = lower(btrim((status_desenvolvimento)::text)))",
  plan: "((status_planejamento)::text = lower(btrim((status_planejamento)::text)))",
} as const;
const U_COMUM = "0d0e1000-0000-4000-8000-0000000000d4";

// Todas as chaves de página do catálogo (menos a Integração, que só o super concede) — mesmo critério do mod-1.
const PAGINAS = [
  ...new Set(
    [
      ...readFileSync(ROOT + "src/lib/permissions-catalog.ts", "utf8").matchAll(
        /key: "([a-z0-9_:]+)"/g,
      ),
    ].map((m) => m[1]),
  ),
].filter((k) => !k.startsWith("integracao"));

type Estado = {
  helper: string | null;
  dev: { expr: string; valid: boolean } | null;
  plan: { expr: string; valid: boolean } | null;
};
async function estado(c: Client): Promise<Estado> {
  const helper = (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      HELPER,
    ])
  ).m;
  const { rows } = await c.query(
    `SELECT k.conname, pg_get_expr(k.conbin, k.conrelid) AS expr, k.convalidated AS valid
       FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = ANY($1)`,
    [[CHK.dev, CHK.plan]],
  );
  const de = (n: string) => {
    const r = rows.find((x) => x.conname === n);
    return r ? { expr: r.expr as string, valid: r.valid as boolean } : null;
  };
  return { helper, dev: de(CHK.dev), plan: de(CHK.plan) };
}
const VIVA: Estado = {
  helper: HELPER_MD5,
  dev: { expr: EXPR.dev, valid: true },
  plan: { expr: EXPR.plan, valid: true },
};
const AUSENTE: Estado = { helper: null, dev: null, plan: null };

type Res = { ok: true } | { ok: false; code: string; msg: string };
/** Roda `sql` (opcionalmente como o papel `role` do PostgREST) num SAVEPOINT; erro volta ao savepoint. */
async function tenta(
  c: Client,
  sql: string,
  params: unknown[] = [],
  role: "authenticated" | null = null,
): Promise<Res> {
  await c.query("SAVEPOINT mod4");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT mod4");
    return { ok: true };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT mod4");
    await c.query("RELEASE SAVEPOINT mod4");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
/** Erro do harness (aplicarArquivo relança o erro do Postgres). */
async function falhaArquivo(c: Client, rel: string): Promise<string> {
  try {
    await aplicarArquivo(c, rel);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code ?? ""} ${er.message ?? ""}`;
  }
}
/** Deixa a txn sem a T4 (a cópia pode já tê-la): _down_drop dentro da txn (nada sai da txn). */
async function semT4(c: Client): Promise<void> {
  if (await modViva(c, 4)) await aplicarArquivo(c, DOWN_DROP);
  expect(await estado(c)).toEqual(AUSENTE);
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c, 4); // idempotente (cópia já com T1..T4, ou MOD_TXN=1: pula)
  await c.query("SET LOCAL lock_timeout = '3s'");
}
/** Card novo da Loja Teste (como postgres, sem JWT), fora da Integração e do kanban automático. */
async function cardNovo(c: Client): Promise<string> {
  return semJwt(
    c,
    async () =>
      (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.modelos (tenant_id, nome, status_planejamento, status_desenvolvimento, versao)
         VALUES ($1, 'ITEST-MOD4', 'em_planejamento', 'em_modelagem', 1) RETURNING id`,
          [T],
        )
      ).id,
  );
}
/** Usuário COMUM (role user) da Loja Teste com todas as páginas ver+editar (como postgres, sem JWT). */
async function usuarioComum(c: Client, uid: string): Promise<void> {
  await semJwt(c, async () => {
    await c.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [uid, `${uid}@teste`],
    );
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'Mod4 comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, T, `${uid}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [uid, T, PAGINAS],
    );
  });
}
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}
/** Travas de RELAÇÃO desta sessão: [schema.relação, modo]. */
async function travas(c: Client): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT n.nspname || '.' || cl.relname AS rel, l.mode
       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND l.granted
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1, 2`,
  );
  return rows.map((r) => `${r.rel} ${r.mode}`);
}

// ─── anti-drift: grafias de "reprovado" conhecidas no SQL ────────────────────────────────────────────────────────────────
/** As 6 da Integração com a grafia case-sensitive do lado do Planejamento (desenho X2; adotam o helper quando a frente da
 *  Integração as tocar de novo). */
const INTEGRACAO = new Set([
  "_integracao_base",
  "_integracao_ler",
  "integracao_listar",
  "integracao_marcar",
  "integracao_previa",
  "integracao_gerar_json_ler",
]);
/** Funções em que 'reprovado' aparece como CHAVE/rótulo/valor (coluna do board, chave de requisito, chave de JSON), não como
 *  predicado sobre o status do card. */
const CHAVE_LITERAL = new Set([
  "_kanban_resolve_key",
  "_kanban_status_rows_raw",
  "_dashboard_producao_core",
  "_kanban_coluna_manual",
  "_kanban_derivar_puro",
  "_kanban_faltando_para",
  "integracao_previa",
  "integracao_listar",
  "integracao_gerar_json_ler",
]);
const COL = String.raw`(?:\w+\.)?status_(?:desenvolvimento|planejamento)`;
/** [grafia, funções onde vale (null = qualquer), regex sobre o texto ANTES do literal, na mesma linha]. */
const GRAFIAS: [string, Set<string> | null, RegExp][] = [
  // canônica: lower(coalesce(x.status_*, '')) = | <> 'reprovado' (OTB, dashboards, estoque, Plan. Tecido)
  [
    "canonica",
    null,
    new RegExp(String.raw`lower\(\s*coalesce\(\s*${COL}\s*,\s*''\s*\)\s*\)\s*(?:=|<>)\s*$`, "i"),
  ],
  // _kanban_norm(x) = | <> | IS DISTINCT FROM 'reprovado' (kanban/REF/Explosão/_integracao_gates e o próprio helper)
  ["kanban_norm", null, /_kanban_norm\(\s*[\w.]+\s*\)\s*(?:=|<>|IS\s+DISTINCT\s+FROM)\s*$/i],
  // Integração: Planejamento case-sensitive + Desenvolvimento lower(btrim(coalesce())) (≡ _kanban_norm inline)
  [
    "integracao_plan",
    INTEGRACAO,
    /coalesce\(\s*(?:\w+\.)?status_planejamento\s*,\s*''\s*\)\s*=\s*$/i,
  ],
  [
    "integracao_dev",
    INTEGRACAO,
    /lower\(\s*btrim\(\s*coalesce\(\s*(?:\w+\.)?status_desenvolvimento\s*,\s*''\s*\)\s*\)\s*\)\s*=\s*$/i,
  ],
  // consumo_por_oc (RPC morta, aguarda DROP)
  [
    "consumo_por_oc",
    new Set(["consumo_por_oc"]),
    /(?:(?:\w+\.)?status_planejamento\s+IS\s+DISTINCT\s+FROM|COALESCE\(\s*(?:\w+\.)?status_desenvolvimento\s*,\s*''\s*\)\s*<>)\s*$/i,
  ],
  // chave/rótulo/valor: tupla/lista/JSON ("(", ",", começo de linha), jsonb - 'chave', THEN 'valor', c.key = 'chave'
  ["chave", CHAVE_LITERAL, /(?:^\s*|[(,]\s*|\s-\s*|\bTHEN\s+|\b\w+\.(?:key|alias_key|k)\s*=\s*)$/i],
];
type Ocorrencia = { fn: string; sig: string; linha: string; grafia: string | null };
function classifica(fn: string, sig: string, prosrc: string): Ocorrencia[] {
  const out: Ocorrencia[] = [];
  for (const bruta of prosrc.split("\n")) {
    const l = bruta.replace(/--.*$/, ""); // comentário não conta
    for (const m of l.matchAll(/'reprovado'/gi)) {
      const antes = l.slice(0, m.index);
      const g = GRAFIAS.find(([, fns, re]) => (!fns || fns.has(fn)) && re.test(antes));
      out.push({ fn, sig, linha: l.trim().slice(0, 160), grafia: g ? g[0] : null });
    }
  }
  return out;
}

describe.skipIf(!RODA)("mod T4 — reprovado com uma regra só (CHECK + helper)", () => {
  it("pré-condições (só leitura): 0 status fora do padrão; colunas do board e da Revenda resolvem para chave minúscula", async () => {
    await withTx(async (c) => {
      const fora = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM public.modelos m
          WHERE m.status_desenvolvimento IS DISTINCT FROM lower(btrim(m.status_desenvolvimento))
             OR m.status_planejamento IS DISTINCT FROM lower(btrim(m.status_planejamento))`,
      );
      expect(fora.n).toBe(0);
      const { rows } = await c.query(
        `SELECT tenant_id, status_kanban, revenda_kanban_colunas FROM public.tenant_config`,
      );
      expect(rows.length).toBeGreaterThan(0);
      const ruins: string[] = [];
      for (const r of rows) {
        // TS: normalizeKanbanStatuses/resolveStatusKey (a tela grava ESTA chave)
        for (const s of normalizeKanbanStatuses(r.status_kanban)) {
          if (!s.key || s.key !== s.key.trim().toLowerCase())
            ruins.push(`${r.tenant_id} TS ${s.key}`);
        }
        // SQL: o caminho REAL do servidor — `_kanban_status_rows_raw(status_kanban)` entrega a chave CRUA (chave de objeto vem
        // de `elem->>'key'` SEM `_kanban_resolve_key`; só rótulo/string passa por ele). É ESTA chave que `kanban_mover` grava em
        // `modelos.status_*`, então ela mesma tem de ser minúscula e sem espaço nas pontas (M1 do review da T4).
        const { rows: cruas } = await c.query<{ key: string }>(
          "SELECT key FROM public._kanban_status_rows_raw($1::jsonb)",
          [JSON.stringify(r.status_kanban ?? null)],
        );
        for (const { key: k } of cruas) {
          if (!k || k !== k.trim().toLowerCase()) ruins.push(`${r.tenant_id} SQL cru ${k}`);
        }
        // fluxo completo (inclui o recorte da Revenda por `revenda_kanban_colunas`): todas as chaves do fluxo, interno e comprado
        for (const comprado of [false, true]) {
          const { fluxo } = await um<{ fluxo: string[] }>(
            c,
            "SELECT public._kanban_fluxo(to_jsonb(tc), $2::boolean) AS fluxo FROM public.tenant_config tc WHERE tc.tenant_id = $1",
            [r.tenant_id, comprado],
          );
          for (const k of fluxo) {
            if (!k || k !== k.trim().toLowerCase())
              ruins.push(`${r.tenant_id} fluxo(${comprado ? "comprado" : "interno"}) ${k}`);
          }
        }
        for (const k of Array.isArray(r.revenda_kanban_colunas) ? r.revenda_kanban_colunas : []) {
          if (String(k) !== String(k).trim().toLowerCase())
            ruins.push(`${r.tenant_id} revenda ${k}`);
        }
      }
      expect(ruins).toEqual([]);
      // rótulos "difíceis" (espaço, acento, maiúscula, pontuação): TS e SQL dão chave minúscula sem espaço nas pontas
      for (const rot of [
        "Prova de Roupa ",
        "  Ação Ç ",
        "ABC  def!",
        "Reprovado",
        "STAND BY",
        "Etapa 2/3",
      ]) {
        const ts = resolveStatusKey(rot);
        const sql = (
          await um<{ k: string }>(c, "SELECT public._kanban_resolve_key($1) AS k", [rot])
        ).k;
        expect(ts, rot).toBe(ts.trim().toLowerCase());
        expect(sql, rot).toBe(sql.trim().toLowerCase());
      }
    });
  });

  it("CHECK: maiúscula ou espaço nas pontas → 23514 (como postgres e como usuário comum); minúsculo e NULL passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await estado(c)).toEqual(VIVA);
      const id = await cardNovo(c);
      // a guarda do kanban não é o assunto aqui: mudança de status como sistema (só na txn revertida)
      await c.query(`SELECT set_config('app.kanban_sistema', 'itest-mod4', true)`);
      // (btrim do Postgres tira só ESPAÇO: tab/quebra de linha nas pontas passam pelo CHECK — nenhum caminho grava isso; ver t4-report)
      const RUINS = [
        "Reprovado",
        " reprovado",
        "reprovado ",
        "REPROVADO",
        "Em_Modelagem",
        "  reprovado  ",
      ];
      const falhas: string[] = [];
      for (const [col, chk] of [
        ["status_desenvolvimento", CHK.dev],
        ["status_planejamento", CHK.plan],
      ] as const) {
        for (const v of RUINS) {
          const r = await tenta(c, `UPDATE public.modelos SET ${col} = $2 WHERE id = $1`, [id, v]);
          if (r.ok || r.code !== "23514" || !r.msg.includes(chk))
            falhas.push(`postgres ${col}=${JSON.stringify(v)}: ${txt(r)}`);
        }
        for (const v of ["reprovado", "aprovado", null]) {
          const r = await tenta(c, `UPDATE public.modelos SET ${col} = $2 WHERE id = $1`, [id, v]);
          if (!r.ok) falhas.push(`postgres ${col}=${JSON.stringify(v)} devia passar: ${txt(r)}`);
        }
      }
      // INSERT também
      const ins = await tenta(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, status_planejamento, versao) VALUES ($1, 'ITEST-MOD4-INS', 'Reprovado', 1)`,
        [T],
      );
      if (ins.ok || ins.code !== "23514") falhas.push(`INSERT 'Reprovado': ${txt(ins)}`);
      // usuário COMUM pelo PostgREST (authenticated + JWT): o CHECK morde igual
      await usuarioComum(c, U_COMUM);
      await jwt(c, U_COMUM);
      for (const [col, chk] of [
        ["status_desenvolvimento", CHK.dev],
        ["status_planejamento", CHK.plan],
      ] as const) {
        const r = await tenta(
          c,
          `UPDATE public.modelos SET ${col} = 'Reprovado' WHERE id = $1`,
          [id],
          "authenticated",
        );
        if (r.ok || r.code !== "23514" || !r.msg.includes(chk))
          falhas.push(`comum ${col}='Reprovado': ${txt(r)}`);
        const ok = await tenta(
          c,
          `UPDATE public.modelos SET ${col} = 'reprovado' WHERE id = $1`,
          [id],
          "authenticated",
        );
        if (!ok.ok) falhas.push(`comum ${col}='reprovado' devia passar: ${txt(ok)}`);
      }
      // o UPDATE do comum chegou de fato à linha (não foi filtrado pela RLS): os 2 ficaram 'reprovado'
      await jwt(c, null);
      expect(
        await um(
          c,
          `SELECT status_desenvolvimento AS sd, status_planejamento AS sp FROM public.modelos WHERE id = $1`,
          [id],
        ),
      ).toEqual({ sd: "reprovado", sp: "reprovado" });
      expect(falhas).toEqual([]);
    });
  });

  it("_modelo_eh_reprovado ≡ ehReprovadoNoGate (tabela-verdade); ACL interna (só service_role), IMMUTABLE, search_path", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const V = [
        null,
        "",
        "reprovado",
        "Reprovado",
        " reprovado ",
        "REPROVADO",
        "  Reprovado  ",
        "reprovados",
        "aprovado",
        "em_planejamento",
      ];
      const pares = V.flatMap((sd) => V.map((sp) => [sd, sp] as const));
      const { rows } = await c.query(
        `SELECT x.i, public._modelo_eh_reprovado(x.sd, x.sp) AS r
           FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS x(sd, sp, i) ORDER BY x.i`,
        [pares.map((p) => p[0]), pares.map((p) => p[1])],
      );
      expect(rows.length).toBe(pares.length);
      const dif = pares
        .map((p, i) => ({ p, sql: rows[i].r as boolean, ts: ehReprovadoNoGate(p[0], p[1]) }))
        .filter((x) => x.sql !== x.ts);
      expect(dif).toEqual([]);
      expect(pares.filter((p) => ehReprovadoNoGate(p[0], p[1])).length).toBeGreaterThan(0);
      expect(pares.filter((p) => !ehReprovadoNoGate(p[0], p[1])).length).toBeGreaterThan(0);
      const p = await um(
        c,
        `SELECT p.prosecdef AS secdef, p.provolatile AS vol, p.proconfig AS cfg,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0) AS pub,
                md5(pg_get_functiondef(p.oid)) AS md5,
                md5(pg_get_functiondef('public._kanban_norm(text)'::regprocedure)) AS dep
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [HELPER],
      );
      expect(p).toEqual({
        secdef: false,
        vol: "i",
        cfg: ["search_path=public"],
        anon: false,
        auth: false,
        svc: true,
        pub: false,
        md5: HELPER_MD5,
        dep: KANBAN_NORM_MD5,
      });
      // authenticated não chama o helper (inv. #9)
      await usuarioComum(c, U_COMUM);
      await jwt(c, U_COMUM);
      const r = await tenta(
        c,
        `SELECT public._modelo_eh_reprovado('reprovado', null)`,
        [],
        "authenticated",
      );
      expect(txt(r)).toMatch(/^42501 permission denied for function _modelo_eh_reprovado/);
    });
  });

  it("uma regra só no DADO: com o CHECK, as 4 grafias do SQL ≡ helper ≡ TS em todos os modelos da cópia", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query(
        `SELECT m.id, m.status_desenvolvimento AS sd, m.status_planejamento AS sp,
                public._modelo_eh_reprovado(m.status_desenvolvimento, m.status_planejamento) AS helper,
                (lower(coalesce(m.status_desenvolvimento,'')) = 'reprovado'
                  OR lower(coalesce(m.status_planejamento,'')) = 'reprovado') AS canonica,
                (public._kanban_norm(m.status_desenvolvimento) = 'reprovado'
                  OR public._kanban_norm(m.status_planejamento) = 'reprovado') AS kanban_norm,
                (coalesce(m.status_planejamento, '') = 'reprovado'
                  OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado') AS integracao,
                NOT (m.status_planejamento IS DISTINCT FROM 'reprovado'
                     AND COALESCE(m.status_desenvolvimento,'') <> 'reprovado') AS consumo_por_oc
           FROM public.modelos m`,
      );
      expect(rows.length).toBeGreaterThan(100);
      const dif = rows.filter(
        (r) =>
          new Set([
            r.helper,
            r.canonica,
            r.kanban_norm,
            r.integracao,
            r.consumo_por_oc,
            ehReprovadoStatus(r.sd, r.sp),
            ehReprovadoNoGate(r.sd, r.sp),
          ]).size !== 1,
      );
      expect(dif).toEqual([]);
      expect(rows.filter((r) => r.helper).length).toBeGreaterThan(0);
      expect(rows.filter((r) => !r.helper).length).toBeGreaterThan(0);
    });
  });

  it("anti-drift: toda função de public que cita 'reprovado' usa uma grafia conhecida (grafia nova falha)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query(
        `SELECT p.proname, p.oid::regprocedure::text AS sig, p.prosrc
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prosrc ~* '''reprovado'''
          ORDER BY 2`,
      );
      const oc = rows.flatMap((r) => classifica(r.proname, r.sig, r.prosrc));
      const desconhecidas = oc.filter((o) => !o.grafia).map((o) => `${o.sig} :: ${o.linha}`);
      expect(desconhecidas).toEqual([]);
      // não-vazio: cada grafia aparece, as 6 da Integração existem e o helper usa _kanban_norm
      const por = (g: string) => oc.filter((o) => o.grafia === g);
      for (const g of GRAFIAS.map((x) => x[0])) expect(por(g).length, g).toBeGreaterThan(0);
      const fns = new Set(rows.map((r) => r.proname as string));
      for (const f of INTEGRACAO) expect(fns.has(f), f).toBe(true);
      expect(por("kanban_norm").some((o) => o.fn === "_modelo_eh_reprovado")).toBe(true);
      // o classificador pega grafia nova (ex.: comparação crua, upper, ILIKE) e grafia da Integração fora das 6
      const nova = [
        "  WHERE m.status_planejamento = 'reprovado'",
        "  AND upper(m.status_desenvolvimento) = 'REPROVADO'",
        "  AND m.status_desenvolvimento ILIKE 'reprovado'",
        "  AND coalesce(m.status_planejamento, '') = 'reprovado'",
        "  SELECT ('reprovado')",
      ].join("\n");
      expect(classifica("funcao_nova", "public.funcao_nova()", nova).map((o) => o.grafia)).toEqual([
        null,
        null,
        null,
        null,
        null,
      ]);
      // comentário com 'reprovado' não conta
      expect(
        classifica("funcao_nova", "public.funcao_nova()", "  -- card 'reprovado' sai"),
      ).toEqual([]);
    });
  });

  it("migration: 130000 → NOT VALID; 131000 → validada; ida idempotente; _down no-op; _down_drop round-trip; travas", async () => {
    await withTx(async (c) => {
      // Ruling R6 (frente Backend): travas que os ganchos MOD_TXN/BK_TXN/S*_TXN já pegaram no começo da txn (ex.: o índice novo
      // da B4 numa cópia sem ela) não são desta migration — as asserções de "nada além de" olham só o que veio DEPOIS daqui.
      const inicio = new Set(await travas(c));
      await prepara(c);
      const vivaNaCopia = (await estado(c)).dev !== null;
      // reaplicar com a T4 viva não pega trava em modelos (só faz sentido se a txn ainda não travou: cópia já com a T4)
      if (vivaNaCopia) {
        const antes = await travas(c);
        await aplicarArquivo(c, MIG);
        await aplicarArquivo(c, VAL);
        const depois = await travas(c);
        // só a leitura da guarda (AccessShare, a mesma de um SELECT); nenhuma trava de DDL
        expect(
          depois.filter(
            (t) =>
              t.startsWith("public.modelos ") &&
              !t.endsWith(" AccessShareLock") &&
              !antes.includes(t),
          ),
        ).toEqual([]);
        expect(await estado(c)).toEqual(VIVA);
      }
      await semT4(c);
      // ida do zero: NOT VALID
      await aplicarArquivo(c, MIG);
      expect(await estado(c)).toEqual({
        helper: HELPER_MD5,
        dev: { expr: EXPR.dev, valid: false },
        plan: { expr: EXPR.plan, valid: false },
      });
      // a trava da ida: AccessExclusive SÓ em modelos (das relações não-catálogo); nada em auth/storage/realtime
      const tr = await travas(c);
      expect(tr).toContain("public.modelos AccessExclusiveLock");
      const trNovas = tr.filter((t) => !inicio.has(t)); // R6: só o que não vinha dos ganchos
      expect(trNovas.filter((t) => /^(auth|storage|realtime|supabase_\w+)\./.test(t))).toEqual([]);
      expect(
        trNovas.filter(
          (t) => t.endsWith(" AccessExclusiveLock") && !t.startsWith("public.modelos "),
        ),
      ).toEqual([]);
      // idempotente
      await aplicarArquivo(c, MIG);
      expect((await estado(c)).dev?.valid).toBe(false);
      // NOT VALID já morde escrita nova
      const id = await cardNovo(c);
      await c.query(`SELECT set_config('app.kanban_sistema', 'itest-mod4', true)`);
      expect(
        (
          await tenta(
            c,
            `UPDATE public.modelos SET status_planejamento = 'Reprovado' WHERE id = $1`,
            [id],
          )
        ).ok,
      ).toBe(false);
      // validate (2×)
      await aplicarArquivo(c, VAL);
      await aplicarArquivo(c, VAL);
      expect(await estado(c)).toEqual(VIVA);
      // _down: no-op documentado (2×), estado igual
      await aplicarArquivo(c, DOWN);
      await aplicarArquivo(c, DOWN);
      expect(await estado(c)).toEqual(VIVA);
      // _down_drop recusa enquanto alguma função cita o helper
      await c.query(
        `CREATE FUNCTION public._itest_mod4_cita() RETURNS boolean LANGUAGE sql AS $f$ SELECT public._modelo_eh_reprovado('a', 'b') $f$`,
      );
      expect(await falhaArquivo(c, DOWN_DROP)).toMatch(
        /^P0001 mod4_drop: ainda citam _modelo_eh_reprovado .*_itest_mod4_cita\(\)/,
      );
      expect(await estado(c)).toEqual(VIVA);
      await c.query(`DROP FUNCTION public._itest_mod4_cita()`);
      // _down_drop (2×: idempotente) → tudo sai; a 131000 sem a 130000 recusa
      await aplicarArquivo(c, DOWN_DROP);
      await aplicarArquivo(c, DOWN_DROP);
      expect(await estado(c)).toEqual(AUSENTE);
      expect(await falhaArquivo(c, VAL)).toMatch(
        /^P0001 mod4_validar: rode antes a 20261103130000/,
      );
      // _down sem nada: só o NOTICE
      await aplicarArquivo(c, DOWN);
      // ida de novo → viva
      await aplicarArquivo(c, MIG);
      await aplicarArquivo(c, VAL);
      expect(await estado(c)).toEqual(VIVA);
      expect(await modViva(c, 4)).toBe(true);
    });
  });

  it("guardas: constraint/helper com outra definição, _kanban_norm mexido e linha fora do padrão recusam (nada muda)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await semT4(c);
      // (a) mesma constraint com outra expressão
      await c.query(
        `ALTER TABLE public.modelos ADD CONSTRAINT ${CHK.plan} CHECK (status_planejamento = lower(status_planejamento)) NOT VALID`,
      );
      expect(await falhaArquivo(c, MIG)).toMatch(
        new RegExp(`^P0001 mod4_guarda: ${CHK.plan} ja existe com outra definicao`),
      );
      expect(await falhaArquivo(c, VAL)).toMatch(/^P0001 mod4_validar: rode antes/);
      expect(await falhaArquivo(c, DOWN)).toMatch(
        new RegExp(`^P0001 mod4_down: ${CHK.plan} com outra definicao`),
      );
      expect(await falhaArquivo(c, DOWN_DROP)).toMatch(
        new RegExp(`^P0001 mod4_drop: ${CHK.plan} com outra definicao`),
      );
      await c.query(`ALTER TABLE public.modelos DROP CONSTRAINT ${CHK.plan}`);
      expect(await estado(c)).toEqual(AUSENTE);
      // (b) helper com outro texto
      await c.query(
        `CREATE FUNCTION public._modelo_eh_reprovado(_sd text, _sp text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT false $f$`,
      );
      expect(await falhaArquivo(c, MIG)).toMatch(
        /^P0001 mod4_guarda: _modelo_eh_reprovado com texto inesperado/,
      );
      expect(await falhaArquivo(c, DOWN_DROP)).toMatch(
        /^P0001 mod4_drop: _modelo_eh_reprovado com texto inesperado/,
      );
      await c.query(`DROP FUNCTION public._modelo_eh_reprovado(text, text)`);
      // (c) dependência _kanban_norm mexida
      await c.query(`SAVEPOINT dep`);
      await c.query(
        `CREATE OR REPLACE FUNCTION public._kanban_norm(_s text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT lower(coalesce(_s, '')) $f$`,
      );
      expect(await falhaArquivo(c, MIG)).toMatch(
        /^P0001 mod4_guarda: _kanban_norm ausente ou com texto inesperado/,
      );
      await c.query(`ROLLBACK TO SAVEPOINT dep`);
      // (d) linha fora do padrão: a ida recusa com a contagem (sem o CHECK, gravar maiúscula ainda é possível)
      const id = await cardNovo(c);
      await c.query(`SELECT set_config('app.kanban_sistema', 'itest-mod4', true)`);
      await c.query(
        `UPDATE public.modelos SET status_desenvolvimento = 'Reprovado' WHERE id = $1`,
        [id],
      );
      expect(await falhaArquivo(c, MIG)).toMatch(
        /^P0001 mod4_guarda: 1 modelos com status fora do padrao/,
      );
      expect(await estado(c)).toEqual(AUSENTE);
      // ... e a 131000 também (CHECK NOT VALID criado por fora com a linha ruim já gravada): mensagem, não 23514 cru
      await c.query(
        `ALTER TABLE public.modelos ADD CONSTRAINT ${CHK.dev} CHECK (status_desenvolvimento = lower(btrim(status_desenvolvimento))) NOT VALID`,
      );
      await c.query(
        `ALTER TABLE public.modelos ADD CONSTRAINT ${CHK.plan} CHECK (status_planejamento = lower(btrim(status_planejamento))) NOT VALID`,
      );
      expect(await falhaArquivo(c, VAL)).toMatch(
        /^P0001 mod4_validar: 1 modelos com status fora do padrao/,
      );
      expect((await estado(c)).dev?.valid).toBe(false);
    });
  });
});
