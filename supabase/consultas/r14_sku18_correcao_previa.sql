-- r14_sku18_correcao_previa.sql — PRÉVIA SÓ-LEITURA da correção única do sku #18 (achados MÉDIOS R14, P-88 A; fix round 1, B2).
-- O MESMO critério de candidatos de supabase/migrations/20261024210100_espelho_ref_correcao_unica.sql (e do gatilho
-- fn_espelho_ref_ao_vincular): card comprado (revenda/importado) com REF vazia, NÃO enviado à Explosão, vinculado (mesma loja)
-- a produto com REF, e sem trava da Integração em 'ref_sku'.
-- Uso no kit: rodar em transação READ ONLY (+ ROLLBACK) ANTES da correção; SÓ seguir se o resultado for EXATAMENTE 1 linha:
--   Loja Teste | f8e77ebe… | Cinto Teste | 0000002   (Passo 0 de produção, 01/out 11:06).
-- Qualquer outra lista → PARA e pergunta ao dono (a correção grava sem pedir confirmação por linha; o teto dela é 5).
-- Chama só _integracao_campo_travado (STABLE, leitura). Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e
-- vírgula, sem meta-comando do psql.
SELECT coalesce(tn.nome::text, '?') AS loja, m.id AS modelo_id, m.nome::text AS nome, p.tipo, p.pref AS ref_do_produto
  FROM public.modelos m
  JOIN (SELECT pa.modelo_id, pa.tenant_id, 'PA'::text AS tipo, nullif(btrim(coalesce(pa.ref::text, '')), '') AS pref
          FROM public.produtos_acabados pa WHERE pa.modelo_id IS NOT NULL
        UNION ALL
        SELECT pi.modelo_id, pi.tenant_id, 'PI'::text, nullif(btrim(coalesce(pi.ref::text, '')), '')
          FROM public.produtos_importados pi WHERE pi.modelo_id IS NOT NULL) p
    ON p.modelo_id = m.id AND p.tenant_id = m.tenant_id AND p.pref IS NOT NULL
  LEFT JOIN public.tenants tn ON tn.id = m.tenant_id
 WHERE coalesce(m.origem, 'interno') IN ('revenda', 'importado')
   AND coalesce(btrim(m.ref::text), '') = ''
   AND NOT coalesce(m.enviado_cad, false)
   AND NOT public._integracao_campo_travado(m.id, 'ref_sku')
 ORDER BY 1, 2
