-- Inverso de supabase/migrations/20261103100000_mod_gates_rpcs.sql — GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod1.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M1/M2, §3 T1, §13); desenho.md (+ RESPOSTAS DO DONO, P-253 A).
-- NEUTRO: devolve os 37 textos de ANTES (md5 conferido). Os 2 auxiliares FICAM (inertes: nenhum wrapper os chama);
-- o DROP deles e o _down_drop separado.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._exige_modulos(text[]) (NOVA)
--     ANTES  ausente
--     DEPOIS b1d4958f65df2c593366926e2b56903e (o _down NAO apaga)
--   public._tenant_modulo_ligado(uuid,text) (NOVA)
--     ANTES  ausente
--     DEPOIS 0c9655642d6b570f9adaf136bcaa09c7 (o _down NAO apaga)
--   public.dashboard_colecao(date,date,text,uuid,uuid)  [P4: dashboard]
--     ANTES  4e351a33a919a60139518606b50729c3
--     DEPOIS 86f966d799021ee7e94626688232a461
--   public.dashboard_custos(date,date,text,uuid,uuid)  [P4: dashboard]
--     ANTES  354c9259b9f5466a7a8187ee830bceee
--     DEPOIS a870d244f98872ff72af5646f3591c35
--   public.dashboard_estoque()  [P4: dashboard]
--     ANTES  6f51a812f2b074aa3051c87d08ce7072
--     DEPOIS 1087fa789e954206116ce64fe9ce196b
--   public.dashboard_estoque_parado()  [P4: dashboard]
--     ANTES  c1226d24a2a4f0ec0249fef277f9fe37
--     DEPOIS 51093e7cbe7ad04b59c6af36ebc41ad5
--   public.dashboard_financeiro(date,date)  [P4: dashboard + financeiro]
--     ANTES  4d2c7e64b3f00a2171ceec479a05bdc2
--     DEPOIS eed30fca0abc895917077709350b654e
--   public.dashboard_leadtime()  [P4: dashboard]
--     ANTES  20f167f5d4825b2dada65b45e1c35f99
--     DEPOIS 47bef54fa70d56072403d24dd801992f
--   public.dashboard_leadtime_itens(uuid,text,text)  [P4: dashboard]
--     ANTES  a685c48508eee5449811b49e675e7432
--     DEPOIS b30fe5ac56471bede81b160629a6e107
--   public.dashboard_producao(date,date,text,uuid)  [P4: dashboard]
--     ANTES  8280bd12907d89522a215512a03821b4
--     DEPOIS 045954826f9d0868d08f421ccad7230c
--   public.dashboard_producao_servicos(date,date,text,uuid,text)  [P4: dashboard]
--     ANTES  b9dcb31d44139d4844b61a260f1d3db8
--     DEPOIS ff82ccce3ed2131e19d5f84261a0d297
--   public.ranking_servicos(uuid)  [P4: dashboard]
--     ANTES  868b91ce94e0bf583981da912c80e199
--     DEPOIS 0783a03fa5786803a8764c42d8cacbf7
--   public.ranking_oficinas(uuid)  [P4: dashboard]
--     ANTES  e4ef4429db52408a8c998ce9f2da96b1
--     DEPOIS 89c09154e884af4091a23d471a8b40bd
--   public.baixar_estoque_tecido_corte(uuid,integer)  [P5: entrada_saida]
--     ANTES  9cac6689b615cc1eed1fa8de894dbb5a
--     DEPOIS 599d3e6fee1c6876aefdbec6777fbc4b
--   public.salvar_explosao_metragem(uuid,jsonb,integer)  [P5: entrada_saida]
--     ANTES  95fa0bdd1b1a5045781e2152edba4980
--     DEPOIS c113acb773c52f6d0b5e334e00cbc251
--   public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)  [P5: entrada_saida]
--     ANTES  e0f35d177abd29b05557f22837f9ef9c
--     DEPOIS 0cbf27161f527e91b13a1e625884ec3e
--   public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)  [P5: entrada_saida]
--     ANTES  9ba9b5dcb9917290db0b463dd12e7049
--     DEPOIS cbe72977377fe1d243e89aae65fdab74
--   public.voltar_modelo_desenvolvimento(uuid)  [P5: entrada_saida]
--     ANTES  f113c6d63fe95083b71238a21b0914ca
--     DEPOIS a4818dafcdb30ae78e9cb2e1f84feb59
--   public.reverter_corte_tecido(uuid)  [P5: entrada_saida]
--     ANTES  3828600c053a87149670e0cff9985f5e
--     DEPOIS 4d396d24df2de754981e39eac12a64ac
--   public.enviar_modelo_para_cad(uuid,text,text)  [P5: entrada_saida]
--     ANTES  52fa66fc058af40264f5536185bc7a9a
--     DEPOIS 55a928b741d40435535382ed9e03a5ec
--   public.salvar_plan_tecido(uuid,jsonb,integer)  [P7: otb]
--     ANTES  7b24a22b7a016ef433dfb9e1dc00c3d8
--     DEPOIS aa2d348e246d1f2c22a6605721a5d009
--   public.plan_tecido_criar_card(uuid,jsonb)  [P7: otb]
--     ANTES  425d69af538b519f91a19b1bc11d5175
--     DEPOIS 82f554c3324a9e439f31cce67a06882e
--   public.plan_tecido_criar_cards(uuid,jsonb)  [P7: otb]
--     ANTES  2dfc1a5a28a15f3509b33e3576b6984f
--     DEPOIS eaea2fbca8346b745364e2a5743ab9f7
--   public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)  [P7: otb]
--     ANTES  57583c7daf555eb7c177c1f20035b7cd
--     DEPOIS f4f62acfc6ea38575bbd6b0d12ed3d5e
--   public.aplicar_plan_tecido_grade(uuid,jsonb)  [P7: otb]
--     ANTES  303be61997e21cbf640bf7fbc994f353
--     DEPOIS 7ce9ffcaac3be443475c57c7a057a555
--   public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])  [P7: otb]
--     ANTES  b5e982478d5dd1613581cf3af7f2fe7a
--     DEPOIS 8f678d66e4f7b23c137127b93d3b8f93
--   public.plan_tecido_desfazer_pedido(uuid)  [P7: otb]
--     ANTES  04dd8db196ebc5b336b839d244442556
--     DEPOIS a67d323a344bf7d6a584ffd1ea245d5b
--   public.plan_tecido_set_oc_aplicada(uuid,uuid[])  [P7: otb]
--     ANTES  5421535a8208d23621c896d4ec5eafbd
--     DEPOIS 50058f125a3e645ff0911ef7b2f676b3
--   public.plan_tecido_set_paleta(uuid,jsonb)  [P7: otb]
--     ANTES  bcaab2b542b798108ed0c0671eb23957
--     DEPOIS ff68771281ad89efba2e3980f62e3090
--   public.plan_tecido_set_pedido_fotos(uuid,text,text[])  [P7: otb]
--     ANTES  65ec8a43da8c70b7fa5c3ddb75cb9742
--     DEPOIS e736c89010b7463fa4d3ec21e7cfd750
--   public.plan_tecido_set_referencia(uuid,text[])  [P7: otb]
--     ANTES  8dc362667b1fb750fb56f12a51cd4732
--     DEPOIS cd5e5f2a1c5582ae25d0189d0c758edc
--   public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])  [P7: otb]
--     ANTES  e192219b2dc68d736588031e83a5c015
--     DEPOIS 046c196c0f7f55c6e6fb2cae4a025326
--   public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)  [P7: otb]
--     ANTES  6197f52f1ce32913c34bee4cfbb145b7
--     DEPOIS 23575638593688bef607aa6d0f7c7bdf
--   public.criar_card_produto_acabado(uuid)  [P9: criacao]
--     ANTES  c6ef3b10eb543d5b3a78b5493ab44ab7
--     DEPOIS da33d745b9e723c92bd134b33680eccd
--   public.criar_cards_produto_acabado(uuid[])  [P9: criacao]
--     ANTES  26c9508a35f0a7f8df043c4104081db7
--     DEPOIS 89702cea78b3fd3ddc9c6d9ebc147456
--   public.criar_card_produto_importado(uuid)  [P9: criacao]
--     ANTES  322e5ad33fe1ab7a5d6bbb9b81fee8a3
--     DEPOIS 371dce1749a3fb8273b5304e529a1988
--   public.criar_cards_produto_importado(uuid[])  [P9: criacao]
--     ANTES  d63c1c9e0ec725ab722aaca02cbaba35
--     DEPOIS 9adb978a35cf1cef8d185eba0ad4f7d6
--   public.receber_oc_p_acabado(uuid,jsonb,jsonb)  [P9: criacao + producao]
--     ANTES  e342b8e3a8f6e38d267bed5095d3375d
--     DEPOIS 26a990be66562db249993796d6b29a2f
--   public.receber_oc_importado(uuid,jsonb,jsonb)  [P9: criacao + producao]
--     ANTES  989c0b63698dba7476e504acdfd5e0f1
--     DEPOIS 3011e589633f5e8f4c059a99bd1a7639
--   dependencias fixadas: public.tenant_module_enabled(text) = ddd46592f2ff7cdb352778c605ecd8a4; public._seg_exige_pagina(text[]) = 85eff0037e61fdecefb46154ac9479d2
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION / GRANT-REVOKE de funcao): nenhuma tabela, nada de auth/storage/realtime.
-- Sem DROP, sem CREATE TRIGGER/POLICY.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.dashboard_colecao(date,date,text,uuid,uuid)', '4e351a33a919a60139518606b50729c3', '86f966d799021ee7e94626688232a461'),
      ('public.dashboard_custos(date,date,text,uuid,uuid)', '354c9259b9f5466a7a8187ee830bceee', 'a870d244f98872ff72af5646f3591c35'),
      ('public.dashboard_estoque()', '6f51a812f2b074aa3051c87d08ce7072', '1087fa789e954206116ce64fe9ce196b'),
      ('public.dashboard_estoque_parado()', 'c1226d24a2a4f0ec0249fef277f9fe37', '51093e7cbe7ad04b59c6af36ebc41ad5'),
      ('public.dashboard_financeiro(date,date)', '4d2c7e64b3f00a2171ceec479a05bdc2', 'eed30fca0abc895917077709350b654e'),
      ('public.dashboard_leadtime()', '20f167f5d4825b2dada65b45e1c35f99', '47bef54fa70d56072403d24dd801992f'),
      ('public.dashboard_leadtime_itens(uuid,text,text)', 'a685c48508eee5449811b49e675e7432', 'b30fe5ac56471bede81b160629a6e107'),
      ('public.dashboard_producao(date,date,text,uuid)', '8280bd12907d89522a215512a03821b4', '045954826f9d0868d08f421ccad7230c'),
      ('public.dashboard_producao_servicos(date,date,text,uuid,text)', 'b9dcb31d44139d4844b61a260f1d3db8', 'ff82ccce3ed2131e19d5f84261a0d297'),
      ('public.ranking_servicos(uuid)', '868b91ce94e0bf583981da912c80e199', '0783a03fa5786803a8764c42d8cacbf7'),
      ('public.ranking_oficinas(uuid)', 'e4ef4429db52408a8c998ce9f2da96b1', '89c09154e884af4091a23d471a8b40bd'),
      ('public.baixar_estoque_tecido_corte(uuid,integer)', '9cac6689b615cc1eed1fa8de894dbb5a', '599d3e6fee1c6876aefdbec6777fbc4b'),
      ('public.salvar_explosao_metragem(uuid,jsonb,integer)', '95fa0bdd1b1a5045781e2152edba4980', 'c113acb773c52f6d0b5e334e00cbc251'),
      ('public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)', 'e0f35d177abd29b05557f22837f9ef9c', '0cbf27161f527e91b13a1e625884ec3e'),
      ('public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)', '9ba9b5dcb9917290db0b463dd12e7049', 'cbe72977377fe1d243e89aae65fdab74'),
      ('public.voltar_modelo_desenvolvimento(uuid)', 'f113c6d63fe95083b71238a21b0914ca', 'a4818dafcdb30ae78e9cb2e1f84feb59'),
      ('public.reverter_corte_tecido(uuid)', '3828600c053a87149670e0cff9985f5e', '4d396d24df2de754981e39eac12a64ac'),
      ('public.enviar_modelo_para_cad(uuid,text,text)', '52fa66fc058af40264f5536185bc7a9a', '55a928b741d40435535382ed9e03a5ec'),
      ('public.salvar_plan_tecido(uuid,jsonb,integer)', '7b24a22b7a016ef433dfb9e1dc00c3d8', 'aa2d348e246d1f2c22a6605721a5d009'),
      ('public.plan_tecido_criar_card(uuid,jsonb)', '425d69af538b519f91a19b1bc11d5175', '82f554c3324a9e439f31cce67a06882e'),
      ('public.plan_tecido_criar_cards(uuid,jsonb)', '2dfc1a5a28a15f3509b33e3576b6984f', 'eaea2fbca8346b745364e2a5743ab9f7'),
      ('public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)', '57583c7daf555eb7c177c1f20035b7cd', 'f4f62acfc6ea38575bbd6b0d12ed3d5e'),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)', '303be61997e21cbf640bf7fbc994f353', '7ce9ffcaac3be443475c57c7a057a555'),
      ('public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])', 'b5e982478d5dd1613581cf3af7f2fe7a', '8f678d66e4f7b23c137127b93d3b8f93'),
      ('public.plan_tecido_desfazer_pedido(uuid)', '04dd8db196ebc5b336b839d244442556', 'a67d323a344bf7d6a584ffd1ea245d5b'),
      ('public.plan_tecido_set_oc_aplicada(uuid,uuid[])', '5421535a8208d23621c896d4ec5eafbd', '50058f125a3e645ff0911ef7b2f676b3'),
      ('public.plan_tecido_set_paleta(uuid,jsonb)', 'bcaab2b542b798108ed0c0671eb23957', 'ff68771281ad89efba2e3980f62e3090'),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])', '65ec8a43da8c70b7fa5c3ddb75cb9742', 'e736c89010b7463fa4d3ec21e7cfd750'),
      ('public.plan_tecido_set_referencia(uuid,text[])', '8dc362667b1fb750fb56f12a51cd4732', 'cd5e5f2a1c5582ae25d0189d0c758edc'),
      ('public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])', 'e192219b2dc68d736588031e83a5c015', '046c196c0f7f55c6e6fb2cae4a025326'),
      ('public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)', '6197f52f1ce32913c34bee4cfbb145b7', '23575638593688bef607aa6d0f7c7bdf'),
      ('public.criar_card_produto_acabado(uuid)', 'c6ef3b10eb543d5b3a78b5493ab44ab7', 'da33d745b9e723c92bd134b33680eccd'),
      ('public.criar_cards_produto_acabado(uuid[])', '26c9508a35f0a7f8df043c4104081db7', '89702cea78b3fd3ddc9c6d9ebc147456'),
      ('public.criar_card_produto_importado(uuid)', '322e5ad33fe1ab7a5d6bbb9b81fee8a3', '371dce1749a3fb8273b5304e529a1988'),
      ('public.criar_cards_produto_importado(uuid[])', 'd63c1c9e0ec725ab722aaca02cbaba35', '9adb978a35cf1cef8d185eba0ad4f7d6'),
      ('public.receber_oc_p_acabado(uuid,jsonb,jsonb)', 'e342b8e3a8f6e38d267bed5095d3375d', '26a990be66562db249993796d6b29a2f'),
      ('public.receber_oc_importado(uuid,jsonb,jsonb)', '989c0b63698dba7476e504acdfd5e0f1', '3011e589633f5e8f4c059a99bd1a7639')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'mod1_gates_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.dashboard_colecao(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_estilista uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_colecao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_colecao' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_colecao_core(p_inicio, p_fim, p_colecao, p_estilista, p_linha);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_custos(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_categoria uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_custos') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_custos' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_custos_core(p_inicio, p_fim, p_colecao, p_categoria, p_linha);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_estoque()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_estoque') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_estoque' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_estoque_core();
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_estoque_parado()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_financeiro') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_estoque_parado' USING ERRCODE = '42501';
  END IF;
  RETURN public._dashboard_estoque_parado_core();
END
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_financeiro(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_financeiro') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_financeiro' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_financeiro_core(p_inicio, p_fim);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_leadtime()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_leadtime') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN public._dashboard_leadtime_core();
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_leadtime_itens(p_colecao uuid DEFAULT NULL::uuid, p_subcolecao text DEFAULT NULL::text, p_semana text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_leadtime') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN public._dashboard_leadtime_itens_core(p_colecao, p_subcolecao, p_semana);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_producao(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_producao' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_producao_core(p_inicio, p_fim, p_colecao, p_linha);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_producao_servicos(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_linha uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_producao' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_producao_servicos_core(p_inicio, p_fim, p_colecao, p_linha, p_categoria);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ranking_servicos(p_categoria uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN public._ranking_servicos_core(p_categoria);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ranking_oficinas(p_categoria_produto uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_producao' USING ERRCODE='42501';
  END IF;
  RETURN public._ranking_oficinas_core(p_categoria_produto);
END $function$;

CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid, _rev_base integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  RETURN public._baixar_estoque_tecido_corte_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_explosao_metragem(_cad_id uuid, _variantes jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      UPDATE public.cad_tecido_variantes ctv
         SET metragem_enviada  = COALESCE((it->>'metragem_enviada')::numeric, ctv.metragem_enviada),
             quantidade_folhas = COALESCE((it->>'quantidade_folhas')::numeric, ctv.quantidade_folhas)
       WHERE ctv.id = (it->>'id')::uuid
         AND ctv.cad_tecido_id IN (SELECT ct.id FROM public.cad_tecidos ct WHERE ct.cad_id = _cad_id);
    END LOOP;
  END IF;
  RETURN _cad_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.salvar_explosao_aviamento_separar(_cad_id uuid, _linhas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb; v_avi uuid; v_var uuid; v_val numeric; v_first uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_avi := NULLIF(it->>'aviamento_id','')::uuid;
      v_var := NULLIF(it->>'variante_aviamento_id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_separar')::numeric, 0), 0);
      IF v_avi IS NULL THEN CONTINUE; END IF;
      SELECT id INTO v_first FROM public.cad_aviamentos
       WHERE cad_id = _cad_id AND aviamento_id = v_avi AND variante_aviamento_id IS NOT DISTINCT FROM v_var
       ORDER BY numero NULLS LAST, id LIMIT 1;
      IF v_first IS NULL THEN CONTINUE; END IF;
      UPDATE public.cad_aviamentos
         SET quantidade_separar = CASE WHEN id = v_first THEN v_val ELSE 0 END
       WHERE cad_id = _cad_id AND aviamento_id = v_avi AND variante_aviamento_id IS NOT DISTINCT FROM v_var;
    END LOOP;
  END IF;
  RETURN _cad_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.salvar_explosao_etiqueta_enviar(_cad_id uuid, _linhas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; it jsonb; v_id uuid; v_val numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);
  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_id  := NULLIF(it->>'id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_enviar')::numeric, 0), 0);
      IF v_id IS NULL THEN CONTINUE; END IF;
      UPDATE public.cad_etiquetas SET quantidade_enviar = v_val WHERE id = v_id AND cad_id = _cad_id;
    END LOOP;
  END IF;
  RETURN _cad_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.voltar_modelo_desenvolvimento(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_explosao_antes text;  -- [seg s1 M2]
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criação não habilitado' using errcode = '42501';
  end if;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');

  -- Verifica que o modelo pertence ao tenant do usuário (ou é super_admin).
  if not exists (
    select 1 from public.modelos
    where id = _modelo_id
      and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Modelo não encontrado' using errcode = 'P0002';
  end if;

  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] Voltar ao Desenvolvimento (Explosao)
  PERFORM set_config('app.explosao_sistema', 'on', true);
  update public.modelos
    set enviado_cad = false
  where id = _modelo_id;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverter_corte_tecido(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_terceirizados OU producao_explosao.
  PERFORM public._seg_exige_pagina('producao_terceirizados', 'producao_explosao');
  PERFORM public._reverter_corte_tecido_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.enviar_modelo_para_cad(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  RETURN public._enviar_modelo_para_cad_core(_modelo_id, _observacoes_tecnicas, _ficha_medida_url);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_plan_tecido(_colecao_id uuid, _arvore jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado para esta loja' using errcode='42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._salvar_plan_tecido_core(_colecao_id, _arvore, _rev_base);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_criar_card(_colecao_id uuid, _slot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_criar_card_core(public.get_user_tenant_id(), _colecao_id, _slot);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_criar_cards(_colecao_id uuid, _slots jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_criar_cards_core(public.get_user_tenant_id(), _colecao_id, _slots);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_aplicar_ao_modelo(_slot_id uuid, _materiais jsonb, _confirmar_sobrescrita boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_aplicar_ao_modelo_core(_slot_id, _materiais, _confirmar_sobrescrita);
end $function$;

CREATE OR REPLACE FUNCTION public.aplicar_plan_tecido_grade(_slot_id uuid, _variantes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado para esta loja' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._aplicar_plan_tecido_grade_core(_slot_id, _variantes);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_fazer_pedido(_colecao_id uuid, _pedidos jsonb, _slot_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  if not public.tenant_module_enabled('entrada_saida') then raise exception 'Módulo entrada_saida não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_fazer_pedido_core(public.get_user_tenant_id(), _colecao_id, _pedidos, _slot_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_desfazer_pedido(_colecao_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] (C8) o mesmo modulo do fazer pedido.
  if not public.tenant_module_enabled('entrada_saida') then raise exception 'Módulo entrada_saida não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_desfazer_pedido_core(public.get_user_tenant_id(), _colecao_id);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_set_oc_aplicada(_colecao_id uuid, _oc_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_set_oc_aplicada_core(public.get_user_tenant_id(), _colecao_id, _oc_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_set_paleta(_colecao_id uuid, _itens jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_set_paleta_core(public.get_user_tenant_id(), _colecao_id, _itens);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_set_pedido_fotos(_colecao_id uuid, _nome_tecido text, _paths text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  perform public._plan_tecido_set_pedido_fotos_core(public.get_user_tenant_id(), _colecao_id, _nome_tecido, _paths);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_set_referencia(_modelo_id uuid, _paths text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  perform public._plan_tecido_set_referencia_core(public.get_user_tenant_id(), _modelo_id, _paths);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_set_slot_oc(_colecao_id uuid, _slot_id uuid, _oc_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._plan_tecido_set_slot_oc_core(public.get_user_tenant_id(), _colecao_id, _slot_id, _oc_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.replicar_cards_plan_tecido(_destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid;
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo de Criação não está ativo.' using errcode = '42501';
  end if;
  v_tenant := public.get_user_tenant_id();
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  return public._replicar_cards_plan_tecido_core(v_tenant, _destino_colecao_id, _destino_subcolecao_id, _modelo_ids, _rev_base);
end $function$;

CREATE OR REPLACE FUNCTION public.criar_card_produto_acabado(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_acabado.
  PERFORM public._seg_exige_pagina('criacao_produto_acabado');
  return public._criar_card_produto_acabado_core(_produto_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_cards_produto_acabado(_produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não está ativo para esta loja.' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_acabado.
  PERFORM public._seg_exige_pagina('criacao_produto_acabado');
  return public._criar_cards_produto_acabado_lote_core(_produto_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.criar_card_produto_importado(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_importado.
  PERFORM public._seg_exige_pagina('criacao_produto_importado');
  return public._criar_card_produto_importado_core(_produto_id);
end $function$;

CREATE OR REPLACE FUNCTION public.criar_cards_produto_importado(_produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  -- [seg s3d] permissao de PAGINA no servidor (Reforco de seguranca S3d, P-231 = D2 A): exige EDITAR criacao_produto_importado.
  PERFORM public._seg_exige_pagina('criacao_produto_importado');
  return public._criar_cards_produto_importado_lote_core(_produto_ids);
end $function$;

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
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_p_acabado.
  PERFORM public._seg_exige_pagina('entrada_oc_p_acabado');
  return public._receber_oc_p_acabado_core(_oc_id, _dados, _grade);
end;
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
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_p_importado.
  PERFORM public._seg_exige_pagina('entrada_oc_p_importado');
  return public._receber_oc_importado_core(_oc_id, _dados, _grade);
end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.dashboard_colecao(date,date,text,uuid,uuid)', '4e351a33a919a60139518606b50729c3', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_custos(date,date,text,uuid,uuid)', '354c9259b9f5466a7a8187ee830bceee', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_estoque()', '6f51a812f2b074aa3051c87d08ce7072', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_estoque_parado()', 'c1226d24a2a4f0ec0249fef277f9fe37', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_financeiro(date,date)', '4d2c7e64b3f00a2171ceec479a05bdc2', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_leadtime()', '20f167f5d4825b2dada65b45e1c35f99', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_leadtime_itens(uuid,text,text)', 'a685c48508eee5449811b49e675e7432', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_producao(date,date,text,uuid)', '8280bd12907d89522a215512a03821b4', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.dashboard_producao_servicos(date,date,text,uuid,text)', 'b9dcb31d44139d4844b61a260f1d3db8', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.ranking_servicos(uuid)', '868b91ce94e0bf583981da912c80e199', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.ranking_oficinas(uuid)', 'e4ef4429db52408a8c998ce9f2da96b1', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.baixar_estoque_tecido_corte(uuid,integer)', '9cac6689b615cc1eed1fa8de894dbb5a', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.salvar_explosao_metragem(uuid,jsonb,integer)', '95fa0bdd1b1a5045781e2152edba4980', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)', 'e0f35d177abd29b05557f22837f9ef9c', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)', '9ba9b5dcb9917290db0b463dd12e7049', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.voltar_modelo_desenvolvimento(uuid)', 'f113c6d63fe95083b71238a21b0914ca', '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', false),
      ('public.reverter_corte_tecido(uuid)', '3828600c053a87149670e0cff9985f5e', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.enviar_modelo_para_cad(uuid,text,text)', '52fa66fc058af40264f5536185bc7a9a', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.salvar_plan_tecido(uuid,jsonb,integer)', '7b24a22b7a016ef433dfb9e1dc00c3d8', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_criar_card(uuid,jsonb)', '425d69af538b519f91a19b1bc11d5175', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_criar_cards(uuid,jsonb)', '2dfc1a5a28a15f3509b33e3576b6984f', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)', '57583c7daf555eb7c177c1f20035b7cd', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)', '303be61997e21cbf640bf7fbc994f353', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])', 'b5e982478d5dd1613581cf3af7f2fe7a', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_desfazer_pedido(uuid)', '04dd8db196ebc5b336b839d244442556', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_set_oc_aplicada(uuid,uuid[])', '5421535a8208d23621c896d4ec5eafbd', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_set_paleta(uuid,jsonb)', 'bcaab2b542b798108ed0c0671eb23957', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])', '65ec8a43da8c70b7fa5c3ddb75cb9742', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_set_referencia(uuid,text[])', '8dc362667b1fb750fb56f12a51cd4732', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])', 'e192219b2dc68d736588031e83a5c015', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)', '6197f52f1ce32913c34bee4cfbb145b7', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.criar_card_produto_acabado(uuid)', 'c6ef3b10eb543d5b3a78b5493ab44ab7', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.criar_cards_produto_acabado(uuid[])', '26c9508a35f0a7f8df043c4104081db7', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.criar_card_produto_importado(uuid)', '322e5ad33fe1ab7a5d6bbb9b81fee8a3', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.criar_cards_produto_importado(uuid[])', 'd63c1c9e0ec725ab722aaca02cbaba35', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.receber_oc_p_acabado(uuid,jsonb,jsonb)', 'e342b8e3a8f6e38d267bed5095d3375d', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true),
      ('public.receber_oc_importado(uuid,jsonb,jsonb)', '989c0b63698dba7476e504acdfd5e0f1', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true)
    ) AS x(f, m, acl, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod1_gates_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND p.proconfig = ARRAY['search_path=public'])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'mod1_gates_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
