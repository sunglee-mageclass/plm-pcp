-- Feature B: botões por modelo no Simulador de OC.
--  - aplicar_simulacao_modelo: grava OC + cores + grade da simulação no Tecido Principal de um
--    modelo REAL não-aprovado (não toca no consumo — refinado no CAD/dev).
--  - criar_card_simulacao: cria um card (em_modelagem) do slot vazio (subcoleção/semana/linha/
--    categoria) + Tecido 1 (artigo da OC, consumo 0) + cores + grade; retorna o modelo_id.
-- Núcleo compartilhado _aplicar_sim_no_modelo_core (nunca grava consumo).
BEGIN;

CREATE OR REPLACE FUNCTION public._aplicar_sim_no_modelo_core(_modelo_id uuid, _oc_id uuid, _variantes jsonb, _grade jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_tid uuid; v_artigo uuid; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Modelo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- Isolamento de tenant: OC + variantes da loja.
  IF _oc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'OC de outra loja' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) v
    WHERE (v->>'variante_tecido_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id = (v->>'variante_tecido_id')::uuid AND x.tenant_id = v_tenant)
  ) THEN RAISE EXCEPTION 'Variante de tecido de outra loja' USING ERRCODE = '42501'; END IF;

  -- Artigo do Tecido 1 = artigo do item da OC (as cores compartilham o mesmo artigo).
  SELECT artigo_id INTO v_artigo FROM public.ocs_tecido_itens
   WHERE oc_tecido_id = _oc_id AND artigo_id IS NOT NULL LIMIT 1;

  -- Garante o Tecido 1 (tipo=tecido, numero=1). Cria com consumo 0 (dev/CAD define); se já existe,
  -- PRESERVA o consumo (só alinha o artigo à OC).
  SELECT id INTO v_tid FROM public.modelo_tecidos WHERE modelo_id = _modelo_id AND tipo = 'tecido' AND numero = 1;
  IF v_tid IS NULL THEN
    INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
    VALUES (_modelo_id, v_artigo, 1, 'tecido', 0, 0, 0)
    RETURNING id INTO v_tid;
  ELSIF v_artigo IS NOT NULL THEN
    UPDATE public.modelo_tecidos SET artigo_id = v_artigo WHERE id = v_tid;
  END IF;

  -- Cores (variantes) do Tecido 1 = as da unidade (substitui).
  DELETE FROM public.modelo_tecido_variantes WHERE modelo_tecido_id = v_tid;
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) LOOP
    IF (r->>'variante_tecido_id') IS NOT NULL THEN
      INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)
      VALUES (v_tid, (r->>'variante_tecido_id')::uuid, COALESCE((r->>'ordem')::int, 1), 1);
    END IF;
  END LOOP;

  -- Vínculo de OC do Tecido 1 (substitui os do tipo=tecido numero=1).
  DELETE FROM public.modelo_tecido_oc_links WHERE modelo_id = _modelo_id AND tipo = 'tecido' AND numero = 1;
  IF _oc_id IS NOT NULL THEN
    FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) LOOP
      IF (r->>'oc_tecido_item_id') IS NOT NULL AND (r->>'variante_tecido_id') IS NOT NULL THEN
        INSERT INTO public.modelo_tecido_oc_links
          (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
        VALUES (v_tenant, _modelo_id, 'tecido', 1, COALESCE((r->>'ordem')::int, 1),
                (r->>'variante_tecido_id')::uuid, (r->>'oc_tecido_item_id')::uuid, 0, 1);
      END IF;
    END LOOP;
  END IF;

  -- Grade (profundidade simulada por cor): grade_total = prof; grades por tamanho fica p/ o dev.
  DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_grade,'[]'::jsonb)) LOOP
    INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    VALUES (_modelo_id, (r->>'ordem')::int, '{}'::jsonb, GREATEST(0, COALESCE((r->>'prof')::int, 0)));
  END LOOP;

  -- Reserva de estoque: recalcula no próximo save do Desenvolvimento (BOM).
END;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_simulacao_modelo(_modelo_id uuid, _oc_id uuid, _variantes jsonb, _grade jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('otb') THEN
    RAISE EXCEPTION 'Módulo otb não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id) = 'aprovado' THEN
    RAISE EXCEPTION 'Modelo aprovado — não é possível sobrescrever pela simulação.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._aplicar_sim_no_modelo_core(_modelo_id, _oc_id, _variantes, _grade);
END;
$function$;

CREATE OR REPLACE FUNCTION public.criar_card_simulacao(_colecao_id uuid, _subcolecao_id uuid, _semana text, _linha_id uuid, _categoria_id uuid, _oc_id uuid, _variantes jsonb, _grade jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_modelo uuid; v_subnome text;
BEGIN
  IF NOT public.tenant_module_enabled('otb') THEN
    RAISE EXCEPTION 'Módulo otb não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.colecoes WHERE id = _colecao_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não encontrada';
  END IF;
  IF _subcolecao_id IS NOT NULL THEN
    SELECT nome INTO v_subnome FROM public.colecao_subcolecoes
     WHERE id = _subcolecao_id AND colecao_id = _colecao_id AND tenant_id = v_tenant;
    IF v_subnome IS NULL THEN RAISE EXCEPTION 'Subcoleção inválida'; END IF;
  END IF;

  INSERT INTO public.modelos
    (tenant_id, nome, colecao_id, subcolecao, semana, linha_id, categoria_principal_id, status_desenvolvimento)
  VALUES (v_tenant, 'Novo modelo', _colecao_id, v_subnome, NULLIF(_semana,''), _linha_id, _categoria_id, 'em_modelagem')
  RETURNING id INTO v_modelo;

  PERFORM public._aplicar_sim_no_modelo_core(v_modelo, _oc_id, _variantes, _grade);
  RETURN v_modelo;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._aplicar_sim_no_modelo_core(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aplicar_simulacao_modelo(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_simulacao_modelo(uuid, uuid, jsonb, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.criar_card_simulacao(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.criar_card_simulacao(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb) TO authenticated;

COMMIT;
