-- FORNECEDORES — FASE 3 (schema, núcleo): seleção empresa+representante na Produção > Serviços.
-- O seletor passa a gravar `empresa_id` (+ `representante_id` opcional) em producao_terceirizados;
-- o gatilho preenche `terceirizado_id` a partir do espelho (empresas.origem_terceirizado_id), pra
-- as RPCs que leem terceirizado_id até a F5 (ranking usa INNER JOIN → não pode ficar NULL).
-- Ver docs/superpowers/plans/2026-07-07-fornecedores-*.

-- 1) fn_prod_terc_empresa BIDIRECIONAL (era só terceirizado→empresa): agora deriva nos dois
--    sentidos, e NÃO deriva em serviço interno/PL (interno=true fica sem empresa/terceirizado/rep).
create or replace function public.fn_prod_terc_empresa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(NEW.interno, false) then
    return NEW;
  end if;
  -- empresa escolhida, terceirizado vazio → deriva o espelho (mantém terceirizado_id p/ as RPCs)
  if NEW.empresa_id is not null and NEW.terceirizado_id is null then
    select origem_terceirizado_id into NEW.terceirizado_id from public.empresas where id = NEW.empresa_id;
  end if;
  -- terceirizado informado, empresa vazia → deriva a empresa
  if NEW.terceirizado_id is not null and NEW.empresa_id is null then
    select id into NEW.empresa_id from public.empresas where origem_terceirizado_id = NEW.terceirizado_id;
  end if;
  return NEW;
end $$;

-- 2) salvar_terceirizados: aceita empresa_id + representante_id no bloco (UPDATE e INSERT). O front
--    manda empresa_id (+representante_id); o gatilho preenche terceirizado_id. Resto idêntico.
create or replace function public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text default null::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
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
          empresa_id = NULLIF(b->>'empresa_id','')::uuid,
          representante_id = NULLIF(b->>'representante_id','')::uuid,
          colaborador_id = NULLIF(b->>'colaborador_id','')::uuid,
          ativo = COALESCE((b->>'ativo')::boolean, true),
          preco_metro_unidade = NULLIF(b->>'preco_metro_unidade','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          desconto_total = COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          multa_total = COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          numero_parcelas = GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
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
          cad_id, categoria_terceirizado_id, interno, terceirizado_id, empresa_id, representante_id,
          colaborador_id, ativo,
          preco_metro_unidade, quantidade_enviada, quantidade_recebida, quantidade_defeito,
          desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados
        ) VALUES (
          _cad_id,
          NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'terceirizado_id','')::uuid,
          NULLIF(b->>'empresa_id','')::uuid,
          NULLIF(b->>'representante_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid,
          COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric,
          NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int,
          NULLIF(b->>'quantidade_defeito','')::int,
          COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
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

  IF EXISTS (
    SELECT 1 FROM public.producao_terceirizados pt
    JOIN public.parcelas_servico ps ON ps.producao_terceirizado_id = pt.id
    WHERE pt.cad_id = _cad_id AND NOT (pt.id = ANY(v_ids))
      AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Não é possível remover um serviço com parcela já paga (apagaria o histórico financeiro). Mantenha o bloco ou estorne a parcela antes.';
  END IF;

  DELETE FROM public.producao_terceirizados
   WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

select pg_notify('pgrst', 'reload schema');
