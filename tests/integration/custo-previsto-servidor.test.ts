/**
 * CONTAS CERTAS C1 — custo previsto DERIVADO NO SERVIDOR (migration 20261019300000_custo_previsto_servidor.sql; plano
 * .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §2/§4 C1 + rulings R1/R2). SÓ na cópia local (ehBancoLocal) e
 * com a migration APLICADA (psql -f); txn revertida (withTx): NADA é gravado. `imediato()` = SET CONSTRAINTS ALL IMMEDIATE
 * + DEFERRED — simula o COMMIT para o gatilho adiado trg_custo_processar_fila (precedente kanban-auto.test.ts).
 * Dois testes fazem DDL de sabotagem (CREATE OR REPLACE dentro da txn revertida) e um usa uma 2ª conexão (trava de linha).
 *   (a) catálogo/ACL · (b) RC1 · (c) anti-drift SQL (tests/fixtures/custo-bom-casos.ts) · (d) RC3/RC4a/RC4b
 *   (e) P-169 A / R-CD1 (congelado) · (f) casos do plano-base · (g) R1 (nunca perde recálculo)
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, comoUsuario, semUsuario, um, dbUrl, ehBancoLocal, TENANT_TESTE } from "./db";
import {
  CASO_MODELO,
  CASOS_ADICIONAIS,
  CASOS_AVIAMENTO,
  CASOS_ETIQUETA,
  CASOS_TECIDO,
  MEIO_CENTAVO,
  type ArtigoCaso,
  type CasoAviamento,
  type CasoEtiqueta,
  type CasoTecido,
  type CorCaso,
} from "../fixtures/custo-bom-casos";

const T = TENANT_TESTE;
const LOCAL = hasDb && ehBancoLocal();

async function migracaoAplicada(): Promise<boolean> {
  if (!LOCAL) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT to_regprocedure('public._custo_recalcular_modelos(uuid,uuid[])') IS NOT NULL
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_processar_fila' AND tgenabled = 'O') AS ok`,
    );
    return r.rows[0].ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = LOCAL && (await migracaoAplicada());

const NOVAS = [
  "public._precos_tecido_congelado_core(uuid,uuid)",
  "public._custo_linha(numeric,numeric,numeric)",
  "public._custo_adicionais_soma(jsonb)",
  "public._custo_preco_tecido(uuid,uuid)",
  "public._custo_preco_etiqueta(uuid,uuid)",
  "public._custo_calcular(uuid,uuid[])",
  "public._custo_recalcular_modelos(uuid,uuid[])",
  "public._custo_enfileirar(uuid[],boolean)",
  "public.fn_custo_processar_fila()",
  "public.fn_custo_fila_por_modelo()",
  "public.fn_custo_fila_por_modelo_tecido()",
  "public.fn_custo_fila_preco()",
  "public.fn_custo_fila_cad()",
  "public.fn_custo_fila_modelo()",
  "public.fn_modelo_custo_derivado()",
];

// ─────────────────────────────── helpers ───────────────────────────────
let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const n = (v: unknown) => (v == null ? null : Number(v));

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await comoUsuario(c);
}
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function fila(c: Client): Promise<string[]> {
  const { rows } = await c.query(`SELECT modelo_id FROM public.custo_recalculo_fila ORDER BY modelo_id`);
  return rows.map((r) => r.modelo_id as string);
}
async function naFila(c: Client, id: string): Promise<boolean> {
  return (await fila(c)).includes(id);
}
type Custos = { peca: number | null; tecido: number | null; forro: number | null; entretela: number | null; aviamento: number | null; rev: number };
async function custos(c: Client, id: string): Promise<Custos> {
  const r = await um<any>(c,
    `SELECT custo_peca_previsto AS peca, custo_tecido_total AS tecido, custo_forro_total AS forro,
            custo_entretela_total AS entretela, custo_aviamento_total AS aviamento, rev
       FROM public.modelos WHERE id = $1`, [id]);
  return { peca: n(r.peca), tecido: n(r.tecido), forro: n(r.forro), entretela: n(r.entretela), aviamento: n(r.aviamento), rev: Number(r.rev) };
}
const semRev = (x: Custos) => ({ peca: x.peca, tecido: x.tecido, forro: x.forro, entretela: x.entretela, aviamento: x.aviamento });
async function custoLinha(c: Client, tabela: "modelo_tecidos" | "modelo_aviamentos" | "modelo_etiquetas", id: string): Promise<number | null> {
  return n((await um<{ v: string | null }>(c, `SELECT custo_previsto AS v FROM public.${tabela} WHERE id = $1`, [id])).v);
}
/** Tudo o que o servidor calcula para o card ⇔ o que está gravado (linhas + as 5 colunas). */
async function gravadoBateComCalculo(c: Client, id: string): Promise<boolean> {
  const r = await um<{ ok: boolean }>(c,
    `WITH k AS (SELECT * FROM public._custo_calcular($2, ARRAY[$1::uuid]))
     SELECT NOT EXISTS (
              SELECT 1 FROM k JOIN public.modelo_tecidos t ON t.id = k.id WHERE k.tabela = 'modelo_tecidos' AND t.custo_previsto IS DISTINCT FROM k.custo
              UNION ALL SELECT 1 FROM k JOIN public.modelo_aviamentos t ON t.id = k.id WHERE k.tabela = 'modelo_aviamentos' AND t.custo_previsto IS DISTINCT FROM k.custo
              UNION ALL SELECT 1 FROM k JOIN public.modelo_etiquetas t ON t.id = k.id WHERE k.tabela = 'modelo_etiquetas' AND t.custo_previsto IS DISTINCT FROM k.custo
              UNION ALL SELECT 1 FROM k JOIN public.modelos m ON m.id = k.id WHERE k.tabela = 'modelos'
                AND (m.custo_peca_previsto, m.custo_tecido_total, m.custo_forro_total, m.custo_entretela_total, m.custo_aviamento_total)
                    IS DISTINCT FROM (round(k.custo, 2), k.tecido, k.forro, k.entretela, k.aviamento)
            ) AND EXISTS (SELECT 1 FROM k WHERE k.tabela = 'modelos') AS ok`, [id, T]);
  return r.ok;
}

async function modelo(c: Client, origem: "interno" | "revenda" | "importado" = "interno", extra: Record<string, unknown> = {}): Promise<string> {
  const cols = ["tenant_id", "nome", "origem", ...Object.keys(extra)];
  const vals = [T, `C1 CUSTO ${origem} ${suf()}`, origem, ...Object.values(extra)];
  return (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, vals)).id;
}
async function artigo(c: Client, a: ArtigoCaso): Promise<{ art: string; vt: string }> {
  const art = (await um<{ id: string }>(c,
    `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [T, `C1 art ${suf()}`, a.unidade, a.preco, a.rendimento])).id;
  const vt = (await um<{ id: string }>(c,
    `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, $3) RETURNING id`,
    [T, art, `C1 var ${suf()}`])).id;
  return { art, vt };
}
async function ocItem(c: Client, art: string, vt: string, preco: number | null, cancelado: boolean): Promise<string> {
  const oc = (await um<{ id: string }>(c,
    `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido) VALUES ($1, $2) RETURNING id`, [T, `C1-OC-${suf()}`])).id;
  return (await um<{ id: string }>(c,
    `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, preco, cancelado)
     VALUES ($1, $2, 1, $3, 100, $4, $5) RETURNING id`, [oc, art, vt, preco, cancelado])).id;
}
async function vincular(c: Client, m: string, tipo: string, numero: number, vt: string, item: string, ordem = 1): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 10, 1) RETURNING id`, [T, m, tipo, numero, ordem, vt, item])).id;
}
/** Linha de tecido de um caso da fixture (artigo da linha + substitutos + OC vinculada). */
async function linhaTecido(c: Client, m: string, caso: CasoTecido): Promise<{ id: string; art: string }> {
  const a = await artigo(c, caso.artigo);
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [m, a.art, caso.numero, caso.tipo, caso.consumo, caso.perda])).id;
  let ordem = 1;
  for (const s of caso.substitutos) {
    const sub = await artigo(c, s);
    await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)`, [id, sub.vt, ordem++]);
  }
  if (caso.oc) {
    const o = await artigo(c, caso.oc.artigo);
    const item = await ocItem(c, o.art, o.vt, caso.oc.preco, caso.oc.cancelado);
    await vincular(c, m, caso.tipo, caso.numero, o.vt, item);
  }
  return { id, art: a.art };
}
async function aviamento(c: Client, preco: number | null): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.aviamentos (tenant_id, codigo_nome, preco) VALUES ($1, $2, $3) RETURNING id`, [T, `C1 avi ${suf()}`, preco])).id;
}
async function linhaAviamento(c: Client, m: string, caso: CasoAviamento, numero = 1): Promise<{ id: string; avi: string }> {
  const avi = await aviamento(c, caso.preco);
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [m, avi, numero, caso.consumo, caso.perda])).id;
  return { id, avi };
}
type Cores = { X: string; Y: string };
async function cores(c: Client): Promise<Cores> {
  const cor = async (nome: string) => (await um<{ id: string }>(c,
    `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, nome])).id;
  return { X: await cor(`C1 cor X ${suf()}`), Y: await cor(`C1 cor Y ${suf()}`) };
}
const corId = (k: Cores, cc: CorCaso) => (cc == null ? null : k[cc]);
async function etiqueta(c: Client, k: Cores, caso: Pick<CasoEtiqueta, "variantes" | "precoBase">): Promise<string> {
  const etq = (await um<{ id: string }>(c,
    `INSERT INTO public.etiquetas (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `C1 etq ${suf()}`])).id;
  let i = 0;
  for (const v of caso.variantes) {
    await c.query(`INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho, cor_id, preco) VALUES ($1, $2, $3, $4, $5)`,
      [T, etq, `T${i++}`, corId(k, v.cor), v.preco]);
  }
  await c.query(`UPDATE public.etiquetas SET preco = $2 WHERE id = $1`, [etq, caso.precoBase]);
  return etq;
}
async function linhaEtiqueta(c: Client, k: Cores, m: string, caso: CasoEtiqueta): Promise<{ id: string; etq: string }> {
  const etq = await etiqueta(c, k, caso);
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent)
     VALUES ($1, $2, $3, $4, 1, $5, $6) RETURNING id`, [T, m, etq, corId(k, caso.cor), caso.consumo, caso.perda])).id;
  return { id, etq };
}
async function categoriaServico(c: Client): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.categorias_terceirizado (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `C1 serv ${suf()}`])).id;
}
async function mo(c: Client, m: string, valor: number, categoria: string | null = null): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1, $2, $3, $4) RETURNING id`,
    [T, m, categoria, valor])).id;
}
async function cortar(c: Client, m: string): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, true) RETURNING id`, [T, m])).id;
}
/** Grava custo "velho" como o SERVIDOR (GUC ligada e restaurada) — p/ montar cenários. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query(`SELECT set_config('app.custo_sistema', 'on', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.custo_sistema', '', true)`);
  }
}

// ─────────────────────────────── (a) catálogo / ACL ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (a) — catálogo e ACL (#9, R-CD3)", () => {
  it("todo _/fn_ novo sem EXECUTE para anon/authenticated; precos_tecido_congelado mantém o ACL (authenticated sim, anon não)", async () => {
    await withTx(async (c) => {
      for (const f of NOVAS) {
        for (const papel of ["anon", "authenticated"]) {
          const r = await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`, [papel, f]);
          expect({ f, papel, pode: r.p }).toEqual({ f, papel, pode: false });
        }
      }
      const w = await um<{ a: boolean; u: boolean }>(c,
        `SELECT has_function_privilege('anon', 'public.precos_tecido_congelado(uuid)', 'EXECUTE') AS a,
                has_function_privilege('authenticated', 'public.precos_tecido_congelado(uuid)', 'EXECUTE') AS u`);
      expect(w).toEqual({ a: false, u: true });
    });
  });

  it("fila: RLS ligada e nenhum privilégio de cliente", async () => {
    await withTx(async (c) => {
      const r = await um<any>(c,
        `SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.custo_recalculo_fila'::regclass) AS rls,
                has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'SELECT') AS s,
                has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'INSERT') AS i,
                has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'UPDATE') AS u,
                has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'DELETE') AS d,
                has_table_privilege('anon', 'public.custo_recalculo_fila', 'SELECT') AS a`);
      expect(r).toEqual({ rls: true, s: false, i: false, u: false, d: false, a: false });
    });
  });

  it("R-CD3: 26 gatilhos de STATEMENT sem lista de colunas e com tabelas de transição; modelos por LINHA com WHEN; fila adiada", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `SELECT c.relname AS tabela, t.tgname, t.tgenabled, cardinality(t.tgattr::int2[]) AS nattr, t.tgoldtable AS velha, t.tgnewtable AS nova,
                (t.tgtype & 1) = 1 AS por_linha, t.tgdeferrable AS adiavel, t.tginitdeferred AS adiado
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND (t.tgname LIKE 'trg\\_custo\\_%' OR t.tgname = 'trg_modelo_custo_derivado')
          ORDER BY 1, 2`);
      expect(rows.length).toBe(30);
      for (const r of rows) expect(r.tgenabled).toBe("O");
      const stmt = rows.filter((r) => r.tgname.startsWith("trg_custo_fila_") && r.tabela !== "modelos");
      expect(stmt.length).toBe(26);
      for (const r of stmt) {
        expect(r.por_linha).toBe(false);
        expect(r.nattr).toBe(0);
        if (r.tgname.endsWith("_ins")) expect([r.velha, r.nova]).toEqual([null, "novas"]);
        if (r.tgname.endsWith("_upd")) expect([r.velha, r.nova]).toEqual(["antigas", "novas"]);
        if (r.tgname.endsWith("_del")) expect([r.velha, r.nova]).toEqual(["antigas", null]);
      }
      const mod = rows.filter((r) => r.tabela === "modelos").map((r) => [r.tgname, r.por_linha, r.nattr]);
      expect(mod).toEqual([
        ["trg_custo_fila_modelo_ins", true, 0],
        ["trg_custo_fila_modelo_upd", true, 0],
        ["trg_modelo_custo_derivado", true, 0],
      ]);
      const proc = rows.find((r) => r.tgname === "trg_custo_processar_fila");
      expect(proc).toMatchObject({ tabela: "custo_recalculo_fila", por_linha: true, adiavel: true, adiado: true });
    });
  });

  it("anti-drift: só o servidor ESCREVE custo_peca_previsto/custo_*_total (nenhuma função nova fora da lista conhecida)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `SELECT p.proname FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.prosrc ~* 'custo_(peca_previsto|tecido_total|forro_total|entretela_total|aviamento_total)'
          ORDER BY 1`);
      const conhecidas = new Set([
        "_custo_unitario_modelos_core", "_dashboard_custos_core", "_replicar_cards_plan_tecido_core", // leem / INSERT da réplica
        "_custo_recalcular_modelos", "fn_modelo_custo_derivado",
      ]);
      const fora = rows.map((r) => r.proname as string).filter((p) => !conhecidas.has(p) && !p.startsWith("_custo_"));
      expect(fora).toEqual([]);
    });
  });
});

// ─────────────────────────────── (b) RC1 ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (b) — RC1: preço congelado pela OC com a loja explícita", () => {
  it("_core sem JWT traz o preço da OC; embrulho com JWT = o texto de antes; sem JWT = {}; o servidor recalcula com a OC (8,90 × 3,65 × 1,05 = 34,11)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      const caso = CASOS_TECIDO.find((x) => x.nome.startsWith("OC vinculada em metro"))!;
      const l = await linhaTecido(c, m, caso);
      await semUsuario(c);
      expect((await um<{ j: any }>(c, `SELECT public._precos_tecido_congelado_core($1, $2) AS j`, [m, T])).j).toEqual({ "tecido|1": 8.9 });
      expect((await um<{ j: any }>(c, `SELECT public.precos_tecido_congelado($1) AS j`, [m])).j).toEqual({});
      // o recálculo roda SEM JWT (como no COMMIT de um gatilho de cadastro de outra pessoa): usa a loja do modelo
      await imediato(c);
      expect(await custoLinha(c, "modelo_tecidos", l.id)).toBe(34.11);
      expect(await custos(c, m)).toMatchObject({ peca: 34.11, tecido: 34.11, forro: 0, entretela: 0, aviamento: 0 });
      await comoUsuario(c);
      const antes = await um<{ j: any }>(c,
        // corpo de ANTES (md5 d6fa813b) inline: o embrulho tem de dar exatamente isto
        `SELECT COALESCE(jsonb_object_agg(s.k, s.ppm), '{}'::jsonb) AS j FROM (
           SELECT l.tipo || '|' || l.numero AS k,
                  MAX(CASE WHEN a.unidade_medida = 'kg' AND COALESCE(a.rendimento,0) > 0 THEN oti.preco / a.rendimento ELSE oti.preco END) AS ppm
             FROM public.modelo_tecido_oc_links l
             JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
             JOIN public.variantes_tecido vt ON vt.id = l.variante_tecido_id
             JOIN public.artigos a ON a.id = vt.artigo_id
            WHERE l.modelo_id = $1 AND l.tenant_id = public.get_user_tenant_id()
              AND oti.preco IS NOT NULL AND COALESCE(oti.cancelado,false) = false
            GROUP BY l.tipo, l.numero) s`, [m]);
      const via = await um<{ j: any }>(c, `SELECT public.precos_tecido_congelado($1) AS j`, [m]);
      expect(via.j).toEqual(antes.j);
      expect(via.j).toEqual({ "tecido|1": 8.9 });
      // vínculo de OUTRA loja não conta (l.tenant_id = loja do modelo)
      expect((await um<{ j: any }>(c, `SELECT public._precos_tecido_congelado_core($1, gen_random_uuid()) AS j`, [m])).j).toEqual({});
    });
  });
});

// ─────────────────────────────── (c) anti-drift SQL ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (c) — anti-drift SQL (tests/fixtures/custo-bom-casos.ts; o TS no tests/unit/custo-bom-antidrift)", () => {
  it("funções puras: _custo_linha (meio centavo R-CD4) e _custo_adicionais_soma (R-CD6)", async () => {
    await withTx(async (c) => {
      const r = await um<{ v: string }>(c, `SELECT public._custo_linha($1, $2, $3) AS v`, [MEIO_CENTAVO.preco, MEIO_CENTAVO.consumo, MEIO_CENTAVO.perda]);
      expect(Number(r.v)).toBe(MEIO_CENTAVO.sql);
      expect(n((await um<{ v: string }>(c, `SELECT public._custo_linha(NULL, 2, 5) AS v`)).v)).toBe(0);
      for (const caso of CASOS_ADICIONAIS) {
        const v = await um<{ v: string }>(c, `SELECT public._custo_adicionais_soma($1::jsonb) AS v`, [JSON.stringify(caso.custos)]);
        expect({ caso: caso.nome, v: Number(v.v) }).toEqual({ caso: caso.nome, v: caso.esperado });
      }
      expect(n((await um<{ v: string }>(c, `SELECT public._custo_adicionais_soma(NULL) AS v`)).v)).toBe(0);
    });
  });

  it("linhas: cada caso de tecido/aviamento/etiqueta calculado pelo servidor = esperado (exato)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cores(c);
      for (const caso of CASOS_TECIDO) {
        const m = await modelo(c);
        const l = await linhaTecido(c, m, caso);
        const r = await um<{ v: string }>(c,
          `SELECT custo AS v FROM public._custo_calcular($1, ARRAY[$2::uuid]) WHERE tabela = 'modelo_tecidos' AND id = $3`, [T, m, l.id]);
        expect({ caso: caso.nome, v: Number(r.v) }).toEqual({ caso: caso.nome, v: caso.esperado });
      }
      for (const caso of CASOS_AVIAMENTO) {
        const m = await modelo(c);
        const l = await linhaAviamento(c, m, caso);
        const r = await um<{ v: string }>(c,
          `SELECT custo AS v FROM public._custo_calcular($1, ARRAY[$2::uuid]) WHERE tabela = 'modelo_aviamentos' AND id = $3`, [T, m, l.id]);
        expect({ caso: caso.nome, v: Number(r.v) }).toEqual({ caso: caso.nome, v: caso.esperado });
      }
      for (const caso of CASOS_ETIQUETA) {
        const m = await modelo(c);
        const l = await linhaEtiqueta(c, k, m, caso);
        const r = await um<{ v: string }>(c,
          `SELECT custo AS v FROM public._custo_calcular($1, ARRAY[$2::uuid]) WHERE tabela = 'modelo_etiquetas' AND id = $3`, [T, m, l.id]);
        expect({ caso: caso.nome, v: Number(r.v) }).toEqual({ caso: caso.nome, v: caso.esperado });
      }
    });
  });

  it("card inteiro: totais + M.O. multi-instância + adicionais; o COMMIT grava exatamente o calculado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cores(c);
      const m = await modelo(c, "interno", { custos_adicionais: JSON.stringify(CASO_MODELO.adicionais) });
      for (const t of CASO_MODELO.tecidos) await linhaTecido(c, m, t);
      for (const a of CASO_MODELO.aviamentos) await linhaAviamento(c, m, a);
      for (const e of CASO_MODELO.etiquetas) await linhaEtiqueta(c, k, m, e);
      await mo(c, m, CASO_MODELO.maoObra[0]);
      await mo(c, m, CASO_MODELO.maoObra[1], await categoriaServico(c));
      const r = await um<any>(c, `SELECT * FROM public._custo_calcular($1, ARRAY[$2::uuid]) WHERE tabela = 'modelos'`, [T, m]);
      const e = CASO_MODELO.esperado;
      expect({
        tecido: Number(r.tecido), forro: Number(r.forro), entretela: Number(r.entretela), aviamento: Number(r.aviamento),
        etiqueta: Number(r.etiqueta), mao_obra: Number(r.mao_obra), adicionais: Number(r.adicionais), peca: Number(r.custo),
      }).toEqual(e);
      expect(await naFila(c, m)).toBe(true);
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      expect(await custos(c, m)).toMatchObject({ peca: e.peca, tecido: e.tecido, forro: e.forro, entretela: e.entretela, aviamento: e.aviamento });
      expect(await gravadoBateComCalculo(c, m)).toBe(true);
    });
  });
});

// ─────────────────────────────── (d) RC3 / RC4a / RC4b ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (d) — RC3 (filtro por coluna), RC4a (GUC restaurada), RC4b (mudança de origem)", () => {
  it("RC3: UPDATE só de custo_previsto NÃO enfileira; UPDATE de consumo enfileira; aprovar M.O. não enfileira", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      const l = await linhaTecido(c, m, CASOS_TECIDO[0]);
      const moId = await mo(c, m, 10);
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE public.modelo_tecidos SET custo_previsto = 999 WHERE id = $1`, [l.id]);
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE public.modelo_servico_mo SET aprovado = true WHERE id = $1`, [moId]);
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE public.modelo_tecidos SET consumo = 2 WHERE id = $1`, [l.id]);
      expect(await fila(c)).toEqual([m]);
      await imediato(c);
      expect(await custoLinha(c, "modelo_tecidos", l.id)).toBe(38.93); // 18,90 × 2 × 1,03 = 38,934
      expect((await custos(c, m)).peca).toBe(48.93);
    });
  });

  it("RC4a: depois do COMMIT simulado a GUC volta ao valor anterior e uma 2ª edição na MESMA transação recalcula", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      const l = await linhaAviamento(c, m, CASOS_AVIAMENTO[2]); // 2,20 × 1,5 = 3,30
      await c.query(`SELECT set_config('app.custo_sistema', 'valor-de-antes', true)`);
      await imediato(c);
      expect((await um<{ g: string }>(c, `SELECT current_setting('app.custo_sistema', true) AS g`)).g).toBe("valor-de-antes");
      expect((await custos(c, m)).peca).toBe(3.3);
      await c.query(`UPDATE public.modelo_aviamentos SET consumo = 3 WHERE id = $1`, [l.id]);
      expect(await fila(c)).toEqual([m]);
      await imediato(c);
      expect(await custoLinha(c, "modelo_aviamentos", l.id)).toBe(6.6);
      expect((await custos(c, m)).peca).toBe(6.6);
      expect((await um<{ g: string }>(c, `SELECT current_setting('app.custo_sistema', true) AS g`)).g).toBe("valor-de-antes");
    });
  });

  it("RC4b: revenda → interno recalcula; interno → revenda aceita a escrita do cliente", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const r = await modelo(c, "revenda", { custo_peca_previsto: 77 });
      await linhaAviamento(c, r, CASOS_AVIAMENTO[0]); // 1,54
      await imediato(c);
      expect((await custos(c, r)).peca).toBe(77); // revenda: fora da fila
      await c.query(`UPDATE public.modelos SET origem = 'interno', custo_peca_previsto = 5 WHERE id = $1`, [r]);
      expect((await custos(c, r)).peca).toBe(77); // o cliente não manda no interno
      expect(await fila(c)).toEqual([r]);
      await imediato(c);
      expect(await custos(c, r)).toMatchObject({ peca: 1.54, aviamento: 1.54 });

      const m = await modelo(c);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(0);
      await c.query(`UPDATE public.modelos SET origem = 'revenda', custo_peca_previsto = 55 WHERE id = $1`, [m]);
      expect((await custos(c, m)).peca).toBe(55);
      expect(await fila(c)).toEqual([]);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(55);
    });
  });
});

// ─────────────────────────────── (e) P-169 A / R-CD1 ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (e) — P-169 A / R-CD1: preço de cadastro NÃO mexe no card enviado ao corte; a ficha mexe", () => {
  it("preço do artigo: interno muda, cortado não; ficha e M.O. do cortado recalculam (preços de HOJE); reverter o corte descongela; revenda/importado intocados", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await artigo(c, { unidade: "metro", preco: 10, rendimento: null });
      const linha = async (m: string, consumo = 1) => (await um<{ id: string }>(c,
        `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 1, 'tecido', $3, 0) RETURNING id`,
        [m, a.art, consumo])).id;
      const m1 = await modelo(c);
      const m2 = await modelo(c);
      const l1 = await linha(m1);
      const l2 = await linha(m2);
      const rv = await modelo(c, "revenda");
      const im = await modelo(c, "importado");
      const lrv = await linha(rv);
      const lim = await linha(im);
      const cad2 = await cortar(c, m2);
      await imediato(c);
      expect([(await custos(c, m1)).peca, (await custos(c, m2)).peca]).toEqual([10, 10]);
      const rvAntes = [await custos(c, rv), await custoLinha(c, "modelo_tecidos", lrv)];
      const imAntes = [await custos(c, im), await custoLinha(c, "modelo_tecidos", lim)];

      await c.query(`UPDATE public.artigos SET preco = 20 WHERE id = $1`, [a.art]);
      expect(await fila(c)).toEqual([m1]);
      await imediato(c);
      expect([(await custos(c, m1)).peca, (await custos(c, m2)).peca]).toEqual([20, 10]);
      expect(await custoLinha(c, "modelo_tecidos", l2)).toBe(10);

      // ficha do cortado recalcula o card INTEIRO com os preços de hoje (R3)
      await c.query(`UPDATE public.modelo_tecidos SET consumo = 2 WHERE id = $1`, [l2]);
      await imediato(c);
      expect((await custos(c, m2)).peca).toBe(40);
      await mo(c, m2, 5);
      await imediato(c);
      expect((await custos(c, m2)).peca).toBe(45);

      await c.query(`UPDATE public.artigos SET preco = 30 WHERE id = $1`, [a.art]);
      await imediato(c);
      expect([(await custos(c, m1)).peca, (await custos(c, m2)).peca]).toEqual([30, 45]);

      // reverter o corte descongela
      await c.query(`UPDATE public.cad SET enviado_corte = false WHERE id = $1`, [cad2]);
      expect(await fila(c)).toEqual([m2]);
      await imediato(c);
      expect((await custos(c, m2)).peca).toBe(65);

      // revenda/importado: nunca entram na fila — linha e colunas do modelo intocadas (o rev pode subir pelo colab bump)
      expect(semRev(await custos(c, rv))).toEqual(semRev(rvAntes[0] as Custos));
      expect(await custoLinha(c, "modelo_tecidos", lrv)).toBe(rvAntes[1]);
      expect(semRev(await custos(c, im))).toEqual(semRev(imAntes[0] as Custos));
      expect(await custoLinha(c, "modelo_tecidos", lim)).toBe(imAntes[1]);
      expect(await custoLinha(c, "modelo_tecidos", l1)).toBe(30);
    });
  });

  it("item de OC vinculado: preço e cancelado mudam o card não cortado; o cortado fica", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await artigo(c, { unidade: "metro", preco: 5, rendimento: null });
      const item = await ocItem(c, a.art, a.vt, 8, false);
      const mk = async () => {
        const m = await modelo(c);
        await c.query(`INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 1, 'tecido', 1, 0)`, [m, a.art]);
        await vincular(c, m, "tecido", 1, a.vt, item);
        return m;
      };
      const m3 = await mk();
      const mc = await mk();
      await cortar(c, mc);
      await imediato(c);
      expect([(await custos(c, m3)).peca, (await custos(c, mc)).peca]).toEqual([8, 8]);
      await c.query(`UPDATE public.ocs_tecido_itens SET preco = 9 WHERE id = $1`, [item]);
      expect(await fila(c)).toEqual([m3]);
      await imediato(c);
      expect([(await custos(c, m3)).peca, (await custos(c, mc)).peca]).toEqual([9, 8]);
      await c.query(`UPDATE public.ocs_tecido_itens SET cancelado = true WHERE id = $1`, [item]);
      await imediato(c);
      expect([(await custos(c, m3)).peca, (await custos(c, mc)).peca]).toEqual([5, 8]); // cancelado: cai no artigo
    });
  });

  it("variantes_etiqueta INSERT muda o MAX da cor (e o gatilho de sincronia do preço base também enfileira)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cores(c);
      const m = await modelo(c);
      const caso: CasoEtiqueta = { nome: "x", cor: "X", variantes: [], precoBase: 0.1, consumo: 1, perda: 0, esperado: 0.1 };
      const l = await linhaEtiqueta(c, k, m, caso);
      await imediato(c);
      expect(await custoLinha(c, "modelo_etiquetas", l.id)).toBe(0.1);
      await c.query(`INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho, cor_id, preco) VALUES ($1, $2, 'U', $3, 0.5)`, [T, l.etq, k.X]);
      expect(await fila(c)).toEqual([m]);
      await imediato(c);
      expect(await custoLinha(c, "modelo_etiquetas", l.id)).toBe(0.5);
      expect((await custos(c, m)).peca).toBe(0.5);
    });
  });
});

// ─────────────────────────────── (f) casos do plano-base ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (f) — casos do plano-base", () => {
  it("M.O.: criar/editar/apagar acompanha; aprovar não muda o custo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      const x = await mo(c, m, 10);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(10);
      await c.query(`UPDATE public.modelo_servico_mo SET valor = 15 WHERE id = $1`, [x]);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(15);
      const rev = (await custos(c, m)).rev;
      await c.query(`UPDATE public.modelo_servico_mo SET aprovado = true WHERE id = $1`, [x]);
      expect(await fila(c)).toEqual([]);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(15);
      expect((await custos(c, m)).rev).toBeGreaterThanOrEqual(rev); // o flag derivado pode subir o rev; o custo não muda
      await c.query(`DELETE FROM public.modelo_servico_mo WHERE id = $1`, [x]);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(0);
    });
  });

  it("Aplicar do Plan. Tecido (_plan_tecido_gravar_bom_core): linha nasce NULL e o COMMIT deixa custo e total certos", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      const a = await artigo(c, { unidade: "metro", preco: 12, rendimento: null });
      await c.query(`SELECT public._plan_tecido_gravar_bom_core($1, $2::jsonb)`, [m, JSON.stringify([
        { artigo_id: a.art, numero: 1, tipo: "tecido", consumo: 1.5, loss_percent: 10, variantes: [{ variante_tecido_id: a.vt, ordem: 1 }] },
      ])]);
      const l = await um<{ id: string; v: string | null }>(c, `SELECT id, custo_previsto AS v FROM public.modelo_tecidos WHERE modelo_id = $1`, [m]);
      expect(l.v).toBeNull();
      await imediato(c);
      expect(await custoLinha(c, "modelo_tecidos", l.id)).toBe(19.8); // 12 × 1,5 × 1,10
      expect(await custos(c, m)).toMatchObject({ peca: 19.8, tecido: 19.8 });
    });
  });

  it("réplica (_replicar_cards_plan_tecido_core): o card novo é recalculado (não herda custo velho)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const o = await modelo(c);
      const a = await artigo(c, { unidade: "metro", preco: 10, rendimento: null });
      const lo = (await um<{ id: string }>(c,
        `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 1, 'tecido', 2, 0) RETURNING id`,
        [o, a.art])).id;
      await imediato(c);
      // custo VELHO gravado como se fosse o sistema (cenário: cadastro mudou e o card ainda não foi recalculado)
      await comoSistema(c, async () => {
        await c.query(`UPDATE public.modelo_tecidos SET custo_previsto = 1.23 WHERE id = $1`, [lo]);
        await c.query(`UPDATE public.modelos SET custo_peca_previsto = 1.23, custo_tecido_total = 1.23 WHERE id = $1`, [o]);
      });
      const destino = (await um<{ id: string }>(c,
        `INSERT INTO public.colecoes (tenant_id, nome, status) VALUES ($1, $2, 'rascunho') RETURNING id`, [T, `C1 destino ${suf()}`])).id;
      await c.query(`SELECT public._replicar_cards_plan_tecido_core($1, $2, NULL, ARRAY[$3::uuid], NULL)`, [T, destino, o]);
      const novo = (await um<{ id: string }>(c, `SELECT id FROM public.modelos WHERE colecao_id = $1`, [destino])).id;
      expect((await custos(c, novo)).peca).toBe(1.23); // a réplica copiou o valor velho…
      expect(await naFila(c, novo)).toBe(true);
      await imediato(c);
      expect(await custos(c, novo)).toMatchObject({ peca: 20, tecido: 20 }); // …e o COMMIT recalculou
      expect(await gravadoBateComCalculo(c, novo)).toBe(true);
    });
  });

  it("custo_peca_previsto/custo_*_total mandados pelo cliente (UPDATE) são ignorados; INSERT com custo é recalculado no COMMIT", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      await mo(c, m, 3);
      await imediato(c);
      await c.query(`UPDATE public.modelos SET custo_peca_previsto = 999, custo_tecido_total = 1, custo_forro_total = 2,
                            custo_entretela_total = 3, custo_aviamento_total = 4 WHERE id = $1`, [m]);
      expect(await custos(c, m)).toMatchObject({ peca: 3, tecido: 0, forro: 0, entretela: 0, aviamento: 0 });
      expect(await fila(c)).toEqual([]);
      const novo = await modelo(c, "interno", { custo_peca_previsto: 123, custo_tecido_total: 5 });
      expect((await custos(c, novo)).peca).toBe(123);
      expect(await fila(c)).toEqual([novo]);
      await imediato(c);
      expect(await custos(c, novo)).toMatchObject({ peca: 0, tecido: 0 });
    });
  });

  it("modelo sem mudança NÃO sobe o rev (IS DISTINCT FROM nas linhas e no modelo)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      await linhaTecido(c, m, CASOS_TECIDO[0]);
      await linhaAviamento(c, m, CASOS_AVIAMENTO[0]);
      await imediato(c);
      const antes = await custos(c, m);
      await c.query(`SELECT public._custo_enfileirar(ARRAY[$1::uuid], false)`, [m]);
      expect(await fila(c)).toEqual([m]);
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      expect(await custos(c, m)).toEqual(antes);
    });
  });

  it("excluir interno com BOM, M.O. e vínculo de OC não viola a FK da fila (o enfileirar faz JOIN em modelos)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await cores(c);
      const m = await modelo(c);
      await linhaTecido(c, m, CASOS_TECIDO.find((x) => x.oc && !x.oc.cancelado && x.oc.preco != null)!);
      await linhaAviamento(c, m, CASOS_AVIAMENTO[0]);
      await linhaEtiqueta(c, k, m, CASOS_ETIQUETA[0]);
      await mo(c, m, 4);
      await imediato(c);
      await c.query(`UPDATE public.modelo_servico_mo SET valor = 6 WHERE modelo_id = $1`, [m]); // fica na fila
      expect(await fila(c)).toEqual([m]);
      await c.query(`DELETE FROM public.modelos WHERE id = $1`, [m]);
      expect(await fila(c)).toEqual([]);
      await imediato(c);
      expect(await fila(c)).toEqual([]);
    });
  });

  it("erro no aplicador vira WARNING, NÃO derruba o COMMIT e o card FICA na fila (R1)", async () => {
    await withTx(async (c) => {
      const avisos: string[] = [];
      const ouvir = (x: { message?: string }) => avisos.push(String(x.message));
      c.on("notice", ouvir);
      try {
        await prepara(c);
        const m = await modelo(c);
        await mo(c, m, 7);
        // sabotagem SÓ nesta txn (revertida; cópia local): o aplicador passa a lançar erro
        await c.query(`CREATE OR REPLACE FUNCTION public._custo_recalcular_modelos(_tenant uuid, _ids uuid[])
                       RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
                       AS $f$ BEGIN RAISE EXCEPTION 'sabotagem de teste'; END $f$`);
        await imediato(c); // não lança
        expect(avisos.some((a) => /recalculo do lote falhou/.test(a) && /sabotagem de teste/.test(a))).toBe(true);
        expect(avisos.some((a) => a.includes(`card ${m} continua na fila`))).toBe(true);
        expect(await fila(c)).toEqual([m]);
        expect((await custos(c, m)).peca).toBeNull();
      } finally {
        c.off("notice", ouvir);
      }
    });
  });
});

// ─────────────────────────────── (g) R1 — trava de linha de outra conexão ───────────────────────────────
describe.skipIf(!PRONTO)("C1 (g) — R1: lock_timeout não perde o recálculo", () => {
  it("outra conexão segura o card (FOR NO KEY UPDATE): o COMMIT passa com WARNING, o card fica na fila e é recalculado no próximo COMMIT da loja", async () => {
    const b = new Client({ connectionString: dbUrl()!, ssl: false });
    await b.connect();
    try {
      await withTx(async (c) => {
        await prepara(c);
        // um interno JÁ comitado da Loja Teste (a 2ª conexão só enxerga linhas comitadas)
        const x = await um<{ id: string } | undefined>(c,
          `SELECT id FROM public.modelos WHERE tenant_id = $1 AND origem = 'interno' ORDER BY id LIMIT 1`, [T]);
        expect(x).toBeTruthy();
        const X = x!.id;
        const avisos: string[] = [];
        const ouvir = (m: { message?: string }) => avisos.push(String(m.message));
        c.on("notice", ouvir);
        try {
          await b.query("BEGIN");
          await b.query("SELECT id FROM public.modelos WHERE id = $1 FOR NO KEY UPDATE", [X]);
          await c.query(`SELECT public._custo_enfileirar(ARRAY[$1::uuid], false)`, [X]); // FK = FOR KEY SHARE: não conflita
          await c.query("SET LOCAL lock_timeout = '30s'"); // a função usa o SEU lock_timeout (2 s), não o da transação
          const t0 = Date.now();
          await imediato(c); // não lança
          const ms = Date.now() - t0;
          expect(ms).toBeGreaterThanOrEqual(3800); // lote (2 s) + card a card (2 s)
          expect(ms).toBeLessThan(15000);
          expect(avisos.some((a) => /recalculo do lote falhou/.test(a) && /55P03/.test(a))).toBe(true);
          expect(avisos.some((a) => a.includes(`card ${X} continua na fila`))).toBe(true);
          expect(await fila(c)).toEqual([X]);
        } finally {
          c.off("notice", ouvir);
          await b.query("ROLLBACK").catch(() => {});
        }
        // próximo COMMIT da loja (outro card entra na fila): leva o que sobrou junto
        await c.query("SET LOCAL lock_timeout = '3s'");
        const y = await modelo(c);
        expect(await fila(c)).toEqual([X, y].sort());
        await imediato(c);
        expect(await fila(c)).toEqual([]);
        expect(await gravadoBateComCalculo(c, X)).toBe(true);
      });
    } finally {
      await b.end();
    }
  }, 60_000);

  it("linha que SOBROU de uma transação anterior é reprocessada quando o PRÓPRIO card é editado de novo (ON CONFLICT … criado_at)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modelo(c);
      await mo(c, m, 2);
      await imediato(c);
      expect((await custos(c, m)).peca).toBe(2);
      // simula a SOBRA de um COMMIT anterior que falhou o recálculo: linha antiga na fila, sem disparo pendente (o gatilho
      // adiado é desligado só p/ esse INSERT — DDL local, revertido com a txn)
      await c.query(`ALTER TABLE public.custo_recalculo_fila DISABLE TRIGGER trg_custo_processar_fila`);
      await c.query(`INSERT INTO public.custo_recalculo_fila (modelo_id, tenant_id, criado_at) VALUES ($1, $2, now() - interval '1 hour')`, [m, T]);
      await c.query(`ALTER TABLE public.custo_recalculo_fila ENABLE TRIGGER trg_custo_processar_fila`);
      await comoSistema(c, async () => {
        await c.query(`UPDATE public.modelos SET custo_peca_previsto = 99 WHERE id = $1`, [m]); // valor velho
      });
      await imediato(c);
      expect(await fila(c)).toEqual([m]); // ninguém disparou
      await c.query(`UPDATE public.modelo_servico_mo SET valor = 3 WHERE modelo_id = $1`, [m]); // o próprio card de novo
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      expect((await custos(c, m)).peca).toBe(3);
    });
  });
});
