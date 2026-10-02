-- l9_passo0_pre_ida.sql — PASSO 0 SÓ-LEITURA da L9, ANTES da ida 20261029100000 (fix round 3, R1; P-216 A).
-- Com a ida, um item de OC de aviamento SEM preço gravado (hoje: todos — a coluna ocs_aviamento_itens.preco ainda não existe)
-- passa a valer o preço da COR escolhida (variantes_aviamento.preco > 0, da MESMA família do aviamento) em vez do geral
-- (aviamentos.preco). Isso muda NA HORA o "investido" do Dashboard Financeiro e, no próximo recálculo, as parcelas NÃO
-- pagas das OCs RECEBIDAS. Esta consulta mede o efeito ANTES de aplicar:
--   itens_receb_cor_dif     itens não cancelados de OC RECEBIDA, sem preço gravado, cuja cor tem preço próprio > 0 ≠ geral
--   ocs_receb_cor_dif       OCs recebidas com pelo menos 1 desses itens
--   ocs_parcelas_mudam      dessas, quantas têm parcela e Σ parcelas ≠ total pela regra NOVA (cor > 0, senão geral) — as
--                           parcelas não pagas iriam para esse total no próximo recálculo
--   dif_total_reais         Σ |total pela regra nova − total pela regra antiga (só geral)| nessas OCs (R$)
--   itens_enc_cor_dif       idem para OCs ENCOMENDADAS (sem parcela; só informativo: o valor previsto na tela muda)
-- Regra do kit (supabase/consultas/l9_kit_roteiro.md, Passo 0): itens_receb_cor_dif > 0 OU ocs_parcelas_mudam > 0 → PARA
-- ANTES da ida e pergunta ao dono. Cópia 54422 (02/out): tudo 0 (nenhum item de OC tem cor escolhida).
-- Funciona ANTES e DEPOIS da ida (lê o preço do item por to_jsonb; antes da ida ele é sempre vazio).
-- Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando do psql.
WITH it AS (
  SELECT i.id, i.oc_aviamento_id AS oc_id, o.status::text AS status, coalesce(i.cancelado, false) AS cancel,
         coalesce(i.quantidade_recebida, i.quantidade_pedida, 0) AS qtd,
         (to_jsonb(i)->>'preco')::numeric AS p_item, a.preco AS p_geral,
         CASE WHEN va.preco > 0 THEN va.preco END AS p_cor
    FROM public.ocs_aviamento_itens i
    JOIN public.ocs_aviamento o ON o.id = i.oc_aviamento_id
    LEFT JOIN public.aviamentos a ON a.id = i.aviamento_id
    LEFT JOIN public.variantes_aviamento va ON va.id = i.variante_aviamento_id AND va.aviamento_id = i.aviamento_id
), alvo AS (
  SELECT * FROM it WHERE p_item IS NULL AND NOT cancel AND p_cor IS NOT NULL AND p_cor IS DISTINCT FROM p_geral
), oc AS (
  SELECT x.oc_id,
         round(sum(x.qtd * coalesce(x.p_item, x.p_cor, x.p_geral, 0)), 2) AS total_novo,
         round(sum(x.qtd * coalesce(x.p_item, x.p_geral, 0)), 2) AS total_antigo,
         (SELECT round(coalesce(sum(p.valor), 0), 2) FROM public.parcelas p WHERE p.oc_aviamento_id = x.oc_id) AS soma_parc,
         EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_aviamento_id = x.oc_id) AS tem_parc
    FROM it x
   WHERE NOT x.cancel AND x.status = 'recebido' AND x.oc_id IN (SELECT oc_id FROM alvo WHERE status = 'recebido')
   GROUP BY x.oc_id
)
SELECT
  (SELECT count(*) FROM alvo WHERE status = 'recebido') AS itens_receb_cor_dif,
  (SELECT count(*) FROM oc) AS ocs_receb_cor_dif,
  (SELECT count(*) FROM oc WHERE tem_parc AND soma_parc IS DISTINCT FROM total_novo) AS ocs_parcelas_mudam,
  (SELECT coalesce(sum(abs(total_novo - total_antigo)), 0) FROM oc) AS dif_total_reais,
  (SELECT count(*) FROM alvo WHERE status IS DISTINCT FROM 'recebido') AS itens_enc_cor_dif
