-- l8_passo0_comprados.sql — CONTAGEM SÓ-LEITURA dos LEVES L8 (Comprados: custo, preço e insumo; 20261028200000).
-- Uma linha, só SELECT em tabelas (nenhuma função do sistema chamada). Funciona antes OU depois da ida. Colunas:
--   revendas_consumo_dif_1    revendas (produto acabado com card) cujo card tem linha de insumo com consumo <> 1 — onde o
--                             preço M1 muda a conta (antes: consumo x custo_previsto, contando o consumo 2x). Esperado 0;
--   revendas_insumos_diverge  insumos_total gravado <> Soma custo_previsto do card (o próximo save/edição de insumo acerta);
--   revendas_preco_diverge    preço gravado no card (atacado/venda) <> o que a L8 calcula (fixo manda; markup > 0 senão
--                             NULL; venda travada pela Integração = a gravada) — quantos preços ANDAM na próxima edição.
--                             Esperado 0 (o plano conta 0 na cópia);
--   revendas_markup_zero      revendas com markup 0 (B3: o preço daquele canal vira NULL na próxima conta);
--   grades_orfas_pa           modelo_grades de card de revenda sem variante do produto com aquela ordem (sku #22). Esperado 0;
--   grades_orfas_imp          idem no importado (informativo: a L8 só limpa a revenda);
--   etapas_merc_cotacao_zero  etapas de MERCADORIA do card do importado com % > 0 e cotação <= 0 em produto COM valor de
--                             compra (valor_unitario_m1 > 0) — P-207 A + Q2: o próximo Salvar desse produto é recusado até
--                             informar a cotação. Esperado 0;
--   oc_etapas_merc_cotacao_zero idem nas etapas da OC de importado (ocs_importado_etapas; fix round 1, Q1) — a parcela
--                             dessas etapas saiu 0 e foi pulada (fin #10) e o próximo Salvar da OC é recusado. Esperado 0;
--   etapas_frete_cotacao_zero etapas de frete do card com cotação 0 (informativo: valem como 1, identidade);
--   importados_sem_etapas     produtos importados sem nenhuma etapa gravada (informativo, B2: a tela injeta as padrão,
--                             já com a cotação de referência).
-- Rodar em transação READ ONLY + ROLLBACK. Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula,
-- sem meta-comando do psql.
WITH rev AS (
  SELECT p.id, p.modelo_id, p.insumos_total, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo,
         p.preco_atacado_fixo, p.preco_varejo_fixo, m.preco_atacado, m.preco_venda,
         coalesce((SELECT sum(coalesce(me.custo_previsto, 0)) FROM public.modelo_etiquetas me WHERE me.modelo_id = p.modelo_id), 0) AS ins,
         coalesce((SELECT sum(s.valor) FROM public.modelo_servico_mo s WHERE s.modelo_id = p.modelo_id), 0) AS mo,
         EXISTS (SELECT 1 FROM public.integracao_produtos ip WHERE ip.modelo_id = p.modelo_id
                   AND ip.estado IN ('integravel', 'integrado') AND 'preco_venda' = ANY (ip.campos)) AS trava_venda
    FROM public.produtos_acabados p
    JOIN public.modelos m ON m.id = p.modelo_id AND m.tenant_id = p.tenant_id
), calc AS (
  SELECT r.*, coalesce(r.valor_unitario, 0) * (1 - coalesce(r.desconto_pct, 0) / 100.0) + r.ins + r.mo AS custo FROM rev r
), novo AS (
  SELECT c.*,
         CASE WHEN c.preco_atacado_fixo IS NOT NULL THEN c.preco_atacado_fixo
              WHEN c.markup_atacado > 0 THEN round(c.custo * c.markup_atacado, 2) END AS atacado_l8,
         CASE WHEN c.trava_venda THEN c.preco_venda
              WHEN c.preco_varejo_fixo IS NOT NULL THEN c.preco_varejo_fixo
              WHEN c.markup_varejo > 0 THEN round(c.custo * c.markup_varejo, 2) END AS venda_l8
    FROM calc c
)
SELECT
  (SELECT count(*) FROM rev r WHERE EXISTS (SELECT 1 FROM public.modelo_etiquetas me
                                             WHERE me.modelo_id = r.modelo_id AND coalesce(me.consumo, 1) <> 1)) AS revendas_consumo_dif_1,
  (SELECT count(*) FROM rev r WHERE r.insumos_total IS DISTINCT FROM r.ins) AS revendas_insumos_diverge,
  (SELECT count(*) FROM novo n WHERE (n.preco_atacado, n.preco_venda) IS DISTINCT FROM (n.atacado_l8, n.venda_l8)) AS revendas_preco_diverge,
  (SELECT count(*) FROM rev r WHERE r.markup_atacado = 0 OR r.markup_varejo = 0) AS revendas_markup_zero,
  (SELECT count(*) FROM public.modelo_grades g
     JOIN public.produtos_acabados p ON p.modelo_id = g.modelo_id
    WHERE NOT EXISTS (SELECT 1 FROM public.produto_acabado_variantes v
                       WHERE v.produto_acabado_id = p.id AND v.ordem = g.variante_numero)) AS grades_orfas_pa,
  (SELECT count(*) FROM public.modelo_grades g
     JOIN public.produtos_importados p ON p.modelo_id = g.modelo_id
    WHERE NOT EXISTS (SELECT 1 FROM public.produto_importado_variantes v
                       WHERE v.produto_importado_id = p.id AND v.ordem = g.variante_numero)) AS grades_orfas_imp,
  (SELECT count(*) FROM public.produto_importado_etapas e
     JOIN public.produtos_importados p ON p.id = e.produto_importado_id
    WHERE e.base = 'mercadoria' AND e.percentual > 0 AND coalesce(e.cotacao, 0) <= 0
      AND coalesce(p.valor_unitario_m1, 0) > 0) AS etapas_merc_cotacao_zero,
  (SELECT count(*) FROM public.ocs_importado_etapas e
     JOIN public.ocs_importado o ON o.id = e.oc_importado_id
    WHERE e.base = 'mercadoria' AND e.percentual > 0 AND coalesce(e.cotacao, 0) <= 0
      AND coalesce(o.valor_unitario_m1, 0) > 0) AS oc_etapas_merc_cotacao_zero,
  (SELECT count(*) FROM public.produto_importado_etapas e
    WHERE e.base = 'frete' AND coalesce(e.cotacao, 0) = 0) AS etapas_frete_cotacao_zero,
  (SELECT count(*) FROM public.produtos_importados p
    WHERE NOT EXISTS (SELECT 1 FROM public.produto_importado_etapas e WHERE e.produto_importado_id = p.id)) AS importados_sem_etapas
