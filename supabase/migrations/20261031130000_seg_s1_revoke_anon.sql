-- Reforço de segurança — Release S1 ("Fechar portas sem travar nada"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- ANON-1 (inclui B5): REVOKE EXECUTE FROM PUBLIC, anon nas 52 RPCs SECURITY DEFINER que o anon executava (authenticated e
-- service_role ficam com o grant explicito). Os 4 auxiliares de RLS (tenant_module_enabled, user_can_edit, user_can_view,
-- meu_tenant_ativo) ficam para a S5 (depois do ANON-3).
-- ANON-2: REVOKE EXECUTE FROM PUBLIC, anon, authenticated nas funcoes de GATILHO SECURITY DEFINER (o gatilho continua
-- disparando: EXECUTE so e conferido no CREATE TRIGGER).
-- C5: cq_set_oficina_desconto_multa exige modulo Producao + user_can_edit('producao_cq').
-- DIR-1: confirmar_direcionamento (as 2 sobrecargas: 3 args da tela e 2 args antiga) confere login + loja do CAD antes
-- do _cq_liberado (fim do oraculo).
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
-- Volta: supabase/rollback/20261031130000_seg_s1_revoke_anon_down.sql (LIFO: os inversos da S1 rodam do mais novo ao mais antigo, ANTES dos inversos de releases
-- anteriores que guardam por md5 as mesmas funções — ver o relatório s1-report.md, seção "Cadeia md5").
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
      RAISE EXCEPTION 's1_anon: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
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
  -- [seg s1 C5] desconto/multa da oficina entra no custo real e nas parcelas de servico: modulo Producao + editar o CQ
  -- (a tela que chama e o CQ, expedicao.cq). ASCII (tela: erro-mensagem.ts).
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'modulo_producao_desligado: o modulo Producao nao esta habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_edit('producao_cq') THEN
    RAISE EXCEPTION 'sem_permissao_cq: sem permissao para editar o Controle de Qualidade' USING ERRCODE = '42501';
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
DECLARE
  v_tenant uuid;  -- [seg s1 DIR-1]
BEGIN
  -- [seg s1 DIR-1] login + loja do CAD ANTES do _cq_liberado: sem isto, com um UUID, quem nao esta logado (ou outra loja)
  -- descobria se o CQ do CAD esta liberado. Nao encontrado = outra loja (mesma resposta: sem oraculo). ASCII.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: faca login de novo' USING ERRCODE = '42501';
  END IF;
  SELECT c.tenant_id INTO v_tenant FROM public.cad c WHERE c.id = _cad_id;
  IF v_tenant IS NULL OR (v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'cad_nao_encontrado: CAD nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
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
DECLARE
  v_tenant uuid;  -- [seg s1 DIR-1]
BEGIN
  -- [seg s1 DIR-1] login + loja do CAD ANTES do _cq_liberado: sem isto, com um UUID, quem nao esta logado (ou outra loja)
  -- descobria se o CQ do CAD esta liberado. Nao encontrado = outra loja (mesma resposta: sem oraculo). ASCII.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: faca login de novo' USING ERRCODE = '42501';
  END IF;
  SELECT c.tenant_id INTO v_tenant FROM public.cad c WHERE c.id = _cad_id;
  IF v_tenant IS NULL OR (v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'cad_nao_encontrado: CAD nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
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
      RAISE EXCEPTION 's1_anon: funcao % ausente - a lista do ANON-1/ANON-2 nao bate com este banco', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$lista$;

-- ANON-1: 52 RPCs SECURITY DEFINER (authenticated/service_role mantêm o grant explícito)
REVOKE EXECUTE ON FUNCTION public.ajustar_rolo(uuid,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ajustes_estoque_lista() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aplicar_plan_tecido_grade(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aprovar_servico_mo(uuid,uuid,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancelar_rolo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirmar_direcionamento(uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cq_oficina_servico(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cq_set_oficina_desconto_multa(uuid,numeric,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.criar_card_produto_importado(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.custo_unitario_modelos(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desmarcar_recebimento_oc_etiqueta(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desmarcar_recebimento_oc(text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enderecos_tecido() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.estoque_tecido() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.excluir_oc_tecido(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.excluir_produto_importado(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gerar_rolos_recebimento(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_etapa_verificada(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_revisao_pendente(uuid,text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.modelo_etapas_afetadas(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.modelo_mo_resumo(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.modelos_mo_a_aprovar_count() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ocs_para_rolo() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.otb_atribuir_card(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.otb_desconfirmar(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.otb_orcamento(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_pedido_fotos(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_set_pedido_fotos(uuid,text,text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.proximo_codigo_rolo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reabrir_rolo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receber_reposicao_troca(uuid,date,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remover_metragem_oc(uuid,numeric,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.renomear_tipo_colaborador(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverter_ajuste_estoque(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverter_rolos_oc(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_direcionamento(uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_modelo_servico_mo(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_aviamento(uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_etiqueta(uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_produto_acabado(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_artigo_categorias(uuid,uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_user_permissions(uuid,uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trocar_rolo(uuid,numeric) FROM PUBLIC, anon;

-- ANON-2: 54 funções de gatilho SECURITY DEFINER (o gatilho segue disparando)
REVOKE EXECUTE ON FUNCTION public.criar_tenant_config_padrao() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_empresa_tenant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_oc_pa_produto_tenant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_produto_acabado_modelo_tenant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_servico_mo_aprovacao() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_servico_mo_del_aprovacao() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_aviamento_codigo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_cq() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_modelo_via_tecido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_modelo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_oc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_espelho_modelo_nome_ref() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_integracao_trava_espelho() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_integracao_trava_modelos_del() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_integracao_trava_modelos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_integracao_trava_skus() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_integracao_trava_variantes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_chave_protegida() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_config() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_fila_categoria() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_fila_modelo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_fila_por_cad_tecido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_fila_por_cad() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_fila_por_modelo_tecido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_fila_por_modelo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_historico() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_processar_fila() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_regredir_cad_grades() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_regredir_cad() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_regredir_cq() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_regredir_modelos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kanban_status_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_espelho_nome_ref() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_mo_flag_derivada() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_ref_auto() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_servico_mo_rollup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_oc_importado_numero() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_oc_p_acabado_numero() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_produto_acabado_ref() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_produto_importado_ref() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_rebaixa_direcionamento_grade() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_rebaixa_lancado_cq() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_modelo_subcolecao() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_etiqueta() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_p_acabado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_parcelas_aviamento_on_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_parcelas_etiqueta_on_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_parcelas_on_valor() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_parcelas_importado_etapa() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_parcelas_importado_oc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.variantes_etiqueta_sync_preco() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.variantes_tecido_log_preco() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.variantes_tecido_sync_artigo_preco() FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)', '04fcd75c8d467ab07476a43395d27eee'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', 'eabcf06adce7b406982d69299c116d49'),
      ('public.confirmar_direcionamento(uuid,jsonb)', 'f77843db2651601c490bd3c64f4f8030')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_anon: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.ajustar_rolo(uuid,numeric)', true),
      ('public.ajustes_estoque_lista()', true),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)', true),
      ('public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)', true),
      ('public.aprovar_servico_mo(uuid,uuid,boolean,text)', true),
      ('public.baixar_estoque_tecido_corte(uuid,integer)', true),
      ('public.cancelar_rolo(uuid)', true),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', true),
      ('public.cq_oficina_servico(uuid)', true),
      ('public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)', true),
      ('public.criar_card_produto_importado(uuid)', true),
      ('public.custo_unitario_modelos(uuid[])', true),
      ('public.desmarcar_recebimento_oc_etiqueta(uuid)', true),
      ('public.desmarcar_recebimento_oc(text,uuid)', true),
      ('public.enderecos_tecido()', true),
      ('public.estoque_tecido()', true),
      ('public.excluir_oc_tecido(uuid)', true),
      ('public.excluir_produto_importado(uuid)', true),
      ('public.gerar_rolos_recebimento(uuid,jsonb)', true),
      ('public.marcar_etapa_verificada(uuid,text)', true),
      ('public.marcar_revisao_pendente(uuid,text[])', true),
      ('public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)', true),
      ('public.modelo_etapas_afetadas(uuid)', true),
      ('public.modelo_mo_resumo(uuid[])', true),
      ('public.modelos_mo_a_aprovar_count()', true),
      ('public.ocs_para_rolo()', true),
      ('public.otb_atribuir_card(uuid,uuid,text)', true),
      ('public.otb_desconfirmar(uuid)', true),
      ('public.otb_orcamento(uuid)', true),
      ('public.plan_tecido_pedido_fotos(uuid)', true),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])', true),
      ('public.proximo_codigo_rolo(uuid)', true),
      ('public.reabrir_rolo(uuid)', true),
      ('public.receber_reposicao_troca(uuid,date,numeric)', true),
      ('public.remover_metragem_oc(uuid,numeric,text)', true),
      ('public.renomear_tipo_colaborador(uuid,text,uuid)', true),
      ('public.reverter_ajuste_estoque(uuid)', true),
      ('public.reverter_rolos_oc(uuid)', true),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)', true),
      ('public.salvar_modelo_servico_mo(uuid,jsonb)', true),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)', true),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb)', true),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', true),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)', true),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)', true),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)', true),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)', true),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)', true),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)', true),
      ('public.set_artigo_categorias(uuid,uuid[])', true),
      ('public.set_user_permissions(uuid,uuid,jsonb)', true),
      ('public.trocar_rolo(uuid,numeric)', true),
      ('public.criar_tenant_config_padrao()', false),
      ('public.enforce_empresa_tenant()', false),
      ('public.enforce_oc_pa_produto_tenant()', false),
      ('public.enforce_produto_acabado_modelo_tenant()', false),
      ('public.enforce_servico_mo_aprovacao()', false),
      ('public.enforce_servico_mo_del_aprovacao()', false),
      ('public.fn_aviamento_codigo()', false),
      ('public.fn_colab_bump_cq()', false),
      ('public.fn_colab_bump_modelo_via_tecido()', false),
      ('public.fn_colab_bump_modelo()', false),
      ('public.fn_colab_bump_oc()', false),
      ('public.fn_colab_bump_plan()', false),
      ('public.fn_espelho_modelo_nome_ref()', false),
      ('public.fn_integracao_trava_espelho()', false),
      ('public.fn_integracao_trava_modelos_del()', false),
      ('public.fn_integracao_trava_modelos()', false),
      ('public.fn_integracao_trava_skus()', false),
      ('public.fn_integracao_trava_variantes()', false),
      ('public.fn_kanban_chave_protegida()', false),
      ('public.fn_kanban_config()', false),
      ('public.fn_kanban_fila_categoria()', false),
      ('public.fn_kanban_fila_modelo()', false),
      ('public.fn_kanban_fila_por_cad_tecido()', false),
      ('public.fn_kanban_fila_por_cad()', false),
      ('public.fn_kanban_fila_por_modelo_tecido()', false),
      ('public.fn_kanban_fila_por_modelo()', false),
      ('public.fn_kanban_historico()', false),
      ('public.fn_kanban_processar_fila()', false),
      ('public.fn_kanban_regredir_cad_grades()', false),
      ('public.fn_kanban_regredir_cad()', false),
      ('public.fn_kanban_regredir_cq()', false),
      ('public.fn_kanban_regredir_modelos()', false),
      ('public.fn_kanban_status_guard()', false),
      ('public.fn_modelo_espelho_nome_ref()', false),
      ('public.fn_modelo_mo_flag_derivada()', false),
      ('public.fn_modelo_ref_auto()', false),
      ('public.fn_modelo_servico_mo_rollup()', false),
      ('public.fn_oc_importado_numero()', false),
      ('public.fn_oc_p_acabado_numero()', false),
      ('public.fn_produto_acabado_ref()', false),
      ('public.fn_produto_importado_ref()', false),
      ('public.fn_rebaixa_direcionamento_grade()', false),
      ('public.fn_rebaixa_lancado_cq()', false),
      ('public.fn_sync_modelo_subcolecao()', false),
      ('public.gerar_parcelas_oc_etiqueta()', false),
      ('public.gerar_parcelas_oc_p_acabado()', false),
      ('public.recalc_parcelas_aviamento_on_item()', false),
      ('public.recalc_parcelas_etiqueta_on_item()', false),
      ('public.recalc_parcelas_on_valor()', false),
      ('public.trg_fn_parcelas_importado_etapa()', false),
      ('public.trg_fn_parcelas_importado_oc()', false),
      ('public.variantes_etiqueta_sync_preco()', false),
      ('public.variantes_tecido_log_preco()', false),
      ('public.variantes_tecido_sync_artigo_preco()', false)
    ) AS x(f, autenticado) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.f), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.f), 'EXECUTE') IS DISTINCT FROM r.autenticado
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 's1_anon: pos-condicao de ACL falhou em %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- aviso (nao aborta): outra funcao DEFINER que o anon ainda executa, fora dos 4 auxiliares de RLS (S5)
  FOR r IN SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f' AND has_function_privilege('anon', p.oid, 'EXECUTE')
              AND p.oid NOT IN (to_regprocedure('public.meu_tenant_ativo()'), to_regprocedure('public.tenant_module_enabled(text)'),
                                to_regprocedure('public.user_can_edit(text)'), to_regprocedure('public.user_can_view(text)')) LOOP
    RAISE WARNING 's1_anon: funcao DEFINER ainda executavel pelo anon (fora da lista da S1): %', r.f;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
