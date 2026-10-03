// Achados LEVES — release L3 (Kanban, REF e SKU). Migrations 20261027100000 / 110000 / 120000 / 130000 (+ _down em
// supabase/rollback/). Txn revertida (BEGIN…ROLLBACK): nada é gravado. Reescreve a config da Loja Teste e sabota funções
// DENTRO da txn → só na CÓPIA LOCAL. Fixture ausente / função ausente = FALHA (nunca passa calado): os testes rodam contra o
// banco COM a L3 aplicada e cada um falha contra o texto antigo das funções (anotado em cada `it`).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarSql } from "./mig-txn";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal, dbUrl } from "./db";
import { md5OuSucessorS1 } from "./seg-s1-helpers";
import { BOARD_GATE, REQS_GATE } from "../fixtures/kanban-auto-casos";
import {
  mensagemErro,
  TEXTO_REF_ETAPA_COM_KANBAN,
  TEXTO_REPROVADO_EXPLOSAO,
} from "../../src/lib/erro-mensagem";
import { gateEnvioExplosao } from "../../src/components/planejamento/planejamento-detail/ficha/envio-explosao";
import { lerKanbanAutoConfig, type Derivacao } from "../../src/lib/kanban-auto";
import { refCampoVisivel } from "../../src/lib/kanban-status";
import {
  problemaFormatoRef,
  siglaConfiguradaItem,
  siglaFamilia,
  type RefConfig,
} from "../../src/lib/ref-montar";
import { statusParaGate } from "../../src/lib/kanban-auto";

const LOCAL = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// Prova "falha contra o texto antigo": L3_CONTRA_ANTIGO=1 aplica os 4 inversos da L3 DENTRO da txn de cada teste (LIFO; sem
// BEGIN/COMMIT nem as travas SET LOCAL do arquivo; só na cópia local) — a suíte inteira tem de FALHAR assim. Nunca \i.
const CONTRA_ANTIGO = process.env.L3_CONTRA_ANTIGO === "1";
const INVERSOS_L3 = [
  "supabase/rollback/20261027140000_reprovado_planejamento_gate_down.sql",
  "supabase/rollback/20261027130000_ref_revelar_ao_mudar_etapa_down.sql",
  "supabase/rollback/20261027120000_sku_replica_familia_down.sql",
  "supabase/rollback/20261027110000_ref_sigla_e_msg_reprovado_down.sql",
  "supabase/rollback/20261027100000_kanban_fila_e_cad_unico_down.sql",
];
async function tx(fn: (c: Client) => Promise<void>): Promise<void> {
  await withTx(async (c) => {
    if (CONTRA_ANTIGO) {
      for (const rel of INVERSOS_L3) {
        const sql = readFileSync(ROOT + rel, "utf8").replace(
          /^SET LOCAL (lock_timeout|statement_timeout|transaction_timeout) = '[^']*';$/gm,
          "-- [teste] trava removida",
        );
        await aplicarSql(c, sql, rel);
      }
    }
    await fn(c);
  });
}
const T = TENANT_TESTE;
const HOJE = "2026-09-01";
const U_ADMIN = "c0f1c0f1-0000-4000-8000-0000000000b3"; // tenant_admin da Loja Teste (criado na txn)

// md5 "depois" da L3 (o mesmo da guarda/pós-condição das migrations) + ACL esperada.
const MD5_L3: Record<string, string> = {
  "fn_kanban_processar_fila()": "4051368d03f06d4a8e0e118dbc6614d5",
  "_kanban_enfileirar(uuid[])": "d763171ea7e617ba6c791a6a204f0a21",
  "_kanban_enfileirar_tenant(uuid)": "d27c6401de3659f1b352eb18e867c7ef",
  "_avaliar_condicoes_kanban_core(uuid,uuid[])": "e6f3fceae7e6eb6f4589d4858e01d1d6",
  "_enviar_modelo_para_cad_core(uuid,text,text)": "14179bce7709643ea068edfed128ca43",
  "_ref_sigla_cfg_item(uuid,uuid)": "9f4f7b15ca761c3cf655fdc16d67af83",
  "_ref_sigla_familia(uuid,text)": "3917f270e142d6922a237d67cb4acb38",
  "_integracao_gates(uuid)": "3170d39179b01f2a6359fbdcb79c18e5",
  "salvar_config_loja(uuid,jsonb,jsonb,boolean)": "2d43c259135119b345a09a894091c2b5",
  "fn_modelo_skus_unico()": "98fcc32a2ad577cee284f914cac9d588",
  "_skus_plano(uuid,text,text,jsonb,text)": "5980345a105818b26329c8a4e594fee2",
  "_salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)": "4a047b0e3d594b13650e67e682287df7",
  "_skus_matriz_ref_tipo(uuid,text,text)": "0a3279115f0666a79b5bca35792c2865",
  "_ref_exibir_gate_etapa(uuid,text,text)": "99342e2e1ea3c4c43a2d0943b2c0bdc3",
  "_ref_revelar_candidatos(uuid,text)": "44bc4271c09322a793247259843c1a67",
  "ref_previa_revelar(uuid,text)": "6a9da1726b5f7fcdcf8be85512b9cece",
  // 20261027140000 (fix round 1, A1): funções da R14 + o gatilho da REF
  "_kanban_status_gate(uuid,uuid,text)": "44a0ebe16970322eefa949dce8c2f38f",
  "_kanban_aplicar(uuid,uuid[],text,uuid)": "d20c6f9404028c20f8336799743f234a",
  "kanban_previa_recalculo(jsonb)": "fdbc2039870d90a0277c20f859084259",
  "fn_modelo_ref_auto()": "6d68b20b0e5086a9a9dc0c87a8b42c69",
};
const INTERNAS = [
  "_kanban_enfileirar(uuid[])",
  "_kanban_enfileirar_tenant(uuid)",
  "_avaliar_condicoes_kanban_core(uuid,uuid[])",
  "_enviar_modelo_para_cad_core(uuid,text,text)",
  "_ref_sigla_cfg_item(uuid,uuid)",
  "_ref_sigla_familia(uuid,text)",
  "_integracao_gates(uuid)",
  "fn_modelo_skus_unico()",
  "_skus_plano(uuid,text,text,jsonb,text)",
  "_salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)",
  "_skus_matriz_ref_tipo(uuid,text,text)",
  "_ref_exibir_gate_etapa(uuid,text,text)",
  "_ref_revelar_candidatos(uuid,text)",
  "_kanban_status_gate(uuid,uuid,text)",
  "_kanban_aplicar(uuid,uuid[],text,uuid)",
];
const PUBLICAS = [
  "salvar_config_loja(uuid,jsonb,jsonb,boolean)",
  "ref_previa_revelar(uuid,text)",
  "kanban_previa_recalculo(jsonb)",
];

// ───────────────────────────── helpers (mesmo padrão de kanban-reprovado-gate.test.ts) ─────────────────────────────
async function chave(c: Client, ligada: boolean) {
  await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
  try {
    await c.query(`UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1`, [
      T,
      ligada,
    ]);
  } finally {
    await c.query(`SELECT set_config('app.kanban_chave', '', true)`);
  }
}
/** Board sintético da Loja Teste NA TXN: 'reprovado' DEPOIS de etapa_c (a etapa da REF e da Explosão). */
async function configurarBoard(c: Client, refEtapa = "etapa_c") {
  await chave(c, false);
  const r = await c.query(
    `UPDATE public.tenant_config
        SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = '{}'::jsonb,
            revenda_kanban_colunas = '[]'::jsonb, revenda_kanban_requisitos = '{}'::jsonb,
            ref_exibir_status = $4, explosao_envio_status = 'etapa_c'
      WHERE tenant_id = $1`,
    [T, JSON.stringify(BOARD_GATE), JSON.stringify(REQS_GATE), refEtapa],
  );
  if (r.rowCount !== 1) throw new Error("fixture ausente: tenant_config da Loja Teste");
}
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query(`SELECT set_config('app.kanban_sistema', 'teste', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.kanban_sistema', '', true)`);
  }
}
async function novoModelo(c: Client, campos: Record<string, unknown> = {}): Promise<string> {
  const base = await um<{ c: string | null; s: string | null } | undefined>(
    c,
    `SELECT categoria_principal_id AS c, subcategoria1_id AS s FROM public.modelos
      WHERE tenant_id = $1 AND categoria_principal_id IS NOT NULL AND subcategoria1_id IS NOT NULL LIMIT 1`,
    [T],
  );
  if (!base?.c || !base?.s)
    throw new Error("fixture ausente: modelo com categoria+subcategoria na Loja Teste");
  const cols: Record<string, unknown> = {
    tenant_id: T,
    nome: "L3 teste",
    ordem_criacao_enviada: true,
    status_desenvolvimento: "entrada",
    categoria_principal_id: base.c,
    subcategoria1_id: base.s,
    ...campos,
  };
  const nomes = Object.keys(cols);
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (${nomes.join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(cols),
  );
  return r.id;
}
const CAMPOS_COND = [
  "data_desenho_tecnico",
  "data_piloto1",
  "data_piloto2",
  "data_aprovacao",
] as const;
const ATE_C = { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true };
/** Card com as condições dadas, REF escondida (ref = '' com ref_auto), já no status pedido SEM passar pelo motor. */
async function cardFixado(
  c: Client,
  cond: Record<string, boolean>,
  status: string,
  nome = "L3 teste",
): Promise<string> {
  const campos: Record<string, unknown> = { nome };
  for (const k of CAMPOS_COND) if (cond[k]) campos[k] = HOJE;
  const M = await comoSistema(c, () => novoModelo(c, campos));
  await comoSistema(c, () =>
    c.query(`UPDATE public.modelos SET status_desenvolvimento = $2 WHERE id = $1`, [M, status]),
  );
  await comoSistema(c, () => c.query(`UPDATE public.modelos SET ref = '' WHERE id = $1`, [M]));
  const m = await lerModelo(c, M);
  if ((m.ref ?? "") !== "" || (m.ref_auto ?? "") === "")
    throw new Error("fixture: card sem ref_auto ou com REF já revelada");
  return M;
}
async function lerModelo(c: Client, id: string) {
  return um<{ status: string | null; ref: string | null; ref_auto: string | null }>(
    c,
    `SELECT status_desenvolvimento AS status, ref, ref_auto FROM public.modelos WHERE id = $1`,
    [id],
  );
}
async function imediato(c: Client) {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function erroDe(
  c: Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT l3_err");
  try {
    await c.query(sql, params);
  } catch (e: unknown) {
    await c.query("ROLLBACK TO SAVEPOINT l3_err");
    const pe = e as { code?: string; message?: string };
    return { code: String(pe.code), message: String(pe.message) };
  }
  await c.query("RELEASE SAVEPOINT l3_err");
  throw new Error(`esperava recusa, mas passou: ${sql}`);
}
async function filaIds(c: Client): Promise<string[]> {
  return (
    await c.query(`SELECT modelo_id FROM public.kanban_recalculo_fila ORDER BY modelo_id`)
  ).rows.map((r) => r.modelo_id);
}
async function usuarioAdmin(c: Client): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    U_ADMIN,
    `${U_ADMIN}@teste`,
  ]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, 'L3 admin')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [U_ADMIN, T, `${U_ADMIN}@teste`],
  );
  await c.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`,
    [U_ADMIN],
  );
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: U_ADMIN, role: "authenticated" }),
  ]);
}
async function salvarConfig(c: Client, mud: Record<string, unknown>) {
  const row = (
    await um<{ j: Record<string, unknown> }>(
      c,
      `SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tenant_id = $1`,
      [T],
    )
  ).j;
  const base = Object.fromEntries(Object.keys(mud).map((k) => [k, row[k] ?? null]));
  return um<{ r: { gravadas: string[]; refs_reveladas?: number } }>(
    c,
    `SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, NULL) AS r`,
    [T, JSON.stringify(mud), JSON.stringify(base)],
  );
}
async function erroSalvarConfig(c: Client, mud: Record<string, unknown>) {
  const row = (
    await um<{ j: Record<string, unknown> }>(
      c,
      `SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tenant_id = $1`,
      [T],
    )
  ).j;
  const base = Object.fromEntries(Object.keys(mud).map((k) => [k, row[k] ?? null]));
  return erroDe(c, `SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, NULL)`, [
    T,
    JSON.stringify(mud),
    JSON.stringify(base),
  ]);
}
async function derivacao(c: Client, M: string): Promise<Derivacao> {
  const d = await um<{
    derivavel: boolean;
    entrada: string | null;
    alvo: string | null;
    resultado: string | null;
    fixado: boolean;
    primeira_falha: string | null;
    faltando: string[];
  }>(
    c,
    `SELECT derivavel, entrada, alvo, resultado, fixado, primeira_falha, faltando FROM public._kanban_derivar_lote($1, ARRAY[$2]::uuid[])`,
    [T, M],
  );
  if (!d) throw new Error("fixture: derivação não encontrada");
  return {
    derivavel: d.derivavel,
    entrada: d.entrada,
    alvo: d.alvo,
    resultado: d.resultado,
    fixado: d.fixado,
    primeiraFalha: d.primeira_falha,
    faltando: d.faltando,
  };
}

// ─────────────────────────────────────────── md5 e ACL ───────────────────────────────────────────
describe.skipIf(!hasDb)("L3 — md5 e ACL (20261027100000..130000 aplicadas)", () => {
  it("as 20 funções estão com o texto da L3 (ausente = falha); os 2 gatilhos da fila ligados", async () => {
    await tx(async (c) => {
      for (const [sig, md5] of Object.entries(MD5_L3)) {
        const r = await um<{ m: string | null }>(
          c,
          `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure($1))) END AS m`,
          ["public." + sig],
        );
        // Reforço de segurança S1 (20261031120000) redefine _enviar_modelo_para_cad_core por cima (GUC da Explosão; sucessor aceito)
        expect(md5OuSucessorS1(sig, md5), sig).toContain(r.m);
      }
      const g = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM pg_trigger t WHERE t.tgrelid = 'public.kanban_recalculo_fila'::regclass AND t.tgenabled = 'O'
            AND t.tgname IN ('trg_kanban_processar_fila', 'trg_kanban_processar_fila_upd')`,
      );
      expect(g.n).toBe(2);
    });
  });
  it("inv. #9: internas sem EXECUTE p/ PUBLIC/anon/authenticated; RPCs com authenticated e sem anon/PUBLIC; prévia STABLE", async () => {
    await tx(async (c) => {
      const acl = async (sig: string) =>
        um<{ a: boolean; u: boolean; p: boolean; v: string }>(
          c,
          `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') a,
                  has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') u,
                  EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                           WHERE p.oid = $1::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') p,
                  (SELECT provolatile::text FROM pg_proc WHERE oid = $1::regprocedure) v`,
          ["public." + sig],
        );
      for (const sig of INTERNAS) {
        const r = await acl(sig);
        expect([r.a, r.u, r.p], sig).toEqual([false, false, false]);
      }
      for (const sig of PUBLICAS) {
        const r = await acl(sig);
        expect([r.a, r.u, r.p], sig).toEqual([false, true, false]);
      }
      expect((await acl("ref_previa_revelar(uuid,text)")).v).toBe("s");
      expect((await acl("_ref_revelar_candidatos(uuid,text)")).v).toBe("s");
    });
  });
});

// ─────────────────────────────── kanban #10 — fila: erro deixa a linha ───────────────────────────────
// Contra o texto antigo (f14d567a): o DELETE ficava FORA do bloco protegido → a fila esvaziava mesmo com o erro.
describe.skipIf(!LOCAL)(
  "L3 kanban #10 — fn_kanban_processar_fila: erro no recálculo deixa o card na fila",
  () => {
    it("1 card, _kanban_aplicar falha: WARNING, COMMIT não cai e o card FICA na fila", async () => {
      await tx(async (c) => {
        const avisos: string[] = [];
        const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
        c.on("notice", ouvir);
        try {
          await c.query("SET LOCAL lock_timeout = '3s'");
          await configurarBoard(c);
          await chave(c, true);
          const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
          await c.query(`DELETE FROM public.kanban_recalculo_fila`);
          // sabotagem SÓ nesta txn (revertida)
          await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                       RETURNS integer LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'sabotagem L3'; END $f$`);
          await c.query(
            `INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`,
            [M, T],
          );
          await imediato(c); // não lança
          expect(
            avisos.some(
              (a) => /kanban_auto: recalculo do lote falhou/.test(a) && /sabotagem L3/.test(a),
            ),
          ).toBe(true);
          expect(await filaIds(c)).toEqual([M]);
          expect((await lerModelo(c, M)).status).toBe("entrada");
        } finally {
          c.off("notice", ouvir);
        }
      });
    });

    it("lote de 2 com 1 card ruim: card a card — o bom sai da fila, o ruim FICA", async () => {
      await tx(async (c) => {
        const avisos: string[] = [];
        const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
        c.on("notice", ouvir);
        try {
          await c.query("SET LOCAL lock_timeout = '3s'");
          await configurarBoard(c);
          await chave(c, true);
          const RUIM = await comoSistema(c, () => novoModelo(c));
          const BOM = await comoSistema(c, () => novoModelo(c));
          await c.query(`DELETE FROM public.kanban_recalculo_fila`);
          await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                       RETURNS integer LANGUAGE plpgsql AS $f$
                       BEGIN
                         IF '${RUIM}'::uuid = ANY (_ids) THEN RAISE EXCEPTION 'card ruim L3'; END IF;
                         RETURN 0;
                       END $f$`);
          await c.query(
            `INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2), ($3, $2)`,
            [RUIM, T, BOM],
          );
          await imediato(c);
          expect(await filaIds(c)).toEqual([RUIM]);
          expect(avisos.some((a) => a.includes(`card ${RUIM} continua na fila`))).toBe(true);
        } finally {
          c.off("notice", ouvir);
        }
      });
    });

    it("sem erro: a fila esvazia e o card anda (comportamento de sempre)", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c);
        await chave(c, true);
        const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
        await c.query(`DELETE FROM public.kanban_recalculo_fila`);
        await c.query(
          `INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`,
          [M, T],
        );
        await imediato(c);
        expect(await filaIds(c)).toEqual([]);
        expect((await lerModelo(c, M)).status).toBe("etapa_a");
      });
    });
  },
);

// ─────────────────────────────── kanban #11 — 2 CADs não derrubam o lote ───────────────────────────────
// Contra o texto antigo (437b115a): 'cq_liberado' por subconsulta escalar → "more than one row returned by a subquery".
describe.skipIf(!LOCAL)(
  "L3 kanban #11 — _avaliar_condicoes_kanban_core com modelo de 2 CADs",
  () => {
    it("lote com 1 modelo de 2 CADs (legado) + 1 normal: avalia os dois, sem erro", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        const DOIS = await comoSistema(c, () => novoModelo(c));
        const NORMAL = await comoSistema(c, () => novoModelo(c));
        // 2 CADs só fura o enforce_unique_fk com session_replication_role=replica (legado; hoje 0 em produção)
        await c.query("SET LOCAL session_replication_role = replica");
        await c.query(`INSERT INTO public.cad (modelo_id, tenant_id) VALUES ($1, $2), ($1, $2)`, [
          DOIS,
          T,
        ]);
        await c.query("SET LOCAL session_replication_role = origin");
        expect(
          Number(
            (
              await um<{ n: string }>(
                c,
                `SELECT count(*) AS n FROM public.cad WHERE modelo_id = $1`,
                [DOIS],
              )
            ).n,
          ),
        ).toBe(2);
        const r = await um<{ j: Record<string, Record<string, boolean>> }>(
          c,
          `SELECT public._avaliar_condicoes_kanban_core($1, ARRAY[$2, $3]::uuid[]) AS j`,
          [T, DOIS, NORMAL],
        );
        expect(Object.keys(r.j).sort()).toEqual([DOIS, NORMAL].sort());
        expect(r.j[DOIS].cq_liberado).toBe(false);
        expect(r.j[NORMAL].cq_liberado).toBe(false);
      });
    });
  },
);

// ─────────────────────────── kanban #11 — envio à Explosão serializado por card ───────────────────────────
// Contra o texto antigo (3e49be23): o caminho idempotente (CAD já existe) não pedia trava nenhuma → passava na hora.
describe.skipIf(!LOCAL)(
  "L3 kanban #11 — _enviar_modelo_para_cad_core pede o advisory lock do CAD do card",
  () => {
    it("2ª conexão segurando a trava 'cad:modelo_id:<card>' → o envio espera (55P03 no lock_timeout); solta → idempotente", async () => {
      const segunda = new Client({ connectionString: dbUrl()!, ssl: false });
      await segunda.connect();
      try {
        await tx(async (c) => {
          await c.query("SET LOCAL lock_timeout = '3s'");
          await comoUsuario(c);
          await configurarBoard(c);
          const M = await cardFixado(c, {}, "aprovado");
          // o CAD já existe (caminho idempotente). Criado com session_replication_role=replica: o enforce_unique_fk pegaria a
          // MESMA trava nesta txn e a 2ª conexão ficaria esperando por ela (o teste travaria).
          await c.query("SET LOCAL session_replication_role = replica");
          const cad = await um<{ id: string }>(
            c,
            `INSERT INTO public.cad (modelo_id, tenant_id) VALUES ($1, $2) RETURNING id`,
            [M, T],
          );
          await c.query("SET LOCAL session_replication_role = origin");
          await segunda.query("BEGIN");
          await segunda.query("SET LOCAL lock_timeout = '2s'");
          await segunda.query(
            `SELECT pg_advisory_xact_lock(hashtext('cad:modelo_id:' || $1::text))`,
            [M],
          );
          await c.query("SET LOCAL lock_timeout = '300ms'");
          const err = await erroDe(c, `SELECT public.enviar_modelo_para_cad($1)`, [M]);
          expect(err.code).toBe("55P03");
          await segunda.query("ROLLBACK");
          await c.query("SET LOCAL lock_timeout = '3s'");
          const r = await um<{ id: string }>(c, `SELECT public.enviar_modelo_para_cad($1) AS id`, [
            M,
          ]);
          expect(r.id).toBe(cad.id); // caminho idempotente: devolve o CAD existente
        });
      } finally {
        await segunda.query("ROLLBACK").catch(() => {});
        await segunda.end();
      }
    });
    it("a chave do lock é a MESMA do enforce_unique_fk de cad.modelo_id (TG_TABLE_NAME:coluna:valor)", async () => {
      await tx(async (c) => {
        const src = (
          await um<{ s: string }>(
            c,
            `SELECT prosrc AS s FROM pg_proc WHERE oid = 'public.enforce_unique_fk()'::regprocedure`,
          )
        ).s;
        expect(src).toContain("hashtext(TG_TABLE_NAME || ':' || v_col || ':' || v_val::text)");
        const env = (
          await um<{ s: string }>(
            c,
            `SELECT prosrc AS s FROM pg_proc WHERE oid = 'public._enviar_modelo_para_cad_core(uuid,text,text)'::regprocedure`,
          )
        ).s;
        expect(env).toContain(
          "pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text))",
        );
      });
    });
  },
);

// ─────────────────────────────── R14 msg reprovado — Explosão e gate 'ref' ───────────────────────────────
// Contra o texto antigo: Explosão recusava com "precisa estar na etapa ..." e o gate 'ref' dizia "A REF aparece a partir...".
describe.skipIf(!LOCAL)(
  "L3 — mensagem do reprovado (Explosão + Integração), anti-drift SQL × TS",
  () => {
    it("chave ligada + Reprovado: Explosão recusa com 'reprovado_explosao:' (ASCII) = TS gateEnvioExplosao; stand_by é controle", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await comoUsuario(c);
        await configurarBoard(c);
        const R = await cardFixado(c, ATE_C, "reprovado");
        const S = await cardFixado(c, {}, "stand_by");
        await chave(c, true);
        const err = await erroDe(c, `SELECT public.enviar_modelo_para_cad($1)`, [R]);
        expect(err.code).toBe("P0001");
        expect(err.message).toBe("reprovado_explosao: Card reprovado nao vai a Explosao");
        expect(/^[\x20-\x7E]*$/.test(err.message)).toBe(true);
        expect(mensagemErro(err)).toBe(TEXTO_REPROVADO_EXPLOSAO);
        const cfgRow = (
          await um<{ j: Record<string, unknown> }>(
            c,
            `SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tenant_id = $1`,
            [T],
          )
        ).j;
        const tsR = gateEnvioExplosao({
          cfg: lerKanbanAutoConfig(cfgRow),
          explosaoEnvioStatus: "etapa_c",
          statusCru: "reprovado",
          derivacao: await derivacao(c, R),
          condProntas: true,
        });
        expect([tsR.ok, tsR.reprovado, tsR.motivo]).toEqual([
          false,
          true,
          TEXTO_REPROVADO_EXPLOSAO,
        ]);
        // controle: stand_by sem condições → derivada na entrada → recusa pela ETAPA (mensagem de sempre)
        const errS = await erroDe(c, `SELECT public.enviar_modelo_para_cad($1)`, [S]);
        expect(errS.message).toMatch(/precisa estar na etapa "Etapa C"/);
        const tsS = gateEnvioExplosao({
          cfg: lerKanbanAutoConfig(cfgRow),
          explosaoEnvioStatus: "etapa_c",
          statusCru: "stand_by",
          derivacao: await derivacao(c, S),
          condProntas: true,
        });
        expect([tsS.ok, tsS.reprovado]).toEqual([false, false]);
      });
    });
    // Leves L3 fix round 2 (ruling do controlador): reprovado no Dev também com a chave DESLIGADA nunca revela nem vai à Explosão.
    it("chave DESLIGADA + Reprovado no Dev (depois da etapa no board): editar não revela a REF; Explosão recusada (SQL = TS)", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await comoUsuario(c);
        await configurarBoard(c);
        // entra em Reprovado por uma edição (status muda = relevante p/ o fn_modelo_ref_auto); controle vai p/ Aprovado
        const R = await cardFixado(c, {}, "entrada", "L3 F2 reprovado");
        const A = await cardFixado(c, {}, "entrada", "L3 F2 controle");
        await setar(c, R, { status_desenvolvimento: "reprovado" });
        await setar(c, A, { status_desenvolvimento: "aprovado" });
        expect((await lerModelo(c, R)).ref ?? "").toBe("");
        const a = await lerModelo(c, A);
        expect(a.ref).toBe(a.ref_auto);
        expect((await um<{ g: string | null }>(c, `SELECT public._kanban_status_gate($1, $2, 'reprovado') AS g`, [T, R])).g).toBeNull();
        const err = await erroDe(c, `SELECT public.enviar_modelo_para_cad($1)`, [R]);
        expect(err.message).toBe("reprovado_explosao: Card reprovado nao vai a Explosao");
        expect(mensagemErro(err)).toBe(TEXTO_REPROVADO_EXPLOSAO);
        const ts = gateEnvioExplosao({
          cfg: lerKanbanAutoConfig(await cfgDaLoja(c)),
          explosaoEnvioStatus: "etapa_c",
          statusCru: "reprovado",
          derivacao: null,
          condProntas: true,
        });
        expect([ts.ok, ts.reprovado, ts.motivo]).toEqual([false, true, TEXTO_REPROVADO_EXPLOSAO]);
        expect(statusParaGate(false, null, "reprovado")).toBeNull();
        const gr = (await um<{ g: { ok: boolean; motivo: string } }>(c, `SELECT public._integracao_gates($1) -> 'ref' AS g`, [R])).g;
        expect(gr).toMatchObject({ ok: false, motivo: "Card reprovado não revela a REF (nem muda a REF já gravada)." });
      });
    });
    it("Integração: gate 'ref' do reprovado diz 'Card reprovado não revela a REF…'; stand_by na mesma posição abre", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await comoUsuario(c);
        await configurarBoard(c);
        await chave(c, true);
        const R = await cardFixado(c, ATE_C, "reprovado");
        const S = await cardFixado(c, ATE_C, "stand_by");
        const g = async (id: string) =>
          (
            await um<{ g: { ok: boolean; motivo: string | null } }>(
              c,
              `SELECT public._integracao_gates($1) -> 'ref' AS g`,
              [id],
            )
          ).g;
        const gr = await g(R);
        expect(gr.ok).toBe(false);
        expect(gr.motivo).toBe("Card reprovado não revela a REF (nem muda a REF já gravada).");
        const gs = await g(S);
        expect(gs.ok).toBe(true);
      });
    });
  },
);

// ─────────────────────────────── kanban #18 — sigla só letras + Formato exige "numero" ───────────────────────────────
describe.skipIf(!LOCAL)(
  "L3 kanban #18 — Formato da REF (salvar_config_loja + _ref_sigla_cfg_item) × TS",
  () => {
    it("sigla com dígito é RECUSADA (P0001 'ref_sigla_com_digito:'); sem dígito passa; TS problemaFormatoRef concorda", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await usuarioAdmin(c);
        const comDigito: RefConfig = {
          partes: ["grupo", "numero"],
          sigla_taxonomia: { "00000000-0000-4000-8000-0000000000c1": "AB1" },
        };
        const err = await erroSalvarConfig(c, { ref_config: comDigito });
        expect(err.code).toBe("P0001");
        expect(err.message).toBe("ref_sigla_com_digito: AB1");
        expect(mensagemErro(err)).toBe(problemaFormatoRef(comDigito));
        const ok: RefConfig = {
          partes: ["grupo", "numero"],
          sigla_taxonomia: { "00000000-0000-4000-8000-0000000000c1": "AB" },
        };
        expect(problemaFormatoRef(ok)).toBeNull();
        expect((await salvarConfig(c, { ref_config: ok })).r.gravadas).toEqual(["ref_config"]);
      });
    });
    it("partes sem 'numero' é RECUSADO ([] e ['grupo']); com 'numero' / sem partes / NULL passam; TS concorda caso a caso", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await usuarioAdmin(c);
        const casos: { cfg: RefConfig | null; recusa: boolean }[] = [
          { cfg: { partes: [] }, recusa: true },
          { cfg: { partes: ["grupo", "categoria"] }, recusa: true },
          { cfg: { partes: ["familia", "numero"] }, recusa: false },
          { cfg: { partes: ["numero"] }, recusa: false },
          { cfg: { num_digitos: 6 }, recusa: false }, // sem partes = fallback histórico (com número)
          { cfg: null, recusa: false },
        ];
        for (const k of casos) {
          expect(problemaFormatoRef(k.cfg) != null, JSON.stringify(k.cfg)).toBe(k.recusa);
          if (k.recusa) {
            const err = await erroSalvarConfig(c, { ref_config: k.cfg });
            expect(err.code, JSON.stringify(k.cfg)).toBe("P0001");
            expect(err.message).toMatch(/^ref_formato_sem_numero:/);
            expect(mensagemErro(err)).toBe(problemaFormatoRef(k.cfg));
          } else {
            expect(
              (await salvarConfig(c, { ref_config: k.cfg })).r.gravadas,
              JSON.stringify(k.cfg),
            ).toEqual(["ref_config"]);
          }
        }
      });
    });
    it("_ref_sigla_cfg_item (sigla JÁ gravada) descarta dígitos = TS siglaConfiguradaItem (anti-drift)", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        const ids = [
          "00000000-0000-4000-8000-0000000000d1",
          "00000000-0000-4000-8000-0000000000d2",
          "00000000-0000-4000-8000-0000000000d3",
          "00000000-0000-4000-8000-0000000000d4",
        ];
        const siglas = ["Ab1c", "Á-2b", "x9", "manga curta"];
        const cfg: RefConfig = {
          partes: ["grupo", "numero"],
          sigla_taxonomia: Object.fromEntries(ids.map((id, i) => [id, siglas[i]])),
        };
        // grava direto (config "legada" com dígito) — a recusa é do salvar_config_loja, o helper tem de aguentar o que já está lá
        await c.query(
          `UPDATE public.tenant_config SET ref_config = $2::jsonb WHERE tenant_id = $1`,
          [T, JSON.stringify(cfg)],
        );
        for (const id of ids) {
          const sql = (
            await um<{ s: string }>(c, `SELECT public._ref_sigla_cfg_item($1, $2) AS s`, [T, id])
          ).s;
          expect(sql, id).toBe(siglaConfiguradaItem(cfg, id));
          expect(/[0-9]/.test(sql)).toBe(false);
        }
        expect(siglaConfiguradaItem(cfg, ids[0])).toBe("ABC");
        expect(siglaConfiguradaItem(cfg, ids[2])).toBe("X");
      });
    });
  },
);

// ─────────────────────────────── sku #5 — réplica só na mesma família ───────────────────────────────
// Contra o texto antigo (4350d324/4c19c6a4/3b2e4c34): mesma REF + mesma cor/tamanho bastava → a outra família passava.
describe.skipIf(!LOCAL)("L3 sku #5 — SKU repetido só entre versões da MESMA família", () => {
  async function tres(c: Client) {
    const REF = "L3SKUREF1";
    const A = await comoSistema(c, () =>
      novoModelo(c, { ordem_criacao_enviada: false, ref: REF, nome: "L3 sku A" }),
    );
    const A2 = await comoSistema(c, () =>
      novoModelo(c, {
        ordem_criacao_enviada: false,
        ref: REF,
        nome: "L3 sku A v2",
        modelo_base_id: A,
        versao: 2,
      }),
    );
    const B = await comoSistema(c, () =>
      novoModelo(c, { ordem_criacao_enviada: false, ref: REF, nome: "L3 sku B (outra família)" }),
    );
    const vk = "00000000-0000-4000-8000-0000000000e1";
    await c.query(
      `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, 'P', 'L3SKUX')`,
      [T, A, vk],
    );
    return { REF, A, A2, B, vk };
  }
  it("gatilho: réplica da MESMA família passa; OUTRA família com a mesma REF → 23505", async () => {
    await tx(async (c) => {
      await c.query("SET LOCAL lock_timeout = '3s'");
      const { A2, B, vk } = await tres(c);
      await c.query(
        `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, 'P', 'L3SKUX')`,
        [T, A2, vk],
      );
      const err = await erroDe(
        c,
        `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, 'P', 'L3SKUX')`,
        [T, B, vk],
      );
      expect(err.code).toBe("23505");
      expect(err.message).toMatch(/L3SKUX/);
    });
  });
  it("_skus_plano (prévia do SKU à mão): outra família = erro 'já existe em'; mesma família = sem erro", async () => {
    await tx(async (c) => {
      await c.query("SET LOCAL lock_timeout = '3s'");
      const { REF, A2, B, vk } = await tres(c);
      for (const M of [A2, B]) {
        await c.query(
          `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, 'P', $4)`,
          [T, M, vk, "L3SKUY" + M.slice(0, 4)],
        );
      }
      const plano = async (M: string) =>
        (
          await um<{ p: { erros: { mensagem: string }[] } }>(
            c,
            `SELECT public._skus_plano($1, $2, 'letra', $3::jsonb, 'manuais') AS p`,
            [
              M,
              REF,
              JSON.stringify([{ variante_key: vk, tamanho_key: "P", sku: "L3SKUX", rev: 0 }]),
            ],
          )
        ).p;
      expect((await plano(A2)).erros).toEqual([]);
      const pb = await plano(B);
      expect(pb.erros.length).toBe(1);
      expect(pb.erros[0].mensagem).toMatch(/^O SKU L3SKUX já existe em L3 sku A/);
    });
  });
  it("_salvar_sku_manual_core: outra família → P0001 'já existe em' (não o P0409 falso de 'outra pessoa')", async () => {
    await tx(async (c) => {
      await c.query("SET LOCAL lock_timeout = '3s'");
      const { B, vk } = await tres(c);
      const linhaB = await um<{ id: string }>(
        c,
        `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, 'P', 'L3SKUYB') RETURNING id`,
        [T, B, vk],
      );
      const err = await erroDe(
        c,
        `SELECT public._salvar_sku_manual_core($1, 'L3SKUX', 0, NULL, NULL, NULL)`,
        [linhaB.id],
      );
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/^O SKU L3SKUX já existe em L3 sku A/);
    });
  });
});

// ─────────────────────────────── kanban #21 (P-211 A) — prévia + revelar no Salvar ───────────────────────────────
async function retratoLoja(c: Client): Promise<string> {
  return (
    await um<{ h: string }>(
      c,
      `SELECT md5(coalesce((SELECT string_agg(m.id::text || '|' || coalesce(m.ref, '') || '|' || coalesce(m.ref_auto, '') || '|' || m.rev::text, ',' ORDER BY m.id)
                            FROM public.modelos m WHERE m.tenant_id = $1), '')
                || (SELECT to_jsonb(tc)::text FROM public.tenant_config tc WHERE tc.tenant_id = $1)) AS h`,
      [T],
    )
  ).h;
}
type Previa = {
  etapa: string;
  total: number;
  amostra: { modelo_id: string; ref_auto: string }[];
  limite_amostra: number;
  travadas_integracao: number;
};
async function previaRef(c: Client, etapa: string | null): Promise<Previa> {
  return (await um<{ p: Previa }>(c, `SELECT public.ref_previa_revelar($1, $2) AS p`, [T, etapa]))
    .p;
}
async function candidatos(c: Client, etapa: string): Promise<string[]> {
  return (
    await c.query(
      `SELECT modelo_id FROM public._ref_revelar_candidatos($1, $2) WHERE NOT travada ORDER BY modelo_id`,
      [T, etapa],
    )
  ).rows.map((r) => r.modelo_id);
}

describe.skipIf(!LOCAL)(
  "L3 kanban #21 (P-211 A) — prévia 'N REFs serão reveladas' e revelação no Salvar",
  () => {
    it("chave DESLIGADA: prévia conta certo e NÃO grava; o Salvar revela os mesmos (refs_reveladas = total); reprovado nunca", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await c.query("SET LOCAL statement_timeout = '60s'");
        await configurarBoard(c, "etapa_c");
        const A = await cardFixado(c, {}, "etapa_b", "L3 P211 A");
        const B = await cardFixado(c, {}, "entrada", "L3 P211 B");
        const R = await cardFixado(c, {}, "reprovado", "L3 P211 R"); // 'reprovado' DEPOIS da etapa no board
        await usuarioAdmin(c);
        const antes = await retratoLoja(c);
        const p = await previaRef(c, "etapa_a");
        expect(await retratoLoja(c)).toBe(antes); // a prévia não grava nada
        const ids = p.amostra.map((x) => x.modelo_id);
        expect(p.etapa).toBe("etapa_a");
        expect(ids).toContain(A);
        expect(ids).not.toContain(B);
        expect(ids).not.toContain(R); // P-190 A: nunca revela reprovado (posição pelo board ≥ etapa_a)
        const lista = await candidatos(c, "etapa_a");
        expect(p.total).toBe(lista.length);
        expect(p.amostra.length).toBe(Math.min(p.total, p.limite_amostra));
        // Salvar a etapa nova: revela NA HORA, na mesma transação
        const s = await salvarConfig(c, { ref_exibir_status: "etapa_a" });
        expect(s.r.refs_reveladas).toBe(p.total);
        const a = await lerModelo(c, A);
        expect(a.ref).toBe(a.ref_auto);
        expect((await lerModelo(c, B)).ref ?? "").toBe("");
        expect((await lerModelo(c, R)).ref ?? "").toBe("");
        for (const id of lista) {
          const m = await lerModelo(c, id);
          expect(m.ref, id).toBe(m.ref_auto);
        }
        // depois de salvar não sobra candidato na etapa gravada (o trigger e o lote concordam)
        expect(await candidatos(c, "etapa_a")).toEqual([]);
      });
    });

    it("chave LIGADA: reprovado fixado com a posição DERIVADA depois da etapa NÃO revela; stand_by (controle) revela", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await c.query("SET LOCAL statement_timeout = '60s'");
        await configurarBoard(c, "aprovado");
        await chave(c, true);
        const R = await cardFixado(c, ATE_C, "reprovado", "L3 P211 R2");
        const S = await cardFixado(c, ATE_C, "stand_by", "L3 P211 S2");
        await usuarioAdmin(c);
        const p = await previaRef(c, "etapa_c");
        const ids = await candidatos(c, "etapa_c");
        expect(ids).toContain(S);
        expect(ids).not.toContain(R);
        expect(p.total).toBe(ids.length);
        const s = await salvarConfig(c, { ref_exibir_status: "etapa_c" });
        expect(s.r.refs_reveladas).toBe(p.total);
        const sm = await lerModelo(c, S);
        expect(sm.ref).toBe(sm.ref_auto);
        expect((await lerModelo(c, R)).ref ?? "").toBe("");
      });
    });

    it("Salvar SEM a etapa da REF não revela nada (refs_reveladas = 0); prévia de outra loja → P0001; sem admin → 42501", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c, "etapa_c");
        const A = await cardFixado(c, {}, "etapa_b", "L3 P211 A3");
        await usuarioAdmin(c);
        const s = await salvarConfig(c, { keywords: "l3 teste" });
        expect(s.r.refs_reveladas).toBe(0);
        expect((await lerModelo(c, A)).ref ?? "").toBe("");
        const outra = await erroDe(
          c,
          `SELECT public.ref_previa_revelar('00000000-0000-4000-8000-0000000000f1'::uuid, 'etapa_a')`,
        );
        expect(outra.code).toBe("P0001");
        await comoUsuario(c, "00000000-0000-4000-8000-00000000ab01"); // usuário sem linha/sem papel
        const sem = await erroDe(c, `SELECT public.ref_previa_revelar($1, 'etapa_a')`, [T]);
        expect(sem.code).toBe("42501");
      });
    });

    it("anti-drift: _ref_exibir_gate_etapa(t, s, e) ≡ _ref_exibir_gate(t, s) com e gravada ≡ TS refCampoVisivel", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c, "etapa_c");
        const keys = [
          "entrada",
          "etapa_a",
          "etapa_b",
          "stand_by",
          "etapa_c",
          "reprovado",
          "aprovado",
        ];
        const etapas: (string | null)[] = [...keys, "", null, "coluna_orfa"];
        const status: (string | null)[] = [...keys, "coluna_orfa", null];
        let n = 0;
        for (const e of etapas) {
          await c.query(
            `UPDATE public.tenant_config SET ref_exibir_status = $2 WHERE tenant_id = $1`,
            [T, e],
          );
          for (const s of status) {
            const r = await um<{ g: boolean; ge: boolean }>(
              c,
              `SELECT public._ref_exibir_gate($1, $2) AS g, public._ref_exibir_gate_etapa($1, $2, $3) AS ge`,
              [T, s, e],
            );
            expect(r.ge, `etapa=${e} status=${s}`).toBe(r.g);
            expect(refCampoVisivel(BOARD_GATE, e, s), `TS etapa=${e} status=${s}`).toBe(r.g);
            n++;
          }
        }
        expect(n).toBe(etapas.length * status.length);
      });
    });
  },
);

// ═══════════════════════════════════════ FIX ROUND 1 (G-MIGRATION L3) ═══════════════════════════════════════
async function planReprovado(c: Client, M: string) {
  await comoSistema(c, () =>
    c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [M]),
  );
}
async function setar(c: Client, id: string, campos: Record<string, unknown>) {
  const nomes = Object.keys(campos);
  await c.query(
    `UPDATE public.modelos SET ${nomes.map((n, i) => `${n} = $${i + 2}`).join(", ")} WHERE id = $1`,
    [id, ...Object.values(campos)],
  );
}
async function cfgDaLoja(c: Client) {
  return (
    await um<{ j: Record<string, unknown> }>(
      c,
      `SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tenant_id = $1`,
      [T],
    )
  ).j;
}

// A1 / P-213 A: reprovado = Dev OU Planejamento. Contra a round 0 (só o Dev): o lote revelava, o gatilho revelava, a Explosão
// recusava pela ETAPA (não pelo reprovado) e o gate de TS/SQL dava posição.
describe.skipIf(!LOCAL)(
  "L3 fix 1 — A1: reprovado só no PLANEJAMENTO nunca revela a REF nem vai à Explosão",
  () => {
    it("chave DESLIGADA: fora do lote do Salvar, o gatilho por card não revela, Explosão recusada (SQL = TS), gate 'ref' com o motivo", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await c.query("SET LOCAL statement_timeout = '60s'");
        await configurarBoard(c, "etapa_c");
        const P = await cardFixado(c, {}, "etapa_b", "L3 F1 plan reprovado");
        const S = await cardFixado(c, {}, "etapa_b", "L3 F1 controle");
        await planReprovado(c, P);
        const ids = await candidatos(c, "etapa_a");
        expect(ids).toContain(S);
        expect(ids).not.toContain(P);
        expect(
          (
            await um<{ g: string | null }>(
              c,
              `SELECT public._kanban_status_gate($1, $2, 'etapa_b') AS g`,
              [T, P],
            )
          ).g,
        ).toBeNull();
        expect(
          (
            await um<{ g: string | null }>(
              c,
              `SELECT public._kanban_status_gate($1, $2, 'etapa_b') AS g`,
              [T, S],
            )
          ).g,
        ).toBe("etapa_b");
        // gatilho por card: o card chega na etapa da REF (aprovado ≥ etapa_c) — o controle revela, o reprovado no Planejamento não
        const Q = await cardFixado(c, {}, "entrada", "L3 F1 controle 2");
        await setar(c, P, { status_desenvolvimento: "aprovado" });
        await setar(c, Q, { status_desenvolvimento: "aprovado" });
        expect((await lerModelo(c, P)).ref ?? "").toBe("");
        const q = await lerModelo(c, Q);
        expect(q.ref).toBe(q.ref_auto);
        // Explosão: recusa pelo reprovado (não pela etapa) — SQL = TS
        await comoUsuario(c);
        const err = await erroDe(c, `SELECT public.enviar_modelo_para_cad($1)`, [P]);
        expect(err.message).toBe("reprovado_explosao: Card reprovado nao vai a Explosao");
        const ts = gateEnvioExplosao({
          cfg: lerKanbanAutoConfig(await cfgDaLoja(c)),
          explosaoEnvioStatus: "etapa_c",
          statusCru: "aprovado",
          derivacao: null,
          condProntas: true,
          statusPlanejamento: "reprovado",
        });
        expect([ts.ok, ts.reprovado, ts.motivo]).toEqual([false, true, TEXTO_REPROVADO_EXPLOSAO]);
        expect(statusParaGate(false, null, "aprovado", "reprovado")).toBeNull();
        const gr = (
          await um<{ g: { ok: boolean; motivo: string } }>(
            c,
            `SELECT public._integracao_gates($1) -> 'ref' AS g`,
            [P],
          )
        ).g;
        expect(gr).toMatchObject({
          ok: false,
          motivo: "Card reprovado não revela a REF (nem muda a REF já gravada).",
        });
        // o Salvar da etapa não revela o reprovado no Planejamento
        await usuarioAdmin(c);
        await salvarConfig(c, { ref_exibir_status: "etapa_a" });
        expect((await lerModelo(c, P)).ref ?? "").toBe("");
      });
    });

    it("chave LIGADA: motor (_kanban_aplicar) e prévia do kanban não revelam o reprovado no Planejamento; stand_by é controle", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c, "etapa_c");
        await chave(c, true);
        const F = await cardFixado(c, ATE_C, "stand_by", "L3 F1 fixado plan reprovado");
        const G = await cardFixado(c, ATE_C, "stand_by", "L3 F1 fixado controle");
        await planReprovado(c, F);
        await usuarioAdmin(c);
        const p = await um<{ p: { refs_reveladas: { modelo_id: string }[] } }>(
          c,
          `SELECT public.kanban_previa_recalculo('{}'::jsonb) AS p`,
        );
        const reveladas = p.p.refs_reveladas.map((x) => x.modelo_id);
        expect(reveladas).toContain(G);
        expect(reveladas).not.toContain(F);
        await um(c, `SELECT public._kanban_aplicar($1, ARRAY[$2, $3]::uuid[], 'auto') AS n`, [
          T,
          F,
          G,
        ]);
        expect((await lerModelo(c, F)).ref ?? "").toBe("");
        const g = await lerModelo(c, G);
        expect(g.ref).toBe(g.ref_auto);
        await comoUsuario(c);
        expect((await erroDe(c, `SELECT public.enviar_modelo_para_cad($1)`, [F])).message).toMatch(
          /^reprovado_explosao:/,
        );
      });
    });

    it("cópia (Ave Rara): TOP ALICIA e VESTIDO ASSIMETRICO BIANCA (reprovados só no Planejamento) sem posição e fora do lote em TODA etapa", async () => {
      await tx(async (c) => {
        const { rows } = await c.query(
          `SELECT m.id, m.tenant_id, m.status_desenvolvimento AS s FROM public.modelos m
          WHERE m.nome IN ('TOP ALICIA', 'VESTIDO ASSIMETRICO BIANCA') AND lower(coalesce(m.status_planejamento, '')) = 'reprovado'
            AND coalesce(m.ordem_criacao_enviada, false) AND coalesce(m.ref, '') = ''`,
        );
        expect(rows.length, "fixture da cópia: os 2 cards da Ave Rara").toBe(2);
        for (const r of rows) {
          expect(
            (
              await um<{ g: string | null }>(
                c,
                `SELECT public._kanban_status_gate($1, $2, $3) AS g`,
                [r.tenant_id, r.id, r.s],
              )
            ).g,
          ).toBeNull();
          const etapas = (
            await c.query(`SELECT key FROM public._kanban_status_rows($1)`, [r.tenant_id])
          ).rows.map((x) => x.key);
          expect(etapas.length).toBeGreaterThan(0);
          for (const e of etapas) {
            const n = await um<{ n: number }>(
              c,
              `SELECT count(*)::int AS n FROM public._ref_revelar_candidatos($1, $2) WHERE modelo_id = $3`,
              [r.tenant_id, e, r.id],
            );
            expect(n.n, `${r.id} etapa ${e}`).toBe(0);
          }
        }
      });
    });
  },
);

// M2: etapa da REF + Kanban no mesmo Salvar = recusa (contra a round 0: gravava os dois).
describe.skipIf(!LOCAL)("L3 fix 1 — M2: etapa da REF e Kanban em dois passos", () => {
  it("salvar_config_loja com ref_exibir_status + status_kanban (ou requisitos) → P0001 ref_etapa_com_kanban:, nada gravado", async () => {
    await tx(async (c) => {
      await c.query("SET LOCAL lock_timeout = '3s'");
      await configurarBoard(c, "etapa_c");
      await usuarioAdmin(c);
      const antes = await cfgDaLoja(c);
      for (const extra of [
        { status_kanban: BOARD_GATE },
        { kanban_requisitos: REQS_GATE },
        { revenda_kanban_colunas: [] },
      ]) {
        const mud = { ref_exibir_status: "etapa_a", ...extra };
        const base = Object.fromEntries(
          Object.keys(mud).map((k) => [k, (antes as Record<string, unknown>)[k] ?? null]),
        );
        const err = await erroDe(
          c,
          `SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, false)`,
          [T, JSON.stringify(mud), JSON.stringify(base)],
        );
        expect(err.code).toBe("P0001");
        expect(err.message).toMatch(/^ref_etapa_com_kanban:/);
        expect(mensagemErro(err)).toBe(TEXTO_REF_ETAPA_COM_KANBAN);
      }
      expect(await cfgDaLoja(c)).toEqual(antes);
    });
  });
});

// B9 — membro da loja SEM admin chamando a prévia (o round 0 só testou usuário sem linha).
describe.skipIf(!LOCAL)("L3 fix 1 — B9: ref_previa_revelar por membro não-admin da loja", () => {
  it("membro comum da Loja Teste → 42501 (a loja é a dele: não cai no teste de tenant)", async () => {
    await tx(async (c) => {
      const U = "c0f1c0f1-0000-4000-8000-0000000000b4";
      await c.query(
        `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [U, `${U}@teste`],
      );
      await c.query(
        `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, 'L3 membro')
                     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
        [U, T, `${U}@teste`],
      );
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: U, role: "authenticated" }),
      ]);
      expect((await um<{ t: string }>(c, "SELECT public.get_user_tenant_id()::text AS t")).t).toBe(
        T,
      );
      const err = await erroDe(c, `SELECT public.ref_previa_revelar($1, 'etapa_a')`, [T]);
      expect(err.code).toBe("42501");
      expect(err.message).toBe(
        "Apenas o administrador da loja pode salvar a Configuração da Loja.",
      );
    });
  });
});

// B4 — card com 'ref_sku' travado pela Integração fica fora da revelação e é contado.
describe.skipIf(!LOCAL)(
  "L3 fix 1 — B4: card travado pela Integração fica escondido e é contado",
  () => {
    it("prévia: fora de total/amostra, em travadas_integracao; Salvar: não revela e devolve refs_travadas_integracao", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c, "etapa_c");
        const A = await cardFixado(c, {}, "etapa_b", "L3 F1 travado");
        const B = await cardFixado(c, {}, "etapa_b", "L3 F1 livre");
        // sabotagem SÓ nesta txn: a Integração "trava" a REF de A
        await c.query(`CREATE OR REPLACE FUNCTION public._integracao_campo_travado(_modelo_id uuid, _campo text)
                     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
                     AS $f$ SELECT _modelo_id = '${A}'::uuid AND _campo = 'ref_sku' $f$`);
        await usuarioAdmin(c);
        const p = await previaRef(c, "etapa_a");
        const ids = p.amostra.map((x) => x.modelo_id);
        expect(ids).toContain(B);
        expect(ids).not.toContain(A);
        expect(p.travadas_integracao).toBe(1);
        const s = await salvarConfig(c, { ref_exibir_status: "etapa_a" });
        expect(
          (s.r as unknown as { refs_travadas_integracao: number }).refs_travadas_integracao,
        ).toBe(1);
        expect(s.r.refs_reveladas).toBe(p.total);
        expect((await lerModelo(c, A)).ref ?? "").toBe("");
        const b = await lerModelo(c, B);
        expect(b.ref).toBe(b.ref_auto);
      });
    });
  },
);

// B6 — sigla de FAMÍLIA só letras (servidor recusa; o helper descarta = TS).
describe.skipIf(!LOCAL)("L3 fix 1 — B6: sigla de família só letras", () => {
  it("salvar_config_loja recusa sigla de família com dígito; _ref_sigla_familia descarta o dígito = TS siglaFamilia", async () => {
    await tx(async (c) => {
      await c.query("SET LOCAL lock_timeout = '3s'");
      await usuarioAdmin(c);
      const cfg: RefConfig = {
        partes: ["familia", "numero"],
        sigla_familia: { interno: "P2", acabado: "R" },
      };
      const err = await erroSalvarConfig(c, { ref_config: cfg });
      expect(err.message).toBe("ref_sigla_com_digito: P2");
      expect(mensagemErro(err)).toBe(problemaFormatoRef(cfg));
      await c.query(`UPDATE public.tenant_config SET ref_config = $2::jsonb WHERE tenant_id = $1`, [
        T,
        JSON.stringify(cfg),
      ]);
      for (const f of ["interno", "acabado", "importado"] as const) {
        const sql = (
          await um<{ s: string }>(c, `SELECT public._ref_sigla_familia($1, $2) AS s`, [T, f])
        ).s;
        expect(sql, f).toBe(siglaFamilia(cfg, f));
      }
      expect(siglaFamilia(cfg, "interno")).toBe("P");
    });
  });
  it("Passo 0 na cópia: 0 siglas (taxonomia ou família) com dígito e 0 formatos sem 'numero'", async () => {
    await tx(async (c) => {
      const r = await um<{ dig: number; semnum: number }>(
        c,
        `SELECT (SELECT count(*)::int FROM public.tenant_config tc,
                        LATERAL (SELECT value FROM jsonb_each_text(CASE WHEN jsonb_typeof(tc.ref_config->'sigla_taxonomia') = 'object' THEN tc.ref_config->'sigla_taxonomia' ELSE '{}' END)
                                 UNION ALL
                                 SELECT value FROM jsonb_each_text(CASE WHEN jsonb_typeof(tc.ref_config->'sigla_familia') = 'object' THEN tc.ref_config->'sigla_familia' ELSE '{}' END)) s
                  WHERE s.value ~ '[0-9]') AS dig,
                (SELECT count(*)::int FROM public.tenant_config tc
                  WHERE jsonb_typeof(tc.ref_config->'partes') = 'array' AND NOT (tc.ref_config->'partes') ? 'numero') AS semnum`,
      );
      expect(r).toEqual({ dig: 0, semnum: 0 });
    });
  });
});

// M1 — orçamento: vários eventos no mesmo COMMIT com o orçamento esgotado = 1 lote só (contra a round 0: 1 lote por evento).
describe.skipIf(!LOCAL)("L3 fix 1 — M1: fila com N eventos e orçamento esgotado", () => {
  it("4 linhas, _kanban_aplicar lento e falhando: 1 lote + card a card até o orçamento; os outros eventos saem; < 5,5 s", async () => {
    await tx(async (c) => {
      const avisos: string[] = [];
      const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
      c.on("notice", ouvir);
      try {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await c.query("SET LOCAL statement_timeout = '60s'");
        await configurarBoard(c);
        await chave(c, true);
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) ids.push(await comoSistema(c, () => novoModelo(c)));
        await c.query(`DELETE FROM public.kanban_recalculo_fila`);
        await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                       RETURNS integer LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_sleep(1.2); RAISE EXCEPTION 'lento L3'; END $f$`);
        for (const id of ids)
          await c.query(
            `INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`,
            [id, T],
          );
        const t0 = Date.now();
        await imediato(c);
        const ms = Date.now() - t0;
        expect(avisos.filter((a) => /recalculo do lote falhou/.test(a)).length).toBe(1);
        expect(
          avisos.some((a) => /orcamento de tempo do COMMIT esgotado no card a card/.test(a)),
        ).toBe(true);
        expect(ms).toBeLessThan(5500);
        expect((await filaIds(c)).sort()).toEqual([...ids].sort()); // ninguém se perdeu
      } finally {
        c.off("notice", ouvir);
      }
    });
  });
});

// B5 — card que sobrou na fila volta a ser processado quando ELE MESMO é editado (contra a round 0: DO NOTHING, sem evento).
describe.skipIf(!LOCAL)(
  "L3 fix 1 — B5: o card que ficou na fila é refeito quando ele mesmo é enfileirado de novo",
  () => {
    it("falha → fica na fila; aplicador volta ao normal; _kanban_enfileirar(do próprio card) rearma e o COMMIT o processa", async () => {
      await tx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c);
        await chave(c, true);
        const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
        await c.query(`DELETE FROM public.kanban_recalculo_fila`);
        const original = (
          await um<{ d: string }>(
            c,
            `SELECT pg_get_functiondef('public._kanban_aplicar(uuid,uuid[],text,uuid)'::regprocedure) AS d`,
          )
        ).d;
        await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                     RETURNS integer LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'sabotagem B5'; END $f$`);
        // a linha nasce numa SUBtransação (xmin ≠ xid da transação): é a "linha de uma transação anterior" do ponto de vista do rearme
        await c.query("SAVEPOINT b5");
        await c.query(
          `INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`,
          [M, T],
        );
        await c.query("RELEASE SAVEPOINT b5");
        await imediato(c);
        expect(await filaIds(c)).toEqual([M]);
        await c.query(original); // o aplicador volta ao normal
        await c.query(`SELECT public._kanban_enfileirar(ARRAY[$1]::uuid[])`, [M]);
        await imediato(c);
        expect(await filaIds(c)).toEqual([]);
        expect((await lerModelo(c, M)).status).toBe("etapa_a");
      });
    });
  },
);
