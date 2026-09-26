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
