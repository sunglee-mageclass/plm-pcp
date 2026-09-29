/**
 * Integração/API — COR NO NOME DAS SUBLINHAS (P-126 + P-127 B; P-128 A e P-129 A), migration 20261013100000.
 * Plano .superpowers/sdd/2026-09-29-nome-cor/plan.md. SÓ na cópia local (exigeBancoLocal); txn revertida (withTx): NADA é gravado.
 * Funciona com a cópia NOS DOIS estados: sem a migration (o `prepara8` aplica o arquivo DENTRO da txn — tirando BEGIN/COMMIT e as
 * 2 travas SET LOCAL, NUNCA `\i`) ou com ela já aplicada (o `prepara8` só confere; os testes que precisam do "antes" rodam o
 * INVERSO dentro da txn, com a confirmação SET LOCAL). A migration tranca integracao_produtos/linhas (SHARE ROW EXCLUSIVE) até o
 * fim de cada teste — janela N3 da cópia.
 *   (a) nomes do retrato · (b) loja sem formato · (c) inválido = P0001 + anti-drift TS≡SQL · (d) marcar → linhas → API
 *   (e) reprocesso P-127 B · (f) modo teste · (g) diff dos arquivos + md5 das que não mudam · (h) ida → volta → ida
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import {
  CAMPOS_PADRAO, LAYOUT, LOCAL, MARCAS, T, U, camposLoja, comoUsuarioCom, keywordsLoja, ler, modeloInterno, revenda, semTravas,
} from "./integracao-helpers";
import { CASOS_CONFIG } from "../fixtures/sku-casos";
import { CASOS_COR_NO_NOME, CASOS_NOME_SUBLINHA } from "../fixtures/nome-sublinha-casos";

const MIG = "supabase/migrations/20261013100000_integracao_nome_sublinha_cor.sql";
const INV = "supabase/rollback/20261013100000_integracao_nome_sublinha_cor_down.sql";
const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");
const aplica = (c: Client, rel: string): Promise<void> => aplicarSql(c, semTravas(ler(rel), rel), rel);

/** O texto de pg_get_functiondef = o corpo do arquivo + "\n" (o arquivo é GERADO no formato canônico). */
function corpo(rel: string, cria: string): string {
  const t = ler(rel);
  const i = t.indexOf(cria);
  const f = t.indexOf("\n$function$", i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${cria})`);
  if (t.indexOf(cria, i + 1) >= 0) throw new Error(`${rel}: ${cria} aparece mais de 1×`);
  return t.slice(i, f + "\n$function$".length) + "\n";
}
const cria = (fn: string): string => `CREATE OR REPLACE FUNCTION ${fn.slice(0, fn.indexOf("(") + 1)}`;
/** As guardas do $guarda$ do arquivo: redefinidas [fn, antes, depois] e novas [fn, depois]. */
function guardas(rel: string) {
  const t = ler(rel);
  const b = t.slice(t.indexOf("DO $guarda$"), t.indexOf("$guarda$;"));
  return {
    redef: [...b.matchAll(/\('(public\.[^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ fn: r[1], antes: r[2], depois: r[3] })),
    novas: [...b.matchAll(/\('(public\.[^']+)', '([0-9a-f]{32})'\)/g)].map((r) => ({ fn: r[1], depois: r[2] })),
  };
}
const G = guardas(MIG);
const RETRATO = "public._integracao_retrato_core(uuid,text[],jsonb)";
const NOVAS = ["public._integracao_cor_no_nome(jsonb)", "public._integracao_nome_sublinha(text,text,text,text,text)"];
const REDEF = [
  "public._sku_config_normaliza(jsonb)", "public._skus_plano(uuid,text,text,jsonb,text)", "public._skus_matriz_ref_tipo(uuid,text,text)",
  RETRATO, "public._integracao_exemplo(text[],integer)",
];
// As que NÃO podem mudar (plano §Funções) — md5 do texto vivo antes desta frente.
const IGUAIS: Record<string, string> = {
  "public._skus_calc_ref_tipo(uuid,text,text)": "ff2e575909f83fc0355fe20a049fd906",
  "public._sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)": "390596838baf5a8855bb44a5146246a7",
  "public.fn_tenant_config_sku_normaliza()": "13ef9f85864fb245db843e7de25127a9",
  "public.integracao_marcar(jsonb)": "208d916232f308772c77eaa4220bbf0a",
  "public.integracao_listar(text,jsonb,integer)": "97954f033f3e70843818a1bc2ca92524",
  "public.integracao_previa(uuid[])": "66f0b0183cffdcdf5b1224b752ac6030",
  "public._integracao_ler(text,boolean,text,integer,text,text)": "1ac58b343e992fefe0062dac512e11eb",
  "public._integracao_valores(integracao_linhas,text[],text[])": "1397511c97477a103dbeebad85121dd8",
  "public._integracao_assinar(jsonb)": "bbe03c7d24dc3a470387c0164073146b",
  "public._integracao_logar(uuid,text,uuid,jsonb,text)": "52b347ee02742906c19765c46e8cfec4",
};
// Trocas DECLARADAS do plano (o gerador tem as mesmas; aqui provam que a migration = inverso + SÓ isto, cada âncora 1×).
const LEITOR: [string, string] = ["tc.sku_config", "CASE WHEN tc.sku_config -> 'partes' = '[]'::jsonb THEN NULL ELSE tc.sku_config END"];
const TROCAS: Record<string, [string, string][]> = {
  "public._skus_plano(uuid,text,text,jsonb,text)": [LEITOR],
  "public._skus_matriz_ref_tipo(uuid,text,text)": [LEITOR],
  "public._integracao_exemplo(text[],integer)": [["v_nome || ' ' || v_tam", "v_nome || ' Cor Exemplo ' || v_tam"]],
  [RETRATO]: [
    ["  s record;\nBEGIN\n", "  s record;\n  v_skucfg jsonb;\n  v_modo text;\nBEGIN\n"],
    ["  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id;\n",
     "  SELECT tc.keywords, tc.sku_config INTO v_kw, v_skucfg FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id;\n" +
     "  -- Cor no nome da sublinha (P-126): Cor base | Apelido da loja (a escolha do Formato do SKU, senão derivada das partes)\n" +
     "  v_modo := public._integracao_cor_no_nome(v_skucfg);\n"],
    ["        WHEN 'nome' THEN CASE WHEN nullif(btrim(m.nome), '') IS NULL THEN 'null'::jsonb\n" +
     "                              ELSE to_jsonb(concat_ws(' ', btrim(m.nome), v_tam)) END\n",
     "        WHEN 'nome' THEN coalesce(to_jsonb(public._integracao_nome_sublinha(m.nome, s.cor_nome, s.apelido_nome, v_tam, v_modo)), 'null'::jsonb)\n"],
    ["jsonb_build_object('v', 1, 'campos'", "jsonb_build_object('v', 2, 'campos'"],
  ],
};
function aplicaTrocas(t: string, trocas: [string, string][], nome: string): string {
  return trocas.reduce((s, [a, b]) => {
    expect(s.split(a).length - 1, `${nome}: ${a.trim().slice(0, 60)}`).toBe(1);
    return s.split(a).join(b);
  }, t);
}

async function md5Vivo(c: Client, fn: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [fn])).m;
}
const depoisDe = (fn: string): string => G.redef.find((g) => g.fn === fn)!.depois;
const antesDe = (fn: string): string => G.redef.find((g) => g.fn === fn)!.antes;
async function viva(c: Client): Promise<boolean> {
  return (await md5Vivo(c, RETRATO)) === depoisDe(RETRATO);
}
async function timeouts(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '180s'");
}
/** Integração 1..6 na cópia (as marcas) + a migration desta frente viva (aplica NA TXN se ainda não estiver). */
async function prepara8(c: Client): Promise<void> {
  await timeouts(c);
  for (const m of MARCAS) {
    if (!(await um<{ ok: boolean }>(c, `SELECT ${m} AS ok`)).ok) throw new Error("Integração 1..6 ausente na cópia");
  }
  if (!(await viva(c))) await aplica(c, MIG);
}
/** Volta ao estado de ANTES dentro da txn (se a cópia tem a migration): o inverso, com a confirmação SET LOCAL. */
async function voltaSePreciso(c: Client): Promise<void> {
  await timeouts(c);
  if (!(await viva(c))) return;
  await c.query("SET LOCAL app.confirmo_voltar_cor_no_nome = 'sim'");
  await aplica(c, INV);
  await c.query("SET LOCAL app.confirmo_voltar_cor_no_nome = ''");
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT nc_falha");
  try {
    await c.query(sql, params);
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT nc_falha");
    return { code: e.code, message: e.message };
  }
  await c.query("RELEASE SAVEPOINT nc_falha");
  throw new Error(`esperava erro: ${sql}`);
}

type Linha = { tipo: string; ordem: number; variante_key?: string; valores: Record<string, string | null> };
type Retrato = { v: number; campos: string[]; linhas: Linha[] };
async function retrato(c: Client, id: string, campos: readonly string[] = CAMPOS_PADRAO): Promise<Retrato> {
  return (await um<{ r: Retrato }>(c,
    `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) -> 'retrato' AS r`,
    [id, campos])).r;
}
const variantes = (r: Retrato): Linha[] => r.linhas.filter((l) => l.tipo === "variante");
async function skuConfig(c: Client, cfg: unknown): Promise<void> {
  await c.query("UPDATE public.tenant_config SET sku_config = $2::jsonb WHERE tenant_id = $1", [T, cfg === null ? null : JSON.stringify(cfg)]);
}
const FORMATO = { partes: ["ref", "cor_base", "tamanho"], separadores: { "ref|cor_base": "-", "cor_base|tamanho": "-" } };
async function marcar(c: Client, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
type Ip = { estado: string; retrato: Retrato; retrato_txt: string; assinatura: string; rev: number; marcado_em: string; linhas: string };
async function ip(c: Client, id: string): Promise<Ip> {
  return um<Ip>(c,
    `SELECT p.estado, p.retrato, p.retrato::text AS retrato_txt, p.assinatura, p.rev, p.marcado_em::text AS marcado_em,
            (SELECT string_agg(il::text, '|' ORDER BY il.ordem) FROM public.integracao_linhas il WHERE il.modelo_id = p.modelo_id) AS linhas
       FROM public.integracao_produtos p WHERE p.modelo_id = $1`, [id]);
}
async function nomesLinhas(c: Client, id: string): Promise<(string | null)[]> {
  const { rows } = await c.query(`SELECT nome FROM public.integracao_linhas WHERE modelo_id = $1 AND tipo = 'variante' ORDER BY ordem`, [id]);
  return rows.map((r) => r.nome);
}
async function logs(c: Client, id: string): Promise<any[]> {
  const { rows } = await c.query(
    `SELECT acao, quem, detalhe FROM public.integracao_log WHERE modelo_id = $1 AND detalhe ->> 'reprocesso' = 'nome_sublinhas_cor' ORDER BY criado_em, id`, [id]);
  return rows;
}

// ─────────────────────────────── (g) estático: arquivos ───────────────────────────────
describe("integracao 8 — arquivos da migration e do inverso (estático, sem banco)", () => {
  it("encoding 1º; 1 BEGIN/1 COMMIT; as 2 travas logo depois do BEGIN (500ms/10s); LOCK; NOTIFY antes do COMMIT", () => {
    for (const rel of [MIG, INV]) {
      const t = ler(rel);
      const linhas = t.split("\n");
      expect(linhas.find((l) => l.trim() !== "" && !l.startsWith("--")), rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      const b = linhas.indexOf("BEGIN;");
      expect(linhas.slice(b + 1, b + 3), rel).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '10s';"]);
      expect(t, rel).toContain("LOCK TABLE public.integracao_produtos, public.integracao_linhas IN SHARE ROW EXCLUSIVE MODE;");
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeGreaterThan(t.indexOf("DO $pos$"));
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeLessThan(t.indexOf("\nCOMMIT;"));
    }
    // ordem da ida: guarda → novas → 5 → REVOKE → LOCK → reprocesso → pos
    const m = ler(MIG);
    const i = (s: string) => { const x = m.indexOf(s); expect(x, s).toBeGreaterThan(-1); return x; };
    const ordem = [i("DO $guarda$"), i(cria(NOVAS[0])), i(cria(REDEF[0])), i("REVOKE EXECUTE ON FUNCTION"), i("LOCK TABLE"),
      i("DO $reprocessa$"), i("DO $pos$")];
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // volta: guarda → LOCK → restaura → tenant_config → 5 de antes → DROP das novas → REVOKE → pos
    const v = ler(INV);
    const j = (s: string) => { const x = v.indexOf(s); expect(x, s).toBeGreaterThan(-1); return x; };
    const ov = [j("DO $guarda$"), j("LOCK TABLE"), j("DO $restaura$"), j("UPDATE public.tenant_config"), j(cria(REDEF[0])),
      j("DROP FUNCTION IF EXISTS public._integracao_nome_sublinha(text, text, text, text, text);"), j("REVOKE EXECUTE ON FUNCTION"), j("DO $pos$")];
    expect([...ov].sort((a, b) => a - b)).toEqual(ov);
    for (const f of NOVAS) expect(v, f).not.toContain(cria(f));
  });

  it("guarda: md5 EXATOS — antes = texto do inverso, depois = texto da migration; novas = texto da migration (mesmos nos 2 arquivos)", () => {
    expect(G.redef.map((g) => g.fn)).toEqual(REDEF);
    expect(G.novas.map((g) => g.fn)).toEqual(NOVAS);
    for (const g of G.redef) expect(g, g.fn).toEqual({ fn: g.fn, antes: md5(corpo(INV, cria(g.fn))), depois: md5(corpo(MIG, cria(g.fn))) });
    for (const g of G.novas) expect(g.depois, g.fn).toBe(md5(corpo(MIG, cria(g.fn))));
    expect(guardas(INV)).toEqual(G);
    // os "antes" são os do plano (texto vivo de produção = cópia em 29/set)
    expect(G.redef.map((g) => g.antes)).toEqual(["7714c95d1cc43e6da89c14e8090f46a0", "cb24674981bb1097e1dbd7698fdee6e3",
      "f98ac370c499c823cb23bdb2b271f145", "b79ab7120a7f5b4d247b3daf0897eb78", "afdf0d5b61a99f8b049112b76c263cc1"]);
  });

  it("diff: os 2 leitores do SKU, retrato_core e exemplo = texto do inverso com SÓ as trocas declaradas (cada âncora 1×)", () => {
    for (const [fn, trocas] of Object.entries(TROCAS)) {
      expect(corpo(MIG, cria(fn)), fn).toBe(aplicaTrocas(corpo(INV, cria(fn)), trocas, fn));
    }
    // o normalizador: o cabeçalho igual e as mensagens de antes intactas; a nova P0001 entra DEPOIS das checagens de partes
    const n = corpo(MIG, cria(REDEF[0]));
    const a = corpo(INV, cria(REDEF[0]));
    expect(n.slice(0, n.indexOf("AS $function$"))).toBe(a.slice(0, a.indexOf("AS $function$")));
    for (const m of a.match(/RAISE EXCEPTION '[^']*'/g) ?? []) expect(n, m).toContain(m);
    expect(n.indexOf("Cor no nome da sublinha inválida")).toBeGreaterThan(n.indexOf("Parte do SKU repetida"));
    expect(n.indexOf("Cor no nome da sublinha inválida")).toBeLessThan(n.indexOf("Formato do SKU inválido: separadores."));
    // as 2 novas: IMMUTABLE, sql, sem DML; nenhuma com prefixo _sku_ (sku-automatico conta as _sku_*)
    for (const f of NOVAS) {
      const t = corpo(MIG, cria(f));
      expect(t, f).toMatch(/\n LANGUAGE sql\n IMMUTABLE\n SET search_path TO 'public'\n/);
      expect(t, f).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
      expect(f.startsWith("public._sku_")).toBe(false);
    }
  });

  it("ACL (#9): REVOKE dos TRÊS nas 7 (ida) e nas 5 (volta); todo RAISE dos blocos DO é ASCII (inv. RAISE 5xx)", () => {
    const revs = (rel: string) => [...ler(rel).matchAll(/REVOKE EXECUTE ON FUNCTION\n([\s\S]*?)\n  FROM ([^;]+);/g)].map((r) => ({ fns: r[1], de: r[2] }));
    const ida = revs(MIG);
    expect(ida.map((r) => r.de)).toEqual(["PUBLIC, anon, authenticated"]);
    expect(ida[0].fns.split(",\n").length).toBe(7);
    const volta = revs(INV);
    expect(volta.map((r) => r.de)).toEqual(["PUBLIC, anon, authenticated"]);
    expect(volta[0].fns.split(",\n").length).toBe(5);
    for (const rel of [MIG, INV]) {
      const t = ler(rel);
      for (const bloco of t.match(/DO \$(guarda|reprocessa|restaura|pos)\$[\s\S]*?\$\1\$;/g) ?? []) {
        for (const msg of bloco.match(/RAISE (EXCEPTION|NOTICE) '[^']*(''[^']*)*'/g) ?? []) {
          expect(/^[\x20-\x7E]*$/.test(msg), `${rel}: ${msg}`).toBe(true);
        }
      }
    }
  });
});

// ─────────────────────────────── banco (só na cópia) ───────────────────────────────
describe.skipIf(!hasDb || !LOCAL)("integracao 8 — cor no nome das sublinhas (banco, txn revertida)", () => {
  it("(a) retrato: Cor base → 'Nome Branco… P'; Apelido → 'Nome Off-white… P'; sem apelido → base; sem cor → 'Nome P'; nome em branco → null; v = 2", async () => {
    await withTx(async (c) => {
      await prepara8(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await skuConfig(c, FORMATO);
      const m = await modeloInterno(c);
      const r = await retrato(c, m.id);
      expect(r.v).toBe(2);
      const nome = r.linhas[0].valores.nome!;
      const [s1, s2] = variantes(r);
      expect(s1.valores.cor_base).toMatch(/^Branco /);
      expect(s1.valores.nome).toBe(`${nome} ${s1.valores.cor_base} P`);
      expect(s2.valores.nome).toBe(`${nome} ${s2.valores.cor_base} M`);
      // escolha explícita Apelido
      await skuConfig(c, { ...FORMATO, cor_no_nome: "cor_apelido" });
      const ra = await retrato(c, m.id);
      expect(variantes(ra)[0].valores.cor_apelido).toMatch(/^Off-white /);
      expect(variantes(ra)[0].valores.nome).toBe(`${nome} ${variantes(ra)[0].valores.cor_apelido} P`);
      // derivado (sem a chave): partes com cor_apelido ⇒ Apelido
      await skuConfig(c, { partes: ["ref", "cor_apelido", "tamanho"] });
      expect(variantes(await retrato(c, m.id))[0].valores.nome).toBe(`${nome} ${variantes(ra)[0].valores.cor_apelido} P`);
      // sem apelido no modo Apelido ⇒ a cor base
      const semAp = await modeloInterno(c, { semApelido: true });
      const rs = await retrato(c, semAp.id);
      expect(variantes(rs)[0].valores.nome).toBe(`${rs.linhas[0].valores.nome} ${variantes(rs)[0].valores.cor_base} P`);
      // sem cor (variante sem cor base nem apelido) ⇒ Nome + tamanho, como antes
      const semCor = await modeloInterno(c);
      await c.query(`UPDATE public.variantes_tecido vt SET cor_id = NULL, cor_apelido_id = NULL
                       FROM public.modelo_tecido_variantes mtv JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
                      WHERE mtv.variante_tecido_id = vt.id AND mt.modelo_id = $1`, [semCor.id]);
      const rc = await retrato(c, semCor.id);
      expect(variantes(rc)[0].valores.nome).toBe(`${rc.linhas[0].valores.nome} P`);
      // nome em branco ⇒ null
      await c.query(`UPDATE public.modelos SET nome = '   ' WHERE id = $1`, [m.id]);
      const rb = await retrato(c, m.id);
      expect(rb.linhas[0].valores.nome).toBeNull();
      expect(variantes(rb).map((l) => l.valores.nome)).toEqual([null, null]);
      // revenda também (mesma matriz do SKU): Cor base
      await skuConfig(c, FORMATO);
      const rv = await revenda(c);
      const rr = await retrato(c, rv.id);
      expect(variantes(rr)[0].valores.nome).toBe(`${rr.linhas[0].valores.nome} ${variantes(rr)[0].valores.cor_base} P`);
      // listar (vivo) e previa usam o MESMO retrato_core
      const pv = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [rv.id])).r.produtos[0].retrato;
      expect(pv).toEqual(rr);
    });
  });

  it("(b) loja SEM formato: a escolha fica guardada ({partes: []…}, admin da loja via RLS); SKU segue 'sem_formato'; _skus_calc_ref_tipo ≡ cfg NULL", async () => {
    await withTx(async (c) => {
      await prepara8(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await skuConfig(c, null);
      const m = await modeloInterno(c);
      const calc = async () => (await c.query(`SELECT * FROM public._skus_calc_ref_tipo($1, $2, 'letra') ORDER BY variante_key, tamanho_key`, [m.id, m.ref])).rows;
      const semCfg = await calc();
      // admin da loja grava SÓ a escolha, pela RLS (como o FormatoSkuCard faz)
      await comoUsuarioCom(c, "00000000-0000-4000-8000-0000000c0801", [], { tenantAdmin: true });
      await c.query("SET LOCAL ROLE authenticated");
      const upd = await c.query(`UPDATE public.tenant_config SET sku_config = '{"cor_no_nome": "cor_apelido"}'::jsonb WHERE tenant_id = $1`, [T]);
      await c.query("RESET ROLE");
      expect(upd.rowCount).toBe(1);
      const cfg = (await um<{ s: any }>(c, `SELECT sku_config AS s FROM public.tenant_config WHERE tenant_id = $1`, [T])).s;
      expect(cfg).toEqual({ partes: [], separadores: {}, cor_no_nome: "cor_apelido" });
      await comoUsuario(c, U);
      expect((await um<{ r: any }>(c, `SELECT public._skus_matriz_ref_tipo($1, $2, 'letra') AS r`, [m.id, m.ref])).r.status).toBe("sem_formato");
      expect((await um<{ r: any }>(c, `SELECT public._skus_plano($1, $2, 'letra', '[]'::jsonb, 'regerar') AS r`, [m.id, m.ref])).r.status).toBe("sem_formato");
      expect((await um<{ r: any }>(c, `SELECT public.skus_previa($1, $2, 'letra', '[]'::jsonb, 'regerar') AS r`, [m.id, m.ref])).r.status).toBe("sem_formato");
      expect(await calc()).toEqual(semCfg);
      // o retrato usa a escolha (Apelido) mesmo sem formato do SKU
      const r = await retrato(c, m.id);
      expect(variantes(r)[0].valores.nome).toBe(`${r.linhas[0].valores.nome} ${variantes(r)[0].valores.cor_apelido} P`);
      // e a chave convive com um formato: gravar partes mantém a escolha
      await skuConfig(c, { ...FORMATO, cor_no_nome: "cor_apelido" });
      expect((await um<{ s: any }>(c, `SELECT sku_config AS s FROM public.tenant_config WHERE tenant_id = $1`, [T])).s)
        .toEqual({ ...FORMATO, cor_no_nome: "cor_apelido" });
      expect((await um<{ r: any }>(c, `SELECT public._skus_matriz_ref_tipo($1, $2, 'letra') AS r`, [m.id, m.ref])).r.status).not.toBe("sem_formato");
    });
  });

  it("(c) valor inválido = P0001 com a mensagem PT; anti-drift: CASOS_CONFIG ≡ _sku_config_normaliza; nomeSublinha/corNoNomeEfetiva ≡ SQL", async () => {
    await withTx(async (c) => {
      await prepara8(c);
      expect(await falha(c, `UPDATE public.tenant_config SET sku_config = '{"partes": ["ref"], "cor_no_nome": "apelido"}'::jsonb WHERE tenant_id = $1`, [T]))
        .toEqual({ code: "P0001", message: "Cor no nome da sublinha inválida (use cor_base ou cor_apelido)." });
      for (const k of CASOS_CONFIG) {
        const q = "SELECT public._sku_config_normaliza($1::jsonb) AS v";
        const p = [JSON.stringify(k.entrada)];
        if ("erro" in k) {
          const e = await falha(c, q, p);
          expect({ code: e.code, message: e.message }, JSON.stringify(k.entrada)).toEqual({ code: "P0001", message: k.erro });
        } else {
          expect((await um<any>(c, q, p)).v, JSON.stringify(k.entrada)).toEqual(k.esperado);
        }
      }
      for (const k of CASOS_COR_NO_NOME) {
        const v = (await um<{ v: string }>(c, "SELECT public._integracao_cor_no_nome($1::jsonb) AS v", [k.cfg === null ? null : JSON.stringify(k.cfg)])).v;
        expect(v, JSON.stringify(k.cfg)).toBe(k.esperado);
      }
      for (const k of CASOS_NOME_SUBLINHA) {
        const v = (await um<{ v: string | null }>(c, "SELECT public._integracao_nome_sublinha($1, $2, $3, $4, $5) AS v",
          [k.nome, k.base, k.apelido, k.tam, k.modo])).v;
        expect(v, JSON.stringify(k)).toBe(k.esperado);
      }
    });
  });

  it("(d) marcar → retrato v2 com a cor → integracao_linhas coloridas → _integracao_ler entrega os nomes com a cor", async () => {
    await withTx(async (c) => {
      await prepara8(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await skuConfig(c, FORMATO);
      await camposLoja(c, CAMPOS_PADRAO);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const p = await ip(c, m.id);
      expect(p.estado).toBe("integravel");
      expect(p.retrato.v).toBe(2);
      const nome = p.retrato.linhas[0].valores.nome!;
      const cb = variantes(p.retrato)[0].valores.cor_base!;
      expect(await nomesLinhas(c, m.id)).toEqual([`${nome} ${cb} P`, `${nome} ${cb} M`]);
      const k = (await um<{ r: any }>(c, `SELECT public.integracao_chave_criar($1) AS r`, ["ERP Nome Cor"])).r;
      const sha = createHash("sha256").update(k.chave).digest("hex");
      const r = (await um<{ r: any }>(c, `SELECT public._integracao_ler($1, false, NULL, NULL, 'normal', '203.0.113.80') AS r`, [sha])).r;
      expect(r.status).toBe("ok");
      const prod = r.produtos.find((x: any) => x.modelo_id === m.id);
      expect(prod.assinatura).toBe(p.assinatura);
      const iNome = CAMPOS_PADRAO.indexOf("nome");
      expect(prod.linhas.filter((l: any) => l.tipo === "variante").map((l: any) => l.valores[iNome])).toEqual([`${nome} ${cb} P`, `${nome} ${cb} M`]);
    });
  });

  it("(e) P-127 B: integráveis v1 reprocessados (só o nome; P-129 cor do retrato se marcada, senão viva); integrados intocados; log; reaplicar = 0", async () => {
    await withTx(async (c) => {
      await voltaSePreciso(c);
      expect(await md5Vivo(c, RETRATO)).toBe(antesDe(RETRATO));
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // Formato com cor_apelido ⇒ o padrão DERIVADO é o Apelido (o normalizador de antes nem guardaria a chave explícita)
      await skuConfig(c, { partes: ["ref", "cor_base", "cor_apelido", "tamanho"] });
      await camposLoja(c, CAMPOS_PADRAO);
      const A = await modeloInterno(c); // Nome + cores marcados
      const D = await modeloInterno(c); // idem; o apelido é renomeado DEPOIS de marcar (P-129: vale o do retrato)
      const R = await revenda(c); // revenda, Nome + cores
      const I = await modeloInterno(c); // vira integrado
      for (const x of [A, D, R, I]) await marcar(c, x.id);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "nome"));
      const B = await modeloInterno(c); // SEM Nome marcado
      await marcar(c, B.id);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "cor_base" && k !== "cor_apelido"));
      const E = await modeloInterno(c); // Nome marcado, cores NÃO ⇒ cor VIVA do cadastro
      await marcar(c, E.id);
      await camposLoja(c, CAMPOS_PADRAO);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [I.id]);
      await c.query(`UPDATE public.cores_apelido SET nome = nome || ' Novo' WHERE id = $1`, [D.apelidoId]);
      await c.query(`UPDATE public.cores_apelido SET nome = nome || ' Novo' WHERE id = $1`, [E.apelidoId]);
      const antes: Record<string, Ip> = {};
      for (const [k, x] of Object.entries({ A, D, R, I, B, E })) antes[k] = await ip(c, x.id);
      for (const k of ["A", "D", "R", "B", "E"]) expect(antes[k].retrato.v, k).toBe(1);
      const nLogAntes = (await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.integracao_log WHERE tenant_id = $1`, [T])).n;

      await aplica(c, MIG);

      const depois: Record<string, Ip> = {};
      for (const [k, x] of Object.entries({ A, D, R, I, B, E })) depois[k] = await ip(c, x.id);
      // integrado: byte a byte (produto + linhas)
      expect(depois.I).toEqual(antes.I);
      for (const k of ["A", "D", "R", "B", "E"]) {
        const d = depois[k];
        expect(d.retrato.v, k).toBe(2);
        expect(d.rev, k).toBe(antes[k].rev + 1);
        expect(d.marcado_em, k).toBe(antes[k].marcado_em);
        expect(d.estado, k).toBe("integravel");
        expect(d.assinatura, k).toBe((await um<{ a: string }>(c, `SELECT public._integracao_assinar($1::jsonb) AS a`, [d.retrato_txt])).a);
        expect(d.assinatura, k).not.toBe(antes[k].assinatura);
        // só o nome das sublinhas (e v) mudou no retrato
        const semNome = (r: Retrato) => ({ ...r, v: 0, linhas: r.linhas.map((l) => ({ ...l, valores: { ...l.valores, nome: l.tipo === "variante" ? "*" : l.valores.nome } })) });
        expect(semNome(d.retrato), k).toEqual(semNome(antes[k].retrato));
        // linhas da API = retrato
        expect(await nomesLinhas(c, [A, D, R, I, B, E][["A", "D", "R", "I", "B", "E"].indexOf(k)].id), k)
          .toEqual(variantes(d.retrato).map((l) => l.valores.nome ?? null));
      }
      const nomeDe = (k: string) => depois[k].retrato.linhas[0].valores.nome;
      // A (Apelido derivado): nome + apelido + tamanho; e = o retrato_core FRESCO byte a byte (sem drift)
      expect(variantes(depois.A.retrato).map((l) => l.valores.nome))
        .toEqual(variantes(depois.A.retrato).map((l) => `${nomeDe("A")} ${l.valores.cor_apelido} ${l.valores.tamanho}`));
      expect(JSON.stringify(await retrato(c, A.id))).toBe(JSON.stringify(depois.A.retrato));
      const fresco = (await um<{ t: string }>(c,
        `SELECT (public._integracao_retrato_core($1, p.campos, public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato')::text AS t
           FROM public.integracao_produtos p WHERE p.modelo_id = $1`, [A.id])).t;
      expect(fresco).toBe(depois.A.retrato_txt);
      expect(JSON.stringify(await retrato(c, R.id))).toBe(JSON.stringify(depois.R.retrato));
      // D (P-129): cores marcadas ⇒ a do RETRATO (o apelido renomeado depois NÃO entra)
      expect(variantes(depois.D.retrato)[0].valores.cor_apelido).not.toMatch(/ Novo$/);
      expect(variantes(depois.D.retrato)[0].valores.nome).toBe(`${nomeDe("D")} ${variantes(depois.D.retrato)[0].valores.cor_apelido} P`);
      // E (P-129): cores NÃO marcadas ⇒ a VIVA do cadastro (renomeada)
      const apE = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.cores_apelido WHERE id = $1`, [E.apelidoId])).n;
      expect(apE).toMatch(/ Novo$/);
      expect(variantes(depois.E.retrato).map((l) => l.valores.nome)).toEqual([`${nomeDe("E")} ${apE} P`, `${nomeDe("E")} ${apE} M`]);
      // B: Nome não marcado ⇒ sem nome nenhum; só v + assinatura
      expect(variantes(depois.B.retrato).every((l) => !("nome" in l.valores))).toBe(true);
      // log: 1 'editar' por produto com nome mudado (A, D, R, E), nenhum p/ B/I
      for (const [k, x] of Object.entries({ A, D, R, E })) {
        const l = await logs(c, x.id);
        expect(l.length, k).toBe(1);
        expect(l[0].acao).toBe("editar");
        expect(l[0].quem).toBe("Sistema (cor no nome das sublinhas)");
        expect(l[0].detalhe).toMatchObject({
          reprocesso: "nome_sublinhas_cor", cor_no_nome: "cor_apelido", sublinhas: 2,
          assinatura_antes: antes[k].assinatura, assinatura_depois: depois[k].assinatura,
          nomes_antes: variantes(antes[k].retrato).map((v) => ({ ordem: v.ordem, nome: v.valores.nome })),
          exemplo: { antes: variantes(antes[k].retrato)[0].valores.nome, depois: variantes(depois[k].retrato)[0].valores.nome },
        });
      }
      for (const x of [B, I]) expect(await logs(c, x.id)).toEqual([]);
      const nLogDepois = (await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.integracao_log WHERE tenant_id = $1`, [T])).n;
      expect(nLogDepois - nLogAntes).toBe(4);
      // reaplicar: idempotente — 0 reprocessados, nenhum log novo, nada muda
      await aplica(c, MIG);
      for (const [k, x] of Object.entries({ A, D, R, I, B, E })) expect(await ip(c, x.id), k).toEqual(depois[k]);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.integracao_log WHERE tenant_id = $1`, [T])).n).toBe(nLogDepois);
    });
  });

  it("(e2) reprocesso recusa (e desfaz tudo) nome de sublinha fora do padrão e variante que sumiu do cadastro", async () => {
    await withTx(async (c) => {
      await voltaSePreciso(c);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await skuConfig(c, FORMATO);
      await camposLoja(c, CAMPOS_PADRAO);
      const A = await modeloInterno(c);
      await marcar(c, A.id);
      await c.query(`UPDATE public.integracao_produtos SET retrato = jsonb_set(retrato, '{linhas,1,valores,nome}', '"Outro Nome P"') WHERE modelo_id = $1`, [A.id]);
      await expect(aplica(c, MIG)).rejects.toThrow(/integracao_nome_cor: nome da sublinha fora do padrao/);
      expect(await md5Vivo(c, RETRATO)).toBe(antesDe(RETRATO)); // desfeito inteiro (savepoint do harness)
      await c.query(`UPDATE public.integracao_produtos SET estado = 'nao_integravel' WHERE modelo_id = $1`, [A.id]);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "cor_base" && k !== "cor_apelido"));
      const E = await modeloInterno(c);
      await marcar(c, E.id);
      await c.query(`DELETE FROM public.modelo_tecido_variantes mtv USING public.modelo_tecidos mt
                      WHERE mt.id = mtv.modelo_tecido_id AND mt.modelo_id = $1`, [E.id]);
      await expect(aplica(c, MIG)).rejects.toThrow(/integracao_nome_cor: variante da sublinha nao encontrada/);
      expect(await md5Vivo(c, RETRATO)).toBe(antesDe(RETRATO));
    });
  });

  it("(f) modo teste da API: 'Produto Exemplo 1 Cor Exemplo P' (e o resto do exemplo igual)", async () => {
    await withTx(async (c) => {
      await prepara8(c);
      const r = (await um<{ r: any }>(c, `SELECT public._integracao_exemplo($1::text[], 1) AS r`, [LAYOUT])).r;
      const p1 = r.produtos[0];
      expect(p1.linhas.map((l: any) => l.valores[0])).toEqual(["Produto Exemplo 1", "Produto Exemplo 1 Cor Exemplo P", "Produto Exemplo 1 Cor Exemplo M"]);
      expect(r.produtos[1].linhas[1].valores[0]).toBe("Produto Exemplo 2 Cor Exemplo P");
      await comoUsuario(c, U);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_exemplo() AS r`)).r.produtos[0].modelo_id).toBe("exemplo-0001");
    });
  });

  it("(g) banco: as 7 com o texto do arquivo, ACL {postgres,service_role} (#9); as 10 que não podem mudar com o md5 de antes", async () => {
    await withTx(async (c) => {
      await prepara8(c);
      for (const fn of [...NOVAS, ...REDEF]) {
        const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn])).d;
        expect(d, fn).toBe(corpo(MIG, cria(fn)));
        const a = await um<any>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure($1)) AS acl`, [fn]);
        expect(a, fn).toEqual({ anon: false, auth: false, acl: "{postgres=X/postgres,service_role=X/postgres}" });
      }
      for (const [fn, m] of Object.entries(IGUAIS)) expect(await md5Vivo(c, fn), fn).toBe(m);
    });
  });

  it("(g2) guarda: uma das 5 com OUTRO texto (outra frente) ⇒ a migration RECUSA e nada fica", async () => {
    await withTx(async (c) => {
      await voltaSePreciso(c);
      const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [REDEF[4]])).d;
      await c.query(d.replace("'Produto Exemplo ' || v_i", "'Produto Exemplo ' || v_i || ''"));
      await expect(aplica(c, MIG)).rejects.toThrow(/integracao_nome_cor: public\._integracao_exemplo\(text\[\],integer\) com texto inesperado/);
      for (const f of NOVAS) expect(await md5Vivo(c, f), f).toBeNull();
      expect(await md5Vivo(c, RETRATO)).toBe(antesDe(RETRATO));
    });
  });

  it("(h) ida → volta (confirmação) → md5 de antes, novas somem, integráveis restaurados (assinatura = a de antes), chave removida → ida de novo", async () => {
    await withTx(async (c) => {
      await voltaSePreciso(c);
      const md5s = async () => { const o: Record<string, string | null> = {}; for (const f of [...NOVAS, ...REDEF]) o[f] = await md5Vivo(c, f); return o; };
      const estadoAntes = await md5s();
      expect(estadoAntes).toEqual({ ...Object.fromEntries(NOVAS.map((f) => [f, null])), ...Object.fromEntries(G.redef.map((g) => [g.fn, g.antes])) });
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await skuConfig(c, FORMATO);
      await camposLoja(c, CAMPOS_PADRAO);
      const A = await modeloInterno(c);
      await marcar(c, A.id);
      const a0 = await ip(c, A.id);
      // ida
      await aplica(c, MIG);
      expect(await md5s()).toEqual(Object.fromEntries([...G.novas.map((g) => [g.fn, g.depois]), ...G.redef.map((g) => [g.fn, g.depois])]));
      const a1 = await ip(c, A.id);
      expect(a1.retrato.v).toBe(2);
      expect(a1.linhas).not.toBe(a0.linhas);
      // marcado DEPOIS da ida (v2 sem log) + a escolha gravada numa loja
      const B = await modeloInterno(c);
      await marcar(c, B.id);
      const b1 = await ip(c, B.id);
      await c.query(`UPDATE public.tenant_config SET sku_config = sku_config || '{"cor_no_nome": "cor_apelido"}'::jsonb WHERE tenant_id = $1`, [T]);
      // volta SEM confirmação: recusa (há loja com a escolha)
      await expect(aplica(c, INV)).rejects.toThrow(/integracao_nome_cor_volta: \d+ loja\(s\) gravaram a escolha/);
      expect(await md5Vivo(c, RETRATO)).toBe(depoisDe(RETRATO));
      await c.query("SET LOCAL app.confirmo_voltar_cor_no_nome = 'sim'");
      await aplica(c, INV);
      await c.query("SET LOCAL app.confirmo_voltar_cor_no_nome = ''");
      expect(await md5s()).toEqual(estadoAntes);
      const a2 = await ip(c, A.id);
      expect(a2.retrato_txt).toBe(a0.retrato_txt);
      expect(a2.assinatura).toBe(a0.assinatura);
      expect(a2.rev).toBe(a0.rev + 2);
      expect(await nomesLinhas(c, A.id)).toEqual(variantes(a0.retrato).map((l) => l.valores.nome));
      const b2 = await ip(c, B.id);
      expect({ ...b2, rev: 0 }).toEqual({ ...b1, rev: 0 }); // marcado depois: fica (nome com cor, v2)
      expect((await um<{ s: any }>(c, `SELECT sku_config AS s FROM public.tenant_config WHERE tenant_id = $1`, [T])).s).toEqual(FORMATO);
      // volta de novo = idempotente (nada a restaurar; sem chave ⇒ sem confirmação)
      await aplica(c, INV);
      expect(await md5s()).toEqual(estadoAntes);
      // ida de novo: md5 de depois; A reprocessado de novo (2º log); B (v2) não
      await aplica(c, MIG);
      expect(await md5s()).toEqual(Object.fromEntries([...G.novas.map((g) => [g.fn, g.depois]), ...G.redef.map((g) => [g.fn, g.depois])]));
      const a3 = await ip(c, A.id);
      expect(a3.retrato_txt).toBe(a1.retrato_txt);
      expect(a3.assinatura).toBe(a1.assinatura);
      expect((await logs(c, A.id)).length).toBe(2);
      expect(await logs(c, B.id)).toEqual([]);
    });
  });
});
