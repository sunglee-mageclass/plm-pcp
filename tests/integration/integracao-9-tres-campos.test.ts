/**
 * Release I3 — Integração com 3 campos NÃO obrigatórios (Coleção, Categoria do Tecido Principal, Linha) + Categoria do tecido /
 * Material do aviamento nos produtos PA/PI. Plano .superpowers/sdd/2026-10-02-integracao-3-campos/plan.md (T3; RULINGS no fim).
 * Migrations 20261030100000 (I3a), 20261030110000 (I3b), 20261030120000 (I3c, correção única) — GERADAS por
 * .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs.
 * SÓ na cópia local (exigeBancoLocal); txn revertida (withTx): NADA é gravado. Funciona com a cópia NOS DOIS estados: sem a I3
 * (`prepara9` aplica os 3 arquivos DENTRO da txn — sem BEGIN/COMMIT e sem as 2 travas SET LOCAL, NUNCA `\i`) ou com ela já
 * aplicada (só confere). A I3a pega AccessExclusive nos 2 produtos e a I3c LOCK EXCLUSIVE na Integração até o fim de cada teste.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { exigeBancoLocal } from "./mig-txn";
import {
  CAMPOS_PADRAO, CAMPOS_PADRAO_I3, I3A_TENANT_DEPOIS, I3A_TENANT_NEUTRA, I3B_RETRATO_DEPOIS, I3_SUCESSOR, INV_I3A, INV_I3B, INV_I3C,
  LAYOUT_I3, LOCAL, MARCAS, MIG_I3A, MIG_I3B, MIG_I3C, T, U, aplica, aplicaI3, i3aViva, i3bViva, keywordsLoja, ler, modeloInterno,
  revenda, importado, voltaI3SePreciso,
} from "./integracao-helpers";

const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");
const OUTRA_LOJA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // Ave Rara (existe na cópia)
const ARQS_IDA = [MIG_I3A, MIG_I3B, MIG_I3C];
const ARQS_VOLTA = [INV_I3C, INV_I3B, INV_I3A];
const DROPS = [
  "supabase/rollback/20261030100000_produto_categoria_tecido_material_down_drop.sql",
  "supabase/rollback/20261030110000_integracao_3_campos_down_drop.sql",
];

/** As guardas do $guarda$ do arquivo: redefinidas [fn, antes, depois]. */
function guardas(rel: string): { fn: string; antes: string; depois: string }[] {
  const t = ler(rel);
  const b = t.slice(t.indexOf("DO $guarda$"), t.indexOf("$guarda$;"));
  return [...b.matchAll(/\('(public\.[^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ fn: r[1], antes: r[2], depois: r[3] }));
}
const GA = guardas(MIG_I3A);
const GB = guardas(MIG_I3B);
const NOVAS_B: Record<string, string> = {
  "public._integracao_padrao()": "7fb5e26f7a5ad402f71d8c887968d584",
  "public._integracao_opcionais()": "d70ec700a5689dc2d76cf71ce30f5a12",
  "public._integracao_extras(uuid)": "2de51abd64e618d40454daf45bd5135a",
};
const TENANT_FN = "public.fn_produto_cat_material_tenant()";

async function md5Vivo(c: Client, fn: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [fn])).m;
}
async function timeouts(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '180s'");
}
/** Integração 1..6 + a I3 viva (aplica NA TXN o que faltar; a I3c é idempotente). */
async function prepara9(c: Client): Promise<void> {
  await timeouts(c);
  for (const m of MARCAS) {
    if (!(await um<{ ok: boolean }>(c, `SELECT ${m} AS ok`)).ok) throw new Error("Integração 1..6 ausente na cópia");
  }
  await aplicaI3(c);
  await timeouts(c);
  await comoUsuario(c, U);
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT i3_falha");
  try {
    await c.query(sql, params);
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT i3_falha");
    return { code: e.code, message: e.message };
  }
  await c.query("RELEASE SAVEPOINT i3_falha");
  throw new Error(`esperava erro: ${sql}`);
}
async function passa(c: Client, sql: string, params: unknown[] = []): Promise<void> {
  await c.query(sql, params);
}

// ─────────────────────────── fixtures ───────────────────────────
let seq = 0;
const suf = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
async function catTecido(c: Client, nome: string, tenant = T): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.categorias_tecido (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome])).id;
}
async function material(c: Client, nome: string, tenant = T): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.materiais_aviamento (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome])).id;
}
async function grupo(c: Client, nome: string): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, $2) RETURNING id", [T, nome])).id;
}
async function colecao(c: Client, nome: string): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.colecoes (tenant_id, nome, status) VALUES ($1, $2, 'rascunho') RETURNING id", [T, nome])).id;
}
async function linha(c: Client, nome: string, tenant = T): Promise<string> {
  return (await um<{ id: string }>(c, "INSERT INTO public.linhas (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome])).id;
}
async function artigoNovo(c: Client, nome: string): Promise<string> {
  return (await um<{ id: string }>(c,
    "INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1, $2, 'metro', 10, 1) RETURNING id", [T, nome])).id;
}
/** Troca o artigo do Tecido 1 do modelo por um novo (categorias controladas pelo teste). */
async function tecido1Novo(c: Client, modeloId: string): Promise<string> {
  const a = await artigoNovo(c, `I3 Artigo ${suf()}`);
  await c.query("UPDATE public.modelo_tecidos SET artigo_id = $2 WHERE modelo_id = $1 AND tipo = 'tecido' AND numero = 1", [modeloId, a]);
  return a;
}
type Extras = { colecao: string | null; categoria_tecido: string | null; linha: string | null };
async function extras(c: Client, id: string): Promise<Extras> {
  return (await um<{ r: Extras }>(c, "SELECT public._integracao_extras($1) AS r", [id])).r;
}
type Retrato = { v: number; campos: string[]; linhas: { tipo: string; ordem: number; valores: Record<string, unknown> }[] };
async function retrato(c: Client, id: string, campos: readonly string[] = CAMPOS_PADRAO_I3): Promise<{ retrato: Retrato; faltas: any[]; completo: boolean }> {
  return (await um<{ r: any }>(c,
    `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) AS r`,
    [id, campos])).r;
}
async function assinaturaPrevia(c: Client, id: string): Promise<string> {
  return (await um<{ r: any }>(c, "SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r", [id])).r.produtos[0].assinatura;
}
async function marcar(c: Client, id: string): Promise<void> {
  const a = await assinaturaPrevia(c, id);
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
type Ip = { estado: string; campos: string[]; retrato: Retrato; retrato_txt: string; assinatura: string; rev: number; linhas: string };
async function ip(c: Client, id: string): Promise<Ip> {
  return um<Ip>(c,
    `SELECT p.estado, p.campos, p.retrato, p.retrato::text AS retrato_txt, p.assinatura, p.rev,
            (SELECT string_agg(il::text, '|' ORDER BY il.ordem) FROM public.integracao_linhas il WHERE il.modelo_id = p.modelo_id) AS linhas
       FROM public.integracao_produtos p WHERE p.modelo_id = $1`, [id]);
}
async function linhasApi(c: Client, id: string): Promise<{ tipo: string; colecao: string | null; categoria_tecido: string | null; linha: string | null }[]> {
  return (await c.query("SELECT tipo, colecao, categoria_tecido, linha FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem", [id])).rows;
}
async function camposLojaT(c: Client): Promise<{ campos: string[]; rev: number }> {
  return um(c, "SELECT campos, rev FROM public.integracao_config WHERE tenant_id = $1", [T]);
}
/** Card interno com Coleção (cadastro), Linha e Tecido 1 com categoria principal — os 3 preenchidos. */
async function internoCompleto(c: Client): Promise<{ id: string; col: string; lin: string; cat: string }> {
  const m = await modeloInterno(c);
  const s = suf();
  const col = `Coleção I3 ${s}`;
  const lin = `Linha I3 ${s}`;
  const cat = `Malha I3 ${s}`;
  const a = await tecido1Novo(c, m.id);
  await c.query("UPDATE public.artigos SET categoria_tecido_id = $2 WHERE id = $1", [a, await catTecido(c, cat)]);
  await c.query("UPDATE public.modelos SET colecao_id = $2, linha_id = $3 WHERE id = $1", [m.id, await colecao(c, col), await linha(c, lin)]);
  return { id: m.id, col, lin, cat };
}

// ─────────────────────────────── (a) estático: arquivos ───────────────────────────────
describe("integracao 9 — arquivos da I3 (estático, sem banco)", () => {
  it("encoding 1º; 1 BEGIN/1 COMMIT; as 2 travas logo depois do BEGIN; NOTIFY só onde muda schema; sem DROP no up/down", () => {
    for (const rel of [...ARQS_IDA, ...ARQS_VOLTA, ...DROPS]) {
      const t = ler(rel);
      const linhas = t.split("\n");
      expect(linhas.find((l) => l.trim() !== "" && !l.startsWith("--")), rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      const b = linhas.indexOf("BEGIN;");
      expect(linhas[b + 1], rel).toBe("SET LOCAL lock_timeout = '500ms';");
      expect(linhas[b + 2], rel).toMatch(/^SET LOCAL transaction_timeout = '(10|30)s';$/);
      if (!DROPS.includes(rel)) {
        expect(linhas.filter((l) => /^\s*DROP\s/i.test(l)), `${rel}: DROP no up/down (brief: só nos _down_drop)`).toEqual([]);
      }
      // os RAISE NOVOS desta release (mensagem 'i3*:'): ERRCODE P0001 (400) e mensagem só ASCII (regra do 5xx, por garantia)
      const novos = [...t.matchAll(/RAISE EXCEPTION '(i3[a-z_]*:[^']*)'[\s\S]*?USING ERRCODE = '([0-9A-Z]{5})'/g)];
      expect(novos.length, rel).toBeGreaterThan(0);
      for (const m of novos) {
        expect(m[2], `${rel}: ${m[1]}`).toBe("P0001");
        expect(/^[\x20-\x7e]*$/.test(m[1]), `${rel}: ${m[1]}`).toBe(true);
      }
    }
    for (const rel of [MIG_I3A, MIG_I3B, INV_I3A, INV_I3B, ...DROPS]) expect(ler(rel), rel).toContain("NOTIFY pgrst, 'reload schema';");
    expect(ler(MIG_I3C)).toContain("LOCK TABLE public.integracao_config, public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;");
    expect(ler(INV_I3C)).toContain("LOCK TABLE public.integracao_config, public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;");
  });
  it("guardas: 6 redefinidas na I3a e 8 na I3b com antes ≠ depois; o sucessor dos helpers = o depois do arquivo", () => {
    expect(GA.map((g) => g.fn)).toEqual([
      "public._salvar_produto_acabado_core(uuid,jsonb,jsonb)", "public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)",
      "public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])", "public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])",
      "public._limpar_produto_acabado_core(uuid)", "public._limpar_produto_importado_core(uuid)",
    ]);
    expect(GB.map((g) => g.fn)).toEqual([
      "public._integracao_layout()", "public._integracao_rotulos()", "public._integracao_cfg(uuid)",
      "public._integracao_retrato_core(uuid,text[],jsonb)", "public._integracao_valores(integracao_linhas,text[],text[])",
      "public._integracao_exemplo(text[],integer)", "public.integracao_marcar(jsonb)", "public.integracao_config_ler()",
    ]);
    for (const g of [...GA, ...GB]) {
      expect(g.antes, g.fn).not.toBe(g.depois);
      expect(I3_SUCESSOR[g.fn.replace(/^public\./, "")], g.fn).toBe(g.depois);
    }
    expect(GB.find((g) => g.fn.includes("retrato_core"))!.depois).toBe(I3B_RETRATO_DEPOIS);
    expect(ler(MIG_I3A)).toContain(`'${I3A_TENANT_DEPOIS}'`);
    expect(ler(INV_I3A)).toContain(`'${I3A_TENANT_NEUTRA}'`);
    for (const [fn, m] of Object.entries(NOVAS_B)) expect(ler(MIG_I3B), fn).toContain(`'${fn}', '${m}'`);
  });
  it("o corpo de cada função no arquivo = antes + SÓ as trocas declaradas (texto canônico; md5 do arquivo = md5 da guarda)", () => {
    const corpo = (rel: string, fn: string): string => {
      const t = ler(rel);
      const cria = `CREATE OR REPLACE FUNCTION ${fn.slice(0, fn.indexOf("(") + 1)}`;
      const i = t.indexOf(cria);
      expect(i, `${rel}: ${fn}`).toBeGreaterThan(-1);
      expect(t.indexOf(cria, i + 1), `${rel}: ${fn} 2×`).toBe(-1);
      const a = t.indexOf("AS $function$", i) + "AS $function$".length;
      return t.slice(i, t.indexOf("$function$", a) + "$function$".length) + "\n";
    };
    for (const g of GA) {
      expect(md5(corpo(MIG_I3A, g.fn)), `ida ${g.fn}`).toBe(g.depois);
      expect(md5(corpo(INV_I3A, g.fn)), `volta ${g.fn}`).toBe(g.antes);
    }
    for (const g of GB) {
      expect(md5(corpo(MIG_I3B, g.fn)), `ida ${g.fn}`).toBe(g.depois);
      expect(md5(corpo(INV_I3B, g.fn)), `volta ${g.fn}`).toBe(g.antes);
    }
    for (const [fn, m] of Object.entries(NOVAS_B)) expect(md5(corpo(MIG_I3B, fn)), fn).toBe(m);
    expect(md5(corpo(MIG_I3A, TENANT_FN))).toBe(I3A_TENANT_DEPOIS);
  });
});

// ─────────────────────────────── banco (txn revertida) ───────────────────────────────
describe.skipIf(!hasDb || !LOCAL)("integracao 9 — 3 campos não obrigatórios (banco, txn revertida)", () => {
  it("(b) ida → volta → ida dentro da txn: md5 conferidos, gatilho neutro na volta, reaplicar = no-op; LIFO das voltas", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const todas = [...GA, ...GB];
      const viva = await i3bViva(c);
      if (viva) await voltaI3SePreciso(c);
      for (const g of todas) expect(await md5Vivo(c, g.fn), `antes ${g.fn}`).toBe(g.antes);
      const neutroOuAusente = await md5Vivo(c, TENANT_FN);
      expect([null, I3A_TENANT_NEUTRA]).toContain(neutroOuAusente);
      // I3b sem I3a = recusa (exige a I3a)
      await c.query("SAVEPOINT b_sem_a");
      await expect(aplica(c, MIG_I3B)).rejects.toThrow(/i3b: exige a I3a/);
      await c.query("ROLLBACK TO SAVEPOINT b_sem_a");
      for (const rel of ARQS_IDA) await aplica(c, rel);
      await timeouts(c);
      for (const g of todas) expect(await md5Vivo(c, g.fn), `depois ${g.fn}`).toBe(g.depois);
      for (const [fn, m] of Object.entries(NOVAS_B)) expect(await md5Vivo(c, fn), fn).toBe(m);
      expect(await md5Vivo(c, TENANT_FN)).toBe(I3A_TENANT_DEPOIS);
      // reaplicar = no-op (I3c: nada a reprocessar → nenhum Log novo)
      const nLog = (await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.integracao_log")).n;
      for (const rel of ARQS_IDA) await aplica(c, rel);
      await timeouts(c);
      expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.integracao_log")).n).toBe(nLog);
      // LIFO: o inverso da I3a recusa com a I3b viva; o da I3b recusa com integrável reprocessado pela I3c (testado em (k))
      await c.query("SAVEPOINT lifo");
      await expect(aplica(c, INV_I3A)).rejects.toThrow(/i3a_volta: a I3b \(20261030110000\) ainda esta aplicada/);
      await c.query("ROLLBACK TO SAVEPOINT lifo");
      for (const rel of ARQS_VOLTA) await aplica(c, rel);
      await timeouts(c);
      for (const g of todas) expect(await md5Vivo(c, g.fn), `volta ${g.fn}`).toBe(g.antes);
      expect(await md5Vivo(c, TENANT_FN)).toBe(I3A_TENANT_NEUTRA);
      for (const fn of Object.keys(NOVAS_B)) expect(await md5Vivo(c, fn), `${fn} fica (sem DROP)`).toBe(NOVAS_B[fn]);
      expect((await um<{ d: string }>(c, `SELECT pg_get_expr(d.adbin, d.adrelid) AS d FROM pg_attrdef d JOIN pg_attribute a
                 ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.integracao_config'::regclass AND a.attname = 'campos'`)).d)
        .toBe("(_integracao_layout())[1:17]");
      expect((await um<{ n: string }>(c,
        "SELECT count(*) AS n FROM public.integracao_config WHERE campos && ARRAY['colecao','categoria_tecido','linha']")).n).toBe("0");
      // _down_drop da I3b (só funções + colunas de integracao_linhas; sem DROP TRIGGER) roda depois do inverso
      await aplica(c, DROPS[1]);
      await timeouts(c);
      expect(await md5Vivo(c, "public._integracao_extras(uuid)")).toBeNull();
      // ida de novo (com as colunas de integracao_linhas recriadas)
      for (const rel of ARQS_IDA) await aplica(c, rel);
      await timeouts(c);
      for (const g of todas) expect(await md5Vivo(c, g.fn), `ida de novo ${g.fn}`).toBe(g.depois);
      expect(await i3aViva(c)).toBe(true);
    });
  });

  it("(c) ACL (inv. #9): auxiliares/gatilho/internos sem EXECUTE p/ PUBLIC/anon/authenticated; RPCs com authenticated; DEFAULT = padrão", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      const pode = async (papel: string, fn: string) =>
        (await um<{ ok: boolean }>(c, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [papel, fn])).ok;
      for (const fn of [...Object.keys(NOVAS_B), TENANT_FN, ...GA.map((g) => g.fn), ...GB.filter((g) => !g.fn.startsWith("public.integracao_")).map((g) => g.fn)]) {
        expect(await pode("anon", fn), `anon ${fn}`).toBe(false);
        expect(await pode("authenticated", fn), `authenticated ${fn}`).toBe(false);
      }
      for (const fn of ["public.integracao_marcar(jsonb)", "public.integracao_config_ler()"]) {
        expect(await pode("anon", fn), fn).toBe(false);
        expect(await pode("authenticated", fn), fn).toBe(true);
      }
      expect((await um<{ p: string[]; o: string[]; l: string[] }>(c,
        "SELECT public._integracao_padrao() AS p, public._integracao_opcionais() AS o, public._integracao_layout() AS l")))
        .toEqual({ p: [...CAMPOS_PADRAO_I3], o: ["colecao", "categoria_tecido", "linha"], l: [...LAYOUT_I3] });
      expect((await um<{ r: any }>(c, "SELECT public._integracao_rotulos() AS r")).r).toMatchObject({
        colecao: "Coleção", categoria_tecido: "Categoria do Tecido Principal", linha: "Linha" });
      // P-217 A: a config da loja passa a ter os 20 (I3c) e a linha ausente (_integracao_cfg) = padrão
      expect((await camposLojaT(c)).campos).toEqual([...CAMPOS_PADRAO_I3]);
      expect((await um<{ c: string[] }>(c, "SELECT (public._integracao_cfg(gen_random_uuid())).campos AS c")).c).toEqual([...CAMPOS_PADRAO_I3]);
      // integracao_config_ler: + padrao e opcionais
      await comoUsuario(c, U);
      const cfg = (await um<{ r: any }>(c, "SELECT public.integracao_config_ler() AS r")).r;
      expect(cfg.padrao).toEqual([...CAMPOS_PADRAO_I3]);
      expect(cfg.opcionais).toEqual(["colecao", "categoria_tecido", "linha"]);
      expect(cfg.layout).toEqual([...LAYOUT_I3]);
    });
  });

  it("(d) loja NOVA e reset_loja nascem com os 20 (DEFAULT = _integracao_padrao())", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      await comoUsuario(c, U);
      const nova = (await um<{ id: string }>(c, "INSERT INTO public.tenants (nome) VALUES ('Loja I3 Teste') RETURNING id")).id;
      expect((await um<{ campos: string[] }>(c, "SELECT campos FROM public.integracao_config WHERE tenant_id = $1", [nova])).campos)
        .toEqual([...CAMPOS_PADRAO_I3]);
      await c.query("UPDATE public.integracao_config SET campos = '{nome}' WHERE tenant_id = $1", [nova]);
      await c.query("SELECT public.reset_loja($1)", [nova]);
      expect((await um<{ campos: string[] }>(c, "SELECT campos FROM public.integracao_config WHERE tenant_id = $1", [nova])).campos)
        .toEqual([...CAMPOS_PADRAO_I3]);
    });
  });

  it("(e) fontes: interno (Tecido 1 principal / sem principal = 1ª por nome / sem Tecido 1), coleção por texto, linha de outra loja", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      const m = await internoCompleto(c);
      expect(await extras(c, m.id)).toEqual({ colecao: m.col, categoria_tecido: m.cat, linha: m.lin });
      // principal vazia → a 1ª por NOME das categorias do artigo
      const a = (await um<{ a: string }>(c, "SELECT artigo_id AS a FROM public.modelo_tecidos WHERE modelo_id = $1 AND numero = 1 AND tipo = 'tecido'", [m.id])).a;
      await c.query("UPDATE public.artigos SET categoria_tecido_id = NULL WHERE id = $1", [a]);
      const s = suf();
      for (const nome of [`Zeta ${s}`, `Alfa ${s}`, `Meio ${s}`]) {
        await c.query("INSERT INTO public.artigo_categorias_tecido (tenant_id, artigo_id, categoria_tecido_id) VALUES ($1, $2, $3)", [T, a, await catTecido(c, nome)]);
      }
      expect((await extras(c, m.id)).categoria_tecido).toBe(`Alfa ${s}`);
      // Tecido 1 = o MAIS ANTIGO quando há 2 linhas tipo tecido / numero 1 (sem UNIQUE)
      const outro = await artigoNovo(c, `I3 Outro ${s}`);
      await c.query("UPDATE public.artigos SET categoria_tecido_id = $2 WHERE id = $1", [outro, await catTecido(c, `Plano ${s}`)]);
      await c.query("INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, created_at) VALUES ($1, $2, 1, 'tecido', now() + interval '1 day')", [m.id, outro]);
      expect((await extras(c, m.id)).categoria_tecido).toBe(`Alfa ${s}`);
      // Tecido 2 / forro não contam
      await c.query("DELETE FROM public.modelo_tecido_variantes WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = $1)", [m.id]);
      await c.query("DELETE FROM public.modelo_tecidos WHERE modelo_id = $1", [m.id]);
      await c.query("INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 2, 'tecido'), ($1, $2, 1, 'forro')", [m.id, outro]);
      expect((await extras(c, m.id)).categoria_tecido).toBeNull();
      // coleção: sem colecao_id = o texto livre (btrim); vazio = null
      await c.query("UPDATE public.modelos SET colecao_id = NULL, colecao = '  Verão 27  ' WHERE id = $1", [m.id]);
      expect((await extras(c, m.id)).colecao).toBe("Verão 27");
      await c.query("UPDATE public.modelos SET colecao = '   ' WHERE id = $1", [m.id]);
      expect((await extras(c, m.id)).colecao).toBeNull();
      // linha de OUTRA loja (dado inconsistente) não vaza
      await c.query("UPDATE public.modelos SET linha_id = $2 WHERE id = $1", [m.id, await linha(c, `Linha Fora ${s}`, OUTRA_LOJA)]);
      expect((await extras(c, m.id)).linha).toBeNull();
      expect(await extras(c, "00000000-0000-0000-0000-000000000001")).toBeNull();
    });
  });

  it("(f) fontes: revenda Acessórios → Material do aviamento; revenda outro grupo → Categoria do tecido; importado idem", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      const s = suf();
      const ace = await grupo(c, `Acessórios I3 ${s}`);
      const vest = await grupo(c, `Vestuário I3 ${s}`);
      const ct = await catTecido(c, `Tricô ${s}`);
      const ma = await material(c, `Couro ${s}`);
      const r = await revenda(c);
      await c.query("UPDATE public.produtos_acabados SET categoria_tecido_id = $2, material_aviamento_id = $3 WHERE id = $1", [r.produtoId, ct, ma]);
      expect((await extras(c, r.id)).categoria_tecido).toBe(`Tricô ${s}`); // sem grupo = não é Acessórios → Categoria do tecido
      await c.query("UPDATE public.produtos_acabados SET grupo_id = $2 WHERE id = $1", [r.produtoId, vest]);
      expect((await extras(c, r.id)).categoria_tecido).toBe(`Tricô ${s}`);
      await c.query("UPDATE public.produtos_acabados SET grupo_id = $2 WHERE id = $1", [r.produtoId, ace]);
      expect((await extras(c, r.id)).categoria_tecido).toBe(`Couro ${s}`);
      await c.query("UPDATE public.produtos_acabados SET material_aviamento_id = NULL WHERE id = $1", [r.produtoId]);
      expect((await extras(c, r.id)).categoria_tecido).toBeNull(); // Acessórios sem material = vazio (não cai na categoria)
      const i = await importado(c);
      await c.query("UPDATE public.produtos_importados SET grupo_id = $2, categoria_tecido_id = $3, material_aviamento_id = $4 WHERE id = $1",
        [i.produtoId, vest, ct, ma]);
      expect((await extras(c, i.id)).categoria_tecido).toBe(`Tricô ${s}`);
      await c.query("UPDATE public.produtos_importados SET grupo_id = $2 WHERE id = $1", [i.produtoId, ace]);
      expect((await extras(c, i.id)).categoria_tecido).toBe(`Couro ${s}`);
      // G-MIGRATION L3: id de OUTRA loja gravado com o gatilho de loja fora do caminho (ex.: neutralizado pelo _down da I3a)
      // NÃO vaza o nome — _integracao_extras filtra todo cadastro pela loja do modelo
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("UPDATE public.produtos_importados SET material_aviamento_id = $2 WHERE id = $1", [i.produtoId, await material(c, `Fora ${s}`, OUTRA_LOJA)]);
      await c.query("UPDATE public.produtos_acabados SET grupo_id = $2, categoria_tecido_id = $3 WHERE id = $1",
        [r.produtoId, vest, await catTecido(c, `Fora C ${s}`, OUTRA_LOJA)]);
      await c.query("SET LOCAL session_replication_role = origin");
      expect((await extras(c, i.id)).categoria_tecido).toBeNull();
      expect((await extras(c, r.id)).categoria_tecido).toBeNull();
    });
  });

  it("(g) retrato: v=3; 3 valores no produto E nas sublinhas; vazio NUNCA é falta; sem marcar = fora", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      await keywordsLoja(c, "k");
      const m = await internoCompleto(c);
      const r = await retrato(c, m.id);
      expect(r.retrato.v).toBe(3);
      expect(r.retrato.campos).toEqual([...CAMPOS_PADRAO_I3]);
      expect(r.completo).toBe(true);
      for (const l of r.retrato.linhas) {
        expect(l.valores, l.tipo).toMatchObject({ colecao: m.col, categoria_tecido: m.cat, linha: m.lin });
      }
      expect(r.retrato.linhas.length).toBe(3);
      // os 3 vazios: continua completo, sem falta, valores null
      await c.query("UPDATE public.modelos SET colecao_id = NULL, colecao = NULL, linha_id = NULL WHERE id = $1", [m.id]);
      await c.query("DELETE FROM public.modelo_tecido_variantes WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = $1)", [m.id]);
      const r2 = await retrato(c, m.id, [...CAMPOS_PADRAO_I3, "foto"]);
      expect(r2.faltas.map((f: any) => f.campo)).not.toEqual(expect.arrayContaining(["colecao"]));
      for (const k of ["colecao", "categoria_tecido", "linha"]) expect(r2.faltas.map((f: any) => f.campo), k).not.toContain(k);
      expect(r2.retrato.linhas[0].valores).toMatchObject({ colecao: null, linha: null });
      // não marcados: fora do retrato (nem chave)
      const r3 = await retrato(c, m.id, CAMPOS_PADRAO);
      expect(Object.keys(r3.retrato.linhas[0].valores)).not.toContain("colecao");
      expect(r3.retrato.v).toBe(3);
    });
  });

  it("(h) prévia = marcar (mesma assinatura); integracao_linhas com as 3 colunas; _integracao_ler entrega 21 colunas; modo teste", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await c.query("UPDATE public.integracao_config SET campos = public._integracao_layout() WHERE tenant_id = $1", [T]);
      const m = await internoCompleto(c);
      await marcar(c, m.id); // integracao_marcar recusa se a assinatura ≠ a da prévia
      const p = await ip(c, m.id);
      expect(p.estado).toBe("integravel");
      expect(p.retrato.v).toBe(3);
      expect(await linhasApi(c, m.id)).toEqual([
        { tipo: "produto", colecao: m.col, categoria_tecido: m.cat, linha: m.lin },
        { tipo: "variante", colecao: m.col, categoria_tecido: m.cat, linha: m.lin },
        { tipo: "variante", colecao: m.col, categoria_tecido: m.cat, linha: m.lin },
      ]);
      const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
      const k = (await um<{ r: any }>(c, "SELECT public.integracao_chave_criar('ERP I3') AS r")).r;
      const ler21 = async (modo: string) => (await um<{ r: any }>(c, "SELECT public._integracao_ler($1, false, NULL, NULL, $2, '203.0.113.10') AS r",
        [sha(k.chave), modo])).r;
      const r1 = await ler21("normal");
      expect(r1.chaves_colunas).toEqual([...LAYOUT_I3]);
      expect(r1.colunas.slice(18)).toEqual(["Coleção", "Categoria do Tecido Principal", "Linha"]);
      const prod = r1.produtos.find((x: any) => x.modelo_id === m.id);
      expect(prod.linhas[0].valores).toHaveLength(21);
      expect(prod.linhas[0].valores.slice(18)).toEqual([m.col, m.cat, m.lin]);
      expect(prod.linhas[1].valores.slice(18)).toEqual([m.col, m.cat, m.lin]);
      const ex = await ler21("teste");
      expect(ex.produtos[0].linhas[0].valores.slice(17)).toEqual([["exemplo"], "Coleção Exemplo", "Malha", "Casual"]);
      expect(ex.produtos[0].linhas[1].valores.slice(18)).toEqual(["Coleção Exemplo", "Malha", "Casual"]);
    });
  });

  it("(i) integrável: trocar Coleção / Linha / categoria do Tecido 1 / categoria do produto NÃO trava; o 'i' (retrato_difere) aponta", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await internoCompleto(c);
      await marcar(c, m.id);
      const s = suf();
      await passa(c, "UPDATE public.modelos SET colecao_id = $2, linha_id = $3 WHERE id = $1", [m.id, await colecao(c, `Outra ${s}`), await linha(c, `Outra L ${s}`)]);
      const a = (await um<{ a: string }>(c, "SELECT artigo_id AS a FROM public.modelo_tecidos WHERE modelo_id = $1 AND numero = 1 AND tipo = 'tecido'", [m.id])).a;
      await passa(c, "UPDATE public.artigos SET categoria_tecido_id = $2 WHERE id = $1", [a, await catTecido(c, `Outra C ${s}`)]);
      const ref = (await um<{ ref: string }>(c, "SELECT ref FROM public.modelos WHERE id = $1", [m.id])).ref;
      const l = (await um<{ r: any }>(c, "SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r", [ref])).r;
      const prod = l.produtos.find((x: any) => x.modelo_id === m.id);
      expect(prod.retrato_difere).toEqual(expect.arrayContaining(["categoria_tecido", "colecao", "linha"]));
      expect((await ip(c, m.id)).estado).toBe("integravel");
      // revenda integrável: a categoria / o material do produto também não travam (fn_integracao_trava_espelho não olha)
      const r = await revenda(c);
      await marcar(c, r.id);
      await passa(c, "UPDATE public.produtos_acabados SET categoria_tecido_id = $2, material_aviamento_id = $3 WHERE id = $1",
        [r.produtoId, await catTecido(c, `PA C ${s}`), await material(c, `PA M ${s}`)]);
      expect((await ip(c, r.id)).estado).toBe("integravel");
    });
  });

  it("(j) _salvar_produto_*_core: sem a chave não toca; com a chave grava/limpa; outra loja recusa (core e gatilho); com OC e integrável não bloqueia", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      await comoUsuario(c, U);
      const s = suf();
      const ct = await catTecido(c, `Sarja ${s}`);
      const ct2 = await catTecido(c, `Linho ${s}`);
      const ma = await material(c, `Metal ${s}`);
      const ctFora = await catTecido(c, `Fora ${s}`, OUTRA_LOJA);
      const maFora = await material(c, `Fora M ${s}`, OUTRA_LOJA);
      const g = await grupo(c, `Vestuário J ${s}`);
      const cat = (await um<{ id: string }>(c, "INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, $2, $3) RETURNING id", [T, `Cat J ${s}`, g])).id;
      const dados = (extra: Record<string, unknown>) => JSON.stringify({ nome: `PA J ${s}`, grupo_id: g, categoria_id: cat, qtd_total: 0, ...extra });
      const salvaPA = (id: string | null, extra: Record<string, unknown>) =>
        um<{ id: string }>(c, "SELECT public._salvar_produto_acabado_core($1, $2::jsonb, '[]'::jsonb) AS id", [id, dados(extra)]);
      const col = async (tab: string, id: string) =>
        um<{ ct: string | null; ma: string | null }>(c, `SELECT categoria_tecido_id AS ct, material_aviamento_id AS ma FROM public.${tab} WHERE id = $1`, [id]);
      // criar com as 2
      const pa = (await salvaPA(null, { categoria_tecido_id: ct, material_aviamento_id: ma })).id;
      expect(await col("produtos_acabados", pa)).toEqual({ ct, ma });
      // sem a chave: não toca
      await salvaPA(pa, {});
      expect(await col("produtos_acabados", pa)).toEqual({ ct, ma });
      // com a chave: troca; vazio limpa
      await salvaPA(pa, { categoria_tecido_id: ct2, material_aviamento_id: "" });
      expect(await col("produtos_acabados", pa)).toEqual({ ct: ct2, ma: null });
      // outra loja: core recusa (P0001 PT) e o gatilho também (UPDATE direto)
      expect((await falha(c, "SELECT public._salvar_produto_acabado_core($1, $2::jsonb, '[]'::jsonb)", [pa, dados({ categoria_tecido_id: ctFora })])))
        .toMatchObject({ code: "P0001", message: "Categoria do tecido não encontrada nesta loja." });
      expect((await falha(c, "SELECT public._salvar_produto_acabado_core($1, $2::jsonb, '[]'::jsonb)", [pa, dados({ material_aviamento_id: maFora })])))
        .toMatchObject({ code: "P0001", message: "Material do aviamento não encontrado nesta loja." });
      expect(await falha(c, "UPDATE public.produtos_acabados SET categoria_tecido_id = $2 WHERE id = $1", [pa, ctFora]))
        .toMatchObject({ code: "P0001", message: "Categoria do tecido de outra loja não pode ser usada aqui." });
      // com OC vinculada: trocar a categoria do tecido NÃO bloqueia (fora da trava de identidade)
      await c.query("INSERT INTO public.ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) VALUES ($1, 'I3 OC', $2)", [T, pa]);
      await salvaPA(pa, { categoria_tecido_id: ct, material_aviamento_id: ma });
      expect(await col("produtos_acabados", pa)).toEqual({ ct, ma });
      // importado: mesma regra
      const salvaPI = (id: string | null, extra: Record<string, unknown>) =>
        um<{ id: string }>(c, "SELECT public._salvar_produto_importado_core($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb) AS id",
          [id, JSON.stringify({ nome: `PI J ${s}`, grupo_id: g, categoria_id: cat, ...extra })]);
      const pi = (await salvaPI(null, { categoria_tecido_id: ct })).id;
      expect(await col("produtos_importados", pi)).toEqual({ ct, ma: null });
      await salvaPI(pi, {});
      expect(await col("produtos_importados", pi)).toEqual({ ct, ma: null });
      await salvaPI(pi, { categoria_tecido_id: "", material_aviamento_id: ma });
      expect(await col("produtos_importados", pi)).toEqual({ ct: null, ma });
      expect((await falha(c, "SELECT public._salvar_produto_importado_core($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb)",
        [pi, JSON.stringify({ nome: `PI J ${s}`, categoria_tecido_id: ctFora })]))).toMatchObject({ code: "P0001" });
      expect(await falha(c, "UPDATE public.produtos_importados SET material_aviamento_id = $2 WHERE id = $1", [pi, maFora]))
        .toMatchObject({ code: "P0001", message: "Material do aviamento de outra loja não pode ser usado aqui." });
    });
  });

  it("(k) replicar copia as 2 colunas; Limpar produto zera as 2", async () => {
    await withTx(async (c) => {
      await prepara9(c);
      await comoUsuario(c, U);
      const s = suf();
      const ct = await catTecido(c, `Rep ${s}`);
      const ma = await material(c, `RepM ${s}`);
      const destino = await colecao(c, `Destino ${s}`);
      for (const [fx, tab, rep] of [
        [revenda, "produtos_acabados", "_replicar_produtos_acabados_core"],
        [importado, "produtos_importados", "_replicar_produtos_importados_core"],
      ] as const) {
        const f = await fx(c);
        await c.query(`UPDATE public.${tab} SET categoria_tecido_id = $2, material_aviamento_id = $3 WHERE id = $1`, [f.produtoId, ct, ma]);
        const out = (await um<{ r: any[] }>(c, `SELECT public.${rep}($1, $2, NULL, ARRAY[$3::uuid]) AS r`, [T, destino, f.produtoId])).r;
        expect(out).toHaveLength(1);
        expect(await um(c, `SELECT categoria_tecido_id AS ct, material_aviamento_id AS ma FROM public.${tab} WHERE id = $1`, [out[0].novo_produto_id]))
          .toEqual({ ct, ma });
      }
      // Limpar (rascunho sem card, sem OC)
      const pa = (await um<{ id: string }>(c,
        "INSERT INTO public.produtos_acabados (tenant_id, nome, categoria_tecido_id, material_aviamento_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [T, `Limpar ${s}`, ct, ma])).id;
      await c.query("SELECT public._limpar_produto_acabado_core($1)", [pa]);
      expect(await um(c, "SELECT categoria_tecido_id AS ct, material_aviamento_id AS ma FROM public.produtos_acabados WHERE id = $1", [pa]))
        .toEqual({ ct: null, ma: null });
      const pi = (await um<{ id: string }>(c,
        "INSERT INTO public.produtos_importados (tenant_id, nome, categoria_tecido_id, material_aviamento_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [T, `Limpar I ${s}`, ct, ma])).id;
      await c.query("SELECT public._limpar_produto_importado_core($1)", [pi]);
      expect(await um(c, "SELECT categoria_tecido_id AS ct, material_aviamento_id AS ma FROM public.produtos_importados WHERE id = $1", [pi]))
        .toEqual({ ct: null, ma: null });
    });
  });

  it("(l) I3c: configs + integráveis reprocessados (1 Log cada), integrados INTOCADOS, idempotente; o inverso devolve byte a byte", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      for (const m of MARCAS) expect((await um<{ ok: boolean }>(c, `SELECT ${m} AS ok`)).ok).toBe(true);
      await voltaI3SePreciso(c); // estado de ANTES (se a cópia já tem a I3)
      await timeouts(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await aplica(c, MIG_I3A);
      await timeouts(c);
      await c.query("UPDATE public.integracao_config SET campos = $2::text[] WHERE tenant_id = $1", [T, CAMPOS_PADRAO]);
      const cfg0 = await camposLojaT(c);
      // A: integrável marcado ANTES da I3b (retrato v2); B: integrado; D: integrável que vai ser integrado depois da ida
      const A = await internoCompleto(c);
      const B = await internoCompleto(c);
      const D = await revenda(c);
      for (const x of [A.id, B.id, D.id]) await marcar(c, x);
      await c.query("UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1", [B.id]);
      await aplica(c, MIG_I3B);
      await timeouts(c);
      // E: marcado DEPOIS da I3b com a config velha (17) — retrato v3 sem as 3 chaves
      const E = await internoCompleto(c);
      await marcar(c, E.id);
      const a0 = await ip(c, A.id);
      const b0 = await ip(c, B.id);
      const d0 = await ip(c, D.id);
      const e0 = await ip(c, E.id);
      expect(a0.retrato.v).toBe(2);
      expect(e0.retrato.v).toBe(3);
      expect(e0.retrato.campos).toEqual([...CAMPOS_PADRAO]);
      const logs0 = (await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.integracao_log")).n;
      const cfgSem = Number((await um<{ n: string }>(c,
        "SELECT count(*) AS n FROM public.integracao_config WHERE NOT (campos @> ARRAY['colecao','categoria_tecido','linha'])")).n);
      expect(cfgSem).toBeGreaterThanOrEqual(1);
      await aplica(c, MIG_I3C);
      await timeouts(c);
      // configs: P-217 A
      const cfg1 = await camposLojaT(c);
      expect(cfg1).toEqual({ campos: [...CAMPOS_PADRAO_I3], rev: cfg0.rev + 1 });
      expect((await um<{ q: string; d: any }>(c,
        "SELECT quem AS q, detalhe AS d FROM public.integracao_log WHERE tenant_id = $1 AND acao = 'campos' ORDER BY criado_em DESC, quem LIMIT 1", [T])))
        .toEqual({ q: "Sistema (campos informativos)", d: { antes: [...CAMPOS_PADRAO], depois: [...CAMPOS_PADRAO_I3] } });
      // integráveis: A, D e E
      for (const [x, antes, exp] of [[A.id, a0, A], [E.id, e0, E]] as const) {
        const p = await ip(c, x);
        expect(p.estado).toBe("integravel");
        expect(p.campos).toEqual([...CAMPOS_PADRAO_I3]);
        expect(p.rev).toBe(antes.rev + 1);
        expect(p.retrato.v).toBe(3);
        expect(p.retrato.campos).toEqual([...CAMPOS_PADRAO_I3]);
        for (const l of p.retrato.linhas) expect(l.valores).toMatchObject({ colecao: exp.col, categoria_tecido: exp.cat, linha: exp.lin });
        // o resto do retrato byte a byte igual (tirando as 3 chaves, campos e v)
        const tira = (r: Retrato) => JSON.stringify({ ...r, v: 0, campos: [], linhas: r.linhas.map((l) => ({
          ...l, valores: Object.fromEntries(Object.entries(l.valores).filter(([k]) => !["colecao", "categoria_tecido", "linha"].includes(k))) })) });
        expect(tira(p.retrato)).toBe(tira(antes.retrato));
        expect(p.assinatura).toBe((await um<{ a: string }>(c, "SELECT public._integracao_assinar(retrato) AS a FROM public.integracao_produtos WHERE modelo_id = $1", [x])).a);
        expect(p.assinatura).not.toBe(antes.assinatura);
        expect(await linhasApi(c, x)).toEqual(p.retrato.linhas.map((l) => ({ tipo: l.tipo, colecao: exp.col, categoria_tecido: exp.cat, linha: exp.lin })));
        const lg = (await c.query("SELECT quem, detalhe FROM public.integracao_log WHERE modelo_id = $1 AND detalhe ->> 'reprocesso' = 'campos_informativos'", [x])).rows;
        expect(lg).toHaveLength(1);
        expect(lg[0]).toMatchObject({ quem: "Sistema (campos informativos)", detalhe: {
          valores: { colecao: exp.col, categoria_tecido: exp.cat, linha: exp.lin }, assinatura_antes: antes.assinatura, assinatura_depois: p.assinatura } });
      }
      const d1 = await ip(c, D.id);
      expect(d1.retrato.linhas[0].valores).toMatchObject({ colecao: null, categoria_tecido: null, linha: null });
      // integrado B intocado (retrato, assinatura, rev, linhas)
      expect(await ip(c, B.id)).toEqual(b0);
      // idempotente: reaplicar = 0
      const logs1 = (await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.integracao_log")).n;
      expect(Number(logs1) - Number(logs0)).toBe(cfgSem + 3); // 1 'campos' por config de loja + 1 'editar' por integrável
      const a1 = await ip(c, A.id);
      await aplica(c, MIG_I3C);
      await timeouts(c);
      expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.integracao_log")).n).toBe(logs1);
      expect(await ip(c, A.id)).toEqual(a1);
      // backup ilegível p/ anon/authenticated
      expect((await um<{ ok: boolean }>(c, "SELECT has_table_privilege('authenticated', 'public._bkp_i3c_reprocesso', 'SELECT') AS ok")).ok).toBe(false);
      // a volta da I3b recusa enquanto a I3c está aplicada (LIFO)
      await c.query("SAVEPOINT lifo_b");
      await expect(aplica(c, INV_I3B)).rejects.toThrow(/i3b_volta: a I3c \(20261030120000\) ainda esta aplicada/);
      await c.query("ROLLBACK TO SAVEPOINT lifo_b");
      // D vira integrado DEPOIS da ida → fica e é relatado
      await c.query("UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1", [D.id]);
      const d2 = await ip(c, D.id);
      await aplica(c, INV_I3C);
      await timeouts(c);
      for (const [x, antes] of [[A.id, a0], [E.id, e0]] as const) {
        const p = await ip(c, x);
        expect(p.retrato_txt).toBe(antes.retrato_txt);
        expect(p.campos).toEqual(antes.campos);
        expect(p.assinatura).toBe(antes.assinatura);
        expect(p.rev).toBe(antes.rev + 2);
        expect(p.linhas).toBe(antes.linhas);
      }
      expect(await ip(c, D.id)).toEqual(d2);
      expect(await ip(c, B.id)).toEqual(b0);
      expect(await camposLojaT(c)).toEqual({ campos: [...CAMPOS_PADRAO], rev: cfg0.rev + 2 });
      // agora a volta da I3b e da I3a passam (LIFO)
      await aplica(c, INV_I3B);
      await aplica(c, INV_I3A);
      await timeouts(c);
      expect(await i3bViva(c)).toBe(false);
    });
  });

  it("(m) desempenho (só registro): integracao_listar 500 e lote de retratos antes × depois", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      await voltaI3SePreciso(c);
      await timeouts(c);
      await comoUsuario(c, U);
      const ids = (await c.query("SELECT id FROM public.modelos ORDER BY id LIMIT 300")).rows.map((r) => r.id);
      const mede = async (sql: string, p: unknown[]) => { const t0 = performance.now(); await c.query(sql, p); return Math.round(performance.now() - t0); };
      const lote = "SELECT count(public._integracao_retrato_core(x, $2::text[], '{}'::jsonb)) FROM unnest($1::uuid[]) AS x";
      const listar = "SELECT public.integracao_listar('todos', '{}'::jsonb, 1, 500)";
      await mede(lote, [ids, CAMPOS_PADRAO]);
      const antesLote = await mede(lote, [ids, CAMPOS_PADRAO]);
      const antesListar = await mede(listar, []);
      await aplicaI3(c);
      await timeouts(c);
      await mede(lote, [ids, CAMPOS_PADRAO_I3]);
      const depoisLote = await mede(lote, [ids, CAMPOS_PADRAO_I3]);
      const depoisListar = await mede(listar, []);
      process.stderr.write(`[I3 desempenho] ${ids.length} retratos: antes ${antesLote} ms, depois ${depoisLote} ms; integracao_listar(500): antes ${antesListar} ms, depois ${depoisListar} ms\n`);
      expect(depoisLote).toBeLessThan(antesLote * 3 + 500);
    });
  });
});
