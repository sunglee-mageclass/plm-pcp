-- custo_previa_lista.sql — PRÉVIA da correção única do custo previsto (P-166 A, plano contas-certas-cd §2/§3.5, R-CD1/R-CD2/R-CD6).
-- SELECT PURO, só leitura: não chama NENHUMA função do sistema (nem precos_tecido_congelado, que depende do JWT). O preço
-- congelado pela OC é refeito aqui com a LOJA DO MODELO (l.tenant_id = m.tenant_id — RC1), sem get_user_tenant_id().
-- Fonte única: o Passo 0-CD (savepoints/passo0-contas-certas-cd) roda ESTE arquivo byte a byte (sha256 fixado) e a
-- _custo_previa_lista() da migration 20261019310000 (que usa o cálculo do SERVIDOR, _custo_calcular da 20261019300000) tem
-- de dar o mesmo resultado, linha a linha e coluna a coluna (teste C2, tests/integration/custo-previsto-backfill.test.ts).
-- Versão da Rodada #2 (C2, alinhada ao servidor da C1 depois do G-MIGRATION): M3 — todo preço (artigo da linha, artigos dos
-- substitutos, OC do item vinculado e artigo da variante dele, aviamento, insumo e as variantes dele) só vale se for DA LOJA
-- do modelo, senão conta 0 / não congela. R-C1b — insumo = MAX das variantes da cor só entre preço > 0. O previsto da peça
-- é comparado ARREDONDADO (o servidor grava round(peça, 2) em numeric(10,2)). Modelo sem loja fica fora (o servidor só
-- recalcula por loja).
-- Regras do arquivo (ele é embutido pelo psql como variável dentro de um COPY): um único SELECT, SEM ponto e vírgula,
-- sem meta-comando do psql e sem dois-pontos seguido de letra fora de strings.
--
-- Uma linha por modelo INTERNO em que algo muda (custo das linhas do BOM, os 4 totais ou o previsto da peça), INCLUSIVE os
-- congelados (enviados ao corte, R-CD1) — a coluna `congelado` separa: o kit põe os não congelados na lista a aprovar e os
-- congelados num CSV à parte (R-CD2: a correção única NÃO os toca).
--
-- Cálculo (espelha recomputeBlock/recomputeAviamento/recomputeEtiqueta/somaCustosAdicionais/pecaCom, tolerância R-CD4):
--   linha de tecido  = round(preço × consumo × (1 + perda/100), 2), preço = congelado pela OC vinculada ao (tipo, numero)
--                      (MAX, kg ÷ rendimento, item não cancelado e com preço, vínculo, OC e artigo da variante DA LOJA do
--                      modelo), senão MAX coalesce(preco_por_metro, preco, 0) dos artigos (da loja) das variantes da linha,
--                      senão o do artigo (da loja) da linha, senão 0
--   linha de aviamento = round(coalesce(aviamentos.preco do aviamento DA LOJA, 0) × consumo × (1 + perda/100), 2)
--   linha de etiqueta  = round(preço × consumo × (1 + perda/100), 2), preço = MAX das variantes da cor (IS NOT DISTINCT FROM)
--                        contando só preço > 0, senão etiquetas.preco, senão 0 (etiqueta DA LOJA, de outra loja = 0)
--   peça = tecido + forro + entretela + aviamento + etiqueta + M.O. (Σ modelo_servico_mo.valor) + adicionais (R-CD6)
--   adicionais (R-CD6): custos_adicionais[].valor número → o valor, string numérica (com trim, aceita expoente) → o valor,
--                        qualquer outra coisa, ou custos_adicionais que não é array → 0
-- "Muda" = IS DISTINCT FROM exato (NULL → 0 conta como mudança), a peça compara com round(depois, 2), como o servidor grava.
-- Efeito visível = round(coalesce(antes,0),2) ≠ round(depois,2).
-- Sugerido (precoSugerido de src/lib/preco.ts) = próximo valor da grade 4,90/9,90 ≥ custo × markup aplicado, markup aplicado =
-- markup_editado quando > 0, senão o markup da linha do modelo (mesma loja), sobre o previsto ARREDONDADO. Preço digitado =
-- preco_venda > 0.
--
-- Forma canônica (hash da lista, plano §2): uma linha por modelo, ordenada por modelo_id (uuid), no formato
--   modelo_id|peca_antes|peca_depois|tecido_antes|tecido_depois|forro_antes|forro_depois|entretela_antes|entretela_depois|
--   aviamento_antes|aviamento_depois|md5_linhas
-- (tudo numa linha só), cada valor = round(x, 2) em texto ou 'null' para NULL, md5_linhas = md5 das linhas do BOM que mudam,
-- uma por linha no formato tabela, dois-pontos, id, dois-pontos, antes>depois (mesma regra de valor), unidas por quebra de linha e ordenadas por
-- (tabela, id) — md5 de '' quando nenhuma linha muda. hash_lista = md5 das linhas canônicas dos NÃO congelados, unidas por
-- quebra de linha na ordem de modelo_id (quem calcula o hash é o kit, não este arquivo).
WITH m AS (
  SELECT mo.id, mo.tenant_id, mo.ref, mo.nome, mo.versao, mo.linha_id, mo.preco_venda, mo.markup_editado,
         mo.custo_peca_previsto, mo.custo_tecido_total, mo.custo_forro_total, mo.custo_entretela_total, mo.custo_aviamento_total,
         mo.custos_adicionais,
         EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = mo.id AND c.enviado_corte) AS congelado
    FROM public.modelos mo
   WHERE mo.origem = 'interno' AND mo.tenant_id IS NOT NULL
),
lt AS (
  SELECT 'modelo_tecidos'::text AS tabela, mt.id, mt.modelo_id, mt.tipo::text AS tipo, mt.custo_previsto AS antes,
         round(coalesce(
           (SELECT max(CASE WHEN a.unidade_medida = 'kg' AND coalesce(a.rendimento, 0) > 0 THEN oti.preco / a.rendimento ELSE oti.preco END)
              FROM public.modelo_tecido_oc_links l
              JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
              JOIN public.ocs_tecido oc ON oc.id = oti.oc_tecido_id AND oc.tenant_id = m.tenant_id
              JOIN public.variantes_tecido vt ON vt.id = l.variante_tecido_id
              JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = m.tenant_id
             WHERE l.modelo_id = mt.modelo_id AND l.tenant_id = m.tenant_id AND l.tipo = mt.tipo AND l.numero = mt.numero
               AND oti.preco IS NOT NULL AND coalesce(oti.cancelado, false) = false),
           (SELECT max(coalesce(a.preco_por_metro, a.preco, 0))
              FROM public.modelo_tecido_variantes mtv
              JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
              JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = m.tenant_id
             WHERE mtv.modelo_tecido_id = mt.id),
           (SELECT coalesce(a.preco_por_metro, a.preco, 0) FROM public.artigos a WHERE a.id = mt.artigo_id AND a.tenant_id = m.tenant_id),
           0) * coalesce(mt.consumo, 0) * (1 + coalesce(mt.loss_percent, 0) / 100.0), 2) AS depois
    FROM public.modelo_tecidos mt
    JOIN m ON m.id = mt.modelo_id
),
la AS (
  SELECT 'modelo_aviamentos'::text AS tabela, ma.id, ma.modelo_id, 'aviamento'::text AS tipo, ma.custo_previsto AS antes,
         round(coalesce((SELECT av.preco FROM public.aviamentos av WHERE av.id = ma.aviamento_id AND av.tenant_id = m.tenant_id), 0)
               * coalesce(ma.consumo, 0) * (1 + coalesce(ma.loss_percent, 0) / 100.0), 2) AS depois
    FROM public.modelo_aviamentos ma
    JOIN m ON m.id = ma.modelo_id
),
le AS (
  SELECT 'modelo_etiquetas'::text AS tabela, me.id, me.modelo_id, 'etiqueta'::text AS tipo, me.custo_previsto AS antes,
         round(coalesce(
           (SELECT max(ve.preco) FROM public.variantes_etiqueta ve
              JOIN public.etiquetas et ON et.id = ve.etiqueta_id AND et.tenant_id = m.tenant_id
             WHERE ve.etiqueta_id = me.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM me.cor_id AND ve.preco > 0),
           (SELECT et.preco FROM public.etiquetas et WHERE et.id = me.etiqueta_id AND et.tenant_id = m.tenant_id),
           0) * coalesce(me.consumo, 0) * (1 + coalesce(me.loss_percent, 0) / 100.0), 2) AS depois
    FROM public.modelo_etiquetas me
    JOIN m ON m.id = me.modelo_id
),
linhas AS (
  SELECT * FROM lt UNION ALL SELECT * FROM la UNION ALL SELECT * FROM le
),
por_modelo AS (
  SELECT li.modelo_id,
         sum(li.depois) FILTER (WHERE li.tipo = 'tecido') AS tecido_d,
         sum(li.depois) FILTER (WHERE li.tipo = 'forro') AS forro_d,
         sum(li.depois) FILTER (WHERE li.tipo = 'entretela') AS entretela_d,
         sum(li.depois) FILTER (WHERE li.tipo = 'aviamento') AS aviamento_d,
         sum(li.depois) FILTER (WHERE li.tipo = 'etiqueta') AS etiqueta_d,
         sum(coalesce(li.antes, 0)) FILTER (WHERE li.tipo IN ('tecido', 'forro', 'entretela', 'aviamento', 'etiqueta')) AS linhas_antes,
         count(*) FILTER (WHERE li.antes IS DISTINCT FROM li.depois) AS n_linhas_mudam,
         count(*) FILTER (WHERE li.antes IS NULL) AS n_linhas_null,
         count(*) FILTER (WHERE li.antes IS NOT NULL AND li.antes <> li.depois) AS n_linhas_preco,
         md5(coalesce(string_agg(li.tabela || ':' || li.id::text || ':' || coalesce(round(li.antes, 2)::text, 'null') || '>'
                                 || coalesce(round(li.depois, 2)::text, 'null'), E'\n' ORDER BY li.tabela, li.id)
                        FILTER (WHERE li.antes IS DISTINCT FROM li.depois), '')) AS md5_linhas
    FROM linhas li
   GROUP BY li.modelo_id
),
calc AS (
  SELECT m.*,
         coalesce(pm.tecido_d, 0) AS tecido_d, coalesce(pm.forro_d, 0) AS forro_d, coalesce(pm.entretela_d, 0) AS entretela_d,
         coalesce(pm.aviamento_d, 0) AS aviamento_d, coalesce(pm.etiqueta_d, 0) AS etiqueta_d,
         coalesce(pm.linhas_antes, 0) AS linhas_antes,
         coalesce(pm.n_linhas_mudam, 0) AS n_linhas_mudam, coalesce(pm.n_linhas_null, 0) AS n_linhas_null,
         coalesce(pm.n_linhas_preco, 0) AS n_linhas_preco, coalesce(pm.md5_linhas, md5('')) AS md5_linhas,
         coalesce((SELECT sum(s.valor) FROM public.modelo_servico_mo s WHERE s.modelo_id = m.id), 0) AS mo,
         coalesce((SELECT sum(CASE
                     WHEN jsonb_typeof(c -> 'valor') = 'number' THEN (c ->> 'valor')::numeric
                     WHEN jsonb_typeof(c -> 'valor') = 'string'
                          AND btrim(c ->> 'valor') ~ '^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]{1,3})?$'
                       THEN btrim(c ->> 'valor')::numeric
                     ELSE 0 END)
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.custos_adicionais) = 'array' THEN m.custos_adicionais ELSE '[]'::jsonb END) c), 0) AS adic,
         CASE WHEN coalesce(m.markup_editado, 0) > 0 THEN m.markup_editado
              ELSE coalesce((SELECT ln.markup FROM public.linhas ln WHERE ln.id = m.linha_id AND ln.tenant_id = m.tenant_id), 0) END AS mk
    FROM m
    LEFT JOIN por_modelo pm ON pm.modelo_id = m.id
),
fim AS (
  SELECT calc.*,
         calc.tecido_d + calc.forro_d + calc.entretela_d + calc.aviamento_d + calc.etiqueta_d + calc.mo + calc.adic AS peca_d
    FROM calc
),
lista AS (
  SELECT f.*,
         round(coalesce(f.custo_peca_previsto, 0), 2) <> round(f.peca_d, 2) AS efeito_visivel,
         coalesce(f.preco_venda, 0) > 0 AS preco_digitado,
         CASE WHEN coalesce(f.custo_peca_previsto, 0) > 0 AND f.mk > 0
              THEN round(5 * greatest(0, ceil((coalesce(f.custo_peca_previsto, 0) * f.mk - 4.9) / 5 - 0.000000001)) + 4.9, 2) ELSE 0 END AS sugerido_antes,
         CASE WHEN round(f.peca_d, 2) > 0 AND f.mk > 0
              THEN round(5 * greatest(0, ceil((round(f.peca_d, 2) * f.mk - 4.9) / 5 - 0.000000001)) + 4.9, 2) ELSE 0 END AS sugerido_depois,
         nullif(concat_ws(' + ',
           CASE WHEN f.custo_peca_previsto IS NULL THEN 'previsto NULL' END,
           CASE WHEN f.n_linhas_null > 0 THEN 'linha NULL (Aplicar)' END,
           CASE WHEN f.n_linhas_preco > 0 THEN 'preco da linha' END,
           CASE WHEN f.custo_peca_previsto IS NOT NULL AND f.mo <> 0
                     AND round(f.custo_peca_previsto, 2) = round(f.linhas_antes + f.adic, 2) THEN 'M.O. fora do previsto' END,
           CASE WHEN f.custo_peca_previsto IS NOT NULL
                     AND round(f.custo_peca_previsto, 2) <> round(f.linhas_antes + f.mo + f.adic, 2)
                     AND NOT (f.mo <> 0 AND round(f.custo_peca_previsto, 2) = round(f.linhas_antes + f.adic, 2)) THEN 'soma' END,
           CASE WHEN f.custo_tecido_total IS DISTINCT FROM f.tecido_d OR f.custo_forro_total IS DISTINCT FROM f.forro_d
                     OR f.custo_entretela_total IS DISTINCT FROM f.entretela_d OR f.custo_aviamento_total IS DISTINCT FROM f.aviamento_d
                THEN 'totais' END), '') AS motivo,
         f.id::text
           || '|' || coalesce(round(f.custo_peca_previsto, 2)::text, 'null') || '|' || round(f.peca_d, 2)::text
           || '|' || coalesce(round(f.custo_tecido_total, 2)::text, 'null') || '|' || round(f.tecido_d, 2)::text
           || '|' || coalesce(round(f.custo_forro_total, 2)::text, 'null') || '|' || round(f.forro_d, 2)::text
           || '|' || coalesce(round(f.custo_entretela_total, 2)::text, 'null') || '|' || round(f.entretela_d, 2)::text
           || '|' || coalesce(round(f.custo_aviamento_total, 2)::text, 'null') || '|' || round(f.aviamento_d, 2)::text
           || '|' || f.md5_linhas AS linha_canonica
    FROM fim f
   WHERE f.custo_peca_previsto IS DISTINCT FROM round(f.peca_d, 2)
      OR f.custo_tecido_total IS DISTINCT FROM f.tecido_d
      OR f.custo_forro_total IS DISTINCT FROM f.forro_d
      OR f.custo_entretela_total IS DISTINCT FROM f.entretela_d
      OR f.custo_aviamento_total IS DISTINCT FROM f.aviamento_d
      OR f.n_linhas_mudam > 0
)
SELECT t.nome::text AS loja, l.tenant_id, l.id AS modelo_id, l.ref, l.nome, l.versao,
       (SELECT string_agg(DISTINCT ip.estado, ',') FROM public.integracao_produtos ip WHERE ip.modelo_id = l.id) AS integracao_estado,
       l.congelado,
       l.custo_peca_previsto AS previsto_antes, round(l.peca_d, 2) AS previsto_depois,
       l.custo_tecido_total AS tecido_antes, round(l.tecido_d, 2) AS tecido_depois,
       l.custo_forro_total AS forro_antes, round(l.forro_d, 2) AS forro_depois,
       l.custo_entretela_total AS entretela_antes, round(l.entretela_d, 2) AS entretela_depois,
       l.custo_aviamento_total AS aviamento_antes, round(l.aviamento_d, 2) AS aviamento_depois,
       round(l.etiqueta_d, 2) AS etiqueta_depois, l.mo AS mao_de_obra, l.adic AS adicionais,
       l.n_linhas_mudam AS linhas_que_mudam, coalesce(l.motivo, 'arredondamento') AS motivo,
       l.preco_digitado, l.preco_venda, l.mk AS markup_aplicado, l.sugerido_antes, l.sugerido_depois,
       l.efeito_visivel, l.linha_canonica
  FROM lista l
  LEFT JOIN public.tenants t ON t.id = l.tenant_id
 ORDER BY l.id
