/**
 * F3.6 (Parte B) — reorganização do Sheet: 7 colunas novas em `modelos`, `_titulo_pagina_calculado`, o "Replicar card(s)"
 * levando os 7 campos + o "Tamanho em" (D4), as 4 funções do SKU SEM o padrão da loja (dono 25/set — status `sem_tamanho`)
 * e `tenant_config.keywords` (dono 25/set). Migration supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql e inverso em
 * supabase/rollback/ — GERADOS por .superpowers/sheet/mig/gerar_sql.py a partir do texto VIVO (não editar à mão).
 * Plano: docs/superpowers/plans/2026-09-25-sheet-planejamento-reorganizacao.md (Task 6).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela os blocos de banco
 * PULAM; com SHEET_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta. NUNCA `\i` (o COMMIT do arquivo vazaria — 15/set).
 * Dois modos:
 *  • SHEET_MIG_TXN=1 — a cópia SEM a migration; cada teste aplica o arquivo DENTRO da txn (mig-txn.ts: tira BEGIN/COMMIT;
 *    as 2 travas SET LOCAL do arquivo saem antes — o transaction_timeout de 3 s derrubaria a txn do teste). Segura ACCESS
 *    EXCLUSIVE em `modelos` durante o teste: o app de teste :5188 congela (N3 — dono avisado ANTES).
 *  • sem a variável — a migration JÁ aplicada na cópia (ensaio da Task 7 / Task 10); os testes do "antes" pulam.
 * O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { CASOS_TITULO } from "../fixtures/titulo-pagina-casos";
import { TITULO_CONECTIVOS, TITULO_MAIUSC, TITULO_MINUSC, tituloPaginaCalculado } from "../../src/lib/titulo-pagina";
import { draftFromModeloRow } from "../../src/components/planejamento/modelo-shared";
import { camposParaDuplicar } from "../../src/components/planejamento/planejamento-detail/helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql";
const INV = "supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql";
const FN = "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)";
const FN_TITULO = "public._titulo_pagina_calculado(text,text)";
const COL_ANTES = "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n";
const COL_DEPOIS =
  "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto, peso_kg, comprimento_cm, largura_cm, altura_cm, titulo_pagina, ncm, preco_anterior, tamanho_tipo\n";
const VAL_ANTES = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n";
const VAL_DEPOIS =
  "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto, o.peso_kg, o.comprimento_cm, o.largura_cm, o.altura_cm, o.titulo_pagina, o.ncm, o.preco_anterior, o.tamanho_tipo\n";
// F3.6 (dono 25/set) — as 4 funções do SKU SEM o padrão da loja do "Tamanho em": trocas EXATAS (1× cada) — as MESMAS do
// gerar_sql.py (TROCAS_SKU). Ordem fixa = a da guarda (depois do _replicar) e do md5-sku-*.txt.
const SKU_FNS = [
  { arq: "sku_config_normaliza", fn: "public._sku_config_normaliza(jsonb)", acl: "public._sku_config_normaliza(jsonb)", cria: "CREATE OR REPLACE FUNCTION public._sku_config_normaliza(" },
  { arq: "skus_modelo_calc", fn: "public._skus_modelo_calc(uuid)", acl: "public._skus_modelo_calc(uuid)", cria: "CREATE OR REPLACE FUNCTION public._skus_modelo_calc(" },
  { arq: "skus_modelo_core", fn: "public._skus_modelo_core(uuid)", acl: "public._skus_modelo_core(uuid)", cria: "CREATE OR REPLACE FUNCTION public._skus_modelo_core(" },
  { arq: "gerar_skus_modelo_core", fn: "public._gerar_skus_modelo_core(uuid,boolean)", acl: "public._gerar_skus_modelo_core(uuid, boolean)", cria: "CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(" },
] as const;
const TROCAS_SKU: Record<string, [string, string][]> = {
  sku_config_normaliza: [
    ["  v_s text;\n  v_tipo text;\n", "  v_s text;\n"],
    ["  v_tipo := coalesce(nullif(_c ->> 'tamanho_padrao', ''), 'letra');\n" +
      "  IF v_tipo NOT IN ('letra', 'numero') THEN\n" +
      "    RAISE EXCEPTION 'Tamanho padrão do SKU inválido (use letra ou número).' USING ERRCODE = 'P0001';\n" +
      "  END IF;\n" +
      "  RETURN jsonb_build_object('partes', v_out_partes, 'separadores', v_out_seps, 'tamanho_padrao', v_tipo);\n",
     "  -- F3.6 (dono 25/set): sem padrão da loja p/ o \"Tamanho em\" — a chave legada tamanho_padrao é IGNORADA (sem erro).\n" +
      "  RETURN jsonb_build_object('partes', v_out_partes, 'separadores', v_out_seps);\n"],
  ],
  skus_modelo_calc: [[
    "           coalesce(mo.tamanho_tipo, tc.sku_config ->> 'tamanho_padrao', 'letra') AS mtipo,\n",
    "           -- F3.6 (dono 25/set): SÓ o \"Tamanho em\" do card, sem padrão da loja. NULL (sem escolha) nunca vira SKU\n" +
      "           -- gravado: o core devolve 'sem_tamanho' e a geração não roda (_sku_tamanho_lado(_, NULL) cairia na letra).\n" +
      "           mo.tamanho_tipo AS mtipo,\n",
  ]],
  skus_modelo_core: [
    ["  v_tipo := coalesce(v_tipo_card, v_cfg ->> 'tamanho_padrao', 'letra');\n",
     "  v_tipo := v_tipo_card;  -- F3.6 (dono 25/set): sem padrão da loja — NULL = o card ainda não escolheu\n"],
    ["  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_refn = '' THEN 'aguardando_ref' ELSE 'ok' END;\n",
     "  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_refn = '' THEN 'aguardando_ref'\n" +
      "                   WHEN v_tipo IS NULL THEN 'sem_tamanho' ELSE 'ok' END;\n"],
  ],
  gerar_skus_modelo_core: [
    ["  v_cfg jsonb;\n", "  v_cfg jsonb;\n  v_tipo_card text;\n"],
    ["  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config\n    INTO v_tenant, v_refn, v_cfg\n",
     "  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo\n    INTO v_tenant, v_refn, v_cfg, v_tipo_card\n"],
    ["  IF v_cfg IS NOT NULL AND v_refn <> '' THEN\n",
     "  -- F3.6 (dono 25/set): sem \"Tamanho em\" no card não gera (a matriz diz 'sem_tamanho'); lido DEPOIS da trava.\n" +
      "  IF v_cfg IS NOT NULL AND v_refn <> '' AND v_tipo_card IS NOT NULL THEN\n"],
  ],
};
const aplicaTrocas = (t: string, trocas: [string, string][]) => trocas.reduce((s, [a, b]) => s.split(a).join(b), t);
const COLUNAS = ["titulo_pagina", "peso_kg", "comprimento_cm", "largura_cm", "altura_cm", "ncm", "preco_anterior"];
const CHECKS = ["modelos_altura_cm_nao_negativo", "modelos_comprimento_cm_nao_negativo", "modelos_largura_cm_nao_negativo", "modelos_peso_kg_nao_negativo"];
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SHEET_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

// SKU em PRÉVIA (20261005110000 — plano 2026-09-25-sku-previa-regerar, Task 3, P4): ela redefine 3 das 4 funções do SKU
// (_skus_modelo_calc/_skus_modelo_core/_gerar_skus_modelo_core). Com ela VIVA na cópia (LIFO), o texto esperado dessas 3 no
// modo sem variável é o dela. (O modo SHEET_MIG_TXN=1 não é tocado: ele exige a cópia SEM esta reorganização — R2 do G-plano.)
const MIG_PREVIA = "supabase/migrations/20261005110000_sku_previa_regerar.sql";

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** As 2 travas do arquivo (logo depois do BEGIN) saem da txn do teste — ver o cabeçalho. */
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);

function corpo(rel: string, inicio: string, fim: string): string {
  const t = ler(rel);
  const i = t.indexOf(inicio);
  const f = t.indexOf(fim, i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${inicio.slice(0, 50)}…)`);
  return t.slice(i, f + fim.length);
}
/** O texto de pg_get_functiondef = o corpo do arquivo + "\n" (o arquivo é GERADO no formato canônico). */
const corpoReplicar = (rel: string) => corpo(rel, "CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(", "end $function$");
const corpoTitulo = (rel: string) => corpo(rel, "CREATE OR REPLACE FUNCTION public._titulo_pagina_calculado(", "\n$function$");
const corpoSku = (rel: string, cria: string) => corpo(rel, cria, "\n$function$");
/** Todas as guardas de md5 do $guarda$, NA ORDEM: [_replicar, normaliza, calc, core, gerar]. */
const guardas = (rel: string) =>
  [...ler(rel).matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ antes: r[1], depois: r[2] }));
function guarda(rel: string): { antes: string; depois: string; titulo: string | null } {
  const t = ler(rel);
  const r = /v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/.exec(t);
  if (!r) throw new Error(`${rel}: guarda de md5 de _replicar não achada`);
  const ti = /v_md5 <> '([0-9a-f]{32})'/.exec(t);
  return { antes: r[1], depois: r[2], titulo: ti ? ti[1] : null };
}

describe("F3.6 — arquivos da migration (estático, sem banco)", () => {
  it("_replicar: migration = inverso (texto vivo) com SÓ as 2 linhas do INSERT trocadas; âncoras 1× cada", () => {
    const antes = corpoReplicar(INV);
    expect(antes.split(COL_ANTES).length - 1).toBe(1);
    expect(antes.split(VAL_ANTES).length - 1).toBe(1);
    expect(corpoReplicar(MIG)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
  });
  it("guarda de md5 EXATA nos 2 arquivos = md5 dos textos (antes = inverso, depois = migration); título = o da migration", () => {
    for (const f of [MIG, INV]) {
      const g = guarda(f);
      expect(g.antes, f).toBe(md5(corpoReplicar(INV) + "\n"));
      expect(g.depois, f).toBe(md5(corpoReplicar(MIG) + "\n"));
    }
    expect(guarda(MIG).titulo).toBe(md5(corpoTitulo(MIG) + "\n"));
  });
  it("4 funções do SKU (dono 25/set): migration = inverso (texto vivo) com SÓ as trocas; âncoras 1×; guarda md5 exata das 5", () => {
    const g = guardas(MIG);
    expect(g).toHaveLength(5);
    expect(guardas(INV)).toEqual(g);
    SKU_FNS.forEach((f, i) => {
      const antes = corpoSku(INV, f.cria);
      for (const [a] of TROCAS_SKU[f.arq]) expect(antes.split(a).length - 1, `${f.arq}: ${a.slice(0, 50)}`).toBe(1);
      const depois = aplicaTrocas(antes, TROCAS_SKU[f.arq]);
      expect(corpoSku(MIG, f.cria), f.arq).toBe(depois);
      expect(g[i + 1], f.arq).toEqual({ antes: md5(antes + "\n"), depois: md5(depois + "\n") });
      expect(depois, f.arq).not.toMatch(/->> 'tamanho_padrao'/); // R10: sem padrão da loja
    });
  });
  it("travas: 1 BEGIN/1 COMMIT e as 2 linhas SET LOCAL logo depois do BEGIN nos 2; NENHUMA DDL de policy", () => {
    for (const f of [MIG, INV]) {
      const t = ler(f);
      const linhas = t.split("\n");
      const i = linhas.findIndex((l) => l === "BEGIN;");
      expect(i, f).toBeGreaterThanOrEqual(0);
      expect(linhas.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(linhas.filter((l) => l === "BEGIN;"), f).toHaveLength(1);
      expect(linhas.filter((l) => l === "COMMIT;"), f).toHaveLength(1);
      expect(t, f).not.toMatch(/^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im);
    }
  });
  it("ordem da migration: guarda → título → _replicar → 4 do SKU → ACL → ALTER de modelos → COMMENT → ALTER de tenant_config POR ÚLTIMO", () => {
    const m = ler(MIG);
    const iGuarda = m.indexOf("DO $guarda$");
    const iTit = m.indexOf("CREATE OR REPLACE FUNCTION public._titulo_pagina_calculado(");
    const iRep = m.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
    const iSku = SKU_FNS.map((f) => m.indexOf(f.cria));
    const iAcl = m.indexOf("DO $acl$");
    const iAlter = m.indexOf("ALTER TABLE public.modelos");
    const iTc = m.indexOf("ALTER TABLE public.tenant_config");
    expect(iGuarda).toBeGreaterThan(m.indexOf("SET LOCAL transaction_timeout"));
    expect(iTit).toBeGreaterThan(iGuarda);
    expect(iRep).toBeGreaterThan(iTit);
    expect(Math.min(...iSku)).toBeGreaterThan(iRep);
    expect(iAcl).toBeGreaterThan(Math.max(...iSku));
    expect(iAlter).toBeGreaterThan(iAcl);
    expect(iTc).toBeGreaterThan(m.lastIndexOf("COMMENT ON COLUMN"));
    const antesDoPos = m.slice(iAlter, m.indexOf("DO $pos$")).replace(/--[^\n]*/g, "");
    // ALTER de modelos (com o DEFAULT 'letra' — P-25); o backfill; 8× COMMENT (7 + tamanho_tipo); ALTER de tenant_config;
    expect(antesDoPos.match(/;/g)).toHaveLength(11);
    expect(m).toContain("  ALTER COLUMN tamanho_tipo SET DEFAULT 'letra';\n"); // última cláusula do ALTER de modelos
    const iBackfill = m.indexOf("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE tamanho_tipo IS NULL;");
    expect(iBackfill).toBeGreaterThan(iAlter); // R41: dentro da janela da trava (nenhum NULL entra no meio)
    expect(iBackfill).toBeLessThan(m.indexOf("COMMENT ON COLUMN"));
    expect(m.split("UPDATE public.modelos").length - 1).toBe(1);
    expect(m.slice(iTc, m.indexOf("DO $pos$")).replace(/--[^\n]*/g, "").trim())
      .toBe("ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS keywords text;");
    expect(m).not.toMatch(/COMMENT ON COLUMN public\.tenant_config|(UPDATE|INSERT INTO|DELETE FROM) public\.tenant_config/); // R25
    // F2 (G-migration): pós-condição DENTRO da txn, entre o ALTER de tenant_config e o COMMIT; NOTIFY (F5) por último.
    const iPos = m.indexOf("DO $pos$");
    const iNotify = m.indexOf("NOTIFY pgrst, 'reload schema';");
    const iCommit = m.lastIndexOf("COMMIT;");
    expect(iPos).toBeGreaterThan(iTc);
    expect(iNotify).toBeGreaterThan(m.indexOf("$pos$;", iPos));
    expect(iCommit).toBeGreaterThan(iNotify);
    expect(m.slice(iCommit)).toBe("COMMIT;\n");
    for (const f of ["_replicar_cards_plan_tecido_core", "_sku_config_normaliza", "_skus_modelo_calc", "_skus_modelo_core", "_gerar_skus_modelo_core", "_titulo_pagina_calculado"]) {
      expect(m.slice(iPos, iNotify), f).toContain(f);
    }
    expect(m.slice(iPos, iNotify)).toContain("tamanho_tipo IS NULL");
    expect(m.slice(iPos, iNotify)).toContain("'keywords'");
    // F1: SET client_encoding = 'UTF8' é a 1ª instrução do arquivo, ANTES do BEGIN.
    expect(m.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith("SET client_encoding = 'UTF8';\nBEGIN;\n")).toBe(true);
    // F3: a guarda recusa acima de 2000 linhas com tamanho_tipo NULL.
    expect(m.slice(m.indexOf("DO $guarda$"), iTit)).toContain("> 2000");
    for (const f of SKU_FNS) expect(m).toContain(`REVOKE EXECUTE ON FUNCTION ${f.acl} FROM PUBLIC, anon, authenticated;`);
    for (const col of COLUNAS) expect(m).toContain(`ADD COLUMN IF NOT EXISTS ${col} `);
    for (const ck of CHECKS) expect(m).toContain(`CONSTRAINT ${ck} CHECK`);
    expect(m).not.toMatch(/DROP\s+COLUMN/i);
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._titulo_pagina_calculado(text, text) FROM PUBLIC, anon, authenticated;");
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;");
  });
  it("ordem do inverso: guarda (md5 + confirmação) → _replicar e as 4 do SKU de antes → ACL → DROP da função → DROP COLUMN de modelos → COMMENT antigo → DROP de keywords POR ÚLTIMO", () => {
    const v = ler(INV);
    const iGuarda = v.indexOf("DO $guarda$");
    const iRep = v.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
    const iSku = SKU_FNS.map((f) => v.indexOf(f.cria));
    const iAcl = v.indexOf("DO $acl$");
    const iDropFn = v.indexOf("DROP FUNCTION IF EXISTS public._titulo_pagina_calculado(text, text);");
    const iDropCol = v.indexOf("ALTER TABLE public.modelos");
    const iTc = v.indexOf("ALTER TABLE public.tenant_config");
    expect(iRep).toBeGreaterThan(iGuarda);
    expect(Math.min(...iSku)).toBeGreaterThan(iRep);
    expect(iAcl).toBeGreaterThan(Math.max(...iSku));
    expect(iDropFn).toBeGreaterThan(iAcl);
    expect(iDropCol).toBeGreaterThan(iDropFn);
    expect(iTc).toBeGreaterThan(iDropCol);
    const iPosInv = v.indexOf("DO $pos$");
    // ALTER … DROP COLUMN ×7; COMMENT antigo de tamanho_tipo (com ';' DENTRO da string); ALTER de tenant_config — até a pós-condição (o COMMIT vem depois dela agora — F2);
    expect(v.slice(iDropCol, iPosInv).replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''").match(/;/g)).toHaveLength(3);
    expect(v).toContain("ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS keywords;");
    for (const col of COLUNAS) expect(v).toContain(`DROP COLUMN IF EXISTS ${col}`);
    expect(v).toContain("  ALTER COLUMN tamanho_tipo DROP DEFAULT;\n"); // R44: só o DEFAULT sai…
    expect(v).not.toMatch(/UPDATE\s+public\.modelos/i); // …o backfill NÃO é desfeito
    expect(v).toContain("o backfill (NULL → letra) NÃO é desfeito");
    expect(v).toContain("app.confirmo_apagar_campos_sheet");
    expect(v).toContain("DROP COLUMN apaga");
    // F2 (G-migration): pós-condição DENTRO da txn, entre o DROP de keywords e o COMMIT; NOTIFY (F5) por último.
    const iNotifyInv = v.indexOf("NOTIFY pgrst, 'reload schema';");
    const iCommitInv = v.lastIndexOf("COMMIT;");
    expect(iPosInv).toBeGreaterThan(iTc);
    expect(iNotifyInv).toBeGreaterThan(v.indexOf("$pos$;", iPosInv));
    expect(iCommitInv).toBeGreaterThan(iNotifyInv);
    expect(v.slice(iCommitInv)).toBe("COMMIT;\n");
    for (const f of ["_replicar_cards_plan_tecido_core", "_sku_config_normaliza", "_skus_modelo_calc", "_skus_modelo_core", "_gerar_skus_modelo_core", "_titulo_pagina_calculado"]) {
      expect(v.slice(iPosInv, iNotifyInv), f).toContain(f);
    }
    // F4: LOCK TABLE, NESSA ordem, logo depois das travas SET LOCAL e ANTES da guarda de dado.
    const iLock = v.indexOf("LOCK TABLE public.modelos, public.tenant_config IN ACCESS EXCLUSIVE MODE;");
    expect(iLock).toBeGreaterThan(v.indexOf("SET LOCAL transaction_timeout"));
    expect(iLock).toBeLessThan(iGuarda);
    // F1: SET client_encoding = 'UTF8' é a 1ª instrução do arquivo, ANTES do BEGIN.
    expect(v.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith("SET client_encoding = 'UTF8';\nBEGIN;\n")).toBe(true);
  });
  it("espelho TS × SQL: as listas fixas e os conectivos do TS estão literalmente no SQL do título", () => {
    const t = corpoTitulo(MIG);
    expect(t).toContain(`'${TITULO_MAIUSC}'`);
    expect(t).toContain(`'${TITULO_MINUSC}'`);
    expect(t).toContain(`IN (${TITULO_CONECTIVOS.map((c) => `'${c}'`).join(", ")})`);
  });
});

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query(`select to_regprocedure('${FN_TITULO}') is not null as ok`)).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function timeouts(c: Client, lock = "3s"): Promise<void> {
  exigeBancoLocal();
  await c.query(`SET LOCAL lock_timeout = '${lock}'`);
  await c.query("SET LOCAL statement_timeout = '60s'");
}
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) await aplica(c, MIG);
}
async function previaViva(c: Client): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "select to_regprocedure('public.skus_previa(uuid,text,text,jsonb,text)') is not null as ok")).ok;
}
const def = async (c: Client, fn = FN) =>
  (await um<{ d: string | null }>(c, "select pg_get_functiondef(to_regprocedure($1)) d", [fn])).d;
const acl = async (c: Client, fn = FN) =>
  (await um<{ a: string | null }>(c, "select proacl::text a from pg_proc where oid = to_regprocedure($1)", [fn])).a;
const privs = (c: Client, fn: string) =>
  um<{ anon: boolean; auth: boolean; srv: boolean }>(c,
    `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth,
            has_function_privilege('service_role', $1, 'EXECUTE') srv`, [fn]);
async function colunas(c: Client) {
  const { rows } = await c.query(
    `select a.attname nome, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.modelos'::regclass and a.attname = any($1) and not a.attisdropped
      order by a.attname`, [COLUNAS]);
  return rows as { nome: string; tipo: string; nn: boolean; def: string | null }[];
}
const contagens = async (c: Client) => (await um<{ v: string }>(c,
  `select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' ||
          (select count(*) from pg_trigger t join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace
            where n.nspname = 'public' and not t.tgisinternal) v`)).v;
/** P-25: o DEFAULT de modelos.tamanho_tipo ("-" = sem) e quantos NULL há. */
const ttDefault = async (c: Client) => (await um<{ d: string }>(c,
  `select coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.modelos'::regclass and a.attname = 'tamanho_tipo'), '-') d`)).d;
const ttNulos = async (c: Client) => (await um<{ n: number }>(c, "select count(*)::int n from public.modelos where tamanho_tipo is null")).n;
const temKeywords = async (c: Client) => (await um<{ n: number }>(c,
  "select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'keywords'")).n;
const comentarioTamanhoTipo = async (c: Client) => (await um<{ d: string | null }>(c,
  "select col_description('public.modelos'::regclass, (select attnum from pg_attribute where attrelid = 'public.modelos'::regclass and attname = 'tamanho_tipo')) d")).d;
/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável). */
async function falha(c: Client, sql: string): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT sheet_falha");
  try {
    await c.query(sql);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sheet_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT sheet_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

describe.skipIf(!PRONTO)("F3.6 — banco (cópia local, txn revertida)", () => {
  it("anti-drift do título: SQL ≡ TS em TODAS as fixtures", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_TITULO) {
        const r = await um<{ t: string }>(c, "select public._titulo_pagina_calculado($1, $2) t", [k.nome, k.loja]);
        expect(r.t, JSON.stringify(k)).toBe(k.esperado);
        expect(tituloPaginaCalculado(k.nome, k.loja)).toBe(r.t);
      }
    });
  });

  it("colunas: tipos da spec, nullable, sem default; os 4 CHECKs nomeados (>= 0)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await colunas(c)).toEqual([
        { nome: "altura_cm", tipo: "numeric(10,2)", nn: false, def: null },
        { nome: "comprimento_cm", tipo: "numeric(10,2)", nn: false, def: null },
        { nome: "largura_cm", tipo: "numeric(10,2)", nn: false, def: null },
        { nome: "ncm", tipo: "text", nn: false, def: null },
        { nome: "peso_kg", tipo: "numeric(10,3)", nn: false, def: null },
        { nome: "preco_anterior", tipo: "numeric(12,2)", nn: false, def: null },
        { nome: "titulo_pagina", tipo: "text", nn: false, def: null },
      ]);
      // F7(a, G-migration B-M4): liga a constraint à COLUNA (conkey → attname) e exige ">= 0" EXATO — não regex frouxa.
      const { rows } = await c.query(
        `select con.conname,
                (select a.attname from pg_attribute a where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) col,
                pg_get_constraintdef(con.oid) d
           from pg_constraint con
          where con.conrelid = 'public.modelos'::regclass and con.conname = any($1) order by con.conname`, [CHECKS]);
      expect(rows.map((r) => r.conname)).toEqual(CHECKS);
      for (const r of rows) {
        expect(r.col, r.conname).toBe(r.conname.replace(/^modelos_/, "").replace(/_nao_negativo$/, ""));
        expect(r.d, r.conname).toBe(`CHECK ((${r.col} >= (0)::numeric))`);
      }
    });
  });

  it("CHECK: negativo recusado (23514) nos 4 de peso/medidas; zero aceito; ncm e preco_anterior SEM CHECK (R8)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      for (const col of ["peso_kg", "comprimento_cm", "largura_cm", "altura_cm"]) {
        const e = await falha(c, `insert into modelos (nome, ${col}) values ('ITEST-SHEET-NEG', -1)`);
        expect(e.code, col).toBe("23514");
      }
      await c.query(`insert into modelos (nome, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior)
                     values ('ITEST-SHEET-ZERO', 0, 0, 0, 0, 'abc', -5)`);
    });
  });

  it("_titulo_pagina_calculado: texto = o do arquivo (md5 da guarda); IMMUTABLE; EXECUTE fechado p/ anon/authenticated, aberto p/ service_role", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const d = (await def(c, FN_TITULO))!;
      expect(d, `texto canônico do PG (o gerador tem de emitir IGUAL):\n${d}`).toBe(corpoTitulo(MIG) + "\n");
      expect(md5(d)).toBe(guarda(MIG).titulo);
      expect((await um<{ v: string }>(c, "select provolatile v from pg_proc where oid = to_regprocedure($1)", [FN_TITULO])).v).toBe("i");
      expect(await privs(c, FN_TITULO)).toEqual({ anon: false, auth: false, srv: true });
    });
  });

  it("_replicar: texto = o do arquivo (md5 'depois' da guarda); EXECUTE fechado p/ anon/authenticated (#9)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const d = (await def(c))!;
      // "Tamanho em" nos cards (20261011100000, LIFO por cima desta): na cópia com ela o _replicar está no texto DELA (a vaga
      // livre reaproveitada zera o tamanho_tipo; a suíte tamanho-em-cards prova "depois = este texto + só a troca dela").
      if (md5(d) !== "aaf3f2e4e4bd8eb14b99d53c79a653da") {
        expect(d).toBe(corpoReplicar(MIG) + "\n");
        expect(md5(d)).toBe(guarda(MIG).depois);
      }
      const p = await privs(c, FN);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
    });
  });

  it("Replicar card(s) leva os 7 campos e o 'Tamanho em' como estão (manual E automático/NULL — ruling 5; D4)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      await c.query(
        `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
         on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
        [TENANT_TESTE],
      );
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-SHEET-REP','rascunho') returning id`);
      const com = await um<{ id: string }>(c,
        `insert into modelos (nome, titulo_pagina, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior, tamanho_tipo)
         values ('ITEST-SHEET-COM', 'Título à mão (ITEST)', 0.35, 60, 40, 2.5, '6204.43.00', 199.9, 'numero') returning id`);
      const sem = await um<{ id: string }>(c, `insert into modelos (nome) values ('ITEST-SHEET-SEM') returning id`);
      const r = await um<{ out: { origem_modelo_id: string; novo_modelo_id: string }[] }>(c,
        `select public.replicar_cards_plan_tecido($1::uuid, null::uuid, array[$2::uuid, $3::uuid], null::integer) out`,
        [col.id, com.id, sem.id]);
      const novo = (orig: string) => r.out.find((x) => x.origem_modelo_id === orig)!.novo_modelo_id;
      const q = `select titulo_pagina, peso_kg::text peso, comprimento_cm::text comp, largura_cm::text larg, altura_cm::text alt,
                        ncm, preco_anterior::text pa, tamanho_tipo tt from modelos where id = $1`;
      expect(await um(c, q, [novo(com.id)])).toEqual({
        titulo_pagina: "Título à mão (ITEST)", peso: "0.350", comp: "60.00", larg: "40.00", alt: "2.50", ncm: "6204.43.00", pa: "199.90", tt: "numero",
      });
      // P-25: o `sem` nasceu sem a coluna ⇒ DEFAULT 'letra', e a réplica leva o valor (D4)
      expect(await um(c, q, [novo(sem.id)])).toEqual({ titulo_pagina: null, peso: null, comp: null, larg: null, alt: null, ncm: null, pa: null, tt: "letra" });
    });
  });

  it("Duplicar (payload de camposParaDuplicar, como o app): toda chave é coluna; Título e Preço anterior voltam a NULL; NCM/peso/medidas/descrição vão", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      // F7(b, G-migration B-M4): original em 'numero' (≠ DEFAULT 'letra') — só assim o teste distingue "Duplicar LEVA o
      // Tamanho em" de "caiu no DEFAULT".
      const orig = await um<{ id: string }>(c,
        `insert into modelos (nome, titulo_pagina, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior, descricao_produto, tamanho_tipo)
         values ('ITEST-SHEET-DUP', 'Título à mão', 0.35, 60, 40, 2.5, '6204.43.00', 199.9, 'Descrição ITEST', 'numero') returning id`);
      const row = await um<Record<string, unknown>>(c, "select * from modelos where id = $1", [orig.id]);
      // O MESMO objeto que o Duplicar do Sheet manda no INSERT (PlanejamentoDetail.tsx, mutation `duplicate`).
      const payload: Record<string, unknown> = {
        ...camposParaDuplicar(draftFromModeloRow(row)),
        status_planejamento: "em_planejamento", data_lancamento: null, versao: 2, modelo_base_id: orig.id,
      };
      const cols = (await c.query(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'modelos'",
      )).rows.map((r) => r.column_name as string);
      expect(Object.keys(payload).filter((k) => !cols.includes(k))).toEqual([]); // senão PGRST204 no app
      expect(payload).not.toHaveProperty("titulo_pagina");
      expect(payload).not.toHaveProperty("preco_anterior");
      const lista = Object.keys(payload).map((k) => `"${k}"`).join(", ");
      const novo = await um<{ id: string }>(c,
        `insert into public.modelos (${lista}) select ${lista} from jsonb_populate_record(null::public.modelos, $1::jsonb) returning id`,
        [JSON.stringify(payload)]);
      expect(await um(c,
        `select titulo_pagina, preco_anterior, ncm, peso_kg::text peso, comprimento_cm::text comp, largura_cm::text larg,
                altura_cm::text alt, descricao_produto, tamanho_tipo from modelos where id = $1`, [novo.id],
      )).toEqual({
        titulo_pagina: null, preco_anterior: null, ncm: "6204.43.00", peso: "0.350", comp: "60.00", larg: "40.00", alt: "2.50",
        descricao_produto: "Descrição ITEST", tamanho_tipo: "numero",
      });
    });
  });

  it("R24 — _sku_config_normaliza IGNORA a chave legada tamanho_padrao (sem RAISE, fora da saída)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const tp of ["numero", "grande", 5, null]) {
        const r = await um<{ v: unknown }>(c, "select public._sku_config_normaliza($1::jsonb) v",
          [JSON.stringify({ partes: ["ref", "tamanho"], tamanho_padrao: tp })]);
        expect(r.v, String(tp)).toEqual({ partes: ["ref", "tamanho"], separadores: {} });
      }
    });
  });

  it("R23 — sem 'Tamanho em': 'sem_tamanho' depois de sem_formato/aguardando_ref; NADA gerado; escolhido, gera; gravado + NULL = só os gravados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const T = TENANT_TESTE;
      const cor = await um<{ id: string }>(c, "insert into public.cores (tenant_id, nome, sigla_sku) values ($1, 'ITEST-SHEET Cor', 'IT') returning id", [T]);
      const art = await um<{ id: string }>(c, "insert into public.artigos (tenant_id, nome) values ($1, 'ITEST-SHEET Tecido') returning id", [T]);
      const vt = await um<{ id: string }>(c,
        "insert into public.variantes_tecido (tenant_id, artigo_id, cor_id) values ($1, $2, $3) returning id", [T, art.id, cor.id]);
      const m = await um<{ id: string }>(c,
        // P-25: NULL EXPLÍCITO (com o DEFAULT, sem a coluna o card já nasceria em 'letra') — é a REDE do banco que se prova aqui
        "insert into public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) values ($1, 'ITEST-SHEET SKU', '', 'interno', null) returning id", [T]);
      const mt = await um<{ id: string }>(c,
        "insert into public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id", [m.id, art.id]);
      await c.query("insert into public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1, $2, 1)", [mt.id, vt.id]);
      await c.query("insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1, 1, '{\"34|PPP\": 2}'::jsonb, 2)", [m.id]);
      await comoUsuario(c);
      const matriz = async () => (await um<{ v: any }>(c, "select public.skus_modelo($1) v", [m.id])).v;
      const gerar = async (regerar: boolean) => (await um<{ v: any }>(c, "select public.gerar_skus_modelo($1, $2) v", [m.id, regerar])).v;
      await c.query("update public.tenant_config set sku_config = null where tenant_id = $1", [T]);
      expect((await matriz()).status).toBe("sem_formato"); // vence REF vazia e "Tamanho em" vazio
      await c.query("update public.tenant_config set sku_config = $2::jsonb, tamanhos_sku = $3::jsonb where tenant_id = $1", [T,
        JSON.stringify({ partes: ["ref", "cor_base", "tamanho"], separadores: { "cor_base|tamanho": "-" }, tamanho_padrao: "numero" }),
        JSON.stringify({ "34": "34", PPP: "PPP" })]);
      expect((await um<{ s: unknown }>(c, "select sku_config s from public.tenant_config where tenant_id = $1", [T])).s)
        .toEqual({ partes: ["ref", "cor_base", "tamanho"], separadores: { "cor_base|tamanho": "-" } }); // R24 pelo gatilho
      expect((await matriz()).status).toBe("aguardando_ref"); // REF vazia vence "Tamanho em" vazio
      await c.query("update public.modelos set ref = 'ITSK1' where id = $1", [m.id]);
      let mz = await matriz();
      expect([mz.status, mz.tamanho_tipo, mz.linhas]).toEqual(["sem_tamanho", null, []]); // a chave legada NÃO vale como padrão
      let g = await gerar(true);
      expect([g.status, g.criados, g.removidos, g.conflitos]).toEqual(["sem_tamanho", 0, 0, []]);
      expect((await um<{ n: number }>(c, "select count(*)::int n from public.modelo_skus where modelo_id = $1", [m.id])).n).toBe(0);
      await c.query("update public.modelos set tamanho_tipo = 'letra' where id = $1", [m.id]);
      g = await gerar(false);
      expect([g.status, g.criados]).toEqual(["ok", 1]);
      expect(g.linhas[0]).toMatchObject({ tamanho_key: "34|PPP", sku: "ITSK1IT-PPP", estado: "ok" });
      // SKU gravado e o "Tamanho em" volta a NULL (só por SQL — a tela não tem "nenhum"): só os gravados; o Regerar não remove
      await c.query("update public.modelos set tamanho_tipo = null where id = $1", [m.id]);
      mz = await matriz();
      expect([mz.status, mz.tamanho_tipo, mz.linhas.map((l: { estado: string }) => l.estado)]).toEqual(["sem_tamanho", null, ["salvo"]]);
      g = await gerar(true);
      expect([g.criados, g.atualizados, g.removidos]).toEqual([0, 0, 0]);
    });
  });

  it("4 funções do SKU: texto = o do arquivo (md5 'depois' da guarda); proacl de antes; anon/authenticated sem EXECUTE (#9)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const g = guardas(MIG);
      const viva = !MIG_TXN && (await previaViva(c));
      for (const [i, f] of SKU_FNS.entries()) {
        const d = (await def(c, f.fn))!;
        if (viva && f.arq !== "sku_config_normaliza") {
          expect(d, f.arq).toBe(corpoSku(MIG_PREVIA, f.cria) + "\n"); // P4 — redefinida pela prévia
        } else {
          expect(d, f.arq).toBe(corpoSku(MIG, f.cria) + "\n");
          expect(md5(d), f.arq).toBe(g[i + 1].depois);
        }
        expect(await acl(c, f.fn), f.arq).toBe("{postgres=X/postgres,service_role=X/postgres}");
        const p = await privs(c, f.fn);
        expect([p.anon, p.auth], f.arq).toEqual([false, false]);
      }
    });
  });

  it("R38 — tenant_config.keywords: text nullable sem default; upsert SEM a chave (o da Config) não apaga; gatilhos não a olham", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const T = TENANT_TESTE;
      expect(await um(c, `select format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = 'public.tenant_config'::regclass and a.attname = 'keywords' and not a.attisdropped`)).toEqual({ tipo: "text", nn: false, def: null });
      const fila0 = (await um<{ n: number }>(c, "select count(*)::int n from public.kanban_recalculo_fila")).n;
      await c.query("update public.tenant_config set keywords = 'moda, linho (ITEST)' where tenant_id = $1", [T]);
      expect((await um<{ n: number }>(c, "select count(*)::int n from public.kanban_recalculo_fila")).n).toBe(fila0); // trg_kanban_config quieto
      // o Salvar da Config: PostgREST upsert = INSERT … ON CONFLICT DO UPDATE SÓ das colunas enviadas (aqui, sem keywords)
      await c.query(`insert into public.tenant_config (tenant_id, timezone) values ($1, 'America/Sao_Paulo')
                     on conflict (tenant_id) do update set timezone = excluded.timezone`, [T]);
      expect((await um<{ k: string | null }>(c, "select keywords k from public.tenant_config where tenant_id = $1", [T])).k).toBe("moda, linho (ITEST)");
      const gat = (await c.query("select pg_get_triggerdef(oid) d from pg_trigger where tgrelid = 'public.tenant_config'::regclass and not tgisinternal")).rows;
      expect(gat.some((r) => String(r.d).includes("keywords"))).toBe(false);
      expect(await def(c, "public.fn_kanban_chave_protegida()")).not.toContain("keywords");
    });
  });

  it("P-25 — nasce em Letra: DEFAULT 'letra' (INSERT SEM a coluna — o caminho de PA/importado/Plan. Tecido/importação/lote, R46); nenhum NULL depois do backfill; NULL explícito segue possível (rede R23)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await ttDefault(c)).toBe("'letra'::text");
      expect(await ttNulos(c)).toBe(0);
      const semColuna = await um<{ tt: string | null }>(c,
        "insert into public.modelos (tenant_id, nome) values ($1, 'ITEST-SHEET-TT') returning tamanho_tipo tt", [TENANT_TESTE]);
      expect(semColuna.tt).toBe("letra");
      const explicito = await um<{ tt: string | null }>(c,
        "insert into public.modelos (tenant_id, nome, tamanho_tipo) values ($1, 'ITEST-SHEET-TT2', null) returning tamanho_tipo tt", [TENANT_TESTE]);
      expect(explicito.tt).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("antes/depois: inverso = texto VIVO; +1 função, +0 gatilhos; _replicar = antes com SÓ as 2 linhas; 4 do SKU = antes com SÓ as trocas; ACL igual; keywords", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = (await def(c))!;
      const aclAntes = await acl(c);
      const skuAntes = await Promise.all(SKU_FNS.map((s) => def(c, s.fn)));
      const skuAcl = await Promise.all(SKU_FNS.map((s) => acl(c, s.fn)));
      const [f, g] = (await contagens(c)).split("|").map(Number);
      expect(antes).toBe(corpoReplicar(INV) + "\n"); // o inverso restaura o texto VIVO da cópia, byte a byte
      expect(md5(antes)).toBe(guarda(MIG).antes);
      SKU_FNS.forEach((s, i) => expect(skuAntes[i], s.arq).toBe(corpoSku(INV, s.cria) + "\n"));
      expect(await colunas(c)).toEqual([]);
      expect(await temKeywords(c)).toBe(0);
      expect(await ttDefault(c)).toBe("-");
      const nulosAntes = await ttNulos(c); // na cópia de 25/set: 272 (depois do ensaio da Task 7: 0 — R44)
      await c.query(`create temp table _tt_antes on commit drop as
        select id, rev, ref, ref_auto, custo_terceirizados_aprovado, status_desenvolvimento, tamanho_tipo from public.modelos`);
      const auditAntes = (await um<{ n: number }>(c, "select count(*)::int n from public.audit_log where tabela = 'modelos'")).n;
      const filaAntes = (await um<{ n: number }>(c, "select count(*)::int n from public.kanban_recalculo_fila")).n;
      await aplica(c, MIG);
      expect(await contagens(c)).toBe(`${f + 1}|${g}`);
      // P-25 (R41–R42): DEFAULT + backfill; o backfill muda SÓ tamanho_tipo (+rev e 1 audit por card) — nada de REF/MO/status/kanban
      expect(await ttDefault(c)).toBe("'letra'::text");
      expect(await ttNulos(c)).toBe(0);
      expect(await um(c, `select count(*) filter (where m.tamanho_tipo is distinct from a.tamanho_tipo)::int mudou,
          count(*) filter (where a.tamanho_tipo is null and m.rev = a.rev + 1)::int rev,
          count(*) filter (where m.ref is distinct from a.ref or m.ref_auto is distinct from a.ref_auto
            or m.custo_terceirizados_aprovado is distinct from a.custo_terceirizados_aprovado
            or m.status_desenvolvimento is distinct from a.status_desenvolvimento)::int outros
        from public.modelos m join _tt_antes a using (id)`)).toEqual({ mudou: nulosAntes, rev: nulosAntes, outros: 0 });
      expect((await um<{ n: number }>(c, "select count(*)::int n from public.audit_log where tabela = 'modelos'")).n - auditAntes).toBe(nulosAntes);
      expect((await um<{ n: number }>(c, "select count(*)::int n from public.kanban_recalculo_fila")).n).toBe(filaAntes);
      expect(await def(c)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
      expect(await acl(c)).toBe(aclAntes);
      for (const [i, s] of SKU_FNS.entries()) {
        expect(await def(c, s.fn), s.arq).toBe(aplicaTrocas(skuAntes[i]!, TROCAS_SKU[s.arq]));
        expect(await acl(c, s.fn), s.arq).toBe(skuAcl[i]);
      }
      expect(await temKeywords(c)).toBe(1);
    });
  });

  it.skipIf(!MIG_TXN)("idempotente: 2× na mesma txn dá o mesmo estado (a guarda aceita o texto desta migration)", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      await aplica(c, MIG);
      const d1 = await def(c);
      const t1 = await def(c, FN_TITULO);
      const c1 = await colunas(c);
      const n1 = await contagens(c);
      const s1 = await Promise.all(SKU_FNS.map((s) => def(c, s.fn)));
      await aplica(c, MIG);
      expect(await def(c)).toBe(d1);
      expect(await def(c, FN_TITULO)).toBe(t1);
      expect(await colunas(c)).toEqual(c1);
      expect(await contagens(c)).toBe(n1);
      expect(await Promise.all(SKU_FNS.map((s) => def(c, s.fn)))).toEqual(s1);
      expect(await temKeywords(c)).toBe(1);
      expect([await ttDefault(c), await ttNulos(c)]).toEqual(["'letra'::text", 0]);
    });
  });

  it.skipIf(!MIG_TXN)("guarda: _replicar com OUTRO texto (outra frente) ⇒ a migration RECUSA e nada fica", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = (await def(c))!;
      const mexida = antes.replace("-- (0) Guardas de tenant/destino.", "-- (0) Guardas de tenant/destino (outra frente).");
      expect(mexida).not.toBe(antes);
      await c.query(mexida); // DDL na txn do TESTE, só na cópia (timeouts → exigeBancoLocal)
      await expect(aplica(c, MIG)).rejects.toThrow(/outra frente mudou/);
      expect(await colunas(c)).toEqual([]);
      expect(await def(c, FN_TITULO)).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("guarda: uma das 4 do SKU com OUTRO texto (outra frente) ⇒ a migration RECUSA e nada fica", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = (await def(c, SKU_FNS[0].fn))!;
      const mexida = antes.replace("'Formato do SKU inválido.'", "'Formato do SKU inválido (outra frente).'");
      expect(mexida).not.toBe(antes);
      await c.query(mexida); // DDL na txn do TESTE, só na cópia (timeouts → exigeBancoLocal)
      await expect(aplica(c, MIG)).rejects.toThrow(/outra frente mudou/);
      expect(await colunas(c)).toEqual([]);
      expect(await temKeywords(c)).toBe(0);
      expect(await def(c, FN_TITULO)).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("F2 — pós-condição: md5 esperado adulterado (simula corrupção pós-CREATE) ⇒ a ida RECUSA e desfaz TUDO", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = (await def(c))!;
      const aclAntes = await acl(c);
      const skuAntes = await Promise.all(SKU_FNS.map((s) => def(c, s.fn)));
      // Adultera SÓ o md5 "depois" que a pós-condição exige para _titulo_pagina_calculado (1 dígito hex trocado) — a
      // função continua sendo CRIADA com o texto REAL do arquivo (guarda/CREATE intocados); só o DO $pos$ passa a
      // exigir um texto que nunca vai bater ⇒ RAISE ⇒ ROLLBACK de tudo (mesma técnica "outra frente", na PONTA da txn).
      const mig = ler(MIG);
      const mdReal = md5(corpoTitulo(MIG) + "\n");
      const mdFalso = mdReal.slice(0, -1) + (mdReal.at(-1) === "0" ? "1" : "0");
      // "v_md5 <> '<md5>'" aparece 2×: a guarda PRÉVIA (linha ~86, "já existe com outro texto") e a pós-condição (F2,
      // "pós-condição falhou"). A âncora inclui o texto da mensagem da pós-condição p/ mirar SÓ nela (1×).
      const alvo = `IF v_md5 <> '${mdReal}' THEN\n    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou`;
      expect(mig.split(alvo).length - 1).toBe(1); // âncora 1×, como o resto da suíte exige
      const forjada = mig.replace(alvo, `IF v_md5 <> '${mdFalso}' THEN\n    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou`);
      expect(forjada).not.toBe(mig);
      await expect(aplicarSql(c, semTravas(forjada, "migration forjada"), "migration forjada")).rejects.toThrow(/pós-condição falhou/);
      expect(await colunas(c)).toEqual([]);
      expect(await temKeywords(c)).toBe(0);
      expect(await def(c)).toBe(antes);
      expect(await acl(c)).toBe(aclAntes);
      expect(await Promise.all(SKU_FNS.map((s) => def(c, s.fn)))).toEqual(skuAntes);
      expect(await def(c, FN_TITULO)).toBeNull(); // desfeito — o CREATE do título também voltou (é tudo 1 txn)
    });
  });

  it.skipIf(!MIG_TXN)("trava: com `modelos` ocupada por outra conexão, desiste em 55P03 (lock_timeout 500ms) e NADA fica", async () => {
    exigeBancoLocal();
    const outra = new Client({ connectionString: dbUrl()!, ssl: false });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query("SELECT 1 FROM public.modelos LIMIT 1");
      await withTx(async (c) => {
        await timeouts(c, "500ms");
        const antes = await def(c);
        const t0 = Date.now();
        let codigo: string | undefined;
        try {
          await aplica(c, MIG);
        } catch (e) {
          codigo = (e as { code?: string }).code;
        }
        expect(codigo).toBe("55P03");
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(await colunas(c)).toEqual([]);
        expect(await temKeywords(c)).toBe(0);
        expect(await def(c)).toBe(antes);
        expect(await def(c, FN_TITULO)).toBeNull();
      });
    } finally {
      await outra.query("ROLLBACK").catch(() => undefined);
      await outra.end();
    }
  });

  it.skipIf(!MIG_TXN)("inverso: com dado (modelos OU Keywords) e SEM confirmação ⇒ recusa; com 'sim' ⇒ _replicar e as 4 do SKU byte a byte, comentário antigo, sem a função e sem as colunas", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = await def(c);
      const aclAntes = await acl(c);
      const skuAntes = await Promise.all(SKU_FNS.map((s) => def(c, s.fn)));
      // F7(c, G-migration B-M4): o proacl das 4 do SKU também é reconferido depois da volta (antes só _replicar era).
      const skuAclAntes = await Promise.all(SKU_FNS.map((s) => acl(c, s.fn)));
      const comAntes = await comentarioTamanhoTipo(c);
      const contAntes = await contagens(c);
      await aplica(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, ncm) values ('ITEST-SHEET-INV', '6204')`);
      await c.query("update public.tenant_config set keywords = 'kw ITEST' where tenant_id = $1", [TENANT_TESTE]);
      await expect(aplica(c, INV)).rejects.toThrow(/DROP COLUMN apaga/);
      expect(await colunas(c)).toHaveLength(7); // o SAVEPOINT desfez só o inverso
      await c.query(`delete from modelos where nome = 'ITEST-SHEET-INV'`);
      await expect(aplica(c, INV)).rejects.toThrow(/DROP COLUMN apaga/); // só as Keywords também pedem a confirmação
      expect(await temKeywords(c)).toBe(1);
      await c.query("SET LOCAL app.confirmo_apagar_campos_sheet = 'sim'");
      await aplica(c, INV);
      expect(await colunas(c)).toEqual([]);
      expect(await temKeywords(c)).toBe(0);
      expect(await def(c)).toBe(antes);
      expect(await Promise.all(SKU_FNS.map((s) => def(c, s.fn)))).toEqual(skuAntes);
      expect(await comentarioTamanhoTipo(c)).toBe(comAntes);
      expect(await ttDefault(c)).toBe("-"); // R44: só o DEFAULT sai…
      expect(await ttNulos(c)).toBe(0); // …o backfill (NULL → letra) NÃO é desfeito
      expect(await def(c, FN_TITULO)).toBeNull();
      expect(await acl(c)).toBe(aclAntes);
      for (const [i, s] of SKU_FNS.entries()) expect(await acl(c, s.fn), s.arq).toBe(skuAclAntes[i]); // F7(c)
      expect(await contagens(c)).toBe(contAntes);
    });
  });

  it.skipIf(!MIG_TXN)("inverso sem dado (só espaços) passa SEM confirmação; sem as colunas é idempotente", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = await def(c);
      await aplica(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, titulo_pagina, ncm) values ('ITEST-SHEET-ESP', '   ', '  ')`);
      await c.query("update public.tenant_config set keywords = '   ' where tenant_id = $1", [TENANT_TESTE]);
      await aplica(c, INV);
      expect(await colunas(c)).toEqual([]);
      expect(await temKeywords(c)).toBe(0);
      expect(await def(c)).toBe(antes);
      await aplica(c, INV);
      expect(await def(c)).toBe(antes);
    });
  });
});
