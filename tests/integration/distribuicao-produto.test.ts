/**
 * Distribuição por produto — migration ADITIVA 20261006100000 (spec 2026-09-25 §5.1; plano Task 4). Colunas
 * plan_tecido_variantes.distribuicao/atende, 5 funções redefinidas (_salvar_plan_tecido_core, _plan_tecido_gravar_bom_core,
 * _plan_tecido_snapshot, tenant_module_enabled, _plan_tecido_arvore_core) e a RPC nova direcionamento_plano_modelo (+ _core).
 * Arquivos GERADOS por .superpowers/distribuicao/mig/gerar_sql.py a partir do texto VIVO (não editar à mão).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela os blocos de banco
 * PULAM; com DIST_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta. NUNCA `\i` (o COMMIT do arquivo vazaria — 15/set).
 *  • DIST_MIG_TXN=1 — a cópia SEM a migration; cada teste aplica o arquivo DENTRO da txn (mig-txn.ts; as 2 travas SET LOCAL
 *    saem antes). Segura ACCESS EXCLUSIVE em plan_tecido_variantes durante o teste (N3 — dono avisado ANTES).
 *  • sem a variável — a migration JÁ aplicada na cópia (ensaio da Task 10 / Task 11); os testes do "antes" pulam.
 * O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

// T4 fix2 · G1 (revisor 2 I-1): `.superpowers/distribuicao/mig/trocas.json` NÃO é versionado — some no checkout
// principal depois do merge e o teste estático dava ENOENT. As TROCAS ficam TRANSCRITAS aqui, à mão, como
// constante independente do gerador (molde `TROCAS_SKU` de `sku-automatico.test.ts` da reorg do Sheet) — a
// prova deixa de ser tautológica (o "esperado" não sai mais do mesmo gerador que gerou o `.sql`). Quando
// `trocas.json` existe (dev local, logo após regerar), a suíte ainda confere que bate com esta constante — mas
// a ausência dele NUNCA falha o teste (é a `trocas.json não versionado` = a causa raiz do I-1).
const TROCAS_JSON = ".superpowers/distribuicao/mig/trocas.json";
const TROCAS_DIST: Record<string, [string, string][]> = {
  salvar: [
    ["          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)\n", "          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total, distribuicao, atende)\n"],
    ["                 w.multiplicador, w.grades, w.grade_total\n", "                 w.multiplicador, w.grades, w.grade_total, w.distribuicao, w.atende\n"],
    ["                coalesce((e->>'grade_total')::int,0)       as grade_total,\n", "                coalesce((e->>'grade_total')::int,0)       as grade_total,\n                -- Distribuição por produto (20261006100000): `distribuicao` SÓ no Tecido 1 e só objeto; `atende` SÓ fora\n                -- do Tecido 1 e só array (o DEDUP leva as da linha vencedora).\n                case when coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1 and jsonb_typeof(e->'distribuicao') = 'object'\n                     then e->'distribuicao' else '{}'::jsonb end as distribuicao,\n                case when not (coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1) and jsonb_typeof(e->'atende') = 'array'\n                     then e->'atende' else null end as atende,\n"],
  ],
  gravar_bom: [
    ["declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n", "declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n  v_comp_antes jsonb; v_t1_ids uuid[];\n"],
    ["  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n", "  -- [Distribuição por produto, 20261006100000] \"atende a\" = casar variantes (R3): o casamento que o BOM já tinha\n  -- (complementa_variante_ids) é guardado ANTES do delete — payload SEM a chave o PRESERVA (antes ele sumia em\n  -- silêncio a cada aplicar). Com a chave, só entram ids de variante REAL do Tecido 1 deste mesmo payload.\n  select coalesce(jsonb_object_agg(mt.tipo || '|' || mt.numero || '|' || mtv.variante_tecido_id::text,\n                                   to_jsonb(mtv.complementa_variante_ids)), '{}'::jsonb)\n    into v_comp_antes\n  from modelo_tecido_variantes mtv\n  join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id\n  where mt.modelo_id = _modelo and mt.tipo in ('tecido','forro')\n    and mtv.variante_tecido_id is not null and mtv.complementa_variante_ids is not null;\n  select coalesce(array_agg(distinct (v2->>'variante_tecido_id')::uuid), '{}'::uuid[])\n    into v_t1_ids\n  from jsonb_array_elements(coalesce(_materiais, '[]'::jsonb)) m2\n  cross join lateral jsonb_array_elements(coalesce(m2->'variantes', '[]'::jsonb)) v2\n  where coalesce(nullif(m2->>'tipo',''), 'tecido') = 'tecido' and coalesce((m2->>'numero')::int, 1) = 1\n    and nullif(m2->>'artigo_id','') is not null and nullif(v2->>'variante_tecido_id','') is not null;\n\n  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n"],
    ["      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)\n      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),\n              coalesce((v->>'multiplicador')::numeric, 1));\n", "      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)\n      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),\n              coalesce((v->>'multiplicador')::numeric, 1),\n              case\n                when v_tipo = 'tecido' and v_num = 1 then null   -- o Tecido 1 é a âncora: nunca casa\n                when v ? 'complementa_variante_ids' then (\n                  select nullif(array_agg(distinct x.id), '{}'::uuid[])\n                  from (select (e.val)::uuid as id\n                          from jsonb_array_elements_text(\n                                 case when jsonb_typeof(v->'complementa_variante_ids') = 'array'\n                                      then v->'complementa_variante_ids' else '[]'::jsonb end) as e(val)\n                         where e.val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') x\n                  where x.id = any(v_t1_ids))\n                else (   -- chave ausente: PRESERVA o casamento anterior, SÓ com cores que seguem no Tecido 1 (PR13)\n                  select nullif(array_agg(distinct x.id), '{}'::uuid[])\n                  from (select (e.val)::uuid as id\n                          from jsonb_array_elements_text(v_comp_antes -> (v_tipo || '|' || v_num || '|' || (v->>'variante_tecido_id'))) as e(val)) x\n                  where x.id = any(v_t1_ids))\n              end);\n"],
  ],
  snapshot: [
    ["                      'grade_total', pv.grade_total\n", "                      'grade_total', pv.grade_total,\n                      'distribuicao', pv.distribuicao, 'atende', pv.atende\n"],
  ],
  modulo: [
    ["    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')\n", "    _module NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao')\n"],
    ["  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha\n", "  -- 'distribuicao' entrou em 20261006100000 (Distribuição por produto): servidor = front (chave ausente = desligado).\n  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha\n"],
  ],
  arvore: [
    ["                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)\n", "                        'grades', vv.grades, 'grade_total', vv.grade_total,\n                        'distribuicao', vv.distribuicao, 'atende', vv.atende) order by vv.ordem)\n"],
  ],
};

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261006100000_distribuicao_por_produto.sql";
const INV = "supabase/rollback/20261006100000_distribuicao_por_produto_down.sql";
// Distribuição antiga — Parte 2 (20261010100000): a tabela `distribuicao_tabelas` + 4 RPCs antigas SAEM do banco. O inverso
// da aditiva (INV) segue exigindo a tabela (LIFO); os testes do modo txn NÃO dependem mais dela existir: quando ela já
// saiu, recriam-na DENTRO da txn aplicando o inverso da Parte 2 (a ordem LIFO real: volta a Parte 2, depois a aditiva).
const INV_ANTIGA = "supabase/rollback/20261010100000_distribuicao_antiga_drop_down.sql";
// "Tamanho em" nos cards (20261014100000) redefine _salvar_plan_tecido_core/_plan_tecido_snapshot/_plan_tecido_arvore_core POR
// CIMA desta — com ela na cópia, a guarda desta migration recusa. LIFO no modo txn: volta a 20261014100000 DENTRO da txn
// (inverso dela, com a confirmação SET LOCAL) antes de reaplicar/inspecionar esta.
const INV_TAMANHO = "supabase/rollback/20261014100000_tamanho_em_cards_down.sql";
const MD5_REPASSE_TAMANHO_EM = "2712720482d94963ffda1b807fdf6931"; // fn_produto_tamanho_tipo_handover() depois da 20261014100000
// Ordem FIXA = md5-redef-*.txt = guardas do arquivo.
const REDEF = [
  { arq: "salvar", fn: "public._salvar_plan_tecido_core(uuid,jsonb,integer)", cria: "CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(" },
  { arq: "gravar_bom", fn: "public._plan_tecido_gravar_bom_core(uuid,jsonb)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_gravar_bom_core(" },
  { arq: "snapshot", fn: "public._plan_tecido_snapshot(uuid)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_snapshot(" },
  { arq: "modulo", fn: "public.tenant_module_enabled(text)", cria: "CREATE OR REPLACE FUNCTION public.tenant_module_enabled(" },
  { arq: "arvore", fn: "public._plan_tecido_arvore_core(uuid)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(" },
] as const;
const NOVAS = [
  { fn: "public._direcionamento_plano_modelo_core(uuid,uuid)", cria: "CREATE OR REPLACE FUNCTION public._direcionamento_plano_modelo_core(" },
  { fn: "public.direcionamento_plano_modelo(uuid)", cria: "CREATE OR REPLACE FUNCTION public.direcionamento_plano_modelo(" },
] as const;
// Trocas EXATAS (as MESMAS do gerar_sql.py — TROCAS). Cada âncora 1× no texto vivo.
const ANCORAS: Record<string, string[]> = {
  salvar: [
    "          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)\n",
    "                 w.multiplicador, w.grades, w.grade_total\n",
    "                coalesce((e->>'grade_total')::int,0)       as grade_total,\n",
  ],
  gravar_bom: [
    "declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n",
    "  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n",
    "      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)\n",
  ],
  snapshot: ["                      'grade_total', pv.grade_total\n"],
  modulo: ["    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')\n"],
  arvore: ["                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)\n"],
};
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.DIST_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL; achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);
/** Texto da função no arquivo: de "CREATE OR REPLACE FUNCTION …(" até o 2º "$function$" (o 1º é o "AS $function$"). */
function corpo(rel: string, inicio: string): string {
  const t = ler(rel);
  const i = t.indexOf(inicio);
  const a = i < 0 ? -1 : t.indexOf("$function$", i);
  const f = a < 0 ? -1 : t.indexOf("$function$", a + 10);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${inicio.slice(0, 60)}…)`);
  return t.slice(i, f + 10);
}
/** Guardas das REDEFINIDAS, na ordem: [{antes, depois}] (v_md5 NOT IN ('antes', 'depois')). */
const guardas = (rel: string) =>
  [...ler(rel).matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ antes: r[1], depois: r[2] }));
/** Guardas das NOVAS (só na migration): md5 do texto novo. */
const guardasNovas = (rel: string) => [...ler(rel).matchAll(/<> '([0-9a-f]{32})' THEN -- nova/g)].map((r) => r[1]);
/** T4 fix2 · G1: fonte de verdade é a constante TRANSCRITA `TROCAS_DIST` (independente do gerador — não é mais
 *  lida de `trocas.json`, que não é versionado). Se `trocas.json` existir (dev local, logo após regerar), confere
 *  que bate com a constante — mas a AUSÊNCIA do arquivo nunca falha o teste (é exatamente o bug do I-1). */
function trocas(): Record<string, [string, string][]> {
  if (existsSync(ROOT + TROCAS_JSON)) {
    const doJson = JSON.parse(ler(TROCAS_JSON));
    expect(doJson, "trocas.json (quando presente) tem de bater com TROCAS_DIST transcrita no teste").toEqual(TROCAS_DIST);
  }
  return TROCAS_DIST;
}

describe("Distribuição A — arquivos (estático, sem banco)", () => {
  it("5 redefinidas: migration = inverso (texto vivo) COM SÓ AS TROCAS EXATAS (reconstrução, T4 fix1 F1(a)); âncoras 1×; guarda md5 EXATA nos 2 arquivos", () => {
    const gM = guardas(MIG), gI = guardas(INV);
    expect(gM).toHaveLength(5);
    expect(gI).toEqual(gM);
    const T = trocas();
    REDEF.forEach((f, i) => {
      const antes = corpo(INV, f.cria), depois = corpo(MIG, f.cria);
      for (const a of ANCORAS[f.arq]) expect(antes.split(a).length - 1, `${f.arq}: ${a.slice(0, 50)}`).toBe(1);
      expect(depois, f.arq).not.toBe(antes);
      expect(gM[i], f.arq).toEqual({ antes: md5(antes + "\n"), depois: md5(depois + "\n") });
      // F1(a): reaplica as TROCAS reais (exportadas do gerador) sobre o "antes" e exige IGUALDADE EXATA com o
      // "depois" — prova "SÓ as trocas", não só md5+toContain (que passaria numa edição acidental fora delas).
      const trocasArq = T[f.arq];
      expect(trocasArq, f.arq).toBeDefined();
      let reconstruido = antes;
      for (const [velho, novo] of trocasArq) {
        expect(reconstruido.split(velho).length - 1, `${f.arq}: âncora da troca ausente/duplicada: ${velho.slice(0, 50)}`).toBe(1);
        reconstruido = reconstruido.split(velho).join(novo);
      }
      expect(reconstruido, `${f.arq}: reconstrução (antes + TROCAS) ≠ depois`).toBe(depois);
    });
    expect(corpo(MIG, REDEF[0].cria)).toContain("w.grade_total, w.distribuicao, w.atende");
    expect(corpo(MIG, REDEF[1].cria)).toContain("complementa_variante_ids");
    expect(corpo(MIG, REDEF[2].cria)).toContain("'distribuicao', pv.distribuicao, 'atende', pv.atende");
    expect(corpo(MIG, REDEF[3].cria)).toContain("'produto_importado', 'distribuicao')");
    expect(corpo(MIG, REDEF[4].cria)).toContain("'distribuicao', vv.distribuicao, 'atende', vv.atende");
  });
  it("2 novas: guarda = md5 do texto do arquivo; o inverso as DERRUBA", () => {
    const g = guardasNovas(MIG);
    expect(g).toEqual(NOVAS.map((n) => md5(corpo(MIG, n.cria) + "\n")));
    const v = ler(INV);
    expect(v).toContain("DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);");
    expect(v).toContain("DROP FUNCTION IF EXISTS public._direcionamento_plano_modelo_core(uuid, uuid);");
  });
  it("travas: encoding ANTES do BEGIN; 1 BEGIN/1 COMMIT e as 2 SET LOCAL logo depois; $pos$ → NOTIFY → COMMIT (PR10); NENHUMA DDL de policy; nada em tenant_config; nada da reorg", () => {
    for (const f of [MIG, INV]) {
      const t = ler(f);
      const linhas = t.split("\n");
      const i = linhas.findIndex((l) => l === "BEGIN;");
      expect(t.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith("SET client_encoding = 'UTF8';\nBEGIN;\n"), f).toBe(true);
      expect(linhas.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      const iPos = t.indexOf("DO $pos$"), iNot = t.indexOf("NOTIFY pgrst, 'reload schema';"), iCom = t.indexOf("\nCOMMIT;\n");
      expect(iPos, f).toBeGreaterThan(0);
      expect(iNot, f).toBeGreaterThan(t.indexOf("END $pos$;", iPos));
      expect(iCom, f).toBeGreaterThan(iNot);
      expect(t, f).toMatch(/Aplicar SÓ via \.superpowers\/distribuicao\/mig\//);
      expect(linhas.filter((l) => l === "BEGIN;"), f).toHaveLength(1);
      expect(linhas.filter((l) => l === "COMMIT;"), f).toHaveLength(1);
      expect(t, f).not.toMatch(/^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im);
      expect(t, f).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|COMMENT ON COLUMN) public\.tenant_config/);
      expect(t, f).not.toContain("_replicar_cards_plan_tecido_core");
      expect(t, f).not.toMatch(/(REVOKE|GRANT)[^;]*tenant_module_enabled/); // ACL INTOCADA (R5)
    }
  });
  it("ordem da migration: guarda → 4 redefinidas → core → wrapper → ACL → ALTER → CHECKs → COMMENT → árvore (sql) → $pos$ → NOTIFY → COMMIT", () => {
    const m = ler(MIG);
    const pos = (s: string) => m.indexOf(s);
    const ord = [
      "DO $guarda$", REDEF[0].cria, REDEF[1].cria, REDEF[2].cria, REDEF[3].cria, NOVAS[0].cria, NOVAS[1].cria,
      "REVOKE EXECUTE ON FUNCTION public._direcionamento_plano_modelo_core(uuid, uuid) FROM PUBLIC, anon, authenticated;",
      "ALTER TABLE public.plan_tecido_variantes\n  ADD COLUMN IF NOT EXISTS distribuicao jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "DO $ck$", "COMMENT ON COLUMN public.plan_tecido_variantes.distribuicao", REDEF[4].cria, "DO $pos$",
      "NOTIFY pgrst, 'reload schema';", "\nCOMMIT;\n",
    ].map(pos);
    ord.forEach((p, i) => expect(p, `item ${i}`).toBeGreaterThan(i === 0 ? m.indexOf("SET LOCAL transaction_timeout") : ord[i - 1]));
    expect(m).toContain("GRANT EXECUTE ON FUNCTION public.direcionamento_plano_modelo(uuid) TO authenticated;");
    expect(m).toContain("REVOKE ALL ON FUNCTION public.direcionamento_plano_modelo(uuid) FROM PUBLIC, anon;");
    for (const s of ["public._salvar_plan_tecido_core(uuid, jsonb, integer)", "public._plan_tecido_gravar_bom_core(uuid, jsonb)", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_arvore_core(uuid)"])
      expect(m).toContain(`REVOKE EXECUTE ON FUNCTION ${s} FROM PUBLIC, anon, authenticated;`);
    expect(m).not.toMatch(/DROP\s+(COLUMN|TABLE|FUNCTION)/i);
  });
  it("inverso: trava explícita → confirmação + LIFO (exige a tabela antiga) → árvore ANTES → demais → DROP das novas → DROP COLUMN POR ÚLTIMO → $pos$", () => {
    const v = ler(INV);
    const iLock = v.indexOf("LOCK TABLE public.plan_tecido_variantes IN ACCESS EXCLUSIVE MODE;"); // PR10: antes da guarda
    expect(iLock).toBeGreaterThan(v.indexOf("SET LOCAL transaction_timeout"));
    expect(iLock).toBeLessThan(v.indexOf("DO $guarda$"));
    expect(v).toContain("app.confirmo_apagar_distribuicao_por_produto");
    expect(v).toContain("to_regclass('public.distribuicao_tabelas') IS NULL");
    const iArv = v.indexOf(REDEF[4].cria), iSalvar = v.indexOf(REDEF[0].cria), iDrop = v.indexOf("DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);");
    const iAlter = v.indexOf("ALTER TABLE public.plan_tecido_variantes");
    expect(iArv).toBeGreaterThan(v.indexOf("DO $guarda$"));
    expect(iSalvar).toBeGreaterThan(iArv);
    expect(iDrop).toBeGreaterThan(iSalvar);
    expect(iAlter).toBeGreaterThan(iDrop);
    expect(v.slice(iAlter, v.indexOf("DO $pos$")).replace(/--[^\n]*/g, "").trim()).toBe(
      "ALTER TABLE public.plan_tecido_variantes\n  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_atende_array,\n  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_distribuicao_objeto,\n  DROP COLUMN IF EXISTS atende,\n  DROP COLUMN IF EXISTS distribuicao;");
  });
  it("T4 fix1 · F3: o $pos$ da IDA confere colunas/CHECKs POR TIPO (format_type/attnotnull/default/pg_get_constraintdef), não só pelo nome", () => {
    const m = ler(MIG);
    const bloco = m.slice(m.indexOf("DO $pos$"), m.indexOf("END $pos$;"));
    expect(bloco).toContain("format_type(a.atttypid, a.atttypmod) = 'jsonb'");
    expect(bloco).toContain("a.attname = 'distribuicao'");
    expect(bloco).toContain("a.attnotnull");
    expect(bloco).toContain("pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb'");
    expect(bloco).toContain("a.attname = 'atende'");
    expect(bloco).toContain("NOT a.attnotnull");
    expect(bloco).toContain("pg_get_constraintdef(oid) LIKE '%jsonb_typeof(distribuicao) = ''object''%'");
    expect(bloco).toContain("pg_get_constraintdef(oid) LIKE '%jsonb_typeof(atende) = ''array''%'");
    // não regrediu para a checagem só por nome (count(*)... IN (...))
    expect(bloco).not.toMatch(/column_name IN \('distribuicao', 'atende'\)\) <> 2/);
  });
  it("T4 fix1 · F2: a grade saneada da RPC nova limita o valor a 9 dígitos (cabe em int4) antes do ::int", () => {
    const m = ler(MIG);
    expect(m).toContain("WHERE g.value ~ '^[0-9]{1,9}([.][0-9]+)?$'");
    expect(m).not.toContain("WHERE g.value ~ '^[0-9]+([.][0-9]+)?$'");
  });
});

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query("select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null as ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

/** LIFO: se a Parte 2 (20261010100000) já tirou a tabela antiga, volta-a DENTRO da txn com o inverso dela (sem as travas
 *  SET LOCAL do arquivo — a txn do teste tem as suas). Sem efeito quando a tabela ainda existe. */
async function voltaParte2SePreciso(c: Client): Promise<void> {
  if ((await um<{ ok: boolean }>(c, "select to_regclass('public.distribuicao_tabelas') is not null ok")).ok) return;
  const sql = ler(INV_ANTIGA).replace(/^SET LOCAL (lock_timeout|statement_timeout|transaction_timeout) = '[^']*';$/gm, "-- [teste] trava do arquivo removida");
  await aplicarSql(c, sql, INV_ANTIGA);
}

/** LIFO (Tamanho em, 20261014100000): se a cópia a tem, volta-a DENTRO da txn pelo inverso dela (confirmação SET LOCAL;
 *  as 2 travas SET LOCAL do arquivo saem — a txn do teste tem as suas). Sem efeito quando ela não está aplicada. */
async function voltaTamanhoEmSePreciso(c: Client): Promise<void> {
  const m = (await um<{ m: string | null }>(c,
    "select md5(pg_get_functiondef(to_regprocedure('public.fn_produto_tamanho_tipo_handover()'))) m")).m;
  if (m !== MD5_REPASSE_TAMANHO_EM) return;
  await c.query("SET LOCAL app.tamanho_em_drop_ok = 'sim'");
  await aplica(c, INV_TAMANHO);
  await c.query("SET LOCAL app.tamanho_em_drop_ok = ''");
}

async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN) {
    await voltaTamanhoEmSePreciso(c);
    await aplica(c, MIG);
  }
}
/** T4 fix2 · G5 (revisor 2 M-d): `def` de TODAS as REDEF, SEQUENCIAL no MESMO pg.Client (nunca Promise.all — o
 *  driver `pg` não suporta queries concorrentes no mesmo Client; gera DeprecationWarning e é frágil). */
async function defsRedef(c: Client): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const f of REDEF) out.push(await def(c, f.fn));
  return out;
}
const def = async (c: Client, fn: string) => (await um<{ d: string | null }>(c, "select pg_get_functiondef(to_regprocedure($1)) d", [fn])).d;
const privs = (c: Client, fn: string) =>
  um<{ pub: boolean; anon: boolean; auth: boolean; srv: boolean }>(c,
    `select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') srv
       from pg_proc p where p.oid = to_regprocedure($1)`, [fn]);
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT dist_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT dist_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT dist_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}
/** Liga criação/PCP/distribuição da Loja Teste e REBAIXA o super_admin do usuário de teste (txn revertida) — sem isso
 *  `tenant_module_enabled` devolve sempre true (is_super_admin). */
async function lojaComModulos(c: Client, distribuicao: boolean): Promise<void> {
  await comoUsuario(c);
  await c.query("delete from public.user_roles where user_id = $1 and role = 'super_admin'", [USER_TESTE]);
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, $2::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || $2::jsonb`,
    [TENANT_TESTE, JSON.stringify({ criacao: true, producao: true, otb: true, distribuicao })],
  );
}
type Cena = { col: string; artigo: string; vtMarrom: string; vtPreto: string; corMarrom: string; corPreto: string; corVinho: string; lojas: string[] };
async function cena(c: Client): Promise<Cena> {
  const T = TENANT_TESTE;
  const col = await um<{ id: string }>(c, "insert into colecoes (nome, status) values ('ITEST-DIST', 'rascunho') returning id");
  const artigo = await um<{ id: string }>(c, "insert into artigos (tenant_id, nome) values ($1, 'ITEST-DIST Crepe') returning id", [T]);
  const cor = async (n: string) => (await um<{ id: string }>(c, "insert into cores (tenant_id, nome) values ($1, $2) returning id", [T, n])).id;
  const corMarrom = await cor("ITEST-DIST Marrom"), corPreto = await cor("ITEST-DIST Preto"), corVinho = await cor("ITEST-DIST Vinho");
  const vt = async (corId: string) => (await um<{ id: string }>(c,
    "insert into variantes_tecido (tenant_id, artigo_id, cor_id) values ($1, $2, $3) returning id", [T, artigo.id, corId])).id;
  const lojas = (await c.query("select id from lojas_direcionamento where tenant_id = $1 and ativo order by is_default desc, ordem nulls last limit 2", [T])).rows.map((r) => r.id as string);
  if (lojas.length < 2) throw new Error("a Loja Teste precisa de 2 lojas ativas em lojas_direcionamento (cópia)");
  return { col: col.id, artigo: artigo.id, vtMarrom: await vt(corMarrom), vtPreto: await vt(corPreto), corMarrom, corPreto, corVinho, lojas };
}
const dist = (loja: string, base: number, grades: Record<string, number>, manuais: string[] = []) => ({ [loja]: { base, grades, manuais } });
const arvore = (slots: unknown[]) => ({ subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }] });
const ler1 = async (c: Client, col: string) => (await um<{ a: any }>(c, "select public.plan_tecido_arvore($1) a", [col])).a.subcolecoes[0].linhas[0].slots[0];

describe.skipIf(!PRONTO)("Distribuição A — banco (cópia local, txn revertida)", () => {
  it("colunas: distribuicao jsonb NOT NULL DEFAULT '{}', atende jsonb NULL; CHECKs recusam forma errada (23514)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query(
        `select a.attname nome, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = 'public.plan_tecido_variantes'::regclass and a.attname in ('distribuicao','atende') and not a.attisdropped order by 1`);
      expect(rows).toEqual([
        { nome: "atende", tipo: "jsonb", nn: false, def: null },
        { nome: "distribuicao", tipo: "jsonb", nn: true, def: "'{}'::jsonb" },
      ]);
      // T4 fix1 · F1(b): o CHECK não pode depender de já existir linha na cópia (revisor 2 M3 — "if (pv)" pulava em
      // silêncio) — cria a PRÓPRIA linha via a cena/fixture padrão da suíte, sem depender de dado pré-existente.
      await lojaComModulos(c, true);
      const k = await cena(c);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 1 },
        ] },
      ] }]))]);
      const pv = await um<{ id: string }>(c, "select pv.id from plan_tecido_variantes pv join plan_tecido_materiais pm on pm.id = pv.material_id where pv.variante_tecido_id = $1 order by pv.id desc limit 1", [k.vtMarrom]);
      expect(pv, "a linha recém-gravada por salvar_plan_tecido tem de existir").toBeDefined();
      expect((await falha(c, "update plan_tecido_variantes set distribuicao = '[]'::jsonb where id = $1", [pv.id])).code).toBe("23514");
      expect((await falha(c, "update plan_tecido_variantes set atende = '{}'::jsonb where id = $1", [pv.id])).code).toBe("23514");
    });
  });

  it("5 redefinidas e 2 novas: texto = o do arquivo (md5 'depois'); ACL (#9) — internas fechadas, wrapper só authenticated, tenant_module_enabled INTOCADA", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const g = guardas(MIG);
      // "Tamanho em" nos cards (20261014100000, LIFO por cima desta): na cópia com ela, _salvar/_snapshot/_arvore estão no
      // texto DELA (a suíte tamanho-em-cards prova "depois = este texto + só as trocas dela") — aceita esse md5 exato.
      const TAMANHO_EM: Record<string, string> = { salvar: "81a3606444a2cf68ee376937009b9bad", snapshot: "2c2ba1e79ab311b2c5ba8080cac958e9", arvore: "5111f417c2679a4bb2157ad0df61f55a" };
      for (const [i, f] of REDEF.entries()) {
        const d = (await def(c, f.fn))!;
        if (TAMANHO_EM[f.arq] && md5(d) === TAMANHO_EM[f.arq]) continue;
        expect(d, f.arq).toBe(corpo(MIG, f.cria) + "\n");
        expect(md5(d), f.arq).toBe(g[i].depois);
      }
      for (const n of NOVAS) expect((await def(c, n.fn))!).toBe(corpo(MIG, n.cria) + "\n");
      for (const fn of ["public._salvar_plan_tecido_core(uuid,jsonb,integer)", "public._plan_tecido_gravar_bom_core(uuid,jsonb)", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_arvore_core(uuid)", "public._direcionamento_plano_modelo_core(uuid,uuid)"])
        expect(await privs(c, fn), fn).toEqual({ pub: false, anon: false, auth: false, srv: true });
      expect(await privs(c, "public.direcionamento_plano_modelo(uuid)")).toEqual({ pub: false, anon: false, auth: true, srv: true });
      expect(await privs(c, "public.tenant_module_enabled(text)")).toEqual({ pub: true, anon: true, auth: true, srv: true });
    });
  });

  it("tenant_module_enabled: 'distribuicao' ausente/false = desligado, 'true' = ligado; 'producao' ausente segue ligado; 'otb' ausente segue desligado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, false);
      const ve = async (m: string) => (await um<{ v: boolean }>(c, "select public.tenant_module_enabled($1) v", [m])).v;
      expect(await ve("distribuicao")).toBe(false);
      await c.query("update tenant_config set modules = modules - 'distribuicao' - 'producao' - 'otb' where tenant_id = $1", [TENANT_TESTE]);
      expect([await ve("distribuicao"), await ve("producao"), await ve("otb")]).toEqual([false, true, false]);
      await c.query("update tenant_config set modules = modules || '{\"distribuicao\":true}'::jsonb where tenant_id = $1", [TENANT_TESTE]);
      expect(await ve("distribuicao")).toBe(true);
    });
  });

  it("salvar + árvore: distribuição SÓ no T1 (objeto), 'atende' SÓ fora do T1 (array); forma errada vira default; DEDUP leva a da linha vencedora", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const dA = dist(k.lojas[0], 2, { "38|P": 2 }), dB = dist(k.lojas[1], 5, { "40|M": 5 });
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 2, distribuicao: dA, atende: [k.vtPreto] },
          { variante_tecido_id: k.vtMarrom, ordem: 2, multiplicador: 1, grades: {}, grade_total: 9, distribuicao: dB, atende: [k.vtPreto] },
          { variante_tecido_id: k.vtPreto, ordem: 3, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: "lixo" },
        ] },
        { artigo_id: k.artigo, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 9, distribuicao: dA, atende: [k.vtMarrom, `plan:${k.corVinho}|`] },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: {}, grade_total: 1, atende: { errado: true } },
        ] },
      ] }]))]);
      const s = await ler1(c, k.col);
      const t1 = s.materiais.find((m: any) => m.tipo === "tecido").variantes;
      expect(t1.map((v: any) => [v.variante_tecido_id, v.grade_total, v.distribuicao, v.atende])).toEqual([
        [k.vtMarrom, 9, dB, null],       // DEDUP: a de MAIOR grade_total vence e leva a SUA distribuição; T1 nunca tem 'atende'
        [k.vtPreto, 1, {}, null],        // forma errada → '{}'
      ]);
      const fr = s.materiais.find((m: any) => m.tipo === "forro").variantes;
      expect(fr.map((v: any) => [v.distribuicao, v.atende])).toEqual([
        [{}, [k.vtMarrom, `plan:${k.corVinho}|`]], // fora do T1: distribuição some, 'atende' fica (inclusive chave de cor planejada)
        [{}, null],                                 // 'atende' que não é array → NULL
      ]);
    });
  });

  it("blindagem: o snapshot do Salvar guarda distribuicao e atende", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const d = dist(k.lojas[0], 3, { "38|P": 3 });
      const arv = arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, distribuicao: d }] },
        { artigo_id: k.artigo, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [{ variante_tecido_id: k.vtPreto, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, atende: [k.vtMarrom] }] },
      ] }]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arv)]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arv)]); // 2º save snapshota o 1º
      const p = (await um<{ p: any }>(c, "select payload p from plan_tecido_snapshots where colecao_id = $1 order by created_at desc, id desc limit 1", [k.col])).p;
      const mats = p.arvore.subcolecoes[0].linhas[0].slots[0].materiais;
      expect(mats[0].variantes[0].distribuicao).toEqual(d);
      expect(mats[1].variantes[0].atende).toEqual([k.vtMarrom]);
    });
  });

  it("gravar BOM: casamento do payload (só ids REAIS do T1 do payload); T1 nunca casa; chave ausente PRESERVA só as cores que seguem no T1 (PR13); [] limpa (R3)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const m = await um<{ id: string }>(c, "insert into modelos (tenant_id, nome, origem) values ($1, 'ITEST-DIST BOM', 'interno') returning id", [TENANT_TESTE]);
      // T4 fix1 · F1(b) (revisor 2 M3): não pula em silêncio — a cópia SEMPRE tem alguma variante de OUTRO tenant
      // (é multi-tenant por natureza); se não tiver, o teste tem de FALHAR, não passar vazio.
      const outro = await um<{ id: string } | undefined>(c, "select id from variantes_tecido where tenant_id <> $1 limit 1", [TENANT_TESTE]);
      expect(outro, "a cópia precisa de ao menos 1 variante de OUTRO tenant (multi-tenant) para provar o filtro").toBeDefined();
      const payload = (forro: Record<string, unknown>) => JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: { "38|P": 5 }, grade_total: 5, complementa_variante_ids: [k.vtPreto] },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: { "38|P": 7 }, grade_total: 7 },
        ] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, ...forro }] },
      ]);
      const comp = async () => (await c.query(
        `select mt.tipo, mtv.variante_tecido_id v, mtv.complementa_variante_ids c from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id where mt.modelo_id = $1 order by mt.tipo desc, mtv.ordem`, [m.id])).rows
        .map((r) => [r.tipo, r.c ? [...r.c].sort() : null]);
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id,
        payload({ complementa_variante_ids: [k.vtPreto, k.vtMarrom, "lixo", ...(outro ? [outro.id] : [])] })]);
      expect(await comp()).toEqual([["tecido", null], ["tecido", null], ["forro", [k.vtMarrom, k.vtPreto].sort()]]);
      expect((await um<{ s: string }>(c, "select public._grade_soma_pares($1, $2::uuid[])::text s", [m.id, [k.vtMarrom, k.vtPreto]])).s).toBe("12");
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payload({})]); // SEM a chave
      expect((await comp())[2]).toEqual(["forro", [k.vtMarrom, k.vtPreto].sort()]);
      // PR13 (G-plano R4): SEM a chave e o Preto SAIU do Tecido 1 ⇒ o Preto sai do casamento; a reserva do forro segue pelo
      // que ficou (não zera em silêncio — #4).
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: { "38|P": 5 }, grade_total: 5 }] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1 }] },
      ])]);
      expect((await comp())[1]).toEqual(["forro", [k.vtMarrom]]);
      expect((await um<{ s: string }>(c,
        `select public._grade_soma_pares($1, mtv.complementa_variante_ids)::text s from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id where mt.modelo_id = $1 and mt.tipo = 'forro'`, [m.id])).s).toBe("5");
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payload({ complementa_variante_ids: [] })]);
      expect((await comp())[2]).toEqual(["forro", null]);
    });
  });

  it("direcionamento_plano_modelo: plano do modelo (variante_numero pelo BOM), sem correspondência, direcionados; IDOR; motivos", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const [L1, L2] = k.lojas;
      const mo = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Vestido', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      const irmao = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Irmão', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      await c.query("insert into cad (modelo_id, direcionamento_status) values ($1, 'separado')", [irmao.id]);
      const mt = await um<{ id: string }>(c, "insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id", [mo.id, k.artigo]);
      await c.query("insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1, $2, 1), ($1, $3, 2)", [mt.id, k.vtPreto, k.vtMarrom]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: mo.id, slot_index: 0, materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 7, distribuicao: { ...dist(L1, 5, { "38|P": 4, "40|M": 10 }, ["38|P"]), ...dist(L2, 1, { "38|P": 1.6 }) } },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: {}, grade_total: 3,
            distribuicao: { ...dist(L1, 3, { "38|P": 3 }), lixo: { base: 1, grades: { "38|P": 1 }, manuais: [] } } }, // N3: chave que não é uuid é ignorada
          { variante_tecido_id: null, cor_id: k.corVinho, ordem: 3, multiplicador: 1, grades: {}, grade_total: 2, distribuicao: dist(L2, 2, { "40|M": 2 }) },
          { variante_tecido_id: null, cor_id: k.corPreto, cor_apelido_id: null, ordem: 4, multiplicador: 1, grades: {}, grade_total: 0 },
        ] },
      ] }]))]);
      const r = (await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r;
      expect([r.subcolecao, r.direcionados, r.motivo_sem_plano]).toEqual(["Drop 1", 1, null]);
      expect(r.plano.variantes.map((v: any) => [v.variante_numero, v.cor_nome])).toEqual([[1, "ITEST-DIST Preto"], [2, "ITEST-DIST Marrom"], [null, "ITEST-DIST Vinho"]]);
      expect(r.plano.celulas).toEqual([
        { loja_id: L1, variante_numero: 1, grades: { "38|P": 3 } },
        { loja_id: L1, variante_numero: 2, grades: { "38|P": 4, "40|M": 10 } },
        { loja_id: L2, variante_numero: 2, grades: { "38|P": 2 } },            // 1.6 arredonda
      ]);
      expect(r.plano.sem_correspondencia).toEqual([{ cor_nome: "ITEST-DIST Vinho", apelido_nome: null, total: 2 }]);
      expect(r.plano.lojas.map((l: any) => l.loja_id)).toEqual([L1, L2]);
      expect(r.plano.tamanho_tipo).toBe("letra");
      // IDOR: modelo de outra loja. T4 fix1 · F1(b)/F1(c) (revisor 1 e 2): não pula em silêncio — a cópia
      // multi-tenant SEMPRE tem algum modelo de outro tenant; se faltar, o teste tem de FALHAR, não passar vazio.
      const alheio = await um<{ id: string } | undefined>(c, "select id from modelos where tenant_id <> $1 limit 1", [TENANT_TESTE]);
      expect(alheio, "a cópia precisa de ao menos 1 modelo de OUTRO tenant (multi-tenant) para provar o IDOR").toBeDefined();
      expect((await falha(c, "select public.direcionamento_plano_modelo($1)", [alheio!.id])).code).toBe("P0001");
      // motivos
      await c.query("update modelos set origem = 'revenda' where id = $1", [mo.id]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r.motivo_sem_plano).toBe("comprado");
      await c.query("update modelos set origem = 'interno' where id = $1", [mo.id]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [irmao.id])).r).toMatchObject({ plano: null, motivo_sem_plano: "sem_plano_tecido", direcionados: 1 });
      await c.query("update tenant_config set modules = modules || '{\"distribuicao\":false}'::jsonb where tenant_id = $1", [TENANT_TESTE]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r).toMatchObject({ plano: null, motivo_sem_plano: "modulo_desligado", direcionados: 1 });
    });
  });

  it("T4 fix1 · F2: célula da distribuição com valor ≥ 2³¹ gravado direto no jsonb NÃO derruba direcionamento_plano_modelo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const [L1] = k.lojas;
      const mo = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Estouro', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      const mt = await um<{ id: string }>(c, "insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id", [mo.id, k.artigo]);
      await c.query("insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1, $2, 1)", [mt.id, k.vtMarrom]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: mo.id, slot_index: 0, materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, distribuicao: dist(L1, 3, { "38|P": 3 }) },
        ] },
      ] }]))]);
      // grava direto no jsonb um valor MAIOR que int4 (2^31 = 2147483648), simulando o self-DoS via REST (M6):
      // a UI nunca produz isso (o grade_total estoura antes), mas a RPC não pode cair por causa disso.
      await c.query(
        `update plan_tecido_variantes pv set distribuicao = jsonb_set(pv.distribuicao, ARRAY[$2, 'grades', '38|P'], '9999999999999'::jsonb)
           from plan_tecido_materiais pm where pm.id = pv.material_id and pm.tipo = 'tecido' and pm.numero = 1 and pv.variante_tecido_id = $1`,
        [k.vtMarrom, L1]);
      const r = (await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r;
      expect(r.motivo_sem_plano).toBeNull();
      // a célula estourada é IGNORADA (regex de 9 dígitos não casa) — grade some da célula, não derruba a RPC.
      // T4 fix2 · G4 (revisor 2 M-c): a célula tem de EXISTIR (a loja/variante seguem no plano, só a grade some);
      // `?? {}` passaria também se a célula nem existisse — exige a existência antes de comparar o conteúdo.
      const celula = r.plano.celulas.find((x: any) => x.loja_id === L1 && x.variante_numero === 1);
      expect(celula, "a célula (loja L1 × variante 1) tem de existir no plano, só sem a grade estourada").toBeDefined();
      expect(celula.grades).toEqual({});
    });
  });

  it("guarda 'outra frente': se uma redefinida já mudou (md5 fora de antes/depois), a migration RECUSA (P0001)", async () => {
    if (!MIG_TXN) return; // só no modo txn (a cópia sem a migration)
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await voltaTamanhoEmSePreciso(c); // LIFO (20261014100000)
      const t = (await def(c, "public._plan_tecido_snapshot(uuid)"))!;
      await c.query(t.replace("retenção: 20 últimos", "retenção: 21 últimos")); // outra frente mexeu
      await c.query("SAVEPOINT g");
      let erro = "";
      try { await aplica(c, MIG); } catch (e) { erro = String((e as Error).message); }
      await c.query("ROLLBACK TO SAVEPOINT g");
      expect(erro).toMatch(/_plan_tecido_snapshot mudou/);
    });
  });

  it("T4 fix2 · G6 — guarda: função NOVA (_direcionamento_plano_modelo_core) já existe com OUTRO texto ⇒ RECUSA (P0001), sem aplicar nada", async () => {
    if (!MIG_TXN) return; // só no modo txn (a cópia sem a migration)
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await voltaTamanhoEmSePreciso(c); // LIFO (20261014100000)
      // cria a função NOVA com um texto DIFERENTE do que o gerador produziria — simula outra frente/rodada tendo
      // criado essa RPC antes (o ramo do desvio to_regprocedure — guarda_novas() — que ainda não tinha teste).
      await c.query(`
        CREATE OR REPLACE FUNCTION public._direcionamento_plano_modelo_core(_modelo_id uuid, _tenant uuid)
         RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
        AS $function$ SELECT '{"outra_frente": true}'::jsonb $function$;
      `);
      await c.query("SAVEPOINT g6");
      let erro = "";
      try { await aplica(c, MIG); } catch (e) { erro = String((e as Error).message); }
      await c.query("ROLLBACK TO SAVEPOINT g6");
      expect(erro).toMatch(/_direcionamento_plano_modelo_core já existe com OUTRO texto/);
      // nada foi aplicado: as 5 redefinidas continuam no texto "antes" (a migration nunca chegou a rodar)
      const g = guardas(MIG);
      for (const [i, f] of REDEF.entries()) expect(md5((await def(c, f.fn))!), f.arq).toBe(g[i].antes);
      await c.query("DROP FUNCTION public._direcionamento_plano_modelo_core(uuid, uuid)"); // limpa a função forjada
    });
  });

  it("T4 fix2 · G6 — loja uuid de OUTRO tenant como chave da distribuição: ignorada na RPC (nem plano, nem sem_correspondencia)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const [L1] = k.lojas;
      // loja ATIVA de OUTRO tenant (não TENANT_TESTE) — precisa existir na cópia multi-tenant.
      const lojaAlheia = await um<{ id: string } | undefined>(c,
        "select id from lojas_direcionamento where tenant_id <> $1 and ativo limit 1", [TENANT_TESTE]);
      expect(lojaAlheia, "a cópia precisa de ao menos 1 loja ATIVA de OUTRO tenant (multi-tenant)").toBeDefined();
      const mo = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST LojaAlheia', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      const mt = await um<{ id: string }>(c, "insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id", [mo.id, k.artigo]);
      await c.query("insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1, $2, 1)", [mt.id, k.vtMarrom]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: mo.id, slot_index: 0, materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 5,
            distribuicao: { ...dist(L1, 3, { "38|P": 3 }), ...dist(lojaAlheia!.id, 2, { "38|P": 2 }) } },
        ] },
      ] }]))]);
      const r = (await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r;
      expect(r.motivo_sem_plano).toBeNull();
      // a loja alheia é UUID válido (não cai no filtro regex), mas é excluída pelo JOIN `ld.tenant_id = _tenant` —
      // não aparece em `lojas`, não vira célula, e sua grade não vaza para `sem_correspondencia` (ela tem
      // variante_numero, então não é um caso de "cor sem correspondência" — simplesmente some).
      expect(r.plano.lojas.map((l: any) => l.loja_id)).toEqual([L1]);
      expect(r.plano.celulas).toEqual([{ loja_id: L1, variante_numero: 1, grades: { "38|P": 3 } }]);
      expect(r.plano.sem_correspondencia).toEqual([]);
    });
  });

  it("PR10 — pós-condição: md5 'depois' adulterado (simula corrupção pós-CREATE) ⇒ a ida RECUSA e desfaz TUDO", async () => {
    if (!MIG_TXN) return; // só no modo txn (a cópia sem a migration)
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await voltaTamanhoEmSePreciso(c); // LIFO (20261014100000)
      const antes = await defsRedef(c);
      const mig = ler(MIG);
      const real = guardas(MIG)[2].depois; // _plan_tecido_snapshot — a função é CRIADA com o texto real; só o $pos$ exige outro
      const falso = real.slice(0, -1) + (real.at(-1) === "0" ? "1" : "0");
      const alvo = `IF v_md5 IS DISTINCT FROM '${real}' THEN\n    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou`;
      expect(mig.split(alvo).length - 1).toBe(1);
      const forjada = mig.replace(alvo, alvo.replace(real, falso));
      let erro = "";
      try { await aplicarSql(c, semTravas(forjada, "migration forjada"), "migration forjada"); } catch (e) { erro = String((e as Error).message); }
      expect(erro).toMatch(/pós-condição falhou/);
      expect(await defsRedef(c)).toEqual(antes);
      expect((await um<{ n: number }>(c, "select count(*)::int n from information_schema.columns where table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')")).n).toBe(0);
      expect((await um<{ ok: boolean }>(c, "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null ok")).ok).toBe(true);
    });
  });

  it("idempotência: aplicar 2× não falha; inverso (com confirmação) devolve as 5 ao texto de antes e tira colunas e RPCs; sem confirmação RECUSA", async () => {
    if (!MIG_TXN) return;
    await withTx(async (c) => {
      await prepara(c);
      await aplica(c, MIG); // 2ª vez
      await voltaParte2SePreciso(c); // LIFO: o inverso da aditiva exige a tabela antiga
      const semConf = await (async () => { await c.query("SAVEPOINT s"); try { await aplica(c, INV); return ""; } catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return String((e as Error).message); } })();
      expect(semConf).toMatch(/confirmo_apagar_distribuicao_por_produto/);
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'");
      await aplica(c, INV);
      const g = guardas(INV);
      for (const [i, f] of REDEF.entries()) expect(md5((await def(c, f.fn))!), f.arq).toBe(g[i].antes);
      expect((await um<{ n: number }>(c, "select count(*)::int n from information_schema.columns where table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')")).n).toBe(0);
      expect((await um<{ n: boolean }>(c, "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null n")).n).toBe(true);
      await aplica(c, INV); // inverso 2× também não falha
    });
  });

  it("T4 fix1 · F1(d) — LIFO: sem a tabela antiga (distribuicao_tabelas), o inverso RECUSA (P0001) e não desfaz nada", async () => {
    if (!MIG_TXN) return;
    await withTx(async (c) => {
      await prepara(c);
      // tabela antiga FORA (estado depois da Parte 2, 20261010100000) — LIFO exige que ela exista. Se ela ainda existe
      // neste banco, simula a remoção renomeando-a (e desfaz no fim); se já saiu, o banco já está no estado a testar.
      const existia = (await um<{ ok: boolean }>(c, "select to_regclass('public.distribuicao_tabelas') is not null ok")).ok;
      if (existia) await c.query("ALTER TABLE public.distribuicao_tabelas RENAME TO _distribuicao_tabelas_fora_lifo");
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'");
      let erro = "";
      try { await aplica(c, INV); } catch (e) { erro = String((e as Error).message); }
      expect(erro).toMatch(/LIFO/);
      // nada foi desfeito: as 5 ainda estão no texto "depois" (a migration segue aplicada)
      const g = guardas(MIG);
      for (const [i, f] of REDEF.entries()) expect(md5((await def(c, f.fn))!), f.arq).toBe(g[i].depois);
      if (existia) await c.query("ALTER TABLE public._distribuicao_tabelas_fora_lifo RENAME TO distribuicao_tabelas");
    });
  });

  it("T4 fix1 · F1(d) — PR10 pós-condição da VOLTA: md5 'antes' adulterado no inverso ⇒ a volta RECUSA e desfaz TUDO (RPCs/colunas continuam)", async () => {
    if (!MIG_TXN) return;
    await withTx(async (c) => {
      await prepara(c);
      await voltaParte2SePreciso(c); // LIFO: senão a volta recusaria por LIFO antes de chegar à pós-condição
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'");
      const inv = ler(INV);
      const real = guardas(INV)[2].antes; // _plan_tecido_snapshot — a volta recria com o texto real; só o $pos$ exige outro
      const falso = real.slice(0, -1) + (real.at(-1) === "0" ? "1" : "0");
      const alvo = `IF v_md5 IS DISTINCT FROM '${real}' THEN\n    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou`;
      expect(inv.split(alvo).length - 1).toBe(1);
      const forjada = inv.replace(alvo, alvo.replace(real, falso));
      let erro = "";
      try { await aplicarSql(c, semTravas(forjada, "inverso forjado"), "inverso forjado"); } catch (e) { erro = String((e as Error).message); }
      expect(erro).toMatch(/pós-condição falhou/);
      // desfeito por completo: as 5 continuam no texto "depois" (a volta não vingou) e a RPC/colunas continuam
      const g = guardas(MIG);
      for (const [i, f] of REDEF.entries()) expect(md5((await def(c, f.fn))!), f.arq).toBe(g[i].depois);
      expect((await um<{ n: number }>(c, "select count(*)::int n from information_schema.columns where table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')")).n).toBe(2);
      expect((await um<{ ok: boolean }>(c, "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null ok")).ok).toBe(false);
    });
  });

  it("T4 fix1 · F1(e) — card SEM distribuição: aplicar mantém a reserva REAL (#4, _estoque_tecido_core) e o BOM inteiro idênticos aos de antes da migration (comparado com a função VIVA)", async () => {
    if (!MIG_TXN) return;
    await withTx(async (c) => {
      // T4 fix3 (revisor 2, checagem): `prepara(c)` no modo txn JÁ aplica a migration (`if (MIG_TXN) await
      // aplica(c, MIG)`) — chamá-la aqui faria a fase "ANTES" rodar a função NOVA, e as comparações
      // "antes/depois" ficariam tautológicas (comparando a função nova com ela mesma). Em vez de `prepara`, só
      // as 2 travas SET LOCAL (sem aplicar nada) — o "antes" roda o `_plan_tecido_gravar_bom_core` VIVO da
      // cópia; a migration só é aplicada 1× depois de capturar o "antes".
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '60s'");
      await voltaTamanhoEmSePreciso(c); // LIFO (20261014100000)
      await lojaComModulos(c, true);
      const k = await cena(c);
      const m = await um<{ id: string }>(c, "insert into modelos (tenant_id, nome, origem) values ($1, 'ITEST-DIST SemDist', 'interno') returning id", [TENANT_TESTE]);
      // T4 fix3 · item 2: `multiplicador` e `ordem` DIFERENTES de 1 em cada linha (T1 ordem 2 × mult 3; forro
      // ordem 5 × mult 4) — se o INSERT trocasse `ordem`↔`multiplicador` (ou entre as 2 linhas), a reserva e o
      // BOM comparado mudariam; com os dois em 1 (valor da versão anterior deste teste) essa troca era invisível.
      // ANTES da migration: grava um payload SEM casamento com o gravar_bom VIVO (sem as colunas novas, sem
      // distribuição) — é o caso mais comum: modelo novo ou loja sem o módulo (materiaisParaAplicar(slot,false)
      // nunca manda 'complementa_variante_ids').
      const payloadSemCasamento = () => JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 2, multiplicador: 3, grades: { "38|P": 10 }, grade_total: 10 },
        ] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 5, multiplicador: 4 }] },
      ]);
      // T4 fix2 · G3 (revisor 2 M-a): o BOM inteiro (não só `complementa`) — tipo, ordem, multiplicador,
      // variante_tecido_id de CADA linha de modelo_tecido_variantes do card, na ordem tipo desc, ordem.
      const bomInteiro = async (modeloId: string) => (await c.query(
        `select mt.tipo, mtv.ordem, mtv.multiplicador::text mult, mtv.variante_tecido_id v, mtv.complementa_variante_ids comp
           from modelo_tecido_variantes mtv join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id
          where mt.modelo_id = $1 order by mt.tipo desc, mtv.ordem`, [modeloId])).rows
        .map((r) => ({ tipo: r.tipo, ordem: r.ordem, mult: r.mult, v: r.v, comp: r.comp ? [...r.comp].sort() : null }));
      // T4 fix2 · G3: reserva REAL via _estoque_tecido_core (não _grade_soma_pares isolada, que é 0 constante por
      // construção sem casamento — não prova nada). Lê a linha de vtMarrom.
      const reservado = async () => (await um<{ r: string }>(c,
        "select coalesce((select round(reservado)::text from public._estoque_tecido_core($1) where variante_tecido_id = $2), '0') r",
        [TENANT_TESTE, k.vtMarrom])).r;
      // T4 fix3: `_plan_tecido_gravar_bom_core` faz `delete from modelo_grades where modelo_id = _modelo` no
      // INÍCIO e só REGRAVA a grade do Tecido 1 (variante_numero = ordem do T1) — a grade do forro (a que
      // alimenta o ramo "g(ordem)" de reserva_mod pelo SEU PRÓPRIO ordem=5) precisa ser semeada DEPOIS de CADA
      // chamada ao gravar (senão o gravar apaga o que foi semeado antes dele).
      const semeiaGradeForro = () => c.query(
        "insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1, 5, '{}'::jsonb, 2)", [m.id]);

      // "ANTES" roda contra a função VIVA da cópia (a migration ainda não foi aplicada nesta txn).
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payloadSemCasamento()]);
      await semeiaGradeForro();
      const bomAntes = await bomInteiro(m.id);
      expect(bomAntes.find((l) => l.tipo === "forro")?.comp).toBeNull(); // sem casamento prévio: NULL, como hoje
      const reservaAntes = await reservado();
      expect(reservaAntes).toBe("38"); // T1: 1×10×3=30; forro sem par, g(ordem=5)=2: 1×2×4=8; total 38

      // Só agora a migration é aplicada — 1× — e o "DEPOIS" roda contra a função NOVA.
      await aplica(c, MIG);
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payloadSemCasamento()]);
      await semeiaGradeForro();
      const bomDepois = await bomInteiro(m.id);
      expect(bomDepois, "BOM inteiro (tipo/ordem/multiplicador/variante/casamento) idêntico ao de antes da migration").toEqual(bomAntes);
      const reservaDepois = await reservado();
      expect(reservaDepois).toBe(reservaAntes); // 38 → 38: idêntico (a reserva #4 só muda para quem PREENCHE o casamento)

      // Com casamento REAL (populando modelo_grades, o que _grade_soma_pares de fato lê): a soma é igual antes e
      // depois da migration para a MESMA função/dados — a migration não redefine _grade_soma_pares (prova estática
      // no checklist do G-migration A item 6); confere aqui, no banco, que o comportamento realmente não mudou.
      const m2 = await um<{ id: string }>(c, "insert into modelos (tenant_id, nome, origem) values ($1, 'ITEST-DIST SemDist2', 'interno') returning id", [TENANT_TESTE]);
      await c.query("insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1, 1, '{}'::jsonb, 12)", [m2.id]);
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m2.id, JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: { "38|P": 12 }, grade_total: 12, complementa_variante_ids: [k.vtMarrom] }] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, complementa_variante_ids: [k.vtMarrom] }] },
      ])]);
      expect((await um<{ s: string }>(c,
        `select public._grade_soma_pares($1, mtv.complementa_variante_ids)::text s from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id where mt.modelo_id = $1 and mt.tipo = 'forro'`, [m2.id])).s).toBe("12");
    });
  });
});
