-- Inverso de supabase/migrations/20261101190000_seg_s3d_gates_planejamento.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3d.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.lancar_modelo(uuid,date,boolean)
--     ANTES  bc970584aef39ac8d5258b33c9cd7061
--     DEPOIS efe52aaad9a1e6055d758cf93e1950d5
--   public.conjunto_adicionar(uuid,uuid)
--     ANTES  2a50e68d81dc082db7f614a7a6a9b45d
--     DEPOIS 6d64744f031fe3f1bb91b108dde59b92
--   public.conjunto_remover(uuid)
--     ANTES  cc26b50c101a0a20c2436d49356015dc
--     DEPOIS 6cc0cb5557d7947228a54a1875ecbdda
--   public.salvar_grade_revenda(uuid,jsonb,integer)
--     ANTES  229622b44c073a14e1fa4e2eed21650f
--     DEPOIS c994305f2f9b4045a7631f4835f75602
--   public.salvar_produto_acabado(uuid,jsonb,jsonb)
--     ANTES  2fede16942ba6253ba6ad7bb65a38b18
--     DEPOIS b5c221a6ed46d43da732e411d523dd98
--   public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)
--     ANTES  9a94559fb80bc83722c0a3bf889c4b1b
--     DEPOIS 0c49981e9b459662cc2c6eda97de66d1
--   public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)
--     ANTES  c685d28c0d7b2dd74b0b4f3d5c4459e9
--     DEPOIS 6fa4c5eeb72d6464d4b89a4027613c63
--   public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)
--     ANTES  d64cbee1b0ad8722bdde2ff86d979f9e
--     DEPOIS 22232a0b47eb0a23e3b464029fc84bbe
--   public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)
--     ANTES  680d6d7fede3d2db47258396845f8fa7
--     DEPOIS 815583deca5487c3c7b450d5e6db1bfc
--   public.salvar_precos_fixo_produto_importado(uuid,boolean,numeric,boolean,numeric)
--     ANTES  e5432858604e33a2dd785fc864ad89d5
--     DEPOIS a277b0dcc67cacf0658ba771cc8d87a7
--   public.salvar_markups_produto_acabado(uuid,numeric,numeric)
--     ANTES  acce9dfcf91dedac5c568ad8a2382885
--     DEPOIS 1f266f1908cf4918b4a0a9d868565f92
--   public.criar_card_produto_acabado(uuid)
--     ANTES  0264cdac0549b0a6bfd7d5bf92e90f38
--     DEPOIS c6ef3b10eb543d5b3a78b5493ab44ab7
--   public.criar_cards_produto_acabado(uuid[])
--     ANTES  83fd36fafdd68dae108933257fd84b0c
--     DEPOIS 26c9508a35f0a7f8df043c4104081db7
--   public.replicar_produtos_acabados(uuid,uuid,uuid[])
--     ANTES  d43b226864f0c5a12a345440910d0fdd
--     DEPOIS e7f84ef690b8df27df70259684d7866f
--   public.limpar_produto_acabado(uuid)
--     ANTES  964d18b0c9730ad21a5b6d9a9a03ee08
--     DEPOIS 7317c0647ad53365216626974a01da52
--   public.excluir_produto_acabado(uuid)
--     ANTES  a791e603148b35732f212aa1ecc1b3d4
--     DEPOIS da21a97a40a1c275843b5ddb060ee9c5
--   public.aplicar_produto_ao_modelo(uuid)
--     ANTES  c6c9994f1a00edee787b4125fc2bb2ef
--     DEPOIS 37767f8e85d765e77d65aef5502fec0f
--   public.criar_card_produto_importado(uuid)
--     ANTES  7546855157595eff70ac9f77790c994d
--     DEPOIS 322e5ad33fe1ab7a5d6bbb9b81fee8a3
--   public.criar_cards_produto_importado(uuid[])
--     ANTES  105ccfe7874f39b4031e38db4706ad02
--     DEPOIS d63c1c9e0ec725ab722aaca02cbaba35
--   public.replicar_produtos_importados(uuid,uuid,uuid[])
--     ANTES  778443bdba406b32da722bc1ea8dca77
--     DEPOIS 5a721131e7c2bcebd0fabcdc91d1a059
--   public.limpar_produto_importado(uuid)
--     ANTES  814f7c172ff20a59346c1a0a2097c158
--     DEPOIS 9ae5447e55cbbc0125e5fa5d61bb4832
--   public.excluir_produto_importado(uuid)
--     ANTES  ecffacb8aac6179dfca1ad59b070e51e
--     DEPOIS 850bb75f225e869006e874813edb61be
--   public.importar_modelo_linha(jsonb,jsonb)
--     ANTES  d115a79214c47214918dfa7136c22b72
--     DEPOIS db0c3dcbd90ded80d210b96747e01cb1
--   public.importar_produto_linha(jsonb,jsonb,text)
--     ANTES  fd00ccb80d28a79fed1f0b021e46e07f
--     DEPOIS ab10e6d4b3716634158e7b4d2983f438
--   public.integracao_salvar(jsonb,jsonb)
--     ANTES  18e1ecfc6d9856bad902e5c6bc9aaef3
--     DEPOIS 0ffc0fa156efe213bf8fdcbb372dc52d
--   public.salvar_plan_tecido(uuid,jsonb,integer)
--     ANTES  50302aae4851bcd710ee7facec5ebc03
--     DEPOIS 7b24a22b7a016ef433dfb9e1dc00c3d8
--   public._salvar_plan_tecido_core(uuid,jsonb,integer)
--     ANTES  81a3606444a2cf68ee376937009b9bad
--     DEPOIS 9a5035ff6f73551f3b6b2c2890fc615a
--   public.plan_tecido_criar_cards(uuid,jsonb)
--     ANTES  88c22ce40dc15f88e08af185e23fbc08
--     DEPOIS 2dfc1a5a28a15f3509b33e3576b6984f
--   public.plan_tecido_criar_card(uuid,jsonb)
--     ANTES  a2a4bb5de9793afb2711b50bef4970f7
--     DEPOIS 425d69af538b519f91a19b1bc11d5175
--   public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)
--     ANTES  25077223a646fdb8fd5db03ad65b0fc4
--     DEPOIS 57583c7daf555eb7c177c1f20035b7cd
--   public.aplicar_plan_tecido_grade(uuid,jsonb)
--     ANTES  347219fb550ea1c342637ded5a80fa32
--     DEPOIS 303be61997e21cbf640bf7fbc994f353
--   public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])
--     ANTES  48582c67c272cb30e4c6931f5f885e90
--     DEPOIS b5e982478d5dd1613581cf3af7f2fe7a
--   public.plan_tecido_desfazer_pedido(uuid)
--     ANTES  7df69a65ea9b64db4c8ca4c36c20e4ed
--     DEPOIS 04dd8db196ebc5b336b839d244442556
--   public.plan_tecido_set_oc_aplicada(uuid,uuid[])
--     ANTES  71859c9c1004bf2ef43b1e610fed7bb9
--     DEPOIS 5421535a8208d23621c896d4ec5eafbd
--   public.plan_tecido_set_paleta(uuid,jsonb)
--     ANTES  a26ae3008da0bf65acfd318f6cc3d2ae
--     DEPOIS bcaab2b542b798108ed0c0671eb23957
--   public.plan_tecido_set_pedido_fotos(uuid,text,text[])
--     ANTES  a15f8a31b4b36244d84e043931e1fdf2
--     DEPOIS 65ec8a43da8c70b7fa5c3ddb75cb9742
--   public.plan_tecido_set_referencia(uuid,text[])
--     ANTES  307e56cdfb8945eb009d0834bd2f6843
--     DEPOIS 8dc362667b1fb750fb56f12a51cd4732
--   public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])
--     ANTES  0f7d3e3bec86a5dee9ddb77551e086cb
--     DEPOIS e192219b2dc68d736588031e83a5c015
--   public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)
--     ANTES  a8172b9ffa18cb84e2db24beeb51eb41
--     DEPOIS 6197f52f1ce32913c34bee4cfbb145b7
--   public.salvar_colecao_mix(uuid,uuid,text,text)
--     ANTES  b3c12a28bec8c7646f82c739c4b55055
--     DEPOIS 9c1ded3dc7f51977020f72e7aabb026e
--   public.excluir_colecao_mix(uuid)
--     ANTES  d1131b0ddf792d87e92ea7db0ca89e2c
--     DEPOIS bded4fc594cd5a5dd026ed602ca95afc
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION): nenhuma tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

-- excluir_colecao_mix volta a LANGUAGE sql: sem validar o corpo (como o pg_dump) a volta não pega RowExclusive em colecao_mixes.
SET LOCAL check_function_bodies = off;

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.lancar_modelo(uuid,date,boolean)', 'bc970584aef39ac8d5258b33c9cd7061', 'efe52aaad9a1e6055d758cf93e1950d5'),
      ('public.conjunto_adicionar(uuid,uuid)', '2a50e68d81dc082db7f614a7a6a9b45d', '6d64744f031fe3f1bb91b108dde59b92'),
      ('public.conjunto_remover(uuid)', 'cc26b50c101a0a20c2436d49356015dc', '6cc0cb5557d7947228a54a1875ecbdda'),
      ('public.salvar_grade_revenda(uuid,jsonb,integer)', '229622b44c073a14e1fa4e2eed21650f', 'c994305f2f9b4045a7631f4835f75602'),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb)', '2fede16942ba6253ba6ad7bb65a38b18', 'b5c221a6ed46d43da732e411d523dd98'),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)', '9a94559fb80bc83722c0a3bf889c4b1b', '0c49981e9b459662cc2c6eda97de66d1'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)', 'c685d28c0d7b2dd74b0b4f3d5c4459e9', '6fa4c5eeb72d6464d4b89a4027613c63'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)', 'd64cbee1b0ad8722bdde2ff86d979f9e', '22232a0b47eb0a23e3b464029fc84bbe'),
      ('public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)', '680d6d7fede3d2db47258396845f8fa7', '815583deca5487c3c7b450d5e6db1bfc'),
      ('public.salvar_precos_fixo_produto_importado(uuid,boolean,numeric,boolean,numeric)', 'e5432858604e33a2dd785fc864ad89d5', 'a277b0dcc67cacf0658ba771cc8d87a7'),
      ('public.salvar_markups_produto_acabado(uuid,numeric,numeric)', 'acce9dfcf91dedac5c568ad8a2382885', '1f266f1908cf4918b4a0a9d868565f92'),
      ('public.criar_card_produto_acabado(uuid)', '0264cdac0549b0a6bfd7d5bf92e90f38', 'c6ef3b10eb543d5b3a78b5493ab44ab7'),
      ('public.criar_cards_produto_acabado(uuid[])', '83fd36fafdd68dae108933257fd84b0c', '26c9508a35f0a7f8df043c4104081db7'),
      ('public.replicar_produtos_acabados(uuid,uuid,uuid[])', 'd43b226864f0c5a12a345440910d0fdd', 'e7f84ef690b8df27df70259684d7866f'),
      ('public.limpar_produto_acabado(uuid)', '964d18b0c9730ad21a5b6d9a9a03ee08', '7317c0647ad53365216626974a01da52'),
      ('public.excluir_produto_acabado(uuid)', 'a791e603148b35732f212aa1ecc1b3d4', 'da21a97a40a1c275843b5ddb060ee9c5'),
      ('public.aplicar_produto_ao_modelo(uuid)', 'c6c9994f1a00edee787b4125fc2bb2ef', '37767f8e85d765e77d65aef5502fec0f'),
      ('public.criar_card_produto_importado(uuid)', '7546855157595eff70ac9f77790c994d', '322e5ad33fe1ab7a5d6bbb9b81fee8a3'),
      ('public.criar_cards_produto_importado(uuid[])', '105ccfe7874f39b4031e38db4706ad02', 'd63c1c9e0ec725ab722aaca02cbaba35'),
      ('public.replicar_produtos_importados(uuid,uuid,uuid[])', '778443bdba406b32da722bc1ea8dca77', '5a721131e7c2bcebd0fabcdc91d1a059'),
      ('public.limpar_produto_importado(uuid)', '814f7c172ff20a59346c1a0a2097c158', '9ae5447e55cbbc0125e5fa5d61bb4832'),
      ('public.excluir_produto_importado(uuid)', 'ecffacb8aac6179dfca1ad59b070e51e', '850bb75f225e869006e874813edb61be'),
      ('public.importar_modelo_linha(jsonb,jsonb)', 'd115a79214c47214918dfa7136c22b72', 'db0c3dcbd90ded80d210b96747e01cb1'),
      ('public.importar_produto_linha(jsonb,jsonb,text)', 'fd00ccb80d28a79fed1f0b021e46e07f', 'ab10e6d4b3716634158e7b4d2983f438'),
      ('public.integracao_salvar(jsonb,jsonb)', '18e1ecfc6d9856bad902e5c6bc9aaef3', '0ffc0fa156efe213bf8fdcbb372dc52d'),
      ('public.salvar_plan_tecido(uuid,jsonb,integer)', '50302aae4851bcd710ee7facec5ebc03', '7b24a22b7a016ef433dfb9e1dc00c3d8'),
      ('public._salvar_plan_tecido_core(uuid,jsonb,integer)', '81a3606444a2cf68ee376937009b9bad', '9a5035ff6f73551f3b6b2c2890fc615a'),
      ('public.plan_tecido_criar_cards(uuid,jsonb)', '88c22ce40dc15f88e08af185e23fbc08', '2dfc1a5a28a15f3509b33e3576b6984f'),
      ('public.plan_tecido_criar_card(uuid,jsonb)', 'a2a4bb5de9793afb2711b50bef4970f7', '425d69af538b519f91a19b1bc11d5175'),
      ('public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)', '25077223a646fdb8fd5db03ad65b0fc4', '57583c7daf555eb7c177c1f20035b7cd'),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)', '347219fb550ea1c342637ded5a80fa32', '303be61997e21cbf640bf7fbc994f353'),
      ('public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])', '48582c67c272cb30e4c6931f5f885e90', 'b5e982478d5dd1613581cf3af7f2fe7a'),
      ('public.plan_tecido_desfazer_pedido(uuid)', '7df69a65ea9b64db4c8ca4c36c20e4ed', '04dd8db196ebc5b336b839d244442556'),
      ('public.plan_tecido_set_oc_aplicada(uuid,uuid[])', '71859c9c1004bf2ef43b1e610fed7bb9', '5421535a8208d23621c896d4ec5eafbd'),
      ('public.plan_tecido_set_paleta(uuid,jsonb)', 'a26ae3008da0bf65acfd318f6cc3d2ae', 'bcaab2b542b798108ed0c0671eb23957'),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])', 'a15f8a31b4b36244d84e043931e1fdf2', '65ec8a43da8c70b7fa5c3ddb75cb9742'),
      ('public.plan_tecido_set_referencia(uuid,text[])', '307e56cdfb8945eb009d0834bd2f6843', '8dc362667b1fb750fb56f12a51cd4732'),
      ('public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])', '0f7d3e3bec86a5dee9ddb77551e086cb', 'e192219b2dc68d736588031e83a5c015'),
      ('public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)', 'a8172b9ffa18cb84e2db24beeb51eb41', '6197f52f1ce32913c34bee4cfbb145b7'),
      ('public.salvar_colecao_mix(uuid,uuid,text,text)', 'b3c12a28bec8c7646f82c739c4b55055', '9c1ded3dc7f51977020f72e7aabb026e'),
      ('public.excluir_colecao_mix(uuid)', 'd1131b0ddf792d87e92ea7db0ca89e2c', 'bded4fc594cd5a5dd026ed602ca95afc')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 's3d_gates_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.lancar_modelo(_modelo_id uuid, _data_lancamento date, _send boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cad uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  IF _send THEN
    SELECT id INTO v_cad FROM public.cad WHERE modelo_id = _modelo_id LIMIT 1;
    IF v_cad IS NULL OR NOT public._cq_liberado(v_cad) THEN
      RAISE EXCEPTION 'Confirme o Controle de Qualidade antes de lançar.' USING ERRCODE='42501';
    END IF;
    IF NOT COALESCE((SELECT custo_terceirizados_aprovado FROM public.modelos
                      WHERE id = _modelo_id AND tenant_id = v_tenant), false) THEN
      RAISE EXCEPTION 'Aprove a mão de obra antes de lançar.' USING ERRCODE='42501';
    END IF;
    IF _data_lancamento IS NULL THEN
      RAISE EXCEPTION 'Informe a Data de Lançamento.' USING ERRCODE='42501';
    END IF;

    UPDATE public.modelos
       SET lancado = true,
           data_lancamento = _data_lancamento,
           revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) - 'lancamentos'
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  ELSE
    UPDATE public.modelos
       SET lancado = false
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.conjunto_adicionar(_modelo_id uuid, _add_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_target uuid; v_old uuid; v_a_tenant uuid; v_b_tenant uuid;
BEGIN
  IF _modelo_id = _add_id THEN
    RAISE EXCEPTION 'Não é possível relacionar um produto a ele mesmo.';
  END IF;
  v_tenant := get_user_tenant_id();
  SELECT tenant_id, conjunto_id INTO v_a_tenant, v_target FROM public.modelos WHERE id = _modelo_id;
  SELECT tenant_id, conjunto_id INTO v_b_tenant, v_old FROM public.modelos WHERE id = _add_id;
  IF v_a_tenant IS NULL OR v_b_tenant IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.';
  END IF;
  IF v_a_tenant <> v_tenant OR v_b_tenant <> v_tenant THEN
    RAISE EXCEPTION 'Produto de outra loja.';
  END IF;
  IF v_target IS NULL THEN
    v_target := gen_random_uuid();
    UPDATE public.modelos SET conjunto_id = v_target WHERE id = _modelo_id;
  END IF;
  UPDATE public.modelos SET conjunto_id = v_target WHERE id = _add_id;
  IF v_old IS NOT NULL AND v_old <> v_target THEN
    UPDATE public.modelos SET conjunto_id = NULL
    WHERE conjunto_id = v_old
      AND (SELECT count(*) FROM public.modelos WHERE conjunto_id = v_old) = 1;
  END IF;
  RETURN v_target;
END; $function$;

CREATE OR REPLACE FUNCTION public.conjunto_remover(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_old uuid; v_mt uuid;
BEGIN
  v_tenant := get_user_tenant_id();
  SELECT tenant_id, conjunto_id INTO v_mt, v_old FROM public.modelos WHERE id = _modelo_id;
  IF v_mt IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  IF v_mt <> v_tenant THEN RAISE EXCEPTION 'Produto de outra loja.'; END IF;
  IF v_old IS NULL THEN RETURN; END IF;
  UPDATE public.modelos SET conjunto_id = NULL WHERE id = _modelo_id;
  UPDATE public.modelos SET conjunto_id = NULL
  WHERE conjunto_id = v_old
    AND (SELECT count(*) FROM public.modelos WHERE conjunto_id = v_old) = 1;
END; $function$;

CREATE OR REPLACE FUNCTION public.salvar_grade_revenda(_modelo_id uuid, _grades jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado (Revenda) não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._salvar_grade_revenda_core(_modelo_id, _grades, _rev_base);
END
$function$;

CREATE OR REPLACE FUNCTION public.salvar_produto_acabado(_id uuid, _dados jsonb, _variantes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._salvar_produto_acabado_core(_id, _dados, _variantes);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_produto_acabado(_id uuid, _dados jsonb, _variantes jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_rev int;
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- trava otimista (Fase 3): P0409 se outra pessoa salvou ESTE produto no meio. _rev_base null OU
  -- _id null (criação) = bypass. Bloqueia a linha p/ serializar com o UPDATE do _core.
  IF _rev_base IS NOT NULL AND _id IS NOT NULL THEN
    v_tenant := public.get_user_tenant_id();
    SELECT rev INTO v_rev FROM public.produtos_acabados
      WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
    IF v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
  END IF;
  RETURN public._salvar_produto_acabado_core(_id, _dados, _variantes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_produto_importado(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._salvar_produto_importado_core(_id, _dados, _variantes, _etapas);
end $function$;

CREATE OR REPLACE FUNCTION public.salvar_produto_importado(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_rev int;
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF _rev_base IS NOT NULL AND _id IS NOT NULL THEN
    v_tenant := public.get_user_tenant_id();
    SELECT rev INTO v_rev FROM public.produtos_importados
      WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
    IF v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
  END IF;
  RETURN public._salvar_produto_importado_core(_id, _dados, _variantes, _etapas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_acabado(_produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._salvar_precos_fixo_produto_acabado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_importado(_produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._salvar_precos_fixo_produto_importado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_markups_produto_acabado(_produto_id uuid, _markup_atacado numeric, _markup_varejo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._salvar_markups_produto_acabado_core(_produto_id, _markup_atacado, _markup_varejo);
end;
$function$;

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
  return public._criar_cards_produto_acabado_lote_core(_produto_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.replicar_produtos_acabados(_destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._replicar_produtos_acabados_core(public.get_user_tenant_id(), _destino_colecao_id, _destino_subcolecao_id, _produto_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.limpar_produto_acabado(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._limpar_produto_acabado_core(_produto_id);
end $function$;

CREATE OR REPLACE FUNCTION public.excluir_produto_acabado(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._excluir_produto_acabado_core(_produto_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_produto_ao_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._aplicar_produto_ao_modelo_core(_produto_id);
end;
$function$;

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
  return public._criar_cards_produto_importado_lote_core(_produto_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.replicar_produtos_importados(_destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._replicar_produtos_importados_core(public.get_user_tenant_id(), _destino_colecao_id, _destino_subcolecao_id, _produto_ids);
end $function$;

CREATE OR REPLACE FUNCTION public.limpar_produto_importado(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._limpar_produto_importado_core(_produto_id);
end $function$;

CREATE OR REPLACE FUNCTION public.excluir_produto_importado(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  perform public._excluir_produto_importado_core(_produto_id);
end $function$;

CREATE OR REPLACE FUNCTION public.importar_modelo_linha(_cabecalho jsonb, _grades jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_categoria uuid;
  v_sub1 uuid;
  v_sub2 uuid;
  v_colecao uuid;
  v_linha uuid;
  v_mes uuid;
  v_ano uuid;
  v_existe_id uuid;
  g jsonb;
  v_grades jsonb;
  v_grade_total numeric;
  v_has_value boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do modelo.' USING errcode = 'P0001'; END IF;

  v_categoria := NULLIF(_cabecalho->>'categoria_principal_id','')::uuid;
  v_sub1      := NULLIF(_cabecalho->>'subcategoria1_id','')::uuid;
  v_sub2      := NULLIF(_cabecalho->>'subcategoria2_id','')::uuid;
  v_colecao   := NULLIF(_cabecalho->>'colecao_id','')::uuid;
  v_linha     := NULLIF(_cabecalho->>'linha_id','')::uuid;
  v_mes       := NULLIF(_cabecalho->>'mes_id','')::uuid;
  v_ano       := NULLIF(_cabecalho->>'ano_id','')::uuid;

  IF v_categoria IS NULL THEN
    RAISE EXCEPTION 'Informe a categoria do modelo.' USING errcode = 'P0001';
  END IF;

  -- IDOR do cabeçalho: cada FK tem de ser da MESMA loja.
  IF NOT EXISTS (SELECT 1 FROM categorias_produto c WHERE c.id = v_categoria AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Categoria não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias1_produto s WHERE s.id = v_sub1 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 1 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias2_produto s WHERE s.id = v_sub2 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 2 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_colecao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colecoes cc WHERE cc.id = v_colecao AND cc.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_linha IS NOT NULL AND NOT EXISTS (SELECT 1 FROM linhas l WHERE l.id = v_linha AND l.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Linha não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_mes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meses m WHERE m.id = v_mes AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Mês não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_ano IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anos a WHERE a.id = v_ano AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Ano não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- Só cria NOVOS: se já existe modelo interno de mesmo nome, PULA.
  SELECT id INTO v_existe_id FROM modelos
    WHERE tenant_id = v_tenant AND origem = 'interno'
      AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
    ORDER BY created_at LIMIT 1;
  IF v_existe_id IS NOT NULL THEN
    RETURN jsonb_build_object('modelo_id', v_existe_id, 'acao', 'inalterado');
  END IF;

  -- CRIAR o card (INSERT direto; origem interno; fica no Planejamento — ordem_criacao_enviada=false).
  INSERT INTO modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, mes_id, ano_id, linha_id,
    preco_venda, preco_atacado
  ) VALUES (
    v_tenant, v_nome, 'interno', v_categoria, v_sub1, v_sub2,
    v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
    v_mes, v_ano, v_linha,
    NULLIF(_cabecalho->>'preco_venda','')::numeric,
    NULLIF(_cabecalho->>'preco_atacado','')::numeric
  ) RETURNING id INTO v_id;

  -- Grade (opcional): materializa em modelo_grades (variante 1). Mesma regra do BOM core: só grava
  -- quando grade_total>0 ou algum valor>0. O resto do BOM o usuário monta no Desenvolvimento.
  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(_grades) LOOP
      v_grades := COALESCE(g->'grades', '{}'::jsonb);
      v_grade_total := COALESCE((g->>'grade_total')::numeric, 0);
      v_has_value := false;
      IF v_grade_total > 0 THEN
        v_has_value := true;
      ELSIF jsonb_typeof(v_grades) = 'object' THEN
        SELECT EXISTS(SELECT 1 FROM jsonb_each_text(v_grades) WHERE NULLIF(value,'')::numeric > 0) INTO v_has_value;
      END IF;
      IF v_has_value THEN
        INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total)
        VALUES (v_id, COALESCE((g->>'variante_numero')::int, 1), v_grades, v_grade_total);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('modelo_id', v_id, 'acao', 'criado');
END $function$;

CREATE OR REPLACE FUNCTION public.importar_produto_linha(_cabecalho jsonb, _variantes jsonb, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_nome text;
  v_grupo uuid;
  v_categoria uuid;
  v_sub1 uuid;
  v_sub2 uuid;
  v_empresa uuid;
  v_rep uuid;
  v_colecao uuid;
  v_existe_id uuid;
  v_existe_modelo uuid;
  r jsonb;
  v_cor uuid;
  v_apelido uuid;
  v_var_id uuid;
  v_max_ordem int;
  v_acao text := 'inalterado';
  v_novas int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;

  IF _tipo NOT IN ('revenda', 'importado') THEN
    RAISE EXCEPTION 'Tipo de produto inválido: % (use revenda ou importado).', _tipo USING errcode = 'P0001';
  END IF;
  -- módulo por tipo (mesmo gate das telas)
  IF _tipo = 'revenda' AND NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING errcode = '42501';
  END IF;
  IF _tipo = 'importado' AND NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não está ativo para esta loja.' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do produto.' USING errcode = 'P0001'; END IF;

  v_grupo     := NULLIF(_cabecalho->>'grupo_id','')::uuid;
  v_categoria := NULLIF(_cabecalho->>'categoria_id','')::uuid;
  v_sub1      := NULLIF(_cabecalho->>'subcategoria1_id','')::uuid;
  v_sub2      := NULLIF(_cabecalho->>'subcategoria2_id','')::uuid;
  v_empresa   := NULLIF(_cabecalho->>'empresa_id','')::uuid;
  v_rep       := NULLIF(_cabecalho->>'representante_id','')::uuid;
  v_colecao   := NULLIF(_cabecalho->>'colecao_id','')::uuid;

  -- grupo/categoria são obrigatórios na CRIAÇÃO (as RPCs de save exigem).
  IF v_grupo IS NULL OR v_categoria IS NULL THEN
    RAISE EXCEPTION 'Informe grupo e categoria do produto.' USING errcode = 'P0001';
  END IF;

  -- IDOR: cada FK do cabeçalho tem de ser da MESMA loja (fecha payload forjado).
  IF NOT EXISTS (SELECT 1 FROM grupos_produto g WHERE g.id = v_grupo AND g.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Grupo não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categorias_produto c WHERE c.id = v_categoria AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Categoria não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias1_produto s WHERE s.id = v_sub1 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 1 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias2_produto s WHERE s.id = v_sub2 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 2 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_empresa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = v_empresa AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM representantes rp WHERE rp.id = v_rep AND rp.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Representante não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_colecao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colecoes cc WHERE cc.id = v_colecao AND cc.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- cores das variantes têm de ser da loja.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    WHERE NULLIF(e->>'cor_id','') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.id = (e->>'cor_id')::uuid AND c.tenant_id = v_tenant)
  ) THEN
    RAISE EXCEPTION 'Cor base não pertence à loja.' USING errcode = 'P0001';
  END IF;
  -- apelido (se informado) tem de pertencer à cor base escolhida E à loja.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    JOIN cores_apelido ca ON ca.id = (e->>'cor_apelido_id')::uuid
    WHERE NULLIF(e->>'cor_apelido_id','') IS NOT NULL
      AND (ca.tenant_id IS DISTINCT FROM v_tenant
           OR ca.cor_base_id IS DISTINCT FROM (e->>'cor_id')::uuid)
  ) THEN
    RAISE EXCEPTION 'Cor apelido não pertence à cor base informada (ou à loja).' USING errcode = 'P0001';
  END IF;

  -- =========================================================================
  -- Resolve o ALVO do upsert por NOME normalizado (produto acabado/importado NÃO têm unique de
  -- nome; a busca é a rede contra duplicar ao reimportar). NULL = criar.
  -- =========================================================================
  IF _tipo = 'revenda' THEN
    SELECT id, modelo_id INTO v_existe_id, v_existe_modelo FROM produtos_acabados
      WHERE tenant_id = v_tenant AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
      ORDER BY created_at LIMIT 1;
  ELSE
    SELECT id, modelo_id INTO v_existe_id, v_existe_modelo FROM produtos_importados
      WHERE tenant_id = v_tenant AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
      ORDER BY created_at LIMIT 1;
  END IF;

  -- =========================================================================
  -- CRIAR (produto novo)
  -- =========================================================================
  IF v_existe_id IS NULL THEN
    IF _tipo = 'revenda' THEN
      INSERT INTO produtos_acabados (
        tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
        grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
        markup_atacado, markup_varejo, foto_url
      ) VALUES (
        v_tenant, v_nome, NULLIF(_cabecalho->>'ref',''), v_grupo, v_categoria, v_sub1, v_sub2,
        v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
        v_empresa, v_rep, NULLIF(_cabecalho->>'ref_fornecedor',''), NULLIF(_cabecalho->>'composicao',''),
        COALESCE(_cabecalho->'grade_proporcao','{}'::jsonb),
        COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, 0),
        COALESCE(NULLIF(_cabecalho->>'valor_unitario','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, 0),
        0,
        NULLIF(_cabecalho->>'markup_atacado','')::numeric,
        NULLIF(_cabecalho->>'markup_varejo','')::numeric,
        NULLIF(_cabecalho->>'foto_url','')
      ) RETURNING id INTO v_id;
    ELSE
      INSERT INTO produtos_importados (
        tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
        grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
        moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
        desconto_pct, cotacao_final, markup_atacado, markup_varejo
      ) VALUES (
        v_tenant, v_nome, NULLIF(_cabecalho->>'ref',''), v_grupo, v_categoria, v_sub1, v_sub2,
        v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
        v_empresa, v_rep, NULLIF(_cabecalho->>'ref_fornecedor',''), NULLIF(_cabecalho->>'composicao',''),
        COALESCE(_cabecalho->'grade_proporcao','{}'::jsonb),
        COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, 0),
        NULLIF(_cabecalho->>'foto_url',''),
        NULLIF(_cabecalho->>'data_pedido','')::date, NULLIF(_cabecalho->>'data_prevista','')::date, NULLIF(_cabecalho->>'data_entrega','')::date,
        COALESCE(NULLIF(_cabecalho->>'moeda_compra',''),'RMB'), NULLIF(_cabecalho->>'moeda_intermediaria',''),
        COALESCE(NULLIF(_cabecalho->>'valor_unitario_m1','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'cotacao_ref','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'peso_kg','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'transporte_m2','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'cotacao_final','')::numeric, 0),
        NULLIF(_cabecalho->>'markup_atacado','')::numeric,
        NULLIF(_cabecalho->>'markup_varejo','')::numeric
      ) RETURNING id INTO v_id;
    END IF;
    v_acao := 'criado';
  ELSE
    -- =======================================================================
    -- COMPLEMENTAR (produto já existe) — atualiza cabeçalho com COALESCE (não zera vazio).
    -- =======================================================================
    v_id := v_existe_id;
    IF _tipo = 'revenda' THEN
      UPDATE produtos_acabados SET
        grupo_id         = COALESCE(v_grupo, grupo_id),
        categoria_id     = COALESCE(v_categoria, categoria_id),
        subcategoria1_id = COALESCE(v_sub1, subcategoria1_id),
        subcategoria2_id = COALESCE(v_sub2, subcategoria2_id),
        colecao_id       = COALESCE(v_colecao, colecao_id),
        subcolecao       = COALESCE(NULLIF(_cabecalho->>'subcolecao',''), subcolecao),
        semana           = COALESCE(NULLIF(_cabecalho->>'semana',''), semana),
        empresa_id       = COALESCE(v_empresa, empresa_id),
        representante_id = COALESCE(v_rep, representante_id),
        ref_fornecedor   = COALESCE(NULLIF(_cabecalho->>'ref_fornecedor',''), ref_fornecedor),
        composicao       = COALESCE(NULLIF(_cabecalho->>'composicao',''), composicao),
        grade_proporcao  = CASE WHEN _cabecalho ? 'grade_proporcao' AND _cabecalho->'grade_proporcao' <> '{}'::jsonb
                                THEN _cabecalho->'grade_proporcao' ELSE grade_proporcao END,
        qtd_total        = COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, qtd_total),
        valor_unitario   = COALESCE(NULLIF(_cabecalho->>'valor_unitario','')::numeric, valor_unitario),
        desconto_pct     = COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, desconto_pct),
        markup_atacado   = COALESCE(NULLIF(_cabecalho->>'markup_atacado','')::numeric, markup_atacado),
        markup_varejo    = COALESCE(NULLIF(_cabecalho->>'markup_varejo','')::numeric, markup_varejo),
        foto_url         = COALESCE(NULLIF(_cabecalho->>'foto_url',''), foto_url),
        updated_at       = now()
      WHERE id = v_id AND tenant_id = v_tenant;
    ELSE
      UPDATE produtos_importados SET
        grupo_id            = COALESCE(v_grupo, grupo_id),
        categoria_id        = COALESCE(v_categoria, categoria_id),
        subcategoria1_id    = COALESCE(v_sub1, subcategoria1_id),
        subcategoria2_id    = COALESCE(v_sub2, subcategoria2_id),
        colecao_id          = COALESCE(v_colecao, colecao_id),
        subcolecao          = COALESCE(NULLIF(_cabecalho->>'subcolecao',''), subcolecao),
        semana              = COALESCE(NULLIF(_cabecalho->>'semana',''), semana),
        empresa_id          = COALESCE(v_empresa, empresa_id),
        representante_id    = COALESCE(v_rep, representante_id),
        ref_fornecedor      = COALESCE(NULLIF(_cabecalho->>'ref_fornecedor',''), ref_fornecedor),
        composicao          = COALESCE(NULLIF(_cabecalho->>'composicao',''), composicao),
        grade_proporcao     = CASE WHEN _cabecalho ? 'grade_proporcao' AND _cabecalho->'grade_proporcao' <> '{}'::jsonb
                                   THEN _cabecalho->'grade_proporcao' ELSE grade_proporcao END,
        qtd_total           = COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, qtd_total),
        foto_url            = COALESCE(NULLIF(_cabecalho->>'foto_url',''), foto_url),
        data_pedido         = COALESCE(NULLIF(_cabecalho->>'data_pedido','')::date, data_pedido),
        data_prevista       = COALESCE(NULLIF(_cabecalho->>'data_prevista','')::date, data_prevista),
        data_entrega        = COALESCE(NULLIF(_cabecalho->>'data_entrega','')::date, data_entrega),
        moeda_compra        = COALESCE(NULLIF(_cabecalho->>'moeda_compra',''), moeda_compra),
        moeda_intermediaria = COALESCE(NULLIF(_cabecalho->>'moeda_intermediaria',''), moeda_intermediaria),
        valor_unitario_m1   = COALESCE(NULLIF(_cabecalho->>'valor_unitario_m1','')::numeric, valor_unitario_m1),
        cotacao_ref         = COALESCE(NULLIF(_cabecalho->>'cotacao_ref','')::numeric, cotacao_ref),
        peso_kg             = COALESCE(NULLIF(_cabecalho->>'peso_kg','')::numeric, peso_kg),
        transporte_m2       = COALESCE(NULLIF(_cabecalho->>'transporte_m2','')::numeric, transporte_m2),
        desconto_pct        = COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, desconto_pct),
        cotacao_final       = COALESCE(NULLIF(_cabecalho->>'cotacao_final','')::numeric, cotacao_final),
        markup_atacado      = COALESCE(NULLIF(_cabecalho->>'markup_atacado','')::numeric, markup_atacado),
        markup_varejo       = COALESCE(NULLIF(_cabecalho->>'markup_varejo','')::numeric, markup_varejo),
        updated_at          = now()
      WHERE id = v_id AND tenant_id = v_tenant;
    END IF;
  END IF;

  -- =========================================================================
  -- Variantes: adiciona por (cor, apelido) as que faltam (não recria o que já existe).
  -- Ordem nova = max(ordem) + 1 (respeita UNIQUE(produto, ordem)).
  -- =========================================================================
  IF _tipo = 'revenda' THEN
    SELECT COALESCE(MAX(ordem), -1) INTO v_max_ordem FROM produto_acabado_variantes WHERE produto_acabado_id = v_id;
  ELSE
    SELECT COALESCE(MAX(ordem), -1) INTO v_max_ordem FROM produto_importado_variantes WHERE produto_importado_id = v_id;
  END IF;

  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
           WHERE NULLIF(e->>'cor_id','') IS NOT NULL
  LOOP
    v_cor := (r->>'cor_id')::uuid;
    v_apelido := NULLIF(r->>'cor_apelido_id','')::uuid;

    IF _tipo = 'revenda' THEN
      SELECT id INTO v_var_id FROM produto_acabado_variantes
        WHERE produto_acabado_id = v_id AND cor_id = v_cor AND cor_apelido_id IS NOT DISTINCT FROM v_apelido
        LIMIT 1;
    ELSE
      SELECT id INTO v_var_id FROM produto_importado_variantes
        WHERE produto_importado_id = v_id AND cor_id = v_cor AND cor_apelido_id IS NOT DISTINCT FROM v_apelido
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      v_max_ordem := v_max_ordem + 1;
      IF _tipo = 'revenda' THEN
        INSERT INTO produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
        VALUES (v_tenant, v_id, v_max_ordem, v_cor, v_apelido,
                COALESCE(NULLIF(r->>'peso','')::numeric, 0), COALESCE(NULLIF(r->>'qtd','')::int, 0));
      ELSE
        INSERT INTO produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
        VALUES (v_tenant, v_id, v_max_ordem, v_cor, v_apelido,
                COALESCE(NULLIF(r->>'peso','')::numeric, 0), COALESCE(NULLIF(r->>'qtd','')::int, 0));
      END IF;
      v_novas := v_novas + 1;
    END IF;
  END LOOP;

  -- =========================================================================
  -- Card-espelho em modelos (o que faz o produto aparecer no Planejamento). Só cria se ainda
  -- não existe — os _core são idempotentes (RAISE se já tem card), então guardamos aqui.
  -- =========================================================================
  IF _tipo = 'revenda' THEN
    SELECT modelo_id INTO v_existe_modelo FROM produtos_acabados WHERE id = v_id;
    IF v_existe_modelo IS NULL THEN
      v_modelo_id := public._criar_card_produto_acabado_core(v_id);
    ELSE
      v_modelo_id := v_existe_modelo;
    END IF;
  ELSE
    SELECT modelo_id INTO v_existe_modelo FROM produtos_importados WHERE id = v_id;
    IF v_existe_modelo IS NULL THEN
      v_modelo_id := public._criar_card_produto_importado_core(v_id);
    ELSE
      v_modelo_id := v_existe_modelo;
    END IF;
  END IF;

  -- ação final p/ o relatório
  IF v_acao <> 'criado' THEN
    v_acao := CASE WHEN v_novas > 0 THEN 'complementado' ELSE 'inalterado' END;
  END IF;

  RETURN jsonb_build_object('produto_id', v_id, 'modelo_id', v_modelo_id, 'acao', v_acao, 'variantes_novas', v_novas);
END $function$;

CREATE OR REPLACE FUNCTION public.integracao_salvar(_itens jsonb, _keywords jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_itens jsonb := coalesce(_itens, '[]'::jsonb);
  v_chaves_ok text[] := ARRAY['nome', 'ref', 'preco_anterior', 'preco_venda', 'peso_kg', 'ncm', 'titulo_pagina',
                              'descricao_produto', 'comprimento_cm', 'largura_cm', 'altura_cm', 'fotos_modelo'];
  v_num text[] := ARRAY['preco_anterior', 'preco_venda', 'peso_kg', 'comprimento_cm', 'largura_cm', 'altura_cm'];
  m public.modelos%ROWTYPE;
  r record;
  v_c jsonb;
  v_g jsonb;
  v_k text;
  v_gate text;
  v_antes jsonb;
  v_depois jsonb;
  v_prod uuid;
  v_revs jsonb := '{}'::jsonb;
  v_n integer := 0;
  v_kw_atual text;
  v_kw_novo text;
BEGIN
  IF jsonb_typeof(v_itens) <> 'array' OR jsonb_array_length(v_itens) > 50 THEN
    RAISE EXCEPTION 'Envie no máximo 50 produtos por vez.' USING ERRCODE = 'P0001';
  END IF;
  -- ruling do controlador, revisão T5 #6 (Minor #6, mesmo padrão de integracao_marcar/revisão T3 Minor #3):
  -- modelo_id duplicado no payload tornaria o DISTINCT ON abaixo não-determinístico (2 conjuntos de campos
  -- diferentes pro mesmo produto — qual vale, e com qual rev checar?); recusa cedo, ANTES de qualquer lock.
  -- resíduos T7 #6 (T5 N3, ruling do controlador, mesmo fix da T3 C): (a) item SEM modelo_id ganha mensagem
  -- PRÓPRIA, ANTES do check de duplicata; (b) duplicata comparada por ::uuid (não texto cru), então um mesmo UUID
  -- em caixa alta/baixa conta como o mesmo produto.
  -- ruling do controlador, revisão T7 #11 (fix round 1, Minor 3, mesmo fix/mesma decisão documentada em
  -- integracao_marcar): recusa também um modelo_id não-string ou sem cara de uuid, ANTES do cast ::uuid abaixo
  -- (que doutra forma estouraria 22P02 cru). Formato aceito = o MESMO que o cast ::uuid do Postgres aceita (32 hex,
  -- com ou sem os hifens 8-4-4-4-12, opcionalmente entre chaves) — não só a grafia canônica com hifens, pra não
  -- recusar por engano um id válido só por formatação diferente da que o cast já tolera.
  -- ruling do controlador, revisão T7 #12 (fix round 2, re-review round 1 Minor 3, mesmo fix de integracao_marcar):
  -- \{? e \}? eram INDEPENDENTES — uma chave sozinha ("{<uuid>" ou "<uuid>}") passava o regex mas o ::uuid rejeita
  -- chaves desbalanceadas, deixando 22P02 cru alcançável. Fix: par ATÔMICO '^(\{H\}|H)$'.
  IF jsonb_array_length(v_itens) > 0
     AND (SELECT count(*) FILTER (WHERE jsonb_typeof(e.x -> 'modelo_id') IS DISTINCT FROM 'string'
                                       OR NOT (e.x ->> 'modelo_id' ~* '^(\{[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}|[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$'))
            FROM jsonb_array_elements(v_itens) AS e(x)) > 0 THEN
    RAISE EXCEPTION 'Envie o modelo_id de cada produto.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_itens) > 0 AND (SELECT count(*) FROM jsonb_array_elements(v_itens) AS e(x)) <>
     (SELECT count(DISTINCT (e.x ->> 'modelo_id')::uuid) FROM jsonb_array_elements(v_itens) AS e(x)) THEN
    RAISE EXCEPTION 'Produto repetido na lista — envie cada produto uma vez só.' USING ERRCODE = 'P0001';
  END IF;
  -- ruling do controlador, revisão T7 #12 (fix round 2, "same class" item ruled this round): (e.x->>'rev')::integer
  -- (linha do FOR abaixo) estourava 22P02 cru (string não-numérica/objeto) ou 22003 cru (fora do range de 32 bits)
  -- pra um rev malformado — mesmo padrão de integracao_salvar_config_api (T6 #6, m6): valida TIPO e RANGE ANTES de
  -- qualquer cast. rev É opcional (jsonb null = "nenhuma base enviada", conferido depois via IS DISTINCT FROM em
  -- m.rev — comportamento pré-existente, não mexido aqui); só um rev PRESENTE e NÃO-null passa pela validação.
  -- Fracionário (1.5) é pego por trunc(x) <> x — jsonb_typeof='number' e range OK não bastam (1.5 está no range
  -- mas ::integer estoura 22P02 no cast direto texto->integer que o FOR já fazia).
  IF (SELECT count(*) FILTER (WHERE jsonb_typeof(e.x -> 'rev') NOT IN ('null')
                                  AND (jsonb_typeof(e.x -> 'rev') <> 'number'
                                       OR (e.x -> 'rev')::text::numeric NOT BETWEEN -2147483648 AND 2147483647
                                       OR trunc((e.x -> 'rev')::text::numeric) <> (e.x -> 'rev')::text::numeric))
        FROM jsonb_array_elements(v_itens) AS e(x)
       WHERE e.x ? 'rev') > 0 THEN
    RAISE EXCEPTION 'A revisao (rev) precisa ser um numero inteiro.' USING ERRCODE = 'P0001';
  END IF;
  -- ruling do controlador, revisão T7 #13 (fix round 3, re-review round 2): um NÚMERO inteiro escrito com decimal
  -- (5.0, 1.50e1 que o jsonb grava como 15.0, 2147483647.0) passa na checagem ACIMA (tipo number, no range,
  -- trunc(x)=x) mas o FOR abaixo ainda fazia (e.x->>'rev')::integer — um cast TEXTO->integer direto, que o
  -- Postgres rejeita pra qualquer forma com ponto decimal (confirmado na cópia: "5.0"::integer estoura 22P02,
  -- mesmo sendo um valor íntegro). Fix: o FOR agora casta (e.x->>'rev')::numeric::integer — seguro porque a
  -- checagem ACIMA já garante um valor íntegro dentro do range de int32; ::numeric aceita a forma decimal e o
  -- ::integer seguinte arredonda sem erro (5.0 vira 5; a checagem anterior ja garante um valor integro, entao
  -- arredondar ou truncar dao o mesmo resultado aqui — ruling do controlador, G-migration fix 1 #G11: o comentario
  -- dizia "trunca", mas numeric::integer ARREDONDA, nao trunca — confirmado: 5.6::numeric::integer = 6, nao 5).
  FOR r IN
    SELECT DISTINCT ON ((e.x ->> 'modelo_id')::uuid) (e.x ->> 'modelo_id')::uuid AS modelo_id,
           (e.x ->> 'rev')::numeric::integer AS rev_base, coalesce(e.x -> 'campos', '{}'::jsonb) AS campos
      FROM jsonb_array_elements(v_itens) AS e(x)
     ORDER BY (e.x ->> 'modelo_id')::uuid
  LOOP
    v_c := r.campos;
    IF jsonb_typeof(v_c) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_c) AS k(k) WHERE k.k <> ALL(v_chaves_ok)) THEN
      RAISE EXCEPTION 'Campo desconhecido na gravação da Integração.' USING ERRCODE = 'P0001';
    END IF;
    -- ruling do controlador, revisão T5 #6 (Minor #6): item sem campo nenhum (campos: {}) é PULADO por inteiro —
    -- sem lock, sem checagem de rev, sem UPDATE, sem bump de rev, sem log — não é um "editar" de fato.
    IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_c)) THEN
      CONTINUE;
    END IF;
    SELECT * INTO m FROM public.modelos x WHERE x.id = r.modelo_id AND x.tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado nesta loja.' USING ERRCODE = 'P0001';
    END IF;
    IF m.rev IS DISTINCT FROM r.rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o produto foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    v_g := public._integracao_gates(r.modelo_id);
    IF v_g ->> 'estado' <> 'nao_integravel' THEN
      RAISE EXCEPTION 'integracao_travado: produto' USING ERRCODE = '42501';
    END IF;
    -- R2/V1/n5: a MESMA regra do card, campo a campo, reconferida no servidor (inclui módulo da origem)
    FOR v_k IN SELECT k.k FROM jsonb_object_keys(v_c) AS k(k) ORDER BY 1 LOOP
      -- decisão do dono 27/set 15h4x (G-migration fix 5): "Descrição" (= Metatag, mesmo texto) só edita quem
      -- tem o Planejamento, igual ao card — deixou de ser 'compartilhado' (Planejamento OU Dev antes da Explosão).
      v_gate := CASE v_k WHEN 'nome' THEN 'compartilhado'
                         WHEN 'fotos_modelo' THEN 'compartilhado' WHEN 'ref' THEN 'ref'
                         WHEN 'preco_venda' THEN 'preco' WHEN 'preco_anterior' THEN 'preco' ELSE 'planejamento' END;
      IF NOT coalesce((v_g -> v_gate ->> 'ok')::boolean, false) THEN
        RAISE EXCEPTION 'integracao_sem_permissao: %', v_k USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF v_c ? 'nome' AND nullif(btrim(coalesce(v_c ->> 'nome', '')), '') IS NULL THEN
      RAISE EXCEPTION 'O nome não pode ficar vazio.' USING ERRCODE = 'P0001';
    END IF;
    IF v_c ? 'ref' AND nullif(btrim(coalesce(v_c ->> 'ref', '')), '') IS NULL THEN
      RAISE EXCEPTION 'A REF não pode ficar vazia.' USING ERRCODE = 'P0001';
    END IF;
    -- ruling do controlador, revisão T5 #5 (Minor #5): recusa cedo, ANTES do UPDATE em modelos, um nome de comprado
    -- que a sincronização (fn_modelo_espelho_nome_ref) rejeitaria de qualquer forma no espelho (varchar(200)) —
    -- mensagem clara aqui em vez de deixar o gatilho estourar depois do UPDATE já ter mexido no card.
    IF v_c ? 'nome' AND coalesce(m.origem, 'interno') IN ('revenda', 'importado')
       AND length(btrim(v_c ->> 'nome')) > 200 THEN
      RAISE EXCEPTION 'Nome muito longo para o Produto % (máx. 200 caracteres).',
        CASE m.origem WHEN 'revenda' THEN 'Acabado' ELSE 'Importado' END USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(v_c) AS e(key, value) WHERE e.key = ANY(v_num)
                AND NOT CASE WHEN jsonb_typeof(e.value) = 'null' THEN true
                             WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric >= 0
                             ELSE false END) THEN
      RAISE EXCEPTION 'Valor numérico inválido (use número maior ou igual a zero).' USING ERRCODE = 'P0001';
    END IF;
    -- ruling do controlador, G-migration fix 1 #G3 (A-M6 + B-M4), estendido no G-migration fix 2 #H2 (A + B-DM-2):
    -- numero fora da escala da coluna (ex.: peso_kg 1e20 em numeric(10,3)) tem que RAISE P0001 em PT ANTES do
    -- UPDATE — nunca 22003 cru. Checagem INLINE (sem função nova, pra não mexer na contagem/ACL #9 da suíte 7): a
    -- parte inteira de um numeric(p,s) tem no máximo (p - s) dígitos — abs(valor arredondado na escala) <
    -- 10^(p - s) cabe; senão estoura ao gravar. #H2: o G3 cobria peso/medidas/preco_anterior mas esquecia
    -- 'preco_venda' — no COMPRADO (revenda/importado) esse valor vai para produtos_acabados/importados.
    -- preco_varejo_fixo numeric(12,2) pelos wrappers (salvar_precos_fixo_produto_*, mais abaixo nesta função),
    -- então 1e20 ainda estourava 22003 cru sem essa entrada na lista. modelos.preco_venda (caminho INTERNO) não
    -- tem escala fixa — a mesma faixa de negócio (10^10) é aplicada por uniformidade/defesa, sem regressão real
    -- (nenhum preço de negócio chega perto disso).
    IF EXISTS (SELECT 1 FROM jsonb_each(v_c) AS e(key, value)
                WHERE jsonb_typeof(e.value) = 'number'
                  AND ((e.key = 'peso_kg' AND abs(round((e.value #>> '{}')::numeric, 3)) >= 10.0 ^ (10 - 3))
                    OR (e.key IN ('comprimento_cm', 'largura_cm', 'altura_cm')
                        AND abs(round((e.value #>> '{}')::numeric, 2)) >= 10.0 ^ (10 - 2))
                    OR (e.key IN ('preco_anterior', 'preco_venda')
                        AND abs(round((e.value #>> '{}')::numeric, 2)) >= 10.0 ^ (12 - 2)))) THEN
      RAISE EXCEPTION 'Valor numérico fora da faixa permitida para este campo.' USING ERRCODE = 'P0001';
    END IF;
    IF v_c ? 'fotos_modelo' THEN
      -- mesma regra do retrato (_integracao_retrato_core, Minor #6/nota 7): elemento nao-texto/NULL, segmento
      -- '.'/'..'/vazio ou prefixo de outra loja — tudo vira P0001 aqui (antes so o prefixo era conferido:
      -- starts_with(NULL,...) = NULL, entao o EXISTS antigo deixava passar um elemento NULL gravado no array).
      IF jsonb_typeof(v_c -> 'fotos_modelo') <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_c -> 'fotos_modelo') AS p(x)
                     WHERE jsonb_typeof(p.x) IS DISTINCT FROM 'string'
                        OR NOT starts_with(p.x #>> '{}', v_tenant::text || '/')
                        OR EXISTS (SELECT 1 FROM unnest(string_to_array(p.x #>> '{}', '/')) AS seg(s) WHERE seg.s IN ('', '.', '..'))) THEN
        RAISE EXCEPTION 'Foto inválida (de outra loja).' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_antes := to_jsonb(m);
    UPDATE public.modelos SET
      nome = CASE WHEN v_c ? 'nome' THEN btrim(v_c ->> 'nome') ELSE nome END,
      ref = CASE WHEN v_c ? 'ref' THEN btrim(v_c ->> 'ref') ELSE ref END,
      preco_anterior = CASE WHEN v_c ? 'preco_anterior' THEN (v_c ->> 'preco_anterior')::numeric ELSE preco_anterior END,
      preco_venda = CASE WHEN v_c ? 'preco_venda' AND coalesce(m.origem, 'interno') NOT IN ('revenda', 'importado')
                         THEN (v_c ->> 'preco_venda')::numeric ELSE preco_venda END,
      peso_kg = CASE WHEN v_c ? 'peso_kg' THEN (v_c ->> 'peso_kg')::numeric ELSE peso_kg END,
      ncm = CASE WHEN v_c ? 'ncm' THEN nullif(btrim(coalesce(v_c ->> 'ncm', '')), '') ELSE ncm END,
      titulo_pagina = CASE WHEN v_c ? 'titulo_pagina' THEN nullif(btrim(coalesce(v_c ->> 'titulo_pagina', '')), '') ELSE titulo_pagina END,
      descricao_produto = CASE WHEN v_c ? 'descricao_produto' THEN nullif(btrim(coalesce(v_c ->> 'descricao_produto', '')), '') ELSE descricao_produto END,
      comprimento_cm = CASE WHEN v_c ? 'comprimento_cm' THEN (v_c ->> 'comprimento_cm')::numeric ELSE comprimento_cm END,
      largura_cm = CASE WHEN v_c ? 'largura_cm' THEN (v_c ->> 'largura_cm')::numeric ELSE largura_cm END,
      altura_cm = CASE WHEN v_c ? 'altura_cm' THEN (v_c ->> 'altura_cm')::numeric ELSE altura_cm END,
      fotos_modelo = CASE WHEN v_c ? 'fotos_modelo'
                          THEN ARRAY(SELECT p.x FROM jsonb_array_elements_text(v_c -> 'fotos_modelo') AS p(x)) ELSE fotos_modelo END
    WHERE id = r.modelo_id;
    -- preço de venda do COMPRADO = preço FIXO pelo gravador de cada origem (os WRAPPERS — R4; V1: sem checagem nova neles)
    IF v_c ? 'preco_venda' AND m.origem IN ('revenda', 'importado') THEN
      IF m.origem = 'revenda' THEN
        SELECT pa.id INTO v_prod FROM public.produtos_acabados pa WHERE pa.modelo_id = r.modelo_id;
        IF v_prod IS NULL THEN
          RAISE EXCEPTION 'Produto de revenda sem cadastro no Produto Acabado.' USING ERRCODE = 'P0001';
        END IF;
        PERFORM public.salvar_precos_fixo_produto_acabado(v_prod, false, NULL, true, (v_c ->> 'preco_venda')::numeric);
      ELSE
        SELECT pi.id INTO v_prod FROM public.produtos_importados pi WHERE pi.modelo_id = r.modelo_id;
        IF v_prod IS NULL THEN
          RAISE EXCEPTION 'Produto importado sem cadastro no Produto Importado.' USING ERRCODE = 'P0001';
        END IF;
        PERFORM public.salvar_precos_fixo_produto_importado(v_prod, false, NULL, true, (v_c ->> 'preco_venda')::numeric);
      END IF;
    END IF;
    SELECT to_jsonb(x) INTO v_depois FROM public.modelos x WHERE x.id = r.modelo_id;
    PERFORM public._integracao_logar(v_tenant, 'editar', r.modelo_id, jsonb_build_object('campos',
      (SELECT jsonb_object_agg(k.k, jsonb_build_object('antes', v_antes -> k.k, 'depois', v_depois -> k.k))
         FROM jsonb_object_keys(v_c) AS k(k))), NULL);
    v_revs := v_revs || jsonb_build_object(r.modelo_id::text, (v_depois ->> 'rev')::integer);
    v_n := v_n + 1;
  END LOOP;

  IF _keywords IS NOT NULL THEN
    -- R5: SÓ a coluna keywords, com conferência do valor carregado (nunca o upsert da linha da Config)
    IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'integracao_sem_permissao: keywords' USING ERRCODE = '42501';
    END IF;
    SELECT tc.keywords INTO v_kw_atual FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant FOR UPDATE;
    IF coalesce(v_kw_atual, '') IS DISTINCT FROM coalesce(_keywords ->> 'esperado', '') THEN
      RAISE EXCEPTION 'keywords_mudou: as keywords da loja mudaram' USING ERRCODE = 'P0409';
    END IF;
    v_kw_novo := nullif(btrim(coalesce(_keywords ->> 'valor', '')), '');
    UPDATE public.tenant_config SET keywords = v_kw_novo WHERE tenant_id = v_tenant;
    PERFORM public._integracao_logar(v_tenant, 'editar', NULL,
      jsonb_build_object('keywords', jsonb_build_object('antes', v_kw_atual, 'depois', v_kw_novo)), NULL);
  END IF;
  RETURN jsonb_build_object('salvos', v_n, 'revs', v_revs);
END
$function$;

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
  return public._salvar_plan_tecido_core(_colecao_id, _arvore, _rev_base);
end $function$;

CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan uuid;
  v_sub jsonb; v_ln jsonb; v_slot jsonb; v_mat jsonb; v_var jsonb;
  v_sub_id uuid; v_ln_id uuid; v_slot_id uuid; v_mat_id uuid;
  v_slot_oc jsonb;
  v_tt text;  -- [tamanho-em v1]
begin
  -- [NOVO] guarda de tenant incondicional (não depende de _rev_base) — fecha o IDOR
  -- de escrita cross-tenant: antes disso, o filtro de tenant só existia dentro do
  -- bloco da trava otimista, que não roda quando _rev_base é null.
  if not exists (
    select 1 from public.colecoes c
    where c.id = _colecao_id
      and (c.tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Coleção não encontrada ou sem permissão.';
  end if;

  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select plan_rev into v_rev from public.colecoes
        where id = _colecao_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR da árvore (antes de qualquer delete/reinsert).
  perform public._plan_tecido_snapshot(v_plan);

  -- captura a OC-por-SLOT de TODOS os slots ANTES do delete (o slot_oc cascateia no delete)
  select coalesce(jsonb_agg(distinct jsonb_build_object('s', so.slot_id, 'o', so.oc_tecido_id)), '[]'::jsonb)
    into v_slot_oc
  from plan_tecido_slot_oc so
  join plan_tecido_slots sl on sl.id = so.slot_id
  join plan_tecido_linhas l on l.id = sl.linha_ref_id
  join plan_tecido_subcolecoes s on s.id = l.sub_id
  where s.plan_id = v_plan;

  delete from plan_tecido_subcolecoes where plan_id = v_plan;  -- cascateia subcolecao_categorias + slot_oc
  for v_sub in select * from jsonb_array_elements(coalesce(_arvore->'subcolecoes','[]'::jsonb)) loop
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, nullif(v_sub->>'subcolecao_id','')::uuid, coalesce((v_sub->>'ordem')::int,0))
      returning id into v_sub_id;
    insert into plan_tecido_subcolecao_categorias (subcolecao_id, categoria_id, ordem)
      select v_sub_id, nullif(t.val,'')::uuid, t.ord
      from jsonb_array_elements_text(coalesce(v_sub->'categorias_tecido','[]'::jsonb)) with ordinality as t(val, ord)
      where nullif(t.val,'') is not null
      on conflict (subcolecao_id, categoria_id) do nothing;
    for v_ln in select * from jsonb_array_elements(coalesce(v_sub->'linhas','[]'::jsonb)) loop
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
        values (v_sub_id, nullif(v_ln->>'linha_id','')::uuid, nullif(v_ln->>'categoria_id','')::uuid, coalesce((v_ln->>'ordem')::int,0))
        returning id into v_ln_id;
      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop
        -- [tamanho-em v1] "Tamanho em" (P-119 A): a vaga SEM card guarda a escolha; com card ele mora no modelo.
        -- Valida SÓ onde o valor é gravado (vaga sem card; o "tocado" valida abaixo): na vaga COM card sem a marca o
        -- valor é descartado — um legado fora do domínio no modelo (CHECK NOT VALID) não pode travar o Salvar inteiro.
        v_tt := nullif(v_slot->>'tamanho_tipo', '');
        if v_tt is not null and v_tt not in ('letra', 'numero') and nullif(v_slot->>'modelo_id','') is null then
          raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
        end if;
        insert into plan_tecido_slots (id, linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda, categoria_id, usar_estoque, proporcoes,
          categoria_tecido_id, mix_id, referencia_paths, tamanho_tipo)
          values (coalesce(nullif(v_slot->>'id','')::uuid, gen_random_uuid()),  -- PRESERVA o id do slot
            v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric,
            nullif(v_slot->>'categoria_id','')::uuid,
            coalesce((v_slot->>'usar_estoque')::boolean, false),
            v_slot->'proporcoes',
            nullif(v_slot->>'categoria_tecido_id','')::uuid,
            nullif(v_slot->>'mix_id','')::uuid,
            coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(v_slot->'referencia_paths','[]'::jsonb)) t(x)), '{}'),
            case when nullif(v_slot->>'modelo_id','') is null then v_tt end)  -- [tamanho-em v1] com card: NULL
          returning id into v_slot_id;
        -- [tamanho-em v1] vaga COM card: grava no modelo SÓ quando a tela marca tamanho_tipo_tocado (a pessoa trocou).
        -- Filtro loja + coleção + interno fecha o IDOR do modelo_id vindo do cliente (fora dele: ignorado) e espelha a
        -- tela (o toggle só existe no interno). Card integravel/integrado recusa 42501 via trg_zz_integracao_trava.
        if nullif(v_slot->>'modelo_id','') is not null and coalesce(v_slot->>'tamanho_tipo_tocado', '') = 'true' then
          if v_tt is null or v_tt not in ('letra', 'numero') then
            raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
          end if;
          update public.modelos m set tamanho_tipo = v_tt
           where m.id = (v_slot->>'modelo_id')::uuid
             and m.tenant_id = (select c.tenant_id from public.colecoes c where c.id = _colecao_id)
             and m.colecao_id = _colecao_id
             and coalesce(m.origem, 'interno') = 'interno'
             and m.tamanho_tipo is distinct from v_tt;
        end if;
        for v_mat in select * from jsonb_array_elements(coalesce(v_slot->'materiais','[]'::jsonb)) loop
          insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
            values (v_slot_id, nullif(v_mat->>'artigo_id','')::uuid, coalesce(v_mat->>'tipo','tecido'),
              coalesce((v_mat->>'numero')::int,1), coalesce((v_mat->>'consumo')::numeric,0),
              coalesce((v_mat->>'loss_percent')::numeric,0), coalesce((v_mat->>'ordem')::int,0))
            returning id into v_mat_id;
          -- [DEDUP] variante repetida (mesma cor real, ou mesma cor planejada) só entra 1× por
          -- material — mantém a de MAIOR grade_total (empate → menor ordem/posição original);
          -- linha sem identidade (variante e cor nulos) nunca colapsa. NUNCA soma. Ordem 1..n.
          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total, distribuicao, atende)
          select v_mat_id, w.variante_tecido_id, w.cor_id, w.cor_apelido_id,
                 (row_number() over (order by w.ord_min, w.pos_min))::int,
                 w.multiplicador, w.grades, w.grade_total, w.distribuicao, w.atende
          from (
            select r.*,
                   row_number() over (partition by r.dkey order by r.grade_total desc, r.ord_orig asc, r.pos asc) as rn,
                   min(r.ord_orig) over (partition by r.dkey) as ord_min,
                   min(r.pos)      over (partition by r.dkey) as pos_min
            from (
              select
                nullif(e->>'variante_tecido_id','')::uuid  as variante_tecido_id,
                nullif(e->>'cor_id','')::uuid              as cor_id,
                nullif(e->>'cor_apelido_id','')::uuid      as cor_apelido_id,
                coalesce((e->>'multiplicador')::numeric,1) as multiplicador,
                coalesce(e->'grades','{}'::jsonb)          as grades,
                coalesce((e->>'grade_total')::int,0)       as grade_total,
                -- Distribuição por produto (20261006100000): `distribuicao` SÓ no Tecido 1 e só objeto; `atende` SÓ fora
                -- do Tecido 1 e só array (o DEDUP leva as da linha vencedora).
                case when coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1 and jsonb_typeof(e->'distribuicao') = 'object'
                     then e->'distribuicao' else '{}'::jsonb end as distribuicao,
                case when not (coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1) and jsonb_typeof(e->'atende') = 'array'
                     then e->'atende' else null end as atende,
                coalesce((e->>'ordem')::int, pos::int)     as ord_orig,
                pos,
                case
                  when nullif(e->>'variante_tecido_id','') is not null
                    then 'v:'||(e->>'variante_tecido_id')
                  when nullif(e->>'cor_id','') is not null or nullif(e->>'cor_apelido_id','') is not null
                    then 'p:'||coalesce(e->>'cor_id','')||'|'||coalesce(e->>'cor_apelido_id','')
                  else 'n:'||pos::text
                end as dkey
              from jsonb_array_elements(coalesce(v_mat->'variantes','[]'::jsonb)) with ordinality as t(e, pos)
            ) r
          ) w
          where w.rn = 1;
        end loop;
      end loop;
    end loop;
  end loop;

  -- re-liga o slot_oc pelos ids PRESERVADOS (slots que continuam existindo)
  if jsonb_array_length(v_slot_oc) > 0 then
    insert into plan_tecido_slot_oc (colecao_id, slot_id, oc_tecido_id)
      select _colecao_id, (e->>'s')::uuid, (e->>'o')::uuid
      from jsonb_array_elements(v_slot_oc) e
      join plan_tecido_slots sl on sl.id = (e->>'s')::uuid
      join plan_tecido_linhas l on l.id = sl.linha_ref_id
      join plan_tecido_subcolecoes s on s.id = l.sub_id
      where s.plan_id = v_plan
      on conflict (slot_id, oc_tecido_id) do nothing;
  end if;

  -- bump da árvore do Plan. Tecido: NÃO precisa de update manual aqui. O insert/upsert em
  -- plan_tecido (topo desta função) já dispara trg_colab_bump (Task 1) → fn_colab_bump_plan()
  -- → UPDATE no-op em colecoes → trg_colab_plan_rev incrementa plan_rev em exatamente 1.
  -- (Um update explícito aqui SOMARIA um 2º bump — foi removido no fix round da revisão.)

  return v_plan;
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_criar_cards(_colecao_id uuid, _slots jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_criar_cards_core(public.get_user_tenant_id(), _colecao_id, _slots);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_criar_card(_colecao_id uuid, _slot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_criar_card_core(public.get_user_tenant_id(), _colecao_id, _slot);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_aplicar_ao_modelo(_slot_id uuid, _materiais jsonb, _confirmar_sobrescrita boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
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
  return public._replicar_cards_plan_tecido_core(v_tenant, _destino_colecao_id, _destino_subcolecao_id, _modelo_ids, _rev_base);
end $function$;

CREATE OR REPLACE FUNCTION public.salvar_colecao_mix(_id uuid, _colecao_id uuid, _subcolecao text, _nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := _id;
  v_nome text := btrim(coalesce(_nome, ''));
begin
  if v_nome = '' then
    raise exception 'Informe o nome do mix.';
  end if;

  begin
    if v_id is null then
      insert into public.colecao_mixes (colecao_id, subcolecao, nome,
             ordem)
      values (_colecao_id, _subcolecao, v_nome,
             coalesce((select max(ordem) + 1 from public.colecao_mixes
                       where colecao_id = _colecao_id and subcolecao is not distinct from _subcolecao), 0))
      returning id into v_id;
    else
      update public.colecao_mixes set nome = v_nome where id = v_id;  -- RLS restringe ao tenant
    end if;
  exception when unique_violation then
    raise exception 'Este mix já existe nesta subcoleção.';
  end;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.excluir_colecao_mix(_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  delete from public.colecao_mixes where id = _id;  -- RLS restringe ao tenant
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.lancar_modelo(uuid,date,boolean)', 'bc970584aef39ac8d5258b33c9cd7061'),
      ('public.conjunto_adicionar(uuid,uuid)', '2a50e68d81dc082db7f614a7a6a9b45d'),
      ('public.conjunto_remover(uuid)', 'cc26b50c101a0a20c2436d49356015dc'),
      ('public.salvar_grade_revenda(uuid,jsonb,integer)', '229622b44c073a14e1fa4e2eed21650f'),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb)', '2fede16942ba6253ba6ad7bb65a38b18'),
      ('public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)', '9a94559fb80bc83722c0a3bf889c4b1b'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)', 'c685d28c0d7b2dd74b0b4f3d5c4459e9'),
      ('public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)', 'd64cbee1b0ad8722bdde2ff86d979f9e'),
      ('public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)', '680d6d7fede3d2db47258396845f8fa7'),
      ('public.salvar_precos_fixo_produto_importado(uuid,boolean,numeric,boolean,numeric)', 'e5432858604e33a2dd785fc864ad89d5'),
      ('public.salvar_markups_produto_acabado(uuid,numeric,numeric)', 'acce9dfcf91dedac5c568ad8a2382885'),
      ('public.criar_card_produto_acabado(uuid)', '0264cdac0549b0a6bfd7d5bf92e90f38'),
      ('public.criar_cards_produto_acabado(uuid[])', '83fd36fafdd68dae108933257fd84b0c'),
      ('public.replicar_produtos_acabados(uuid,uuid,uuid[])', 'd43b226864f0c5a12a345440910d0fdd'),
      ('public.limpar_produto_acabado(uuid)', '964d18b0c9730ad21a5b6d9a9a03ee08'),
      ('public.excluir_produto_acabado(uuid)', 'a791e603148b35732f212aa1ecc1b3d4'),
      ('public.aplicar_produto_ao_modelo(uuid)', 'c6c9994f1a00edee787b4125fc2bb2ef'),
      ('public.criar_card_produto_importado(uuid)', '7546855157595eff70ac9f77790c994d'),
      ('public.criar_cards_produto_importado(uuid[])', '105ccfe7874f39b4031e38db4706ad02'),
      ('public.replicar_produtos_importados(uuid,uuid,uuid[])', '778443bdba406b32da722bc1ea8dca77'),
      ('public.limpar_produto_importado(uuid)', '814f7c172ff20a59346c1a0a2097c158'),
      ('public.excluir_produto_importado(uuid)', 'ecffacb8aac6179dfca1ad59b070e51e'),
      ('public.importar_modelo_linha(jsonb,jsonb)', 'd115a79214c47214918dfa7136c22b72'),
      ('public.importar_produto_linha(jsonb,jsonb,text)', 'fd00ccb80d28a79fed1f0b021e46e07f'),
      ('public.integracao_salvar(jsonb,jsonb)', '18e1ecfc6d9856bad902e5c6bc9aaef3'),
      ('public.salvar_plan_tecido(uuid,jsonb,integer)', '50302aae4851bcd710ee7facec5ebc03'),
      ('public._salvar_plan_tecido_core(uuid,jsonb,integer)', '81a3606444a2cf68ee376937009b9bad'),
      ('public.plan_tecido_criar_cards(uuid,jsonb)', '88c22ce40dc15f88e08af185e23fbc08'),
      ('public.plan_tecido_criar_card(uuid,jsonb)', 'a2a4bb5de9793afb2711b50bef4970f7'),
      ('public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)', '25077223a646fdb8fd5db03ad65b0fc4'),
      ('public.aplicar_plan_tecido_grade(uuid,jsonb)', '347219fb550ea1c342637ded5a80fa32'),
      ('public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])', '48582c67c272cb30e4c6931f5f885e90'),
      ('public.plan_tecido_desfazer_pedido(uuid)', '7df69a65ea9b64db4c8ca4c36c20e4ed'),
      ('public.plan_tecido_set_oc_aplicada(uuid,uuid[])', '71859c9c1004bf2ef43b1e610fed7bb9'),
      ('public.plan_tecido_set_paleta(uuid,jsonb)', 'a26ae3008da0bf65acfd318f6cc3d2ae'),
      ('public.plan_tecido_set_pedido_fotos(uuid,text,text[])', 'a15f8a31b4b36244d84e043931e1fdf2'),
      ('public.plan_tecido_set_referencia(uuid,text[])', '307e56cdfb8945eb009d0834bd2f6843'),
      ('public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])', '0f7d3e3bec86a5dee9ddb77551e086cb'),
      ('public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)', 'a8172b9ffa18cb84e2db24beeb51eb41'),
      ('public.salvar_colecao_mix(uuid,uuid,text,text)', 'b3c12a28bec8c7646f82c739c4b55055'),
      ('public.excluir_colecao_mix(uuid)', 'd1131b0ddf792d87e92ea7db0ca89e2c')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's3d_gates_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (left(r.f, 8) <> 'public._') THEN
      RAISE EXCEPTION 's3d_gates_down: pos-condicao falhou no EXECUTE de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
