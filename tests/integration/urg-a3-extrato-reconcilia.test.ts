// Urgentes R3 T14 — ANTI-DRIFT do extrato (Ruling A17): para TODA loja e TODO item da copia, Σ quantidade por bucket do
// _estoque_extrato_<fam>_core == recebido - baixa do _estoque_<fam>_core (diferenca 0, numeric exato), core_* de toda linha == a linha do
// core, nenhum bucket fora do core e todo bucket do core sem linha tem recebido - baixa = 0 (saldo 0 sem movimento). Tecido por variante,
// aviamento por variante (inclusive "Sem variante" NULL), insumo por (tamanho, cor). Mais o contrato com a lib TS (src/lib/estoque-extrato.ts):
// montarExtrato sobre a saida REAL (formato do PostgREST) dos itens com mais movimentos da copia => confere.
// So leitura; txn revertida; o bloco 177000 entra por aplicaUrgA se ainda nao estiver vivo. So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, ehBancoLocal } from "./db";
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
