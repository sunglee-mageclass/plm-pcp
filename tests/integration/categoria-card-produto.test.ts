/**
 * P-137 A — Categoria/Subcategorias do CARD comprado vão para o produto espelho (Acabado E Importado), coluna a coluna.
 * Migrations: supabase/migrations/20261017100000_categoria_card_para_produto.sql (gatilho) e
 *             supabase/migrations/20261017110000_categoria_card_para_produto_backfill.sql (backfill único, P-144 A);
 * inversos em supabase/rollback/ (LIFO: backfill primeiro).
 * Regras (plan.md "Rulings do controlador" + "Respostas do dono"): coluna a coluna (R1, D8b); grupo só com a categoria
 * (P-143 A); NULL do card nunca copia (P-145 A + R3b); categoria sem grupo não copia (R3a); Acessórios × pedido = P0001
 * ASCII `categoria_acessorio_com_pedido:` em PA e PI (P-142 B / R3d); auditoria legível {campo:{de,para}} + _bkp (R2).
 *
 * ⚠️ Os blocos de banco SÓ rodam na CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres),
 * com as 2 migrations JÁ aplicadas de verdade (psql -f). Cada teste em BEGIN…ROLLBACK: NADA é gravado. Nenhum arquivo de
 * migration é aplicado dentro de transação aqui — o backfill é exercitado pelas funções que a migration instala
 * (_p137_backfill_rodar / _p137_backfill_desfazer). O bloco "estático" (só os arquivos + catálogo TS) roda sempre.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { CAMPOS, LAYOUT_KEYS } from "@/lib/integracao/campos";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261017100000_categoria_card_para_produto.sql";
const INV = "supabase/rollback/20261017100000_categoria_card_para_produto_down.sql";
const NEUTRALIZA = "supabase/rollback/20261017100000_categoria_card_para_produto_down_neutraliza.sql";
const MIG_B = "supabase/migrations/20261017110000_categoria_card_para_produto_backfill.sql";
const INV_B = "supabase/rollback/20261017110000_categoria_card_para_produto_backfill_down.sql";
const MD5_FN = "ea9edd59c5ec5eff207336dbe06a3499"; // função ATIVA (fix round 1: H1/M1)
const MD5_NEUTRA = "bb13fa0c820f96463b877f89f8e1085b"; // corpo no-op da volta de emergência (passo 1)
const MD5_TRG = "871039e642390c357188b6b2a1134d64";
const MD5_RODAR = "01191f62b141827f5f747fc5b44552fe";
const MD5_DESFAZER = "ead14b02eab972e833596fd6f2cf9702";
const MD5_CORE_P136 = "e5473bb29fa559408093d1a82c6ac11f";
// LEVES L8 (20261028200000) redefine _salvar_produto_acabado_core POR CIMA da P-136 (só preço M1 + sku #22; o trecho da P-136
// fica): com a L8 viva na cópia o md5 vivo é o dela (LIFO: o _down da L8 roda antes dos inversos da 20261017/20261016).
const MD5_CORE_L8 = "77076d81637354d530ee38a03e8f77e7";
const T = TENANT_TESTE;
const T2 = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // outra loja (Ave Rara) na cópia local
const LOCAL = ehBancoLocal();
const TAXONOMIA = /(categoria|subcategoria|grupo)/i;
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

// ─────────────────────────────── estático (sem banco) ───────────────────────────────
describe("P-137 categoria card → produto — arquivos (estático, sem banco)", () => {
  it("migration do gatilho: BEGIN/COMMIT, timeouts, guarda (P-136 md5 + travas + layout), SECURITY DEFINER, REVOKE dos 3, pós", () => {
    const m = ler(MIG);
    expect(m.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL statement_timeout = '10s';\n")).toBe(true);
    expect(m.trimEnd().endsWith("COMMIT;")).toBe(true);
    const guarda = m.slice(m.indexOf("DO $guarda$"), m.indexOf("END $guarda$"));
    expect(guarda).toContain(MD5_CORE_P136);
    expect(guarda).toContain("e239279ec27fe8257d31e262138b547e");
    expect(guarda).toContain("6e98c10d13c469a910c778f66354aac3");
    expect(guarda).toContain("_integracao_layout()");
    expect(guarda).toContain(`NOT IN ('${MD5_FN}', '${MD5_NEUTRA}')`); // reaplicar = no-op; neutralizada = religa
    const pos = m.slice(m.indexOf("DO $pos$"), m.indexOf("END $pos$"));
    expect(pos).toContain(`IS DISTINCT FROM '${MD5_FN}'`);
    expect(pos).toContain(`IS DISTINCT FROM '${MD5_TRG}'`);
    expect(pos).toContain(MD5_CORE_P136);
    expect(m).toMatch(/fn_modelo_espelho_categoria\(\)\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'/);
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public.fn_modelo_espelho_categoria() FROM PUBLIC, anon, authenticated;");
    expect(m).toContain("AFTER UPDATE OF categoria_principal_id, subcategoria1_id, subcategoria2_id ON public.modelos");
    expect(m).toContain("NEW.origem IN ('revenda', 'importado')");
    // retry só em 55P03
    expect(m).toContain("EXCEPTION WHEN lock_not_available THEN");
    expect(m).not.toMatch(/WHEN OTHERS/i);
    expect(m).not.toMatch(/^\s*\\/m); // nenhum meta-comando psql
  });

  it("inverso do gatilho: guarda md5 + LIFO (_bkp existe = PARE), DROP TRIGGER com lock_timeout e até 3 tentativas SÓ em 55P03", () => {
    const v = ler(INV);
    expect(v.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL statement_timeout = '10s';\n")).toBe(true);
    const guarda = v.slice(v.indexOf("DO $guarda$"), v.indexOf("END $guarda$"));
    expect(guarda).toContain("to_regclass('public._bkp_p137_backfill') IS NOT NULL");
    expect(guarda).toContain(`NOT IN ('${MD5_FN}', '${MD5_NEUTRA}')`); // aceita ativa OU neutralizada
    expect(guarda).toContain(MD5_TRG);
    const volta = v.slice(v.indexOf("DO $volta$"), v.indexOf("END $volta$"));
    expect(volta).toContain("FOR i IN 1..3 LOOP");
    expect(volta).toContain("DROP TRIGGER IF EXISTS trg_modelo_espelho_categoria ON public.modelos");
    expect(volta).toContain("EXCEPTION WHEN lock_not_available THEN");
    expect(volta).not.toMatch(/WHEN OTHERS/i);
    expect(v.indexOf("DROP FUNCTION IF EXISTS public.fn_modelo_espelho_categoria()")).toBeGreaterThan(v.indexOf("END $volta$"));
    expect(v.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("backfill: guarda (gatilho no ar, P-136, marcador de volta), _bkp com RLS + REVOKE ALL, funções DEFINER revogadas dos 3; inverso restaura do _bkp", () => {
    const b = ler(MIG_B);
    expect(b.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL statement_timeout = '20s';\n")).toBe(true);
    const guarda = b.slice(b.indexOf("DO $guarda$"), b.indexOf("END $guarda$"));
    for (const x of [MD5_FN, MD5_TRG, MD5_CORE_P136, MD5_RODAR, MD5_DESFAZER, "p137_backfill_revertido", "app.p137_apos_volta"]) {
      expect(guarda, x).toContain(x);
    }
    expect(b).toContain("ALTER TABLE public._bkp_p137_backfill ENABLE ROW LEVEL SECURITY;");
    expect(b).toContain("REVOKE ALL ON TABLE public._bkp_p137_backfill FROM PUBLIC, anon, authenticated, service_role;");
    expect(b).toContain("REVOKE EXECUTE ON FUNCTION public._p137_backfill_rodar() FROM PUBLIC, anon, authenticated, service_role;");
    expect(b).toContain("REVOKE EXECUTE ON FUNCTION public._p137_backfill_desfazer() FROM PUBLIC, anon, authenticated, service_role;");
    expect(b).toContain("'Sistema: categoria alinhada ao card (P-137) — '");
    expect(b.trimEnd().endsWith("COMMIT;")).toBe(true);
    const vb = ler(INV_B);
    expect(vb).toContain("public._p137_backfill_desfazer()");
    expect(vb).toContain("p137_backfill_revertido:");
    expect(vb).toContain("DROP TABLE IF EXISTS public._bkp_p137_backfill;");
    for (const txt of [b, vb]) expect(txt).not.toMatch(/^\s*\\/m);
  });

  it("volta de emergência (passo 1): troca o corpo por no-op SEM DDL em modelos; guarda ativa|neutra; pós confere md5 e ausência de lock em modelos", () => {
    const n = ler(NEUTRALIZA);
    expect(n.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL statement_timeout = '5s';\n")).toBe(true);
    const guarda = n.slice(n.indexOf("DO $guarda$"), n.indexOf("END $guarda$"));
    expect(guarda).toContain(`NOT IN ('${MD5_FN}', '${MD5_NEUTRA}')`);
    const pos = n.slice(n.indexOf("DO $pos$"), n.indexOf("END $pos$"));
    expect(pos).toContain(`IS DISTINCT FROM '${MD5_NEUTRA}'`);
    expect(pos).toContain("l.relation = 'public.modelos'::regclass");
    const semComentario = n.replace(/--[^\n]*/g, "");
    expect(semComentario).not.toMatch(/^\s*(DROP|ALTER|LOCK|TRUNCATE)\b/im); // nenhum comando que trave tabela
    expect(semComentario).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i);
    expect(semComentario).toContain("RETURN NEW;");
    expect(n).toContain("REVOKE EXECUTE ON FUNCTION public.fn_modelo_espelho_categoria() FROM PUBLIC, anon, authenticated;");
    expect(n.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("toda mensagem de RAISE EXCEPTION nos 5 arquivos é SÓ ASCII (regra RAISE 5xx) e a recusa usa o prefixo traduzido pela tela", () => {
    for (const rel of [MIG, INV, NEUTRALIZA, MIG_B, INV_B]) {
      const txt = ler(rel);
      const msgs = [...txt.matchAll(/raise exception '((?:[^']|'')*)'/gi)].map((r) => r[1]);
      expect(msgs.length, rel).toBeGreaterThanOrEqual(2);
      for (const s of msgs) expect(/^[\x20-\x7e]*$/.test(s), `${rel}: ${s}`).toBe(true);
    }
    expect(ler(MIG)).toContain("'categoria_acessorio_com_pedido: ");
  });

  it("ANTI-DRIFT: categoria/subcategoria/grupo NÃO são campos da Integração (catálogo TS) — se virarem, a trava do CARD tem de travar a categoria antes", () => {
    for (const k of LAYOUT_KEYS) expect(TAXONOMIA.test(k), `campo da Integração: ${k}`).toBe(false);
    for (const c of CAMPOS) expect(TAXONOMIA.test(String(c.coluna ?? "")), `coluna da Integração: ${String(c.coluna)}`).toBe(false);
  });
});

// ─────────────────────────────── banco (cópia local, migrations aplicadas) ───────────────────────────────
type Tx = {
  gV: string; gT: string; gA: string;
  catV1: string; catV2: string; catT: string; catA: string; catSemGrupo: string;
  s1V1a: string; s1V1b: string; s1V2: string; s1T: string; s1A: string;
  s2V1a: string; s2V1b: string; s2V2: string;
};
type Prod = { grupo: string | null; cat: string | null; s1: string | null; s2: string | null; rev: number };
type Card = { cat: string | null; s1: string | null; s2: string | null; rev: number; nome: string };
type Tipo = "PA" | "PI";
const TAB: Record<Tipo, string> = { PA: "produtos_acabados", PI: "produtos_importados" };
const ORIGEM: Record<Tipo, string> = { PA: "revenda", PI: "importado" };

const ins = async (c: Client, sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
async function taxonomia(c: Client, tenant = T): Promise<Tx> {
  const g = (nome: string) => ins(c, "INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome]);
  const cat = (nome: string, grupo: string | null) =>
    ins(c, "INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, $2, $3) RETURNING id", [tenant, nome, grupo]);
  const s1 = (nome: string, catId: string) =>
    ins(c, "INSERT INTO public.subcategorias1_produto (tenant_id, nome, categoria_id) VALUES ($1, $2, $3) RETURNING id", [tenant, nome, catId]);
  const s2 = (nome: string, catId: string) =>
    ins(c, "INSERT INTO public.subcategorias2_produto (tenant_id, nome, categoria_id) VALUES ($1, $2, $3) RETURNING id", [tenant, nome, catId]);
  const gV = await g("P137 Vestidos"), gT = await g("P137 Tops"), gA = await g("P137 Acessórios");
  const catV1 = await cat("P137 Longo", gV), catV2 = await cat("P137 Midi", gV), catT = await cat("P137 Blusa", gT);
  const catA = await cat("P137 Bolsa", gA), catSemGrupo = await cat("P137 Sem Grupo", null);
  return {
    gV, gT, gA, catV1, catV2, catT, catA, catSemGrupo,
    s1V1a: await s1("P137 Manga Curta", catV1), s1V1b: await s1("P137 Manga Longa", catV1), s1V2: await s1("P137 Alça", catV2),
    s1T: await s1("P137 Cropped", catT), s1A: await s1("P137 Clutch", catA),
    s2V1a: await s2("P137 Liso", catV1), s2V1b: await s2("P137 Estampado", catV1), s2V2: await s2("P137 Bordado", catV2),
  };
}
/** Produto + card espelho vinculados, com a MESMA taxonomia (ou a do card, se informada). Direto nas tabelas. */
async function par(c: Client, tipo: Tipo, p: { grupo: string | null; cat: string | null; s1?: string | null; s2?: string | null },
  card?: { cat: string | null; s1?: string | null; s2?: string | null; origem?: string }, tenant = T) {
  const pid = await ins(c, `INSERT INTO public.${TAB[tipo]} (tenant_id, nome, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id)
                            VALUES ($1, 'P137 Produto', $2, $3, $4, $5) RETURNING id`, [tenant, p.grupo, p.cat, p.s1 ?? null, p.s2 ?? null]);
  const k = card ?? { cat: p.cat, s1: p.s1, s2: p.s2 };
  const mid = await ins(c, `INSERT INTO public.modelos (tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id)
                            VALUES ($1, 'P137 Produto', $2, $3, $4, $5) RETURNING id`,
    [tenant, k.origem ?? ORIGEM[tipo], k.cat, k.s1 ?? null, k.s2 ?? null]);
  await c.query(`UPDATE public.${TAB[tipo]} SET modelo_id = $2 WHERE id = $1`, [pid, mid]);
  return { pid, mid };
}
const prod = (c: Client, tipo: Tipo, id: string) =>
  um<Prod>(c, `SELECT grupo_id AS grupo, categoria_id AS cat, subcategoria1_id AS s1, subcategoria2_id AS s2, rev
                 FROM public.${TAB[tipo]} WHERE id = $1`, [id]);
const card = (c: Client, id: string) =>
  um<Card>(c, `SELECT categoria_principal_id AS cat, subcategoria1_id AS s1, subcategoria2_id AS s2, rev, nome
                 FROM public.modelos WHERE id = $1`, [id]);
/** "Sheet do Planejamento" / qualquer gravador de modelos: UPDATE direto das colunas informadas. */
async function sheet(c: Client, mid: string, cols: Record<string, unknown>) {
  const ks = Object.keys(cols);
  await c.query(`UPDATE public.modelos SET ${ks.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [mid, ...ks.map((k) => cols[k])]);
}
async function comOc(c: Client, tipo: Tipo, pid: string) {
  if (tipo === "PA") {
    await c.query("INSERT INTO public.ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) VALUES ($1, 'P137 Produto', $2)", [T, pid]);
  } else {
    await c.query("INSERT INTO public.ocs_importado (tenant_id, nome_produto, produto_importado_id) VALUES ($1, 'P137 Produto', $2)", [T, pid]);
  }
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT p137_f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT p137_f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT p137_f");
    return `${e.code} ${e.message}`;
  }
}
async function prepara(c: Client): Promise<Tx> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await comoUsuario(c);
  return taxonomia(c);
}
const RECUSA = /^P0001 categoria_acessorio_com_pedido: /;

describe.skipIf(!(hasDb && LOCAL))("P-137 categoria card → produto — banco (cópia local)", () => {
  it("migrations aplicadas: md5 da função/gatilho/backfill; P-136 intacta; EXECUTE negado a PUBLIC/anon/authenticated (inv. #9); _bkp ilegível", async () => {
    await withTx(async (c) => {
      const r = await um<any>(c, `SELECT
          md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()'))) AS fn,
          (SELECT md5(pg_get_triggerdef(oid)) FROM pg_trigger WHERE tgname = 'trg_modelo_espelho_categoria') AS trg,
          (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'trg_modelo_espelho_categoria') AS ntrg,
          md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_rodar()'))) AS rodar,
          md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_desfazer()'))) AS desfazer,
          md5(pg_get_functiondef('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure)) AS core`);
      expect([MD5_CORE_P136, MD5_CORE_L8]).toContain(r.core);
      expect({ ...r, core: null }).toEqual({ fn: MD5_FN, trg: MD5_TRG, ntrg: 1, rodar: MD5_RODAR, desfazer: MD5_DESFAZER, core: null });
      for (const f of ["public.fn_modelo_espelho_categoria()", "public._p137_backfill_rodar()", "public._p137_backfill_desfazer()"]) {
        const a = await um<any>(c, `SELECT has_function_privilege('public', $1, 'EXECUTE') AS p,
            has_function_privilege('anon', $1, 'EXECUTE') AS a, has_function_privilege('authenticated', $1, 'EXECUTE') AS u`, [f]);
        expect(a, f).toEqual({ p: false, a: false, u: false });
      }
      for (const f of ["public._p137_backfill_rodar()", "public._p137_backfill_desfazer()"]) {
        expect((await um<any>(c, "SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS s", [f])).s, f).toBe(false);
      }
      const t = await um<any>(c, `SELECT has_table_privilege('anon', 'public._bkp_p137_backfill', 'SELECT') AS a,
          has_table_privilege('authenticated', 'public._bkp_p137_backfill', 'SELECT') AS u,
          has_table_privilege('service_role', 'public._bkp_p137_backfill', 'SELECT') AS s`);
      expect(t).toEqual({ a: false, u: false, s: false });
    });
  });

  it("ANTI-DRIFT (banco): _integracao_layout() sem categoria/subcategoria/grupo — senão a trava do card precisa travar a categoria", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query<{ campo: string }>("SELECT unnest(public._integracao_layout()) AS campo");
      expect(rows.length).toBeGreaterThan(0);
      for (const { campo } of rows) expect(TAXONOMIA.test(campo), campo).toBe(false);
      const fs = await c.query<{ n: string; d: string }>(`SELECT proname AS n, pg_get_functiondef(oid) AS d FROM pg_proc
          WHERE proname IN ('fn_integracao_trava_modelos', 'fn_integracao_trava_espelho')`);
      for (const f of fs.rows) expect(/categoria|subcategoria/i.test(f.d), f.n).toBe(false);
    });
  });

  for (const tipo of ["PA", "PI"] as Tipo[]) {
    it(`${tipo}: Sheet troca categoria+subs do card -> produto recebe grupo/categoria/subs; rev do produto +1, card +1 (sem 2º bump)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const { pid, mid } = await par(c, tipo, { grupo: k.gV, cat: k.catV1, s1: k.s1V1a, s2: k.s2V1a });
        const p0 = await prod(c, tipo, pid), c0 = await card(c, mid);
        await sheet(c, mid, { categoria_principal_id: k.catT, subcategoria1_id: k.s1T, subcategoria2_id: null });
        const p1 = await prod(c, tipo, pid);
        // P-143 A: grupo acompanha a categoria. H1 (fix round 1): com a categoria copiada, a sub2 do produto ("Liso", de
        // Longo) NÃO pertence a "Blusa" -> é limpa (nunca sub órfã), mesmo com a sub2 do card NULL.
        expect(p1).toMatchObject({ grupo: k.gT, cat: k.catT, s1: k.s1T, s2: null });
        expect(p1.rev).toBe(p0.rev + 1);
        expect((await card(c, mid)).rev).toBe(c0.rev + 1);
      });
    });

    it(`${tipo}: coluna a coluna — só a sub2 muda no card -> só a sub2 do produto muda (grupo divergente fica, nada de carona)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        // produto na MESMA categoria do card, mas com grupo divergente (legado) e sub1 própria
        const { pid, mid } = await par(c, tipo, { grupo: k.gT, cat: k.catV1, s1: k.s1V1b }, { cat: k.catV1, s1: k.s1V1a, s2: k.s2V1a });
        const p0 = await prod(c, tipo, pid);
        await sheet(c, mid, { subcategoria2_id: k.s2V1b });
        expect(await prod(c, tipo, pid)).toEqual({ grupo: k.gT, cat: k.catV1, s1: k.s1V1b, s2: k.s2V1b, rev: p0.rev + 1 });
      });
    });

    it(`${tipo}: M1 — troca SÓ da sub no card não vai a produto de OUTRA categoria (cenário "Cinto Teste": produto em Acessórios sem categoria)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const { pid, mid } = await par(c, tipo, { grupo: k.gA, cat: null }, { cat: k.catV1, s1: null, s2: null });
        await comOc(c, tipo, pid);
        const p0 = await prod(c, tipo, pid);
        await sheet(c, mid, { subcategoria1_id: k.s1V1a });
        await sheet(c, mid, { subcategoria2_id: k.s2V1a });
        expect(await prod(c, tipo, pid)).toEqual(p0); // nem sub de "Longo" num produto sem categoria, nem recusa
        const outro = await par(c, tipo, { grupo: k.gT, cat: k.catT, s1: k.s1T }, { cat: k.catV1 });
        const o0 = await prod(c, tipo, outro.pid);
        await sheet(c, outro.mid, { subcategoria1_id: k.s1V1a });
        expect(await prod(c, tipo, outro.pid)).toEqual(o0); // produto em "Blusa" não recebe sub de "Longo"
      });
    });

    it(`${tipo}: H1 — categoria copiada: sub do produto que VALE para a categoria nova fica; a que não vale é limpa`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        // produto com sub1 de Longo e sub2 "Bordado" (que pertence a Midi) — card vai para Midi com as subs vazias
        const { pid, mid } = await par(c, tipo, { grupo: k.gV, cat: k.catV1, s1: k.s1V1a, s2: k.s2V2 }, { cat: k.catV1, s1: k.s1V1a });
        const p0 = await prod(c, tipo, pid);
        await sheet(c, mid, { categoria_principal_id: k.catV2, subcategoria1_id: null, subcategoria2_id: null });
        expect(await prod(c, tipo, pid)).toEqual({ grupo: k.gV, cat: k.catV2, s1: null, s2: k.s2V2, rev: p0.rev + 1 });
        // e a sub nova do card, junto com a categoria, é copiada
        await sheet(c, mid, { categoria_principal_id: k.catV1, subcategoria1_id: k.s1V1b });
        expect(await prod(c, tipo, pid)).toMatchObject({ cat: k.catV1, s1: k.s1V1b, s2: null });
      });
    });

    it(`${tipo}: NULL do card nunca é copiado (categoria apagada; sub apagada com a categoria mantida)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const { pid, mid } = await par(c, tipo, { grupo: k.gV, cat: k.catV1, s1: k.s1V1a, s2: k.s2V1a });
        const p0 = await prod(c, tipo, pid);
        await sheet(c, mid, { categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null }); // troca de grupo no Sheet
        expect(await prod(c, tipo, pid)).toEqual(p0);
        await sheet(c, mid, { categoria_principal_id: k.catV1 }); // volta a mesma categoria: produto já tem -> 0 linhas
        expect(await prod(c, tipo, pid)).toEqual(p0);
        await sheet(c, mid, { subcategoria1_id: k.s1V1b, subcategoria2_id: null });
        expect(await prod(c, tipo, pid)).toEqual({ ...p0, s1: k.s1V1b, rev: p0.rev + 1 });
      });
    });

    it(`${tipo}: categoria sem grupo no cadastro (ou de OUTRA loja) -> não copia nada`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const { pid, mid } = await par(c, tipo, { grupo: k.gV, cat: k.catV1, s1: k.s1V1a });
        const p0 = await prod(c, tipo, pid);
        await sheet(c, mid, { categoria_principal_id: k.catSemGrupo, subcategoria1_id: null });
        expect(await prod(c, tipo, pid)).toEqual(p0);
        const kOutra = await taxonomia(c, T2);
        await sheet(c, mid, { categoria_principal_id: kOutra.catT });
        expect(await prod(c, tipo, pid)).toEqual(p0);
      });
    });

    it(`${tipo}: COM pedido, cruzar Acessórios <-> outro grupo = P0001 ASCII e o UPDATE do card inteiro desfeito; sem cruzar ou sem pedido = copia`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        // (1) vestido com OC -> Acessórios: recusa
        const a = await par(c, tipo, { grupo: k.gV, cat: k.catV1, s1: k.s1V1a });
        await comOc(c, tipo, a.pid);
        const pa0 = await prod(c, tipo, a.pid), ca0 = await card(c, a.mid);
        expect(await falha(c, "UPDATE public.modelos SET categoria_principal_id = $2, subcategoria1_id = $3, nome = 'P137 Outro' WHERE id = $1",
          [a.mid, k.catA, k.s1A])).toMatch(RECUSA);
        expect(await prod(c, tipo, a.pid)).toEqual(pa0);
        expect(await card(c, a.mid)).toEqual(ca0); // nome também não mudou: statement inteiro desfeito
        // (2) acessório com OC -> vestido: recusa (o contrário também)
        const b = await par(c, tipo, { grupo: k.gA, cat: k.catA, s1: k.s1A });
        await comOc(c, tipo, b.pid);
        expect(await falha(c, "UPDATE public.modelos SET categoria_principal_id = $2 WHERE id = $1", [b.mid, k.catV2])).toMatch(RECUSA);
        // (3) com OC mas sem cruzar Acessórios (Vestidos -> Tops): copia com o grupo
        await sheet(c, a.mid, { categoria_principal_id: k.catT, subcategoria1_id: k.s1T });
        expect(await prod(c, tipo, a.pid)).toMatchObject({ grupo: k.gT, cat: k.catT, s1: k.s1T });
        // (4) com OC, trocando SÓ a sub (categoria igual): nunca recusa
        await sheet(c, b.mid, { subcategoria1_id: null });
        await sheet(c, b.mid, { subcategoria1_id: k.s1A });
        // (5) o MESMO cruzamento SEM pedido: permitido, grupo vai para Acessórios
        const d = await par(c, tipo, { grupo: k.gV, cat: k.catV1, s1: k.s1V1a });
        await sheet(c, d.mid, { categoria_principal_id: k.catA, subcategoria1_id: k.s1A });
        expect(await prod(c, tipo, d.pid)).toMatchObject({ grupo: k.gA, cat: k.catA, s1: k.s1A });
      });
    });

    it(`${tipo}: rev do produto só sobe com mudança real (outra coluna do card, mesma categoria, produto já com o valor)`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const { pid, mid } = await par(c, tipo, { grupo: k.gV, cat: k.catV2 }, { cat: k.catV1 });
        const p0 = await prod(c, tipo, pid);
        await sheet(c, mid, { semana: "3" });                          // coluna fora da taxonomia
        await sheet(c, mid, { categoria_principal_id: k.catV1 });      // mesmo valor: WHEN do gatilho barra
        await sheet(c, mid, { categoria_principal_id: k.catV2 });      // produto JÁ tem catV2/gV: WHERE casa 0 linhas
        expect(await prod(c, tipo, pid)).toEqual(p0);
      });
    });

    it(`${tipo}: isolamento por loja — produto de OUTRA loja com o mesmo modelo_id não é tocado`, async () => {
      await withTx(async (c) => {
        const k = await prepara(c);
        const { pid, mid } = await par(c, tipo, { grupo: k.gV, cat: k.catV1 });
        const kOutra = await taxonomia(c, T2);
        // produto "invasor" da Ave Rara apontando para o card da Loja Teste (os gatilhos de vínculo barrariam: replica só p/ montar o cenário)
        await c.query("SET LOCAL session_replication_role = replica");
        const intruso = await ins(c, `INSERT INTO public.${TAB[tipo]} (tenant_id, nome, grupo_id, categoria_id, modelo_id)
                                      VALUES ($1, 'P137 Intruso', $2, $3, $4) RETURNING id`, [T2, kOutra.gV, kOutra.catV1, mid]);
        await c.query("SET LOCAL session_replication_role = origin");
        const i0 = await prod(c, tipo, intruso);
        await sheet(c, mid, { categoria_principal_id: k.catT });
        expect(await prod(c, tipo, pid)).toMatchObject({ grupo: k.gT, cat: k.catT });
        expect(await prod(c, tipo, intruso)).toEqual(i0);
      });
    });
  }

  it("card de origem 'interno' não mexe em produto nenhum (gatilho só para revenda/importado)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PA", { grupo: k.gV, cat: k.catV1 }, { cat: k.catV1, origem: "interno" });
      const p0 = await prod(c, "PA", pid);
      await sheet(c, mid, { categoria_principal_id: k.catT });
      expect(await prod(c, "PA", pid)).toEqual(p0);
    });
  });

  it("D8b: produto divergente + a tela PA troca SÓ a sub1 -> o produto NÃO pula de categoria/grupo (sem ping-pong; rev do produto +1 só)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PA", { grupo: k.gV, cat: k.catV1, s1: k.s1V1a }, { cat: k.catT, s1: k.s1T });
      const p0 = await prod(c, "PA", pid), c0 = await card(c, mid);
      const dados = { nome: "P137 Produto", grupo_id: k.gV, categoria_id: k.catV1, subcategoria1_id: k.s1V1b, subcategoria2_id: null, qtd_total: 0 };
      await c.query("SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)", [pid, JSON.stringify(dados)]);
      const p1 = await prod(c, "PA", pid);
      expect(p1).toMatchObject({ grupo: k.gV, cat: k.catV1, s1: k.s1V1b }); // categoria/grupo NÃO vieram do card
      expect(p1.rev).toBe(p0.rev + 1);
      const c1 = await card(c, mid);
      expect(c1).toMatchObject({ cat: k.catT, s1: k.s1V1b });                // P-136: só a sub1 foi ao card
      expect(c1.rev).toBe(c0.rev + 1);
    });
  });

  it("sem ping-pong: a tela PA muda a categoria -> card recebe, gatilho devolve 0 linhas (produto +1, card +1)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PA", { grupo: k.gV, cat: k.catV1, s1: k.s1V1a });
      const p0 = await prod(c, "PA", pid), c0 = await card(c, mid);
      const dados = { nome: "P137 Produto", grupo_id: k.gV, categoria_id: k.catV2, subcategoria1_id: k.s1V2, subcategoria2_id: null, qtd_total: 0 };
      await c.query("SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)", [pid, JSON.stringify(dados)]);
      expect(await prod(c, "PA", pid)).toEqual({ grupo: k.gV, cat: k.catV2, s1: k.s1V2, s2: null, rev: p0.rev + 1 });
      expect(await card(c, mid)).toMatchObject({ cat: k.catV2, s1: k.s1V2, rev: c0.rev + 1 });
    });
  });

  it("D9: tela PA desatualizada (rev antigo) depois da troca no Sheet -> P0409 (não regrava a categoria velha)", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PA", { grupo: k.gV, cat: k.catV1 });
      const revVelho = (await prod(c, "PA", pid)).rev;
      await sheet(c, mid, { categoria_principal_id: k.catT });
      const dadosVelhos = { nome: "P137 Produto", grupo_id: k.gV, categoria_id: k.catV1, qtd_total: 0, composicao: "seda" };
      expect(await falha(c, "SELECT public.salvar_produto_acabado($1::uuid, $2::jsonb, '[]'::jsonb, $3::int)",
        [pid, JSON.stringify(dadosVelhos), revVelho])).toMatch(/^P0409 /);
      expect(await prod(c, "PA", pid)).toMatchObject({ grupo: k.gT, cat: k.catT });
    });
  });

  it("D12: produto integrável com nome/ref_sku marcados -> a cópia passa (sem 42501) e o estado da Integração fica intacto", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PA", { grupo: k.gV, cat: k.catV1 });
      await c.query("INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos) VALUES ($1, $2, 'integravel', ARRAY['nome','ref_sku'])", [T, mid]);
      const e0 = await um<any>(c, "SELECT to_jsonb(i.*) AS j FROM public.integracao_produtos i WHERE modelo_id = $1", [mid]);
      expect(await falha(c, "UPDATE public.modelos SET categoria_principal_id = $2 WHERE id = $1", [mid, k.catT])).toBe("PASSOU");
      expect(await prod(c, "PA", pid)).toMatchObject({ grupo: k.gT, cat: k.catT });
      expect(await um<any>(c, "SELECT to_jsonb(i.*) AS j FROM public.integracao_produtos i WHERE modelo_id = $1", [mid])).toEqual(e0);
    });
  });

  it("D13: Nome + Categoria no MESMO UPDATE do card -> os 2 espelhos rodam; produto rev +2", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PI", { grupo: k.gV, cat: k.catV1 });
      const p0 = await prod(c, "PI", pid);
      await sheet(c, mid, { nome: "P137 Renomeado", categoria_principal_id: k.catT });
      const p1 = await um<any>(c, "SELECT nome, categoria_id, rev FROM public.produtos_importados WHERE id = $1", [pid]);
      expect(p1).toEqual({ nome: "P137 Renomeado", categoria_id: k.catT, rev: p0.rev + 2 });
    });
  });

  it("D15 edição em lote: 1 UPDATE em vários cards (PA+PI) -> todos copiam; 1 card que cruza Acessórios com pedido -> lote inteiro recusado", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const a = await par(c, "PA", { grupo: k.gV, cat: k.catV1, s1: k.s1V1a });
      const b = await par(c, "PI", { grupo: k.gV, cat: k.catV2 });
      // BulkEditDialog: categoria nova + subs NULL
      await c.query("UPDATE public.modelos SET categoria_principal_id = $2, subcategoria1_id = NULL, subcategoria2_id = NULL WHERE id = ANY($1)",
        [[a.mid, b.mid], k.catT]);
      expect(await prod(c, "PA", a.pid)).toMatchObject({ grupo: k.gT, cat: k.catT, s1: null }); // H1: sub de Longo limpa
      expect(await prod(c, "PI", b.pid)).toMatchObject({ grupo: k.gT, cat: k.catT });
      const d = await par(c, "PA", { grupo: k.gV, cat: k.catV1 });
      await comOc(c, "PA", d.pid);
      const antes = [await prod(c, "PA", a.pid), await prod(c, "PI", b.pid), await prod(c, "PA", d.pid)];
      expect(await falha(c, "UPDATE public.modelos SET categoria_principal_id = $2 WHERE id = ANY($1)", [[a.mid, b.mid, d.mid], k.catA])).toMatch(RECUSA);
      expect([await prod(c, "PA", a.pid), await prod(c, "PI", b.pid), await prod(c, "PA", d.pid)]).toEqual(antes);
    });
  });

  it("backfill: arruma os divergentes (PA+PI), pula por motivo, auditoria legível {campo:{de,para}} + _bkp; 2ª rodada = 0; volta devolve só o não editado", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      // divergências LEGADAS: produto editado direto (produto -> card não tem gatilho de categoria)
      const div = async (tipo: Tipo, prodTax: { grupo: string | null; cat: string | null; s1?: string | null; s2?: string | null },
        cardTax: { cat: string | null; s1?: string | null; s2?: string | null; origem?: string }) => par(c, tipo, prodTax, cardTax);
      const p1 = await div("PA", { grupo: k.gT, cat: k.catT, s1: k.s1T }, { cat: k.catV1, s1: k.s1V1a, s2: k.s2V1a });   // arruma
      const p6 = await div("PI", { grupo: k.gV, cat: k.catV2, s1: k.s1V2 }, { cat: k.catV1, s1: null });                  // arruma; H1: sub1 "Alça" (de Midi) é LIMPA
      const p8 = await div("PI", { grupo: k.gV, cat: k.catV2, s2: k.s2V1a }, { cat: k.catV1, s2: null });                 // arruma; H1: sub2 "Liso" (de Longo) FICA
      const kOutra = await taxonomia(c, T2);
      const p9 = await div("PA", { grupo: k.gV, cat: k.catV1 }, { cat: kOutra.catT });                                   // pula: categoria de OUTRA loja
      const p2 = await div("PA", { grupo: k.gV, cat: k.catV1, s1: k.s1V1a }, { cat: k.catV1, s1: null });                // só NULL no card: fica
      const p3 = await div("PA", { grupo: k.gV, cat: k.catV1 }, { cat: null });                                           // pula: card sem categoria
      const p4 = await div("PA", { grupo: k.gV, cat: k.catV1 }, { cat: k.catSemGrupo });                                  // pula: categoria sem grupo
      const p5 = await div("PA", { grupo: k.gV, cat: k.catV1 }, { cat: k.catA });                                         // pula: Acessórios + pedido
      await comOc(c, "PA", p5.pid);
      const p7 = await div("PA", { grupo: k.gV, cat: k.catV1 }, { cat: k.catT, origem: "interno" });                    // origem não casa: fora
      const rev1 = (await prod(c, "PA", p1.pid)).rev;
      const tax = async () => {
        const out: Prod[] = [];
        for (const x of [p2, p3, p4, p5, p7, p9]) out.push(await prod(c, "PA", x.pid)); // sequencial: 1 client pg
        return out;
      };
      const intocados = await tax();

      const r = (await um<{ r: any }>(c, "SELECT public._p137_backfill_rodar() AS r")).r;
      expect(r.arrumados_ids).toEqual(expect.arrayContaining([p1.pid, p6.pid, p8.pid]));
      for (const x of [p2, p3, p4, p5, p7, p9]) expect(r.arrumados_ids).not.toContain(x.pid);
      const motivo = (pid: string) => r.pulados_lista.find((l: any) => l.produto_id === pid)?.motivo;
      expect([motivo(p3.pid), motivo(p4.pid), motivo(p9.pid), motivo(p5.pid), motivo(p2.pid), motivo(p7.pid)])
        .toEqual(["card_sem_categoria", "categoria_sem_grupo", "categoria_de_outra_loja", "acessorio_com_pedido", undefined, undefined]);
      // L5: a lista e os totais por loja trazem o NOME da loja (não só o UUID)
      expect(r.pulados_lista.find((l: any) => l.produto_id === p3.pid)).toMatchObject({ loja: "Loja Teste", produto: "P137 Produto" });
      expect(r.por_loja.find((l: any) => l.tipo === "PA" && l.tenant_id === T)).toMatchObject({ loja: "Loja Teste" });
      expect(r.pulados.categoria_de_outra_loja).toBeGreaterThanOrEqual(1);
      expect(r.arrumados).toBe(r.auditoria);
      expect(r.arrumados).toBe(r.bkp);
      expect(r.fica_por_null_no_card).toBeGreaterThanOrEqual(1);
      const loja = r.por_loja.find((l: any) => l.tipo === "PA" && l.tenant_id === T);
      expect(loja.pula_acessorio_com_pedido).toBeGreaterThanOrEqual(1);

      expect(await prod(c, "PA", p1.pid)).toEqual({ grupo: k.gV, cat: k.catV1, s1: k.s1V1a, s2: k.s2V1a, rev: rev1 + 1 });
      expect(await prod(c, "PI", p6.pid)).toMatchObject({ grupo: k.gV, cat: k.catV1, s1: null });
      expect(await prod(c, "PI", p8.pid)).toMatchObject({ grupo: k.gV, cat: k.catV1, s1: null, s2: k.s2V1a });
      expect(await tax()).toEqual(intocados);

      // auditoria legível (Admin › Auditoria): nomes, formato {campo:{de,para}}, só os campos que mudaram
      const aud = await um<any>(c, `SELECT user_nome, acao, entidade, tabela, descricao, dados FROM public.audit_log
                                     WHERE registro_id = $1`, [p1.pid]);
      expect(aud).toEqual({
        user_nome: "Sistema", acao: "editar", entidade: "Produto Acabado", tabela: "produtos_acabados",
        descricao: "Sistema: categoria alinhada ao card (P-137) — P137 Produto",
        dados: {
          grupo_id: { de: "P137 Tops", para: "P137 Vestidos" },
          categoria_id: { de: "P137 Blusa", para: "P137 Longo" },
          subcategoria1_id: { de: "P137 Cropped", para: "P137 Manga Curta" },
          subcategoria2_id: { de: null, para: "P137 Liso" },
        },
      });
      const aud6 = await um<any>(c, "SELECT entidade, dados FROM public.audit_log WHERE registro_id = $1", [p6.pid]);
      expect(aud6).toEqual({ entidade: "Produto Importado", dados: {
        categoria_id: { de: "P137 Midi", para: "P137 Longo" }, subcategoria1_id: { de: "P137 Alça", para: null } } });
      const aud8 = await um<any>(c, "SELECT dados FROM public.audit_log WHERE registro_id = $1", [p8.pid]);
      expect(aud8.dados).toEqual({ categoria_id: { de: "P137 Midi", para: "P137 Longo" } });
      const bkp = await um<any>(c, `SELECT tabela, grupo_de, categoria_de, sub1_de, sub2_de, grupo_para, categoria_para, sub1_para, sub2_para
                                      FROM public._bkp_p137_backfill WHERE produto_id = $1`, [p1.pid]);
      expect(bkp).toEqual({ tabela: "produtos_acabados", grupo_de: k.gT, categoria_de: k.catT, sub1_de: k.s1T, sub2_de: null,
        grupo_para: k.gV, categoria_para: k.catV1, sub1_para: k.s1V1a, sub2_para: k.s2V1a });

      // idempotente: 2ª rodada não acha nada
      const r2 = (await um<{ r: any }>(c, "SELECT public._p137_backfill_rodar() AS r")).r;
      expect(r2.arrumados).toBe(0);

      // volta: p6 foi editado depois (tela PI) -> fica; p1 volta ao "antes"
      await c.query("UPDATE public.produtos_importados SET subcategoria2_id = $2 WHERE id = $1", [p6.pid, k.s2V1b]);
      const v = (await um<{ v: any }>(c, "SELECT public._p137_backfill_desfazer() AS v")).v;
      expect(v.nao_devolvidas_ids).toContain(p6.pid);
      expect(v.nao_devolvidas_ids).not.toContain(p1.pid);
      expect(await prod(c, "PA", p1.pid)).toMatchObject({ grupo: k.gT, cat: k.catT, s1: k.s1T, s2: null });
      expect(await prod(c, "PI", p6.pid)).toMatchObject({ grupo: k.gV, cat: k.catV1, s2: k.s2V1b });
      const volta = await um<any>(c, `SELECT descricao, dados FROM public.audit_log WHERE registro_id = $1
                                        AND descricao LIKE 'Sistema: categoria do produto devolvida%'`, [p1.pid]);
      expect(volta.dados.categoria_id).toEqual({ de: "P137 Longo", para: "P137 Blusa" });
      expect((await um<any>(c, "SELECT count(*)::int AS n FROM public._bkp_p137_backfill")).n).toBe(0);
    });
  });

  it("M2: a volta do backfill NÃO devolve produto que agora tem pedido quando cruzaria Acessórios (P-142 B); conta e lista", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      // backfill leva o produto de Vestidos para Acessórios (sem OC: permitido)
      const a = await par(c, "PA", { grupo: k.gV, cat: k.catV1 }, { cat: k.catA });
      const b = await par(c, "PI", { grupo: k.gV, cat: k.catV1 }, { cat: k.catA });
      const r = (await um<{ r: any }>(c, "SELECT public._p137_backfill_rodar() AS r")).r;
      expect(r.arrumados_ids).toEqual(expect.arrayContaining([a.pid, b.pid]));
      expect(await prod(c, "PA", a.pid)).toMatchObject({ grupo: k.gA, cat: k.catA });
      // depois alguém cria a OC (grade UN) do PA; o PI segue sem pedido
      await comOc(c, "PA", a.pid);
      const a0 = await prod(c, "PA", a.pid);
      const v = (await um<{ v: any }>(c, "SELECT public._p137_backfill_desfazer() AS v")).v;
      expect(v.acessorio_pedido_ids).toContain(a.pid);
      expect(v.acessorio_pedido_ids).not.toContain(b.pid);
      expect(v.nao_devolvidas_ids).toContain(a.pid);
      expect(v.nao_devolvidas_acessorio_pedido).toBeGreaterThanOrEqual(1);
      expect(await prod(c, "PA", a.pid)).toEqual(a0);                             // intocado
      expect(await prod(c, "PI", b.pid)).toMatchObject({ grupo: k.gV, cat: k.catV1 }); // devolvido
    });
  });

  it("D16: a cópia para o produto não mexe na fila do kanban — só o UPDATE do card enfileira o modelo, 1×", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const { pid, mid } = await par(c, "PA", { grupo: k.gV, cat: k.catV1 });
      // a chave só muda pela RPC protegida; na cópia a Loja Teste já está ligada (conferido aqui)
      const ligada = (await um<any>(c, "SELECT kanban_automatico AS l FROM public.tenant_config WHERE tenant_id = $1", [T])).l;
      expect(ligada, "a Loja Teste da cópia precisa estar com o Kanban automático ligado").toBe(true);
      await c.query("UPDATE public.modelos SET ordem_criacao_enviada = true WHERE id = $1", [mid]);
      await c.query("DELETE FROM public.kanban_recalculo_fila");
      await sheet(c, mid, { categoria_principal_id: k.catT });
      expect(await prod(c, "PA", pid)).toMatchObject({ grupo: k.gT, cat: k.catT }); // a cópia aconteceu
      const fila = await c.query<{ modelo_id: string }>("SELECT modelo_id FROM public.kanban_recalculo_fila");
      expect(fila.rows.map((x) => x.modelo_id)).toEqual([mid]);                      // só o card, 1 linha
    });
  });
});
