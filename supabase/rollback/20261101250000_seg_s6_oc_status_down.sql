-- Inverso de supabase/migrations/20261101250000_seg_s6_oc_status.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s6.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S6, item S4 do §1). Por cima da S3a (salvar_oc_etiqueta no texto dela).
-- Devolve os 5 textos de antes (md5 conferido).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)
--     ANTES  aa64df90ef7daad675a69dbab7c1d585
--     DEPOIS e69ad2d9c0524d9e60d3628405052c06
--   public._salvar_oc_aviamento_core(uuid,jsonb,jsonb)
--     ANTES  a3f2413eba2e8c8e4c7f521285564d00
--     DEPOIS dd7650c24d5403e4910e37be4714540d
--   public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)
--     ANTES  e71a9eb27389d429f9aeb3ac112e913b
--     DEPOIS b00e6c195035f4588f492e306c4ca536
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb)
--     ANTES  484b694ecc31f4c897c435063d18310e (= depois da S3a)
--     DEPOIS ccafbb317bd50cfac4ec46b4d59b04f1
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)
--     ANTES  2981a2cb4ea80fd5bed5f6999244365b (= depois da S3a)
--     DEPOIS 5bfa12603078c4c57fbc5abc6a2b7969
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION): nenhuma tabela, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
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
      ('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'aa64df90ef7daad675a69dbab7c1d585', 'e69ad2d9c0524d9e60d3628405052c06'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb)', 'a3f2413eba2e8c8e4c7f521285564d00', 'dd7650c24d5403e4910e37be4714540d'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', 'e71a9eb27389d429f9aeb3ac112e913b', 'b00e6c195035f4588f492e306c4ca536'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)', '484b694ecc31f4c897c435063d18310e', 'ccafbb317bd50cfac4ec46b4d59b04f1'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '2981a2cb4ea80fd5bed5f6999244365b', '5bfa12603078c4c57fbc5abc6a2b7969')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 's6_oc_status_down: % com texto inesperado (md5 %) - a S3a esta aplicada? outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

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

CREATE OR REPLACE FUNCTION public._salvar_oc_aviamento_core(_oc_id uuid, _oc jsonb, _itens jsonb)
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- A3: itens não podem referenciar aviamento de outra loja (nem de outro fornecedor que
  -- não o da OC). Fecha item órfão/IDOR via payload forjado. (empresa_id da OC é validada
  -- pelo trigger enforce_empresa_tenant.)
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.aviamentos a ON a.id = (e->>'aviamento_id')::uuid
    WHERE e->>'aviamento_id' IS NOT NULL
      AND ( a.tenant_id IS DISTINCT FROM v_tenant
            OR ( (_oc->>'empresa_id') IS NOT NULL AND a.empresa_id IS NOT NULL
                 AND a.empresa_id IS DISTINCT FROM (_oc->>'empresa_id')::uuid ) )
  ) THEN
    RAISE EXCEPTION 'Aviamento de outra loja ou fornecedor não pode ser adicionado à OC.';
  END IF;

  -- Variante (se informada) tem de pertencer ao aviamento do MESMO item e à loja
  -- (espelha o vínculo cor-apelido de salvar_variantes_aviamento). LEFT JOIN p/ que
  -- id inexistente/forjado (va.id IS NULL) também caia no RAISE.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    LEFT JOIN public.variantes_aviamento va ON va.id = (e->>'variante_aviamento_id')::uuid
    WHERE NULLIF(e->>'variante_aviamento_id','') IS NOT NULL
      AND ( va.id IS NULL
            OR va.aviamento_id IS DISTINCT FROM (e->>'aviamento_id')::uuid
            OR va.tenant_id IS DISTINCT FROM v_tenant )
  ) THEN
    RAISE EXCEPTION 'Variante não pertence ao aviamento informado (ou é de outra loja).';
  END IF;

  IF v_oc_id IS NULL THEN
    -- INSERT: cria como 'encomendado' (trigger não gera parcela), itens, depois status final.
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_aviamento WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_aviamento
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1), _oc->>'nf_url',
       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado')
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_aviamento SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_aviamento
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    -- diff de itens por id (preserva ids). keep = ids enviados.
    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL);
    DELETE FROM public.ocs_aviamento_itens
      WHERE oc_aviamento_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_aviamento_itens SET
        aviamento_id = (r->>'aviamento_id')::uuid,
        variante_aviamento_id = NULLIF(r->>'variante_aviamento_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false)
      WHERE id = (r->>'id')::uuid AND oc_aviamento_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'aviamento_id' IS NOT NULL;

    -- update da OC (dispara o trigger já com itens corretos)
    UPDATE public.ocs_aviamento SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- Recalcula parcelas quando recebida (preserva pagas; o trigger não regenera se já existe).
  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'aviamento');
  END IF;

  RETURN v_oc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._salvar_oc_aviamento_core(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
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
  v_sem_cor text;
  r jsonb;
BEGIN
  -- trava otimista (spec 2026-08-03) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev int;
    BEGIN
      SELECT rev INTO v_rev FROM public.ocs_aviamento
        WHERE id = _oc_id AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
        FOR UPDATE;
      IF v_rev IS DISTINCT FROM _rev_base THEN
        RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa'
          USING ERRCODE = 'P0409';
      END IF;
    END;
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- A3: itens não podem referenciar aviamento de outra loja (nem de outro fornecedor que
  -- não o da OC). Fecha item órfão/IDOR via payload forjado. (empresa_id da OC é validada
  -- pelo trigger enforce_empresa_tenant.)
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.aviamentos a ON a.id = (e->>'aviamento_id')::uuid
    WHERE e->>'aviamento_id' IS NOT NULL
      AND ( a.tenant_id IS DISTINCT FROM v_tenant
            OR ( (_oc->>'empresa_id') IS NOT NULL AND a.empresa_id IS NOT NULL
                 AND a.empresa_id IS DISTINCT FROM (_oc->>'empresa_id')::uuid ) )
  ) THEN
    RAISE EXCEPTION 'Aviamento de outra loja ou fornecedor não pode ser adicionado à OC.';
  END IF;

  -- Variante (se informada) tem de pertencer ao aviamento do MESMO item e à loja
  -- (espelha o vínculo cor-apelido de salvar_variantes_aviamento). LEFT JOIN p/ que
  -- id inexistente/forjado (va.id IS NULL) também caia no RAISE.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    LEFT JOIN public.variantes_aviamento va ON va.id = (e->>'variante_aviamento_id')::uuid
    WHERE NULLIF(e->>'variante_aviamento_id','') IS NOT NULL
      AND ( va.id IS NULL
            OR va.aviamento_id IS DISTINCT FROM (e->>'aviamento_id')::uuid
            OR va.tenant_id IS DISTINCT FROM v_tenant )
  ) THEN
    RAISE EXCEPTION 'Variante não pertence ao aviamento informado (ou é de outra loja).';
  END IF;

  -- [leves L9 fin #8, P-206 A] preco da COMPRA no item: numero >= 0. Vazio/ausente = preco do cadastro (gravado abaixo).
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL
      AND NULLIF(e->>'preco','') IS NOT NULL
      AND (e->>'preco')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'oc_aviamento_preco_invalido: o preco do item nao pode ser negativo' USING ERRCODE = 'P0001';
  END IF;

  -- [leves L9 est #5, P-208 A] aviamento com 2+ cores (variantes) exige a cor no item. Vale para item NOVO e para item
  -- EDITADO neste save (aviamento, cor, quantidades, cancelado ou preco efetivo diferentes do gravado); item antigo sem cor
  -- e NAO mexido (legado, ex.: FRANJA 00003118 da Ave Rara) so ganha aviso na tela e nao trava o save do resto da OC.
  -- Item cancelado nao exige (nao entra no estoque). Mesma regra no front (src/lib/oc-aviamento-item.ts). Aqui o item nao
  -- tem cor no payload; se o gravado tinha cor, ja conta como editado - por isso o preco efetivo dos 2 lados e o geral.
  SELECT regexp_replace(COALESCE(a.codigo_nome, a.codigo, '?'), '[^ -~]', '?', 'g') INTO v_sem_cor
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) WITH ORDINALITY AS e(j, n)
    JOIN public.aviamentos a ON a.id = (e.j->>'aviamento_id')::uuid
    LEFT JOIN public.ocs_aviamento_itens s
      ON v_oc_id IS NOT NULL AND s.id = NULLIF(e.j->>'id','')::uuid AND s.oc_aviamento_id = v_oc_id
   WHERE NULLIF(e.j->>'variante_aviamento_id','') IS NULL
     AND NOT COALESCE((e.j->>'cancelado')::boolean, false)
     AND (SELECT count(*) FROM public.variantes_aviamento va WHERE va.aviamento_id = a.id) >= 2
     AND ( s.id IS NULL
           OR s.aviamento_id IS DISTINCT FROM a.id
           OR s.variante_aviamento_id IS NOT NULL
           OR COALESCE(s.cancelado, false)
           OR s.quantidade_pedida IS DISTINCT FROM (e.j->>'quantidade_pedida')::numeric
           OR s.quantidade_recebida IS DISTINCT FROM (e.j->>'quantidade_recebida')::numeric
           OR ( e.j ? 'preco'
                AND COALESCE(NULLIF(e.j->>'preco','')::numeric, a.preco) IS DISTINCT FROM COALESCE(s.preco, a.preco) ) )
   ORDER BY e.n
   LIMIT 1;
  IF v_sem_cor IS NOT NULL THEN
    RAISE EXCEPTION 'oc_aviamento_cor_obrigatoria: %', v_sem_cor USING ERRCODE = 'P0001';
  END IF;

  IF v_oc_id IS NULL THEN
    -- INSERT: cria como 'encomendado' (trigger não gera parcela), itens, depois status final.
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_aviamento WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_aviamento
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1), _oc->>'nf_url',
       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
    RETURNING id INTO v_oc_id;

    -- [leves L9] preco: o da compra (payload) ou, vazio/ausente, o do cadastro de hoje (congelado no item): o da COR
    -- (variantes_aviamento.preco > 0) senao o geral do aviamento (P-216 A).
    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado, preco)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false),
           COALESCE(NULLIF(e->>'preco','')::numeric,
                    (SELECT COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco)
                       FROM public.aviamentos a
                       LEFT JOIN public.variantes_aviamento va
                         ON va.id = NULLIF(e->>'variante_aviamento_id','')::uuid AND va.aviamento_id = a.id
                      WHERE a.id = (e->>'aviamento_id')::uuid))
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_aviamento SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_aviamento
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    -- diff de itens por id (preserva ids). keep = ids enviados.
    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL);
    DELETE FROM public.ocs_aviamento_itens
      WHERE oc_aviamento_id = v_oc_id AND NOT (id = ANY(v_keep));

    -- [leves L9] preco: numero no payload = grava; chave presente vazia/nula OU aviamento trocado = preco do cadastro de
    -- hoje (o da COR > 0, senao o geral - P-216 A); chave AUSENTE (tela antiga) com o mesmo aviamento = mantem o gravado.
    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_aviamento_itens it SET
        aviamento_id = (r->>'aviamento_id')::uuid,
        variante_aviamento_id = NULLIF(r->>'variante_aviamento_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false),
        preco = CASE
                  WHEN NULLIF(r->>'preco','') IS NOT NULL THEN (r->>'preco')::numeric
                  WHEN r ? 'preco' OR it.aviamento_id IS DISTINCT FROM (r->>'aviamento_id')::uuid
                    THEN (SELECT COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco)
                            FROM public.aviamentos a
                            LEFT JOIN public.variantes_aviamento va
                              ON va.id = NULLIF(r->>'variante_aviamento_id','')::uuid AND va.aviamento_id = a.id
                           WHERE a.id = (r->>'aviamento_id')::uuid)
                  ELSE it.preco
                END
      WHERE it.id = (r->>'id')::uuid AND it.oc_aviamento_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado, preco)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false),
           COALESCE(NULLIF(e->>'preco','')::numeric,
                    (SELECT COALESCE(CASE WHEN va.preco > 0 THEN va.preco END, a.preco)
                       FROM public.aviamentos a
                       LEFT JOIN public.variantes_aviamento va
                         ON va.id = NULLIF(e->>'variante_aviamento_id','')::uuid AND va.aviamento_id = a.id
                      WHERE a.id = (e->>'aviamento_id')::uuid))
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'aviamento_id' IS NOT NULL;

    -- update da OC (dispara o trigger já com itens corretos)
    UPDATE public.ocs_aviamento SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- Recalcula parcelas quando recebida (preserva pagas; o trigger não regenera se já existe).
  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'aviamento');
  END IF;

  RETURN v_oc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_etiqueta(_oc_id uuid, _oc jsonb, _itens jsonb)
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE='42501';
  END IF;
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_insumo.
  PERFORM public._seg_exige_pagina('entrada_oc_insumo');
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- itens só de insumo da loja (IDOR)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    JOIN public.etiquetas et ON et.id = (e->>'etiqueta_id')::uuid
    WHERE e->>'etiqueta_id' IS NOT NULL AND et.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Insumo de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_etiqueta
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int,1), _oc->>'nf_url',
       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado')
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'etiqueta_id' IS NOT NULL;

    IF v_recebido THEN UPDATE public.ocs_etiqueta SET status = 'recebido' WHERE id = v_oc_id; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL);
    DELETE FROM public.ocs_etiqueta_itens WHERE oc_etiqueta_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_etiqueta_itens SET
        etiqueta_id = (r->>'etiqueta_id')::uuid,
        variante_etiqueta_id = NULLIF(r->>'variante_etiqueta_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        preco = NULLIF(r->>'preco','')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean,false)
      WHERE id = (r->>'id')::uuid AND oc_etiqueta_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'etiqueta_id' IS NOT NULL;

    UPDATE public.ocs_etiqueta SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int,1),
      nf_url = _oc->>'nf_url',
      nfs = COALESCE(_oc->'nfs','[]'::jsonb),
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento','[]'::jsonb),
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  IF v_recebido THEN PERFORM public.recalcular_parcelas_etiqueta(v_oc_id); END IF;
  RETURN v_oc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_etiqueta(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE='42501';
  END IF;
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_insumo.
  PERFORM public._seg_exige_pagina('entrada_oc_insumo');
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev int;
    BEGIN
      SELECT rev INTO v_rev FROM public.ocs_etiqueta
        WHERE id = _oc_id AND (tenant_id = v_tenant OR public.is_super_admin())
        FOR UPDATE;
      IF v_rev IS DISTINCT FROM _rev_base THEN
        RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa'
          USING ERRCODE = 'P0409';
      END IF;
    END;
  END IF;

  -- itens só de insumo da loja (IDOR)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    JOIN public.etiquetas et ON et.id = (e->>'etiqueta_id')::uuid
    WHERE e->>'etiqueta_id' IS NOT NULL AND et.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Insumo de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_etiqueta
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int,1), _oc->>'nf_url',
       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado',
       NULLIF(_oc->>'data_nota_entrada', '')::date)
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'etiqueta_id' IS NOT NULL;

    IF v_recebido THEN UPDATE public.ocs_etiqueta SET status = 'recebido' WHERE id = v_oc_id; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL);
    DELETE FROM public.ocs_etiqueta_itens WHERE oc_etiqueta_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_etiqueta_itens SET
        etiqueta_id = (r->>'etiqueta_id')::uuid,
        variante_etiqueta_id = NULLIF(r->>'variante_etiqueta_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        preco = NULLIF(r->>'preco','')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean,false)
      WHERE id = (r->>'id')::uuid AND oc_etiqueta_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'etiqueta_id' IS NOT NULL;

    UPDATE public.ocs_etiqueta SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int,1),
      nf_url = _oc->>'nf_url',
      nfs = COALESCE(_oc->'nfs','[]'::jsonb),
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento','[]'::jsonb),
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  IF v_recebido THEN PERFORM public.recalcular_parcelas_etiqueta(v_oc_id); END IF;
  RETURN v_oc_id;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'aa64df90ef7daad675a69dbab7c1d585'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb)', 'a3f2413eba2e8c8e4c7f521285564d00'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', 'e71a9eb27389d429f9aeb3ac112e913b'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)', '484b694ecc31f4c897c435063d18310e'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '2981a2cb4ea80fd5bed5f6999244365b')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's6_oc_status_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (left(r.f, 8) <> 'public._') THEN
      RAISE EXCEPTION 's6_oc_status_down: pos-condicao falhou no EXECUTE de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
