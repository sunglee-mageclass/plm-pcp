-- MO por serviço — RPCs + gate de permissão por linha (2026-08-06).
-- Trigger de permissão espelha o antigo enforce_maodeobra_aprovacao, mas POR LINHA (invariante #12).
-- RPCs wrapper+core com REVOKE dos três (invariante #9). Erros PT via RAISE P0001/42501.
BEGIN;

-- Gate de aprovação por linha: mudar/definir `aprovado` exige producao_servico_aprovacao.
CREATE OR REPLACE FUNCTION public.enforce_servico_mo_aprovacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.aprovado IS NOT NULL AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.aprovado IS DISTINCT FROM OLD.aprovado AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_enforce_servico_mo_aprovacao ON public.modelo_servico_mo;
CREATE TRIGGER trg_enforce_servico_mo_aprovacao
  BEFORE INSERT OR UPDATE ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.enforce_servico_mo_aprovacao();

-- salvar (VALOR livre; diff estado-completo; NUNCA toca aprovado) ----------------------------
CREATE OR REPLACE FUNCTION public._salvar_modelo_servico_mo_core(_modelo_id uuid, _linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_keep uuid[] := '{}';   -- categoria_terceirizado_id presentes (NULL não entra aqui)
  v_tem_legado boolean := false;
  r jsonb; v_cat uuid; v_valor numeric; v_obs text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas de MO devem ser uma lista' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    v_cat := NULLIF(r->>'categoria_terceirizado_id','')::uuid;
    v_valor := COALESCE((r->>'valor')::numeric, 0);
    v_obs := NULLIF(r->>'observacoes','');
    IF v_cat IS NULL THEN
      v_tem_legado := true;
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, updated_at = now()
       WHERE modelo_id = _modelo_id AND categoria_terceirizado_id IS NULL;
      IF NOT FOUND THEN
        INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
        VALUES (v_tenant, _modelo_id, NULL, v_valor, v_obs);
      END IF;
    ELSE
      -- a categoria tem que ser do tenant
      IF NOT EXISTS (SELECT 1 FROM public.categorias_terceirizado
                      WHERE id = v_cat AND tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = 'P0001';
      END IF;
      v_keep := array_append(v_keep, v_cat);
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, updated_at = now()
       WHERE modelo_id = _modelo_id AND categoria_terceirizado_id = v_cat;
      IF NOT FOUND THEN
        INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
        VALUES (v_tenant, _modelo_id, v_cat, v_valor, v_obs);
      END IF;
    END IF;
  END LOOP;

  -- estado completo: apaga o que não veio no payload.
  DELETE FROM public.modelo_servico_mo
   WHERE modelo_id = _modelo_id
     AND categoria_terceirizado_id IS NOT NULL
     AND NOT (categoria_terceirizado_id = ANY(v_keep));
  IF NOT v_tem_legado THEN
    DELETE FROM public.modelo_servico_mo
     WHERE modelo_id = _modelo_id AND categoria_terceirizado_id IS NULL;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_modelo_servico_mo(_modelo_id uuid, _linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_modelo_servico_mo_core(_modelo_id, _linhas);
END $function$;

-- aprovar/reprovar por linha ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aprovar_servico_mo_core(_modelo_id uuid, _categoria_terceirizado_id uuid, _aprovado boolean, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF _aprovado = false AND COALESCE(btrim(_motivo),'') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.modelo_servico_mo
     SET aprovado = _aprovado,
         motivo_reprovacao = CASE WHEN _aprovado THEN NULL ELSE _motivo END,
         updated_at = now()
   WHERE modelo_id = _modelo_id
     AND categoria_terceirizado_id IS NOT DISTINCT FROM _categoria_terceirizado_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de mão de obra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.aprovar_servico_mo(_modelo_id uuid, _categoria_terceirizado_id uuid, _aprovado boolean, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._aprovar_servico_mo_core(_modelo_id, _categoria_terceirizado_id, _aprovado, _motivo);
END $function$;

-- resumo (leitura; valor mascarado se não pode ver custos) ------------------------------------
CREATE OR REPLACE FUNCTION public._modelo_mo_resumo_core(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_ver boolean := public._pode_ver_custos();
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'estado',
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id) THEN 'sem_servico'
        WHEN EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado = false) THEN 'reprovada'
        WHEN EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado IS NULL) THEN 'pendente'
        ELSE 'aprovada'
      END,
    'total', CASE WHEN v_ver THEN coalesce((SELECT sum(s.valor) FROM modelo_servico_mo s WHERE s.modelo_id = m.id), 0) ELSE NULL END,
    'total_aprovado', CASE WHEN v_ver THEN coalesce((SELECT sum(s.valor) FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado = true), 0) ELSE NULL END,
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'categoria_terceirizado_id', s.categoria_terceirizado_id,
        'nome', COALESCE(ct.nome, 'Geral (legado)'),
        'valor', CASE WHEN v_ver THEN s.valor ELSE NULL END,
        'aprovado', s.aprovado,
        'motivo_reprovacao', s.motivo_reprovacao
      ) ORDER BY (s.categoria_terceirizado_id IS NOT NULL), ct.ordem, ct.nome)
      FROM modelo_servico_mo s
      LEFT JOIN categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
      WHERE s.modelo_id = m.id
    ), '[]'::jsonb)
  )), '{}'::jsonb)
  INTO v_result
  FROM modelos m
  WHERE m.tenant_id = v_tenant AND m.id = ANY(_ids);
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.modelo_mo_resumo(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public._pode_ver_custos() OR public.user_can_edit('producao_servico_aprovacao')) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN public._modelo_mo_resumo_core(_ids);
END $function$;

-- REVOKE dos três em TODOS os cores (invariante #9). Wrappers ficam com o EXECUTE default.
REVOKE EXECUTE ON FUNCTION public._salvar_modelo_servico_mo_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._aprovar_servico_mo_core(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._modelo_mo_resumo_core(uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;
