/**
 * Paridade PA/PI (Task 3, nov/2026): "Criar card" RECUSA materializar produto com `status='reprovado'`
 * (`_criar_card_produto_acabado_core` / `_criar_card_produto_importado_core`: P0001 `produto_reprovado_sem_card: <nome>`, ASCII).
 * Pendente/NULL criam o card normalmente; produto que ja tem card segue na regra antiga ("ja tem card").
 * Migration: supabase/migrations/20261118120000_criar_card_gate_reprovado.sql (inverso em supabase/rollback/).
 *
 * Os blocos de banco SO rodam na COPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres), com a
 * migration JA aplicada (psql -f). Cada teste em BEGIN...ROLLBACK. Nenhum arquivo de migration e aplicado dentro de txn aqui.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261118120000_criar_card_gate_reprovado.sql";
const INV = "supabase/rollback/20261118120000_criar_card_gate_reprovado_down.sql";
const SIG_PA = "public._criar_card_produto_acabado_core(uuid)";
const SIG_PI = "public._criar_card_produto_importado_core(uuid)";
const MD5_PA_ANTES = "0241f96d9261bbaab4de9ebd34941831";
const MD5_PI_ANTES = "cf5ec1d5aa8841580190d0bd3608ab4a";
const SUCESSOR_LINHA: Record<string, string> = {
  _criar_card_produto_acabado_core: "2bb5b74a8e2b4130d426310d62069d82",
  _criar_card_produto_importado_core: "e12562cee2e7530c4d7256213e7d4926",
};
const T = TENANT_TESTE;
const LOCAL = hasDb && ehBancoLocal();

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** Texto de UMA funcao no arquivo: de "CREATE OR REPLACE FUNCTION <nome>(" ate o 2o "$function$". */
function corpo(rel: string, nome: string): string {
  const t = ler(rel);
  const inicio = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = t.indexOf(inicio);
  expect(i, `${rel}: ${nome} ausente`).toBeGreaterThanOrEqual(0);
  expect(t.indexOf(inicio, i + 1), `${rel}: ${nome} 2x`).toBe(-1);
  const a = t.indexOf("$function$", i);
  const f = t.indexOf("$function$", a + 10);
  return t.slice(i, f + 10);
}

// --------------------------------- estatico (sem banco) ---------------------------------
describe("criar card gate reprovado — arquivos (estatico)", () => {
  it("ida: guarda aceita ANTES e DEPOIS dos 2; REVOKE dos 3; gate com prefixo ASCII exato nos 2 corpos", () => {
    const m = ler(MIG);
    expect(m).toContain(MD5_PA_ANTES);
    expect(m).toContain(MD5_PI_ANTES);
    for (const f of ["acabado", "importado"]) {
      expect(m).toContain(`REVOKE EXECUTE ON FUNCTION public._criar_card_produto_${f}_core(uuid) FROM PUBLIC, anon, authenticated;`);
      const c = corpo(MIG, `_criar_card_produto_${f}_core`);
      expect(c).toContain("if coalesce(p.status, '') = 'reprovado' then");
      expect(c).toContain("raise exception 'produto_reprovado_sem_card: %', coalesce(p.nome, '') using errcode = 'P0001';");
      // o gate vem DEPOIS de ler o produto e da checagem "ja tem card"
      expect(c.indexOf("for update")).toBeLessThan(c.indexOf("produto_reprovado_sem_card"));
      expect(c.indexOf("já tem card")).toBeLessThan(c.indexOf("produto_reprovado_sem_card"));
    }
    // a mensagem NOVA e ASCII
    expect(/^[\x20-\x7e]*$/.test("produto_reprovado_sem_card: ")).toBe(true);
  });

  it("inverso: devolve os 2 corpos de ANTES (md5) sem o gate; guarda md5 do NOVO", () => {
    const v = ler(INV);
    const pa = corpo(INV, "_criar_card_produto_acabado_core");
    const pi = corpo(INV, "_criar_card_produto_importado_core");
    expect(md5(pa + "\n")).toBe(MD5_PA_ANTES);
    expect(md5(pi + "\n")).toBe(MD5_PI_ANTES);
    expect(pa).not.toContain("produto_reprovado_sem_card");
    expect(pi).not.toContain("produto_reprovado_sem_card");
    // a guarda do inverso aceita o corpo da ida
    const ida = ler(MIG);
    for (const [nome, ant] of [["acabado", MD5_PA_ANTES], ["importado", MD5_PI_ANTES]] as const) {
      expect(v).toContain(md5(corpo(MIG, `_criar_card_produto_${nome}_core`) + "\n"));
      expect(v).toContain(ant);
    }
    expect(ida).toContain(md5(corpo(MIG, "_criar_card_produto_acabado_core") + "\n"));
    expect(v).toContain("REVOKE EXECUTE ON FUNCTION public._criar_card_produto_acabado_core(uuid) FROM PUBLIC, anon, authenticated;");
    expect(v).toContain("REVOKE EXECUTE ON FUNCTION public._criar_card_produto_importado_core(uuid) FROM PUBLIC, anon, authenticated;");
  });
});

// --------------------------------- banco (copia local, migration aplicada) ---------------------------------
type Ids = { grupo: string; cat: string };
async function ids(c: Client): Promise<Ids> {
  const r = await um<any>(c, `
    SELECT (SELECT id FROM public.grupos_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS grupo,
           (SELECT id FROM public.categorias_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS cat`, [T]);
  expect(r.grupo && r.cat, "a copia precisa de 1 grupo e 1 categoria de produto na Loja Teste").toBeTruthy();
  return { grupo: r.grupo, cat: r.cat };
}
const dadosDe = (k: Ids, nome: string, o: Record<string, unknown> = {}) => ({
  nome, grupo_id: k.grupo, categoria_id: k.cat, qtd_total: 0, ...o,
});
const salvarPa = (c: Client, dados: Record<string, unknown>) =>
  um<{ id: string }>(c, "SELECT public._salvar_produto_acabado_core(NULL::uuid, $1::jsonb, '[]'::jsonb) AS id", [JSON.stringify(dados)]);
const salvarPi = (c: Client, dados: Record<string, unknown>) =>
  um<{ id: string }>(c, "SELECT public._salvar_produto_importado_core(NULL::uuid, $1::jsonb, '[]'::jsonb, '[]'::jsonb) AS id", [JSON.stringify(dados)]);
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT gate_f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT gate_f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT gate_f");
    return `${e.code} ${e.message}`;
  }
}
async function prepara(c: Client): Promise<Ids> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  await comoUsuario(c);
  return ids(c);
}
const modeloDe = async (c: Client, tabela: string, pid: string) =>
  (await um<{ m: string | null }>(c, `SELECT modelo_id AS m FROM public.${tabela} WHERE id = $1`, [pid])).m;

describe.skipIf(!LOCAL)("criar card gate reprovado — banco (copia local)", () => {
  it("migration aplicada: md5 vivo dos 2 difere do de antes e bate com o arquivo; EXECUTE negado a PUBLIC/anon/authenticated (inv. #9)", async () => {
    await withTx(async (c) => {
      for (const [sig, ant, nome] of [[SIG_PA, MD5_PA_ANTES, "_criar_card_produto_acabado_core"], [SIG_PI, MD5_PI_ANTES, "_criar_card_produto_importado_core"]] as const) {
        const r = await um<any>(c, `SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m,
            has_function_privilege('public', to_regprocedure($1), 'EXECUTE') AS p,
            has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS a,
            has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS u`, [sig]);
        expect(r.m, nome).not.toBe(ant);
        // o texto desta migration OU o sucessor do complemento "Linha no produto" (20261118130000: card herda produto.linha_id)
        expect([md5(corpo(MIG, nome) + "\n"), SUCESSOR_LINHA[nome]], nome).toContain(r.m);
        expect({ ...r, m: undefined }, nome).toEqual({ m: undefined, p: false, a: false, u: false });
      }
    });
  });

  it("PA: produto SEM card com status='reprovado' -> criar_cards_produto_acabado da P0001 produto_reprovado_sem_card; nada e criado", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pid = (await salvarPa(c, dadosDe(k, "GATE Vestido PA", { status: "reprovado" }))).id;
      const r = await falha(c, "SELECT public.criar_cards_produto_acabado(ARRAY[$1]::uuid[])", [pid]);
      expect(r).toMatch(/^P0001 produto_reprovado_sem_card: GATE Vestido PA/);
      expect(await modeloDe(c, "produtos_acabados", pid)).toBeNull();
      // o caminho de 1 produto (wrapper e core) tambem recusa
      expect(await falha(c, "SELECT public.criar_card_produto_acabado($1)", [pid])).toMatch(/^P0001 produto_reprovado_sem_card:/);
      expect(await falha(c, "SELECT public._criar_card_produto_acabado_core($1)", [pid])).toMatch(/^P0001 produto_reprovado_sem_card:/);
    });
  });

  it("PA: status='pendente' e status NULL criam o card normalmente; voltar de reprovado a pendente destrava", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pend = (await salvarPa(c, dadosDe(k, "GATE PA pendente", { status: "pendente" }))).id;
      const nulo = (await salvarPa(c, dadosDe(k, "GATE PA nulo"))).id;
      const rep = (await salvarPa(c, dadosDe(k, "GATE PA reprovado", { status: "reprovado" }))).id;
      const out = (await um<{ j: any[] }>(c, "SELECT public.criar_cards_produto_acabado(ARRAY[$1,$2]::uuid[]) AS j", [pend, nulo])).j;
      expect(out.map((o) => o.produto_id).sort()).toEqual([pend, nulo].sort());
      expect(await modeloDe(c, "produtos_acabados", pend)).toBeTruthy();
      expect(await modeloDe(c, "produtos_acabados", nulo)).toBeTruthy();
      // reprovado -> pendente: cria
      await c.query("UPDATE public.produtos_acabados SET status = 'pendente' WHERE id = $1", [rep]);
      await c.query("SELECT public.criar_cards_produto_acabado(ARRAY[$1]::uuid[])", [rep]);
      expect(await modeloDe(c, "produtos_acabados", rep)).toBeTruthy();
    });
  });

  it("PA: produto que JA tem card segue na regra antiga ('ja tem card'), mesmo com status reprovado gravado", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pid = (await salvarPa(c, dadosDe(k, "GATE PA com card"))).id;
      await c.query("SELECT public._criar_card_produto_acabado_core($1)", [pid]);
      await c.query("UPDATE public.produtos_acabados SET status = 'reprovado' WHERE id = $1", [pid]);
      const r = await falha(c, "SELECT public._criar_card_produto_acabado_core($1)", [pid]);
      expect(r).toMatch(/^P0001 Este produto já tem card/);
    });
  });

  it("PI: produto SEM card com status='reprovado' -> criar_cards_produto_importado da P0001 produto_reprovado_sem_card; nada e criado", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pid = (await salvarPi(c, dadosDe(k, "GATE Blusa PI", { status: "reprovado" }))).id;
      const r = await falha(c, "SELECT public.criar_cards_produto_importado(ARRAY[$1]::uuid[])", [pid]);
      expect(r).toMatch(/^P0001 produto_reprovado_sem_card: GATE Blusa PI/);
      expect(await modeloDe(c, "produtos_importados", pid)).toBeNull();
      expect(await falha(c, "SELECT public.criar_card_produto_importado($1)", [pid])).toMatch(/^P0001 produto_reprovado_sem_card:/);
      expect(await falha(c, "SELECT public._criar_card_produto_importado_core($1)", [pid])).toMatch(/^P0001 produto_reprovado_sem_card:/);
    });
  });

  it("PI: status='pendente' e status NULL criam o card normalmente; voltar de reprovado a pendente destrava", async () => {
    await withTx(async (c) => {
      const k = await prepara(c);
      const pend = (await salvarPi(c, dadosDe(k, "GATE PI pendente", { status: "pendente" }))).id;
      const nulo = (await salvarPi(c, dadosDe(k, "GATE PI nulo"))).id;
      const rep = (await salvarPi(c, dadosDe(k, "GATE PI reprovado", { status: "reprovado" }))).id;
      const out = (await um<{ j: any[] }>(c, "SELECT public.criar_cards_produto_importado(ARRAY[$1,$2]::uuid[]) AS j", [pend, nulo])).j;
      expect(out.map((o) => o.produto_id).sort()).toEqual([pend, nulo].sort());
      expect(await modeloDe(c, "produtos_importados", pend)).toBeTruthy();
      expect(await modeloDe(c, "produtos_importados", nulo)).toBeTruthy();
      await c.query("UPDATE public.produtos_importados SET status = 'pendente' WHERE id = $1", [rep]);
      await c.query("SELECT public.criar_cards_produto_importado(ARRAY[$1]::uuid[])", [rep]);
      expect(await modeloDe(c, "produtos_importados", rep)).toBeTruthy();
    });
  });
});
