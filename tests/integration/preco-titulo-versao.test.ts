/**
 * PREÇO ANTERIOR E TÍTULO POR VERSÃO (P-146..P-159) — migration 20261018100000 (plano
 * .superpowers/sdd/2026-09-30-preco-anterior/plan.md v2 + rulings RB1–RB4/M4). SÓ na cópia local (exigeBancoLocal); txn
 * revertida (withTx): NADA é gravado.
 * Modos: sem PRECO_VERSAO_MIG_TXN a migration precisa estar APLICADA na cópia (psql -f); com PRECO_VERSAO_MIG_TXN=1 o
 * `prepara` volta a 20261018110000/20261018100000 (se vivas) e reaplica o arquivo DENTRO da txn (sem BEGIN/COMMIT e sem as
 * 2 travas SET LOCAL — NUNCA `\i`).
 *   (a) arquivos · (b) helper + composição + retrato (fixture §1.5, anti-drift com o TS) · (c) congelar ao excluir (§2.2)
 *   (d) falha fechada (lock) · (e) Replicar · (f) integráveis intactos + "i" · (g) RPC/ACL/fila · (h) ida → volta → ida
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, dbUrl, um } from "./db";
import { exigeBancoLocal } from "./mig-txn";
import {
  CAMPOS_PADRAO, LOCAL, T, U, aplica, camposLoja, comoUsuarioCom, imediato, ler, modeloInterno, voltaPrecoVersaoSePreciso, voltaR14IntegracaoSePreciso,
  MIG_PRECO_VERSAO, INV_PRECO_VERSAO,
} from "./integracao-helpers";
import { CASOS_VERSAO, LOJA_CASOS, type LinhaFamilia } from "../fixtures/versao-anterior-casos";
import { CASOS_CONGELAR, type LinhaCongelar } from "../fixtures/versao-congelar-casos";

const MIG = MIG_PRECO_VERSAO;
const INV = INV_PRECO_VERSAO;
const MIG_TXN = process.env.PRECO_VERSAO_MIG_TXN === "1";
const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");

const RETRATO = "public._integracao_retrato_core(uuid,text[],jsonb)";
const REPLICAR = "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)";
const MD5_ANTES: Record<string, string> = {
  [RETRATO]: "4cd22e4bb5bf081c1ac2fcf34d4a6cf2",
  [REPLICAR]: "aaf3f2e4e4bd8eb14b99d53c79a653da",
};
const INTERNAS = [
  "public._modelo_versao_anterior(uuid)", "public._modelo_automaticos(uuid)",
  "public.fn_modelo_versao_congelar_captura()", "public.fn_modelo_versao_congelar_aplicar()", RETRATO, REPLICAR,
];
const NOVAS = [
  "public._modelo_versao_anterior(uuid)", "public._modelo_automaticos(uuid)", "public.fn_modelo_versao_congelar_captura()",
  "public.fn_modelo_versao_congelar_aplicar()", "public.modelos_versao_anterior(uuid[])",
];
/** As trocas EXATAS do gerador (transcritas de mig/gerar.py): antes (inverso) + trocas = depois (migration). */
const MARCA = "[preco-versao v1]";
const TROCAS: Record<string, [string, string][]> = {
  [RETRATO]: [
    ["  v_preco_venda_efetivo numeric;\n", "  v_preco_venda_efetivo numeric;\n  v_preco_anterior_auto numeric;\n"],
    ["  v_titulo_auto := nullif(public._titulo_pagina_calculado(m.nome, v_loja_nome), '');\n",
      `  -- ${MARCA} P-146/P-155 B/P-158: automáticos pela VERSÃO ANTERIOR (_modelo_automaticos)\n` +
      "  SELECT a.titulo_auto, a.preco_auto INTO v_titulo_auto, v_preco_anterior_auto FROM public._modelo_automaticos(m.id) a;\n"],
    ["coalesce(m.preco_anterior, v_preco_venda_efetivo)", "coalesce(m.preco_anterior, v_preco_anterior_auto)"],
    // B2 (G-migration, fix round 1): os 2 comentários que descreviam a regra velha
    ["  -- 272/272 na copia). Titulo automatico = _titulo_pagina_calculado(nome, tenants.nome — a MARCA da loja).\n",
      `  -- 272/272 na copia). ${MARCA} Titulo e Preco anterior automaticos = _modelo_automaticos (abaixo): v2+ = da\n` +
      "  -- VERSAO ANTERIOR (titulo herdado, recursivo; preco de venda GRAVADO > 0 da anterior, senao vazio = falta); v1/orfa =\n" +
      "  -- titulo calculado do nome + loja e o proprio preco_venda. v_loja_nome/v_preco_venda_efetivo ficaram sem uso (diff minimo).\n"],
    ["  -- Preco anterior automatico = acompanha o preco de venda EFETIVO — a MESMA expressao que o retrato usa para\n" +
      "  -- \"Preço de venda\" (campo 'preco_venda' abaixo: m.preco_venda, sem outra fonte de preco efetivo nesta funcao).\n",
      `  -- ${MARCA} sem uso desde a 20261018100000 (o Preco anterior automatico vem de _modelo_automaticos acima).\n`],
  ],
  [REPLICAR]: [
    ["    insert into modelos (\n",
      `    -- ${MARCA} P-150 A/P-155 B: título e preço anterior nascem AUTOMÁTICOS (herdam da maior versão existente)\n    insert into modelos (\n`],
    ["o.altura_cm, o.titulo_pagina, o.ncm, o.preco_anterior, o.tamanho_tipo", "o.altura_cm, NULL, o.ncm, NULL, o.tamanho_tipo"],
  ],
};

/** Texto de CREATE ... $function$ de uma função no arquivo (o formato canônico do pg_get_functiondef + "\n"). */
function corpo(rel: string, sig: string): string {
  const t = ler(rel);
  const cab = `CREATE OR REPLACE FUNCTION ${sig.slice(0, sig.indexOf("(") + 1)}`;
  const i = t.indexOf(cab);
  const a = i < 0 ? -1 : t.indexOf("AS $function$", i);
  const f = a < 0 ? -1 : t.indexOf("$function$", a + "AS $function$".length);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${sig})`);
  if (t.indexOf(cab, i + 1) >= 0) throw new Error(`${rel}: ${sig} aparece mais de 1×`);
  return t.slice(i, f + "$function$".length) + "\n";
}

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query("SELECT to_regprocedure('public._modelo_versao_anterior(uuid)') IS NOT NULL AS ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const NA_COPIA = await jaAplicada();
const PRONTO = hasDb && LOCAL && (MIG_TXN || NA_COPIA);

async function timeouts(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
}
/** Estado de DEPOIS (com MIG_TXN reaplica na txn, voltando antes a T5/esta se vivas). */
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) {
    await voltaPrecoVersaoSePreciso(c);
    await aplica(c, MIG);
  }
  const r = await um<{ ok: boolean }>(c, "SELECT to_regprocedure('public._modelo_versao_anterior(uuid)') IS NOT NULL AS ok");
  if (!r.ok) throw new Error("migration 20261018100000 ausente — aplique na cópia ou rode com PRECO_VERSAO_MIG_TXN=1");
  const loja = await um<{ n: string }>(c, "SELECT nome AS n FROM public.tenants WHERE id = $1", [T]);
  if (loja.n !== LOJA_CASOS) await c.query("UPDATE public.tenants SET nome = $2 WHERE id = $1", [T, LOJA_CASOS]);
}
const md5Vivo = async (c: Client, sig: string): Promise<string | null> =>
  (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;

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

// ─────────────────────────────── fixtures (dentro da txn) ───────────────────────────────
async function outraLoja(c: Client): Promise<string> {
  return (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
}
async function colecao(c: Client, nome: string): Promise<string> {
  return (await um<{ id: string }>(c,
    "INSERT INTO public.colecoes (tenant_id, nome, status) VALUES ($1, $2, 'rascunho') RETURNING id", [T, nome])).id;
}
async function montaFamilia(c: Client, familia: readonly LinhaCongelar[] | readonly LinhaFamilia[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const outra = await outraLoja(c);
  const cols: Record<string, string> = {};
  for (const l of familia as LinhaCongelar[]) {
    if (l.colecaoOtb && !cols[l.colecaoOtb]) cols[l.colecaoOtb] = await colecao(c, `PV ${l.colecaoOtb} ${Date.now()}`);
    const id = (await um<{ id: string }>(c,
      `INSERT INTO public.modelos (tenant_id, nome, versao, created_at, preco_venda, preco_anterior, titulo_pagina, modelo_base_id,
                                   colecao, colecao_id, origem)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [l.outraLoja ? outra : T, l.nome, l.versao, l.created_at, l.preco_venda, l.preco_anterior ?? null, l.titulo_pagina ?? null,
        l.base ? ids[l.base] : null, l.colecao ?? null, l.colecaoOtb ? cols[l.colecaoOtb] : null, l.origem ?? "interno"])).id;
    ids[l.k] = id;
    if (l.integravel) {
      await c.query("INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado) VALUES ($1, $2, 'integravel')", [T, id]);
    }
  }
  return { ...ids, ...Object.fromEntries(Object.entries(cols).map(([k, v]) => [`colecao:${k}`, v])) };
}
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ─────────────────────────────── (a) estático: arquivos ───────────────────────────────
describe("preço/título por versão — (a) arquivos da migration e do inverso (estático)", () => {
  it("encoding 1º; 1 BEGIN/1 COMMIT; as 2 travas logo depois do BEGIN (500ms/10s); NOTIFY antes do COMMIT", () => {
    for (const rel of [MIG, INV]) {
      const linhas = ler(rel).split("\n");
      expect(linhas.find((l) => l.trim() !== "" && !l.startsWith("--")), rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      const b = linhas.indexOf("BEGIN;");
      expect(linhas.slice(b + 1, b + 3), rel).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '10s';"]);
      const t = ler(rel);
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeLessThan(t.indexOf("\nCOMMIT;"));
      expect(t, rel).not.toMatch(/^\s*\\/m); // nenhum meta-comando psql
    }
  });
  it("ida: guarda → fotografia → funções → pós PESADA → CREATE TRIGGER em modelos POR ÚLTIMO → pós leve → NOTIFY (RB4)", () => {
    const t = ler(MIG);
    const ordem = [
      "DO $guarda$", "PERFORM set_config('app.pv_ip'", "CREATE OR REPLACE FUNCTION public._modelo_versao_anterior(",
      "CREATE OR REPLACE FUNCTION public._integracao_retrato_core(", "CREATE TABLE IF NOT EXISTS public.modelo_versao_congelar_fila",
      "CREATE OR REPLACE FUNCTION public.modelos_versao_anterior(", "COMMENT ON COLUMN public.modelos.preco_anterior", "DO $pos$",
      "CREATE TRIGGER trg_modelo_versao_congelar_captura", "DO $pos2$", "NOTIFY pgrst",
    ];
    const pos = ordem.map((s) => t.indexOf(s));
    for (let i = 0; i < ordem.length; i++) expect(pos[i], ordem[i]).toBeGreaterThan(-1);
    for (let i = 1; i < ordem.length; i++) expect(pos[i], `${ordem[i - 1]} antes de ${ordem[i]}`).toBeGreaterThan(pos[i - 1]);
    // o único DDL em modelos (fora COMMENT) é o CREATE TRIGGER, e ele vem depois da pós-condição pesada
    expect(t.match(/ON public\.modelos\b/g)?.length).toBe(1);
    expect(t).toContain("current_setting('app.pv_ip', true) IS DISTINCT FROM");
    expect(t).toContain("p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato)");
  });
  it("inverso: exige a confirmação e avisa que os congelados FICAM; guarda exige o texto de DEPOIS e a fila vazia", () => {
    const t = ler(INV);
    expect(t).toContain("current_setting('app.confirmo_voltar_preco_versao', true)");
    expect(t).toMatch(/congelados por exclus[õo]es feitas depois da ida FICAM gravados/i);
    expect(t).toContain("EXISTS (SELECT 1 FROM public.modelo_versao_congelar_fila)");
    expect(t).toContain("integracao_versoes_integradas(uuid[])"); // LIFO: T5 volta antes
    // B3 (G-migration, fix round 1): o gatilho de captura em modelos (AccessExclusive) cai SÓ depois de restaurar as 2 funções
    const iDrop = t.indexOf("DROP TRIGGER IF EXISTS trg_modelo_versao_congelar_captura ON public.modelos;");
    expect(iDrop).toBeGreaterThan(t.indexOf("CREATE OR REPLACE FUNCTION public._integracao_retrato_core("));
    expect(iDrop).toBeGreaterThan(t.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core("));
    expect(iDrop).toBeLessThan(t.indexOf("DROP FUNCTION IF EXISTS public.fn_modelo_versao_congelar_captura();"));
  });
  it("as trocas do gerador = diff do inverso para a migration (só as 7 trocas nas 2 redefinidas + objetos novos)", () => {
    for (const sig of [RETRATO, REPLICAR]) {
      const antes = corpo(INV, sig);
      const depois = corpo(MIG, sig);
      expect(md5(antes), `${sig} antes`).toBe(MD5_ANTES[sig]);
      let x = antes;
      for (const [velho, novo] of TROCAS[sig]) {
        expect(x.split(velho).length - 1, `${sig}: âncora ${velho.slice(0, 50)}`).toBe(1);
        x = x.split(velho).join(novo);
      }
      expect(x, sig).toBe(depois);
    }
    // o inverso não recria nenhuma das novas; a ida cria todas
    for (const sig of NOVAS) {
      expect(ler(MIG), sig).toContain(`CREATE OR REPLACE FUNCTION ${sig.slice(0, sig.indexOf("("))}(`);
      expect(ler(INV), sig).not.toContain(`CREATE OR REPLACE FUNCTION ${sig.slice(0, sig.indexOf("("))}(`);
    }
  });
});

// ─────────────────────────────── (b) helper + composição + retrato ───────────────────────────────
describe.skipIf(!PRONTO)("preço/título por versão — (b) helper, composição e retrato (fixture §1.5)", () => {
  for (const caso of CASOS_VERSAO) {
    it(caso.nome, async () => {
      await withTx(async (c) => {
        await prepara(c);
        const ids = await montaFamilia(c, caso.familia);
        const alvo = ids[caso.alvo];
        const { rows: hs } = await c.query("SELECT * FROM public._modelo_versao_anterior($1)", [alvo]);
        if (caso.helper === null) {
          expect(hs.length, "helper sem anterior = 0 linhas").toBe(0);
        } else {
          expect(hs.length).toBe(1);
          expect(hs[0].anterior_id).toBe(ids[caso.helper.anterior]);
          expect(hs[0].anterior_versao).toBe(caso.helper.anterior_versao);
          expect(n(hs[0].anterior_preco)).toBe(caso.helper.anterior_preco);
          expect(hs[0].titulo_herdado).toBe(caso.helper.titulo_herdado);
          expect(hs[0].titulo_origem_versao).toBe(caso.helper.titulo_origem_versao);
        }
        const { rows: as } = await c.query("SELECT * FROM public._modelo_automaticos($1)", [alvo]);
        expect(as.length, "RB3: SEMPRE 1 linha").toBe(1);
        expect({ ...as[0], preco_auto: n(as[0].preco_auto) }).toEqual(caso.composicao);
        const r = (await um<{ r: any }>(c,
          "SELECT public._integracao_retrato_core($1, ARRAY['preco_anterior','titulo']::text[], '{}'::jsonb) AS r", [alvo])).r;
        const v = r.retrato.linhas[0].valores;
        expect(v.preco_anterior, "retrato: preço anterior").toBe(caso.retrato.preco_anterior);
        expect(v.titulo, "retrato: título").toBe(caso.retrato.titulo);
        expect(r.faltas.some((f: any) => f.campo === "preco_anterior"), "falta 'Preço anterior' (P-159 A)").toBe(caso.retrato.faltaPrecoAnterior);
        expect(r.faltas.some((f: any) => f.campo === "titulo")).toBe(caso.retrato.titulo === null);
      });
    });
  }
  it("RB3: _modelo_automaticos de um modelo inexistente devolve 1 linha de NULLs (nunca 0 linhas)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query("SELECT * FROM public._modelo_automaticos(gen_random_uuid())");
      expect(rows).toEqual([{ preco_auto: null, preco_fonte: null, preco_versao: null, titulo_auto: null, titulo_fonte: null, titulo_versao: null }]);
    });
  });
});

// ─────────────────────────────── (c) congelar ao excluir ───────────────────────────────
describe.skipIf(!PRONTO)("preço/título por versão — (c) congelar ao excluir (fixture §2.2)", () => {
  for (const caso of CASOS_CONGELAR) {
    it(caso.nome, async () => {
      await withTx(async (c) => {
        await prepara(c);
        await comoUsuario(c, U);
        const ids = await montaFamilia(c, caso.familia);
        for (const grupo of caso.excluir) {
          const alvos = grupo.map((k) => ids[k]);
          if (caso.via === "sql") {
            await c.query("DELETE FROM public.modelos WHERE id = ANY($1::uuid[])", [alvos]);
          } else if (caso.via === "rls") {
            // o .delete().in("id", ids) do Planejamento: UM comando, sob RLS (authenticated)
            await c.query("SET LOCAL ROLE authenticated");
            const { rowCount } = await c.query("DELETE FROM public.modelos WHERE id = ANY($1::uuid[])", [alvos]);
            await c.query("RESET ROLE");
            expect(rowCount).toBe(alvos.length);
          } else {
            await c.query("SELECT public.otb_excluir_colecao($1)", [ids["colecao:X"]]);
          }
        }
        // loja B: a captura só anota a MESMA loja (antes do COMMIT a fila tem só as sobreviventes da loja do excluído)
        const { rows: fila } = await c.query("SELECT modelo_id, tenant_id FROM public.modelo_versao_congelar_fila");
        for (const f of fila) expect(f.tenant_id).toBe(T);
        for (const l of caso.familia) if (l.outraLoja) expect(fila.map((f) => f.modelo_id)).not.toContain(ids[l.k]);
        await imediato(c); // = o COMMIT (gatilho adiado)
        expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.modelo_versao_congelar_fila")).n).toBe("0");
        for (const [k, esp] of Object.entries(caso.esperado)) {
          const m = await um<{ p: string | null; t: string | null }>(c,
            "SELECT preco_anterior AS p, titulo_pagina AS t FROM public.modelos WHERE id = $1", [ids[k]]);
          expect(m, `${k} sumiu`).toBeTruthy();
          expect(n(m.p), `${k}: preço anterior`).toBe(esp.preco_anterior);
          expect(m.t, `${k}: título`).toBe(esp.titulo_pagina);
        }
        for (const grupo of caso.excluir) {
          const { rows } = await c.query("SELECT id FROM public.modelos WHERE id = ANY($1::uuid[])", [grupo.map((k) => ids[k])]);
          expect(rows.length, "excluídos").toBe(0);
        }
      });
    });
  }
  it("o congelamento sobe o rev da versão e audita em nome de quem excluiu", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c, U);
      const ids = await montaFamilia(c, CASOS_CONGELAR[0].familia);
      const rev0 = (await um<{ r: number }>(c, "SELECT rev AS r FROM public.modelos WHERE id = $1", [ids.b])).r;
      await c.query("DELETE FROM public.modelos WHERE id = $1", [ids.a]);
      await imediato(c);
      const rev1 = (await um<{ r: number }>(c, "SELECT rev AS r FROM public.modelos WHERE id = $1", [ids.b])).r;
      expect(rev1).toBeGreaterThan(rev0);
      const { rows } = await c.query(
        "SELECT user_id, dados FROM public.audit_log WHERE registro_id = $1 AND tabela = 'modelos' ORDER BY created_at DESC, id DESC", [ids.b]);
      expect(rows.length, "audit_log do congelamento").toBeGreaterThan(0);
      expect(rows.every((r) => r.user_id === U), "em nome de quem excluiu").toBe(true);
    });
  });
});

// ─────────────────────────────── (d) falha fechada + M1 (só trava quem congela) ───────────────────────────────
/** Dados COMMITADOS da cópia (a 2ª conexão precisa enxergar a linha): raiz r + filho f (versao >= 2), nenhum integrável. */
async function parCommitado(): Promise<{ r: string; f: string; v: number; t: string } | null> {
  if (!PRONTO || MIG_TXN) return null;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query(
      `SELECT r.id AS r, f.id AS f, f.versao AS v, f.tenant_id AS t
         FROM public.modelos f JOIN public.modelos r ON r.id = f.modelo_base_id AND r.tenant_id = f.tenant_id
        WHERE f.versao >= 2 AND f.preco_anterior IS NULL AND coalesce(r.preco_venda, 0) <> 777
          AND NOT EXISTS (SELECT 1 FROM public.integracao_produtos ip WHERE ip.modelo_id IN (r.id, f.id)
                            AND ip.estado IN ('integravel', 'integrado'))
        ORDER BY f.id LIMIT 1`)).rows[0] ?? null;
  } finally {
    await c.end();
  }
}
const PAR = await parCommitado();
if (PRONTO && !MIG_TXN && !PAR) {
  // B6 (G-migration, fix round 1): nunca passar em silêncio — sem família commitada na cópia, os 2 testes abaixo são PULADOS.
  // eslint-disable-next-line no-console
  console.warn("[preco-titulo-versao] (d) PULADO: a cópia não tem família commitada (raiz + filho versao >= 2) para a 2ª conexão travar.");
}
describe.skipIf(!PRONTO || MIG_TXN)("preço/título por versão — (d) falha FECHADA e M1 (2ª conexão real)", () => {
  it.skipIf(!PAR)("outra conexão segura a versão que congelaria (FOR UPDATE) → P0001 versao_congelar e a exclusão inteira volta (pula se a cópia não tiver família commitada)", async () => {
    const par = PAR!;
    const b = new Client({ connectionString: dbUrl()!, ssl: false });
    await b.connect();
    try {
      await withTx(async (c) => {
        await prepara(c);
        // Z = a anterior IMEDIATA do filho (versão logo abaixo, a mais nova no empate), com outro preço
        const z = (await um<{ id: string }>(c,
          `INSERT INTO public.modelos (tenant_id, nome, versao, preco_venda, modelo_base_id, created_at)
           VALUES ($1, 'PV LOCK Z', $2, 777, $3, now() + interval '1 day') RETURNING id`, [par.t, par.v - 1, par.r])).id;
        const antes = (await um<{ p: number }>(c, "SELECT preco_auto AS p FROM public._modelo_automaticos($1)", [par.f])).p;
        expect(Number(antes)).toBe(777);
        await b.query("BEGIN");
        await b.query("SELECT id FROM public.modelos WHERE id = $1 FOR UPDATE", [par.f]);
        await c.query("SAVEPOINT pv_lock");
        await c.query("DELETE FROM public.modelos WHERE id = $1", [z]);
        let err: { code?: string; message?: string } | null = null;
        const t0 = Date.now();
        try {
          await c.query("SET CONSTRAINTS ALL IMMEDIATE");
        } catch (e) {
          err = e as { code?: string; message?: string };
        }
        const ms = Date.now() - t0;
        await c.query("ROLLBACK TO SAVEPOINT pv_lock");
        await b.query("ROLLBACK");
        expect(err?.code).toBe("P0001");
        expect(err?.message).toBe("versao_congelar: 55P03");
        expect(ms).toBeGreaterThanOrEqual(1900); // lock_timeout de 2 s da função
        // a exclusão voltou (savepoint) e nada foi gravado no filho
        expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.modelos WHERE id = $1", [z])).n).toBe("1");
        expect((await um<{ p: string | null }>(c, "SELECT preco_anterior AS p FROM public.modelos WHERE id = $1", [par.f])).p).toBeNull();
      });
    } finally {
      await b.end();
    }
  }, 30_000);
  it.skipIf(!PAR)("M1: excluir o TOPO com as versões de baixo em edição por outra conexão (FOR NO KEY UPDATE) passa sem erro — ninguém congela, ninguém é travado (pula se a cópia não tiver família commitada)", async () => {
    const par = PAR!;
    const b = new Client({ connectionString: dbUrl()!, ssl: false });
    await b.connect();
    try {
      await withTx(async (c) => {
        await prepara(c);
        // Z = um NOVO topo da família (acima de tudo): excluí-lo não muda o automático de ninguém
        const topo = (await um<{ v: number }>(c,
          "SELECT max(versao) AS v FROM public.modelos WHERE id = $1 OR modelo_base_id = $1", [par.r])).v;
        const z = (await um<{ id: string }>(c,
          `INSERT INTO public.modelos (tenant_id, nome, versao, preco_venda, modelo_base_id)
           VALUES ($1, 'PV TOPO Z', $2, 555, $3) RETURNING id`, [par.t, Number(topo) + 1, par.r])).id;
        await b.query("BEGIN");
        await b.query("SELECT id FROM public.modelos WHERE id = ANY($1::uuid[]) FOR NO KEY UPDATE", [[par.r, par.f]]);
        await c.query("DELETE FROM public.modelos WHERE id = $1", [z]);
        const t0 = Date.now();
        await c.query("SET CONSTRAINTS ALL IMMEDIATE"); // antes do M1: FOR UPDATE em r e f → 55P03 → exclusão desfeita
        const ms = Date.now() - t0;
        await c.query("SET CONSTRAINTS ALL DEFERRED");
        await b.query("ROLLBACK");
        expect(ms).toBeLessThan(1500);
        expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.modelos WHERE id = $1", [z])).n).toBe("0");
        expect((await um<{ n: string }>(c, "SELECT count(*) AS n FROM public.modelo_versao_congelar_fila")).n).toBe("0");
      });
    } finally {
      await b.end();
    }
  }, 30_000);
});

// ─────────────────────────────── (e) Replicar ───────────────────────────────
describe.skipIf(!PRONTO)("preço/título por versão — (e) Replicar do Plan. Tecido nasce AUTOMÁTICO (P-150 A/P-155 B)", () => {
  it("origem com Título e Preço anterior digitados → réplica com os 2 NULL; automático = o da MAIOR versão existente", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ids = await montaFamilia(c, [
        { k: "o", versao: 1, created_at: "2026-09-01T12:00:00Z", nome: "VESTIDO ORIGEM", preco_venda: 200, base: null,
          preco_anterior: 111, titulo_pagina: "Titulo Origem" },
        { k: "v2", versao: 2, created_at: "2026-09-02T12:00:00Z", nome: "VESTIDO ORIGEM", preco_venda: 300, base: "o" },
      ]);
      const destino = await colecao(c, `PV destino ${Date.now()}`);
      await comoUsuario(c, U);
      const r = (await um<{ r: any }>(c,
        "SELECT public._replicar_cards_plan_tecido_core($1, $2, NULL, ARRAY[$3::uuid], NULL) AS r", [T, destino, ids.o])).r;
      const novo = await um<{ id: string; versao: number; base: string; p: string | null; t: string | null }>(c,
        `SELECT id, versao, modelo_base_id AS base, preco_anterior AS p, titulo_pagina AS t
           FROM public.modelos WHERE colecao_id = $1`, [destino]);
      expect(r).toBeTruthy();
      expect(novo.versao).toBe(3);
      expect(novo.base).toBe(ids.o);
      expect(novo.p).toBeNull();
      expect(novo.t).toBeNull();
      const a = await um<{ preco_auto: string; preco_fonte: string; preco_versao: number; titulo_auto: string }>(c,
        "SELECT * FROM public._modelo_automaticos($1)", [novo.id]);
      expect(Number(a.preco_auto)).toBe(300); // a v2 (a MAIOR existente), não a origem
      expect(a.preco_versao).toBe(2);
      expect(a.titulo_auto).toBe("Titulo Origem"); // herdado recursivo: v2 automática → o digitado da v1
    });
  });
});

// ─────────────────────────────── (f) integráveis intactos + "i" ───────────────────────────────
describe.skipIf(!PRONTO)("preço/título por versão — (f) integráveis: retrato, assinatura e linhas INTACTOS; o 'i' aparece", () => {
  it("volta → marca Integrável (regra velha) → ida: nada muda no integrável; retrato_difere ganha preco_anterior/titulo", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      await voltaPrecoVersaoSePreciso(c); // estado de ANTES dentro da txn
      expect(await md5Vivo(c, RETRATO)).toBe(MD5_ANTES[RETRATO]);
      await comoUsuario(c, U);
      await camposLoja(c, CAMPOS_PADRAO);
      const v1 = (await um<{ id: string }>(c,
        "INSERT INTO public.modelos (tenant_id, nome, versao, preco_venda) VALUES ($1, 'VESTIDO PAI INTEGRADO', 1, 500) RETURNING id", [T])).id;
      const m = await modeloInterno(c, { nome: "Blusa Filha Integravel" });
      await c.query(
        "UPDATE public.modelos SET preco_anterior = NULL, titulo_pagina = NULL, versao = 2, modelo_base_id = $2 WHERE id = $1", [m.id, v1]);
      const a = (await um<{ r: any }>(c, "SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r", [m.id])).r.produtos[0].assinatura;
      await c.query("SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))", [m.id, a]);
      const foto = async () => um<{ ip: string; linhas: string; ok: boolean }>(c,
        `SELECT p::text AS ip,
                (SELECT string_agg(l::text, '|' ORDER BY l.ordem) FROM public.integracao_linhas l WHERE l.modelo_id = p.modelo_id) AS linhas,
                p.assinatura = public._integracao_assinar(p.retrato) AS ok
           FROM public.integracao_produtos p WHERE p.modelo_id = $1`, [m.id]);
      const antes = await foto();
      expect(antes.ok).toBe(true);
      expect((await um<{ e: string }>(c, "SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1", [m.id])).e).toBe("integravel");
      const vAntes = JSON.parse((await um<{ r: string }>(c, "SELECT retrato::text AS r FROM public.integracao_produtos WHERE modelo_id = $1", [m.id])).r)
        .linhas[0].valores;
      expect(vAntes.preco_anterior).toBe("159.90"); // regra velha: o próprio preço de venda

      await c.query("RESET ROLE");
      await aplica(c, MIG); // IDA dentro da txn
      await comoUsuario(c, U);
      const depois = await foto();
      expect(depois.ip, "integracao_produtos intacto").toBe(antes.ip);
      expect(depois.linhas, "integracao_linhas intactas").toBe(antes.linhas);
      expect(depois.ok, "HMAC confere").toBe(true);
      const l = (await um<{ r: any }>(c, "SELECT public.integracao_listar('todos', jsonb_build_object('busca', 'Blusa Filha Integravel'), 1, 500) AS r")).r;
      const p = l.produtos.find((x: any) => x.modelo_id === m.id);
      expect(p.estado).toBe("integravel");
      expect(p.retrato_difere).toEqual(expect.arrayContaining(["preco_anterior", "titulo"]));
      expect(p.vivo.linhas[0].valores.preco_anterior).toBe("500.00"); // o vivo já segue a v1
      expect(p.vivo.linhas[0].valores.titulo).toBe(`Vestido Pai Integrado | ${(await um<{ n: string }>(c, "SELECT nome AS n FROM public.tenants WHERE id = $1", [T])).n}`);
    });
  }, 60_000);
});

// ─────────────────────────────── (g) RPC / ACL / fila ───────────────────────────────
describe.skipIf(!PRONTO)("preço/título por versão — (g) RPC modelos_versao_anterior, ACL e a fila", () => {
  it("1 linha por id DA LOJA (loja alheia fora; anterior_* NULL sem anterior); >500 → P0001 ASCII", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ids = await montaFamilia(c, [
        { k: "a", versao: 1, created_at: "2026-09-01T12:00:00Z", nome: "VESTIDO ALFA", preco_venda: 200, base: null },
        { k: "b", versao: 2, created_at: "2026-09-02T12:00:00Z", nome: "VESTIDO ALFA", preco_venda: 250, base: "a" },
        { k: "x", versao: 1, created_at: "2026-09-01T12:00:00Z", nome: "VESTIDO ALHEIO", preco_venda: 9, base: null, outraLoja: true },
      ]);
      await comoUsuario(c, U);
      await c.query("SET LOCAL ROLE authenticated");
      const { rows } = await c.query("SELECT * FROM public.modelos_versao_anterior($1::uuid[]) ORDER BY anterior_versao NULLS FIRST",
        [[ids.a, ids.b, ids.x]]);
      expect(rows.map((r) => r.modelo_id).sort()).toEqual([ids.a, ids.b].sort());
      const ra = rows.find((r) => r.modelo_id === ids.a);
      expect(ra).toEqual({ modelo_id: ids.a, anterior_id: null, anterior_versao: null, anterior_preco: null, titulo_herdado: null, titulo_origem_versao: null });
      const rb = rows.find((r) => r.modelo_id === ids.b);
      expect(rb.anterior_id).toBe(ids.a);
      expect(Number(rb.anterior_preco)).toBe(200);
      const muitos = Array.from({ length: 501 }, () => ids.a);
      const e = await falha(c, "SELECT * FROM public.modelos_versao_anterior($1::uuid[])", [muitos]);
      expect(e.code).toBe("P0001");
      expect(e.message).toBe("versao_anterior: limite de 500 ids");
      expect(/^[\x20-\x7e]*$/.test(e.message)).toBe(true);
      await c.query("RESET ROLE");
    });
  });
  it("ACL: internas revogadas dos TRÊS (#9); RPC: anon sem, authenticated com; fila RLS sem policy + REVOKE ALL", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const sig of INTERNAS) {
        for (const papel of ["public", "anon", "authenticated"]) {
          const r = await um<{ ok: boolean }>(c, "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS ok", [papel, sig]);
          expect(r.ok, `${papel} ${sig}`).toBe(false);
        }
      }
      const rpc = "public.modelos_versao_anterior(uuid[])";
      expect((await um<{ ok: boolean }>(c, "SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok", [rpc])).ok).toBe(false);
      expect((await um<{ ok: boolean }>(c, "SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS ok", [rpc])).ok).toBe(true);
      const f = await um<{ rls: boolean; pol: string; a: boolean; u: boolean }>(c,
        `SELECT c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::text AS pol,
                has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS a,
                has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS u
           FROM pg_class c WHERE c.oid = 'public.modelo_versao_congelar_fila'::regclass`);
      expect(f).toEqual({ rls: true, pol: "0", a: false, u: false });
      const g = await um<{ ok: boolean }>(c,
        `SELECT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_modelo_versao_congelar_aplicar' AND t.tgdeferrable
                          AND t.tginitdeferred AND t.tgenabled = 'O') AS ok`);
      expect(g.ok).toBe(true);
      // a captura vem ANTES da trava de exclusão da Integração (ordem alfabética dos BEFORE DELETE)
      expect("trg_modelo_versao_congelar_captura" < "trg_zz_integracao_trava_del").toBe(true);
    });
  });
  it("sem permissão de módulo nenhum, um usuário da loja lê a RPC (= RLS de modelos, sem gate de módulo)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ids = await montaFamilia(c, [{ k: "a", versao: 1, created_at: "2026-09-01T12:00:00Z", nome: "X", preco_venda: 1, base: null }]);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-000000000a01", []);
      await c.query("SET LOCAL ROLE authenticated");
      const { rows } = await c.query("SELECT modelo_id FROM public.modelos_versao_anterior($1::uuid[])", [[ids.a]]);
      await c.query("RESET ROLE");
      expect(rows.length).toBe(1);
    });
  });
});

// ─────────────────────────────── (h) ida → volta → ida ───────────────────────────────
describe.skipIf(!PRONTO)("preço/título por versão — (h) ida → volta → ida (dentro da txn) e congelados FICAM", () => {
  it("volta sem confirmação recusa; com ela restaura 4cd22e4b/aaf3f2e4 e apaga os novos; congelados continuam; ida de novo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c, U);
      const ids = await montaFamilia(c, CASOS_CONGELAR[0].familia);
      await c.query("DELETE FROM public.modelos WHERE id = $1", [ids.a]);
      await imediato(c);
      await c.query("RESET ROLE");
      // medios R14 (20261024200000, se viva) volta antes — LIFO (redefine o retrato por cima desta)
      await voltaR14IntegracaoSePreciso(c);
      // T5 (se viva) volta antes — LIFO
      if ((await um<{ ok: boolean }>(c, "SELECT to_regprocedure('public.integracao_versoes_integradas(uuid[])') IS NOT NULL AS ok")).ok) {
        await aplica(c, "supabase/rollback/20261018110000_integracao_versao_integrada_down.sql");
      }
      await c.query("SAVEPOINT pv_inv");
      await expect(aplica(c, INV)).rejects.toThrow(/confirme com SET app\.confirmo_voltar_preco_versao/);
      await c.query("ROLLBACK TO SAVEPOINT pv_inv");
      await c.query("SET LOCAL app.confirmo_voltar_preco_versao = 'sim'");
      await aplica(c, INV);
      await c.query("SET LOCAL app.confirmo_voltar_preco_versao = ''");
      for (const [sig, m] of Object.entries(MD5_ANTES)) expect(await md5Vivo(c, sig), `${sig} (volta)`).toBe(m);
      for (const sig of NOVAS) expect(await md5Vivo(c, sig), `${sig} some`).toBeNull();
      expect((await um<{ r: string | null }>(c, "SELECT to_regclass('public.modelo_versao_congelar_fila')::text AS r")).r).toBeNull();
      const b = await um<{ p: string; t: string }>(c, "SELECT preco_anterior AS p, titulo_pagina AS t FROM public.modelos WHERE id = $1", [ids.b]);
      expect(Number(b.p)).toBe(200); // congelado FICA (vale como digitado)
      expect(b.t).toBe(`Vestido Alfa | ${LOJA_CASOS}`);
      await aplica(c, MIG);
      for (const sig of [RETRATO, REPLICAR, ...NOVAS]) expect(await md5Vivo(c, sig), `${sig} (ida)`).toBe(md5(corpo(MIG, sig)));
      // reaplicar = no-op
      await aplica(c, MIG);
      for (const sig of [RETRATO, REPLICAR, ...NOVAS]) expect(await md5Vivo(c, sig), `${sig} (reaplicar)`).toBe(md5(corpo(MIG, sig)));
    });
  }, 60_000);
});
