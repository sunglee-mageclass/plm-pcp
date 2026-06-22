-- Item 8b (Fase 1): enforce de módulo no SERVIDOR — parte 2 (RPCs de escrita).
-- As RPCs SECURITY DEFINER furam a RLS do 8a, então um usuário poderia chamá-las
-- direto em módulo desligado. Cada RPC de escrita vira wrapper (mesma assinatura)
-- que checa tenant_module_enabled(<módulo>) e chama o _core (ALTER RENAME, sem
-- reescrever o corpo). EXECUTE do core revogado de anon/authenticated.
--
-- recalcular_parcelas NÃO é gateada de propósito: é função de INTEGRIDADE,
-- chamada internamente por aplicar_resolucao_alerta_tecido/receber_reposicao_troca
-- (entrada_saida) — uma troca precisa atualizar parcelas mesmo com financeiro off.
-- A escrita direta em parcelas já é bloqueada pela RLS do 8a.

-- 1) Renomeia cada RPC para _core (idempotente).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_salvar_modelo_bom_core') THEN
    ALTER FUNCTION public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb) RENAME TO _salvar_modelo_bom_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_enviar_modelo_para_cad_core') THEN
    ALTER FUNCTION public.enviar_modelo_para_cad(uuid,text,text) RENAME TO _enviar_modelo_para_cad_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_salvar_cad_completo_core') THEN
    ALTER FUNCTION public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date) RENAME TO _salvar_cad_completo_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_baixar_estoque_tecido_corte_core') THEN
    ALTER FUNCTION public.baixar_estoque_tecido_corte(uuid) RENAME TO _baixar_estoque_tecido_corte_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_salvar_cq_core') THEN
    ALTER FUNCTION public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean) RENAME TO _salvar_cq_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_desmarcar_cq_core') THEN
    ALTER FUNCTION public.desmarcar_cq(uuid) RENAME TO _desmarcar_cq_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_criar_rolo_core') THEN
    ALTER FUNCTION public.criar_rolo(text,uuid,jsonb,uuid,text,text) RENAME TO _criar_rolo_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_remover_metragem_oc_core') THEN
    ALTER FUNCTION public.remover_metragem_oc(uuid,numeric,text) RENAME TO _remover_metragem_oc_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_reverter_ajuste_estoque_core') THEN
    ALTER FUNCTION public.reverter_ajuste_estoque(uuid) RENAME TO _reverter_ajuste_estoque_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_aplicar_resolucao_alerta_tecido_core') THEN
    ALTER FUNCTION public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric) RENAME TO _aplicar_resolucao_alerta_tecido_core; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_receber_reposicao_troca_core') THEN
    ALTER FUNCTION public.receber_reposicao_troca(uuid,date,numeric) RENAME TO _receber_reposicao_troca_core; END IF;
END $$;

-- 2) Wrappers (mesma assinatura) com o guard de módulo.
-- ── criacao ──
CREATE OR REPLACE FUNCTION public.salvar_modelo_bom(_modelo_id uuid, _tecidos jsonb, _aviamentos jsonb, _grades jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._salvar_modelo_bom_core(_modelo_id, _tecidos, _aviamentos, _grades);
END $$;

-- ── producao ──
CREATE OR REPLACE FUNCTION public.enviar_modelo_para_cad(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL, _ficha_medida_url text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._enviar_modelo_para_cad_core(_modelo_id, _observacoes_tecnicas, _ficha_medida_url);
END $$;

CREATE OR REPLACE FUNCTION public.salvar_cad_completo(_modelo_id uuid, _tecidos jsonb, _grades jsonb, _aviamentos jsonb, _etiquetas jsonb, _proporcoes jsonb, _observacoes_molde text, _data_previsao_corte date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._salvar_cad_completo_core(_modelo_id, _tecidos, _grades, _aviamentos, _etiquetas, _proporcoes, _observacoes_molde, _data_previsao_corte);
END $$;

CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._baixar_estoque_tecido_corte_core(_cad_id);
END $$;

CREATE OR REPLACE FUNCTION public.salvar_cq(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._salvar_cq_core(_cad_id, _cq, _variantes, _reais, _confirmar);
END $$;

CREATE OR REPLACE FUNCTION public.desmarcar_cq(_cad_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._desmarcar_cq_core(_cad_id);
END $$;

-- ── entrada_saida ──
CREATE OR REPLACE FUNCTION public.criar_rolo(_codigo text, _artigo_id uuid, _variantes jsonb, _origem_item_id uuid DEFAULT NULL, _rua text DEFAULT NULL, _prateleira text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._criar_rolo_core(_codigo, _artigo_id, _variantes, _origem_item_id, _rua, _prateleira);
END $$;

CREATE OR REPLACE FUNCTION public.remover_metragem_oc(_oc_tecido_item_id uuid, _metragem numeric, _motivo text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._remover_metragem_oc_core(_oc_tecido_item_id, _metragem, _motivo);
END $$;

CREATE OR REPLACE FUNCTION public.reverter_ajuste_estoque(_baixa_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._reverter_ajuste_estoque_core(_baixa_id);
END $$;

CREATE OR REPLACE FUNCTION public.aplicar_resolucao_alerta_tecido(_item_id uuid, _acao text, _rep_artigo_id uuid DEFAULT NULL, _rep_variante_id uuid DEFAULT NULL, _rep_metragem numeric DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._aplicar_resolucao_alerta_tecido_core(_item_id, _acao, _rep_artigo_id, _rep_variante_id, _rep_metragem);
END $$;

CREATE OR REPLACE FUNCTION public.receber_reposicao_troca(_original_item_id uuid, _data date, _metragem numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._receber_reposicao_troca_core(_original_item_id, _data, _metragem);
END $$;

-- 3) Cores não chamáveis direto pelo cliente.
REVOKE EXECUTE ON FUNCTION public._salvar_modelo_bom_core(uuid,jsonb,jsonb,jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._enviar_modelo_para_cad_core(uuid,text,text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._baixar_estoque_tecido_corte_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._desmarcar_cq_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._criar_rolo_core(text,uuid,jsonb,uuid,text,text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._remover_metragem_oc_core(uuid,numeric,text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._reverter_ajuste_estoque_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._receber_reposicao_troca_core(uuid,date,numeric) FROM public, anon, authenticated;
