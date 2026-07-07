-- CRÍTICO: corrige a corrupção de estoque dos rolos.
-- _recompute_oc_from_rolos reescrevia ocs_tecido_itens.quantidade_recebida da OC de origem
-- com Σ(rolos), violando o invariante #4 (recebido é imutável; a separação já é baixa no
-- ledger). Os 4 callers JÁ mantêm a baixa separacao_rolo (delete/insert/update), então o
-- saldo (saldo_oc_item_m = recebida − Σbaixas) já fica correto SEM o recompute. Remove as 4
-- chamadas + dropa a função. Diagnóstico: time (rolos) + verificação própria.

-- _cancelar_rolo_core: sem recompute (o DELETE/INSERT da baixa já restaura o saldo)
CREATE OR REPLACE FUNCTION public._cancelar_rolo_core(_rolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_origem uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id, rolo_origem_item_id INTO v_tenant, v_origem
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;
  IF public._rolo_em_uso(_rolo_id) THEN
    RAISE EXCEPTION 'Rolo já em uso (consumido ou selecionado em Desenvolvimento) — desfaça o uso antes de cancelar.';
  END IF;

  UPDATE public.ocs_tecido_itens SET cancelado = true, cq_alerta_status = 'cancelado'
   WHERE oc_tecido_id = _rolo_id;
  DELETE FROM public.estoque_tecido_baixas WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo';
END;
$function$;

-- _reabrir_rolo_core: sem recompute (o DELETE/INSERT da baixa já restaura o saldo)
CREATE OR REPLACE FUNCTION public._reabrir_rolo_core(_rolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_origem uuid; v_artigo uuid; v_variante uuid; v_qtd numeric; v_unidade text; v_rend numeric; v_metros numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id, rolo_origem_item_id INTO v_tenant, v_origem
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;

  SELECT artigo_id, variante_tecido_id, COALESCE(quantidade_recebida, 0)
    INTO v_artigo, v_variante, v_qtd
  FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id LIMIT 1;

  UPDATE public.ocs_tecido_itens SET cancelado = false, cq_alerta_status = 'alertado'
   WHERE oc_tecido_id = _rolo_id;

  IF v_origem IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.estoque_tecido_baixas WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo'
  ) THEN
    SELECT unidade_medida, COALESCE(rendimento, 0) INTO v_unidade, v_rend FROM public.artigos WHERE id = v_artigo;
    v_metros := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_qtd * v_rend ELSE v_qtd END;
    INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id,
                                              variante_tecido_id, quantidade, origem, rolo_id)
    VALUES (v_tenant, NULL, v_origem, v_variante, v_metros, 'separacao_rolo', _rolo_id);
  END IF;
END;
$function$;

-- _ajustar_rolo_core: sem recompute (o DELETE/INSERT da baixa já restaura o saldo)
CREATE OR REPLACE FUNCTION public._ajustar_rolo_core(_rolo_id uuid, _nova_qtd numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_origem uuid; v_item uuid; v_artigo uuid; v_unidade text; v_rend numeric; v_metros numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _nova_qtd IS NULL OR _nova_qtd <= 0 THEN RAISE EXCEPTION 'Quantidade do rolo inválida.'; END IF;

  SELECT tenant_id, rolo_origem_item_id INTO v_tenant, v_origem
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;

  SELECT id, artigo_id INTO v_item, v_artigo FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id LIMIT 1;
  IF v_item IS NULL THEN RAISE EXCEPTION 'Item do rolo não encontrado'; END IF;
  IF public._rolo_em_uso(_rolo_id) THEN
    RAISE EXCEPTION 'Rolo já em uso (consumido ou selecionado em Desenvolvimento) — desfaça o uso antes de ajustar a quantidade.';
  END IF;

  SELECT unidade_medida, COALESCE(rendimento, 0) INTO v_unidade, v_rend FROM public.artigos WHERE id = v_artigo;
  v_metros := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN _nova_qtd * v_rend ELSE _nova_qtd END;

  UPDATE public.ocs_tecido_itens SET quantidade_recebida = _nova_qtd, quantidade_pedida = _nova_qtd
   WHERE oc_tecido_id = _rolo_id;
  UPDATE public.estoque_tecido_baixas SET quantidade = v_metros
   WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo';
END;
$function$;

-- _trocar_rolo_core: sem recompute
CREATE OR REPLACE FUNCTION public._trocar_rolo_core(_rolo_id uuid, _nova_metragem numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_origem uuid; v_artigo uuid; v_variante uuid; v_item_def uuid;
  v_metros numeric; v_unidade text; v_rend numeric; v_codigo text; v_new_rolo uuid; v_qtd numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id, rolo_origem_item_id INTO v_tenant, v_origem
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;
  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'Rolo sem origem (não foi separado de uma OC) — troca indisponível.';
  END IF;

  SELECT id, artigo_id, variante_tecido_id INTO v_item_def, v_artigo, v_variante
  FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id LIMIT 1;

  IF public._rolo_em_uso(_rolo_id) THEN
    RAISE EXCEPTION 'Rolo já em uso (consumido ou selecionado em Desenvolvimento) — desfaça o uso antes de trocar.';
  END IF;

  SELECT quantidade INTO v_metros
  FROM public.estoque_tecido_baixas WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo' LIMIT 1;
  v_metros := COALESCE(_nova_metragem, v_metros, 0);
  IF v_metros <= 0 THEN RAISE EXCEPTION 'Metragem do rolo de reposição inválida.'; END IF;

  DELETE FROM public.estoque_tecido_baixas WHERE rolo_id = _rolo_id;
  DELETE FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id;
  DELETE FROM public.ocs_tecido WHERE id = _rolo_id;

  SELECT unidade_medida, COALESCE(rendimento, 0) INTO v_unidade, v_rend FROM public.artigos WHERE id = v_artigo;
  v_codigo := public.proximo_codigo_rolo(v_artigo);
  v_qtd := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_metros / v_rend ELSE v_metros END;

  INSERT INTO public.ocs_tecido (tenant_id, is_rolo, rolo_codigo, rolo_origem_item_id,
                                 status, data_pedido, data_entrega, numero_pedido)
  VALUES (v_tenant, true, v_codigo, v_origem, 'recebido', current_date, current_date, v_codigo)
  RETURNING id INTO v_new_rolo;
  INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida)
  VALUES (v_new_rolo, v_artigo, v_variante, v_qtd, v_qtd);
  INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem, rolo_id)
  VALUES (v_tenant, NULL, v_origem, v_variante, v_metros, 'separacao_rolo', v_new_rolo);

  RETURN v_new_rolo;
END;
$function$;

-- Dropa a função corruptora (sem mais callers).
drop function if exists public._recompute_oc_from_rolos(uuid);

-- Reparo de dado: o único item de loja REAL vítima do recompute (recebida sobrescrita
-- abaixo da metragem já separada em rolos → físico negativo). Valor original perdido (item
-- não é auditado); restaura p/ quantidade_pedida (recebimento integral — pedido de teste).
-- Alvo preciso: item COM rolos onde a recebida (em metros) < Σ(baixas separacao_rolo).
update public.ocs_tecido_itens i set quantidade_recebida = i.quantidade_pedida
from public.ocs_tecido o, public.artigos a
where o.id = i.oc_tecido_id and a.id = i.artigo_id and coalesce(o.is_rolo,false)=false
  and exists (select 1 from public.ocs_tecido r where r.is_rolo and r.rolo_origem_item_id = i.id)
  and (case when a.unidade_medida='kg' and coalesce(a.rendimento,0)>0
            then coalesce(i.quantidade_recebida,0)*a.rendimento else coalesce(i.quantidade_recebida,0) end)
      < coalesce((select sum(quantidade) from public.estoque_tecido_baixas
                  where oc_tecido_item_id = i.id and origem='separacao_rolo'),0);

select pg_notify('pgrst','reload schema');
