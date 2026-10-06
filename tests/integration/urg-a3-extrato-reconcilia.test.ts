// Urgentes R3 T14 — ANTI-DRIFT do extrato (Ruling A17): para TODA loja e TODO item da copia, Σ quantidade por bucket do
// _estoque_extrato_<fam>_core == recebido - baixa do _estoque_<fam>_core (diferenca 0, numeric exato), core_* de toda linha == a linha do
// core, nenhum bucket fora do core e todo bucket do core sem linha tem recebido - baixa = 0 (saldo 0 sem movimento). Tecido por variante,
// aviamento por variante (inclusive "Sem variante" NULL), insumo por (tamanho, cor). Mais o contrato com a lib TS (src/lib/estoque-extrato.ts):
// montarExtrato sobre a saida REAL (formato do PostgREST) dos itens com mais movimentos da copia => confere.
// So leitura; txn revertida; o bloco 177000 entra por aplicaUrgA se ainda nao estiver vivo. So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, ehBancoLocal, comoUsuario, um, semJwt, TENANT_TESTE } from "./db";
import { aplicaUrgA } from "./urg-a-helpers";
import { filtrarBucket, montarExtrato, movDeLinhaRpc, type FamiliaEstoque } from "@/lib/estoque-extrato";

const RODA = hasDb && ehBancoLocal();

// por familia: o universo de buckets do core (tenant, item, chave), Σ/core_* do extrato chamado para CADA item do core
const SQL: Record<FamiliaEstoque, string> = {
  tecido: `
    WITH core AS (
      SELECT t.id AS tenant, x.variante_tecido_id AS item, x.variante_tecido_id::text AS chave, x.recebido_m AS rec, x.baixa, x.fisico
        FROM public.tenants t CROSS JOIN LATERAL public._estoque_tecido_core(t.id) x),
    itens AS (SELECT DISTINCT tenant, item FROM core),
    ext AS (
      SELECT i.tenant, i.item, e.bucket_variante_id::text AS chave, e.*
        FROM itens i CROSS JOIN LATERAL public._estoque_extrato_tecido_core(i.tenant, i.item) e)`,
  aviamento: `
    WITH core AS (
      SELECT t.id AS tenant, x.id AS item, coalesce(x.variante_id::text, '<sem>') AS chave, x.recebido AS rec, x.baixa, x.fisico
        FROM public.tenants t CROSS JOIN LATERAL public._estoque_aviamento_core(t.id) x),
    itens AS (SELECT DISTINCT tenant, item FROM core),
    ext AS (
      SELECT i.tenant, i.item, coalesce(e.bucket_variante_id::text, '<sem>') AS chave, e.*
        FROM itens i CROSS JOIN LATERAL public._estoque_extrato_aviamento_core(i.tenant, i.item) e)`,
  insumo: `
    WITH core0 AS (
      SELECT DISTINCT t.id AS tenant, x.etiqueta_id AS item, coalesce(x.tamanho, '<nulo>') || '|' || coalesce(x.cor_nome, '<nulo>') AS chave,
             x.recebido, x.prev_receb, x.baixa, x.fisico, x.variante_id
        FROM public.tenants t CROSS JOIN LATERAL public._estoque_etiqueta_core(t.id) x),
    core AS (
      SELECT tenant, item, chave, sum(recebido) AS rec, sum(baixa) AS baixa, sum(fisico) AS fisico
        FROM (SELECT DISTINCT tenant, item, chave, recebido, prev_receb, baixa, fisico FROM core0) d GROUP BY 1, 2, 3),
    itens AS (SELECT DISTINCT tenant, item FROM core),
    ext AS (
      SELECT i.tenant, i.item, coalesce(e.bucket_tamanho, '<nulo>') || '|' || coalesce(e.bucket_cor_nome, '<nulo>') AS chave, e.*
        FROM itens i CROSS JOIN LATERAL public._estoque_extrato_insumo_core(i.tenant, i.item) e)`,
};
const CHECA = `,
    soma AS (SELECT tenant, item, chave, sum(quantidade) AS s, count(*) AS n FROM ext GROUP BY 1, 2, 3)
    SELECT 'fora_do_core' AS erro, s.tenant, s.item, s.chave, s.s AS valor, NULL::numeric AS esperado
      FROM soma s WHERE NOT EXISTS (SELECT 1 FROM core c WHERE c.tenant = s.tenant AND c.item = s.item AND c.chave = s.chave)
    UNION ALL
    SELECT 'soma', c.tenant, c.item, c.chave, coalesce(s.s, 0), c.rec - c.baixa
      FROM core c LEFT JOIN soma s ON s.tenant = c.tenant AND s.item = c.item AND s.chave = c.chave
     WHERE coalesce(s.s, 0) <> c.rec - c.baixa
    UNION ALL
    SELECT 'core_' || e.chave, e.tenant, e.item, e.chave, e.core_recebido, c.rec
      FROM ext e JOIN core c ON c.tenant = e.tenant AND c.item = e.item AND c.chave = e.chave
     WHERE (e.core_recebido, e.core_baixa, e.core_fisico) IS DISTINCT FROM (c.rec, c.baixa, c.fisico)
    UNION ALL
    SELECT 'linha_invalida', e.tenant, e.item, e.chave, e.quantidade, NULL
      FROM ext e
     WHERE e.quantidade = 0 OR e.tipo NOT IN ('entrada', 'saida') OR (e.tipo = 'entrada') <> (e.quantidade > 0)
        OR (e.quando IS NULL) <> (e.quando_fonte = 'sem_data')
        OR e.quando_fonte NOT IN ('registro', 'data_oc', 'data_envio', 'data_os', 'sem_data')
        OR e.origem NOT IN ('oc', 'reposicao_troca', 'rolo_entrada', 'separacao_rolo', 'corte', 'ajuste', 'os', 'explosao', 'explosao_ajuste', 'revenda')
    UNION ALL
    SELECT 'contagem', NULL, NULL, NULL, (SELECT count(*) FROM core), (SELECT count(*) FROM ext)
     WHERE (SELECT count(*) FROM core) = 0`;

async function varre(c: Client, fam: FamiliaEstoque) {
  await c.query("SET LOCAL statement_timeout = '600s'");
  await aplicaUrgA(c, "177000");
  const { rows } = await c.query(SQL[fam] + CHECA);
  const tot = (await c.query(`${SQL[fam]} SELECT (SELECT count(*) FROM core)::int AS buckets, (SELECT count(*) FROM itens)::int AS itens,
                                    (SELECT count(*) FROM ext)::int AS linhas`)).rows[0];
  return { erros: rows, tot };
}

describe.skipIf(!RODA)("urg R3 T14 — extrato reconcilia com o core em TODOS os buckets da copia (anti-drift)", () => {
  for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
    it(`${fam}: Σ por bucket = recebido - baixa do core; core_* = a linha do core; nenhum bucket fora do core`, async () => {
      await withTx(async (c) => {
        const { erros, tot } = await varre(c, fam);
        console.log(`[urg-a3 reconcilia] ${fam}: ${tot.itens} itens, ${tot.buckets} buckets do core, ${tot.linhas} linhas do extrato`);
        expect(erros).toEqual([]);
      });
    }, 600_000);
  }

  it("insumo: o core nao tem buckets (tamanho, cor) repetidos com numeros diferentes (a soma do bucket da lib TS e exata)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `SELECT t.id, x.etiqueta_id, x.tamanho, x.cor_nome, count(DISTINCT (x.recebido, x.prev_receb, x.baixa, x.fisico)) AS n
           FROM public.tenants t CROSS JOIN LATERAL public._estoque_etiqueta_core(t.id) x
          GROUP BY 1, 2, 3, 4 HAVING count(DISTINCT (x.recebido, x.prev_receb, x.baixa, x.fisico)) > 1`);
      expect(rows).toEqual([]);
    });
  });

  it("contrato TS (src/lib/estoque-extrato.ts): montarExtrato sobre a saida REAL dos itens com mais movimentos da copia => confere em todo bucket", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '600s'");
      await aplicaUrgA(c, "177000");
      const ITENS: Record<FamiliaEstoque, string> = {
        tecido: `SELECT t.id AS tenant, x.variante_tecido_id AS item FROM public.tenants t CROSS JOIN LATERAL public._estoque_tecido_core(t.id) x
                  WHERE x.recebido_m <> 0 OR x.baixa <> 0`,
        aviamento: `SELECT DISTINCT t.id AS tenant, x.id AS item FROM public.tenants t CROSS JOIN LATERAL public._estoque_aviamento_core(t.id) x
                     WHERE x.recebido <> 0 OR x.baixa <> 0`,
        insumo: `SELECT DISTINCT t.id AS tenant, x.etiqueta_id AS item FROM public.tenants t CROSS JOIN LATERAL public._estoque_etiqueta_core(t.id) x
                  WHERE x.recebido <> 0 OR x.baixa <> 0`,
      };
      let conferidos = 0;
      for (const fam of ["tecido", "aviamento", "insumo"] as FamiliaEstoque[]) {
        const core = `public._estoque_extrato_${fam}_core`;
        const { rows: top } = await c.query(
          `SELECT i.tenant, i.item, (SELECT count(*) FROM ${core}(i.tenant, i.item)) AS n FROM (${ITENS[fam]}) i ORDER BY n DESC, i.item LIMIT 3`);
        for (const { tenant, item } of top) {
          const { rows } = await c.query(`SELECT to_jsonb(x) AS j FROM ${core}($1, $2) x`, [tenant, item]);
          const movs = rows.map((r) => movDeLinhaRpc(r.j));
          const buckets = new Map<string, { varianteId: string | null; tamanho: string | null; corNome: string | null }>();
          for (const m of movs) {
            const b = fam === "insumo"
              ? { varianteId: null, tamanho: m.bucketTamanho || null, corNome: m.bucketCorNome || null }
              : { varianteId: m.bucketVarianteId, tamanho: null, corNome: null };
            buckets.set(JSON.stringify(b), b);
          }
          for (const b of buckets.values()) {
            const ms = filtrarBucket(movs, b, fam);
            const ex = montarExtrato(ms, { fuso: "America/Sao_Paulo" });
            expect(ex.confere, `${fam} ${item} ${JSON.stringify(b)}`).toBe(true);
            expect(ex.linhas.length).toBe(ms.length);
            conferidos++;
          }
        }
      }
      expect(conferidos).toBeGreaterThan(3);
    });
  }, 600_000);
});

// [fix round 1, L3] casos SEMEADOS que a copia nao exercita: saldo NEGATIVO (contrato T15: negativo, fisicoTela 0) e revenda de produto
// IMPORTADO ainda nao enviado ao PCP (ramo ocs_importado da data/OC). Txn revertida.
describe.skipIf(!RODA)("urg R3 T14 — extrato: saldo negativo e revenda de importado (semeados)", () => {
  const T = TENANT_TESTE;
  async function prepara(c: Client) {
    await c.query("SET LOCAL statement_timeout = '180s'");
    await aplicaUrgA(c, "177000");
    await comoUsuario(c);
    await semJwt(c, () => c.query(`UPDATE public.tenant_config SET timezone = 'America/Sao_Paulo' WHERE tenant_id = $1`, [T]));
  }
  const linhas = async (c: Client, fam: FamiliaEstoque, id: string) =>
    (await c.query(`SELECT to_jsonb(x) AS j FROM public._estoque_extrato_${fam}_core($1, $2) x`, [T, id])).rows.map((r) => movDeLinhaRpc(r.j));

  it("saldo NEGATIVO (cortou mais do que recebeu): Σ = recebido - baixa < 0; a lib marca negativo, confere e a tela mostra 0", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = Date.now().toString(36);
      const art = (await um<{ id: string }>(c,
        `INSERT INTO public.artigos (tenant_id, nome, unidade_medida) VALUES ($1, $2, 'metro') RETURNING id`, [T, `ITEST-R3 neg ${s}`])).id;
      const vari = (await um<{ id: string }>(c,
        `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, 'ITEST-R3 neg') RETURNING id`, [T, art])).id;
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido (tenant_id, status, numero_pedido, data_entrega) VALUES ($1, 'recebido', 'ITEST-R3-NEG', '2026-02-01') RETURNING id`, [T])).id;
      const it = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida)
         VALUES ($1, $2, $3, 10, 10) RETURNING id`, [oc, art, vari])).id;
      await c.query(`INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem)
                     VALUES ($1, NULL, $2, $3, 15, 'vinculo')`, [T, it, vari]);
      const core = await um<any>(c, `SELECT recebido_m, baixa, fisico FROM public._estoque_tecido_core($1) WHERE variante_tecido_id = $2`, [T, vari]);
      expect([Number(core.recebido_m), Number(core.baixa), Number(core.fisico)]).toEqual([10, 15, 0]);
      const ms = await linhas(c, "tecido", vari);
      expect(ms.map((m) => `${m.origem}:${m.quantidade}`).sort()).toEqual(["corte:-15", "oc:10"]);
      const ex = montarExtrato(filtrarBucket(ms, { varianteId: vari }, "tecido"), { fuso: "America/Sao_Paulo" });
      expect([ex.saldoFinal, ex.negativo, ex.fisicoTela, ex.confere]).toEqual([-5, true, 0, true]);
    });
  });

  it("revenda de produto IMPORTADO ainda nao enviado: consumo x pecas recebidas; data/OC = a OC de importado RECEBIDA (data so-dia); Σ = core", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const s = Date.now().toString(36);
      const cor = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `ITEST-R3 IMP ${s}`])).id;
      const etq = (await um<{ id: string }>(c,
        `INSERT INTO public.etiquetas (tenant_id, nome, preco, formato_tamanho) VALUES ($1, $2, 1, 'nenhum') RETURNING id`, [T, `ITEST-R3 IMP ${s}`])).id;
      const m = (await um<{ id: string }>(c, `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, 'importado') RETURNING id`,
        [T, `ITEST-R3 importado ${s}`])).id;
      const cad = (await um<{ id: string }>(c,
        `INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, false) RETURNING id`, [T, m])).id;
      await c.query(`INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
                     VALUES ($1, 1, '{"M": 4, "P": 6}'::jsonb, '{"M": 4, "P": 6}'::jsonb, 10, 10)`, [cad]);
      await c.query(`INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, consumo) VALUES ($1, $2, $3, $4, 1.5)`, [T, m, etq, cor]);
      const pi = (await um<{ id: string }>(c,
        `INSERT INTO public.produtos_importados (tenant_id, nome, modelo_id) VALUES ($1, $2, $3) RETURNING id`, [T, `ITEST-R3 importado ${s}`, m])).id;
      const oc = await um<{ id: string; numero: string }>(c,
        `INSERT INTO public.ocs_importado (tenant_id, produto_importado_id, nome_produto, status, data_entrega)
         VALUES ($1, $2, $3, 'recebido', '2026-06-15') RETURNING id, numero`, [T, pi, `ITEST-R3 importado ${s}`]);
      const ms = await linhas(c, "insumo", etq);
      expect(ms.map((x) => [x.origem, x.quantidade, x.quandoFonte, Date.parse(x.quando!), x.refOc, x.refId, x.bucketTamanho, x.bucketCorId])).toEqual([
        ["revenda", -15, "data_oc", Date.parse("2026-06-15T03:00:00Z"), oc.numero, cad, null, cor],
      ]);
      const core = await um<any>(c, `SELECT recebido, baixa FROM public._estoque_etiqueta_core($1) WHERE etiqueta_id = $2`, [T, etq]);
      expect([Number(core.recebido), Number(core.baixa)]).toEqual([0, 15]);
      const ex = montarExtrato(filtrarBucket(ms, { tamanho: null, corNome: `ITEST-R3 IMP ${s}` }, "insumo"), { fuso: "America/Sao_Paulo" });
      expect([ex.saldoFinal, ex.confere, ex.negativo]).toEqual([-15, true, true]);
    });
  });
});
