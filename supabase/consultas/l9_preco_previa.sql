-- l9_preco_previa.sql — PRÉVIA SÓ-LEITURA da correção única da L9 (achados LEVES, fin #8, P-206 A):
--   supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql.
-- O MESMO critério de alvos da correção:
--   • item de OC de AVIAMENTO com preço vazio (NULL) — qualquer status (recebida OU encomendada) — e preço no cadastro →
--     recebe o preço do cadastro de hoje: o da COR do item (variantes_aviamento.preco) quando > 0, senão o geral
--     (aviamentos.preco) — fix round 2, P-216 A;
--   • item de OC de TECIDO com preço vazio numa OC RECEBIDA (inclui rolos e itens cancelados) e com preço no cadastro →
--     recebe COALESCE(variantes_tecido.preco, artigos.preco) — o mesmo que a tela da OC Tecido pré-preenche ao abrir.
-- Uso no kit: rodar em transação READ ONLY (+ ROLLBACK) DEPOIS da 20261029100000 e ANTES da correção; mostrar ao dono; a
-- correção só roda com as contagens desta prévia nas GUCs app.l9_esperado_avi / app.l9_esperado_tec (= avi_congelar /
-- tec_congelar). Funciona também ANTES da 20261029100000 (lê o preço do item por to_jsonb, a coluna pode não existir).
-- Colunas:
--   avi_congelar          itens de aviamento que a correção vai preencher (= GUC app.l9_esperado_avi)
--   avi_preco_cor         [P-216 A] desses, quantos recebem o preço da COR (variante com preço > 0)
--   avi_preco_geral       desses, quantos recebem o preço GERAL do aviamento (sem cor, ou cor sem preço / preço 0)
--   avi_cor_dif_geral     dos que recebem o preço da cor, quantos têm preço da cor ≠ geral (o valor da OC muda em relação
--                         à regra antiga só-geral; nas recebidas, as parcelas não pagas acompanham — ver avi_ocs_parc_mudam)
--   avi_receb / avi_enc   desses, em OC recebida / encomendada
--   avi_sem_cadastro      itens de aviamento vazios cujo aviamento não tem preço no cadastro (ficam vazios; valem 0)
--   avi_ocs_receb         OCs de aviamento RECEBIDAS tocadas (cada uma tem as parcelas não pagas recalculadas pelo gatilho)
--   avi_ocs_parc_mudam    dessas, quantas têm Σ parcelas ≠ total pelo preço de hoje (o recálculo vai MUDAR as parcelas
--                         não pagas para o preço de hoje — no Passo 0 deve ser 0; se não for, PARA e pergunta ao dono)
--   tec_congelar          itens de tecido que a correção vai preencher (= GUC app.l9_esperado_tec)
--   tec_rolo / tec_cancel desses, em rolo / cancelados
--   tec_var_dif_artigo    desses, quantos têm preço da VARIANTE ≠ preço do ARTIGO (a correção usa o da variante)
--   tec_sem_cadastro      itens de tecido recebidos vazios sem preço nenhum no cadastro (ficam vazios)
--   tec_modelos_vinculo   modelos INTERNOS NÃO cortados vinculados (modelo_tecido_oc_links) a esses itens: o custo
--                         previsto deles é recalculado pela fila no COMMIT (o preço do tecido passa a vir da OC; cópia:
--                         14 modelos, 1 muda R$ 0,01)
--   tec_ocs_total_muda    [fix round 1, M1] OCs de tecido NÃO rolo RECEBIDAS tocadas pela correção cujo cabeçalho
--                         round(valor_real_total, 2) ≠ Σ(itens não cancelados: quantidade_recebida × COALESCE(it.preco,
--                         variante.preco, artigo.preco)) — o total pelo preço CONGELADO. Depois da correção, o próximo
--                         alerta/troca (release 9) ou re-save da OC refaz o cabeçalho pelos itens e moveria as parcelas
--                         não pagas para o preço de hoje. > 0 em produção → PARA e pergunta ao dono (cópia: 0 de 10).
--                         A correção recusa sem a GUC app.l9_esperado_tec_ocs_total_muda = este número.
--   tec_modelos_custo_muda [fix round 1, L2] desses modelos vinculados, quantos têm o custo previsto da PEÇA (2 casas)
--                         mudado pela correção (a fila recalcula no COMMIT); calculado só-leitura simulando o preço
--                         congelado do tecido (mesma conta de _precos_tecido_congelado_core/_custo_preco_tecido).
--   tec_custo_dif_max     maior diferença absoluta (R$) no custo da peça entre esses modelos. O kit mostra os dois ao dono
--                         e compara ANTES de rodar (cópia: 1 modelo, R$ 0,01).
--   avi_sem_cor_2mais     itens de aviamento NÃO cancelados sem cor cujo aviamento tem 2+ cores (P-208 A: aviso na tela;
--                         cópia/Passo 0: 1 — FRANJA 00003118, Ave Rara)
-- Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando do psql.
-- Cópia 54422 (01/out, antes da correção): avi_congelar 4 (1 receb + 3 enc), tec_congelar 41 (18 rolo, 2 cancelados).
WITH avi AS (
  SELECT it.id, it.oc_aviamento_id AS oc_id, o.status,
         COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco) AS p_cad,
         (va.preco > 0) IS TRUE AS da_cor, a.preco AS p_geral, va.preco AS p_cor
    FROM public.ocs_aviamento_itens it
    JOIN public.ocs_aviamento o ON o.id = it.oc_aviamento_id
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    LEFT JOIN public.variantes_aviamento va ON va.id = it.variante_aviamento_id
   WHERE (to_jsonb(it)->>'preco') IS NULL
), avi_oc AS (
  SELECT DISTINCT v.oc_id FROM avi v WHERE v.status = 'recebido' AND v.p_cad IS NOT NULL
), avi_oc_tot AS (
  SELECT x.oc_id,
         (SELECT round(COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0)
                                    * COALESCE((to_jsonb(it)->>'preco')::numeric, CASE WHEN va.preco > 0 THEN va.preco END,
                                               a.preco, 0)), 0), 2)
            FROM public.ocs_aviamento_itens it LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
            LEFT JOIN public.variantes_aviamento va ON va.id = it.variante_aviamento_id
           WHERE it.oc_aviamento_id = x.oc_id AND NOT COALESCE(it.cancelado, false)) AS total_hoje,
         (SELECT round(COALESCE(SUM(p.valor), 0), 2) FROM public.parcelas p WHERE p.oc_aviamento_id = x.oc_id) AS soma_parc,
         EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_aviamento_id = x.oc_id) AS tem_parc
    FROM avi_oc x
), tec AS (
  SELECT it.id, it.oc_tecido_id AS oc_id, coalesce(o.is_rolo, false) AS rolo, coalesce(it.cancelado, false) AS cancel,
         vt.preco AS p_var, ar.preco AS p_art
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido o ON o.id = it.oc_tecido_id AND o.status = 'recebido'
    LEFT JOIN public.artigos ar ON ar.id = it.artigo_id
    LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
   WHERE it.preco IS NULL
), tec_oc AS (
  SELECT o.id, o.valor_real_total,
         (SELECT round(COALESCE(SUM(COALESCE(i2.quantidade_recebida, 0) * COALESCE(i2.preco, v2.preco, a2.preco, 0)), 0), 2)
            FROM public.ocs_tecido_itens i2
            LEFT JOIN public.variantes_tecido v2 ON v2.id = i2.variante_tecido_id
            LEFT JOIN public.artigos a2 ON a2.id = i2.artigo_id
           WHERE i2.oc_tecido_id = o.id AND NOT coalesce(i2.cancelado, false)) AS total_congelado
    FROM public.ocs_tecido o
   WHERE o.id IN (SELECT t.oc_id FROM tec t WHERE NOT t.rolo AND coalesce(t.p_var, t.p_art) IS NOT NULL)
), mods AS (
  SELECT DISTINCT m.id, m.tenant_id
    FROM tec t
    JOIN public.modelo_tecido_oc_links l ON l.oc_tecido_item_id = t.id
    JOIN public.modelos m ON m.id = l.modelo_id AND m.tenant_id = l.tenant_id AND m.origem = 'interno'
   WHERE coalesce(t.p_var, t.p_art) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND coalesce(c.enviado_corte, false))
), cong_depois AS (
  -- o mapa de _precos_tecido_congelado_core DEPOIS da correção: item vazio de OC recebida vale o preço congelado
  SELECT l.modelo_id, l.tipo || '|' || l.numero AS k,
         MAX(CASE WHEN a.unidade_medida = 'kg' AND COALESCE(a.rendimento, 0) > 0 THEN pp.p / a.rendimento ELSE pp.p END) AS ppm
    FROM mods
    JOIN public.modelo_tecido_oc_links l ON l.modelo_id = mods.id AND l.tenant_id = mods.tenant_id
    JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
    JOIN public.ocs_tecido oc ON oc.id = oti.oc_tecido_id AND oc.tenant_id = mods.tenant_id
    JOIN public.variantes_tecido vt ON vt.id = l.variante_tecido_id
    JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = mods.tenant_id
    LEFT JOIN public.variantes_tecido vti ON vti.id = oti.variante_tecido_id
    LEFT JOIN public.artigos ai ON ai.id = oti.artigo_id
    CROSS JOIN LATERAL (SELECT COALESCE(oti.preco, CASE WHEN oc.status = 'recebido' THEN COALESCE(vti.preco, ai.preco) END) AS p) pp
   WHERE pp.p IS NOT NULL AND NOT COALESCE(oti.cancelado, false)
   GROUP BY 1, 2
), mod_delta AS (
  SELECT mods.id,
         (SELECT c.custo FROM public._custo_calcular(mods.tenant_id, ARRAY[mods.id]) c WHERE c.tabela = 'modelos') AS hoje,
         (SELECT COALESCE(SUM(public._custo_linha(COALESCE(cd.ppm, public._custo_preco_tecido(mt.id, mods.tenant_id)), mt.consumo, mt.loss_percent)
                            - public._custo_linha(public._custo_preco_tecido(mt.id, mods.tenant_id), mt.consumo, mt.loss_percent)), 0)
            FROM public.modelo_tecidos mt
            LEFT JOIN cong_depois cd ON cd.modelo_id = mt.modelo_id AND cd.k = mt.tipo || '|' || mt.numero
           WHERE mt.modelo_id = mods.id) AS delta
    FROM mods
)
SELECT
  (SELECT count(*) FROM avi WHERE p_cad IS NOT NULL) AS avi_congelar,
  (SELECT count(*) FROM avi WHERE p_cad IS NOT NULL AND da_cor) AS avi_preco_cor,
  (SELECT count(*) FROM avi WHERE p_cad IS NOT NULL AND NOT da_cor) AS avi_preco_geral,
  (SELECT count(*) FROM avi WHERE da_cor AND p_cor IS DISTINCT FROM p_geral) AS avi_cor_dif_geral,
  (SELECT count(*) FROM avi WHERE p_cad IS NOT NULL AND status = 'recebido') AS avi_receb,
  (SELECT count(*) FROM avi WHERE p_cad IS NOT NULL AND status IS DISTINCT FROM 'recebido') AS avi_enc,
  (SELECT count(*) FROM avi WHERE p_cad IS NULL) AS avi_sem_cadastro,
  (SELECT count(*) FROM avi_oc) AS avi_ocs_receb,
  (SELECT count(*) FROM avi_oc_tot WHERE tem_parc AND soma_parc IS DISTINCT FROM total_hoje) AS avi_ocs_parc_mudam,
  (SELECT count(*) FROM tec WHERE coalesce(p_var, p_art) IS NOT NULL) AS tec_congelar,
  (SELECT count(*) FROM tec WHERE coalesce(p_var, p_art) IS NOT NULL AND rolo) AS tec_rolo,
  (SELECT count(*) FROM tec WHERE coalesce(p_var, p_art) IS NOT NULL AND cancel) AS tec_cancel,
  (SELECT count(*) FROM tec WHERE p_var IS NOT NULL AND p_art IS DISTINCT FROM p_var) AS tec_var_dif_artigo,
  (SELECT count(*) FROM tec WHERE coalesce(p_var, p_art) IS NULL) AS tec_sem_cadastro,
  (SELECT count(DISTINCT m.id)
     FROM tec t
     JOIN public.modelo_tecido_oc_links l ON l.oc_tecido_item_id = t.id
     JOIN public.modelos m ON m.id = l.modelo_id AND m.tenant_id = l.tenant_id AND m.origem = 'interno'
    WHERE coalesce(t.p_var, t.p_art) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND coalesce(c.enviado_corte, false))) AS tec_modelos_vinculo,
  (SELECT count(*) FROM tec_oc WHERE round(COALESCE(valor_real_total, 0), 2) IS DISTINCT FROM total_congelado) AS tec_ocs_total_muda,
  (SELECT count(*) FROM mod_delta WHERE round(hoje, 2) IS DISTINCT FROM round(hoje + delta, 2)) AS tec_modelos_custo_muda,
  (SELECT COALESCE(max(abs(round(hoje + delta, 2) - round(hoje, 2))), 0) FROM mod_delta) AS tec_custo_dif_max,
  (SELECT count(*)
     FROM public.ocs_aviamento_itens it
    WHERE it.variante_aviamento_id IS NULL AND NOT coalesce(it.cancelado, false)
      AND (SELECT count(*) FROM public.variantes_aviamento va WHERE va.aviamento_id = it.aviamento_id) >= 2) AS avi_sem_cor_2mais
