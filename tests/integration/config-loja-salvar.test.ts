/**
 * Config da Loja colaborativa — T1 (banco): RPC `salvar_config_loja` (compare-and-set POR COLUNA em tenant_config).
 * supabase/migrations/20261015100000_config_loja_salvar_colab.sql + inverso em supabase/rollback/.
 * Plano: .superpowers/sdd/2026-09-29-config-colab/plan.md (seções "RPC (corpo, em ordem)" e "T1").
 *
 * Tudo em BEGIN…ROLLBACK (withTx) e SÓ na cópia local (exigeBancoLocal): cada teste aplica a migration DENTRO da txn
 * (sem o BEGIN/COMMIT do arquivo — mig-txn.ts — e sem as 2 travas SET LOCAL, cujo transaction_timeout de 3 s derrubaria
 * a conexão do teste). NUNCA `\i` (incidente 15/set). A migration é só CREATE FUNCTION + REVOKE/GRANT: ZERO DDL em
 * tenant_config (incidente 23/set) — conferido por teste de fonte E por pg_locks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, um, comoUsuario, semUsuario, ehBancoLocal, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarSql, exigeBancoLocal, semTransacao } from "./mig-txn";
import { md5UrgASucessor } from "./urg-a-helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261015100000_config_loja_salvar_colab.sql";
const INV = "supabase/rollback/20261015100000_config_loja_salvar_colab_down.sql";
const T = TENANT_TESTE;
const SIG = "public.salvar_config_loja(uuid,jsonb,jsonb,boolean)";
const U_COMUM = "c0f1c0f1-0000-4000-8000-0000000000a1"; // usuário SEM papel admin (criado na txn)
const U_ADMIN = "c0f1c0f1-0000-4000-8000-0000000000a2"; // tenant_admin da Loja Teste (criado na txn)
const FUNCOES_INTOCADAS = [
  "fn_kanban_chave_protegida",
  "fn_kanban_config",
  "fn_tenant_config_sku_normaliza",
  "integracao_salvar",
  "kanban_definir_automatico",
  "salvar_loja",
  "fn_audit",
];
const SO_ASCII = /^[\x20-\x7E]*$/;
// md5 ACEITOS de salvar_config_loja no bloco de concorrência (leves L3 fix round 1, M3): o da release 5 (este arquivo) e os da
// L3 por cima dela (20261027110000 "depois" e 20261027130000 "depois") — todos com o mesmo contrato para keywords/timezone.
// [urg R2 T9] + os sucessores pela cadeia LIFO dos urgentes (20261103174000 acrescenta a coluna insumos_padrao; keywords/timezone
// iguais): md5UrgASucessor, nunca troca o pino.
const SALVAR_CONFIG_ACEITOS = [
  "14dd20b65d6e94c71658abdf11c7969b", // 20261015100000 (release 5)
  "39b44a2e9067a4d45f40fb24af1d61fd", // 20261027110000 (L3)
  ...md5UrgASucessor(SIG, "2d43c259135119b345a09a894091c2b5"), // 20261027130000 (L3) + 20261103174000 (urg R2)
];

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, semTravas(ler(rel), rel), rel);
}
/** Só na cópia; timeouts da txn do teste; aplica a migration na txn. */
async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await aplica(c, MIG);
}

type Erro = { code?: string; message: string; detail?: string };
/** Roda a query num SAVEPOINT; devolve o erro (ou null) e deixa a txn usável. */
async function tenta(c: Client, sql: string, params: any[] = []): Promise<{ erro: Erro | null; rows: any[] }> {
  await c.query("SAVEPOINT t_cfg");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT t_cfg");
    return { erro: null, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT t_cfg");
    return { erro: { code: e.code, message: e.message, detail: e.detail }, rows: [] };
  }
}
const CHAMA = "SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, $4::boolean) AS r";
async function salvar(c: Client, mud: object, base: object, chave: boolean | null = null, tenant: string = T) {
  return tenta(c, CHAMA, [tenant, JSON.stringify(mud), JSON.stringify(base), chave]);
}
async function linha(c: Client, tenant: string = T): Promise<Record<string, any>> {
  return (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id = $1", [tenant])).j;
}
/** Base CRUA do servidor p/ as chaves dadas (o que a tela carregou). */
function baseDe(row: Record<string, any>, chaves: string[]): Record<string, any> {
  return Object.fromEntries(chaves.map((k) => [k, row[k] ?? null]));
}
async function outroFuso(c: Client, atual: string): Promise<string> {
  return (await um<{ n: string }>(
    c,
    `SELECT name AS n FROM pg_timezone_names WHERE name IN ('America/Manaus','America/Belem','America/Recife') AND name <> $1 ORDER BY 1 LIMIT 1`,
    [atual],
  )).n;
}
async function usuarioLoja(c: Client, uid: string, tenantAdmin: boolean): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `Teste cfg ${uid.slice(-2)}`],
  );
  if (tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
/** Liga a chave do kanban na txn (pela porta da GUC, como a RPC oficial) e fecha a porta de novo. */
async function ligaChave(c: Client): Promise<void> {
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  await c.query("UPDATE public.tenant_config SET kanban_automatico = true WHERE tenant_id = $1", [T]);
  await c.query("SELECT set_config('app.kanban_chave', '', true)");
}
async function md5Funcoes(c: Client): Promise<Record<string, string>> {
  const { rows } = await c.query(
    `SELECT proname, md5(string_agg(pg_get_functiondef(oid), E'\\n' ORDER BY oid)) AS m
       FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) GROUP BY proname`,
    [FUNCOES_INTOCADAS],
  );
  return Object.fromEntries(rows.map((r) => [r.proname, r.m]));
}

async function locksTenantConfig(c: Client): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT mode FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'relation'
        AND relation = 'public.tenant_config'::regclass`,
  );
  return rows.map((r) => r.mode as string);
}

// ───────────────────────── fonte (sem banco) ─────────────────────────
describe("config_loja_salvar_colab — fonte da migration e do inverso", () => {
  const mig = ler(MIG);
  const inv = ler(INV);
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

  it("nenhuma DDL em tenant_config (ALTER TABLE/CREATE TRIGGER/CREATE INDEX/POLICY/LOCK) — incidente 23/set", () => {
    for (const [nome, sql] of [[MIG, mig], [INV, inv]] as const) {
      const s = semComentarios(sql);
      expect(s, nome).not.toMatch(/\bALTER\s+TABLE\b/i);
      expect(s, nome).not.toMatch(/\b(CREATE|DROP)\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER\b/i);
      expect(s, nome).not.toMatch(/\b(CREATE|DROP|REINDEX)\s+(UNIQUE\s+)?INDEX\b/i);
      expect(s, nome).not.toMatch(/\b(CREATE|ALTER|DROP)\s+POLICY\b/i);
      expect(s, nome).not.toMatch(/\bLOCK\s+(TABLE\s+)?(public\.)?tenant_config\b/i);
      expect(s, nome).not.toMatch(/\b(TRUNCATE|VACUUM|CLUSTER|COMMENT\s+ON\s+TABLE)\b/i);
      expect(s, nome).not.toMatch(/\bON\s+(public\.)?tenant_config\b/i);
      // tudo o que o arquivo cria/derruba é a própria função
      const ddl = s.match(/\b(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?\w+[^\n;(]*/gi) ?? [];
      for (const d of ddl) expect(d, nome).toMatch(/FUNCTION\s+(IF\s+EXISTS\s+)?public\.salvar_config_loja\b/i);
    }
  });

  it("estrutura: BEGIN/COMMIT únicos, 2 travas SET LOCAL, NOTIFY, idempotente; só a RPC nova", () => {
    expect(() => semTransacao(mig, MIG)).not.toThrow();
    expect(() => semTransacao(inv, INV)).not.toThrow();
    for (const s of [mig, inv]) {
      expect(s).toMatch(/^SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n/m);
      expect(s).toMatch(/NOTIFY pgrst, 'reload schema';\nCOMMIT;\s*$/);
    }
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.salvar_config_loja\(/);
    expect((semComentarios(mig).match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(1);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.salvar_config_loja\(uuid, jsonb, jsonb, boolean\) FROM PUBLIC, anon, service_role;/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.salvar_config_loja\(uuid, jsonb, jsonb, boolean\) TO authenticated;/);
    expect(inv).toMatch(/DROP FUNCTION IF EXISTS public\.salvar_config_loja\(uuid, jsonb, jsonb, boolean\);/);
    // o UPDATE nunca lista as colunas de outros escritores
    const upd = mig.slice(mig.indexOf("UPDATE public.tenant_config SET"), mig.indexOf("RETURNING to_jsonb(tenant_config.*)"));
    expect(upd.length).toBeGreaterThan(100);
    for (const col of ["sku_config", "tamanhos_sku", "kanban_automatico", "modules", "tamanhos_grade", "etapas_acabamento", "confeccao_prioridade"]) {
      expect(upd, col).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(mig).not.toMatch(/\bEXECUTE\s+(format|'|\$)/i); // sem SQL dinâmico
    // trava PRIMEIRO (review M1/M2): o SELECT … FOR UPDATE vem antes do INSERT, que fica dentro do IF v_row IS NULL
    const corpo = semComentarios(mig);
    const iSel = corpo.indexOf("FOR UPDATE");
    const iIf = corpo.indexOf("IF v_row IS NULL THEN");
    const iIns = corpo.indexOf("INSERT INTO public.tenant_config");
    expect(iSel).toBeGreaterThan(0);
    expect(iSel).toBeLessThan(iIf);
    expect(iIf).toBeLessThan(iIns);
    expect(corpo).toMatch(/GET DIAGNOSTICS v_n = ROW_COUNT;\s*IF v_n <> 1/);
    expect(corpo).toMatch(/pg_catalog\.pg_timezone_names/);
  });

  it("mensagens de P0409 só ASCII na fonte", () => {
    const p0409 = [...mig.matchAll(/RAISE EXCEPTION '([^']*)'[^;]*ERRCODE = 'P0409'/g)].map((m) => m[1]);
    expect([...new Set(p0409)].sort()).toEqual(["chave_kanban_mudou: a chave do kanban mudou", "conflito_versao: config_loja"]);
    for (const m of p0409) expect(m).toMatch(SO_ASCII);
  });
});

// ───────────────────────── banco (cópia local) ─────────────────────────
type Persona = { nome: string; entra: (c: Client) => Promise<void> };
const PERSONAS: Persona[] = [
  { nome: "super admin", entra: (c) => comoUsuario(c) },
  {
    nome: "admin da loja (tenant_admin, não super)",
    entra: async (c) => {
      await comoUsuario(c);
      await usuarioLoja(c, U_ADMIN, true);
    },
  },
];

describe.skipIf(!hasDb || !ehBancoLocal())("salvar_config_loja — RPC (cópia local, txn revertida)", () => {
  it("aplicar a migration não pega lock > RowShare em tenant_config; md5 das 7 funções igual; idempotente; inverso derruba", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      const antes = await md5Funcoes(c);
      expect(Object.keys(antes).sort()).toEqual([...FUNCOES_INTOCADAS].sort());
      await aplica(c, MIG); // 1ª coisa que toca o banco nesta txn além do catálogo
      const locks = await locksTenantConfig(c);
      for (const m of locks) expect(["AccessShareLock", "RowShareLock"]).toContain(m);
      expect(await md5Funcoes(c)).toEqual(antes);
      const def1 = (await um<{ d: string }>(c, `SELECT pg_get_functiondef($1::regprocedure) AS d`, [SIG])).d;
      await aplica(c, MIG); // idempotente
      const def2 = (await um<{ d: string }>(c, `SELECT pg_get_functiondef($1::regprocedure) AS d`, [SIG])).d;
      expect(def2).toBe(def1);
      await aplica(c, INV);
      expect((await um<{ r: string | null }>(c, `SELECT to_regprocedure($1) AS r`, [SIG])).r).toBeNull();
      await aplica(c, INV); // idempotente
      expect(await md5Funcoes(c)).toEqual(antes);
    });
  });

  it("ACL: anon/PUBLIC/service_role sem EXECUTE, authenticated com (inv. #9)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const r = await um<{ anon: boolean; pub: boolean; srv: boolean; auth: boolean }>(
        c,
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('public', $1, 'EXECUTE') AS pub,
                has_function_privilege('service_role', $1, 'EXECUTE') AS srv,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`,
        [SIG],
      );
      expect(r).toEqual({ anon: false, pub: false, srv: false, auth: true });
      const d = await um<{ sd: boolean; cfg: string[] }>(c, `SELECT prosecdef AS sd, proconfig AS cfg FROM pg_proc WHERE oid = $1::regprocedure`, [SIG]);
      expect(d.sd).toBe(true);
      expect(d.cfg).toEqual(["search_path=public"]);
    });
  });

  it("locks da RPC em tenant_config durante o Salvar ≤ RowExclusive (nada mais forte), com e sem coluna kanban", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const a = await linha(c);
      const r1 = await salvar(c, { keywords: "locks", tab_labels: { ...(a.tab_labels ?? {}), teste_locks: "x" } }, baseDe(a, ["keywords", "tab_labels"]));
      expect(r1.erro).toBeNull();
      const r2 = await salvar(
        c,
        { kanban_requisitos_excecoes: { teste_locks: ["x"] } },
        baseDe(a, ["kanban_requisitos_excecoes"]),
        a.kanban_automatico,
      );
      expect(r2.erro).toBeNull();
      const locks = await locksTenantConfig(c);
      expect(locks).toContain("RowExclusiveLock");
      for (const m of locks) expect(["AccessShareLock", "RowShareLock", "RowExclusiveLock"]).toContain(m);
    });
  });

  describe.each(PERSONAS)("caminhos principais como $nome", ({ entra }) => {
    it("só a coluna enviada muda (modules/sku_config/tab_labels/keywords/kanban_automatico idênticos); retorno só das gravadas", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await entra(c);
        const antes = await linha(c);
        const novo = await outroFuso(c, antes.timezone);
        const { erro, rows } = await salvar(c, { timezone: novo }, baseDe(antes, ["timezone"]));
        expect(erro).toBeNull();
        expect(rows[0].r).toEqual({ gravadas: ["timezone"], valores: { timezone: novo } });
        const depois = await linha(c);
        expect(depois.timezone).toBe(novo);
        const { timezone: _a, ...restoAntes } = antes;
        const { timezone: _d, ...restoDepois } = depois;
        expect(restoDepois).toEqual(restoAntes);
        for (const k of ["modules", "sku_config", "tamanhos_sku", "tab_labels", "keywords", "kanban_automatico", "campos_editaveis"]) {
          expect(depois[k], k).toEqual(antes[k]);
        }
      });
    });

    it("base velha → P0409 conflito_versao (DETAIL = só a coluna em conflito, ASCII) e NADA gravado", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await entra(c);
        const carregado = await linha(c); // o que a tela carregou
        const outroModo = carregado.modo_oc_rolo === "rolo" ? "oc" : "rolo";
        // outra pessoa salvou modo_oc_rolo depois da carga
        await c.query("UPDATE public.tenant_config SET modo_oc_rolo = $2 WHERE tenant_id = $1", [T, outroModo]);
        const servidor = await linha(c);
        const meuModo = outroModo === "rolo" ? "ambos" : "rolo"; // ≠ o que está no servidor
        const novoFuso = await outroFuso(c, carregado.timezone);
        const { erro } = await salvar(
          c,
          { timezone: novoFuso, modo_oc_rolo: meuModo },
          baseDe(carregado, ["timezone", "modo_oc_rolo"]),
        );
        expect(erro?.code).toBe("P0409");
        expect(erro?.message).toBe("conflito_versao: config_loja");
        expect(erro?.detail).toBe("modo_oc_rolo");
        expect(erro!.message).toMatch(SO_ASCII);
        expect(erro!.detail!).toMatch(SO_ASCII);
        expect(await linha(c)).toEqual(servidor); // nem o fuso (sem conflito) foi gravado
      });
    });

    it("valor convergido (servidor já tem o que eu quero) não é conflito → grava", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await entra(c);
        const carregado = await linha(c);
        const alvo = carregado.modo_oc_rolo === "rolo" ? "oc" : "rolo";
        await c.query("UPDATE public.tenant_config SET modo_oc_rolo = $2 WHERE tenant_id = $1", [T, alvo]);
        const novoFuso = await outroFuso(c, carregado.timezone);
        const { erro, rows } = await salvar(c, { modo_oc_rolo: alvo, timezone: novoFuso }, baseDe(carregado, ["modo_oc_rolo", "timezone"]));
        expect(erro).toBeNull();
        expect(rows[0].r.gravadas).toEqual(["modo_oc_rolo", "timezone"]);
        const d = await linha(c);
        expect([d.modo_oc_rolo, d.timezone]).toEqual([alvo, novoFuso]);
      });
    });

    it("chave fora da lista branca → P0001; base ausente → P0001; payload não-objeto → P0001; nada gravado", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await entra(c);
        const antes = await linha(c);
        for (const k of ["modules", "kanban_automatico", "sku_config", "tamanhos_sku", "tamanhos_grade", "etapas_acabamento", "confeccao_prioridade", "tenant_id", "id"]) {
          const { erro } = await salvar(c, { [k]: antes[k] }, { [k]: antes[k] }, antes.kanban_automatico);
          expect(erro?.code, k).toBe("P0001");
          expect(erro?.message, k).toContain(`"${k}"`);
        }
        const semBase = await salvar(c, { timezone: await outroFuso(c, antes.timezone), keywords: "a" }, { timezone: antes.timezone });
        expect(semBase.erro?.code).toBe("P0001");
        expect(semBase.erro?.message).toContain('"keywords"');
        const naoObj = await tenta(c, CHAMA, [T, "[]", "{}", null]);
        expect(naoObj.erro?.code).toBe("P0001");
        const baseNula = await tenta(c, CHAMA, [T, JSON.stringify({ keywords: "a" }), null, null]);
        expect(baseNula.erro?.code).toBe("P0001");
        expect(await linha(c)).toEqual(antes);
      });
    });

    it("loja errada (≠ loja ativa do chamador) → P0001 'A loja ativa mudou…'; nada gravado em nenhuma das duas", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await entra(c);
        const outra = (await um<{ t: string }>(c, `SELECT tenant_id AS t FROM public.tenant_config WHERE tenant_id <> $1 ORDER BY tenant_id LIMIT 1`, [T])).t;
        const antesT = await linha(c);
        const antesO = await linha(c, outra);
        const { erro } = await salvar(c, { keywords: "invasao" }, { keywords: antesO.keywords }, null, outra);
        expect(erro?.code).toBe("P0001");
        expect(erro?.message).toBe("A loja ativa mudou. Recarregue a página antes de salvar.");
        const nulo = await salvar(c, { keywords: "x" }, { keywords: antesT.keywords }, null, null as any);
        expect(nulo.erro?.code).toBe("P0001");
        expect(await linha(c)).toEqual(antesT);
        expect(await linha(c, outra)).toEqual(antesO);
      });
    });
  });

  it("DETAIL com 2 colunas em conflito vem ordenado e separado por vírgula (ASCII)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const carregado = await linha(c);
      const fusoOutro = await outroFuso(c, carregado.timezone);
      await c.query("UPDATE public.tenant_config SET timezone = $2, markup_analise_faixa = NOT markup_analise_faixa WHERE tenant_id = $1", [T, fusoOutro]);
      const meuFuso = (await um<{ n: string }>(c, `SELECT name AS n FROM pg_timezone_names WHERE name = 'America/Cuiaba'`)).n;
      const { erro } = await salvar(
        c,
        { timezone: meuFuso, markup_analise_faixa: carregado.markup_analise_faixa, keywords: "x" },
        baseDe(carregado, ["timezone", "markup_analise_faixa", "keywords"]),
      );
      expect(erro?.code).toBe("P0409");
      expect(erro?.detail).toBe("markup_analise_faixa,timezone");
      expect(erro!.detail!).toMatch(SO_ASCII);
    });
  });

  it("convergido compara com o valor NORMALIZADO (review M3): ' verao ' contra 'verao' salvo por outro não é conflito", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const carregado = await linha(c);
      await c.query("UPDATE public.tenant_config SET keywords = 'verao' WHERE tenant_id = $1", [T]);
      const ok = await salvar(c, { keywords: "  verao  " }, baseDe(carregado, ["keywords"]));
      expect(ok.erro).toBeNull();
      expect(ok.rows[0].r.valores).toEqual({ keywords: "verao" });
      // só espaços converge com NULL
      await c.query("UPDATE public.tenant_config SET keywords = NULL WHERE tenant_id = $1", [T]);
      const vazio = await salvar(c, { keywords: "   " }, { keywords: "outra coisa" });
      expect(vazio.erro).toBeNull();
      expect(vazio.rows[0].r.valores).toEqual({ keywords: null });
      // valor realmente diferente continua conflito
      await c.query("UPDATE public.tenant_config SET keywords = 'inverno' WHERE tenant_id = $1", [T]);
      const conf = await salvar(c, { keywords: " verao " }, { keywords: "verao" });
      expect(conf.erro?.code).toBe("P0409");
      expect(conf.erro?.detail).toBe("keywords");
    });
  });

  it("sem papel admin → 42501; sem usuário → 42501; tenant_admin da loja passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const antes = await linha(c);
      await usuarioLoja(c, U_COMUM, false);
      const comum = await salvar(c, { keywords: "x" }, { keywords: antes.keywords });
      expect(comum.erro?.code).toBe("42501");
      expect(comum.erro?.message).toBe("Apenas o administrador da loja pode salvar a Configuração da Loja.");
      await semUsuario(c);
      const anon = await salvar(c, { keywords: "x" }, { keywords: antes.keywords });
      expect(anon.erro?.code).toBe("42501");
      expect(await linha(c)).toEqual(antes);
      await usuarioLoja(c, U_ADMIN, true);
      const adm = await salvar(c, { keywords: "  do admin  " }, { keywords: antes.keywords });
      expect(adm.erro).toBeNull();
      expect(adm.rows[0].r.valores).toEqual({ keywords: "do admin" });
    });
  });

  it("loja INATIVA (sentinela nil) → 42501 'Loja inativa…' para o admin da loja; nada gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const antes = await linha(c);
      await c.query("UPDATE public.tenants SET ativo = false WHERE id = $1", [T]);
      await usuarioLoja(c, U_ADMIN, true);
      expect((await um<{ t: string }>(c, "SELECT public.get_user_tenant_id()::text AS t")).t).toBe("00000000-0000-0000-0000-000000000000");
      const { erro } = await salvar(c, { keywords: "x" }, { keywords: antes.keywords });
      expect(erro?.code).toBe("42501");
      expect(erro?.message).toBe("Loja inativa ou sem loja — operação não permitida.");
      expect(await linha(c)).toEqual(antes);
    });
  });

  it("chave LIGADA + requisito mudou → snapshot 'config' + recálculo EFETIVO na MESMA txn (cards movidos + histórico 'config')", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      await ligaChave(c);
      const elegiveis = (await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM public.modelos m WHERE m.tenant_id = $1
            AND coalesce(m.ordem_criacao_enviada, false) AND NOT coalesce(m.lancado, false)`,
        [T],
      )).n;
      expect(elegiveis).toBeGreaterThan(0);
      const antes = await linha(c);
      expect(antes.kanban_automatico).toBe(true);
      const conta = async (sql: string) => (await um<{ n: number }>(c, sql, [T])).n;
      const nSnap0 = await conta(`SELECT count(*)::int AS n FROM public.kanban_snapshot WHERE tenant_id = $1 AND motivo = 'config'`);
      const nHist0 = await conta(`SELECT count(*)::int AS n FROM public.modelo_kanban_historico WHERE tenant_id = $1 AND origem = 'config'`);
      await c.query(`CREATE TEMP TABLE t1_status_antes ON COMMIT DROP AS SELECT id, status_desenvolvimento AS s FROM public.modelos WHERE tenant_id = '${T}'`);
      // Endurece os requisitos: toda coluna automática (exceto a de entrada) passa a exigir 'grade_cortada_lancada',
      // que nenhum modelo da Loja Teste satisfaz → cards derivados além da entrada recuam.
      const req = antes.kanban_requisitos as Record<string, string[]>;
      const novoReq = Object.fromEntries(
        Object.entries(req).map(([k, v]) => [k, k === "desenho_tecnico" ? v : [...v, "grade_cortada_lancada"]]),
      );
      const { erro, rows } = await salvar(c, { kanban_requisitos: novoReq }, baseDe(antes, ["kanban_requisitos"]), true);
      expect(erro).toBeNull();
      expect(rows[0].r.valores.kanban_requisitos).toEqual(novoReq);
      const nSnap1 = await conta(`SELECT count(*)::int AS n FROM public.kanban_snapshot WHERE tenant_id = $1 AND motivo = 'config'`);
      expect(nSnap1 - nSnap0).toBe(elegiveis);
      const movidos = (await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM public.modelos m JOIN t1_status_antes a ON a.id = m.id
          WHERE m.status_desenvolvimento IS DISTINCT FROM a.s`,
      )).n;
      expect(movidos, "a mudança de requisito deveria mover cards na Loja Teste da cópia").toBeGreaterThan(0);
      const nHist1 = await conta(`SELECT count(*)::int AS n FROM public.modelo_kanban_historico WHERE tenant_id = $1 AND origem = 'config'`);
      expect(nHist1 - nHist0).toBe(movidos);
      expect((await linha(c)).kanban_automatico).toBe(true); // a RPC nunca mexe na chave
    });
  });

  it("_chave_kanban_esperada errada → P0409 chave_kanban_mudou (ASCII); ausente → P0001; coluna não-kanban dispensa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const antes = await linha(c);
      const chave = antes.kanban_automatico as boolean;
      const mud = { kanban_requisitos_excecoes: { teste_colab: ["x"] } };
      const base = baseDe(antes, ["kanban_requisitos_excecoes"]);
      const errada = await salvar(c, mud, base, !chave);
      expect(errada.erro?.code).toBe("P0409");
      expect(errada.erro?.message).toBe("chave_kanban_mudou: a chave do kanban mudou");
      expect(errada.erro!.message).toMatch(SO_ASCII);
      const ausente = await salvar(c, mud, base, null);
      expect(ausente.erro?.code).toBe("P0001");
      expect(await linha(c)).toEqual(antes);
      const certa = await salvar(c, mud, base, chave);
      expect(certa.erro).toBeNull();
      const kw = await salvar(c, { keywords: "sem chave" }, { keywords: antes.keywords }, null);
      expect(kw.erro).toBeNull();
    });
  });

  it("JSON null → SQL NULL (ref_config, leadtime, pcp_etapas); keywords só espaços → NULL; texto nullable aceita null", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const a = await linha(c);
      const r1 = await salvar(c, { ref_config: { partes: ["grupo"] } }, baseDe(a, ["ref_config"]));
      expect(r1.erro).toBeNull();
      const b = await linha(c);
      const r2 = await salvar(
        c,
        { ref_config: null, leadtime: null, pcp_etapas: null, keywords: "   ", explosao_envio_status: null },
        baseDe(b, ["ref_config", "leadtime", "pcp_etapas", "keywords", "explosao_envio_status"]),
      );
      expect(r2.erro).toBeNull();
      const sql = await um<Record<string, boolean>>(
        c,
        `SELECT ref_config IS NULL AS ref_config, leadtime IS NULL AS leadtime, pcp_etapas IS NULL AS pcp_etapas,
                keywords IS NULL AS keywords, explosao_envio_status IS NULL AS explosao
           FROM public.tenant_config WHERE tenant_id = $1`,
        [T],
      );
      expect(sql).toEqual({ ref_config: true, leadtime: true, pcp_etapas: true, keywords: true, explosao: true });
    });
  });

  it("validação → P0001 PT: modo_oc_rolo/modo_baixa/timezone inválidos, NOT NULL com null, tipo JSON errado; nada gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const a = await linha(c);
      const chave = a.kanban_automatico as boolean;
      const casos: [Record<string, unknown>, string][] = [
        [{ modo_oc_rolo: "caixa" }, "Modo de OC/rolo inválido"],
        [{ modo_oc_rolo: null }, "Modo de OC/rolo inválido"],
        [{ modo_baixa_estoque: "manual" }, "Modo de baixa de estoque inválido"],
        [{ timezone: "Marte/Olympus" }, "Fuso horário inválido"],
        [{ timezone: null }, "Fuso horário inválido"],
        [{ timezone: 3 }, "Fuso horário inválido"],
        [{ tab_labels: null }, "não pode ficar vazio"],
        [{ campos_editaveis: null }, "não pode ficar vazio"],
        [{ revenda_campos: [] }, "Formato inválido"],
        [{ revenda_kanban_colunas: null }, "não pode ficar vazio"],
        [{ revenda_kanban_colunas: {} }, "Formato inválido"],
        [{ kanban_requisitos: null }, "não pode ficar vazio"],
        [{ status_kanban: {} }, "Formato inválido"],
        [{ markup_analise_faixa: "sim" }, "verdadeiro ou falso"],
        [{ markup_analise_faixa: null }, "verdadeiro ou falso"],
        [{ ref_config: [] }, "Formato inválido"],
        [{ pcp_etapas: {} }, "Formato inválido"],
        [{ keywords: 12 }, "Formato inválido"],
        [{ ref_exibir_status: true }, "Formato inválido"],
      ];
      for (const [mud, trecho] of casos) {
        const { erro } = await salvar(c, mud, Object.fromEntries(Object.keys(mud).map((k) => [k, a[k] ?? null])), chave);
        expect(erro?.code, JSON.stringify(mud)).toBe("P0001");
        expect(erro?.message, JSON.stringify(mud)).toContain(trecho);
      }
      expect(await linha(c)).toEqual(a);
    });
  });

  it("loja SEM linha: nasce com os defaults e grava (sem compare-and-set); _mudancas vazio não cria nada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      await c.query("DELETE FROM public.tenant_config WHERE tenant_id = $1", [T]);
      const vazio = await salvar(c, {}, {});
      expect(vazio.erro).toBeNull();
      expect(vazio.rows[0].r).toEqual({ gravadas: [], valores: {} });
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.tenant_config WHERE tenant_id = $1`, [T])).n).toBe(0);
      const { erro, rows } = await salvar(c, { keywords: "nova", modo_oc_rolo: "rolo" }, { keywords: null, modo_oc_rolo: null });
      expect(erro).toBeNull();
      expect(rows[0].r.gravadas).toEqual(["keywords", "modo_oc_rolo"]);
      const d = await linha(c);
      expect([d.keywords, d.modo_oc_rolo, d.kanban_automatico, d.timezone]).toEqual(["nova", "rolo", false, "America/Sao_Paulo"]);
    });
  });

  it("Nomenclaturas (P-123 A): tab_labels/campos_editaveis gravam com compare-and-set como as demais", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const a = await linha(c);
      const tl = { ...(a.tab_labels ?? {}), teste_colab: "Aba Colab" };
      const ok = await salvar(c, { tab_labels: tl }, baseDe(a, ["tab_labels"]));
      expect(ok.erro).toBeNull();
      expect((await linha(c)).tab_labels).toEqual(tl);
      const conf = await salvar(c, { tab_labels: { ...tl, teste_colab: "Outro" } }, baseDe(a, ["tab_labels"]));
      expect(conf.erro?.code).toBe("P0409");
      expect(conf.erro?.detail).toBe("tab_labels");
    });
  });
});

// ───────────────── concorrência: 2 conexões, COMMIT REAL na cópia (restaurado no fim) ─────────────────
// A 1ª conexão salva e segura a linha (FOR UPDATE); a 2ª espera; quando a 1ª dá COMMIT, a 2ª relê a versão nova:
// mesma coluna → P0409; coluna diferente → grava. Precisa da função visível às 2 conexões: usa a função VIVA da cópia, que tem
// de existir com um md5 ACEITO (SALVAR_CONFIG_ACEITOS) — senão FALHA ("aplique a migration antes"). [leves L3 fix round 1, M3]
// NUNCA aplica migration aqui: a aplicação DE VERDADE (COMMIT na cópia compartilhada) derrubava em silêncio quem redefine a
// função por cima (a L3), porque a ida da release 5 não tem guarda de md5. Os valores de keywords são restaurados e as linhas
// de audit_log criadas aqui (marcador 'conc-t1-') são apagadas. SÓ na cópia local (exigeBancoLocal).
describe.skipIf(!hasDb || !ehBancoLocal())("salvar_config_loja — concorrência real (2 conexões, cópia local)", () => {
  const MARCA = "conc-t1-";
  let admin: Client;
  let orig: { id: string; keywords: string | null; timezone: string };

  async function conectar(): Promise<Client> {
    exigeBancoLocal();
    const c = new Client({ connectionString: dbUrl()!, ssl: false });
    await c.connect();
    return c;
  }
  async function abre(c: Client): Promise<number> {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '15s'");
    await c.query("SET LOCAL statement_timeout = '30s'");
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_TESTE, role: "authenticated" })]);
    return (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
  }
  async function esperaBloqueada(pid: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const r = await um<{ n: number }>(admin, "SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND NOT granted", [pid]);
      if (r.n > 0) return;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error("a 2ª conexão não ficou esperando o lock da 1ª");
  }
  async function fecha(...cs: Client[]): Promise<void> {
    for (const c of cs) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      await c.end();
    }
  }
  const chamar = (c: Client, mud: object, base: object) =>
    c.query(CHAMA, [T, JSON.stringify(mud), JSON.stringify(base), null]).then(
      (r) => ({ r: r.rows[0].r, erro: null as any }),
      (e) => ({ r: null, erro: e }),
    );

  beforeAll(async () => {
    admin = await conectar();
    const u = await um<{ t: string }>(admin, "SELECT tenant_id::text AS t FROM public.users WHERE id = $1", [USER_TESTE]);
    if (u.t !== T) throw new Error(`USER_TESTE precisa estar na Loja Teste na cópia (está em ${u.t}) — o teste não grava users`);
    orig = await um(admin, "SELECT id, keywords, timezone FROM public.tenant_config WHERE tenant_id = $1", [T]);
    if ((orig.keywords ?? "").startsWith(MARCA)) throw new Error("keywords da Loja Teste já têm o marcador de uma rodada anterior interrompida");
    // N3 (re-review): SEMPRE reaplica a versão DESTE arquivo (uma função velha já na cópia não pode mascarar o teste);
    // o inverso no fim só roda se esta rodada é que criou a função (se ela já existia, fica — na versão deste arquivo).
    const vivo = (await um<{ m: string | null }>(admin,
      "SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure($1))) END AS m", [SIG])).m;
    if (!vivo || !SALVAR_CONFIG_ACEITOS.includes(vivo)) {
      throw new Error(`salvar_config_loja ausente ou com texto não aceito na cópia (md5 ${vivo ?? "ausente"}) — aplique a migration antes (o teste nunca aplica)`);
    }
  });

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin.query(
        `UPDATE public.tenant_config SET keywords = $2, timezone = $3
          WHERE tenant_id = $1 AND (keywords IS DISTINCT FROM $2 OR timezone IS DISTINCT FROM $3)`,
        [T, orig.keywords, orig.timezone],
      );
      await admin.query(
        `DELETE FROM public.audit_log WHERE tabela = 'tenant_config' AND registro_id = $1 AND dados::text LIKE $2`,
        [orig.id, `%${MARCA}%`],
      );
    } finally {
      await admin.end();
    }
  });

  it("mesma coluna: a 2ª espera a 1ª e, depois do COMMIT, recebe P0409 (keywords); nada dela gravado", async () => {
    const a = await conectar();
    const b = await conectar();
    try {
      await abre(a);
      const pidB = await abre(b);
      const atual = await um<{ keywords: string | null }>(admin, "SELECT keywords FROM public.tenant_config WHERE tenant_id = $1", [T]);
      const base = { keywords: atual.keywords };
      const ra = await chamar(a, { keywords: `${MARCA}A` }, base);
      expect(ra.erro).toBeNull();
      const pb = chamar(b, { keywords: `${MARCA}B` }, base);
      await esperaBloqueada(pidB);
      await a.query("COMMIT");
      const rb = await pb;
      expect(rb.erro?.code).toBe("P0409");
      expect(rb.erro?.message).toBe("conflito_versao: config_loja");
      expect(rb.erro?.detail).toBe("keywords");
      await b.query("ROLLBACK");
      const fim = await um<{ keywords: string }>(admin, "SELECT keywords FROM public.tenant_config WHERE tenant_id = $1", [T]);
      expect(fim.keywords).toBe(`${MARCA}A`);
    } finally {
      await fecha(a, b);
    }
  });

  it("colunas diferentes: a 2ª espera e depois grava a dela sem apagar a da 1ª", async () => {
    const a = await conectar();
    const b = await conectar();
    try {
      await abre(a);
      const pidB = await abre(b);
      const atual = await um<{ keywords: string | null; timezone: string }>(
        admin,
        "SELECT keywords, timezone FROM public.tenant_config WHERE tenant_id = $1",
        [T],
      );
      const ra = await chamar(a, { keywords: `${MARCA}A2` }, { keywords: atual.keywords });
      expect(ra.erro).toBeNull();
      const fuso = atual.timezone === "America/Manaus" ? "America/Belem" : "America/Manaus";
      const pb = chamar(b, { timezone: fuso }, { timezone: atual.timezone });
      await esperaBloqueada(pidB);
      await a.query("COMMIT");
      const rb = await pb;
      expect(rb.erro).toBeNull();
      // L3 (P-211 A): com a L3 viva a resposta ganha `refs_reveladas` (0 aqui) — o resto do contrato é o mesmo.
      expect({ gravadas: rb.r.gravadas, valores: rb.r.valores }).toEqual({ gravadas: ["timezone"], valores: { timezone: fuso } });
      expect(rb.r.refs_reveladas ?? 0).toBe(0);
      const visto = await um<{ keywords: string; timezone: string }>(b, "SELECT keywords, timezone FROM public.tenant_config WHERE tenant_id = $1", [T]);
      expect(visto).toEqual({ keywords: `${MARCA}A2`, timezone: fuso }); // a da 1ª ficou
      await b.query("ROLLBACK"); // a 2ª não precisa gravar de verdade
    } finally {
      await fecha(a, b);
    }
  });
});
