-- l9_preco_previa.sql — PRÉVIA SÓ-LEITURA da correção única da L9 (achados LEVES, fin #8, P-206 A):
--   supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql.
-- O MESMO critério de alvos da correção:
--   • item de OC de AVIAMENTO com preço vazio (NULL) — qualquer status (recebida OU encomendada) — e preço no cadastro
--     (aviamentos.preco) → recebe o preço do cadastro de hoje;
--   • item de OC de TECIDO com preço vazio numa OC RECEBIDA (inclui rolos e itens cancelados) e com preço no cadastro →
--     recebe COALESCE(variantes_tecido.preco, artigos.preco) — o mesmo que a tela da OC Tecido pré-preenche ao abrir.
-- Uso no kit: rodar em transação READ ONLY (+ ROLLBACK) DEPOIS da 20261029100000 e ANTES da correção; mostrar ao dono; a
-- correção só roda com as contagens desta prévia nas GUCs app.l9_esperado_avi / app.l9_esperado_tec (= avi_congelar /
-- tec_congelar). Funciona também ANTES da 20261029100000 (lê o preço do item por to_jsonb, a coluna pode não existir).
-- Colunas:
--   avi_congelar          itens de aviamento que a correção vai preencher (= GUC app.l9_esperado_avi)
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
--   avi_sem_cor_2mais     itens de aviamento NÃO cancelados sem cor cujo aviamento tem 2+ cores (P-208 A: aviso na tela;
--                         cópia/Passo 0: 1 — FRANJA 00003118, Ave Rara)
-- Regras do arquivo (embutível pelo psql): um único SELECT, SEM ponto e vírgula, sem meta-comando do psql.
-- Cópia 54422 (01/out, antes da correção): avi_congelar 4 (1 receb + 3 enc), tec_congelar 41 (18 rolo, 2 cancelados).
WITH avi AS (
  SELECT it.id, it.oc_aviamento_id AS oc_id, o.status, a.preco AS p_cad
    FROM public.ocs_aviamento_itens it
    JOIN public.ocs_aviamento o ON o.id = it.oc_aviamento_id
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
   WHERE (to_jsonb(it)->>'preco') IS NULL
), avi_oc AS (
  SELECT DISTINCT v.oc_id FROM avi v WHERE v.status = 'recebido' AND v.p_cad IS NOT NULL
), avi_oc_tot AS (
  SELECT x.oc_id,
         (SELECT round(COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0)
                                    * COALESCE((to_jsonb(it)->>'preco')::numeric, a.preco, 0)), 0), 2)
            FROM public.ocs_aviamento_itens it LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
           WHERE it.oc_aviamento_id = x.oc_id AND NOT COALESCE(it.cancelado, false)) AS total_hoje,
         (SELECT round(COALESCE(SUM(p.valor), 0), 2) FROM public.parcelas p WHERE p.oc_aviamento_id = x.oc_id) AS soma_parc,
         EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_aviamento_id = x.oc_id) AS tem_parc
    FROM avi_oc x
), tec AS (
  SELECT it.id, coalesce(o.is_rolo, false) AS rolo, coalesce(it.cancelado, false) AS cancel,
         vt.preco AS p_var, ar.preco AS p_art
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido o ON o.id = it.oc_tecido_id AND o.status = 'recebido'
    LEFT JOIN public.artigos ar ON ar.id = it.artigo_id
    LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
   WHERE it.preco IS NULL
)
SELECT
  (SELECT count(*) FROM avi WHERE p_cad IS NOT NULL) AS avi_congelar,
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
  (SELECT count(*)
     FROM public.ocs_aviamento_itens it
    WHERE it.variante_aviamento_id IS NULL AND NOT coalesce(it.cancelado, false)
      AND (SELECT count(*) FROM public.variantes_aviamento va WHERE va.aviamento_id = it.aviamento_id) >= 2) AS avi_sem_cor_2mais
