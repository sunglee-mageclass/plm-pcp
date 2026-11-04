-- Inverso de supabase/migrations/20261107100000_cq_tecido_no_salvar_oc.sql.
-- Devolve as funcoes de ANTES: DROP das assinaturas de 5 args (salvar_oc_tecido e _salvar_oc_tecido_core) e CREATE das de 4 args com o texto
-- EXATO do vivo anterior (sem as 3 colunas cq_* nos itens e sem o bloco _cq_rolos), reconcedendo os grants originais
-- (_core: so service_role; wrapper: authenticated + service_role). Os cq_* ja gravados FICAM (nenhum dado volta); o Salvar da OC volta a
-- nao tocar o CQ. Guarda: so roda se o vivo for o "depois" da ida (md5 core(5) c2235ef685c27dfa21aea5dd0de8684a; wrapper(5) 7febb57d57abb6b48f2d779af7050cb8) ou
-- se ja estiver no "antes" (idempotente, md5 e69ad2d9c0524d9e60d3628405052c06 / c68f8dca982d5bab85c9f1eda1771672).
-- Volta LIFO: SITE antes (o site novo manda as chaves cq_* e o 5o argumento; contra o banco de 4 args a chamada com _cq_rolos falha). Este arquivo ANTES de
-- qualquer inverso mais antigo que fixe o md5 de salvar_oc_tecido(4)/_salvar_oc_tecido_core(4) (S6 20261101250000_down, Camada 20261103160000_down,
-- S3a 20261101100000_down, B2 20261103141000_down, Nota 20261002100000_down).
-- Trava: so catalogo. Aplicar: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL check_function_bodies = off;

DO $guarda$
DECLARE
  v_c4 oid := to_regprocedure('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)');
  v_w4 oid := to_regprocedure('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)');
  v_c5 oid := to_regprocedure('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer,jsonb)');
  v_w5 oid := to_regprocedure('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer,jsonb)');
BEGIN
  IF v_c5 IS NOT NULL AND v_w5 IS NOT NULL AND v_c4 IS NULL AND v_w4 IS NULL THEN
    IF md5(pg_get_functiondef(v_c5)) <> 'c2235ef685c27dfa21aea5dd0de8684a' THEN
      RAISE EXCEPTION 'cq_no_salvar_oc_down: _salvar_oc_tecido_core(5) com texto inesperado (md5 %) - outra frente mexeu', md5(pg_get_functiondef(v_c5)) USING ERRCODE = 'P0001';
    END IF;
    IF md5(pg_get_functiondef(v_w5)) <> '7febb57d57abb6b48f2d779af7050cb8' THEN
      RAISE EXCEPTION 'cq_no_salvar_oc_down: salvar_oc_tecido(5) com texto inesperado (md5 %) - outra frente mexeu', md5(pg_get_functiondef(v_w5)) USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_c4 IS NOT NULL AND v_w4 IS NOT NULL AND v_c5 IS NULL AND v_w5 IS NULL THEN
    IF md5(pg_get_functiondef(v_c4)) <> 'e69ad2d9c0524d9e60d3628405052c06' OR md5(pg_get_functiondef(v_w4)) <> 'c68f8dca982d5bab85c9f1eda1771672' THEN
      RAISE EXCEPTION 'cq_no_salvar_oc_down: assinaturas de 4 args com texto inesperado' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'cq_no_salvar_oc_down: estado inesperado das assinaturas (4/5 args)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.salvar_oc_tecido(uuid,jsonb,jsonb,integer,jsonb);
DROP FUNCTION IF EXISTS public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer,jsonb);
DROP FUNCTION IF EXISTS public.salvar_oc_tecido(uuid,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer);

CREATE OR REPLACE FUNCTION public._salvar_oc_tecido_core(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_oc_id uuid := _oc_id;
  v_status text := COALESCE(_oc->>'status', 'encomendado');
  v_recebido boolean := (_oc->>'status' = 'recebido');
  v_keep uuid[];
  v_num text;
  r jsonb;
BEGIN
  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_tecido
        where id = _oc_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.artigos a ON a.id = (e->>'artigo_id')::uuid
    WHERE e->>'artigo_id' IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Tecido de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_tecido WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_tecido
      (tenant_id, numero_pedido, responsavel_id, responsavel_nome, empresa_id, representante_id,
       data_pedido, data_prevista_entrega, data_entrega, prazo_pagamento, quantidade_prazos,
       observacoes_entrega, observacoes_defeitos, anexo_pedido_url, modelo_sugerido_url, nf_url,
       parcelas_recebimento, valor_previsto_total, valor_real_total, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, (_oc->>'responsavel_id')::uuid, _oc->>'responsavel_nome',
       (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1),
       _oc->>'observacoes_entrega', _oc->>'observacoes_defeitos', _oc->>'anexo_pedido_url',
       _oc->>'modelo_sugerido_url', _oc->>'nf_url', COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
       COALESCE((_oc->>'valor_previsto_total')::numeric, 0), COALESCE((_oc->>'valor_real_total')::numeric, 0),
       'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida,
       quantidade_recebida, rendimento, cancelado, rolos_planejados, preco)
    SELECT v_oc_id, (e->>'artigo_id')::uuid, (e->>'artigo_numero')::int, (e->>'variante_tecido_id')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           (e->>'rendimento')::numeric, COALESCE((e->>'cancelado')::boolean, false), e->'rolos_planejados',
           NULLIF(e->>'preco','')::numeric
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_tecido SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_tecido
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;
    -- [seg s6] (Reforco de seguranca S6, P-236 = D7 A) o Salvar NUNCA faz uma OC recebida voltar: so o "Desmarcar recebimento"
    -- (desmarcar_recebimento_oc*) desfaz o recebimento. Trava a linha (2 abas: B recebeu enquanto A editava -> A e recusado).
    IF (SELECT o.status FROM public.ocs_tecido o WHERE o.id = v_oc_id FOR UPDATE) = 'recebido'
       AND v_status IS DISTINCT FROM 'recebido' THEN
      RAISE EXCEPTION 'oc_recebida_so_desmarcar: OC recebida so volta a encomendada pelo Desmarcar recebimento' USING ERRCODE = 'P0001';
    END IF;

    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL);
    DELETE FROM public.ocs_tecido_itens WHERE oc_tecido_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_tecido_itens SET
        artigo_id = (r->>'artigo_id')::uuid,
        artigo_numero = (r->>'artigo_numero')::int,
        variante_tecido_id = (r->>'variante_tecido_id')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        rendimento = (r->>'rendimento')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false),
        rolos_planejados = r->'rolos_planejados',
        preco = NULLIF(r->>'preco','')::numeric
      WHERE id = (r->>'id')::uuid AND oc_tecido_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida,
       quantidade_recebida, rendimento, cancelado, rolos_planejados, preco)
    SELECT v_oc_id, (e->>'artigo_id')::uuid, (e->>'artigo_numero')::int, (e->>'variante_tecido_id')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           (e->>'rendimento')::numeric, COALESCE((e->>'cancelado')::boolean, false), e->'rolos_planejados',
           NULLIF(e->>'preco','')::numeric
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL;

    UPDATE public.ocs_tecido SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_id = (_oc->>'responsavel_id')::uuid,
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      observacoes_entrega = _oc->>'observacoes_entrega',
      observacoes_defeitos = _oc->>'observacoes_defeitos',
      anexo_pedido_url = _oc->>'anexo_pedido_url',
      modelo_sugerido_url = _oc->>'modelo_sugerido_url',
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      valor_previsto_total = COALESCE((_oc->>'valor_previsto_total')::numeric, 0),
      valor_real_total = COALESCE((_oc->>'valor_real_total')::numeric, 0),
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- A OC dita o preço, mas o cadastro reflete o preço da OC MAIS RECENTE por variante (por
  -- data_pedido, depois created_at). Editar uma OC antiga NÃO muda o cadastro se há OC mais recente.
  UPDATE public.variantes_tecido vt SET preco = latest.preco
  FROM (
    SELECT DISTINCT ON (oti.variante_tecido_id) oti.variante_tecido_id, oti.preco
    FROM public.ocs_tecido_itens oti
    JOIN public.ocs_tecido oc ON oc.id = oti.oc_tecido_id
    WHERE oc.tenant_id = v_tenant
      AND oti.preco IS NOT NULL
      AND COALESCE(oti.cancelado, false) = false
      AND oti.variante_tecido_id IN (
        SELECT (e->>'variante_tecido_id')::uuid FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
        WHERE e->>'variante_tecido_id' IS NOT NULL
      )
    ORDER BY oti.variante_tecido_id, oc.data_pedido DESC NULLS LAST, oc.created_at DESC
  ) latest
  WHERE vt.id = latest.variante_tecido_id AND vt.tenant_id = v_tenant AND vt.preco IS DISTINCT FROM latest.preco;

  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'tecido');
  END IF;

  RETURN v_oc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_tecido(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_tecido.
  PERFORM public._seg_exige_pagina('entrada_oc_tecido');
  -- [camada C1 / P-77 A] estado completo VAZIO com itens no servidor = recusa (nada e apagado), a nao ser com a marca
  -- explicita "apagar tudo" (_oc->'_apagar_itens' = true; a tela so manda depois do "Apagar todos os N itens?").
  IF _oc_id IS NOT NULL
     AND (CASE jsonb_typeof(COALESCE(_itens, '[]'::jsonb)) WHEN 'array' THEN jsonb_array_length(COALESCE(_itens, '[]'::jsonb)) = 0 ELSE false END)
     AND COALESCE(_oc->>'_apagar_itens', '') <> 'true'
     AND EXISTS (SELECT 1 FROM public.ocs_tecido o JOIN public.ocs_tecido_itens i ON i.oc_tecido_id = o.id
                  WHERE o.id = _oc_id AND (o.tenant_id = public.get_user_tenant_id() OR public.is_super_admin())) THEN
    RAISE EXCEPTION 'estado_vazio_recusado: itens_oc %',
      (SELECT count(*) FROM public.ocs_tecido_itens WHERE oc_tecido_id = _oc_id) USING ERRCODE = 'P0001';
  END IF;
  RETURN public._salvar_oc_tecido_core(_oc_id, _oc, _itens, _rev_base);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_tecido(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_tecido(uuid,jsonb,jsonb,integer) TO authenticated, service_role;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)'::regprocedure)) <> 'e69ad2d9c0524d9e60d3628405052c06'
     OR md5(pg_get_functiondef('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)'::regprocedure)) <> 'c68f8dca982d5bab85c9f1eda1771672' THEN
    RAISE EXCEPTION 'cq_no_salvar_oc_down: pos-condicao falhou (md5 das 4 args diferente do antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer,jsonb)') IS NOT NULL
     OR to_regprocedure('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'cq_no_salvar_oc_down: assinatura de 5 args ainda existe' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cq_no_salvar_oc_down: ACL fora do esperado' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
