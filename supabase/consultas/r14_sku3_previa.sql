-- r14_sku3_previa.sql — CONTAGEM SÓ-LEITURA do sku #3 (achados MÉDIOS R14; fix round 1, B3).
-- Uma linha por produto (card) com SKU gravado AUTOMÁTICO (manual = false) diferente do PREVISTO (_skus_calc_ref_tipo.sku, o
-- que o Regerar gravaria) — a falta nova "SKU desatualizado — Regerar" de _integracao_retrato_core (20261024200000), só nas
-- lojas com 'ref_sku' marcado nos campos da Integração. Colunas:
--   n_desatualizados  linhas que viram falta;
--   n_conflito        dessas, quantas têm o SKU PREVISTO já usado por OUTRA linha (do mesmo produto, ou de outro produto da
--                     loja que não é réplica — a mesma exceção do _skus_plano). O Regerar NÃO resolve estas (marca
--                     'conflito' e não grava): precisa editar o SKU à mão ou mudar a sigla;
--   vira_faltam_dados produto hoje "Pronto para integrar" (estado não integrável e sem NENHUMA outra falta) que passa a
--                     "Faltam dados" só por causa desta falta. Integrável/integrado não muda (o retrato é congelado).
-- Funciona antes OU depois da ida (ignora as faltas "SKU desatualizado" ao julgar o resto). Chama só funções STABLE
-- (_skus_calc_ref_tipo, _custo_unitario_modelos_core, _integracao_retrato_core). Rodar em transação READ ONLY + ROLLBACK.
-- Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando do psql.
-- Escala no Passo 0 de produção (01/out 11:06): 30 SKUs / 29 não manuais / 2 modelos; cópia 54422: 0 desatualizados.
WITH cfg AS (
  SELECT ic.tenant_id, ic.campos FROM public.integracao_config ic WHERE 'ref_sku' = ANY (coalesce(ic.campos, '{}'::text[]))
), lin AS (
  SELECT m.id AS modelo_id, m.tenant_id, sk.variante_key, sk.tamanho_key, sk.sku AS gravado, k.sku AS previsto,
         public._sku_norm_ref(m.ref) AS refn
    FROM public.modelo_skus sk
    JOIN public.modelos m ON m.id = sk.modelo_id
    JOIN cfg ON cfg.tenant_id = m.tenant_id
    JOIN LATERAL public._skus_calc_ref_tipo(m.id, m.ref, coalesce(m.tamanho_tipo, 'letra')) k
      ON k.variante_key = sk.variante_key AND k.tamanho_key = sk.tamanho_key
   WHERE NOT coalesce(sk.manual, false)
     AND nullif(btrim(coalesce(sk.sku, '')), '') IS NOT NULL
     AND nullif(btrim(coalesce(k.sku, '')), '') IS NOT NULL
     AND sk.sku IS DISTINCT FROM k.sku
), por_modelo AS (
  SELECT l.modelo_id, l.tenant_id, count(*) AS n_desatualizados,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.modelo_skus o JOIN public.modelos mo ON mo.id = o.modelo_id
            WHERE o.tenant_id = l.tenant_id AND o.sku = l.previsto
              AND NOT (o.modelo_id = l.modelo_id AND o.variante_key = l.variante_key AND o.tamanho_key = l.tamanho_key)
              AND NOT (o.modelo_id <> l.modelo_id AND public._sku_norm_ref(mo.ref) = l.refn
                       AND o.variante_key = l.variante_key AND o.tamanho_key = l.tamanho_key))) AS n_conflito
    FROM lin l GROUP BY l.modelo_id, l.tenant_id
)
SELECT coalesce(tn.nome::text, '?') AS loja, pm.modelo_id, m.nome::text AS nome, coalesce(ip.estado, 'nao_integravel') AS estado,
       pm.n_desatualizados, pm.n_conflito,
       (coalesce(ip.estado, 'nao_integravel') = 'nao_integravel'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(public._integracao_retrato_core(pm.modelo_id, cfg.campos,
                          public._custo_unitario_modelos_core(ARRAY[pm.modelo_id]) -> pm.modelo_id::text) -> 'faltas') f(x)
           WHERE f.x ->> 'texto' NOT LIKE '%SKU%desatualizado%')) AS vira_faltam_dados
  FROM por_modelo pm
  JOIN public.modelos m ON m.id = pm.modelo_id
  JOIN cfg ON cfg.tenant_id = pm.tenant_id
  LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = pm.modelo_id
  LEFT JOIN public.tenants tn ON tn.id = pm.tenant_id
 ORDER BY 1, 3, 2
