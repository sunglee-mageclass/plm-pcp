-- Botoes Regerar REF / Regerar SKUs - migration 2 de 3: PARTE B, "Regerar REF" por card (secao 4. Codigos do Sheet do Planejamento).
-- So funcoes NOVAS (nenhuma existente e redefinida; fn_modelo_ref_auto e o motor de SKU ficam INTOCADOS - so sao LIDOS/CHAMADOS):
--   _regerar_ref_calcular(modelo)        calculo UNICO da REF nova (espelha o ramo "nao revelado" do fn_modelo_ref_auto: mesma sigla, mesmo
--                                        numero REAPROVEITADO do ref_auto atual, mesma montagem pelo Formato ATUAL; NUNCA chama
--                                        _modelo_ref_next_num). Devolve {pode, motivo, ref_atual, ref_auto_atual, ref_nova, tipo_ref, muda, irmaos}.
--   ref_regerar_previa(modelo)           wrapper SO LEITURA (GRANT authenticated): modulo criacao + ver Planejamento OU Desenvolvimento + loja.
--   _regerar_ref_card_core(...)          UMA transacao: trava + FOR UPDATE, recalcula, confere _ref_esperada (P0409) e a confirmacao do manual
--                                        (P0001), UPDATE ref/ref_auto e _aplicar_skus_modelo_core(regerar) NO MESMO passo (qualquer falha
--                                        desfaz tudo). EXECUTE revogado dos 3.
--   regerar_ref_card(...)                wrapper (GRANT authenticated): login + modulo criacao + _seg_exige_pagina('criacao_planejamento',
--                                        'criacao_desenvolvimento') ANTES de qualquer busca (sem oraculo) + loja do modelo.
-- Pula (RAISE ref_<motivo>): origem <> interno, card integravel/integrado (qualquer estado) ou ja exportado (helper da migration 1), REF
-- vazia ainda nao revelavel, sem sigla, sem numero reaproveitavel. Replicas/irmaos NAO sao tocados (so contados em `irmaos`).
-- RAISE 5xx so ASCII. Idempotente (CREATE OR REPLACE). Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261201110000_regerar_ref_card.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Banco ANTES do site. Volta: supabase/rollback/20261201110000_regerar_ref_card_down.sql
-- ============================== MD5 (guarda) ==============================
--   LIDOS (nao mudam - a migration RECUSA se divergirem):
--     public.fn_modelo_ref_auto()                                  6d68b20b0e5086a9a9dc0c87a8b42c69
--     public._aplicar_skus_modelo_core(uuid,jsonb,text,text)       858abf9fddb6e3ffb7bcc2b0d2c419d1
--   NOVAS (DEPOIS - guarda do _down):
--     public._regerar_ref_calcular(uuid)                           382e55959a003939511a4d680c3694ea
--     public.ref_regerar_previa(uuid)                              a79248834da577bc39201794069df617
--     public._regerar_ref_card_core(uuid,text,boolean,text)        c1f0262ac0af4f84520beb6a7ea0d233
--     public.regerar_ref_card(uuid,text,boolean,text)              81f788a22e55c8dd0bd9a85417e75c22
-- ==========================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
BEGIN
  IF to_regprocedure('public._regerar_pulo_integracao(uuid)') IS NULL THEN
    RAISE EXCEPTION 'regerar_ref: aplique 20261201100000 antes (helper de pulo ausente)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public.fn_modelo_ref_auto()'::regprocedure)) <> '6d68b20b0e5086a9a9dc0c87a8b42c69'
     OR md5(pg_get_functiondef('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)'::regprocedure)) <> '858abf9fddb6e3ffb7bcc2b0d2c419d1' THEN
    RAISE EXCEPTION 'regerar_ref: fn_modelo_ref_auto/motor de SKU com texto inesperado - o calculo espelhado perdeu a base; gere de novo'
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._regerar_ref_calcular(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
  v_pulo text;
  v_grupo text; v_cat text; v_sub text; v_grupo_id uuid;
  v_sigla text;
  v_digitos text;
  v_num bigint;
  v_nova text;
  v_tipo text;
  v_irmaos integer;
  v_base jsonb;
BEGIN
  SELECT mo.id, mo.tenant_id, mo.origem, mo.ref, mo.ref_auto, mo.categoria_principal_id, mo.subcategoria1_id,
         mo.status_desenvolvimento, mo.status_planejamento, mo.modelo_base_id
    INTO v_m FROM public.modelos mo WHERE mo.id = _modelo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;
  v_tipo := CASE WHEN coalesce(v_m.ref, '') = '' OR v_m.ref = v_m.ref_auto THEN 'automatica' ELSE 'manual' END;
  SELECT count(*)::integer INTO v_irmaos
    FROM public.modelos o
   WHERE o.tenant_id = v_m.tenant_id AND o.id <> v_m.id
     AND coalesce(o.modelo_base_id, o.id) = coalesce(v_m.modelo_base_id, v_m.id);
  v_base := jsonb_build_object('ref_atual', v_m.ref, 'ref_auto_atual', v_m.ref_auto, 'tipo_ref', v_tipo, 'irmaos', v_irmaos,
                               'ref_nova', NULL, 'muda', false);
  IF v_m.origem IS DISTINCT FROM 'interno' THEN
    RETURN v_base || jsonb_build_object('pode', false, 'motivo', 'nao_interno');
  END IF;
  v_pulo := public._regerar_pulo_integracao(_modelo_id);
  IF v_pulo IS NOT NULL THEN
    RETURN v_base || jsonb_build_object('pode', false,
             'motivo', CASE v_pulo WHEN 'integracao' THEN 'pulado_integracao' ELSE 'pulado_exportado' END);
  END IF;
  -- REF vazia so e regeravel se ja puder ser revelada (MESMO predicado do fn_modelo_ref_auto; reprovado no Planejamento nunca revela).
  IF coalesce(v_m.ref, '') = '' AND NOT (
       public._kanban_norm(v_m.status_planejamento) IS DISTINCT FROM 'reprovado'
       AND coalesce(public._ref_exibir_gate(v_m.tenant_id,
                      public._kanban_status_gate(v_m.tenant_id, v_m.id, v_m.status_desenvolvimento)), false)) THEN
    RETURN v_base || jsonb_build_object('pode', false, 'motivo', 'nao_revelada');
  END IF;
  -- Sigla: o MESMO calculo do fn_modelo_ref_auto (taxonomia configurada; senao o fallback historico por nomes).
  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
   WHERE c.id = v_m.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = v_m.subcategoria1_id;
  v_sigla := public._ref_montar_sigla(v_m.tenant_id, 'interno', v_grupo_id, v_m.categoria_principal_id, v_m.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;
  IF coalesce(v_sigla, '') = '' THEN
    RETURN v_base || jsonb_build_object('pode', false, 'motivo', 'sem_sigla');
  END IF;
  -- Numero: REAPROVEITA o bloco final de digitos do ref_auto atual. NUNCA chama o gerador de numero (nao consome numero).
  v_digitos := substring(coalesce(v_m.ref_auto, '') from '([0-9]+)$');
  IF v_digitos IS NOT NULL AND length(v_digitos) <= 18 THEN
    v_num := v_digitos::bigint;
  ELSIF public._ref_usa_numero(v_m.tenant_id) THEN
    RETURN v_base || jsonb_build_object('pode', false, 'motivo', 'sem_numero');
  ELSE
    v_num := NULL;  -- o Formato atual nao usa numero: _ref_juntar o descarta
  END IF;
  v_nova := public._ref_juntar(v_m.tenant_id, v_sigla, public._ref_num_fmt(v_m.tenant_id, v_num));
  RETURN v_base || jsonb_build_object('pode', true, 'motivo', NULL, 'ref_nova', v_nova,
                                      'muda', v_nova IS DISTINCT FROM v_m.ref);
END
$function$;

CREATE OR REPLACE FUNCTION public.ref_regerar_previa(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('criacao');
  IF NOT (public.user_can_view('criacao_planejamento') OR public.user_can_view('criacao_desenvolvimento')) THEN
    RAISE EXCEPTION 'sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento' USING ERRCODE = '42501';
  END IF;
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL OR (v_tenant IS DISTINCT FROM public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'sem_permissao_modelo: modelo fora da loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._regerar_ref_calcular(_modelo_id);
END
$function$;

CREATE OR REPLACE FUNCTION public._regerar_ref_card_core(_modelo_id uuid, _ref_esperada text, _confirma_manual boolean, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_calc jsonb;
  v_nova text;
  v_skus jsonb;
  v_rev integer;
BEGIN
  -- A MESMA trava dos gravadores de SKU (sku_modelo:<id>), depois a linha do card.
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));
  PERFORM 1 FROM public.modelos mo WHERE mo.id = _modelo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;
  v_calc := public._regerar_ref_calcular(_modelo_id);
  IF NOT (v_calc ->> 'pode')::boolean THEN
    RAISE EXCEPTION 'ref_%: nao da para regerar a REF deste card', v_calc ->> 'motivo' USING ERRCODE = 'P0001';
  END IF;
  v_nova := v_calc ->> 'ref_nova';
  IF _ref_esperada IS DISTINCT FROM v_nova THEN
    RAISE EXCEPTION 'previa_desatualizada: ref' USING ERRCODE = 'P0409';
  END IF;
  IF v_calc ->> 'tipo_ref' = 'manual' AND NOT coalesce(_confirma_manual, false) THEN
    RAISE EXCEPTION 'ref_manual_confirmar: a REF foi digitada a mao - confirme a troca' USING ERRCODE = 'P0001';
  END IF;
  -- Um UPDATE so de ref/ref_auto nao e "relevante" para o fn_modelo_ref_auto (retorna sem mexer); o rev sobe pelo trg_colab_rev.
  UPDATE public.modelos mo SET ref_auto = v_nova, ref = v_nova
   WHERE mo.id = _modelo_id AND (mo.ref IS DISTINCT FROM v_nova OR mo.ref_auto IS DISTINCT FROM v_nova);
  -- No MESMO passo: le a REF ja atualizada, confere a assinatura vista na previa e executa; P0409/trava desfaz o UPDATE acima.
  v_skus := public._aplicar_skus_modelo_core(_modelo_id, '[]'::jsonb, 'regerar', _assinatura);
  SELECT mo.rev INTO v_rev FROM public.modelos mo WHERE mo.id = _modelo_id;
  RETURN jsonb_build_object('ref', v_nova, 'ref_auto', v_nova, 'rev', v_rev,
           'skus', v_skus - 'criados' - 'atualizados' - 'removidos' - 'manuais' - 'conflitos',
           'criados', v_skus -> 'criados', 'atualizados', v_skus -> 'atualizados', 'removidos', v_skus -> 'removidos',
           'manuais', v_skus -> 'manuais', 'conflitos', v_skus -> 'conflitos');
END
$function$;

CREATE OR REPLACE FUNCTION public.regerar_ref_card(_modelo_id uuid, _ref_esperada text, _confirma_manual boolean, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('criacao');
  -- O gatilho de pagina de `modelos` NAO morde DEFINER: a permissao e conferida AQUI, antes de qualquer busca (sem oraculo).
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento');
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL OR (v_tenant IS DISTINCT FROM public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'sem_permissao_modelo: modelo fora da loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._regerar_ref_card_core(_modelo_id, _ref_esperada, _confirma_manual, _assinatura);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._regerar_ref_calcular(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._regerar_ref_card_core(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ref_regerar_previa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.regerar_ref_card(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_regerar_previa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regerar_ref_card(uuid, text, boolean, text) TO authenticated;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('_regerar_ref_calcular', '_regerar_ref_card_core')
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'regerar_ref: pos-condicao falhou - _core com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('ref_regerar_previa', 'regerar_ref_card')
                AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'regerar_ref: pos-condicao falhou - wrapper com EXECUTE para PUBLIC/anon' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
