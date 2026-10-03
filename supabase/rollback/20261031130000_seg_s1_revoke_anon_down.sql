-- Inverso de supabase/migrations/20261031130000_seg_s1_revoke_anon.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção 03/out).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)
--     ANTES  47b8d71b87c932628d3246b34b735af2
--     DEPOIS 04fcd75c8d467ab07476a43395d27eee
--   public.confirmar_direcionamento(uuid,jsonb,jsonb)
--     ANTES  8ffed432a737ff2694b20176e8460166
--     DEPOIS eabcf06adce7b406982d69299c116d49
--   public.confirmar_direcionamento(uuid,jsonb)
--     ANTES  7ac742b325e289b8c2e069c2cea9216c
--     DEPOIS f77843db2651601c490bd3c64f4f8030
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)', '47b8d71b87c932628d3246b34b735af2', '04fcd75c8d467ab07476a43395d27eee'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', '8ffed432a737ff2694b20176e8460166', 'eabcf06adce7b406982d69299c116d49'),
      ('public.confirmar_direcionamento(uuid,jsonb)', '7ac742b325e289b8c2e069c2cea9216c', 'f77843db2651601c490bd3c64f4f8030')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's1_anon_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.cq_set_oficina_desconto_multa(_cad_id uuid, _desconto numeric, _multa numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  UPDATE public.producao_terceirizados pt SET
    desconto_total = GREATEST(COALESCE(_desconto,0), 0),
    multa_total = GREATEST(COALESCE(_multa,0), 0)
  WHERE pt.id = (
    SELECT pt2.id
    FROM public.producao_terceirizados pt2
    JOIN public.categorias_terceirizado ct ON ct.id = pt2.categoria_terceirizado_id
    WHERE pt2.cad_id = _cad_id AND COALESCE(pt2.interno,false) = false
      AND COALESCE(pt2.ativo,true) AND COALESCE(ct.nome,'') ILIKE 'oficina'
    ORDER BY pt2.created_at
    LIMIT 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true);
END;
$function$;

DO $lista$
DECLARE
  r record;
BEGIN
  -- todas as funcoes da lista FECHADA existem (assinatura exata)
  FOR r IN SELECT * FROM (VALUES
      ('public.ajustar_rolo(uuid,numeric)'),
      ('public.ajustes_estoque_lista()'),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)'),
      ('public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)'),
      ('public.aprovar_servico_mo(uuid,uuid,boolean,text)'),
      ('public.baixar_estoque_tecido_corte(uuid,integer)'),
      ('public.cancelar_rolo(uuid)'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)'),
      ('public.cq_oficina_servico(uuid)'),
      ('public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)'),
      ('public.criar_card_produto_importado(uuid)'),
      ('public.custo_unitario_modelos(uuid[])'),
      ('public.desmarcar_recebimento_oc_etiqueta(uuid)'),
      ('public.desmarcar_recebimento_oc(text,uuid)'),
      ('public.enderecos_tecido()'),
      ('public.estoque_tecido()'),
      ('public.excluir_oc_tecido(uuid)'),
      ('public.excluir_produto_importado(uuid)'),
      ('public.gerar_rolos_recebimento(uuid,jsonb)'),
      ('public.marcar_etapa_verificada(uuid,text)'),
      ('public.marcar_revisao_pendente(uuid,text[])'),
      ('public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)'),
      ('public.modelo_etapas_afetadas(uuid)'),
      ('public.modelo_mo_resumo(uuid[])'),
      ('public.modelos_mo_a_aprovar_count()'),
      ('public.ocs_para_rolo()'),
      ('public.otb_atribuir_card(uuid,uuid,text)'),
      ('public.otb_desconfirmar(uuid)'),
      ('public.otb_orcamento(uuid)'),
      ('public.plan_tecido_pedido_fotos(uuid)'),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])'),
      ('public.proximo_codigo_rolo(uuid)'),
      ('public.reabrir_rolo(uuid)'),
      ('public.receber_reposicao_troca(uuid,date,numeric)'),
      ('public.remover_metragem_oc(uuid,numeric,text)'),
      ('public.renomear_tipo_colaborador(uuid,text,uuid)'),
      ('public.reverter_ajuste_estoque(uuid)'),
      ('public.reverter_rolos_oc(uuid)'),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)'),
      ('public.salvar_modelo_servico_mo(uuid,jsonb)'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb)'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)'),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)'),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)'),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)'),
      ('public.set_artigo_categorias(uuid,uuid[])'),
      ('public.set_user_permissions(uuid,uuid,jsonb)'),
      ('public.trocar_rolo(uuid,numeric)'),
      ('public.criar_tenant_config_padrao()'),
      ('public.enforce_empresa_tenant()'),
      ('public.enforce_oc_pa_produto_tenant()'),
      ('public.enforce_produto_acabado_modelo_tenant()'),
      ('public.enforce_servico_mo_aprovacao()'),
      ('public.enforce_servico_mo_del_aprovacao()'),
      ('public.fn_aviamento_codigo()'),
      ('public.fn_colab_bump_cq()'),
      ('public.fn_colab_bump_modelo_via_tecido()'),
      ('public.fn_colab_bump_modelo()'),
      ('public.fn_colab_bump_oc()'),
      ('public.fn_colab_bump_plan()'),
      ('public.fn_espelho_modelo_nome_ref()'),
      ('public.fn_integracao_trava_espelho()'),
      ('public.fn_integracao_trava_modelos_del()'),
      ('public.fn_integracao_trava_modelos()'),
      ('public.fn_integracao_trava_skus()'),
      ('public.fn_integracao_trava_variantes()'),
      ('public.fn_kanban_chave_protegida()'),
      ('public.fn_kanban_config()'),
      ('public.fn_kanban_fila_categoria()'),
      ('public.fn_kanban_fila_modelo()'),
      ('public.fn_kanban_fila_por_cad_tecido()'),
      ('public.fn_kanban_fila_por_cad()'),
      ('public.fn_kanban_fila_por_modelo_tecido()'),
      ('public.fn_kanban_fila_por_modelo()'),
      ('public.fn_kanban_historico()'),
      ('public.fn_kanban_processar_fila()'),
      ('public.fn_kanban_regredir_cad_grades()'),
      ('public.fn_kanban_regredir_cad()'),
      ('public.fn_kanban_regredir_cq()'),
      ('public.fn_kanban_regredir_modelos()'),
      ('public.fn_kanban_status_guard()'),
      ('public.fn_modelo_espelho_nome_ref()'),
      ('public.fn_modelo_mo_flag_derivada()'),
      ('public.fn_modelo_ref_auto()'),
      ('public.fn_modelo_servico_mo_rollup()'),
      ('public.fn_oc_importado_numero()'),
      ('public.fn_oc_p_acabado_numero()'),
      ('public.fn_produto_acabado_ref()'),
      ('public.fn_produto_importado_ref()'),
      ('public.fn_rebaixa_direcionamento_grade()'),
      ('public.fn_rebaixa_lancado_cq()'),
      ('public.fn_sync_modelo_subcolecao()'),
      ('public.gerar_parcelas_oc_etiqueta()'),
      ('public.gerar_parcelas_oc_p_acabado()'),
      ('public.recalc_parcelas_aviamento_on_item()'),
      ('public.recalc_parcelas_etiqueta_on_item()'),
      ('public.recalc_parcelas_on_valor()'),
      ('public.trg_fn_parcelas_importado_etapa()'),
      ('public.trg_fn_parcelas_importado_oc()'),
      ('public.variantes_etiqueta_sync_preco()'),
      ('public.variantes_tecido_log_preco()'),
      ('public.variantes_tecido_sync_artigo_preco()')
    ) AS x(f) LOOP
    IF to_regprocedure(r.f) IS NULL THEN
      RAISE EXCEPTION 's1_anon_down: funcao % ausente - a lista do ANON-1/ANON-2 nao bate com este banco', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$lista$;

-- ANON-1: devolve o EXECUTE exatamente a quem tinha (lido da cópia)
GRANT EXECUTE ON FUNCTION public.ajustar_rolo(uuid,numeric) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustes_estoque_lista() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_plan_tecido_grade(uuid,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_servico_mo(uuid,uuid,boolean,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_rolo(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_direcionamento(uuid,jsonb,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cq_oficina_servico(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.cq_set_oficina_desconto_multa(uuid,numeric,numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_card_produto_importado(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.custo_unitario_modelos(uuid[]) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desmarcar_recebimento_oc_etiqueta(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desmarcar_recebimento_oc(text,uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enderecos_tecido() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.estoque_tecido() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_oc_tecido(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_produto_importado(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_rolos_recebimento(uuid,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_etapa_verificada(uuid,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_revisao_pendente(uuid,text[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.modelo_etapas_afetadas(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.modelo_mo_resumo(uuid[]) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modelos_mo_a_aprovar_count() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ocs_para_rolo() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.otb_atribuir_card(uuid,uuid,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.otb_desconfirmar(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.otb_orcamento(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_pedido_fotos(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_set_pedido_fotos(uuid,text,text[]) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proximo_codigo_rolo(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reabrir_rolo(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receber_reposicao_troca(uuid,date,numeric) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_metragem_oc(uuid,numeric,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renomear_tipo_colaborador(uuid,text,uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverter_ajuste_estoque(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverter_rolos_oc(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_direcionamento(uuid,jsonb,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_modelo_servico_mo(uuid,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_aviamento(uuid,jsonb,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_etiqueta(uuid,jsonb,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_produto_acabado(uuid,jsonb,jsonb,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_artigo_categorias(uuid,uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_permissions(uuid,uuid,jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trocar_rolo(uuid,numeric) TO PUBLIC, anon;

-- ANON-2: idem nas funções de gatilho
GRANT EXECUTE ON FUNCTION public.criar_tenant_config_padrao() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_empresa_tenant() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_oc_pa_produto_tenant() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_produto_acabado_modelo_tenant() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_servico_mo_aprovacao() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_servico_mo_del_aprovacao() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aviamento_codigo() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_colab_bump_cq() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_colab_bump_modelo_via_tecido() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_colab_bump_modelo() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_colab_bump_oc() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_colab_bump_plan() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_espelho_modelo_nome_ref() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_integracao_trava_espelho() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_integracao_trava_modelos_del() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_integracao_trava_modelos() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_integracao_trava_skus() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_integracao_trava_variantes() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_chave_protegida() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_config() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_fila_categoria() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_fila_modelo() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_fila_por_cad_tecido() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_fila_por_cad() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_fila_por_modelo_tecido() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_fila_por_modelo() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_historico() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_processar_fila() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_regredir_cad_grades() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_regredir_cad() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_regredir_cq() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_regredir_modelos() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kanban_status_guard() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_modelo_espelho_nome_ref() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_modelo_mo_flag_derivada() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_modelo_ref_auto() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_modelo_servico_mo_rollup() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oc_importado_numero() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oc_p_acabado_numero() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_produto_acabado_ref() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_produto_importado_ref() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rebaixa_direcionamento_grade() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rebaixa_lancado_cq() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_modelo_subcolecao() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_parcelas_oc_etiqueta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_parcelas_oc_p_acabado() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_parcelas_aviamento_on_item() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_parcelas_etiqueta_on_item() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_parcelas_on_valor() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_fn_parcelas_importado_etapa() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_fn_parcelas_importado_oc() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.variantes_etiqueta_sync_preco() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.variantes_tecido_log_preco() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.variantes_tecido_sync_artigo_preco() TO PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)', '47b8d71b87c932628d3246b34b735af2'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', '8ffed432a737ff2694b20176e8460166'),
      ('public.confirmar_direcionamento(uuid,jsonb)', '7ac742b325e289b8c2e069c2cea9216c')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_anon_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.ajustar_rolo(uuid,numeric)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.ajustes_estoque_lista()', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.aprovar_servico_mo(uuid,uuid,boolean,text)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.baixar_estoque_tecido_corte(uuid,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.cancelar_rolo(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.cq_oficina_servico(uuid)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.criar_card_produto_importado(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.custo_unitario_modelos(uuid[])', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.desmarcar_recebimento_oc_etiqueta(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.desmarcar_recebimento_oc(text,uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.enderecos_tecido()', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.estoque_tecido()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.excluir_oc_tecido(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.excluir_produto_importado(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.gerar_rolos_recebimento(uuid,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.marcar_etapa_verificada(uuid,text)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.marcar_revisao_pendente(uuid,text[])', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.modelo_etapas_afetadas(uuid)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.modelo_mo_resumo(uuid[])', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.modelos_mo_a_aprovar_count()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.ocs_para_rolo()', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.otb_atribuir_card(uuid,uuid,text)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.otb_desconfirmar(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.otb_orcamento(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.plan_tecido_pedido_fotos(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.proximo_codigo_rolo(uuid)', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.reabrir_rolo(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.receber_reposicao_troca(uuid,date,numeric)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.remover_metragem_oc(uuid,numeric,text)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.renomear_tipo_colaborador(uuid,text,uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.reverter_ajuste_estoque(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.reverter_rolos_oc(uuid)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_modelo_servico_mo(uuid,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.set_artigo_categorias(uuid,uuid[])', 'authenticated,postgres,PUBLIC,service_role'),
      ('public.set_user_permissions(uuid,uuid,jsonb)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.trocar_rolo(uuid,numeric)', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.criar_tenant_config_padrao()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.enforce_empresa_tenant()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.enforce_oc_pa_produto_tenant()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.enforce_produto_acabado_modelo_tenant()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.enforce_servico_mo_aprovacao()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.enforce_servico_mo_del_aprovacao()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_aviamento_codigo()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_colab_bump_cq()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_colab_bump_modelo_via_tecido()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_colab_bump_modelo()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_colab_bump_oc()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_colab_bump_plan()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_espelho_modelo_nome_ref()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_integracao_trava_espelho()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_integracao_trava_modelos_del()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_integracao_trava_modelos()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_integracao_trava_skus()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_integracao_trava_variantes()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_chave_protegida()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_config()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_fila_categoria()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_fila_modelo()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_fila_por_cad_tecido()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_fila_por_cad()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_fila_por_modelo_tecido()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_fila_por_modelo()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_historico()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_processar_fila()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_regredir_cad_grades()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_regredir_cad()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_regredir_cq()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_regredir_modelos()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_kanban_status_guard()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_modelo_espelho_nome_ref()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_modelo_mo_flag_derivada()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_modelo_ref_auto()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_modelo_servico_mo_rollup()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_oc_importado_numero()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_oc_p_acabado_numero()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_produto_acabado_ref()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_produto_importado_ref()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_rebaixa_direcionamento_grade()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_rebaixa_lancado_cq()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.fn_sync_modelo_subcolecao()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.gerar_parcelas_oc_etiqueta()', 'authenticated,postgres,service_role'),
      ('public.gerar_parcelas_oc_p_acabado()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.recalc_parcelas_aviamento_on_item()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.recalc_parcelas_etiqueta_on_item()', 'authenticated,postgres,service_role'),
      ('public.recalc_parcelas_on_valor()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.trg_fn_parcelas_importado_etapa()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.trg_fn_parcelas_importado_oc()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.variantes_etiqueta_sync_preco()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.variantes_tecido_log_preco()', 'anon,authenticated,postgres,PUBLIC,service_role'),
      ('public.variantes_tecido_sync_artigo_preco()', 'anon,authenticated,postgres,PUBLIC,service_role')
    ) AS x(f, acl) LOOP
    -- cada grantee de ANTES (lido da cópia) voltou a ter EXECUTE (subconjunto: um grant a mais em produção não aborta a volta)
    IF EXISTS (SELECT 1 FROM unnest(string_to_array(r.acl, ',')) AS g(nome)
                WHERE NOT (g.nome = ANY (string_to_array(coalesce((SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END, ',' ORDER BY CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END)
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = to_regprocedure(r.f) AND x.privilege_type = 'EXECUTE'), ''), ',')))) THEN
      RAISE EXCEPTION 's1_anon_down: pos-condicao de ACL falhou em % (esperado ao menos %)', r.f, r.acl USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
