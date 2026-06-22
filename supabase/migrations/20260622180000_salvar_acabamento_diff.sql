-- Item 16b (Fase 2): save de Acabamento era insert-all + delete-all no front.
-- RPC transacional com diff-por-id (preserva ids). Status pelo trigger
-- auto_status_prod_acab. Guard de módulo (producao).

CREATE OR REPLACE FUNCTION public.salvar_acabamento(_cad_id uuid, _blocos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  b jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_blocos) = 'array' THEN
    FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
      IF NULLIF(b->>'id','') IS NOT NULL THEN
        UPDATE public.producao_acabamento SET
          tipo = b->>'tipo',
          ativo = COALESCE((b->>'ativo')::boolean, true),
          terceirizado_id = NULLIF(b->>'terceirizado_id','')::uuid,
          preco_por_peca = NULLIF(b->>'preco_por_peca','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          data_enviado = NULLIF(b->>'data_enviado','')::date,
          data_prevista = NULLIF(b->>'data_prevista','')::date,
          data_entregue = NULLIF(b->>'data_entregue','')::date,
          observacao = b->>'observacao',
          aviamentos_utilizados = COALESCE(b->'aviamentos_utilizados', '[]'::jsonb)
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_acabamento (
          cad_id, tipo, ativo, terceirizado_id, preco_por_peca,
          quantidade_enviada, quantidade_recebida, quantidade_defeito,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_utilizados
        ) VALUES (
          _cad_id, b->>'tipo', COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'terceirizado_id','')::uuid, NULLIF(b->>'preco_por_peca','')::numeric,
          NULLIF(b->>'quantidade_enviada','')::int, NULLIF(b->>'quantidade_recebida','')::int,
          NULLIF(b->>'quantidade_defeito','')::int,
          NULLIF(b->>'data_enviado','')::date, NULLIF(b->>'data_prevista','')::date, NULLIF(b->>'data_entregue','')::date,
          b->>'observacao', COALESCE(b->'aviamentos_utilizados', '[]'::jsonb)
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  DELETE FROM public.producao_acabamento
   WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));
END;
$function$;
