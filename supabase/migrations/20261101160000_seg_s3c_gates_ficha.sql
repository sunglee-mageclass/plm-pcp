-- Reforço de segurança — sub-release S3c ("Ficha técnica, CAD, M.O. e B3"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.5, §2.7 B3, §5, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B).
-- Permissao de PAGINA no servidor (P-231 = D2 A) na ficha tecnica/CAD/M.O., com o helper _seg_exige_pagina da S3a (42501
-- 'sem_permissao_pagina: <chaves>'), logo depois da checagem de login/modulo que ja existe (o _core segue sem EXECUTE, inv. 9):
-- M1 salvar_modelo_bom (Desenvolvimento; BOM INICIAL de modelo sem tecido/aviamento tambem Planejamento), salvar_cad_completo,
-- enviar_modelo_para_cad, excluir_cad = Desenvolvimento; salvar_modelo_servico_mo (P-244 = B) = EDITAR o Planejamento E ver
-- custos (42501 'mao_obra_sem_permissao:'); prova_comentar/_resolver/_excluir = modulo Criacao + Desenvolvimento (C14);
-- marcar_revisao_por_mudanca e marcar_revisao_pendente (sql -> plpgsql) = modulo Criacao + Planejamento OU Desenvolvimento OU
-- Plan. Tecido (C14). B3: set_artigo_categorias ignora categoria de outra loja; _plan_tecido_arvore_core so junta modelo da
-- loja do plano. Nenhuma GUC nova.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb,integer)
--     ANTES  25fe991666987cf10d285f72ab08641b
--     DEPOIS 42d05bcf0f41a517ab73c7beb37d5c99
--   public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)
--     ANTES  140eef0b9563420ec27af07f7346813a
--     DEPOIS eba98c3bed577eedfdb5aad91a8a9b50
--   public.enviar_modelo_para_cad(uuid,text,text)
--     ANTES  0ba99e761c58da0b5304a35cf00ce7ec
--     DEPOIS 52fa66fc058af40264f5536185bc7a9a
--   public.excluir_cad(uuid)
--     ANTES  a737f81cfd9c08abc8ac2a581aa88db4
--     DEPOIS ba41974bab8c81cd2729da7f440dcef3
--   public.salvar_modelo_servico_mo(uuid,jsonb)
--     ANTES  9a192fad5d62bf5f20f9ea88e6c1be88
--     DEPOIS 3afb7fd75fdf4c8e12751d804b2861b1
--   public.prova_comentar(uuid,text,uuid)
--     ANTES  a0d692f6e3c22deb08a1fb99a9037e3b
--     DEPOIS cbedfe465bab885dd2e860f20f6c2ba4
--   public.prova_resolver(uuid,boolean)
--     ANTES  a57e7bb488d0a2d59cb2464e104975dc
--     DEPOIS 53a3efab69ac3d7c825bdeb0fa13ed3d
--   public.prova_excluir(uuid)
--     ANTES  4b49851dc684d0300d6b8dbbcf8bf92f
--     DEPOIS 4c3804c9ea6e5e3fabd61cc4e1682367
--   public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)
--     ANTES  105d1d0eb3b2d0678a28a8edb21dd3af
--     DEPOIS a98d8650da2e08696d7a619f97ead5ec
--   public.marcar_revisao_pendente(uuid,text[])
--     ANTES  aaab228d06e2277eaae8f797e00e285c
--     DEPOIS 1f623c133bc0cae79283a7517f9405d0
--   public.set_artigo_categorias(uuid,uuid[])
--     ANTES  e46f5d73d2f9ec81bd75b7dc566c099c
--     DEPOIS 03a85084aa485236b9bf5295c8dbd3bf
--   public._plan_tecido_arvore_core(uuid)
--     ANTES  5111f417c2679a4bb2157ad0df61f55a
--     DEPOIS 7659339f6781ba94decf5fc65524608a
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION): nenhuma tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101160000_seg_s3c_gates_ficha_down.sql (LIFO: 20261101180000_down → 170000_down → 160000_down, ANTES dos inversos da S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3c-report.md, seção "Cadeia md5").
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
  IF md5(pg_get_functiondef(to_regprocedure('public._seg_exige_pagina(text[])'))) IS DISTINCT FROM '85eff0037e61fdecefb46154ac9479d2' THEN
    RAISE EXCEPTION 's3c_gates: rode antes a S3a 20261101100000 (_seg_exige_pagina ausente ou com texto inesperado)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb,integer)', '25fe991666987cf10d285f72ab08641b', '42d05bcf0f41a517ab73c7beb37d5c99'),
      ('public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)', '140eef0b9563420ec27af07f7346813a', 'eba98c3bed577eedfdb5aad91a8a9b50'),
      ('public.enviar_modelo_para_cad(uuid,text,text)', '0ba99e761c58da0b5304a35cf00ce7ec', '52fa66fc058af40264f5536185bc7a9a'),
      ('public.excluir_cad(uuid)', 'a737f81cfd9c08abc8ac2a581aa88db4', 'ba41974bab8c81cd2729da7f440dcef3'),
      ('public.salvar_modelo_servico_mo(uuid,jsonb)', '9a192fad5d62bf5f20f9ea88e6c1be88', '3afb7fd75fdf4c8e12751d804b2861b1'),
      ('public.prova_comentar(uuid,text,uuid)', 'a0d692f6e3c22deb08a1fb99a9037e3b', 'cbedfe465bab885dd2e860f20f6c2ba4'),
      ('public.prova_resolver(uuid,boolean)', 'a57e7bb488d0a2d59cb2464e104975dc', '53a3efab69ac3d7c825bdeb0fa13ed3d'),
      ('public.prova_excluir(uuid)', '4b49851dc684d0300d6b8dbbcf8bf92f', '4c3804c9ea6e5e3fabd61cc4e1682367'),
      ('public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)', '105d1d0eb3b2d0678a28a8edb21dd3af', 'a98d8650da2e08696d7a619f97ead5ec'),
      ('public.marcar_revisao_pendente(uuid,text[])', 'aaab228d06e2277eaae8f797e00e285c', '1f623c133bc0cae79283a7517f9405d0'),
      ('public.set_artigo_categorias(uuid,uuid[])', 'e46f5d73d2f9ec81bd75b7dc566c099c', '03a85084aa485236b9bf5295c8dbd3bf'),
      ('public._plan_tecido_arvore_core(uuid)', '5111f417c2679a4bb2157ad0df61f55a', '7659339f6781ba94decf5fc65524608a')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 's3c_gates: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.salvar_modelo_bom(_modelo_id uuid, _tecidos jsonb, _aviamentos jsonb, _grades jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A; M1): exige EDITAR criacao_desenvolvimento.
  -- Excecao do BOM INICIAL (card novo e Duplicar do Planejamento): modelo SEM nenhuma linha em modelo_tecidos/modelo_aviamentos
  -- tambem aceita criacao_planejamento.
  IF EXISTS (SELECT 1 FROM public.modelo_tecidos WHERE modelo_id = _modelo_id)
     OR EXISTS (SELECT 1 FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id) THEN
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  ELSE
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento', 'criacao_planejamento');
  END IF;
  PERFORM public._salvar_modelo_bom_core(_modelo_id, _tecidos, _aviamentos, _grades, _rev_base);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_cad_completo(_modelo_id uuid, _tecidos jsonb, _grades jsonb, _aviamentos jsonb, _etiquetas jsonb, _proporcoes jsonb, _observacoes_molde text, _data_previsao_corte date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  RETURN public._salvar_cad_completo_core(_modelo_id, _tecidos, _grades, _aviamentos, _etiquetas, _proporcoes, _observacoes_molde, _data_previsao_corte);
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

CREATE OR REPLACE FUNCTION public.excluir_cad(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modelo uuid; v_enviado boolean;
  v_explosao_antes text;  -- [seg s1 M2]
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  SELECT tenant_id, modelo_id, COALESCE(enviado_corte, false)
    INTO v_tenant, v_modelo, v_enviado FROM public.cad WHERE id = _cad_id;
  IF v_modelo IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF v_enviado THEN
    RAISE EXCEPTION 'Este CAD já foi enviado ao corte (baixou estoque). Reverta o corte antes de excluir.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lancamentos WHERE cad_id = _cad_id) THEN
    RAISE EXCEPTION 'Este CAD tem lançamentos e não pode ser excluído.';
  END IF;
  DELETE FROM public.cad WHERE id = _cad_id;  -- rascunho (sem corte): cascatas internas ok
  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] excluir o CAD (rascunho) devolve o card
  PERFORM set_config('app.explosao_sistema', 'on', true);
  UPDATE public.modelos SET enviado_cad = false WHERE id = v_modelo;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
END;
$function$;

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
  -- [seg s3c] (Reforco de seguranca S3c, P-244 = B) VALORES de mao de obra: so quem EDITA o Planejamento E ve custos
  -- (_pode_ver_custos). Quem so edita o Desenvolvimento ou o card do Produto Acabado/Importado nao muda valor (os precos sao
  -- dados sensiveis). Aprovar/reprovar segue em aprovar_servico_mo (producao_servico_aprovacao, inv. 12).
  IF NOT (public.user_can_edit('criacao_planejamento') AND public._pode_ver_custos()) THEN
    RAISE EXCEPTION 'mao_obra_sem_permissao: editar criacao_planejamento e ver custos' USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_modelo_servico_mo_core(_modelo_id, _linhas);
END $function$;

CREATE OR REPLACE FUNCTION public.prova_comentar(_modelo_id uuid, _texto text, _parent_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_uid uuid := auth.uid();
  v_top uuid := NULL;
  v_new uuid;
BEGIN
  IF v_tenant IS NULL OR v_uid IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  -- [seg s3c] (C14) modulo Criacao (mensagem de sempre) + pagina.
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  IF _texto IS NULL OR btrim(_texto) = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = '42501';
  END IF;
  IF _parent_id IS NOT NULL THEN
    SELECT COALESCE(c.parent_id, c.id) INTO v_top          -- resposta de resposta achata no topo
      FROM public.modelo_prova_comentarios c
      WHERE c.id = _parent_id AND c.tenant_id = v_tenant AND c.modelo_id = _modelo_id;
    IF v_top IS NULL THEN RAISE EXCEPTION 'Comentário pai inválido'; END IF;
  END IF;
  INSERT INTO public.modelo_prova_comentarios (tenant_id, modelo_id, parent_id, user_id, texto)
  VALUES (v_tenant, _modelo_id, v_top, v_uid, btrim(_texto))
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prova_resolver(_id uuid, _resolvido boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_uid uuid := auth.uid();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant' USING ERRCODE = '42501'; END IF;
  -- [seg s3c] (C14) modulo Criacao (mensagem de sempre) + pagina.
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  UPDATE public.modelo_prova_comentarios
     SET resolvido = _resolvido,
         resolvido_at = CASE WHEN _resolvido THEN now() ELSE NULL END,
         resolvido_por = CASE WHEN _resolvido THEN v_uid ELSE NULL END
   WHERE id = _id AND tenant_id = v_tenant AND parent_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fio não encontrado'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prova_excluir(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_uid uuid := auth.uid();
BEGIN
  -- [seg s3c] (C14) modulo Criacao (mensagem de sempre) + pagina.
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  IF NOT EXISTS (
    SELECT 1 FROM public.modelo_prova_comentarios
    WHERE id = _id AND tenant_id = v_tenant AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Só o autor pode excluir' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.modelo_prova_comentarios WHERE id = _id AND tenant_id = v_tenant AND user_id = v_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_revisao_por_mudanca(_modelo_id uuid, _grade boolean, _consumo boolean, _aviamentos boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cad uuid; v_etapas text[] := '{}';
BEGIN
  IF v_tenant IS NULL THEN RETURN '{}'::jsonb; END IF;
  -- [seg s3c] (C14) modulo Criacao (mensagem de sempre) + pagina.
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_planejamento OU criacao_desenvolvimento OU criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento', 'criacao_plan_tecido');
  IF NOT (_grade OR _consumo OR _aviamentos) THEN RETURN '{}'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT id INTO v_cad FROM public.cad WHERE modelo_id = _modelo_id LIMIT 1;
  IF v_cad IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Só a GRADE afeta as etapas de PEÇA (quantidades/split por peça). Consumo/aviamento afetam
  -- apenas a metragem do corte (Explosão), tratada por reenvio — sem flag de #Erro aqui.
  IF _grade THEN
    IF EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'terceirizados'); END IF;
    IF EXISTS (SELECT 1 FROM public.producao_oficina      WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'oficina'); END IF;
    IF EXISTS (SELECT 1 FROM public.controle_qualidade    WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'cq'); END IF;
    IF EXISTS (SELECT 1 FROM public.direcionamento        WHERE cad_id = v_cad)
       OR EXISTS (SELECT 1 FROM public.direcionamento_lojas dl WHERE dl.cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'direcionamento'); END IF;
    -- Fonte única (tabela lancamentos aposentada): modelos.lancado.
    IF (SELECT COALESCE(lancado, false) FROM public.modelos WHERE id = _modelo_id) THEN v_etapas := array_append(v_etapas, 'lancamentos'); END IF;
  END IF;

  IF array_length(v_etapas, 1) > 0 THEN
    UPDATE public.modelos
       SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb)
                              || (SELECT jsonb_object_agg(e, true) FROM unnest(v_etapas) e)
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(e, true) FROM unnest(v_etapas) e), '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_revisao_pendente(_modelo_id uuid, _etapas text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [seg s3c] (Reforco de seguranca S3c; C14 + P-231 = D2 A) marca o #Erro nas etapas: exige o modulo Criacao e EDITAR o
-- Planejamento OU o Desenvolvimento OU o Plan. Tecido. O UPDATE e o de sempre (so o modelo da loja do usuario).
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento', 'criacao_plan_tecido');
  UPDATE public.modelos
     SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb)
                            || COALESCE((SELECT jsonb_object_agg(e, true) FROM unnest(_etapas) e), '{}'::jsonb)
   WHERE id = _modelo_id AND tenant_id = public.get_user_tenant_id()
     AND array_length(_etapas, 1) > 0;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_artigo_categorias(_artigo_id uuid, _cat_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not exists (select 1 from artigos where id = _artigo_id and tenant_id = v_tenant) then
    raise exception 'Tecido não encontrado';
  end if;
  delete from artigo_categorias_tecido where artigo_id = _artigo_id;
  if array_length(_cat_ids, 1) is not null then
    insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id)
    -- [seg s3c] (Reforco de seguranca S3c, B3) so categoria da MESMA loja do tecido; a de outra loja (ou inexistente) e ignorada.
    select _artigo_id, ct.id from public.categorias_tecido ct
     where ct.id = any (_cat_ids) and ct.tenant_id = v_tenant;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p.id is null then null else jsonb_build_object(
    'plan_id', p.id, 'colecao_id', p.colecao_id,
    'subcolecoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'subcolecao_id', s.subcolecao_id, 'ordem', s.ordem,
        'categorias_tecido', coalesce((select jsonb_agg(sc.categoria_id order by sc.ordem, sc.created_at)
          from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
            'slots', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sl.id, 'modelo_id', sl.modelo_id, 'ref', m.ref, 'nome', coalesce(m.nome, sl.nome),
                'thumb_path', coalesce((m.fotos_modelo)[1], m.desenho_tecnico_url, m.croqui_url),
                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id, 'mix_id', case when sl.modelo_id is not null then m.mix_id else sl.mix_id end,
                'tamanho_tipo', case when sl.modelo_id is not null then m.tamanho_tipo else sl.tamanho_tipo end,  -- [tamanho-em v1]
                'usar_estoque', sl.usar_estoque,
                'proporcoes', coalesce(sl.proporcoes, m.proporcoes),
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'referencia_paths', to_jsonb(coalesce(sl.referencia_paths,'{}'::text[])),
                'materiais', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', mt.id, 'artigo_id', mt.artigo_id, 'artigo_nome', a.nome,
                    'unidade_medida', a.unidade_medida, 'rendimento', a.rendimento,
                    'preco_por_metro', a.preco_por_metro,
                    'tipo', mt.tipo, 'numero', mt.numero, 'consumo', mt.consumo,
                    'loss_percent', mt.loss_percent, 'ordem', mt.ordem,
                    'variantes', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', vv.id, 'variante_tecido_id', vv.variante_tecido_id,
                        'variante_artigo_id', vt.artigo_id,
                        'cor_id', vv.cor_id, 'cor_apelido_id', vv.cor_apelido_id,
                        'label', concat_ws(' - ', coalesce(cor.nome, pcor.nome), coalesce(ap.nome, pap.nome)),
                        'cor_nome', coalesce(cor.nome, pcor.nome),
                        'ordem', vv.ordem, 'multiplicador', vv.multiplicador,
                        'grades', vv.grades, 'grade_total', vv.grade_total,
                        'distribuicao', vv.distribuicao, 'atende', vv.atende) order by vv.ordem)
                      from plan_tecido_variantes vv
                      left join variantes_tecido vt on vt.id = vv.variante_tecido_id
                      left join cores cor on cor.id = vt.cor_id
                      left join cores_apelido ap on ap.id = vt.cor_apelido_id
                      left join cores pcor on pcor.id = vv.cor_id
                      left join cores_apelido pap on pap.id = vv.cor_apelido_id
                      where vv.material_id = mt.id), '[]'::jsonb)) order by mt.ordem)
                  from plan_tecido_materiais mt
                  left join artigos a on a.id = mt.artigo_id
                  where mt.slot_id = sl.id), '[]'::jsonb)) order by sl.slot_index)
              from plan_tecido_slots sl
              left join modelos m on m.id = sl.modelo_id and m.tenant_id = p.tenant_id  -- [seg s3c] B3: so modelo da loja do plano
              where sl.linha_ref_id = l.id), '[]'::jsonb)) order by l.ordem)
          from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)) order by s.ordem)
      from plan_tecido_subcolecoes s where s.plan_id = p.id), '[]'::jsonb)
  ) end
  from (select id, colecao_id, tenant_id from plan_tecido where colecao_id = _colecao_id) p;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb,integer)', '42d05bcf0f41a517ab73c7beb37d5c99'),
      ('public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)', 'eba98c3bed577eedfdb5aad91a8a9b50'),
      ('public.enviar_modelo_para_cad(uuid,text,text)', '52fa66fc058af40264f5536185bc7a9a'),
      ('public.excluir_cad(uuid)', 'ba41974bab8c81cd2729da7f440dcef3'),
      ('public.salvar_modelo_servico_mo(uuid,jsonb)', '3afb7fd75fdf4c8e12751d804b2861b1'),
      ('public.prova_comentar(uuid,text,uuid)', 'cbedfe465bab885dd2e860f20f6c2ba4'),
      ('public.prova_resolver(uuid,boolean)', '53a3efab69ac3d7c825bdeb0fa13ed3d'),
      ('public.prova_excluir(uuid)', '4c3804c9ea6e5e3fabd61cc4e1682367'),
      ('public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)', 'a98d8650da2e08696d7a619f97ead5ec'),
      ('public.marcar_revisao_pendente(uuid,text[])', '1f623c133bc0cae79283a7517f9405d0'),
      ('public.set_artigo_categorias(uuid,uuid[])', '03a85084aa485236b9bf5295c8dbd3bf'),
      ('public._plan_tecido_arvore_core(uuid)', '7659339f6781ba94decf5fc65524608a')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's3c_gates: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (left(r.f, 8) <> 'public._') THEN
      RAISE EXCEPTION 's3c_gates: pos-condicao falhou no EXECUTE de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
