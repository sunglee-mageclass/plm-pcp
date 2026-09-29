/**
 * SKU AUTOMÁTICO — F3.5a (banco). Integração em BEGIN…ROLLBACK: NADA é gravado.
 * Plano: docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md (Tasks 2–6).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Em qualquer outro banco
 * a suíte inteira PULA (ehBancoLocal()); com SKU_MIG_TXN=1 fora da cópia ela RECUSA já na coleta (exigeBancoLocal()).
 * DDL em txn contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).
 *
 * Dois modos:
 *  • SKU_MIG_TXN=1 — aplica a migration DENTRO da txn de cada teste (tests/integration/mig-txn.ts: tira BEGIN/COMMIT,
 *    NUNCA `\i` — incidente 15/set) → a cópia NÃO precisa ter a F3.5a. Segura AccessExclusive em tenant_config/modelos/
 *    cores durante o teste: o app de teste :5188 CONGELA enquanto roda (R5 — avisar o dono antes; Task 2 Step 1).
 *    As 2 linhas `SET LOCAL lock_timeout/transaction_timeout` do arquivo (receita supautils) são tiradas antes de
 *    aplicar (semTravas): o transaction_timeout de 3 s limitaria a txn INTEIRA do teste.
 *  • sem a variável — exige a F3.5a JÁ aplicada na cópia (ensaio da Task 6 / QA da Task 10); sem ela, pula.
 * O teste "estático" (travas no arquivo + lista de acentos TS = SQL) não usa banco: roda sempre.
 * Dados de teste: criados na própria txn (cores "SKU-T …", artigos, variantes, modelos, produtos) na Loja Teste.
 * F3.6 (plano 2026-09-25, Task 6 — dono 25/set): o "Tamanho em" NÃO tem mais padrão da loja. Com SKU_MIG_TXN=1 a suíte aplica
 *   TAMBÉM a 20261005100000 depois da F3.5a (as 4 funções do SKU são redefinidas lá); sem a variável, exige as DUAS na cópia.
 * "Tamanho em" nos cards (20261014100000, plano .superpowers/sdd/2026-09-29-tamanho-em/plan.md, Tarefa 2): a F3.5a recria o
 *   repasse produto→modelo com o texto ANTIGO ("só se o modelo não tem"), então com SKU_MIG_TXN=1 o `prepara` aplica a
 *   20261014100000 DEPOIS das duas (e, se a cópia já a tiver, antes volta por ela — LIFO: o guarda da 20261005100000 recusa o
 *   _replicar_cards_plan_tecido_core da 20261014100000). Sem a variável, o teste do repasse exige a 20261014100000 na cópia.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "pg";
type PgClient = Client;
import { hasDb, dbUrl, withTx, comoUsuario, semUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { voltaNomeCorSePreciso } from "./integracao-helpers";
import {
  CASOS_CONFIG, CASOS_MONTAR, CASOS_REF, CASOS_RESOLVER, CASOS_SIGLA, CASOS_SKU_MANUAL, CASOS_TAMANHO, CASOS_TAMANHOS_SKU,
} from "../fixtures/sku-casos";
import { parseTamanho } from "../../src/lib/tamanho";
import {
  ACENTOS_DE, ACENTOS_PARA, montarSku, normalizarRefSku, normalizarSigla, normalizarSkuManual, resolverSku,
} from "../../src/lib/sku-montar";

const MIG = "supabase/migrations/20261003100000_sku_automatico.sql";
const INV = "supabase/rollback/20261003100000_sku_automatico_down.sql";
const MIG_SHEET = "supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql";
const MIG_TAMANHO = "supabase/migrations/20261014100000_tamanho_em_cards.sql";
const INV_TAMANHO = "supabase/rollback/20261014100000_tamanho_em_cards_down.sql";
/** md5 do repasse (fn_produto_tamanho_tipo_handover) DEPOIS da 20261014100000 ("o produto manda"). */
const MD5_REPASSE_TAMANHO_EM = "2712720482d94963ffda1b807fdf6931";
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SKU_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

/** As 2 travas da receita supautils (logo depois do BEGIN — ver Global Constraints do plano). */
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: PgClient, rel: string) => aplicarSql(c, semTravas(readFileSync(rel, "utf8"), rel), rel);

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query("SELECT to_regprocedure('public.salvar_sku_manual(uuid,text,integer,uuid,uuid,text)') IS NOT NULL AS ok");
    return r.rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));
async function tamanhoEmNaCopia(): Promise<boolean> {
  if (!hasDb || !LOCAL) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure('public.fn_produto_tamanho_tipo_handover()'))) AS m");
    return r.rows[0]?.m === MD5_REPASSE_TAMANHO_EM;
  } finally {
    await c.end();
  }
}
const TAMANHO_NA_COPIA = await tamanhoEmNaCopia();
/** O repasse "o produto manda" (20261014100000) vale: no modo txn o prepara aplica; sem ele, precisa estar na cópia. */
const TAMANHO_OK = PRONTO && (MIG_TXN || TAMANHO_NA_COPIA);

async function prepara(c: PgClient): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN) {
    // LIFO (ordem de aplicação: 20261003 → 20261005 → 20261013 cor no nome → 20261014 Tamanho em): volta DENTRO da txn,
    // do mais novo para o mais velho, antes de reaplicar. 1º o Tamanho em (se a cópia o tiver — o guarda da 20261005100000
    // recusaria o _replicar_cards dela); 2º a 20261013100000 (redefine _sku_config_normaliza por cima destas; sem efeito
    // quando ela não está na cópia).
    if (TAMANHO_NA_COPIA) {
      await c.query("SET LOCAL app.tamanho_em_drop_ok = 'sim'");
      await aplica(c, INV_TAMANHO);
      await c.query("SET LOCAL app.tamanho_em_drop_ok = ''");
    }
    await voltaNomeCorSePreciso(c);
    await aplica(c, MIG);
    await aplica(c, MIG_SHEET); // F3.6: o SKU sem padrão da loja mora na 20261005100000
    await aplica(c, MIG_TAMANHO); // a F3.5a recriou o repasse antigo ("só se o modelo não tem") — Tamanho em por último
  }
}

/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável — o RAISE abortaria o resto do teste). */
async function falha(c: PgClient, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT sku_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sku_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT sku_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

const T = TENANT_TESTE;
const CFG = {
  partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
  separadores: { "ref|cor_base": "-", "cor_apelido|tamanho": "-" },
};
const TSKU = { "34": "34", "36": "36", "38": "38", PPP: "ppp", PP: "PP", P: "P" };
const GRADE = ["34|PPP", "36|PP", "38|P"];

async function lojaSku(c: PgClient, cfg: unknown = CFG, tsku: unknown = TSKU, grade: unknown = GRADE): Promise<void> {
  await c.query(
    "UPDATE public.tenant_config SET sku_config = $2::jsonb, tamanhos_sku = $3::jsonb, tamanhos_grade = $4::jsonb WHERE tenant_id = $1",
    [T, JSON.stringify(cfg), JSON.stringify(tsku), JSON.stringify(grade)],
  );
}
const novoId = async (c: PgClient, sql: string, p: unknown[]) => (await um<{ id: string }>(c, sql, p)).id;
/** A chave da variante no SKU = a COR (R1): a mesma função do servidor. */
const chave = async (c: PgClient, cor: string | null, apelido: string | null) =>
  (await um<{ k: string }>(c, "SELECT public._sku_variante_key($1::uuid, $2::uuid) AS k", [cor, apelido])).k;
async function grade(c: PgClient, modelo: string, n: number, g: Record<string, number>): Promise<void> {
  const total = Object.values(g).reduce((s, v) => s + v, 0);
  await c.query(
    "INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, $2, $3::jsonb, $4)",
    [modelo, n, JSON.stringify(g), total],
  );
}
async function tecido1(c: PgClient, mt: string, vts: string[], desde = 1): Promise<void> {
  for (let i = 0; i < vts.length; i++) {
    await c.query(
      "INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)",
      [mt, vts[i], desde + i],
    );
  }
}
// F3.6 (dono 25/set): SEM padrão da loja — o card de teste escolhe o "Tamanho em" ('numero', o que o CFG antigo dava pela
// loja); `null` = card sem escolha (handover do produto espelho).
const modelo = (c: PgClient, nome: string, ref: string, origem = "interno", tipo: string | null = "numero") =>
  novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id", [T, nome, ref, origem, tipo]);
/** Modelo interno com o Tecido 1 = as variantes dadas (na ordem) — para réplica/conflito. */
async function internoCom(c: PgClient, artigo: string, nome: string, ref: string, vts: string[]): Promise<string> {
  const m = await modelo(c, nome, ref);
  const mt = await novoId(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [m, artigo]);
  await tecido1(c, mt, vts);
  return m;
}

type Cen = {
  corAm: string; corVd: string; corAmb: string; apeCan: string; apeMus: string; artigo: string;
  vtAm: string; vtAmCan: string; vtVdMus: string; vtAmb: string; interno: string; mt: string;
  kAm: string; kAmCan: string; kVdMus: string; kAmb: string; kVd: string;
};
/** Loja Teste com o Formato CFG + interno "SKU-T Blusa" (REF SKU-T1): Tecido 1 = [Amarelo (AM), Amarelo+Canário
 *  (AM/CAN), Verde+Musgo (SEM siglas)]; grade v1 {34|PPP:2, 36|PP:1, 38|P:0}, v2 {34|PPP:1}, v3 {36|PP:1}.
 *  k* = chave da variante no SKU (cor base + apelido — R1). */
async function cenario(c: PgClient): Promise<Cen> {
  await lojaSku(c);
  const corAm = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'SKU-T Amarelo', ' am ') RETURNING id", [T]);
  const corVd = await novoId(c, "INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'SKU-T Verde') RETURNING id", [T]);
  const corAmb = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'SKU-T Âmbar', 'AM') RETURNING id", [T]);
  const apeCan = await novoId(c, "INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id, sigla_sku) VALUES ($1, 'SKU-T Canário', $2, 'can') RETURNING id", [T, corAm]);
  const apeMus = await novoId(c, "INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, 'SKU-T Musgo', $2) RETURNING id", [T, corVd]);
  const artigo = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'SKU-T Tecido') RETURNING id", [T]);
  const vt = (cor: string, ape: string | null) =>
    novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4) RETURNING id", [T, artigo, cor, ape]);
  const vtAm = await vt(corAm, null);
  const vtAmCan = await vt(corAm, apeCan);
  const vtVdMus = await vt(corVd, apeMus);
  const vtAmb = await vt(corAmb, null);
  const interno = await modelo(c, "SKU-T Blusa", "SKU-T1");
  const mt = await novoId(c, "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [interno, artigo]);
  await tecido1(c, mt, [vtAm, vtAmCan, vtVdMus]);
  await grade(c, interno, 1, { "34|PPP": 2, "36|PP": 1, "38|P": 0 });
  await grade(c, interno, 2, { "34|PPP": 1 });
  await grade(c, interno, 3, { "36|PP": 1 });
  return {
    corAm, corVd, corAmb, apeCan, apeMus, artigo, vtAm, vtAmCan, vtVdMus, vtAmb, interno, mt,
    kAm: await chave(c, corAm, null), kAmCan: await chave(c, corAm, apeCan), kVdMus: await chave(c, corVd, apeMus),
    kAmb: await chave(c, corAmb, null), kVd: await chave(c, corVd, null),
  };
}

async function rpc(c: PgClient, fn: string, args: unknown[]): Promise<any> {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await um<{ v: any }>(c, `SELECT public.${fn}(${ph}) AS v`, args)).v;
}
const gerar = (c: PgClient, m: string, regerar = false) => rpc(c, "gerar_skus_modelo", [m, regerar]);
const matriz = (c: PgClient, m: string) => rpc(c, "skus_modelo", [m]);
const linha = (mz: any, vkey: string, tkey: string) =>
  (mz.linhas as any[]).find((l) => l.variante_key === vkey && l.tamanho_key === tkey);
async function skus(c: PgClient, m: string): Promise<{ variante_key: string; tamanho_key: string; sku: string; manual: boolean }[]> {
  return (await c.query(
    "SELECT variante_key, tamanho_key, sku, manual FROM public.modelo_skus WHERE modelo_id = $1 ORDER BY sku COLLATE \"C\"", [m],
  )).rows;
}
const idDe = async (c: PgClient, m: string, vk: string, tk: string) => (await um<{ id: string; rev: number }>(c,
  "SELECT id, rev FROM public.modelo_skus WHERE modelo_id = $1 AND variante_key = $2 AND tamanho_key = $3", [m, vk, tk]));

// ─────────────────────────────── Task 3 — estático (sem banco) ───────────────────────────────
describe("SKU F3.5a — estático: travas no arquivo e acentos", () => {
  it("migration e inverso: as 2 travas SET LOCAL logo depois do BEGIN; lista de acentos do SQL = a do TS", () => {
    for (const f of [MIG, INV]) {
      const linhas = readFileSync(f, "utf8").split("\n");
      const i = linhas.findIndex((l) => /^BEGIN;\s*$/.test(l));
      expect(i, `${f}: BEGIN;`).toBeGreaterThanOrEqual(0);
      expect(linhas.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
    }
    const sql = readFileSync(MIG, "utf8");
    expect(sql).toContain(`'${ACENTOS_DE}'`);
    expect(sql).toContain(`'${ACENTOS_PARA}'`);
  });
});

// ─────────────────────────────── Task 3 — anti-drift TS × SQL ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — anti-drift TS × SQL (tests/fixtures/sku-casos.ts)", () => {
  it("parseTamanho/ladoTamanho ≡ _sku_tamanho_lados/_sku_tamanho_lado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_TAMANHO) {
        const r = await um<any>(c,
          "SELECT l.numero, l.letra, public._sku_tamanho_lado($1, 'numero') AS ln, public._sku_tamanho_lado($1, 'letra') AS ll FROM public._sku_tamanho_lados($1) AS l",
          [k.entrada]);
        expect({ n: r.numero, l: r.letra, ln: r.ln, ll: r.ll }, JSON.stringify(k.entrada))
          .toEqual({ n: k.numero, l: k.letra, ln: k.ladoNumero, ll: k.ladoLetra });
        expect(parseTamanho(k.entrada)).toEqual({ numero: r.numero, letra: r.letra });
      }
    });
  });

  it("normalizarSigla ≡ _sku_norm_sigla (sem acento, só A–Z/0–9, maiúsculas — D6)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_SIGLA) {
        const r = await um<{ v: string | null }>(c, "SELECT public._sku_norm_sigla($1) AS v", [k.entrada]);
        expect(r.v, JSON.stringify(k.entrada)).toBe(k.esperado);
        expect(normalizarSigla(k.entrada)).toBe(r.v);
      }
    });
  });

  it("normalizarRefSku ≡ _sku_norm_ref", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_REF) {
        const r = await um<{ v: string }>(c, "SELECT public._sku_norm_ref($1) AS v", [k.entrada]);
        expect(r.v, JSON.stringify(k.entrada)).toBe(k.esperado);
        expect(normalizarRefSku(k.entrada)).toBe(r.v);
      }
    });
  });

  it("normalizarSkuManual ≡ _sku_norm_manual (valor e MESMA mensagem de erro, P0001)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_SKU_MANUAL) {
        const q = "SELECT public._sku_norm_manual($1) AS v";
        if ("erro" in k) {
          const e = await falha(c, q, [k.entrada]);
          expect({ code: e.code, message: e.message }, JSON.stringify(k.entrada)).toEqual({ code: "P0001", message: k.erro });
          expect(normalizarSkuManual(k.entrada)).toEqual({ ok: false, erro: e.message });
        } else {
          const v = (await um<{ v: string }>(c, q, [k.entrada])).v;
          expect(v, JSON.stringify(k.entrada)).toBe(k.esperado);
          expect(normalizarSkuManual(k.entrada)).toEqual({ ok: true, valor: v });
        }
      }
    });
  });

  it("normalizarSkuConfig ≡ _sku_config_normaliza (valor canônico e MESMA mensagem de erro, P0001)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      // P-126 (20261013100000): os casos com a chave `cor_no_nome` só valem com o normalizador DELA vivo — sem ela (cópia de antes
      // ou modo txn, que volta ao texto da F3.6) ficam de fora AQUI; a suíte integracao-8-nome-cor roda TODOS com ela aplicada.
      const comCorNoNome = (await um<{ d: string }>(c, "SELECT pg_get_functiondef('public._sku_config_normaliza(jsonb)'::regprocedure) AS d")).d
        .includes("cor_no_nome");
      for (const k of CASOS_CONFIG) {
        if (!comCorNoNome && JSON.stringify(k.entrada).includes('"cor_no_nome"')) continue;
        const q = "SELECT public._sku_config_normaliza($1::jsonb) AS v";
        const p = [JSON.stringify(k.entrada)];
        if ("erro" in k) {
          const e = await falha(c, q, p);
          expect({ code: e.code, message: e.message }, JSON.stringify(k.entrada)).toEqual({ code: "P0001", message: k.erro });
        } else {
          expect((await um<any>(c, q, p)).v, JSON.stringify(k.entrada)).toEqual(k.esperado);
        }
      }
    });
  });

  it("normalizarTamanhosSku ≡ _sku_tamanhos_normaliza (valor e MESMA mensagem de erro, P0001)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_TAMANHOS_SKU) {
        const q = "SELECT public._sku_tamanhos_normaliza($1::jsonb) AS v";
        const p = [JSON.stringify(k.entrada)];
        if ("erro" in k) {
          const e = await falha(c, q, p);
          expect({ code: e.code, message: e.message }, JSON.stringify(k.entrada)).toEqual({ code: "P0001", message: k.erro });
        } else {
          expect((await um<any>(c, q, p)).v, JSON.stringify(k.entrada)).toEqual(k.esperado);
        }
      }
    });
  });

  it("montarSku ≡ _sku_montar e resolverSku ≡ _sku_resolver", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_MONTAR) {
        const r = await um<{ v: string }>(c, "SELECT public._sku_montar($1::jsonb, $2::jsonb) AS v", [JSON.stringify(k.cfg), JSON.stringify(k.valores)]);
        expect(r.v, JSON.stringify(k.valores)).toBe(k.esperado);
        expect(montarSku(k.cfg, k.valores)).toBe(r.v);
      }
      for (const k of CASOS_RESOLVER) {
        const e = k.entrada;
        const r = await um<{ v: unknown }>(c,
          "SELECT public._sku_resolver($1::jsonb, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb) AS v",
          [JSON.stringify(e.cfg), e.ref, e.cor ? JSON.stringify(e.cor) : null, e.apelido ? JSON.stringify(e.apelido) : null,
           e.tamanhoKey, e.tipo, e.tamanhosSku ? JSON.stringify(e.tamanhosSku) : null]);
        expect(r.v, `${e.tamanhoKey}/${e.tipo}`).toEqual(k.esperado);
        expect(resolverSku(e)).toEqual(r.v);
      }
    });
  });
});

// ─────────────────────────────── Task 4 — dados: normalização no salvar, handover, schema, unicidade ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — colunas, gatilhos e tabela", () => {
  it("siglas de cor base/apelido normalizadas NO SALVAR (sem acento/espaço, maiúsculas; vazia = NULL)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const sig = async (tab: string, id: string) => (await um<{ s: string | null }>(c, `SELECT sigla_sku AS s FROM public.${tab} WHERE id = $1`, [id])).s;
      expect(await sig("cores", k.corAm)).toBe("AM");
      expect(await sig("cores_apelido", k.apeCan)).toBe("CAN");
      await c.query("UPDATE public.cores SET sigla_sku = ' \t ' WHERE id = $1", [k.corAm]);
      expect(await sig("cores", k.corAm)).toBeNull();
      await c.query("UPDATE public.cores SET sigla_sku = ' off white ' WHERE id = $1", [k.corAm]);
      expect(await sig("cores", k.corAm)).toBe("OFFWHITE");
      await c.query("UPDATE public.cores SET sigla_sku = 'açaí' WHERE id = $1", [k.corAm]);
      expect(await sig("cores", k.corAm)).toBe("ACAI");
      await c.query("UPDATE public.cores_apelido SET sigla_sku = '' WHERE id = $1", [k.apeCan]);
      expect(await sig("cores_apelido", k.apeCan)).toBeNull();
    });
  });

  it("tenant_config: Formato do SKU e siglas de tamanho canonizados; inválido = P0001 em PT; o upsert genérico não dispara", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaSku(c, { ...CFG, lixo: true, separadores: { ...CFG.separadores, "ref|tamanho": "#" } });
      const r = await um<any>(c, "SELECT sku_config, tamanhos_sku FROM public.tenant_config WHERE tenant_id = $1", [T]);
      expect(r.sku_config).toEqual({
        partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
        separadores: { "ref|cor_base": "-", "cor_apelido|tamanho": "-" },
      });
      expect(r.tamanhos_sku).toEqual({ "34": "34", "36": "36", "38": "38", PPP: "PPP", PP: "PP", P: "P" });
      // F3.6 (R24): a chave legada tamanho_padrao é IGNORADA pelo gatilho (sem erro) e sai do jsonb gravado
      await lojaSku(c, { ...CFG, tamanho_padrao: "numero" });
      expect((await um<any>(c, "SELECT sku_config FROM public.tenant_config WHERE tenant_id = $1", [T])).sku_config).not.toHaveProperty("tamanho_padrao");
      const e = await falha(c, "UPDATE public.tenant_config SET sku_config = '{\"partes\":[\"ref\",\"cor\"]}'::jsonb WHERE tenant_id = $1", [T]);
      expect(e).toEqual({ code: "P0001", message: 'Parte do SKU desconhecida: "cor".' });
      const e2 = await falha(c, "UPDATE public.tenant_config SET tamanhos_sku = '{\"34\": 34}'::jsonb WHERE tenant_id = $1", [T]);
      expect(e2).toEqual({ code: "P0001", message: "Sigla de tamanho inválida: 34." });
      const e3 = await falha(c,
        "UPDATE public.tenant_config SET sku_config = '{\"partes\":[\"ref\",\"tamanho\"],\"separadores\":{\"ref|tamanho\":\"#\"}}'::jsonb WHERE tenant_id = $1", [T]);
      expect(e3).toEqual({ code: "P0001", message: "Separador do SKU: use só - . _ /." });
      await c.query("UPDATE public.tenant_config SET sku_config = '{\"partes\":[]}'::jsonb WHERE tenant_id = $1", [T]);
      expect((await um<any>(c, "SELECT sku_config FROM public.tenant_config WHERE tenant_id = $1", [T])).sku_config).toBeNull();
      // o upsert genérico da Config (sem as 2 colunas no SET) não passa pelo gatilho: ele é "UPDATE OF" as 2 colunas
      const def = (await um<{ d: string }>(c, "SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgname = 'trg_tenant_config_sku'")).d;
      expect(def).toContain("BEFORE INSERT OR UPDATE OF sku_config, tamanhos_sku ON public.tenant_config");
    });
  });

  it("tamanho_tipo: CHECK letra|numero (NOT VALID — vale p/ escrita nova) em modelos/produtos; NULL = sem escolha (F3.6: obrigatório p/ gerar)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const e = await falha(c, "UPDATE public.modelos SET tamanho_tipo = 'grande' WHERE id = $1", [k.interno]);
      expect(e.code).toBe("23514");
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.interno]);
      await c.query("UPDATE public.modelos SET tamanho_tipo = NULL WHERE id = $1", [k.interno]);
      const e2 = await falha(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T x', 'SKU-PAX', 'm')", [T]);
      expect(e2.code).toBe("23514");
      const e3 = await falha(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T y', 'SKU-PIY', 'm')", [T]);
      expect(e3.code).toBe("23514");
      // NOT VALID de verdade (não só "vale para escrita nova" por acaso): confere no catálogo que os 3 CHECKs
      // nasceram convalidated=false (senão o ADD CONSTRAINT teria varrido a tabela inteira sob AccessExclusive).
      const { rows: nv } = await c.query<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated FROM pg_constraint
          WHERE conname IN ('modelos_tamanho_tipo_chk', 'produtos_acabados_tamanho_tipo_chk', 'produtos_importados_tamanho_tipo_chk')
          ORDER BY conname`);
      expect(nv).toEqual([
        { conname: "modelos_tamanho_tipo_chk", convalidated: false },
        { conname: "produtos_acabados_tamanho_tipo_chk", convalidated: false },
        { conname: "produtos_importados_tamanho_tipo_chk", convalidated: false },
      ]);
    });
  });

  // Tamanho em nos cards (20261014100000, Tarefa 2): o repasse passou a "o produto manda" (IS DISTINCT FROM, não mais "só se o
  // modelo não tem" — o default 'letra' do modelo engolia a escolha). Criação REAL do card (antes era um modelo montado à mão
  // com tamanho_tipo NULL, que escondia o bug). Loja cruzada: trg_pi/pa_modelo_tenant recusa ANTES do repasse (P0001) — o caso
  // antigo esperava o UPDATE passar e o modelo alheio ficar intocado; desde a 20261007130000 (Integração 4) o vínculo cruzado é
  // recusado (o teste falhava na cópia).
  it.skipIf(!TAMANHO_OK)("handover: o 'Tamanho em' do produto vai ao modelo espelho ao criar o card (real) e a cada troca no produto vinculado; o produto fica NULL; loja cruzada é recusada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const pa = await novoId(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T PA', 'SKU-PA0', 'numero') RETURNING id", [T]);
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_acabados WHERE id = $1", [pa])).tamanho_tipo).toBe("numero");
      const m1 = (await um<{ id: string }>(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa])).id;
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.modelos WHERE id = $1", [m1])).tamanho_tipo).toBe("numero");
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_acabados WHERE id = $1", [pa])).tamanho_tipo).toBeNull();
      // vinculado: mudar no produto MUDA o modelo (o produto manda — P-85 A); o produto continua limpo (1 fonte só)
      await c.query("UPDATE public.produtos_acabados SET tamanho_tipo = 'letra' WHERE id = $1", [pa]);
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.modelos WHERE id = $1", [m1])).tamanho_tipo).toBe("letra");
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_acabados WHERE id = $1", [pa])).tamanho_tipo).toBeNull();
      // importado idem, pela criação real do card
      const pi0 = await novoId(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T PI', 'SKU-PI9', 'numero') RETURNING id", [T]);
      const m2 = (await um<{ id: string }>(c, "SELECT public._criar_card_produto_importado_core($1) AS id", [pi0])).id;
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.modelos WHERE id = $1", [m2])).tamanho_tipo).toBe("numero");
      expect((await um<any>(c, "SELECT tamanho_tipo FROM public.produtos_importados WHERE id = $1", [pi0])).tamanho_tipo).toBeNull();
      // importado apontando p/ modelo de OUTRA loja: recusado (P0001, trg_pi_modelo_tenant roda antes do repasse) e o modelo
      // alheio fica intocado
      const alheio = await um<{ id: string; tamanho_tipo: string | null; rev: number }>(c,
        "SELECT id, tamanho_tipo, rev FROM public.modelos WHERE tenant_id <> $1 AND NOT EXISTS (SELECT 1 FROM public.produtos_importados p WHERE p.modelo_id = modelos.id) ORDER BY id LIMIT 1", [T]);
      expect(alheio?.id, "a cópia precisa de 1 modelo de outra loja").toBeTruthy();
      const outro = alheio.tamanho_tipo === "numero" ? "letra" : "numero";
      const pi = await novoId(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, 'SKU-T PI', 'SKU-PI0', $2) RETURNING id", [T, outro]);
      const e = await falha(c, "UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2", [alheio.id, pi]);
      expect(e).toEqual({ code: "P0001", message: "Modelo de outra loja não pode ser vinculado aqui." });
      expect(await um<any>(c, "SELECT tamanho_tipo, rev FROM public.modelos WHERE id = $1", [alheio.id]))
        .toEqual({ tamanho_tipo: alheio.tamanho_tipo, rev: alheio.rev });
      expect((await um<any>(c, "SELECT tamanho_tipo, modelo_id FROM public.produtos_importados WHERE id = $1", [pi])))
        .toEqual({ tamanho_tipo: outro, modelo_id: null });
    });
  });

  it("modelo_skus: 1 SKU por linha (UNIQUE composta); SKU igual na loja SÓ entre réplicas (REF VIVA igual e não vazia + mesma linha — D5); CASCADE", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const ins = "INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, $4, $5)";
      const emUso = { code: "23505", message: "O SKU X-1 já está em uso na loja." };
      await c.query(ins, [T, k.interno, k.kAm, "34|PPP", "X-1"]);
      expect(await falha(c, ins, [T, k.interno, k.kAmCan, "34|PPP", "X-1"])).toEqual(emUso); // outra linha do MESMO card
      expect((await falha(c, ins, [T, k.interno, k.kAm, "34|PPP", "X-2"])).code).toBe("23505"); // mesma linha 2×
      expect((await falha(c, ins, [T, k.interno, k.kAm, "36|PP", "  "])).code).toBe("23514");
      // réplica/versão (outro card, MESMA REF viva — comparada normalizada —, MESMA cor + tamanho) reusa o SKU
      const rep = await modelo(c, "SKU-T Blusa v2", " sku-t1 ");
      await c.query(ins, [T, rep, k.kAm, "34|PPP", "X-1"]);
      expect(await falha(c, ins, [T, rep, k.kAmCan, "34|PPP", "X-1"])).toEqual(emUso); // réplica, outra linha
      expect(await falha(c, "UPDATE public.modelo_skus SET tamanho_key = '36|PP' WHERE modelo_id = $1", [rep])).toEqual(emUso);
      const outra = await modelo(c, "SKU-T Outra", "SKU-T9");
      expect(await falha(c, ins, [T, outra, k.kAm, "34|PPP", "X-1"])).toEqual(emUso); // outra REF
      // vale a REF VIVA do card (R2-a): trocada a REF da réplica, a próxima gravação da linha dela é recusada
      await c.query("UPDATE public.modelos SET ref = 'SKU-T8' WHERE id = $1", [rep]);
      expect(await falha(c, "UPDATE public.modelo_skus SET sku = sku WHERE modelo_id = $1", [rep])).toEqual(emUso);
      // card sem REF não conta como réplica
      const s1 = await modelo(c, "SKU-T Sem REF 1", "");
      const s2 = await modelo(c, "SKU-T Sem REF 2", "");
      await c.query(ins, [T, s1, k.kAm, "38|P", "Y-1"]);
      expect((await falha(c, ins, [T, s2, k.kAm, "38|P", "Y-1"])).code).toBe("23505");
      // outra loja pode ter o mesmo SKU
      const alheio = await um<{ id: string; tenant_id: string }>(c, "SELECT id, tenant_id FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1", [T]);
      await c.query(ins, [alheio.tenant_id, alheio.id, k.kAm, "34|PPP", "X-1"]);
      await c.query("DELETE FROM public.modelos WHERE id = $1", [k.interno]); // filhas em CASCADE (grades, tecidos, skus)
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.modelo_skus WHERE modelo_id = $1", [k.interno])).n).toBe(0);
    });
  });
});

// ─────────────────────────────── Task 5 — geração, regerar, manual, leitura ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — gerar_skus_modelo / salvar_sku_manual / skus_modelo", () => {
  it("sem Formato na loja: 'sem_formato', nada gravado; sem REF: 'aguardando_ref', nada gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("UPDATE public.tenant_config SET sku_config = NULL WHERE tenant_id = $1", [T]);
      let r = await gerar(c, k.interno);
      expect([r.status, r.criados, r.conflitos]).toEqual(["sem_formato", 0, []]);
      await lojaSku(c);
      await c.query("UPDATE public.modelos SET ref = '  ' WHERE id = $1", [k.interno]);
      r = await gerar(c, k.interno, true);
      expect([r.status, r.criados, r.removidos]).toEqual(["aguardando_ref", 0, 0]);
      expect(await skus(c, k.interno)).toEqual([]);
    });
  });

  it("gera por variante (COR) do Tecido 1 × tamanho com qtd > 0; falta sigla de cor base ⇒ a linha não gera (faltas[]); apelido sem sigla = avisos[] (D4)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      const r = await gerar(c, k.interno);
      expect(r.status).toBe("ok");
      expect(r.criados).toBe(3);
      expect(r.tamanho_tipo).toBe("numero"); // o "Tamanho em" do card (modelo() grava 'numero' — F3.6: sem padrão da loja)
      expect(await skus(c, k.interno)).toEqual([
        { variante_key: k.kAm, tamanho_key: "34|PPP", sku: "SKU-T1-AM-34", manual: false },
        { variante_key: k.kAm, tamanho_key: "36|PP", sku: "SKU-T1-AM-36", manual: false },
        { variante_key: k.kAmCan, tamanho_key: "34|PPP", sku: "SKU-T1-AMCAN-34", manual: false },
      ]);
      expect(r.faltas).toEqual([{ atributo: "cor_base", id: k.corVd, nome: "SKU-T Verde" }]);
      expect(r.avisos).toEqual([{ atributo: "cor_apelido", id: k.apeMus, nome: "SKU-T Musgo" }]); // D4: não bloqueia
      expect(linha(r, k.kVdMus, "36|PP")).toMatchObject({ estado: "falta", avisos: [{ atributo: "cor_apelido", id: k.apeMus, nome: "SKU-T Musgo" }] });
      expect(linha(r, k.kAm, "34|PPP").estado).toBe("ok");
      expect(linha(r, k.kAm, "38|P")).toBeUndefined(); // qtd 0 não entra
      expect((await matriz(c, k.interno)).linhas).toEqual(r.linhas); // leitura = o que a geração devolveu
    });
  });

  it("_regerar=false não mexe no que existe (Q2); _regerar=true recalcula SÓ as automáticas; manual nunca muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const id34 = (await idDe(c, k.interno, k.kAm, "34|PPP")).id;
      const man = await rpc(c, "salvar_sku_manual", [id34, "  meu-1 "]);
      expect(man).toMatchObject({ id: id34, sku: "MEU-1", manual: true });
      await c.query("UPDATE public.cores SET sigla_sku = 'ama' WHERE id = $1", [k.corAm]);
      let r = await gerar(c, k.interno);
      expect([r.criados, r.atualizados]).toEqual([0, 0]);
      expect(linha(r, k.kAm, "36|PP")).toMatchObject({ estado: "divergente", sku: "SKU-T1-AM-36", sku_previsto: "SKU-T1-AMA-36" });
      r = await gerar(c, k.interno, true);
      expect(r.atualizados).toBe(2);
      expect(await skus(c, k.interno)).toEqual([
        { variante_key: k.kAm, tamanho_key: "34|PPP", sku: "MEU-1", manual: true },
        { variante_key: k.kAm, tamanho_key: "36|PP", sku: "SKU-T1-AMA-36", manual: false },
        { variante_key: k.kAmCan, tamanho_key: "34|PPP", sku: "SKU-T1-AMACAN-34", manual: false },
      ]);
      expect(linha(r, k.kAm, "34|PPP")).toMatchObject({ estado: "manual", manual: true, sku_previsto: "SKU-T1-AMA-34" });
    });
  });

  it("regerar remove as AUTOMÁTICAS que saíram da grade e mantém as manuais (órfãs); gerar sem regerar não remove", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      await rpc(c, "salvar_sku_manual", [(await idDe(c, k.interno, k.kAm, "34|PPP")).id, "MEU-34"]);
      await c.query("UPDATE public.modelo_grades SET grades = '{\"34|PPP\": 0, \"36|PP\": 0}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1", [k.interno]);
      let r = await gerar(c, k.interno);
      expect(r.removidos).toBe(0);
      expect(linha(r, k.kAm, "36|PP").estado).toBe("orfa");
      r = await gerar(c, k.interno, true);
      expect(r.removidos).toBe(1);
      expect(linha(r, k.kAm, "36|PP")).toBeUndefined();
      expect(linha(r, k.kAm, "34|PPP")).toMatchObject({ estado: "orfa", manual: true, sku: "MEU-34" });
    });
  });

  it("R1 interno: Salvar do BOM (salvar_modelo_bom real) trocando o tecido por outro com as MESMAS cores ⇒ SKUs e manual continuam ligados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      await rpc(c, "salvar_sku_manual", [(await idDe(c, k.interno, k.kAm, "34|PPP")).id, "MEU-34"]);
      const antes = await skus(c, k.interno);
      const artigo2 = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'SKU-T Tecido 2') RETURNING id", [T]);
      const vt2 = (cor: string, ape: string | null) =>
        novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4) RETURNING id", [T, artigo2, cor, ape]);
      const w = [await vt2(k.corAm, null), await vt2(k.corAm, k.apeCan), await vt2(k.corVd, k.apeMus)];
      await c.query("SELECT public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, $3::jsonb, NULL)", [
        k.interno,
        JSON.stringify([{ artigo_id: artigo2, numero: 1, tipo: "tecido", consumo: 1, loss_percent: 0, custo_previsto: 0, variantes: w }]),
        JSON.stringify([
          { variante_numero: 1, grades: { "34|PPP": 2, "36|PP": 1, "38|P": 0 }, grade_total: 3 },
          { variante_numero: 2, grades: { "34|PPP": 1 }, grade_total: 1 },
          { variante_numero: 3, grades: { "36|PP": 1 }, grade_total: 1 },
        ]),
      ]);
      const vts = await c.query(
        "SELECT mtv.variante_tecido_id AS v FROM public.modelo_tecido_variantes mtv JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id WHERE mt.modelo_id = $1 ORDER BY mtv.ordem", [k.interno]);
      expect(vts.rows.map((x) => x.v)).toEqual(w); // o BOM trocou mesmo (ids de variante novos)
      const r = await gerar(c, k.interno, true);
      expect([r.criados, r.atualizados, r.removidos, r.conflitos]).toEqual([0, 0, 0, []]);
      expect(await skus(c, k.interno)).toEqual(antes);
      expect(linha(r, k.kAm, "34|PPP")).toMatchObject({ estado: "manual", sku: "MEU-34" });
    });
  });

  it("D4: apelido SEM sigla ⇒ gera com a cor base + aviso; cadastrada a sigla, o Regerar atualiza o automático e o manual não muda; Formato só com cor_apelido usa a sigla da cor base", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("UPDATE public.cores SET sigla_sku = 'vd' WHERE id = $1", [k.corVd]); // Verde com sigla; Musgo segue SEM
      await c.query("UPDATE public.modelo_grades SET grades = '{\"36|PP\": 1, \"38|P\": 1}'::jsonb WHERE modelo_id = $1 AND variante_numero = 3", [k.interno]);
      let r = await gerar(c, k.interno);
      const aviso = { atributo: "cor_apelido", id: k.apeMus, nome: "SKU-T Musgo" };
      expect([r.criados, r.faltas, r.avisos, r.conflitos]).toEqual([5, [], [aviso], []]);
      expect(linha(r, k.kVdMus, "36|PP")).toMatchObject({ estado: "ok", sku: "SKU-T1-VD-36", avisos: [aviso] });
      await rpc(c, "salvar_sku_manual", [linha(r, k.kVdMus, "38|P").id, "VD-MAO"]);
      await c.query("UPDATE public.cores_apelido SET sigla_sku = 'mus' WHERE id = $1", [k.apeMus]); // cadastrou a sigla
      expect(linha(await matriz(c, k.interno), k.kVdMus, "36|PP")).toMatchObject({ estado: "divergente", sku_previsto: "SKU-T1-VDMUS-36", avisos: [] });
      r = await gerar(c, k.interno, true);
      expect([r.atualizados, r.avisos]).toEqual([1, []]);
      expect(linha(r, k.kVdMus, "36|PP")).toMatchObject({ estado: "ok", sku: "SKU-T1-VDMUS-36" });
      expect(linha(r, k.kVdMus, "38|P")).toMatchObject({ estado: "manual", sku: "VD-MAO" }); // o manual nunca muda
      // Formato SÓ com cor_apelido (sem cor_base): sem apelido ⇒ a sigla da cor base no lugar
      await lojaSku(c, { partes: ["ref", "cor_apelido", "tamanho"], separadores: { "ref|cor_apelido": "-", "cor_apelido|tamanho": "-" } });
      const mz = await matriz(c, k.interno);
      expect(linha(mz, k.kAm, "34|PPP").sku_previsto).toBe("SKU-T1-AM-34");
      expect(linha(mz, k.kAmCan, "34|PPP").sku_previsto).toBe("SKU-T1-CAN-34");
    });
  });

  it("D4 (ciência): apelidos DIFERENTES sem sigla na MESMA cor base dão o MESMO SKU ⇒ a 2ª linha cai em 'repetido neste produto'; cadastrar a sigla ou editar à mão resolve", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      const ape = (nome: string) =>
        novoId(c, "INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, $2, $3) RETURNING id", [T, nome, k.corAm]);
      const apeLim = await ape("SKU-T Limão");
      const apeOuro = await ape("SKU-T Ouro");
      const vt = (a: string) =>
        novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4) RETURNING id", [T, k.artigo, k.corAm, a]);
      await tecido1(c, k.mt, [await vt(apeLim), await vt(apeOuro)], 4);
      await grade(c, k.interno, 4, { "34|PPP": 1 });
      await grade(c, k.interno, 5, { "34|PPP": 1 });
      const kLim = await chave(c, k.corAm, apeLim);
      const kOuro = await chave(c, k.corAm, apeOuro);
      let r = await gerar(c, k.interno);
      expect(r.criados).toBe(3); // Amarelo (sem apelido) fica com SKU-T1-AM-34 — vem antes na ordem
      expect(r.conflitos.map((x: any) => [x.variante_key, x.sku])).toEqual([[kLim, "SKU-T1-AM-34"], [kOuro, "SKU-T1-AM-34"]]);
      expect(r.conflitos[0].mensagem).toMatch(/^SKU SKU-T1-AM-34 repetido neste produto/);
      expect(r.avisos.map((a: any) => a.nome).sort()).toEqual(["SKU-T Limão", "SKU-T Musgo", "SKU-T Ouro"]); // + o Musgo do Verde
      expect(linha(r, kLim, "34|PPP").estado).toBe("conflito");
      await c.query("UPDATE public.cores_apelido SET sigla_sku = 'lim' WHERE id = $1", [apeLim]);
      r = await gerar(c, k.interno, true);
      expect(linha(r, kLim, "34|PPP")).toMatchObject({ estado: "ok", sku: "SKU-T1-AMLIM-34" });
      expect(linha(r, kOuro, "34|PPP").estado).toBe("conflito");
      await c.query("SELECT public.salvar_sku_manual(NULL, 'am-ouro-34', NULL, $1, $2, '34|PPP')", [k.interno, kOuro]);
      expect(linha(await matriz(c, k.interno), kOuro, "34|PPP")).toMatchObject({ estado: "manual", sku: "AM-OURO-34" });
    });
  });

  it("R1-a/D7: duas variantes do Tecido 1 com a MESMA cor + apelido (tecidos diferentes) ⇒ UMA linha (menor ordem, quantidades somadas); o SKU à mão vale para ela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      const artigo2 = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'SKU-T Tecido 2') RETURNING id", [T]);
      const vtAm2 = await novoId(c,
        "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3, NULL) RETURNING id", [T, artigo2, k.corAm]);
      await tecido1(c, k.mt, [vtAm2], 4); // Amarelo de novo (outro tecido), na ordem 4
      await grade(c, k.interno, 4, { "34|PPP": 3, "38|P": 2 }); // 38|P só tem quantidade na 2ª (na 1ª é 0)
      const r = await gerar(c, k.interno);
      expect([r.criados, r.conflitos]).toEqual([4, []]);
      const doAmarelo = (r.linhas as any[]).filter((l) => l.variante_key === k.kAm);
      expect(doAmarelo.map((l) => [l.tamanho_key, l.variante_ordem, l.sku])).toEqual([
        ["34|PPP", 1, "SKU-T1-AM-34"], ["36|PP", 1, "SKU-T1-AM-36"], ["38|P", 1, "SKU-T1-AM-38"],
      ]);
      const m = (await um<{ v: any }>(c, "SELECT public.salvar_sku_manual(NULL, 'am-38', NULL, $1, $2, '38|P') AS v", [k.interno, k.kAm])).v;
      expect(m).toMatchObject({ id: linha(r, k.kAm, "38|P").id, sku: "AM-38", manual: true });
      const r2 = await gerar(c, k.interno, true);
      expect([r2.criados, r2.atualizados, r2.removidos, r2.conflitos]).toEqual([0, 0, 0, []]);
      expect(linha(r2, k.kAm, "38|P")).toMatchObject({ estado: "manual", sku: "AM-38" });
      expect((r2.linhas as any[]).filter((l) => l.variante_key === k.kAm)).toHaveLength(3);
    });
  });

  it("D5 réplica: outro card com a MESMA REF e a mesma cor/tamanho gera o MESMO SKU, sem conflito (decidido pelo dono: A)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const rep = await internoCom(c, k.artigo, "SKU-T Blusa v2", "SKU-T1", [k.vtAm]);
      await grade(c, rep, 1, { "34|PPP": 1, "36|PP": 1 });
      const r = await gerar(c, rep);
      expect([r.criados, r.conflitos]).toEqual([2, []]);
      expect(await skus(c, rep)).toEqual([
        { variante_key: k.kAm, tamanho_key: "34|PPP", sku: "SKU-T1-AM-34", manual: false },
        { variante_key: k.kAm, tamanho_key: "36|PP", sku: "SKU-T1-AM-36", manual: false },
      ]);
      expect(linha(await matriz(c, k.interno), k.kAm, "34|PPP").estado).toBe("ok"); // o original não vira "conflito"
    });
  });

  it("R2-a: trocar a REF de um card que dividia o SKU (réplica, Formato SEM a REF) ⇒ o conflito APARECE nos dois cards (REF viva); o SKU à mão resolve", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await lojaSku(c, { partes: ["cor_base", "cor_apelido", "tamanho"], separadores: { "cor_apelido|tamanho": "-" } });
      await gerar(c, k.interno);
      const rep = await internoCom(c, k.artigo, "SKU-T Blusa v2", "SKU-T1", [k.vtAm]);
      await grade(c, rep, 1, { "34|PPP": 1 });
      expect((await gerar(c, rep)).conflitos).toEqual([]); // réplica: os dois com AM-34
      expect(linha(await matriz(c, k.interno), k.kAm, "34|PPP").estado).toBe("ok");
      await c.query("UPDATE public.modelos SET ref = 'SKU-T8' WHERE id = $1", [rep]); // a REF do card muda
      const naRep = linha(await matriz(c, rep), k.kAm, "34|PPP");
      expect(naRep).toMatchObject({ estado: "conflito", sku: "AM-34", conflito_com: { modelo_id: k.interno, nome: "SKU-T Blusa", ref: "SKU-T1" } });
      expect(linha(await matriz(c, k.interno), k.kAm, "34|PPP")).toMatchObject({ estado: "conflito", conflito_com: { modelo_id: rep, ref: "SKU-T8" } });
      const r = await gerar(c, rep, true); // o Regerar não esconde: o SKU previsto é o mesmo e a linha segue em conflito
      expect(linha(r, k.kAm, "34|PPP").estado).toBe("conflito");
      await rpc(c, "salvar_sku_manual", [naRep.id, "am-34-v2"]);
      expect(linha(await matriz(c, rep), k.kAm, "34|PPP")).toMatchObject({ estado: "manual", sku: "AM-34-V2" });
      expect(linha(await matriz(c, k.interno), k.kAm, "34|PPP").estado).toBe("ok");
    });
  });

  it("conflito com OUTRO produto (REF diferente, Formato sem a REF): não grava a linha e devolve conflitos[] com mensagem PT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await lojaSku(c, { partes: ["cor_base", "cor_apelido", "tamanho"], separadores: { "cor_apelido|tamanho": "-" } });
      await gerar(c, k.interno);
      const m3 = await internoCom(c, k.artigo, "SKU-T Outra", "SKU-T9", [k.vtAm]);
      await grade(c, m3, 1, { "34|PPP": 1 });
      const r = await gerar(c, m3);
      expect(r.criados).toBe(0);
      expect(r.conflitos).toHaveLength(1);
      expect(r.conflitos[0]).toMatchObject({ sku: "AM-34", com_modelo_id: k.interno, variante_key: k.kAm, tamanho_key: "34|PPP" });
      expect(r.conflitos[0].mensagem).toBe("SKU AM-34 já existe em SKU-T Blusa (REF SKU-T1). Edite este SKU à mão ou mude a sigla.");
      expect(linha(r, k.kAm, "34|PPP")).toMatchObject({ estado: "conflito", conflito_com: { modelo_id: k.interno, nome: "SKU-T Blusa", ref: "SKU-T1" } });
      expect(await skus(c, m3)).toEqual([]);
    });
  });

  it("conflito DENTRO do produto (duas cores com a mesma sigla): a 2ª linha não grava, mensagem 'repetido neste produto'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await tecido1(c, k.mt, [k.vtAmb], 4);
      await grade(c, k.interno, 4, { "34|PPP": 1 });
      const r = await gerar(c, k.interno);
      expect(r.criados).toBe(3);
      expect(r.conflitos).toHaveLength(1);
      expect(r.conflitos[0]).toMatchObject({ variante_key: k.kAmb, sku: "SKU-T1-AM-34", com_modelo_id: k.interno });
      expect(r.conflitos[0].mensagem).toMatch(/^SKU SKU-T1-AM-34 repetido neste produto/);
      expect(linha(r, k.kAmb, "34|PPP").estado).toBe("conflito");
    });
  });

  it("Regerar com troca de siglas A↔B no MESMO produto: a regra de unicidade barra as duas trocas (F3.5b decide), mas a mensagem não afirma 'duas linhas dão o mesmo SKU' — a outra linha também está mudando neste Regerar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaSku(c);
      // Card ISOLADO com só 2 cores (A e B), 1 tamanho: sem outras linhas que pudessem confundir o resultado.
      const corA = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'SKU-T Cor A', 'AA') RETURNING id", [T]);
      const corB = await novoId(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'SKU-T Cor B', 'BB') RETURNING id", [T]);
      const artigo = await novoId(c, "INSERT INTO public.artigos (tenant_id, nome) VALUES ($1, 'SKU-T Tecido AB') RETURNING id", [T]);
      const vt = (cor: string) =>
        novoId(c, "INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id) VALUES ($1, $2, $3) RETURNING id", [T, artigo, cor]);
      const vtA = await vt(corA);
      const vtB = await vt(corB);
      const m = await internoCom(c, artigo, "SKU-T AB", "SKU-TAB", [vtA, vtB]);
      await grade(c, m, 1, { "34|PPP": 1 });
      await grade(c, m, 2, { "34|PPP": 1 });
      await comoUsuario(c);
      const kA = await chave(c, corA, null);
      const kB = await chave(c, corB, null);
      let r = await gerar(c, m);
      expect(r.conflitos).toEqual([]);
      expect(linha(r, kA, "34|PPP")).toMatchObject({ estado: "ok", sku: "SKU-TAB-AA-34" });
      expect(linha(r, kB, "34|PPP")).toMatchObject({ estado: "ok", sku: "SKU-TAB-BB-34" });
      // Troca A↔B: a cor A passa a usar a sigla que era da cor B, e vice-versa.
      await c.query("UPDATE public.cores SET sigla_sku = 'BB' WHERE id = $1", [corA]);
      await c.query("UPDATE public.cores SET sigla_sku = 'AA' WHERE id = $1", [corB]);
      r = await gerar(c, m, true);
      expect(r.atualizados).toBe(0); // a UNIQUE barra as duas trocas (regra mantida — F3.5b decide o caso)
      expect(r.conflitos).toHaveLength(2);
      for (const conf of r.conflitos) {
        expect(conf.com_modelo_id).toBe(m);
        expect(conf.mensagem).toBe(
          `SKU ${conf.sku} não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.`,
        );
      }
      // as linhas continuam com o SKU ANTIGO (nada foi gravado) e aparecem como conflito na matriz
      expect(await skus(c, m)).toEqual(expect.arrayContaining([
        expect.objectContaining({ variante_key: kA, tamanho_key: "34|PPP", sku: "SKU-TAB-AA-34" }),
        expect.objectContaining({ variante_key: kB, tamanho_key: "34|PPP", sku: "SKU-TAB-BB-34" }),
      ]));
      expect(linha(r, kA, "34|PPP")).toMatchObject({ estado: "conflito" });
      expect(linha(r, kB, "34|PPP")).toMatchObject({ estado: "conflito" });
    });
  });

  it("revenda: variantes do Produto Acabado; o 'Tamanho em' do card (letra) decide o lado (F3.6: sem padrão da loja)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("UPDATE public.cores SET sigla_sku = 'vd' WHERE id = $1", [k.corVd]);
      const pa = await novoId(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref) VALUES ($1, 'SKU-T Vestido', 'SKU-PA1') RETURNING id", [T]);
      const rev = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'SKU-T Vestido', 'SKU-R1', 'revenda', 'letra') RETURNING id", [T]);
      await c.query("UPDATE public.produtos_acabados SET modelo_id = $1 WHERE id = $2", [rev, pa]);
      const pv = (ordem: number, cor: string, ape: string | null, qtd: number) => c.query(
        "INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, qtd) VALUES ($1, $2, $3, $4, $5, $6)",
        [T, pa, ordem, cor, ape, qtd]);
      await pv(1, k.corAm, k.apeCan, 1);
      await pv(2, k.corVd, null, 2);
      await grade(c, rev, 1, { "38|P": 1 });
      await grade(c, rev, 2, { "36|PP": 2 });
      const r = await gerar(c, rev);
      expect([r.criados, r.tamanho_tipo, r.tamanho_tipo_card]).toEqual([2, "letra", "letra"]);
      expect(await skus(c, rev)).toEqual([
        { variante_key: k.kAmCan, tamanho_key: "38|P", sku: "SKU-R1-AMCAN-P", manual: false },
        { variante_key: k.kVd, tamanho_key: "36|PP", sku: "SKU-R1-VD-PP", manual: false },
      ]);
    });
  });

  it("R1 revenda: Salvar do PRODUTO (salvar_produto_acabado real) apaga e regrava as variantes ⇒ SKUs e manual continuam ligados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("UPDATE public.cores SET sigla_sku = 'vd' WHERE id = $1", [k.corVd]);
      const pa = await novoId(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref, qtd_total) VALUES ($1, 'SKU-T Vestido', 'SKU-PA1', 3) RETURNING id", [T]);
      const rev = await novoId(c, "INSERT INTO public.modelos (tenant_id, nome, ref, origem, tamanho_tipo) VALUES ($1, 'SKU-T Vestido', 'SKU-R1', 'revenda', 'letra') RETURNING id", [T]);
      await c.query("UPDATE public.produtos_acabados SET modelo_id = $1 WHERE id = $2", [rev, pa]);
      const variantes = [
        { ordem: 1, cor_id: k.corAm, cor_apelido_id: k.apeCan, peso: 1, qtd: 1 },
        { ordem: 2, cor_id: k.corVd, cor_apelido_id: null, peso: 2, qtd: 2 },
      ];
      for (const v of variantes) {
        await c.query(
          "INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [T, pa, v.ordem, v.cor_id, v.cor_apelido_id, v.peso, v.qtd]);
      }
      const idsAntes = (await c.query("SELECT id FROM public.produto_acabado_variantes WHERE produto_acabado_id = $1", [pa])).rows.map((x) => x.id);
      await grade(c, rev, 1, { "38|P": 1 });
      await grade(c, rev, 2, { "36|PP": 2 });
      await gerar(c, rev);
      await rpc(c, "salvar_sku_manual", [(await idDe(c, rev, k.kVd, "36|PP")).id, "VD-MAO"]);
      const antes = await skus(c, rev);
      await c.query("SELECT public.salvar_produto_acabado($1::uuid, $2::jsonb, $3::jsonb, NULL::integer)",
        [pa, JSON.stringify({ nome: "SKU-T Vestido", qtd_total: 3 }), JSON.stringify(variantes)]);
      const idsDepois = (await c.query("SELECT id FROM public.produto_acabado_variantes WHERE produto_acabado_id = $1", [pa])).rows.map((x) => x.id);
      expect(idsDepois).toHaveLength(2);
      expect(idsDepois.filter((id) => idsAntes.includes(id))).toEqual([]); // o Salvar regravou (ids novos)
      const r = await gerar(c, rev, true);
      expect([r.criados, r.atualizados, r.removidos, r.conflitos]).toEqual([0, 0, 0, []]);
      expect(await skus(c, rev)).toEqual(antes);
      expect(antes).toEqual([
        { variante_key: k.kAmCan, tamanho_key: "38|P", sku: "SKU-R1-AMCAN-P", manual: false },
        { variante_key: k.kVd, tamanho_key: "36|PP", sku: "VD-MAO", manual: true },
      ]);
      expect(linha(r, k.kVd, "36|PP")).toMatchObject({ estado: "manual", sku: "VD-MAO" });
      expect(linha(r, k.kAmCan, "38|P")).toMatchObject({ estado: "ok" });
    });
  });

  it("importado: variantes do Produto Importado; grade única 'UN' sem sigla ⇒ SKU sem a parte do tamanho (D1)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      const pi = await novoId(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref) VALUES ($1, 'SKU-T Cinto', 'SKU-PI1') RETURNING id", [T]);
      const imp = await modelo(c, "SKU-T Cinto", "SKU-I1", "importado");
      await c.query("UPDATE public.produtos_importados SET modelo_id = $1 WHERE id = $2", [imp, pi]);
      await c.query(
        "INSERT INTO public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id) VALUES ($1, $2, 1, $3)",
        [T, pi, k.corAm]);
      await grade(c, imp, 1, { UN: 5 });
      const r = await gerar(c, imp);
      expect(r.criados).toBe(1);
      expect(await skus(c, imp)).toEqual([{ variante_key: k.kAm, tamanho_key: "UN", sku: "SKU-I1-AM", manual: false }]);
    });
  });

  it("tamanho solto: classificado sozinho (número/letra) e, sem o lado pedido, usa o outro; 'Tamanho em' do card muda o lado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await lojaSku(c, CFG, { "36": "36", PP: "PP", "34": "34", PPP: "PPP" }, ["36", "38", "PP", "P", "34|PPP"]);
      await c.query("UPDATE public.modelo_grades SET grades = '{\"36\": 1, \"PP\": 1, \"34|PPP\": 1}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1", [k.interno]);
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [k.interno]); // F3.6: o card escolhe
      let mz = await matriz(c, k.interno);
      expect(mz.tamanho_tipo).toBe("letra");
      expect(linha(mz, k.kAm, "36").sku_previsto).toBe("SKU-T1-AM-36");
      expect(linha(mz, k.kAm, "PP").sku_previsto).toBe("SKU-T1-AM-PP");
      expect(linha(mz, k.kAm, "34|PPP").sku_previsto).toBe("SKU-T1-AM-PPP");
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1", [k.interno]);
      mz = await matriz(c, k.interno);
      expect(linha(mz, k.kAm, "PP").sku_previsto).toBe("SKU-T1-AM-PP");
      expect(linha(mz, k.kAm, "34|PPP").sku_previsto).toBe("SKU-T1-AM-34");
      expect(linha(mz, k.kAm, "36|PP")).toBeUndefined();
      expect(linha(mz, k.kAm, "34|PPP").estado).toBe("pendente");
    });
  });

  it("salvar_sku_manual (linha gravada): normaliza (D6); vazio, inválido, repetido (outro produto / mesma linha) e rev velho recusados em PT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      const a = await idDe(c, k.interno, k.kAm, "34|PPP");
      const b = await idDe(c, k.interno, k.kAm, "36|PP");
      const q = "SELECT public.salvar_sku_manual($1, $2, $3) AS v";
      expect(await falha(c, q, [a.id, "   ", null])).toEqual({ code: "P0001", message: "Informe o SKU." });
      expect(await falha(c, q, [a.id, "x#1", null])).toEqual({ code: "P0001", message: "SKU inválido: use só letras, números e - . _ /." });
      expect(await falha(c, q, [a.id, " sku-t1-am-36 ", null])).toEqual({ code: "P0001", message: "O SKU SKU-T1-AM-36 já está em outra linha deste produto." });
      const m2 = await modelo(c, "SKU-T Outro", "SKU-T9");
      await c.query("INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, $3, '34|PPP', 'OUTRO-1')", [T, m2, k.kAm]);
      expect(await falha(c, q, [a.id, "OUTRO-1", null])).toEqual({ code: "P0001", message: "O SKU OUTRO-1 já existe em SKU-T Outro (REF SKU-T9). Escolha outro." });
      expect((await falha(c, q, [b.id, "NOVO-36", b.rev + 7])).code).toBe("P0409");
      const ok = (await um<{ v: any }>(c, q, [b.id, "novo 36", b.rev])).v;
      expect(ok).toEqual({ id: b.id, sku: "NOVO36", manual: true, rev: b.rev + 1 });
    });
  });

  it("R3 salvar_sku_manual (linha SEM SKU): cria a linha manual em conflito/falta; fora da grade e sem a linha = erro PT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await tecido1(c, k.mt, [k.vtAmb], 4); // Âmbar (AM) repete o SKU do Amarelo ⇒ linha em conflito, sem SKU
      await grade(c, k.interno, 4, { "34|PPP": 1 });
      await gerar(c, k.interno);
      const q = "SELECT public.salvar_sku_manual(NULL, $1, NULL, $2, $3, $4) AS v";
      const cf = (await um<{ v: any }>(c, q, ["amb-34", k.interno, k.kAmb, "34|PPP"])).v;
      expect(cf).toMatchObject({ sku: "AMB-34", manual: true, rev: 0 });
      const fa = (await um<{ v: any }>(c, q, ["vdm-36", k.interno, k.kVdMus, "36|PP"])).v; // linha com falta de sigla
      expect(fa).toMatchObject({ sku: "VDM-36", manual: true });
      const mz = await matriz(c, k.interno);
      expect(linha(mz, k.kAmb, "34|PPP")).toMatchObject({ id: cf.id, estado: "manual", sku: "AMB-34" });
      expect(linha(mz, k.kVdMus, "36|PP")).toMatchObject({ id: fa.id, estado: "manual", sku: "VDM-36" });
      // a linha JÁ gravada, apontada pela tripla, é atualizada (não duplica)
      const existente = await idDe(c, k.interno, k.kAm, "34|PPP");
      expect((await um<{ v: any }>(c, q, ["AM-X", k.interno, k.kAm, "34|PPP"])).v).toMatchObject({ id: existente.id, sku: "AM-X" });
      expect(await falha(c, q, ["P-38", k.interno, k.kAm, "38|P"]))
        .toEqual({ code: "P0001", message: "Esta variante/tamanho não está na grade do produto." }); // qtd 0
      expect(await falha(c, q, ["P-1", k.interno, null, "34|PPP"]))
        .toEqual({ code: "P0001", message: "Informe a linha do SKU (modelo, variante e tamanho)." });
      expect(await falha(c, q, ["x#1", k.interno, k.kAm, "36|PP"]))
        .toEqual({ code: "P0001", message: "SKU inválido: use só letras, números e - . _ /." });
      expect(await falha(c, q, ["AMB-34", k.interno, k.kAm, "36|PP"]))
        .toEqual({ code: "P0001", message: "O SKU AMB-34 já está em outra linha deste produto." });
      const r = await gerar(c, k.interno, true); // regerar não toca as manuais criadas
      expect(linha(r, k.kAmb, "34|PPP")).toMatchObject({ estado: "manual", sku: "AMB-34" });
      expect(r.conflitos).toEqual([]);
    });
  });
});

// ─────────────────────────────── Task 5 — permissões (spec §4.4) e ACL (invariante #9) ───────────────────────────────
describe.skipIf(!PRONTO)("SKU F3.5a — permissões e ACL", () => {
  it("wrapper: login → módulo → loja → permissão do Planejamento (ver p/ ler, editar p/ gerar/editar)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      const comum = await um<{ id: string; tenant_id: string }>(c,
        `SELECT u.id, u.tenant_id FROM public.users u
          WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'user')
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role <> 'user')
            AND u.tenant_id <> $1
          ORDER BY u.id LIMIT 1`, [T]);
      expect(comum?.id, "a cópia precisa de 1 usuário comum de outra loja").toBeTruthy();
      const q = "SELECT public.gerar_skus_modelo($1, false) AS v";
      const ler = "SELECT public.skus_modelo($1) AS v";
      const criar = "SELECT public.salvar_sku_manual(NULL, 'C-1', NULL, $1, $2, '36|PP') AS v";
      await semUsuario(c);
      expect(await falha(c, q, [k.interno])).toEqual({ code: "42501", message: "Não autenticado." });
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: comum.id, role: "authenticated" })]);
      expect(await falha(c, q, [k.interno])).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      expect(await falha(c, criar, [k.interno, k.kVdMus])).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      expect(await falha(c, q, ["00000000-0000-0000-0000-00000000f35a"])).toEqual({ code: "42501", message: "Sem permissão para este modelo." });
      // O UPDATE de tenant_id do PRÓPRIO usuário comum precisa rodar como super_admin (trigger
      // users_prevent_self_role_change, alheio ao SKU, bloqueia um não-super-admin de mudar o PRÓPRIO
      // tenant_id — "Não é permitido alterar o próprio tenant"). Volta ao super_admin só p/ este setup,
      // depois retoma o JWT do usuário comum. Ordem corrigida por decisão do controlador (T2); nenhuma
      // asserção mudou.
      await comoUsuario(c);
      await c.query("UPDATE public.users SET tenant_id = $1, papel_id = NULL WHERE id = $2", [T, comum.id]);
      await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [comum.id]);
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: comum.id, role: "authenticated" })]);
      expect(await falha(c, ler, [k.interno])).toEqual({ code: "42501", message: "Sem permissão para ver SKUs (Planejamento de Produto)." });
      await c.query("INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'criacao_planejamento', true, false)", [comum.id, T]);
      expect((await um<any>(c, ler, [k.interno])).v.status).toBe("ok");
      expect(await falha(c, q, [k.interno])).toEqual({ code: "42501", message: "Sem permissão para editar SKUs (Planejamento de Produto)." });
      expect(await falha(c, criar, [k.interno, k.kVdMus])).toEqual({ code: "42501", message: "Sem permissão para editar SKUs (Planejamento de Produto)." });
      await c.query("UPDATE public.user_permissions SET pode_editar = true WHERE user_id = $1 AND pagina = 'criacao_planejamento'", [comum.id]);
      expect((await um<any>(c, q, [k.interno])).v.criados).toBe(3);
      const idSku = (await um<{ id: string }>(c, "SELECT id FROM public.modelo_skus WHERE modelo_id = $1 LIMIT 1", [k.interno])).id;
      expect((await um<any>(c, "SELECT public.salvar_sku_manual($1, 'P-1') AS v", [idSku])).v.manual).toBe(true);
      await c.query("UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{\"criacao\": false}'::jsonb WHERE tenant_id = $1", [T]);
      const modOff = { code: "42501", message: "Módulo Estilo & Engenharia não habilitado para esta loja." };
      expect(await falha(c, q, [k.interno])).toEqual(modOff);
      expect(await falha(c, ler, [k.interno])).toEqual(modOff);
      expect(await falha(c, "SELECT public.salvar_sku_manual($1, 'P-2') AS v", [idSku])).toEqual(modOff);
      await comoUsuario(c); // super admin: modelo inexistente = "Modelo não encontrado." (P0001)
      expect(await falha(c, q, ["00000000-0000-0000-0000-00000000f35a"])).toEqual({ code: "P0001", message: "Modelo não encontrado." });
    });
  });

  it("ACL: _core/cálculo/helpers/gatilhos sem EXECUTE p/ PUBLIC, anon e authenticated; RPCs só authenticated; tabela só SELECT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const internas = [
        "_sku_sem_acento(text)", "_sku_norm_sigla(text)", "_sku_norm_ref(text)", "_sku_norm_manual(text)",
        "_sku_variante_key(uuid,uuid)", "_sku_tamanho_lados(text)", "_sku_tamanho_lado(text,text)", "_sku_config_normaliza(jsonb)",
        "_sku_tamanhos_normaliza(jsonb)", "_sku_montar(jsonb,jsonb)", "_sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)",
        "_sku_guarda(uuid,boolean)", "_skus_modelo_calc(uuid)", "_skus_modelo_core(uuid)", "_gerar_skus_modelo_core(uuid,boolean)",
        "_salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)", "fn_sigla_sku_normaliza()", "fn_tenant_config_sku_normaliza()",
        "fn_produto_tamanho_tipo_handover()", "fn_modelo_skus_unico()",
      ];
      const rpcs = ["skus_modelo(uuid)", "gerar_skus_modelo(uuid,boolean)", "salvar_sku_manual(uuid,text,integer,uuid,uuid,text)"];
      expect(internas.length + rpcs.length).toBe(23);
      for (const f of internas) {
        const r = await um<any>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = $1::regprocedure),
                          acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = $1::regprocedure)))) a
                           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico`, [`public.${f}`]);
        expect(r, f).toEqual({ anon: false, auth: false, publico: false });
      }
      for (const f of rpcs) {
        const r = await um<any>(c,
          "SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth", [`public.${f}`]);
        expect(r, f).toEqual({ anon: false, auth: true });
      }
      const t = await um<any>(c, `SELECT has_table_privilege('anon', 'public.modelo_skus', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS anon_qq,
          has_table_privilege('authenticated', 'public.modelo_skus', 'SELECT') AS auth_sel,
          has_table_privilege('authenticated', 'public.modelo_skus', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS auth_esc,
          EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = 'public.modelo_skus'::regclass)) a WHERE a.grantee = 0) AS publico,
          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.modelo_skus'::regclass) AS rls,
          (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'modelo_skus') AS policies,
          (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'modelo_skus' AND permissive = 'RESTRICTIVE'
             AND coalesce(qual, with_check) LIKE '%tenant_module_enabled(''criacao''%') AS modgate`);
      expect(t).toEqual({ anon_qq: false, auth_sel: true, auth_esc: false, publico: false, rls: true, policies: 4, modgate: 3 });
    });
  });

  it("como o PostgREST (ROLE authenticated): RPC funciona; _core e escrita direta na tabela = permission denied; SELECT só da loja", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cenario(c);
      await comoUsuario(c);
      await c.query("INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) SELECT m.tenant_id, m.id, gen_random_uuid(), 'X', 'ALHEIO-1' FROM public.modelos m WHERE m.tenant_id <> $1 LIMIT 1", [T]);
      await c.query("SET LOCAL ROLE authenticated");
      // Tarefa 2 (29/set): a Loja Teste da cópia já tem SKUs de QA de outras frentes (54 hoje) — conta a partir do que existe
      const base = (await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.modelo_skus WHERE tenant_id = $1", [T])).n;
      expect((await um<any>(c, "SELECT public.gerar_skus_modelo($1, false) AS v", [k.interno])).v.criados).toBe(3);
      expect((await falha(c, "SELECT public._gerar_skus_modelo_core($1, true)", [k.interno])).code).toBe("42501");
      expect((await falha(c, "SELECT public._skus_modelo_calc($1)", [k.interno])).code).toBe("42501");
      expect((await falha(c, "INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku) VALUES ($1, $2, gen_random_uuid(), 'X', 'Y')", [T, k.interno])).code).toBe("42501");
      expect((await falha(c, "UPDATE public.modelo_skus SET sku = 'Z' WHERE modelo_id = $1", [k.interno])).code).toBe("42501");
      const vis = await um<{ meus: number; alheios: number }>(c,
        "SELECT count(*) FILTER (WHERE tenant_id = $1)::int AS meus, count(*) FILTER (WHERE tenant_id <> $1)::int AS alheios FROM public.modelo_skus", [T]);
      expect(vis).toEqual({ meus: base + 3, alheios: 0 });
      await c.query("RESET ROLE");
    });
  });
});

// ─────────────────────────────── Task 5 — inverso e idempotência (SÓ no modo SKU_MIG_TXN=1) ───────────────────────────────
describe.skipIf(!PRONTO || !MIG_TXN)("SKU F3.5a — inverso (round-trip) e idempotência", () => {
  const OBJETOS = `SELECT to_regclass('public.modelo_skus') IS NOT NULL AS tabela,
      (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname ~ '^(_sku_|_skus_modelo_|skus_modelo$|gerar_skus_modelo$|_gerar_skus_modelo_core$|salvar_sku_manual$|_salvar_sku_manual_core$|fn_sigla_sku_normaliza$|fn_tenant_config_sku_normaliza$|fn_produto_tamanho_tipo_handover$|fn_modelo_skus_unico$)') AS funcoes,
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
         AND tgname IN ('trg_modelo_skus_unico','trg_cores_sigla_sku','trg_cores_apelido_sigla_sku','trg_pa_tamanho_tipo','trg_pi_tamanho_tipo','trg_tenant_config_sku')) AS gatilhos,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public'
         AND (table_name::text, column_name::text) IN (('cores','sigla_sku'),('cores_apelido','sigla_sku'),('tenant_config','tamanhos_sku'),
           ('tenant_config','sku_config'),('modelos','tamanho_tipo'),('produtos_acabados','tamanho_tipo'),('produtos_importados','tamanho_tipo'))) AS colunas`;

  it("aplicar 2× não dá erro; o inverso RECUSA com dado e sem confirmação; com confirmação apaga TUDO; reaplicar recria igual", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplica(c, MIG); // 2ª aplicação na mesma txn: idempotente
      const cheio = { tabela: true, funcoes: 23, gatilhos: 6, colunas: 7 };
      expect(await um(c, OBJETOS)).toEqual(cheio);
      const k = await cenario(c);
      await comoUsuario(c);
      await gerar(c, k.interno);
      await expect(aplica(c, INV)).rejects.toThrow(/O inverso da F3\.5a APAGA \d+ dado\(s\) digitado\(s\)/);
      expect(await um(c, OBJETOS)).toEqual(cheio); // recusou inteiro (savepoint do harness)
      await c.query("SET LOCAL app.confirmo_apagar_skus = 'sim'");
      await aplica(c, INV);
      expect(await um(c, OBJETOS)).toEqual({ tabela: false, funcoes: 0, gatilhos: 0, colunas: 0 });
      await aplica(c, INV); // inverso idempotente
      await aplica(c, MIG);
      expect(await um(c, OBJETOS)).toEqual(cheio);
    });
  });
});
