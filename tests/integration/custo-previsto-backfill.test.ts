/**
 * CONTAS CERTAS C2 — correção única do custo previsto (migration 20261019310000_custo_previsto_backfill.sql; plano
 * .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §1 R-CD2/R-CD7, §2, §4 C2). SÓ na cópia local (ehBancoLocal), com a
 * 20261019300000 e a 20261019310000 APLICADAS (psql -f); toda escrita em txn revertida (withTx): NADA é gravado — os custos
 * da cópia seguem como estão (são a base da prévia). `_custo_backfill_rodar` só roda aqui, dentro de txn revertida.
 *   (a) equivalência: supabase/consultas/custo_previa_lista.sql (lido e rodado em READ ONLY) = _custo_previa_lista() = o que
 *       o aplicador grava (valores do modelo E md5 das linhas do BOM) · (b) R-CD7 (d)/(e)/(a)/(b)/(c) + convergido/fora ·
 *   (c) confirmação · (d) backup · (e) restauração (arquivo rollback/..._restaurar.sql, bloco DO) · (f) congelados · (g) ACL
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, dbUrl, ehBancoLocal, TENANT_TESTE } from "./db";
import {
  CASOS_AVIAMENTO,
  CASOS_ETIQUETA,
  CASOS_TECIDO,
  type ArtigoCaso,
  type CorCaso,
} from "../fixtures/custo-bom-casos";

const T = TENANT_TESTE;
const OUTRA_LOJA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // Ave Rara (existe na cópia)
const LOCAL = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const ARQ_LISTA = ler("supabase/consultas/custo_previa_lista.sql");
const ARQ_RESTAURAR = ler("supabase/rollback/20261019310000_custo_previsto_restaurar.sql");
const BLOCO_RESTAURAR = (() => {
  const m = /^DO \$restaurar\$[\s\S]*?^END \$restaurar\$;$/m.exec(ARQ_RESTAURAR);
  if (!m) throw new Error("bloco DO $restaurar$ não achado no arquivo de restauração");
  return m[0];
})();

async function migracaoAplicada(): Promise<boolean> {
  if (!LOCAL) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT to_regprocedure('public._custo_backfill_rodar(jsonb,text,integer)') IS NOT NULL
          AND to_regprocedure('public._custo_recalcular_modelos(uuid,uuid[])') IS NOT NULL
          AND to_regclass('public._bkp_custo_previsto') IS NOT NULL AS ok`,
    );
    return r.rows[0].ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = LOCAL && (await migracaoAplicada());

const FUNCOES = [
  "public._custo_lista_canonica(jsonb)",
  "public._custo_lista_hash(jsonb)",
  "public._custo_previa_lista()",
  "public._custo_backfill_rodar(jsonb,text,integer)",
];

// ─────────────────────────────── helpers ───────────────────────────────
let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const n = (v: unknown) => (v == null ? null : Number(v));

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL lock_timeout = '10s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await comoUsuario(c);
}
const confirmar = (c: Client) =>
  c.query(`SELECT set_config('app.confirmo_recalculo_custo', 'sim', true)`);

type Aprovada = { lista: string[]; hash: string; n: number };
/** A lista "aprovada" = as linhas canônicas dos NÃO congelados de agora (o que o kit gera a partir do arquivo). */
async function listaDeAgora(c: Client): Promise<Aprovada> {
  const { rows } = await c.query(
    `SELECT x.linha_canonica FROM (${ARQ_LISTA}) x WHERE NOT x.congelado ORDER BY x.modelo_id`,
  );
  const lista = rows.map((r) => r.linha_canonica as string);
  return comLista(c, lista);
}
async function comLista(c: Client, lista: string[]): Promise<Aprovada> {
  const r = await um<{ h: string }>(
    c,
    `SELECT md5(coalesce(string_agg(e, E'\\n' ORDER BY split_part(e, '|', 1)::uuid), '')) AS h
                                          FROM jsonb_array_elements_text($1::jsonb) e`,
    [JSON.stringify(lista)],
  );
  return { lista, hash: r.h, n: lista.length };
}
async function rodar(c: Client, a: Aprovada): Promise<any> {
  return (
    await um<{ r: any }>(c, `SELECT public._custo_backfill_rodar($1::jsonb, $2, $3) AS r`, [
      JSON.stringify(a.lista),
      a.hash,
      a.n,
    ])
  ).r;
}
/** Roda e devolve a mensagem do erro (dentro de SAVEPOINT: a txn segue viva). */
async function erroDe(
  c: Client,
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT sp_erro");
  try {
    await fn();
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT sp_erro");
    return { code: e.code, message: String(e.message) };
  }
  await c.query("RELEASE SAVEPOINT sp_erro");
  throw new Error("esperava erro, não houve");
}
const linhaDe = (a: Aprovada, id: string) => a.lista.find((l) => l.startsWith(id + "|"));

async function modelo(c: Client, tenant = T): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id`,
      [tenant, `C2 BKF ${suf()}`],
    )
  ).id;
}
async function aviamento(c: Client, preco: number | null, tenant = T): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.aviamentos (tenant_id, codigo_nome, preco) VALUES ($1, $2, $3) RETURNING id`,
      [tenant, `C2 avi ${suf()}`, preco],
    )
  ).id;
}
async function linhaAviamento(
  c: Client,
  m: string,
  avi: string,
  consumo: number,
  perda = 0,
  numero = 1,
): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [m, avi, numero, consumo, perda],
    )
  ).id;
}
/** Card interno com UMA linha de aviamento (preço × consumo): prévia = NULL → preço × consumo. */
async function cardSimples(
  c: Client,
  preco: number,
  consumo: number,
): Promise<{ m: string; linha: string }> {
  const m = await modelo(c);
  const linha = await linhaAviamento(c, m, await aviamento(c, preco), consumo);
  return { m, linha };
}
async function cortar(c: Client, m: string): Promise<void> {
  await c.query(
    `INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, true)`,
    [T, m],
  );
}
/** Recalcula como o servidor (o que a fila faria no COMMIT) — sem passar pela fila. */
async function recalcular(c: Client, m: string): Promise<void> {
  await c.query(`SELECT public._custo_recalcular_modelos($1, ARRAY[$2::uuid])`, [T, m]);
}
type Custos = {
  peca: number | null;
  tecido: number | null;
  forro: number | null;
  entretela: number | null;
  aviamento: number | null;
};
async function custos(c: Client, id: string): Promise<Custos> {
  const r = await um<any>(
    c,
    `SELECT custo_peca_previsto AS peca, custo_tecido_total AS tecido, custo_forro_total AS forro,
            custo_entretela_total AS entretela, custo_aviamento_total AS aviamento FROM public.modelos WHERE id = $1`,
    [id],
  );
  return {
    peca: n(r.peca),
    tecido: n(r.tecido),
    forro: n(r.forro),
    entretela: n(r.entretela),
    aviamento: n(r.aviamento),
  };
}
async function custoAviamento(c: Client, id: string): Promise<number | null> {
  return n(
    (
      await um<{ v: string | null }>(
        c,
        `SELECT custo_previsto AS v FROM public.modelo_aviamentos WHERE id = $1`,
        [id],
      )
    ).v,
  );
}
/** Arquivo x função, coluna a coluna (to_jsonb de cada linha, na ordem de modelo_id). */
async function compararArquivoFuncao(c: Client): Promise<{ arquivo: any[]; funcao: any[] }> {
  const a = await c.query(`SELECT to_jsonb(x) AS j FROM (${ARQ_LISTA}) x ORDER BY x.modelo_id`);
  const f = await c.query(
    `SELECT to_jsonb(x) AS j FROM public._custo_previa_lista() x ORDER BY x.modelo_id`,
  );
  return { arquivo: a.rows.map((r) => r.j), funcao: f.rows.map((r) => r.j) };
}

// fixtures de BOM (para a equivalência cobrir cada regra de preço, não só os dados da cópia)
async function artigo(c: Client, a: ArtigoCaso, tenant = T): Promise<{ art: string; vt: string }> {
  const art = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant, `C2 art ${suf()}`, a.unidade, a.preco, a.rendimento],
    )
  ).id;
  const vt = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, $3) RETURNING id`,
      [tenant, art, `C2 var ${suf()}`],
    )
  ).id;
  return { art, vt };
}
async function ocItem(
  c: Client,
  art: string,
  vt: string,
  preco: number | null,
  cancelado: boolean,
  tenantOc = T,
): Promise<string> {
  const oc = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido) VALUES ($1, $2) RETURNING id`,
      [tenantOc, `C2-OC-${suf()}`],
    )
  ).id;
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, preco, cancelado)
     VALUES ($1, $2, 1, $3, 100, $4, $5) RETURNING id`,
      [oc, art, vt, preco, cancelado],
    )
  ).id;
}
async function vincular(
  c: Client,
  m: string,
  tipo: string,
  numero: number,
  vt: string,
  item: string,
): Promise<void> {
  await c.query(
    `INSERT INTO public.modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
     VALUES ($1, $2, $3, $4, 1, $5, $6, 10, 1)`,
    [T, m, tipo, numero, vt, item],
  );
}
async function cores(c: Client): Promise<{ X: string; Y: string }> {
  const cor = async (nome: string) =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`,
        [T, nome],
      )
    ).id;
  return { X: await cor(`C2 cor X ${suf()}`), Y: await cor(`C2 cor Y ${suf()}`) };
}
/** Um card por caso da fixture (tecido/aviamento/etiqueta), um card com tudo de OUTRA loja (M3), um com M.O. e adicionais. */
async function montarFixtures(c: Client): Promise<string[]> {
  const ids: string[] = [];
  const k = await cores(c);
  const corId = (cc: CorCaso) => (cc == null ? null : k[cc]);
  for (const caso of CASOS_TECIDO) {
    const m = await modelo(c);
    ids.push(m);
    const a = await artigo(c, caso.artigo);
    const id = (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [m, a.art, caso.numero, caso.tipo, caso.consumo, caso.perda],
      )
    ).id;
    let ordem = 1;
    for (const s of caso.substitutos) {
      const sub = await artigo(c, s);
      await c.query(
        `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)`,
        [id, sub.vt, ordem++],
      );
    }
    if (caso.oc) {
      const o = await artigo(c, caso.oc.artigo);
      await vincular(
        c,
        m,
        caso.tipo,
        caso.numero,
        o.vt,
        await ocItem(c, o.art, o.vt, caso.oc.preco, caso.oc.cancelado),
      );
    }
  }
  for (const caso of CASOS_AVIAMENTO) {
    const m = await modelo(c);
    ids.push(m);
    await linhaAviamento(c, m, await aviamento(c, caso.preco), caso.consumo, caso.perda);
  }
  for (const caso of CASOS_ETIQUETA) {
    const m = await modelo(c);
    ids.push(m);
    const etq = (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.etiquetas (tenant_id, nome) VALUES ($1, $2) RETURNING id`,
        [T, `C2 etq ${suf()}`],
      )
    ).id;
    let i = 0;
    for (const v of caso.variantes) {
      await c.query(
        `INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho, cor_id, preco) VALUES ($1, $2, $3, $4, $5)`,
        [T, etq, `T${i++}`, corId(v.cor), v.preco],
      );
    }
    await c.query(`UPDATE public.etiquetas SET preco = $2 WHERE id = $1`, [etq, caso.precoBase]);
    await c.query(
      `INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent) VALUES ($1, $2, $3, $4, 1, $5, $6)`,
      [T, m, etq, corId(caso.cor), caso.consumo, caso.perda],
    );
  }
  // M3: tudo de OUTRA loja (artigo da linha, substituto, OC do vínculo, aviamento, insumo) = 0 / não congela, nos dois lados
  const m3 = await modelo(c);
  ids.push(m3);
  const fora = await artigo(c, { unidade: "metro", preco: 50, rendimento: null }, OUTRA_LOJA);
  const local = await artigo(c, { unidade: "metro", preco: 7, rendimento: null });
  await c.query(
    `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 1, 'tecido', 1, 0)`,
    [m3, fora.art],
  );
  const lSub = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 2, 'tecido', 1, 0) RETURNING id`,
      [m3, local.art],
    )
  ).id;
  await c.query(
    `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`,
    [lSub, fora.vt],
  );
  await c.query(
    `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 1, 'forro', 1, 0)`,
    [m3, local.art],
  );
  await vincular(
    c,
    m3,
    "forro",
    1,
    local.vt,
    await ocItem(c, local.art, local.vt, 99, false, OUTRA_LOJA),
  );
  await linhaAviamento(c, m3, await aviamento(c, 9, OUTRA_LOJA), 1);
  const etqFora = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.etiquetas (tenant_id, nome, preco) VALUES ($1, $2, 0.8) RETURNING id`,
      [OUTRA_LOJA, `C2 etq fora ${suf()}`],
    )
  ).id;
  await c.query(
    `INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, tamanho, cor_id, preco) VALUES ($1, $2, 'U', $3, 0.9)`,
    [OUTRA_LOJA, etqFora, k.X],
  );
  await c.query(
    `INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent) VALUES ($1, $2, $3, $4, 1, 1, 0)`,
    [T, m3, etqFora, k.X],
  );
  // M.O. (3 casas: a peça é comparada ARREDONDADA) + adicionais com lixo (R-CD6)
  const mMo = await modelo(c);
  ids.push(mMo);
  await linhaAviamento(c, mMo, await aviamento(c, 1.1), 2);
  const cat = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.categorias_terceirizado (tenant_id, nome) VALUES ($1, $2) RETURNING id`,
      [T, `C2 serv ${suf()}`],
    )
  ).id;
  await c.query(
    `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1, $2, $3, 4.125)`,
    [T, mMo, cat],
  );
  await c.query(`UPDATE public.modelos SET custos_adicionais = $2::jsonb WHERE id = $1`, [
    mMo,
    JSON.stringify([{ valor: 1.5 }, { valor: " 2e0 " }, { valor: "abc" }, { valor: null }, {}]),
  ]);
  return ids;
}

// ─────────────────────────────── (a) equivalência ───────────────────────────────
describe.skipIf(!PRONTO)("C2 (a) — prévia pura ≡ servidor ≡ o que o aplicador grava", () => {
  it("dados da cópia: o arquivo (READ ONLY) = _custo_previa_lista(), linha a linha e coluna a coluna", async () => {
    const c = new Client({ connectionString: dbUrl()!, ssl: false });
    await c.connect();
    try {
      await c.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const { arquivo, funcao } = await compararArquivoFuncao(c);
      expect(arquivo.length).toBeGreaterThan(0);
      expect(funcao).toEqual(arquivo);
      // a lista inclui congelados (coluna à parte) e só modelos internos com loja
      const r = await um<any>(
        c,
        `SELECT count(*) FILTER (WHERE x.congelado) AS cong, count(*) FILTER (WHERE m.origem <> 'interno' OR m.tenant_id IS NULL) AS fora
           FROM (${ARQ_LISTA}) x JOIN public.modelos m ON m.id = x.modelo_id`,
      );
      expect(Number(r.fora)).toBe(0);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      await c.end();
    }
  });

  it("com fixtures de cada regra (substitutos, OC em kg, cancelada, etiqueta por cor/negativo/zero, OUTRA loja, M.O. 3 casas, adicionais com lixo): arquivo = função", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ids = await montarFixtures(c);
      const { arquivo, funcao } = await compararArquivoFuncao(c);
      expect(funcao).toEqual(arquivo);
      // todo card novo entra (previsto NULL → o calculado, inclusive 0)
      expect(
        arquivo
          .filter((j) => ids.includes(j.modelo_id))
          .map((j) => j.modelo_id)
          .sort(),
      ).toEqual([...ids].sort());
    });
  });

  it("o aplicador grava exatamente o 'depois' do arquivo: as 5 colunas de cada modelo e cada linha do BOM (md5 das linhas = md5_linhas)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await montarFixtures(c);
      const { rows: arq } = await c.query(
        `SELECT x.* FROM (${ARQ_LISTA}) x WHERE NOT x.congelado ORDER BY x.modelo_id`,
      );
      expect(arq.length).toBeGreaterThan(0);
      const aprovada = await comLista(
        c,
        arq.map((r) => r.linha_canonica),
      );
      await confirmar(c);
      const res = await rodar(c, aprovada);
      expect(res.corrigidos).toBe(arq.length);
      expect(res.n_lista_agora).toBe(arq.length);
      // modelos: o gravado (arredondado) = o depois do arquivo
      const { rows: grav } = await c.query(
        `SELECT m.id, round(m.custo_peca_previsto, 2)::text AS peca, round(m.custo_tecido_total, 2)::text AS tecido,
                round(m.custo_forro_total, 2)::text AS forro, round(m.custo_entretela_total, 2)::text AS entretela,
                round(m.custo_aviamento_total, 2)::text AS aviamento
           FROM public.modelos m WHERE m.id = ANY ($1::uuid[]) ORDER BY m.id`,
        [arq.map((r) => r.modelo_id)],
      );
      expect(grav.map((g) => [g.id, g.peca, g.tecido, g.forro, g.entretela, g.aviamento])).toEqual(
        arq.map((r) => [
          r.modelo_id,
          r.previsto_depois,
          r.tecido_depois,
          r.forro_depois,
          r.entretela_depois,
          r.aviamento_depois,
        ]),
      );
      // linhas: md5 das linhas regravadas (antes>depois do backup, igual ao gravado agora) = md5_linhas da linha canônica
      const { rows: md5s } = await c.query(
        `WITH b AS (
           SELECT b.* FROM public._bkp_custo_previsto b WHERE b.lote = $1 AND b.tabela <> 'modelos'
         ), atual AS (
           SELECT b.*, CASE b.tabela WHEN 'modelo_tecidos' THEN (SELECT t.custo_previsto FROM public.modelo_tecidos t WHERE t.id = b.id)
                                     WHEN 'modelo_aviamentos' THEN (SELECT t.custo_previsto FROM public.modelo_aviamentos t WHERE t.id = b.id)
                                     ELSE (SELECT t.custo_previsto FROM public.modelo_etiquetas t WHERE t.id = b.id) END AS gravado
             FROM b
         )
         SELECT x.id::text AS modelo_id,
                coalesce((SELECT md5(string_agg(a.tabela || ':' || a.id::text || ':' || coalesce(round(a.antes, 2)::text, 'null') || '>'
                                                || round(a.gravado, 2)::text, E'\\n' ORDER BY a.tabela, a.id))
                            FROM atual a WHERE a.modelo_id = x.id), md5('')) AS md5_linhas,
                (SELECT count(*) FROM atual a WHERE a.modelo_id = x.id AND a.gravado IS DISTINCT FROM a.depois) AS divergentes
           FROM unnest($2::uuid[]) x(id) ORDER BY x.id`,
        [res.lote, arq.map((r) => r.modelo_id)],
      );
      expect(md5s.map((r) => [r.modelo_id, r.md5_linhas, Number(r.divergentes)])).toEqual(
        arq.map((r) => [r.modelo_id, r.linha_canonica.split("|")[11], 0]),
      );
      // e a lista de agora ficou vazia (arquivo E função)
      const depois = await compararArquivoFuncao(c);
      expect(depois.arquivo.filter((j) => !j.congelado)).toEqual([]);
      expect(depois.funcao).toEqual(depois.arquivo);
    });
  });
});

// ─────────────────────────────── (b) R-CD7 ───────────────────────────────
describe.skipIf(!PRONTO)("C2 (b) — R-CD7: conferência da lista aprovada", () => {
  it("(d) hash errado aborta (P0001 ASCII) e nada é gravado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      await confirmar(c);
      const e = await erroDe(c, () => rodar(c, { ...a, hash: "0".repeat(32) }));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(/^custo_backfill: hash da lista informada/);
      expect(e.message).toMatch(/^[\x20-\x7E]*$/);
      expect((await custos(c, m)).peca).toBeNull();
      expect(
        Number(
          (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public._bkp_custo_previsto`)).n,
        ),
      ).toBe(0);
    });
  });

  it("(e) n errado aborta", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      await confirmar(c);
      const e = await erroDe(c, () => rodar(c, { ...a, n: a.n + 1 }));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(
        /^custo_backfill: a lista informada tem \d+ modelo\(s\), o aprovado e \d+/,
      );
    });
  });

  it("(a) modelo que mudaria e NÃO foi aprovado (id a mais na lista de agora) aborta", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const tudo = await listaDeAgora(c);
      const a = await comLista(
        c,
        tudo.lista.filter((l) => !l.startsWith(m + "|")),
      );
      await confirmar(c);
      const e = await erroDe(c, () => rodar(c, a));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(
        /^custo_backfill: 1 modelo\(s\) mudariam e NAO estao na lista aprovada/,
      );
      expect(e.message).toContain(m);
    });
  });

  it("(b) modelo aprovado com depois divergente aborta", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const tudo = await listaDeAgora(c);
      const minha = linhaDe(tudo, m)!;
      expect(minha.split("|")[2]).toBe("20.00");
      const partes = minha.split("|");
      partes[2] = "21.00";
      const a = await comLista(
        c,
        tudo.lista.map((l) => (l === minha ? partes.join("|") : l)),
      );
      await confirmar(c);
      const e = await erroDe(c, () => rodar(c, a));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(
        /^custo_backfill: 1 modelo\(s\) da lista aprovada tem hoje antes\/depois diferente/,
      );
      expect(e.message).toContain(m);
    });
  });

  it("(c) aprovado que saiu da lista com valor gravado ≠ depois aprovado (editado depois para outro valor) aborta", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m, linha } = await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      await c.query(`UPDATE public.modelo_aviamentos SET consumo = 3 WHERE id = $1`, [linha]);
      await recalcular(c, m); // a fila acertaria: agora 30, não 20
      expect((await custos(c, m)).peca).toBe(30);
      await confirmar(c);
      const e = await erroDe(c, () => rodar(c, a));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(
        /^custo_backfill: 1 modelo\(s\) aprovado\(s\) fora da lista de agora com valor gravado diferente/,
      );
      expect(e.message).toContain(m);
    });
  });

  it("(c) aprovado que foi ENVIADO AO CORTE depois da aprovação (congelado, valor ≠ depois) aborta", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      await cortar(c, m);
      await confirmar(c);
      const e = await erroDe(c, () => rodar(c, a));
      expect(e.message).toMatch(/fora da lista de agora com valor gravado diferente/);
    });
  });

  it("aprovado já convergido (a fila acertou para o MESMO depois) é pulado sem erro; o resto é corrigido", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const outro = await cardSimples(c, 3, 1);
      const a = await listaDeAgora(c);
      await recalcular(c, m);
      expect((await custos(c, m)).peca).toBe(20);
      await confirmar(c);
      const r = await rodar(c, a);
      expect(r.pulados_ja_convergidos_ids).toEqual([m]);
      expect(r.corrigidos).toBe(a.n - 1);
      expect(r.pulados_fora_de_escopo).toBe(0);
      expect((await custos(c, outro.m)).peca).toBe(3);
      // m não entrou no backup (nada a gravar nele)
      const b = await um<{ n: string }>(
        c,
        `SELECT count(*) AS n FROM public._bkp_custo_previsto WHERE modelo_id = $1`,
        [m],
      );
      expect(Number(b.n)).toBe(0);
    });
  });

  it("aprovado que foi EXCLUÍDO depois da aprovação é pulado e relatado (não há o que gravar)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      await c.query(`DELETE FROM public.modelos WHERE id = $1`, [m]);
      await confirmar(c);
      const r = await rodar(c, a);
      expect(r.pulados_fora_de_escopo_ids).toEqual([m]);
      expect(r.corrigidos).toBe(a.n - 1);
    });
  });

  it("lista fora do formato canônico ou com modelo repetido = P0001", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await listaDeAgora(c);
      await confirmar(c);
      const ruim = { lista: [...a.lista.slice(1), "nao-e-uuid|1|2"], hash: a.hash, n: a.n }; // o formato e conferido ANTES do hash
      const e1 = await erroDe(c, () => rodar(c, ruim));
      expect(e1.message).toMatch(/fora do formato canonico/);
      const dup = await comLista(c, [...a.lista, a.lista[0]]);
      const e2 = await erroDe(c, () => rodar(c, dup));
      expect(e2.message).toMatch(/repetido na lista aprovada/);
      // hash = md5 da forma canônica (= hash_lista do kit)
      const h = await um<{ h: string }>(c, `SELECT public._custo_lista_hash($1::jsonb) AS h`, [
        JSON.stringify(a.lista),
      ]);
      expect(h.h).toBe(a.hash);
    });
  });
});

// ─────────────────────────────── (c) confirmação ───────────────────────────────
describe.skipIf(!PRONTO)("C2 (c) — confirmação obrigatória", () => {
  it("sem SET app.confirmo_recalculo_custo = 'sim' recusa (P0001) e nada muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m } = await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      const e = await erroDe(c, () => rodar(c, a));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(
        /^custo_backfill: recusado - falta SET app.confirmo_recalculo_custo = sim/,
      );
      await c.query(`SELECT set_config('app.confirmo_recalculo_custo', 'SIM', true)`);
      const e2 = await erroDe(c, () => rodar(c, a));
      expect(e2.message).toMatch(/recusado/);
      expect((await custos(c, m)).peca).toBeNull();
    });
  });
});

// ─────────────────────────────── (d) backup / (e) restauração / (f) congelados ───────────────────────────────
describe.skipIf(!PRONTO)("C2 (d/e/f) — backup, restauração e congelados", () => {
  it("backup do lote tem as colunas do modelo E as linhas do BOM (antes/depois, hash da lista); só o que muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m, linha } = await cardSimples(c, 10, 2);
      const a = await listaDeAgora(c);
      await confirmar(c);
      const r = await rodar(c, a);
      expect(r.bkp_modelos).toBeGreaterThan(0);
      expect(r.bkp_linhas).toBeGreaterThan(0);
      const { rows } = await c.query(
        `SELECT tabela, id::text, coluna, antes, depois, hash_lista, tenant_id::text FROM public._bkp_custo_previsto
          WHERE lote = $1 AND modelo_id = $2 ORDER BY tabela COLLATE "C", coluna COLLATE "C"`,
        [r.lote, m],
      );
      expect(rows.map((x) => [x.tabela, x.id, x.coluna, n(x.antes), n(x.depois)])).toEqual([
        ["modelo_aviamentos", linha, "custo_previsto", null, 20],
        ["modelos", m, "custo_aviamento_total", null, 20],
        ["modelos", m, "custo_entretela_total", null, 0],
        ["modelos", m, "custo_forro_total", null, 0],
        ["modelos", m, "custo_peca_previsto", null, 20],
        ["modelos", m, "custo_tecido_total", null, 0],
      ]);
      for (const x of rows) {
        expect(x.hash_lista).toBe(a.hash);
        expect(x.tenant_id).toBe(T);
      }
      const t = await um<any>(
        c,
        `SELECT count(*) FILTER (WHERE tabela = 'modelos') AS m, count(*) FILTER (WHERE tabela <> 'modelos') AS l,
                count(*) FILTER (WHERE antes IS NOT DISTINCT FROM depois) AS iguais, count(DISTINCT modelo_id) AS modelos
           FROM public._bkp_custo_previsto WHERE lote = $1`,
        [r.lote],
      );
      expect([Number(t.m), Number(t.l), Number(t.iguais), Number(t.modelos)]).toEqual([
        r.bkp_modelos,
        r.bkp_linhas,
        0,
        a.n,
      ]);
    });
  });

  it("restauração (arquivo rollback/..._restaurar.sql): sem confirmação recusa; com ela devolve o antes SÓ dos modelos intocados, relata os mexidos; 2ª vez não muda nada", async () => {
    await withTx(async (c) => {
      const avisos: string[] = [];
      const ouvir = (x: { message?: string }) => avisos.push(String(x.message));
      c.on("notice", ouvir);
      try {
        await prepara(c);
        const intacto = await cardSimples(c, 10, 2);
        const mexido = await cardSimples(c, 5, 1);
        const a = await listaDeAgora(c);
        // um modelo da cópia (o 1º da lista que não é nosso) também é devolvido
        const daCopia = a.lista
          .map((l) => l.split("|")[0])
          .find((id) => id !== intacto.m && id !== mexido.m)!;
        const antesCopia = await custos(c, daCopia);
        await confirmar(c);
        await rodar(c, a);
        expect((await custos(c, intacto.m)).peca).toBe(20);
        await c.query(`UPDATE public.modelo_aviamentos SET consumo = 4 WHERE id = $1`, [
          mexido.linha,
        ]);
        await recalcular(c, mexido.m);
        expect((await custos(c, mexido.m)).peca).toBe(20);

        const e = await erroDe(c, () => c.query(BLOCO_RESTAURAR));
        expect(e.message).toMatch(/^custo_restaurar: recusado/);
        await c.query(`SELECT set_config('app.confirmo_restaurar_custo', 'sim', true)`);
        await c.query(BLOCO_RESTAURAR);
        // intacto: volta ao antes (NULL) nas colunas e na linha
        expect(await custos(c, intacto.m)).toEqual({
          peca: null,
          tecido: null,
          forro: null,
          entretela: null,
          aviamento: null,
        });
        expect(await custoAviamento(c, intacto.linha)).toBeNull();
        // mexido depois da correção: fica como está e é relatado
        expect((await custos(c, mexido.m)).peca).toBe(20);
        expect(await custoAviamento(c, mexido.linha)).toBe(20);
        expect(avisos.some((x) => /PULADOS/.test(x) && x.includes(mexido.m))).toBe(true);
        expect(await custos(c, daCopia)).toEqual(antesCopia);
        // a GUC do sistema volta ao que era; o restaurado não entrou na fila
        expect(
          (
            await um<{ v: string | null }>(
              c,
              `SELECT current_setting('app.custo_sistema', true) AS v`,
            )
          ).v ?? "",
        ).not.toBe("on");
        // 2ª vez: nada muda (todos já com o antes, exceto o mexido)
        avisos.length = 0;
        await c.query(BLOCO_RESTAURAR);
        expect(await custos(c, intacto.m)).toEqual({
          peca: null,
          tecido: null,
          forro: null,
          entretela: null,
          aviamento: null,
        });
        expect((await custos(c, mexido.m)).peca).toBe(20);
        expect(avisos.some((x) => /0 modelo\(s\) devolvido\(s\)/.test(x))).toBe(true);
        // o backup continua lá
        expect(
          Number(
            (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public._bkp_custo_previsto`)).n,
          ),
        ).toBeGreaterThan(0);
      } finally {
        c.off("notice", ouvir);
      }
    });
  });

  it("congelados (enviados ao corte) aparecem na prévia marcados e a correção NÃO os toca (R-CD2)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { m, linha } = await cardSimples(c, 10, 2);
      await cortar(c, m);
      const prev = await um<any>(
        c,
        `SELECT x.congelado, x.previsto_depois FROM (${ARQ_LISTA}) x WHERE x.modelo_id = $1`,
        [m],
      );
      expect(prev).toEqual({ congelado: true, previsto_depois: "20.00" });
      const f = await um<any>(
        c,
        `SELECT x.congelado FROM public._custo_previa_lista() x WHERE x.modelo_id = $1`,
        [m],
      );
      expect(f.congelado).toBe(true);
      const a = await listaDeAgora(c);
      expect(linhaDe(a, m)).toBeUndefined();
      await confirmar(c);
      const r = await rodar(c, a);
      expect(r.corrigidos).toBe(a.n);
      expect((await custos(c, m)).peca).toBeNull();
      expect(await custoAviamento(c, linha)).toBeNull();
      const b = await um<{ n: string }>(
        c,
        `SELECT count(*) AS n FROM public._bkp_custo_previsto WHERE modelo_id = $1`,
        [m],
      );
      expect(Number(b.n)).toBe(0);
      // os congelados da cópia também ficam como estão
      const { rows } = await c.query(
        `SELECT x.modelo_id FROM public._custo_previa_lista() x WHERE x.congelado`,
      );
      expect(rows.map((x) => x.modelo_id)).toContain(m);
    });
  });
});

// ─────────────────────────────── (g) ACL ───────────────────────────────
describe.skipIf(!PRONTO)("C2 (g) — ACL (#9, precedente _p137_backfill_rodar)", () => {
  it("as 4 funções: SECURITY DEFINER, sem EXECUTE para PUBLIC/anon/authenticated/service_role", async () => {
    await withTx(async (c) => {
      for (const f of FUNCOES) {
        const d = await um<{ d: boolean }>(
          c,
          `SELECT prosecdef AS d FROM pg_proc WHERE oid = to_regprocedure($1)`,
          [f],
        );
        expect({ f, definer: d.d }).toEqual({ f, definer: true });
        for (const papel of ["public", "anon", "authenticated", "service_role"]) {
          const r = await um<{ p: boolean }>(
            c,
            `SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`,
            [papel, f],
          );
          expect({ f, papel, pode: r.p }).toEqual({ f, papel, pode: false });
        }
      }
    });
  });

  it("_bkp_custo_previsto: RLS ligada, sem policy, nenhum privilégio para anon/authenticated/service_role", async () => {
    await withTx(async (c) => {
      const r = await um<any>(
        c,
        `SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public._bkp_custo_previsto'::regclass) AS rls,
                (SELECT count(*) FROM pg_policy WHERE polrelid = 'public._bkp_custo_previsto'::regclass)::int AS pols`,
      );
      expect(r).toEqual({ rls: true, pols: 0 });
      for (const papel of ["anon", "authenticated", "service_role"]) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const p = await um<{ p: boolean }>(
            c,
            `SELECT has_table_privilege($1, 'public._bkp_custo_previsto', $2) AS p`,
            [papel, priv],
          );
          expect({ papel, priv, pode: p.p }).toEqual({ papel, priv, pode: false });
        }
      }
    });
  });

  it("o arquivo da prévia segue as regras do kit (um SELECT, sem ';', sem meta-comando, sem ':nome' fora de string; loja do modelo)", () => {
    const semComentarioNemString = ARQ_LISTA.split("\n")
      .map((l) => l.replace(/--.*$/, "").replace(/'[^']*'/g, ""))
      .join("\n");
    const util = ARQ_LISTA.split("\n").filter((l) => !/^--/.test(l) && l.trim() !== "");
    expect(util[0]).toBe("WITH m AS (");
    expect(util[util.length - 1]).toBe(" ORDER BY l.id");
    expect(ARQ_LISTA).not.toContain(";");
    expect(/^\s*\\/m.test(ARQ_LISTA)).toBe(false);
    expect(/(^|[^:]):[A-Za-z_]/m.test(semComentarioNemString)).toBe(false);
    expect(ARQ_LISTA).toContain("l.tenant_id = m.tenant_id");
    expect(semComentarioNemString).not.toContain("get_user_tenant_id");
  });
});
