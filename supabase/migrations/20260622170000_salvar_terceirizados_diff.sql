-- Item 16a (Fase 2): save de Terceirizados era insert-all + delete-all no front
-- (não-atômico, ids voláteis a cada save, last-write-wins em concorrência).
-- RPC transacional com DIFF-POR-ID: UPDATE existentes (por id), INSERT novos,
-- DELETE os que sumiram do payload. Preserva ids; tudo numa transação.
-- A lógica de `interno` (terceirizado/colaborador/preço) fica no front, que envia
-- os valores já resolvidos. Status é setado pelo trigger auto_status_terceirizado.

CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL)
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
        UPDATE public.producao_terceirizados SET
          categoria_terceirizado_id = NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          interno = COALESCE((b->>'interno')::boolean, false),
          terceirizado_id = NULLIF(b->>'terceirizado_id','')::uuid,
          colaborador_id = NULLIF(b->>'colaborador_id','')::uuid,
          ativo = COALESCE((b->>'ativo')::boolean, true),
          preco_metro_unidade = NULLIF(b->>'preco_metro_unidade','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          data_enviado = NULLIF(b->>'data_enviado','')::date,
          data_prevista = NULLIF(b->>'data_prevista','')::date,
          data_entregue = NULLIF(b->>'data_entregue','')::date,
          observacao = b->>'observacao',
          aviamentos_enviados = COALESCE(b->'aviamentos_enviados', '[]'::jsonb),
          tecidos_enviados = COALESCE(b->'tecidos_enviados', '[]'::jsonb)
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, terceirizado_id, colaborador_id, ativo,
          preco_metro_unidade, quantidade_enviada, quantidade_recebida, quantidade_defeito,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados
        ) VALUES (
          _cad_id,
          NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'terceirizado_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid,
          COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric,
          NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int,
          NULLIF(b->>'quantidade_defeito','')::int,
          NULLIF(b->>'data_enviado','')::date,
          NULLIF(b->>'data_prevista','')::date,
          NULLIF(b->>'data_entregue','')::date,
          b->>'observacao',
          COALESCE(b->'aviamentos_enviados', '[]'::jsonb),
          COALESCE(b->'tecidos_enviados', '[]'::jsonb)
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  -- Remove os blocos que sumiram do payload.
  DELETE FROM public.producao_terceirizados
   WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));

  -- "Observação de Partes do Molde" tem fonte única no cad.
  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;
