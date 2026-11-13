-- Passo 0 (SO LEITURA) — Kanban PL deploy: duplicatas de M.O. do MESMO tipo que exige peca teste.
-- Lista as linhas de modelo_servico_mo de produtos com 2+ linhas do mesmo tipo (categoria_terceirizado_id)
-- cujo tipo tem exige_peca_teste=true. A 2a linha (valor 0, 0 tentativas, 0 blocos) e a candidata a remover.
-- REGRA: se alguma linha duplicada tiver tentativas>0 OU blocos>0, NAO remover automaticamente — decidir caso a caso.
-- Rodar: psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/etapas_pl_passo0_dup_mo.sql
SELECT m.ref,
       t.nome                                   AS loja,
       ct.nome                                  AS tipo_servico,
       s.id                                     AS linha_id,
       s.valor,
       s.empresa_id,
       (SELECT count(*) FROM public.modelo_peca_teste_tentativas pt WHERE pt.mo_linha_id = s.id) AS tentativas,
       (SELECT count(*) FROM public.producao_terceirizados pr WHERE pr.mo_linha_id = s.id)        AS blocos,
       s.created_at,
       row_number() OVER (PARTITION BY s.modelo_id, s.categoria_terceirizado_id
                          ORDER BY s.created_at, s.id)                                            AS ordem_na_duplicata
  FROM public.modelo_servico_mo s
  JOIN public.modelos m               ON m.id = s.modelo_id
  JOIN public.tenants t               ON t.id = m.tenant_id
  JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.exige_peca_teste
 WHERE (s.modelo_id, s.categoria_terceirizado_id) IN (
         SELECT modelo_id, categoria_terceirizado_id
           FROM public.modelo_servico_mo
          WHERE categoria_terceirizado_id IS NOT NULL
          GROUP BY modelo_id, categoria_terceirizado_id
         HAVING count(*) > 1)
 ORDER BY t.nome, m.ref, s.created_at, s.id
