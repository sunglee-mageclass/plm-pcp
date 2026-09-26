/**
 * SKU em PRÉVIA — banco (plano docs/superpowers/plans/2026-09-25-sku-previa-regerar.md, Tasks 2–3). BEGIN…ROLLBACK: nada grava.
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Em outro banco os blocos de
 * banco PULAM; com SKU_PREVIA_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta (exigeBancoLocal()).
 * Modos:
 *  • SKU_PREVIA_MIG_TXN=1 — aplica a migration DENTRO da txn de cada teste (tests/integration/mig-txn.ts — NUNCA `\i`);
 *    a cópia precisa de F3.5a + reorganização (20261005100000). A equivalência VELHO × NOVO e o inverso SÓ rodam aqui
 *    (precisam das funções vivas de ANTES) e pulam se a cópia já tiver esta frente.
 *  • sem a variável — exige a migration VIVA na cópia (ensaio da Task 4 / merge da Task 6); sem ela, os blocos de banco pulam.
 * O bloco estático não usa banco: roda sempre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { hasDb, dbUrl, withTx, comoUsuario, semUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261005110000_sku_previa_regerar.sql";
const INV = "supabase/rollback/20261005110000_sku_previa_regerar_down.sql";
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SKU_PREVIA_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** O texto de pg_get_functiondef = o corpo do arquivo + "\n" (o arquivo é GERADO no formato canônico). */
function corpo(rel: string, cria: string): string {
  const t = ler(rel);
  const i = t.indexOf(cria);
  const f = t.indexOf("\n$function$", i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${cria})`);
  if (t.indexOf(cria, i + 1) >= 0) throw new Error(`${rel}: ${cria} aparece mais de 1×`);
  return t.slice(i, f + "\n$function$".length) + "\n";
}
const REDEF = [
  { fn: "public._skus_modelo_calc(uuid)", cria: "CREATE OR REPLACE FUNCTION public._skus_modelo_calc(" },
  { fn: "public._skus_modelo_core(uuid)", cria: "CREATE OR REPLACE FUNCTION public._skus_modelo_core(" },
  { fn: "public._gerar_skus_modelo_core(uuid,boolean)", cria: "CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(" },
];
const NOVAS = [
  { fn: "public._skus_assinatura(jsonb)", cria: "CREATE OR REPLACE FUNCTION public._skus_assinatura(", rpc: false },
  { fn: "public._skus_calc_ref_tipo(uuid,text,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo(", rpc: false },
  { fn: "public._skus_matriz_ref_tipo(uuid,text,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(", rpc: false },
  { fn: "public._skus_plano(uuid,text,text,jsonb,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_plano(", rpc: false },
  { fn: "public._skus_executar_plano(uuid,uuid,jsonb,boolean)", cria: "CREATE OR REPLACE FUNCTION public._skus_executar_plano(", rpc: false },
  { fn: "public._skus_previa_core(uuid,text,text,jsonb,text)", cria: "CREATE OR REPLACE FUNCTION public._skus_previa_core(", rpc: false },
  { fn: "public._aplicar_skus_modelo_core(uuid,jsonb,text,text)", cria: "CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(", rpc: false },
  { fn: "public.skus_previa(uuid,text,text,jsonb,text)", cria: "CREATE OR REPLACE FUNCTION public.skus_previa(", rpc: true },
  { fn: "public.aplicar_skus_modelo(uuid,jsonb,text,text)", cria: "CREATE OR REPLACE FUNCTION public.aplicar_skus_modelo(", rpc: true },
];
// = TROCAS_CALC/TROCAS_CORE do gerar_sql.py (R2): o texto vivo com SÓ estas âncoras trocadas.
const TROCAS_CALC: [string, string][] = [
  ["CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)\n",
   "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo(_modelo_id uuid, _ref text, _tipo text)\n"],
  ["           mo.ref AS mref,\n",
   "           _ref AS mref,  -- SKU em prévia: a REF por parâmetro (a do rascunho na prévia; a SALVA, lida sob a trava, na gravação)\n"],
  ["           mo.tamanho_tipo AS mtipo,\n",
   "           _tipo AS mtipo,  -- SKU em prévia: o \"Tamanho em\" por parâmetro (idem)\n"],
];
const TROCAS_CORE: [string, string][] = [
  ["CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)\n",
   "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)\n"],
  ["  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo\n",
   "  SELECT mo.tenant_id, public._sku_norm_ref(_ref), tc.sku_config, _tipo  -- SKU em prévia: REF e \"Tamanho em\" por parâmetro\n"],
  ["    SELECT * FROM public._skus_modelo_calc(_modelo_id)\n",
   "    SELECT * FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo)\n"],
];
const aplicaTrocas = (t: string, trocas: [string, string][]) =>
  trocas.reduce((s, [a, b]) => { expect(s.split(a).length - 1, a.trim()).toBe(1); return s.split(a).join(b); }, t);
/** Guardas de md5 do $guarda$, NA ORDEM do arquivo: 3 redefinidas [antes, depois] e depois as 9 novas [depois]. */
function guardas(rel: string) {
  const t = ler(rel);
  const redef = [...t.matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ antes: r[1], depois: r[2] }));
  const bloco = t.slice(t.indexOf("DO $guarda$"), t.indexOf("$guarda$;"));
  const novas = [...bloco.matchAll(/IF v_md5 <> '([0-9a-f]{32})' THEN/g)].map((r) => r[1]);
  return { redef, novas };
}
// Comentários PRIMEIRO: o cabeçalho cita "$acl$"/"$pos$" e casaria com o DO de verdade, engolindo o arquivo.
const semCorpos = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");

describe("SKU em prévia — arquivos da migration (estático, sem banco)", () => {
  it("encoding 1º, 1 BEGIN/1 COMMIT, travas logo depois do BEGIN, NOTIFY antes do COMMIT, SÓ funções (nada de tabela/policy/COMMENT/DML solto)", () => {
    for (const rel of [MIG, INV]) {
      const t = ler(rel);
      const linhas = t.split("\n");
      expect(linhas.find((l) => l.trim() !== "" && !l.startsWith("--")), rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      const b = linhas.indexOf("BEGIN;");
      expect(linhas.slice(b + 1, b + 3), rel).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeLessThan(t.indexOf("\nCOMMIT;"));
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeGreaterThan(t.indexOf("DO $pos$"));
      const fora = semCorpos(t);
      expect(fora, rel).not.toMatch(/\b(ALTER|CREATE|DROP)\s+(TABLE|POLICY|TRIGGER|INDEX)\b/i);
      expect(fora, rel).not.toMatch(/\bCOMMENT\s+ON\b|\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b/i);
    }
  });

  it("guarda md5 EXATA: redefinidas antes = texto do inverso, depois = texto da migration; novas = texto da migration", () => {
    for (const rel of [MIG, INV]) {
      const g = guardas(rel);
      expect(g.redef.length, rel).toBe(3);
      expect(g.novas.length, rel).toBe(9);
      REDEF.forEach((f, i) => expect(g.redef[i], `${rel} ${f.fn}`).toEqual({ antes: md5(corpo(INV, f.cria)), depois: md5(corpo(MIG, f.cria)) }));
      NOVAS.forEach((f, i) => expect(g.novas[i], `${rel} ${f.fn}`).toBe(md5(corpo(MIG, f.cria))));
    }
  });

  it("R2 — _skus_calc_ref_tipo/_skus_matriz_ref_tipo = o texto VIVO (o do inverso) com SÓ as âncoras trocadas (cada uma 1×)", () => {
    expect(corpo(MIG, "CREATE OR REPLACE FUNCTION public._skus_calc_ref_tipo("))
      .toBe(aplicaTrocas(corpo(INV, "CREATE OR REPLACE FUNCTION public._skus_modelo_calc("), TROCAS_CALC));
    expect(corpo(MIG, "CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo("))
      .toBe(aplicaTrocas(corpo(INV, "CREATE OR REPLACE FUNCTION public._skus_modelo_core("), TROCAS_CORE));
  });

  it("delegadoras e geração: MESMO cabeçalho do vivo; a geração trava ANTES de ler REF/'Tamanho em' e passa os lidos ao plano (B-M8)", () => {
    for (const f of REDEF) {
      const cab = (t: string) => t.slice(0, t.indexOf("AS $function$\n"));
      expect(cab(corpo(MIG, f.cria)), f.fn).toBe(cab(corpo(INV, f.cria)));
    }
    expect(corpo(MIG, REDEF[0].cria)).toContain("CROSS JOIN LATERAL public._skus_calc_ref_tipo(mo.id, mo.ref, mo.tamanho_tipo) AS c");
    expect(corpo(MIG, REDEF[1].cria)).toContain("RETURN public._skus_matriz_ref_tipo(_modelo_id,");
    const g = corpo(MIG, REDEF[2].cria);
    const iTrava = g.indexOf("pg_advisory_xact_lock(hashtextextended('sku_modelo:'");
    const iLe = g.indexOf("SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo");
    const iPlano = g.indexOf("public._skus_plano(_modelo_id, v_ref, v_tipo, '[]'::jsonb,");
    expect(iTrava).toBeGreaterThan(0);
    expect(iLe).toBeGreaterThan(iTrava);
    expect(iPlano).toBeGreaterThan(iLe);
    expect(g).toContain("public._skus_executar_plano(_modelo_id, v_tenant, v_plano, false)");
    const a = corpo(MIG, "CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(");
    expect(a.indexOf("pg_advisory_xact_lock")).toBeLessThan(a.indexOf("public._skus_plano(_modelo_id, v_ref, v_tipo, _manuais, _modo)"));
    expect(a).toContain("public._skus_executar_plano(_modelo_id, v_tenant, v_plano, true)");
    expect(a.match(/RAISE EXCEPTION 'previa_desatualizada/g)?.length).toBe(2); // antes (assinatura) E depois (pós-conferência)
  });

  it("só leitura por construção: skus_previa/_skus_previa_core/_skus_plano/_ref_tipo STABLE; assinatura IMMUTABLE; sem DML nelas", () => {
    for (const cria of ["public.skus_previa(", "public._skus_previa_core(", "public._skus_plano(", "public._skus_calc_ref_tipo(", "public._skus_matriz_ref_tipo("]) {
      const t = corpo(MIG, `CREATE OR REPLACE FUNCTION ${cria}`);
      expect(t, cria).toMatch(/\n STABLE SECURITY DEFINER\n/);
      expect(t, cria).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
    }
    expect(corpo(MIG, "CREATE OR REPLACE FUNCTION public._skus_assinatura(")).toMatch(/\n LANGUAGE sql\n IMMUTABLE\n/);
  });

  it("ACL (#9): internas REVOKE dos TRÊS (as 3 redefinidas reafirmadas); RPCs REVOKE PUBLIC/anon + GRANT authenticated; $acl$ e $pos$", () => {
    const m = ler(MIG);
    const revs = [...m.matchAll(/REVOKE EXECUTE ON FUNCTION\n([\s\S]*?)\n  FROM ([^;]+);/g)].map((r) => ({ fns: r[1], de: r[2] }));
    expect(revs.map((r) => r.de)).toEqual(["PUBLIC, anon, authenticated", "PUBLIC, anon, authenticated", "PUBLIC, anon"]);
    for (const n of ["_skus_modelo_calc(uuid)", "_skus_modelo_core(uuid)", "_gerar_skus_modelo_core(uuid, boolean)"]) expect(revs[0].fns).toContain(n);
    for (const n of ["_skus_assinatura(jsonb)", "_skus_plano(uuid, text, text, jsonb, text)", "_skus_executar_plano(uuid, uuid, jsonb, boolean)", "_aplicar_skus_modelo_core(uuid, jsonb, text, text)"])
      expect(revs[1].fns).toContain(n);
    expect(revs[2].fns).toContain("public.skus_previa(uuid, text, text, jsonb, text)");
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION\n  public\.skus_previa\(uuid, text, text, jsonb, text\),\n  public\.aplicar_skus_modelo\(uuid, jsonb, text, text\)\n  TO authenticated;/);
    expect(m.indexOf("DO $acl$")).toBeGreaterThan(m.indexOf("TO authenticated;"));
    expect(m.indexOf("DO $pos$")).toBeGreaterThan(m.indexOf("DO $acl$"));
    expect((m.slice(m.indexOf("DO $pos$")).match(/IS DISTINCT FROM '[0-9a-f]{32}'/g) ?? []).length).toBe(12);
  });

  it("inverso: guarda → as 3 de ANTES → REVOKE → DROP das 9 → $acl$ → $pos$ (9 ausentes) → NOTIFY → COMMIT; nenhum dado mexido", () => {
    const v = ler(INV);
    const i = (s: string) => { const x = v.indexOf(s); expect(x, s).toBeGreaterThan(-1); return x; };
    const iG = i("DO $guarda$");
    const iSku = REDEF.map((f) => i(f.cria));
    const iDrop = i("DROP FUNCTION IF EXISTS public.skus_previa(uuid, text, text, jsonb, text);");
    const iAcl = i("DO $acl$");
    const iPos = i("DO $pos$");
    expect(iSku.every((x) => x > iG && x < iDrop)).toBe(true);
    expect(iAcl).toBeGreaterThan(iDrop);
    expect(iPos).toBeGreaterThan(iAcl);
    for (const f of NOVAS) expect(v).toContain(`DROP FUNCTION IF EXISTS ${f.fn.replace(/,/g, ", ")};`);
    for (const f of NOVAS) expect(v, f.fn).not.toContain(f.cria);
    expect((v.slice(iPos).match(/IS NOT NULL THEN/g) ?? []).length).toBe(9);
  });
});

// ─────────────────────────────── Task 3 — banco (SÓ na cópia) ───────────────────────────────
/** As 2 travas do arquivo (logo depois do BEGIN) saem da txn do teste: o transaction_timeout de 3 s limitaria o teste todo. */
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);

async function naCopia(sql: string): Promise<boolean> {
  if (!hasDb || !LOCAL) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query(sql)).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const VIVA = await naCopia("select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok");
const BASE_OK = await naCopia("select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null and to_regclass('public.modelo_skus') is not null as ok");
const PRONTO = hasDb && LOCAL && (MIG_TXN ? BASE_OK : VIVA);
/** Equivalência e inverso: precisam das funções de ANTES na cópia (P5 — pula depois do copia.sh ida). */
const PRONTO_ANTES = hasDb && LOCAL && MIG_TXN && BASE_OK && !VIVA;

async function prepara(c: Client, o: { aplicar?: boolean } = {}): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN && o.aplicar !== false) await aplica(c, MIG);
}
/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável). */
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT pv_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT pv_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT pv_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}
const v = async (c: Client, sql: string, p: unknown[]) => (await um<{ v: any }>(c, sql, p)).v;
const gerar = (c: Client, m: string, regerar = false) => v(c, "SELECT public.gerar_skus_modelo($1::uuid, $2::boolean) AS v", [m, regerar]);
const matriz = (c: Client, m: string) => v(c, "SELECT public.skus_modelo($1::uuid) AS v", [m]);
const Q_PREVIA = "SELECT public.skus_previa($1::uuid, $2::text, $3::text, $4::jsonb, $5::text) AS v";
const previa = (c: Client, m: string, ref: string | null, tipo: string | null, manuais: unknown[] = [], modo = "regerar") =>
  v(c, Q_PREVIA, [m, ref, tipo, JSON.stringify(manuais), modo]);
const Q_APLICAR = "SELECT public.aplicar_skus_modelo($1::uuid, $2::jsonb, $3::text, $4::text) AS v";
const aplicar = (c: Client, m: string, manuais: unknown[], modo: string, ass: string | null) =>
  v(c, Q_APLICAR, [m, JSON.stringify(manuais), modo, ass]);
const plano = (c: Client, m: string, ref: string | null, tipo: string | null, manuais: unknown[] = [], modo = "regerar") =>
  v(c, "SELECT public._skus_plano($1::uuid, $2::text, $3::text, $4::jsonb, $5::text) AS v", [m, ref, tipo, JSON.stringify(manuais), modo]);
type Gravado = { vk: string; tk: string; sku: string; manual: boolean };
async function estado(c: Client, m: string): Promise<Gravado[]> {
  return (await c.query(
    `SELECT variante_key::text AS vk, tamanho_key AS tk, sku, manual FROM public.modelo_skus WHERE modelo_id = $1
      ORDER BY variante_key::text COLLATE "C", tamanho_key COLLATE "C"`, [m])).rows;
}
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finalComoEstado = (final: [string, string, string, boolean][]): Gravado[] =>
  final.map(([vk, tk, sku, manual]) => ({ vk, tk, sku, manual })).sort((a, b) => cmpStr(`${a.vk}|${a.tk}`, `${b.vk}|${b.tk}`));
/** ids novos a cada rodada (gen_random_uuid): fora da comparação velho × novo. */
const semIds = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, val) => (k === "id" ? undefined : val)));
const linhaDe = (mz: any, vk: string, tk: string) => (mz.linhas as any[]).find((l) => l.variante_key === vk && l.tamanho_key === tk);

const T = TENANT_TESTE;
const novoId = async (c: Client, sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
const chave = async (c: Client, cor: string, ape: string | null = null) =>
  (await um<{ k: string }>(c, "SELECT public._sku_variante_key($1::uuid, $2::uuid) AS k", [cor, ape])).k;
const FMT_COR_TAM = { partes: ["cor_base", "tamanho"], separadores: {} };
const FMT_REF = { partes: ["ref", "cor_base", "tamanho"], separadores: { "ref|cor_base": "-" } };
async function loja(c: Client, cfg: unknown = FMT_COR_TAM): Promise<void> {
  await c.query(
    "UPDATE public.tenant_config SET sku_config = $2::jsonb, tamanhos_sku = $3::jsonb, tamanhos_grade = $4::jsonb WHERE tenant_id = $1",
    [T, JSON.stringify(cfg), JSON.stringify({ "34": "34", PPP: "PPP", "36": "36", PP: "PP" }), JSON.stringify(["34|PPP", "36|PP"])],
  );
}
type Cen = { m: string; corA: string; corB: string; kA: string; kB: string };
/** Card isolado "PV-T Blusa" (REF PV-T1, "Tamanho em" Número): Tecido 1 = [Cor A (AA), Cor B (BB)], grade 34 e 36 nas 2.
 *  Com FMT_COR_TAM os SKUs são AA34, AA36, BB34, BB36. */
async function cenario(c: Client, cfg: unknown = FMT_COR_TAM): Promise<Cen> {
  await loja(c, cfg);
  const corA = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'PV-T Cor A', 'AA') RETURNING id", [T]);
  const corB = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'PV-T Cor B', 'BB') RETURNING id", [T]);
  const artigo = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'PV-T Tecido') RETURNING id", [T]);
  const vt = (cor: string) =>
    novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id) VALUES ($1, $2, $3) RETURNING id", [T, artigo, cor]);
  const vtA = await vt(corA);
  const vtB = await vt(corB);
  const m = await novoId(c,
    "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'PV-T Blusa', 'PV-T1', 'interno', 'numero') RETURNING id", [T]);
  const mt = await novoId(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [m, artigo]);
  await c.query("INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1), ($1, $3, 2)", [mt, vtA, vtB]);
  await c.query(
    `INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
     VALUES ($1, 1, '{"34|PPP": 1, "36|PP": 1}'::jsonb, 2), ($1, 2, '{"34|PPP": 1, "36|PP": 1}'::jsonb, 2)`, [m]);
  return { m, corA, corB, kA: await chave(c, corA), kB: await chave(c, corB) };
}
async function siglas(c: Client, k: Cen, a: string | null, b: string | null): Promise<void> {
  if (a !== null) await c.query("UPDATE public.cores SET sigla_sku = $2 WHERE id = $1", [k.corA, a]);
  if (b !== null) await c.query("UPDATE public.cores SET sigla_sku = $2 WHERE id = $1", [k.corB, b]);
}
/** Outro card da loja com 1 SKU gravado (REF igual = réplica — D5; diferente = conflito). */
async function outroCom(c: Client, ref: string, vk: string, tk: string, sku: string): Promise<string> {
  const o = await novoId(c,
    "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'PV-T Outro', $2, 'interno', 'numero') RETURNING id", [T, ref]);
  await c.query("INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual) VALUES ($1, $2, $3, $4, $5, true)",
    [T, o, vk, tk, sku]);
  return o;
}
const idRev = (c: Client, m: string, vk: string, tk: string) =>
  um<{ id: string; rev: number }>(c, "SELECT id, rev FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2 AND tamanho_key = $3", [m, vk, tk]);

/** Passos de cada cenário da equivalência: mexem no dado ENTRE as gerações (como o usuário faria), devolvem os resultados.
 *  `antes` roda FORA do savepoint (R1 do G-plano): o que ele cria — ex.: os cards "outros" — tem o MESMO id nas 2 rodadas.
 *  `cfg` = o Formato do SKU do cenário (padrão FMT_COR_TAM). */
type Passos = (c: Client, k: Cen) => Promise<unknown[]>;
type Cenario = { nome: string; cfg?: unknown; antes?: (c: Client, k: Cen) => Promise<void>; passos: Passos };
const CENARIOS: Cenario[] = [
  { nome: "1ª geração, manual preservado, divergente regerado, órfã removida, falta mantém o gravado", passos: async (c, k) => {
    const out: unknown[] = [await gerar(c, k.m)];
    out.push(await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'meu-1') AS v", [(await idRev(c, k.m, k.kA, "34|PPP")).id]));
    await siglas(c, k, "AC", null);
    await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 1, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
    await c.query("UPDATE public.cores SET sigla_sku = NULL WHERE id = $1", [k.corB]);
    out.push(await gerar(c, k.m), await gerar(c, k.m, true), await matriz(c, k.m));
    return out;
  } },
  {
    nome: "conflito com outro card (REF diferente) e réplica (mesma REF) que divide o SKU",
    antes: async (c, k) => {  // R1 — os "outros" nascem ANTES do savepoint: com_modelo_id/conflito_com.modelo_id estáveis
      await outroCom(c, "PV-X", k.kA, "34|PPP", "AA34");
      await outroCom(c, "PV-T1", k.kB, "34|PPP", "BB34");
    },
    passos: async (c, k) => [await gerar(c, k.m), await matriz(c, k.m)],
  },
  { nome: "troca A↔B no mesmo card: as 4 linhas em conflito ('também muda neste Regerar')", passos: async (c, k) => {
    const a = await gerar(c, k.m);
    await siglas(c, k, "BB", "AA");
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  } },
  { nome: "cadeia direta: A quer o SKU atual de B (que também muda) — A conflita, B muda", passos: async (c, k) => {
    const a = await gerar(c, k.m);
    await siglas(c, k, "BB", "XX");
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  } },
  { nome: "cadeia inversa: B quer o SKU antigo de A, já liberado no mesmo Regerar — os dois mudam", passos: async (c, k) => {
    const a = await gerar(c, k.m);
    await siglas(c, k, "XX", "AA");
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  } },
  { nome: "órfã sai ANTES e libera o SKU para outra linha no mesmo Regerar", passos: async (c, k) => {
    const a = await gerar(c, k.m);
    await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 0, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
    await siglas(c, k, "BB", null);
    return [a, await gerar(c, k.m, true), await matriz(c, k.m)];
  } },
  { nome: "sem 'Tamanho em', sem REF, sem Formato: nada gera (precedência da F3.6)", passos: async (c, k) => {
    const out: unknown[] = [await gerar(c, k.m)];
    await c.query("UPDATE public.modelos SET tamanho_tipo = NULL WHERE id = $1", [k.m]);
    out.push(await gerar(c, k.m, true), await matriz(c, k.m));
    await c.query("UPDATE public.modelos SET tamanho_tipo = 'numero', ref = NULL WHERE id = $1", [k.m]);
    out.push(await gerar(c, k.m, true), await matriz(c, k.m));
    await c.query("UPDATE public.tenant_config SET sku_config = NULL WHERE tenant_id = $1", [T]);
    out.push(await gerar(c, k.m, true), await matriz(c, k.m));
    return out;
  } },
  // R7 do G-plano — os 3 casos que faltavam
  { nome: "automática quer o SKU de uma linha MANUAL do mesmo card: conflito com dono manual (mensagem do laço)", passos: async (c, k) => {
    const a = await gerar(c, k.m);
    const man = await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'ac34') AS v", [(await idRev(c, k.m, k.kB, "34|PPP")).id]);
    await siglas(c, k, "AC", null); // A quer AC34 (manual de B) e AC36 (livre)
    return [a, man, await gerar(c, k.m, true), await matriz(c, k.m)];
  } },
  { nome: "'criar' com uma órfã automática segurando o SKU que uma linha nova quer ('criar' não remove órfã)", passos: async (c, k) => {
    const a = await gerar(c, k.m);
    await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 0, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
    await c.query("DELETE FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2", [k.m, k.kA]); // as linhas de A "faltam"
    await siglas(c, k, "BB", null); // A (nova) quer BB34/BB36, que as órfãs de B seguram
    return [a, await gerar(c, k.m, false), await matriz(c, k.m)];
  } },
  {
    nome: "Formato com REF + réplica (mesma REF divide o SKU) + outro card (REF diferente) em conflito",
    cfg: FMT_REF,
    antes: async (c, k) => {
      await outroCom(c, "PV-T1", k.kB, "34|PPP", "PV-T1-BB34"); // réplica: divide
      await outroCom(c, "PV-X", k.kA, "34|PPP", "PV-T1-AA34");  // outro: conflito
    },
    passos: async (c, k) => [await gerar(c, k.m), await gerar(c, k.m, true), await matriz(c, k.m)],
  },
];

describe.skipIf(!PRONTO_ANTES)("SKU em prévia — EQUIVALÊNCIA velho × novo (a geração virou plano + executor — R1)", () => {
  for (const cen of CENARIOS) {
    it(cen.nome, async () => {
      await withTx(async (c) => {
        await prepara(c, { aplicar: false }); // as funções VIVAS de antes (cópia sem esta migration)
        const k = await cenario(c, cen.cfg);
        if (cen.antes) await cen.antes(c, k); // R1 — FORA do savepoint: ids estáveis nas 2 rodadas
        await comoUsuario(c);
        await c.query("SAVEPOINT velho");
        const velho = { r: semIds(await cen.passos(c, k)), e: await estado(c, k.m) };
        await c.query("ROLLBACK TO SAVEPOINT velho");
        await aplica(c, MIG);
        const novo = { r: semIds(await cen.passos(c, k)), e: await estado(c, k.m) };
        expect(novo).toEqual(velho);
      });
    });
  }
});

describe.skipIf(!PRONTO)("SKU em prévia — a prévia (rascunho) é EXATAMENTE o que o Salvar grava", () => {
  it("'Tamanho em' do rascunho ≠ salvo: a prévia mostra 'muda' SEM gravar; o Salvar (UPDATE do card + aplicar) grava o final da prévia", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const antes = await estado(c, k.m);
      const p = await previa(c, k.m, "PV-T1", "letra");
      expect(await estado(c, k.m)).toEqual(antes); // nada gravou
      expect(p.status).toBe("ok");
      expect(p.linhas.map((l: any) => [l.tamanho_key, l.sku, l.previa?.acao, l.previa?.sku_para])).toEqual([
        ["34|PPP", "AA34", "muda", "AAPPP"], ["36|PP", "AA36", "muda", "AAPP"],
        ["34|PPP", "BB34", "muda", "BBPPP"], ["36|PP", "BB36", "muda", "BBPP"],
      ]);
      const pl = await plano(c, k.m, "PV-T1", "letra");
      expect(pl.assinatura).toBe(p.assinatura);
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.m]); // o Salvar do card
      const r = await aplicar(c, k.m, [], "regerar", p.assinatura);
      expect([r.criados, r.atualizados, r.removidos, r.manuais, r.conflitos]).toEqual([0, 4, 0, 0, []]);
      expect(await estado(c, k.m)).toEqual(finalComoEstado(pl.final));
    });
  });

  it("REF do rascunho (Formato com REF): prévia com a REF nova; grava depois de salvar a REF", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c, FMT_REF);
      await comoUsuario(c);
      await gerar(c, k.m);
      expect((await estado(c, k.m)).map((g) => g.sku)).toEqual(expect.arrayContaining(["PV-T1-AA34"]));
      const p = await previa(c, k.m, "PV-T2", "numero");
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "muda", sku_de: "PV-T1-AA34", sku_para: "PV-T2-AA34" });
      await c.query("UPDATE public.modelos SET ref = 'PV-T2' WHERE id = $1", [k.m]);
      await aplicar(c, k.m, [], "regerar", p.assinatura);
      expect((await estado(c, k.m)).map((g) => g.sku).sort()).toEqual(["PV-T2-AA34", "PV-T2-AA36", "PV-T2-BB34", "PV-T2-BB36"]);
    });
  });

  it("SKU à mão + Regerar juntos: o digitado vira 'manual_novo' (e fica manual=true); o Regerar não o toca", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const man = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-2", rev: (await idRev(c, k.m, k.kA, "34|PPP")).rev }];
      const p = await previa(c, k.m, "PV-T1", "letra", man);
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "manual_novo", sku_de: "AA34", sku_para: "MEU-2" });
      expect(linhaDe(p, k.kA, "36|PP").previa).toMatchObject({ acao: "muda", sku_para: "AAPP" });
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.m]);
      const r = await aplicar(c, k.m, man, "regerar", p.assinatura);
      expect([r.atualizados, r.manuais]).toEqual([3, 1]);
      expect((await estado(c, k.m)).find((g) => g.vk === k.kA && g.tk === "34|PPP")).toEqual({ vk: k.kA, tk: "34|PPP", sku: "MEU-2", manual: true });
    });
  });

  it("cenários difíceis (troca, cadeias, órfã, conflito com outro card): gravado = final da prévia, conflitos iguais", async () => {
    const casos: [string, (c: Client, k: Cen) => Promise<void>][] = [
      ["troca", (c, k) => siglas(c, k, "BB", "AA")],
      ["cadeia direta", (c, k) => siglas(c, k, "BB", "XX")],
      ["cadeia inversa", (c, k) => siglas(c, k, "XX", "AA")],
      ["órfã libera", async (c, k) => {
        await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 0, "36|PP": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 2`, [k.m]);
        await siglas(c, k, "BB", null);
      }],
      ["outro card", async (c, k) => { await outroCom(c, "PV-X", k.kA, "34|PPP", "AC34"); await siglas(c, k, "AC", null); }],
    ];
    for (const [nome, mexe] of casos) {
      await withTx(async (c) => {
        await prepara(c);
        const k = await cenario(c);
        await comoUsuario(c);
        await gerar(c, k.m);
        await mexe(c, k);
        const p = await previa(c, k.m, "PV-T1", "numero");
        const pl = await plano(c, k.m, "PV-T1", "numero");
        const r = await aplicar(c, k.m, [], "regerar", p.assinatura);
        expect(await estado(c, k.m), nome).toEqual(finalComoEstado(pl.final));
        expect(r.conflitos, nome).toEqual(p.conflitos);
      });
    }
  });

  it("SÓ LEITURA: skus_previa roda numa transação READ ONLY e não muda nada; volatilidades STABLE/IMMUTABLE", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const antes = await estado(c, k.m);
      await c.query("SAVEPOINT so_leitura");
      await c.query("SET LOCAL transaction_read_only = on");
      const man = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "RO-1", rev: 0 }];
      expect((await previa(c, k.m, "PV-T9", "letra", man)).status).toBe("ok");
      await c.query("ROLLBACK TO SAVEPOINT so_leitura");
      expect(await estado(c, k.m)).toEqual(antes);
      const vol = (await c.query(`SELECT p.proname AS f, p.provolatile AS v FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN
          ('skus_previa', '_skus_previa_core', '_skus_plano', '_skus_calc_ref_tipo', '_skus_matriz_ref_tipo', '_skus_assinatura')
        ORDER BY p.proname COLLATE "C"`)).rows;
      expect(vol).toEqual([
        { f: "_skus_assinatura", v: "i" }, { f: "_skus_calc_ref_tipo", v: "s" }, { f: "_skus_matriz_ref_tipo", v: "s" },
        { f: "_skus_plano", v: "s" }, { f: "_skus_previa_core", v: "s" }, { f: "skus_previa", v: "s" },
      ]);
    });
  });
});

describe.skipIf(!PRONTO)("SKU em prévia — colaboração (P0409) e erros PT", () => {
  it("outra pessoa edita/gera DEPOIS da prévia ⇒ P0409 e nada grava; assinatura nula/lixo ⇒ P0409; REF salva ≠ a da prévia ⇒ P0409", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const p = await previa(c, k.m, "PV-T1", "letra");
      await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'dela-1') AS v", [(await idRev(c, k.m, k.kB, "36|PP")).id]); // a outra pessoa
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.m]);
      const antes = await estado(c, k.m);
      expect(await falha(c, Q_APLICAR, [k.m, "[]", "regerar", p.assinatura]))
        .toEqual({ code: "P0409", message: "previa_desatualizada: os SKUs mudaram desde a prévia" });
      expect(await estado(c, k.m)).toEqual(antes);
      expect((await falha(c, Q_APLICAR, [k.m, "[]", "regerar", null])).code).toBe("P0409");
      expect((await falha(c, Q_APLICAR, [k.m, "[]", "regerar", "lixo"])).code).toBe("P0409");
      const p2 = await previa(c, k.m, "PV-T1", "letra");
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1", [k.m]); // o salvo não é o da prévia
      expect((await falha(c, Q_APLICAR, [k.m, "[]", "regerar", p2.assinatura])).code).toBe("P0409");
    });
  });

  it("B1 do G-migration: SKU à mão numa linha SEM registro (rev null) — outra pessoa grava a MESMA chave no meio ⇒ P0409 e o dela intacto; 'manter o meu' (rev novo) grava", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      // A linha kA|34|PPP está SEM registro (nunca gerou): o "a gravar" de A nasce com rev: null.
      const manA = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-a", rev: null }];
      const pA = await previa(c, k.m, "PV-T1", "numero", manA, "manuais");
      expect(linhaDe(pA, k.kA, "34|PPP").previa).toMatchObject({ acao: "manual_novo", sku_para: "MEU-A" });
      // Outra pessoa (B) grava a MESMA chave antes de A salvar: cria o registro do zero (mesma RPC de sempre, _id NULL = linha ainda sem SKU).
      await v(c, "SELECT public.salvar_sku_manual(NULL, 'dela-b', NULL, $1::uuid, $2::uuid, $3::text) AS v", [k.m, k.kA, "34|PPP"]);
      const antes = await estado(c, k.m);
      expect(antes.find((g) => g.vk === k.kA && g.tk === "34|PPP")?.sku).toBe("DELA-B");
      // A tenta salvar com a assinatura da SUA prévia (rev ainda null): a linha já tem registro agora ⇒ P0409, nada muda.
      expect(await falha(c, Q_APLICAR, [k.m, JSON.stringify(manA), "manuais", pA.assinatura]))
        .toEqual({ code: "P0409", message: "conflito_versao: a linha do SKU foi gravada por outra pessoa" });
      expect(await estado(c, k.m)).toEqual(antes); // o DELA-B de B sobrevive intacto
      // A prévia nova (sem refazer) já marca a linha em erro/P0409.
      const pA2 = await previa(c, k.m, "PV-T1", "numero", manA, "manuais");
      expect(linhaDe(pA2, k.kA, "34|PPP").previa).toMatchObject({ acao: "erro", code: "P0409" });
      // "Manter o meu": A relê o rev novo e tenta de novo — passa e grava o dele.
      const { rev: revB } = await idRev(c, k.m, k.kA, "34|PPP");
      const manA2 = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-a", rev: revB }];
      const pA3 = await previa(c, k.m, "PV-T1", "numero", manA2, "manuais");
      expect(pA3.erros).toEqual([]);
      expect((await aplicar(c, k.m, manA2, "manuais", pA3.assinatura)).manuais).toBe(1);
      expect((await estado(c, k.m)).find((g) => g.vk === k.kA && g.tk === "34|PPP")?.sku).toBe("MEU-A");
    });
  });

  it("N2: o 'a gravar' que sobrou de um Salvar em voo (rev velho) e JÁ está gravado igual, à mão ⇒ nada muda, sem P0409", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const man = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-4", rev: (await idRev(c, k.m, k.kA, "34|PPP")).rev }];
      const p1 = await previa(c, k.m, "PV-T1", "numero", man, "manuais");
      expect((await aplicar(c, k.m, man, "manuais", p1.assinatura)).manuais).toBe(1); // 1º Salvar: MEU-4 à mão, rev + 1
      const p2 = await previa(c, k.m, "PV-T1", "numero", man, "manuais");            // o mesmo "a gravar", rev velho
      expect(p2.erros).toEqual([]);
      expect(linhaDe(p2, k.kA, "34|PPP").previa ?? null).toBeNull();
      expect((await aplicar(c, k.m, man, "manuais", p2.assinatura)).manuais).toBe(0);
      expect((await estado(c, k.m)).find((g) => g.vk === k.kA && g.tk === "34|PPP")).toEqual({ vk: k.kA, tk: "34|PPP", sku: "MEU-4", manual: true });
    });
  });

  it("SKU digitado: rev velho ⇒ erro P0409 na linha e no Salvar ('manter o meu' com o rev novo passa); duplicado/fora da grade/inválido ⇒ mensagens PT da F3.5a", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const { id, rev } = await idRev(c, k.m, k.kA, "34|PPP");
      await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'dela-2') AS v", [id]); // rev + 1
      const velho = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-3", rev }];
      const p = await previa(c, k.m, "PV-T1", "numero", velho, "manuais");
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "erro", code: "P0409" });
      expect(await falha(c, Q_APLICAR, [k.m, JSON.stringify(velho), "manuais", p.assinatura]))
        .toEqual({ code: "P0409", message: "conflito_versao: o SKU foi alterado por outra pessoa" });
      const novo = [{ ...velho[0], rev: rev + 1 }];
      const p2 = await previa(c, k.m, "PV-T1", "numero", novo, "manuais");
      expect(p2.erros).toEqual([]);
      expect((await aplicar(c, k.m, novo, "manuais", p2.assinatura)).manuais).toBe(1);
      await outroCom(c, "PV-X", k.kB, "34|PPP", "DE-OUTRO");
      const casos: [unknown, string][] = [
        [{ variante_key: k.kB, tamanho_key: "36|PP", sku: "de-outro", rev: 0 }, "O SKU DE-OUTRO já existe em PV-T Outro (REF PV-X). Escolha outro."],
        [{ variante_key: k.kB, tamanho_key: "36|PP", sku: "meu-3", rev: 0 }, "O SKU MEU-3 já está em outra linha deste produto."],
        [{ variante_key: k.kB, tamanho_key: "38|P", sku: "x-1", rev: null }, "Esta variante/tamanho não está na grade do produto."],
        [{ variante_key: k.kB, tamanho_key: "36|PP", sku: "a#b", rev: 0 }, "SKU inválido: use só letras, números e - . _ /."],
      ];
      for (const [m1, msg] of casos) {
        const pe = await previa(c, k.m, "PV-T1", "numero", [m1], "manuais");
        expect(pe.erros.map((e: any) => [e.code, e.mensagem]), msg).toEqual([["P0001", msg]]);
        expect(await falha(c, Q_APLICAR, [k.m, JSON.stringify([m1]), "manuais", pe.assinatura]), msg).toEqual({ code: "P0001", message: msg });
      }
      expect((await falha(c, Q_PREVIA, [k.m, "PV-T1", "numero", JSON.stringify([{ variante_key: "x" }]), "manuais"])).message).toBe("SKUs à mão inválidos.");
      expect((await falha(c, Q_PREVIA, [k.m, "PV-T1", "grande", "[]", "manuais"])).message).toBe("\"Tamanho em\" inválido: use letra ou número.");
      expect((await falha(c, Q_PREVIA, [k.m, "PV-T1", "numero", "[]", "apagar"])).message).toBe("Modo da prévia dos SKUs inválido.");
    });
  });

  it("A#1 do G-migration: SKU digitado com ERRO numa linha que o Regerar (mesma chave) também mudaria — a linha fica 'erro', não vira 'muda'/'sai'/'conflito'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      // Digitado inválido na linha kA|34|PPP; "Tamanho em" trocado no rascunho ⇒ TODAS as automáticas divergem (viravam 'muda').
      const invalido = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "a#b", rev: 0 }];
      const p = await previa(c, k.m, "PV-T1", "letra", invalido, "regerar");
      expect(linhaDe(p, k.kA, "34|PPP").previa).toMatchObject({ acao: "erro", code: "P0001" });
      expect(p.erros.map((e: any) => e.mensagem)).toContain("SKU inválido: use só letras, números e - . _ /.");
      expect(p.status).toBe("ok"); // as outras 3 linhas continuam calculáveis
      // A mesma linha, mas agora "sai" (fora da grade) no lugar de "muda": digitado com rev velho ⇒ erro 'erro'/P0409, não 'sai'.
      const { rev } = await idRev(c, k.m, k.kA, "34|PPP");
      await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'dela-x') AS v", [(await idRev(c, k.m, k.kA, "34|PPP")).id]); // rev + 1
      const revVelho = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "meu-y", rev }];
      await c.query(`UPDATE public.modelo_grades SET grades = '{"34|PPP": 0, "36|PP": 1}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1`, [k.m]);
      const p2 = await previa(c, k.m, "PV-T1", "numero", revVelho, "regerar");
      expect(linhaDe(p2, k.kA, "34|PPP").previa).toMatchObject({ acao: "erro", code: "P0409" });
      expect(await falha(c, Q_APLICAR, [k.m, JSON.stringify(revVelho), "regerar", p2.assinatura])).toEqual(
        { code: "P0409", message: "conflito_versao: o SKU foi alterado por outra pessoa" });
    });
  });
});

describe.skipIf(!PRONTO)("SKU em prévia — permissões e ACL (#9)", () => {
  it("wrappers: login → loja → EDITAR o Planejamento (ver não basta — R8) → módulo; _core fechados p/ o PostgREST", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const comum = await um<{ id: string }>(c,
        `SELECT u.id FROM public.users u
          WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'user')
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role <> 'user')
            AND u.tenant_id <> $1 ORDER BY u.id LIMIT 1`, [T]);
      expect(comum?.id, "a cópia precisa de 1 usuário comum de outra loja").toBeTruthy();
      const args = [k.m, "PV-T1", "numero", "[]", "regerar"];
      const argsA = [k.m, "[]", "regerar", null];
      await semUsuario(c);
      expect(await falha(c, Q_PREVIA, args)).toEqual({ code: "42501", message: "Não autenticado." });
      const jwt = () => c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: comum.id, role: "authenticated" })]);
      await jwt();
      expect(await falha(c, Q_PREVIA, args)).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      await comoUsuario(c); // o UPDATE do próprio tenant do usuário comum precisa do super admin (users_prevent_self_role_change)
      await c.query("UPDATE public.users SET tenant_id = $1, papel_id = NULL WHERE id = $2", [T, comum.id]);
      await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [comum.id]);
      await c.query("INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'criacao_planejamento', true, false)", [comum.id, T]);
      await jwt();
      const semEditar = { code: "42501", message: "Sem permissão para editar SKUs (Planejamento de Produto)." };
      expect(await falha(c, Q_PREVIA, args)).toEqual(semEditar);
      expect(await falha(c, Q_APLICAR, argsA)).toEqual(semEditar);
      await comoUsuario(c);
      await c.query("UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'criacao_planejamento'", [comum.id]);
      await jwt();
      expect((await v(c, Q_PREVIA, args)).status).toBe("ok");
      await c.query("UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{\"criacao\": false}'::jsonb WHERE tenant_id = $1", [T]);
      expect(await falha(c, Q_PREVIA, args)).toEqual({ code: "42501", message: "Módulo Estilo & Engenharia não habilitado para esta loja." });
      await c.query("SET LOCAL ROLE authenticated");
      for (const q of ["SELECT public._skus_plano($1::uuid, 'X', 'letra', '[]'::jsonb, 'regerar')", "SELECT public._skus_previa_core($1::uuid, 'X', 'letra', '[]'::jsonb, 'regerar')",
                       "SELECT public._aplicar_skus_modelo_core($1::uuid, '[]'::jsonb, 'regerar', NULL)", "SELECT public._skus_calc_ref_tipo($1::uuid, 'X', 'letra')"]) {
        expect((await falha(c, q, [k.m])).code, q).toBe("42501");
      }
      await c.query("RESET ROLE");
    });
  });

  it("ACL: as 10 internas sem EXECUTE p/ PUBLIC/anon/authenticated (proacl das 3 redefinidas intacto); as 2 RPCs só authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const priv = (fn: string) => um<any>(c,
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = $1::regprocedure),
                        acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = $1::regprocedure)))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico`, [fn]);
      for (const f of [...REDEF.map((x) => x.fn), ...NOVAS.filter((x) => !x.rpc).map((x) => x.fn)]) {
        expect(await priv(f), f).toEqual({ anon: false, auth: false, publico: false });
      }
      for (const f of REDEF.map((x) => x.fn)) {
        expect((await um<{ a: string }>(c, "SELECT proacl::text AS a FROM pg_proc WHERE oid = $1::regprocedure", [f])).a, f)
          .toBe("{postgres=X/postgres,service_role=X/postgres}");
      }
      for (const f of NOVAS.filter((x) => x.rpc).map((x) => x.fn)) {
        expect(await priv(f), f).toEqual({ anon: false, auth: true, publico: false });
      }
    });
  });
});

describe.skipIf(!PRONTO_ANTES)("SKU em prévia — inverso (round-trip) e idempotência", () => {
  it("aplicar 2× não dá erro; o inverso devolve as 3 ao texto vivo byte a byte, tira as 9 e NÃO mexe nos SKUs gravados", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      const def = async (fn: string) => (await um<{ d: string | null }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])).d;
      // B7 do G-migration: em SÉRIE (não Promise.all) — o mesmo pg.Client não aceita consultas concorrentes (DeprecationWarning; quebra no pg@9).
      const vivas: (string | null)[] = [];
      for (const f of REDEF) vivas.push(await def(f.fn));
      REDEF.forEach((f, i) => expect(vivas[i], f.fn).toBe(corpo(INV, f.cria)));
      await aplica(c, MIG);
      await aplica(c, MIG); // idempotente
      for (const f of [...REDEF, ...NOVAS]) expect(await def(f.fn), f.fn).toBe(corpo(MIG, f.cria));
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const gravados = await estado(c, k.m);
      await aplica(c, INV);
      for (const [i, f] of REDEF.entries()) expect(await def(f.fn), f.fn).toBe(vivas[i]);
      for (const f of NOVAS) expect(await def(f.fn), f.fn).toBeNull();
      expect(await estado(c, k.m)).toEqual(gravados);
      await aplica(c, INV); // inverso idempotente
      await aplica(c, MIG);
      for (const f of NOVAS) expect(await def(f.fn), f.fn).toBe(corpo(MIG, f.cria));
    });
  });
});

describe.skipIf(!PRONTO)("SKU em prévia — executor (ramos estritos/não-estritos, A#5a) e passo 1 × salvar_sku_manual (A#5b)", () => {
  it("A#5a: executor ESTRITO — atualizar linha MANUAL/id inexistente ⇒ P0409; inserir SKU de outro card ⇒ P0409 (unique_violation); a pós-conferência confere o gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.m);
      const idA = (await idRev(c, k.m, k.kA, "34|PPP")).id;
      await v(c, "SELECT public.salvar_sku_manual($1::uuid, 'trava-a') AS v", [idA]); // vira manual
      const Q_EXEC = "SELECT public._skus_executar_plano($1::uuid, $2::uuid, $3::jsonb, $4::boolean) AS v";
      // 'atualizar' numa linha que é manual (id existe, mas .manual=true): o executor SÓ atualiza `NOT s.manual` ⇒ 0 linhas ⇒ estrito = P0409.
      const planoManual = { ops: [{ op: "atualizar", id: idA, vkey: k.kA, tkey: "34|PPP", sku: "NAOVAI" }] };
      expect(await falha(c, Q_EXEC, [k.m, T, JSON.stringify(planoManual), true])).toMatchObject({ code: "P0409" });
      // 'remover' de um id que não existe mais ⇒ P0409 estrito.
      const planoRemoverFalso = { ops: [{ op: "remover", id: "00000000-0000-0000-0000-000000000000", vkey: k.kA, tkey: "34|PPP", sku: "X" }] };
      expect(await falha(c, Q_EXEC, [k.m, T, JSON.stringify(planoRemoverFalso), true])).toMatchObject({ code: "P0409" });
      // 'inserir' um SKU que já existe em OUTRA linha do mesmo card ⇒ unique_violation ⇒ P0409 estrito ("outra pessoa gravou").
      const skuExistente = (await estado(c, k.m))[0].sku;
      const planoInserirDup = { ops: [{ op: "inserir", vkey: k.kB, tkey: "36|PP", sku: skuExistente }] };
      expect(await falha(c, Q_EXEC, [k.m, T, JSON.stringify(planoInserirDup), true])).toMatchObject({ code: "P0409" });
      // Não-estrito (gerar): a mesma colisão vira CONFLITO na resposta, sem RAISE.
      const rNaoEstrito = await v(c, Q_EXEC, [k.m, T, JSON.stringify(planoInserirDup), false]);
      expect(rNaoEstrito.conflitos).toHaveLength(1);
      expect(rNaoEstrito.conflitos[0].mensagem).toMatch(/outra pessoa gravou esta linha agora/);
      expect(await estado(c, k.m)).not.toContainEqual(expect.objectContaining({ vk: k.kB, tk: "36|PP", sku: skuExistente }));
      // Pós-conferência do aplicar: se o gravado divergir da assinatura da prévia por qualquer motivo, P0409 (provado indiretamente
      // pelo teste de P0409 já existente — aqui confirmamos que o aplicar chama a pós-conferência sempre que estrito=true).
      const p = await previa(c, k.m, "PV-T1", "numero");
      const r = await aplicar(c, k.m, [], "regerar", p.assinatura);
      expect(r.conflitos).toEqual([]);
    });
  });

  it("A#5b: passo 1 (SKU à mão) é equivalente a salvar_sku_manual — réplica (mesma REF) aceita; 2 digitados do MESMO lote colidindo; 'Informe o SKU.'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c, FMT_REF);
      await comoUsuario(c);
      await gerar(c, k.m);
      // Réplica: outro card com a MESMA REF pode usar o mesmo SKU na mesma chave (D5) — o digitado não conflita.
      await outroCom(c, "PV-T1", k.kB, "34|PPP", "PV-T1-BB34");
      const replica = [{ variante_key: k.kB, tamanho_key: "34|PPP", sku: "PV-T1-BB34", rev: (await idRev(c, k.m, k.kB, "34|PPP")).rev }];
      const pRep = await previa(c, k.m, "PV-T1", "numero", replica, "manuais");
      expect(pRep.erros).toEqual([]);
      expect(linhaDe(pRep, k.kB, "34|PPP").previa).toMatchObject({ acao: "manual_novo", sku_para: "PV-T1-BB34" });
      // 2 digitados do MESMO lote colidindo entre si (mesmo SKU em 2 chaves diferentes do MESMO card): o 2º acha o 1º como "dono".
      const colidem = [
        { variante_key: k.kA, tamanho_key: "34|PPP", sku: "mesmo-sku", rev: (await idRev(c, k.m, k.kA, "34|PPP")).rev },
        { variante_key: k.kA, tamanho_key: "36|PP", sku: "mesmo-sku", rev: (await idRev(c, k.m, k.kA, "36|PP")).rev },
      ];
      const pCol = await previa(c, k.m, "PV-T1", "numero", colidem, "manuais");
      expect(pCol.erros).toHaveLength(1);
      expect(pCol.erros[0].mensagem).toBe("O SKU MESMO-SKU já está em outra linha deste produto.");
      // "Informe o SKU." — sku vazio/só espaço, mesma mensagem de _sku_norm_manual.
      const vazio = [{ variante_key: k.kA, tamanho_key: "34|PPP", sku: "   ", rev: (await idRev(c, k.m, k.kA, "34|PPP")).rev }];
      const pVazio = await previa(c, k.m, "PV-T1", "numero", vazio, "manuais");
      expect(pVazio.erros.map((e: any) => e.mensagem)).toEqual(["Informe o SKU."]);
    });
  });
});

describe.skipIf(!PRONTO_ANTES)("SKU em prévia — negativos da guarda md5 e do $pos$ (A#5c), SÓ na janela N3", () => {
  it.skipIf(!MIG_TXN)("guarda: _skus_modelo_calc com OUTRO texto (outra frente) ⇒ a migration RECUSA e nada fica", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      const antes = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')) AS d")).d;
      const mexida = antes.replace("mo.tamanho_tipo AS mtipo,", "mo.tamanho_tipo AS mtipo, -- outra frente");
      expect(mexida).not.toBe(antes);
      await c.query(mexida); // DDL na txn do TESTE, só na cópia
      await expect(aplica(c, MIG)).rejects.toThrow(/outra frente mudou/);
      expect((await um<{ ok: boolean }>(c, "select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok")).ok).toBe(false);
    });
  });

  it.skipIf(!MIG_TXN)("F2 — pós-condição: md5 esperado de _skus_modelo_calc adulterado (simula corrupção pós-CREATE) ⇒ a ida RECUSA e desfaz TUDO", async () => {
    await withTx(async (c) => {
      await prepara(c, { aplicar: false });
      const mig = ler(MIG);
      const mdReal = "34d27675526dbed96ca6d514e9665771"; // md5 "depois" de _skus_modelo_calc (Task 2)
      const mdFalso = mdReal.slice(0, -1) + (mdReal.at(-1) === "0" ? "1" : "0");
      const alvo = `IF v_md5 IS DISTINCT FROM '${mdReal}' THEN\n    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_modelo_calc`;
      expect(mig.split(alvo).length - 1, "âncora 1×").toBe(1);
      const forjada = mig.replace(alvo, `IF v_md5 IS DISTINCT FROM '${mdFalso}' THEN\n    RAISE EXCEPTION 'sku_previa: pós-condição falhou — _skus_modelo_calc`);
      expect(forjada).not.toBe(mig);
      await expect(aplicarSql(c, semTravas(forjada, "migration forjada"), "migration forjada")).rejects.toThrow(/pós-condição falhou/);
      expect((await um<{ ok: boolean }>(c, "select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok")).ok).toBe(false);
      const depois = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')) AS d")).d;
      expect(depois).toBe(corpo(INV, REDEF[0].cria)); // desfeito — volta ao texto vivo (a migration inteira é 1 txn)
    });
  });
});
