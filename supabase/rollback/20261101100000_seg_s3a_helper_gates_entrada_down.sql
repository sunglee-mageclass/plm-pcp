-- Inverso de supabase/migrations/20261101100000_seg_s3a_helper_gates_entrada.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._seg_exige_pagina(text[]) (NOVA)
--     ANTES  ausente
--     DEPOIS 85eff0037e61fdecefb46154ac9479d2 (o _down NAO apaga: fica inerte; DROP no _down_drop)
--   public.recalcular_parcelas(uuid,text)
--     ANTES  aa6df4729aeaa0f7bd08a2c0833d8b52
--     DEPOIS eccb4e6c556be0cbc437b60bb480157f
--   public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)
--     ANTES  8167e804a4473e6032c74f8fa4be7a1c
--     DEPOIS 26c656169b6f9ef826e5b93932b15fe9
--   public.excluir_oc_tecido(uuid)
--     ANTES  70d7b13d004c8627bd51c0450f7bbff2
--     DEPOIS ebb2703d25f75956cb1a054e35be954d
--   public.desmarcar_recebimento_oc(text,uuid)
--     ANTES  6c3eb8d58ba58b8a91f08618479d6dce
--     DEPOIS c05f87ae8644aca380db8a200bec13b0
--   public.gerar_rolos_recebimento(uuid,jsonb)
--     ANTES  5fc8dfda7be61fc60bf316ca7d1ebfc7
--     DEPOIS 17654549c944436454a147509f4c113e
--   public.reverter_rolos_oc(uuid)
--     ANTES  4a3cd33ead95ae50c907ca8b3a7e7ade
--     DEPOIS d1f110cd6f340a1db878509f85f597d0
--   public.salvar_oc_aviamento(uuid,jsonb,jsonb)
--     ANTES  7b4dec050314b8b6dae77685297bd73e
--     DEPOIS 69531332f9e78256b042b989dbaffb87
--   public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)
--     ANTES  4ac66c2ed2407b61511a9c61f0eeaee6
--     DEPOIS ffb1f2c87801362f9f9895be07d71dc0
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb)
--     ANTES  598cce7a6f0006cdd111a1b1f7f39d58
--     DEPOIS 484b694ecc31f4c897c435063d18310e
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)
--     ANTES  4396c443f53c063b31159018bfa3914e
--     DEPOIS 2981a2cb4ea80fd5bed5f6999244365b
--   public.desmarcar_recebimento_oc_etiqueta(uuid)
--     ANTES  39a58a5518ec508830747ee70be58372
--     DEPOIS 0b4d22156cf5e2c1a9b4d69ae2a93838
--   public.salvar_oc_p_acabado(uuid,jsonb,jsonb)
--     ANTES  7829bb493f59c0ba821085721e65d4e1
--     DEPOIS 1eb3e4af0ff746aa6121cc00155d97f6
--   public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)
--     ANTES  e9b2d72d81433d07d11f5c4e2156628b
--     DEPOIS 521339232dfb8e20bcd66ad6b4afb93a
--   public.receber_oc_p_acabado(uuid,jsonb,jsonb)
--     ANTES  22b6747afe6e674b1e5d57be3edbea01
--     DEPOIS e342b8e3a8f6e38d267bed5095d3375d
--   public.excluir_oc_p_acabado(uuid)
--     ANTES  c68c7df441da35e63ac79fd23cbae6f8
--     DEPOIS 20bdb6b7e549a5823cc72d833ef745f5
--   public.vincular_oc_p_acabado(uuid,uuid)
--     ANTES  23e205dd4bb98636475f36cad83ff620
--     DEPOIS 625d02a8b991f997d283ffd2fda29aae
--   public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb)
--     ANTES  078132996c6d363b60fec6d6f46cae6d
--     DEPOIS a9c4f0c8452c740206f9579c7c8de929
--   public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)
--     ANTES  053325a7e2633055b4493c5a152f7ae3
--     DEPOIS 31a3dab4acfd24b2f1189c3bfd50b38a
--   public.receber_oc_importado(uuid,jsonb,jsonb)
--     ANTES  b2be2540cbbeb9d95613e484175881fd
--     DEPOIS 989c0b63698dba7476e504acdfd5e0f1
--   public.excluir_oc_importado(uuid)
--     ANTES  301b365ae998c8fe5919a457a585f2f6
--     DEPOIS 5928882b15caaf26add9e22cec9ecae8
--   public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)
--     ANTES  abccaaa6c4646457b50ed4cda8019c01
--     DEPOIS 5c51dc36660259c79d4c4d8b2327e2d8
--   public.receber_reposicao_troca(uuid,date,numeric)
--     ANTES  6f8f2b4d41362fa70f2304afbb85acc7
--     DEPOIS bc4dfc3397ef712b84b0bb5538e6f16a
--   public.cancelar_rolo(uuid)
--     ANTES  75cb967a4385371e61e53fa8cf54f222
--     DEPOIS 30e0bfc32675d3c231295216afa0df55
--   public.reabrir_rolo(uuid)
--     ANTES  24a5df49f898676c4b2e346e2b347c39
--     DEPOIS 1b678fc7e504eceb0268eeaa0c5c6acc
--   public.trocar_rolo(uuid,numeric)
--     ANTES  673d196185425e6946ad5c9b7f6dca20
--     DEPOIS 49f03b7e2ec5e03d3b817d6011a78185
--   public.criar_rolo(text,uuid,jsonb,uuid,text,text)
--     ANTES  5307ecd59ac9517a3b373e3807cd8a15
--     DEPOIS 0413b0c5de00268883ffff65d5298783
--   public.excluir_rolo(uuid)
--     ANTES  96212ced1ada5dc997bf9d2b2e049339
--     DEPOIS 8d8e60ef55c3e485d72bb627f042d83a
--   public.ajustar_rolo(uuid,numeric)
--     ANTES  bbc7057409103ee337446b8bb0876422
--     DEPOIS d7e148e99acc77141a8d96758c16165b
--   public.proximo_codigo_rolo(uuid)
--     ANTES  cbea062409bd8f964f19c40f491b31bd
--     DEPOIS cdcb4ab98c0439edf0695cf678d75532
--   public.remover_metragem_oc(uuid,numeric,text)
--     ANTES  acf07d551cd3ac434ae4262dbce4e6a6
--     DEPOIS e91c8a1dc9236aa8671ff1967d71e3f8
--   public.reverter_ajuste_estoque(uuid)
--     ANTES  a77f4ecd1112725e98c15374df99bf5e
--     DEPOIS e1d01408710ec42ed5cb859f4772fc78
--   public.salvar_os(text,uuid,jsonb,jsonb)
--     ANTES  b30d09c4f0dae41778f0c518f4071468
--     DEPOIS 965b8940c1353799a92523ad1e501b6a
--   public.baixar_os(text,uuid,jsonb)
--     ANTES  b18fa580d263ddeb09b27e06325eb6cc
--     DEPOIS 61e0036db0597f7aa8954c4c5ad813b9
--   public.desmarcar_os(text,uuid)
--     ANTES  de3fc7361120fe7eb7fbe68adf1f7619
--     DEPOIS d57d9ca2e7d4e977df262d0e8117dbb4
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / GRANT-REVOKE de função): nenhuma tabela de negócio, nada de
-- auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY.
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
      ('public.recalcular_parcelas(uuid,text)', 'aa6df4729aeaa0f7bd08a2c0833d8b52', 'eccb4e6c556be0cbc437b60bb480157f'),
      ('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)', '8167e804a4473e6032c74f8fa4be7a1c', '26c656169b6f9ef826e5b93932b15fe9'),
      ('public.excluir_oc_tecido(uuid)', '70d7b13d004c8627bd51c0450f7bbff2', 'ebb2703d25f75956cb1a054e35be954d'),
      ('public.desmarcar_recebimento_oc(text,uuid)', '6c3eb8d58ba58b8a91f08618479d6dce', 'c05f87ae8644aca380db8a200bec13b0'),
      ('public.gerar_rolos_recebimento(uuid,jsonb)', '5fc8dfda7be61fc60bf316ca7d1ebfc7', '17654549c944436454a147509f4c113e'),
      ('public.reverter_rolos_oc(uuid)', '4a3cd33ead95ae50c907ca8b3a7e7ade', 'd1f110cd6f340a1db878509f85f597d0'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb)', '7b4dec050314b8b6dae77685297bd73e', '69531332f9e78256b042b989dbaffb87'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)', '4ac66c2ed2407b61511a9c61f0eeaee6', 'ffb1f2c87801362f9f9895be07d71dc0'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)', '598cce7a6f0006cdd111a1b1f7f39d58', '484b694ecc31f4c897c435063d18310e'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '4396c443f53c063b31159018bfa3914e', '2981a2cb4ea80fd5bed5f6999244365b'),
      ('public.desmarcar_recebimento_oc_etiqueta(uuid)', '39a58a5518ec508830747ee70be58372', '0b4d22156cf5e2c1a9b4d69ae2a93838'),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb)', '7829bb493f59c0ba821085721e65d4e1', '1eb3e4af0ff746aa6121cc00155d97f6'),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)', 'e9b2d72d81433d07d11f5c4e2156628b', '521339232dfb8e20bcd66ad6b4afb93a'),
      ('public.receber_oc_p_acabado(uuid,jsonb,jsonb)', '22b6747afe6e674b1e5d57be3edbea01', 'e342b8e3a8f6e38d267bed5095d3375d'),
      ('public.excluir_oc_p_acabado(uuid)', 'c68c7df441da35e63ac79fd23cbae6f8', '20bdb6b7e549a5823cc72d833ef745f5'),
      ('public.vincular_oc_p_acabado(uuid,uuid)', '23e205dd4bb98636475f36cad83ff620', '625d02a8b991f997d283ffd2fda29aae'),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb)', '078132996c6d363b60fec6d6f46cae6d', 'a9c4f0c8452c740206f9579c7c8de929'),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)', '053325a7e2633055b4493c5a152f7ae3', '31a3dab4acfd24b2f1189c3bfd50b38a'),
      ('public.receber_oc_importado(uuid,jsonb,jsonb)', 'b2be2540cbbeb9d95613e484175881fd', '989c0b63698dba7476e504acdfd5e0f1'),
      ('public.excluir_oc_importado(uuid)', '301b365ae998c8fe5919a457a585f2f6', '5928882b15caaf26add9e22cec9ecae8'),
      ('public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)', 'abccaaa6c4646457b50ed4cda8019c01', '5c51dc36660259c79d4c4d8b2327e2d8'),
      ('public.receber_reposicao_troca(uuid,date,numeric)', '6f8f2b4d41362fa70f2304afbb85acc7', 'bc4dfc3397ef712b84b0bb5538e6f16a'),
      ('public.cancelar_rolo(uuid)', '75cb967a4385371e61e53fa8cf54f222', '30e0bfc32675d3c231295216afa0df55'),
      ('public.reabrir_rolo(uuid)', '24a5df49f898676c4b2e346e2b347c39', '1b678fc7e504eceb0268eeaa0c5c6acc'),
      ('public.trocar_rolo(uuid,numeric)', '673d196185425e6946ad5c9b7f6dca20', '49f03b7e2ec5e03d3b817d6011a78185'),
      ('public.criar_rolo(text,uuid,jsonb,uuid,text,text)', '5307ecd59ac9517a3b373e3807cd8a15', '0413b0c5de00268883ffff65d5298783'),
      ('public.excluir_rolo(uuid)', '96212ced1ada5dc997bf9d2b2e049339', '8d8e60ef55c3e485d72bb627f042d83a'),
      ('public.ajustar_rolo(uuid,numeric)', 'bbc7057409103ee337446b8bb0876422', 'd7e148e99acc77141a8d96758c16165b'),
      ('public.proximo_codigo_rolo(uuid)', 'cbea062409bd8f964f19c40f491b31bd', 'cdcb4ab98c0439edf0695cf678d75532'),
      ('public.remover_metragem_oc(uuid,numeric,text)', 'acf07d551cd3ac434ae4262dbce4e6a6', 'e91c8a1dc9236aa8671ff1967d71e3f8'),
      ('public.reverter_ajuste_estoque(uuid)', 'a77f4ecd1112725e98c15374df99bf5e', 'e1d01408710ec42ed5cb859f4772fc78'),
      ('public.salvar_os(text,uuid,jsonb,jsonb)', 'b30d09c4f0dae41778f0c518f4071468', '965b8940c1353799a92523ad1e501b6a'),
      ('public.baixar_os(text,uuid,jsonb)', 'b18fa580d263ddeb09b27e06325eb6cc', '61e0036db0597f7aa8954c4c5ad813b9'),
      ('public.desmarcar_os(text,uuid)', 'de3fc7361120fe7eb7fbe68adf1f7619', 'd57d9ca2e7d4e977df262d0e8117dbb4')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 's3a_gates_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  v := md5(pg_get_functiondef(to_regprocedure('public._seg_exige_pagina(text[])')));
  IF v IS NOT NULL AND v <> '85eff0037e61fdecefb46154ac9479d2' THEN
    RAISE EXCEPTION 's3a_gates_down: _seg_exige_pagina ja existe com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- o helper _seg_exige_pagina FICA (inerte: depois deste inverso nenhum wrapper o chama; os gatilhos de pagina ja estao neutros
-- se a volta foi LIFO). O DROP dele fica no _down_drop separado, opcional.
CREATE OR REPLACE FUNCTION public.recalcular_parcelas(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  -- [seg s2 C6] o botao Recalcular parcelas e do Financeiro: exige o modulo. As funcoes do servidor que refazem parcelas
  -- (alerta de tecido, reposicao de troca) chamam o _recalcular_parcelas_core direto e nao dependem do modulo.
  IF NOT public.tenant_module_enabled('financeiro') THEN
    RAISE EXCEPTION 'modulo_financeiro_desligado: o modulo Financeiro nao esta habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('tecido','aviamento','p_acabado','p_importado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento, p_acabado ou p_importado';
  END IF;
  IF _tipo = 'tecido' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_aviamento WHERE id = _oc_id;
  ELSIF _tipo = 'p_importado' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_importado WHERE id = _oc_id;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;
  RETURN public._recalcular_parcelas_core(_oc_id, _tipo);
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
  RETURN public._salvar_oc_tecido_core(_oc_id, _oc, _itens, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.excluir_oc_tecido(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._excluir_oc_tecido_core(_oc_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.desmarcar_recebimento_oc(_tipo text, _oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._desmarcar_recebimento_oc_core(_tipo, _oc_id);
END $function$;

CREATE OR REPLACE FUNCTION public.gerar_rolos_recebimento(_oc_id uuid, _rolos jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._gerar_rolos_recebimento_core(_oc_id, _rolos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverter_rolos_oc(_oc_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  RETURN public._reverter_rolos_oc_core(_oc_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_aviamento(_oc_id uuid, _oc jsonb, _itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_aviamento_core(_oc_id, _oc, _itens);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_aviamento(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_aviamento_core(_oc_id, _oc, _itens, _rev_base);
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

CREATE OR REPLACE FUNCTION public.desmarcar_recebimento_oc_etiqueta(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE='42501';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.ocs_etiqueta WHERE id = _oc_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'OC não encontrada'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;
  UPDATE public.ocs_etiqueta SET status = 'encomendado' WHERE id = _oc_id;
  DELETE FROM public.parcelas WHERE oc_etiqueta_id = _oc_id AND status <> 'pago' AND data_pagamento IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_p_acabado(_id uuid, _dados jsonb, _grade jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._salvar_oc_p_acabado_core(_id, _dados, _grade);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_p_acabado(_id uuid, _dados jsonb, _grade jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_p_acabado_core(_id, _dados, _grade, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.receber_oc_p_acabado(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._receber_oc_p_acabado_core(_oc_id, _dados, _grade);
end;
$function$;

CREATE OR REPLACE FUNCTION public.excluir_oc_p_acabado(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._excluir_oc_p_acabado_core(_oc_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vincular_oc_p_acabado(_oc_id uuid, _produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._vincular_oc_p_acabado_core(_oc_id, _produto_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_importado(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._salvar_oc_importado_core(_id, _dados, _grade, _etapas);
end $function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_importado(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_importado_core(_id, _dados, _grade, _etapas, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.receber_oc_importado(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._receber_oc_importado_core(_oc_id, _dados, _grade);
end $function$;

CREATE OR REPLACE FUNCTION public.excluir_oc_importado(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  perform public._excluir_oc_importado_core(_oc_id);
end $function$;

CREATE OR REPLACE FUNCTION public.aplicar_resolucao_alerta_tecido(_item_id uuid, _acao text, _rep_artigo_id uuid DEFAULT NULL::uuid, _rep_variante_id uuid DEFAULT NULL::uuid, _rep_metragem numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._aplicar_resolucao_alerta_tecido_core(_item_id, _acao, _rep_artigo_id, _rep_variante_id, _rep_metragem);
END $function$;

CREATE OR REPLACE FUNCTION public.receber_reposicao_troca(_original_item_id uuid, _data date, _metragem numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._receber_reposicao_troca_core(_original_item_id, _data, _metragem);
END $function$;

CREATE OR REPLACE FUNCTION public.cancelar_rolo(_rolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._cancelar_rolo_core(_rolo_id);
END $function$;

CREATE OR REPLACE FUNCTION public.reabrir_rolo(_rolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._reabrir_rolo_core(_rolo_id);
END $function$;

CREATE OR REPLACE FUNCTION public.trocar_rolo(_rolo_id uuid, _nova_metragem numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  RETURN public._trocar_rolo_core(_rolo_id, _nova_metragem);
END $function$;

CREATE OR REPLACE FUNCTION public.criar_rolo(_codigo text, _artigo_id uuid, _variantes jsonb, _origem_item_id uuid DEFAULT NULL::uuid, _rua text DEFAULT NULL::text, _prateleira text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._criar_rolo_core(_codigo, _artigo_id, _variantes, _origem_item_id, _rua, _prateleira);
END $function$;

CREATE OR REPLACE FUNCTION public.excluir_rolo(_rolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._excluir_rolo_core(_rolo_id);
END $function$;

CREATE OR REPLACE FUNCTION public.ajustar_rolo(_rolo_id uuid, _nova_qtd numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._ajustar_rolo_core(_rolo_id, _nova_qtd);
END $function$;

CREATE OR REPLACE FUNCTION public.proximo_codigo_rolo(_artigo_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text := '';
  v_palavras text[];
  v_sigla text := '';
  v_seq int;
BEGIN
  IF v_tenant IS NULL THEN RETURN ''; END IF;
  IF _artigo_id IS NOT NULL THEN
    SELECT UPPER(TRIM(COALESCE(a.nome, ''))) INTO v_nome FROM public.artigos a WHERE a.id = _artigo_id;
  END IF;
  -- Sigla: inicial das 2 primeiras palavras; se só 1 palavra, 2 primeiras letras dela.
  v_palavras := regexp_split_to_array(v_nome, '\s+');
  IF COALESCE(array_length(v_palavras, 1), 0) >= 2 AND v_palavras[2] <> '' THEN
    v_sigla := LEFT(v_palavras[1], 1) || LEFT(v_palavras[2], 1);
  ELSE
    v_sigla := LEFT(v_nome, 2);
  END IF;

  INSERT INTO public.rolo_counters (tenant_id, seq) VALUES (v_tenant, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET seq = public.rolo_counters.seq + 1
  RETURNING seq INTO v_seq;

  RETURN 'R' || v_sigla
         || to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYMMDD')
         || LPAD(v_seq::text, 10, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.remover_metragem_oc(_oc_tecido_item_id uuid, _metragem numeric, _motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._remover_metragem_oc_core(_oc_tecido_item_id, _metragem, _motivo);
END $function$;

CREATE OR REPLACE FUNCTION public.reverter_ajuste_estoque(_baixa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._reverter_ajuste_estoque_core(_baixa_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_os(_tipo text, _os_id uuid, _header jsonb, _itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_os uuid := _os_id; v_num int; v_ok boolean; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e WHERE NULLIF(e->>'itemId','') IS NOT NULL) THEN
    RAISE EXCEPTION 'Adicione ao menos um item à ordem de saída.';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';
  v_num := NULLIF(_header->>'numero', '')::int;

  IF v_os IS NULL THEN
    IF v_num IS NULL THEN
      EXECUTE format('SELECT COALESCE(MAX(numero),0)+1 FROM public.%I WHERE tenant_id=$1', v_htbl)
        INTO v_num USING v_tenant;
    END IF;
    EXECUTE format(
      'INSERT INTO public.%I (tenant_id,numero,responsavel,data_solicitacao,data_corte,destino_id,observacao,baixado,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,auth.uid()) RETURNING id', v_htbl)
      INTO v_os USING v_tenant, v_num, _header->>'responsavel',
        NULLIF(_header->>'data_solicitacao','')::date, NULLIF(_header->>'data_corte','')::date,
        NULLIF(_header->>'destino_id','')::uuid, _header->>'observacao';
  ELSE
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()) AND NOT baixado)', v_htbl)
      INTO v_ok USING v_os, v_tenant;
    IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada, de outra loja, ou já baixada'; END IF;
    EXECUTE format(
      'UPDATE public.%I SET numero=COALESCE($2,numero),responsavel=$3,data_solicitacao=$4,data_corte=$5,destino_id=$6,observacao=$7
       WHERE id=$1', v_htbl)
      USING v_os, v_num, _header->>'responsavel',
        NULLIF(_header->>'data_solicitacao','')::date, NULLIF(_header->>'data_corte','')::date,
        NULLIF(_header->>'destino_id','')::uuid, _header->>'observacao';
    EXECUTE format('DELETE FROM public.%I WHERE ordem_saida_id=$1', v_itbl) USING v_os;
  END IF;

  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
           WHERE NULLIF(e->>'itemId', '') IS NOT NULL
  LOOP
    -- FF#3: aviamento grava a VARIANTE (variante_aviamento_id); tecido segue por variante_tecido_id.
    IF _tipo = 'aviamento' THEN
      INSERT INTO public.ordens_saida_aviamento_itens
        (tenant_id, ordem_saida_id, aviamento_id, variante_aviamento_id, reserva, baixa)
      VALUES (v_tenant, v_os, (r->>'itemId')::uuid, NULLIF(r->>'varianteId','')::uuid,
              GREATEST(0, COALESCE(NULLIF(r->>'reserva','')::numeric, 0)), 0);
    ELSE
      INSERT INTO public.ordens_saida_tecido_itens
        (tenant_id, ordem_saida_id, variante_tecido_id, reserva, baixa)
      VALUES (v_tenant, v_os, (r->>'itemId')::uuid,
              GREATEST(0, COALESCE(NULLIF(r->>'reserva','')::numeric, 0)), 0);
    END IF;
  END LOOP;

  RETURN v_os;
END;
$function$;

CREATE OR REPLACE FUNCTION public.baixar_os(_tipo text, _os_id uuid, _utilizado jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_ok boolean; v_baixado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';

  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()))', v_htbl)
    INTO v_ok USING _os_id, v_tenant;
  IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada ou de outra loja'; END IF;

  -- Idempotência: OS já baixada não re-baixa (evita re-rodar a trava de saldo já defasada e
  -- sobrescrever os valores). Reverter é via desmarcar_os.
  EXECUTE format('SELECT COALESCE(baixado,false) FROM public.%I WHERE id=$1', v_htbl) INTO v_baixado USING _os_id;
  IF v_baixado THEN RAISE EXCEPTION 'OS já baixada — desmarque a baixa antes de baixar novamente.'; END IF;

  -- Trava de saldo (só aviamento): não deixa baixar acima do disponível (fisico da fonte
  -- canônica; a OS atual ainda não está baixada → não entra no fisico). FF#3: agora POR VARIANTE
  -- (aviamento × variante). Espelha o bucketing do _estoque_aviamento_core: item sem variante
  -- recai na variante ÚNICA do aviamento (quando há 1); com 2+ variantes o bucket "Sem variante"
  -- (NULL) tem fisico ~0 e barra — força escolher a variante.
  IF _tipo = 'aviamento' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.aviamento_id AS av,
               COALESCE(oi.variante_aviamento_id, s.var) AS var,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_aviamento_itens oi
        LEFT JOIN (
          SELECT aviamento_id, (array_agg(id ORDER BY created_at, id))[1] AS var
          FROM public.variantes_aviamento
          WHERE tenant_id = v_tenant
          GROUP BY aviamento_id HAVING count(*) = 1
        ) s ON s.aviamento_id = oi.aviamento_id
        WHERE oi.ordem_saida_id = _os_id AND oi.aviamento_id IS NOT NULL
        GROUP BY oi.aviamento_id, COALESCE(oi.variante_aviamento_id, s.var)
      ) g
      LEFT JOIN public._estoque_aviamento_core(v_tenant) ea
        ON ea.id = g.av AND ea.variante_id IS NOT DISTINCT FROM g.var
      WHERE g.usado > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de aviamento';
    END IF;
  ELSIF _tipo = 'tecido' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.variante_tecido_id AS k,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_tecido_itens oi
        WHERE oi.ordem_saida_id = _os_id AND oi.variante_tecido_id IS NOT NULL
        GROUP BY oi.variante_tecido_id
      ) g LEFT JOIN public._estoque_tecido_core(v_tenant) ea ON ea.variante_tecido_id = g.k
      WHERE g.usado > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de tecido';
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE public.%I oi SET baixa = GREATEST(0, COALESCE(NULLIF($2->>oi.id::text, '''')::numeric, oi.reserva, 0))
     WHERE oi.ordem_saida_id = $1', v_itbl)
    USING _os_id, _utilizado;
  EXECUTE format('UPDATE public.%I SET baixado = true WHERE id = $1', v_htbl) USING _os_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.desmarcar_os(_tipo text, _os_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';

  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()))', v_htbl)
    INTO v_ok USING _os_id, v_tenant;
  IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada ou de outra loja'; END IF;

  EXECUTE format('UPDATE public.%I SET baixa = 0 WHERE ordem_saida_id = $1', v_itbl) USING _os_id;
  EXECUTE format('UPDATE public.%I SET baixado = false WHERE id = $1', v_htbl) USING _os_id;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.recalcular_parcelas(uuid,text)', 'aa6df4729aeaa0f7bd08a2c0833d8b52', null),
      ('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)', '8167e804a4473e6032c74f8fa4be7a1c', null),
      ('public.excluir_oc_tecido(uuid)', '70d7b13d004c8627bd51c0450f7bbff2', null),
      ('public.desmarcar_recebimento_oc(text,uuid)', '6c3eb8d58ba58b8a91f08618479d6dce', null),
      ('public.gerar_rolos_recebimento(uuid,jsonb)', '5fc8dfda7be61fc60bf316ca7d1ebfc7', null),
      ('public.reverter_rolos_oc(uuid)', '4a3cd33ead95ae50c907ca8b3a7e7ade', null),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb)', '7b4dec050314b8b6dae77685297bd73e', null),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)', '4ac66c2ed2407b61511a9c61f0eeaee6', null),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb)', '598cce7a6f0006cdd111a1b1f7f39d58', null),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '4396c443f53c063b31159018bfa3914e', null),
      ('public.desmarcar_recebimento_oc_etiqueta(uuid)', '39a58a5518ec508830747ee70be58372', null),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb)', '7829bb493f59c0ba821085721e65d4e1', null),
      ('public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)', 'e9b2d72d81433d07d11f5c4e2156628b', null),
      ('public.receber_oc_p_acabado(uuid,jsonb,jsonb)', '22b6747afe6e674b1e5d57be3edbea01', null),
      ('public.excluir_oc_p_acabado(uuid)', 'c68c7df441da35e63ac79fd23cbae6f8', null),
      ('public.vincular_oc_p_acabado(uuid,uuid)', '23e205dd4bb98636475f36cad83ff620', null),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb)', '078132996c6d363b60fec6d6f46cae6d', null),
      ('public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)', '053325a7e2633055b4493c5a152f7ae3', null),
      ('public.receber_oc_importado(uuid,jsonb,jsonb)', 'b2be2540cbbeb9d95613e484175881fd', null),
      ('public.excluir_oc_importado(uuid)', '301b365ae998c8fe5919a457a585f2f6', null),
      ('public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)', 'abccaaa6c4646457b50ed4cda8019c01', null),
      ('public.receber_reposicao_troca(uuid,date,numeric)', '6f8f2b4d41362fa70f2304afbb85acc7', null),
      ('public.cancelar_rolo(uuid)', '75cb967a4385371e61e53fa8cf54f222', null),
      ('public.reabrir_rolo(uuid)', '24a5df49f898676c4b2e346e2b347c39', null),
      ('public.trocar_rolo(uuid,numeric)', '673d196185425e6946ad5c9b7f6dca20', null),
      ('public.criar_rolo(text,uuid,jsonb,uuid,text,text)', '5307ecd59ac9517a3b373e3807cd8a15', null),
      ('public.excluir_rolo(uuid)', '96212ced1ada5dc997bf9d2b2e049339', null),
      ('public.ajustar_rolo(uuid,numeric)', 'bbc7057409103ee337446b8bb0876422', null),
      ('public.proximo_codigo_rolo(uuid)', 'cbea062409bd8f964f19c40f491b31bd', null),
      ('public.remover_metragem_oc(uuid,numeric,text)', 'acf07d551cd3ac434ae4262dbce4e6a6', null),
      ('public.reverter_ajuste_estoque(uuid)', 'a77f4ecd1112725e98c15374df99bf5e', null),
      ('public.salvar_os(text,uuid,jsonb,jsonb)', 'b30d09c4f0dae41778f0c518f4071468', null),
      ('public.baixar_os(text,uuid,jsonb)', 'b18fa580d263ddeb09b27e06325eb6cc', null),
      ('public.desmarcar_os(text,uuid)', 'de3fc7361120fe7eb7fbe68adf1f7619', null)
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.a THEN
      RAISE EXCEPTION 's3a_gates_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.a USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
