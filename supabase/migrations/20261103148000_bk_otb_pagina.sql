-- Backend B5 — OTB grava so com a pagina OTB (desenho item 9; P-258 = A; ruling R2). GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk5.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (§10 B5, §0 K5, §13; Rulings R1/R2); camada/plan.md ruling R2 (feito no worktree camada).
-- O que muda (so INSERCAO de texto sobre o texto vivo; nada mais nas 10 funcoes):
--   1) fn_seg_modulo_otb (gatilho trg_aaa_seg_modulo das 12 tabelas do OTB, BEFORE I/U/D, SECURITY INVOKER, so morde
--      current_user authenticated/anon): depois da checagem do MODULO (que continua vindo antes, Mod T1), o portao de PAGINA
--      _seg_exige_pagina('otb') = escrita direta pela API e as 6 RPCs INVOKER do OTB (salvar_colecao_pv, salvar_mix_padrao,
--      excluir_mix_padrao, salvar_simulacao, excluir_simulacao, aplicar_simulacao) exigem EDITAR a pagina OTB.
--   2) as 9 RPCs SECURITY DEFINER do OTB (rodam como postgres: o gatilho nao as morde - ruling R2): otb_salvar_colecao,
--      otb_confirmar, otb_confirmar_pv, otb_desconfirmar, otb_excluir_colecao, otb_importar_colecoes, otb_atribuir_card,
--      aplicar_simulacao_modelo, criar_card_simulacao ganham PERFORM _seg_exige_pagina('otb') logo depois da checagem do
--      modulo e ANTES de qualquer busca (sem oraculo).
--   Recusa = 42501 'sem_permissao_pagina: otb' (ASCII; a tela ja traduz em erro-mensagem.ts, mensagemSegS3). Passam: quem edita
--   a pagina OTB, admin da loja, super admin; sem JWT/postgres/service_role (gatilho); CASCADE de FK. Leitura (otb_orcamento,
--   sidebar_badges, SELECT) nao muda. Plan. Tecido (bump de colecoes.plan_rev/otb_rev) e DEFINER e segue passando.
-- Gatilhos, ACL, SECURITY e search_path ficam iguais (guarda/pos-condicao). Nenhum objeto novo (sem _down_drop). Nenhum dado muda.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_modulo_otb()  [INVOKER, gatilho]
--     ANTES  8fda935ba8d7703f03a1d093a00dcbdb
--     DEPOIS 352310db50b9c65d59ee8cac28b1af80
--   public.otb_salvar_colecao(jsonb)  [DEFINER]
--     ANTES  df2a3b972a0d48cf80369d029a9fd1bb
--     DEPOIS 102b85903cb30103c6f68c7715537ba5
--   public.otb_confirmar(uuid)  [DEFINER]
--     ANTES  0e968a691fb381723c3c5ce1d4b672ba
--     DEPOIS 514245119b80691ff6e1b32b15f5326e
--   public.otb_confirmar_pv(uuid)  [DEFINER]
--     ANTES  1c90ab56b3ee72efacece9135a8f58a6
--     DEPOIS d7d3895ee574b7a46f32e429cb2faa14
--   public.otb_desconfirmar(uuid)  [DEFINER]
--     ANTES  2c018e00c2561df61a87300210fc2a4f
--     DEPOIS c471d040acd2d5f6ddff2a832450ab50
--   public.otb_excluir_colecao(uuid)  [DEFINER]
--     ANTES  4ba36eb4972d10832ed8eb1e8b89adea
--     DEPOIS 2ec1895cfcdc3d741835d4e09eddf60a
--   public.otb_importar_colecoes()  [DEFINER]
--     ANTES  bdd5472fd355098b0571ba24c67a6306
--     DEPOIS 50a1006be3ee922d619ec05359845baa
--   public.otb_atribuir_card(uuid,uuid,text)  [DEFINER]
--     ANTES  3fc94ea41477c519d501d6f040b01507
--     DEPOIS d9ce250866d3f8197ec806ac82e52c14
--   public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)  [DEFINER]
--     ANTES  3e44d809ad10cde058c9ce5c619295b0
--     DEPOIS 6c8c12d01dcc19b38c2a81c25c895c45
--   public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)  [DEFINER]
--     ANTES  180344c8d351c594448a3bf47ae72ed1
--     DEPOIS 05334a66c8736637e40f036f14da1dc6
--   dependencias fixadas: public._seg_exige_pagina(text[]) = 85eff0037e61fdecefb46154ac9479d2; public.tenant_module_enabled(text) = ddd46592f2ff7cdb352778c605ecd8a4
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 10 funcoes): nenhuma tabela (o gatilho NAO e recriado), nada de
-- auth/storage/realtime. Sem DROP, sem CREATE/DROP TRIGGER/POLICY, sem NOTIFY (assinaturas iguais). Idempotente.
-- Volta: supabase/rollback/20261103148000_bk_otb_pagina_down.sql (LIFO: depois do inverso da Camada e antes do da B3 147000;
-- e ANTES de qualquer inverso antigo que guarde estas funcoes por md5 - ver md5-bk5.txt: S4 20261101230000_down/_down_drop
-- (fn_seg_modulo_otb), Mod T2 20261103110000_down (otb_excluir_colecao), S3a 20261101100000_down_drop (helper)).
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
  n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_modulo_otb()', '8fda935ba8d7703f03a1d093a00dcbdb', '352310db50b9c65d59ee8cac28b1af80'),
      ('public.otb_salvar_colecao(jsonb)', 'df2a3b972a0d48cf80369d029a9fd1bb', '102b85903cb30103c6f68c7715537ba5'),
      ('public.otb_confirmar(uuid)', '0e968a691fb381723c3c5ce1d4b672ba', '514245119b80691ff6e1b32b15f5326e'),
      ('public.otb_confirmar_pv(uuid)', '1c90ab56b3ee72efacece9135a8f58a6', 'd7d3895ee574b7a46f32e429cb2faa14'),
      ('public.otb_desconfirmar(uuid)', '2c018e00c2561df61a87300210fc2a4f', 'c471d040acd2d5f6ddff2a832450ab50'),
      ('public.otb_excluir_colecao(uuid)', '4ba36eb4972d10832ed8eb1e8b89adea', '2ec1895cfcdc3d741835d4e09eddf60a'),
      ('public.otb_importar_colecoes()', 'bdd5472fd355098b0571ba24c67a6306', '50a1006be3ee922d619ec05359845baa'),
      ('public.otb_atribuir_card(uuid,uuid,text)', '3fc94ea41477c519d501d6f040b01507', 'd9ce250866d3f8197ec806ac82e52c14'),
      ('public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)', '3e44d809ad10cde058c9ce5c619295b0', '6c8c12d01dcc19b38c2a81c25c895c45'),
      ('public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)', '180344c8d351c594448a3bf47ae72ed1', '05334a66c8736637e40f036f14da1dc6')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'bk5_otb_pagina: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._seg_exige_pagina(text[])', '85eff0037e61fdecefb46154ac9479d2'),
      ('public.tenant_module_enabled(text)', 'ddd46592f2ff7cdb352778c605ecd8a4')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk5_otb_pagina: dependencia % com texto inesperado (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- o gatilho que chama fn_seg_modulo_otb e o de hoje nas 12 tabelas do OTB (BEFORE I/U/D FOR EACH ROW, ligado)
  SELECT count(*) INTO n FROM pg_trigger g
   WHERE NOT g.tgisinternal AND g.tgfoid = to_regprocedure('public.fn_seg_modulo_otb()') AND g.tgname = 'trg_aaa_seg_modulo'
     AND g.tgenabled = 'O' AND g.tgtype = 31
     AND g.tgrelid IN (to_regclass('public.colecao_pv_itens'), to_regclass('public.colecao_semana_categorias'), to_regclass('public.colecao_semanas'), to_regclass('public.colecao_subcolecoes'), to_regclass('public.colecoes'), to_regclass('public.mix_padrao_linhas'), to_regclass('public.mix_padroes'), to_regclass('public.otb_simulacao_linhas'), to_regclass('public.otb_simulacao_modelos'), to_regclass('public.otb_simulacao_unidades'), to_regclass('public.otb_simulacao_variantes'), to_regclass('public.otb_simulacoes'));
  IF n <> 12 THEN
    RAISE EXCEPTION 'bk5_otb_pagina: gatilho trg_aaa_seg_modulo ausente ou diferente nas tabelas do OTB (% de 12)', n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_seg_modulo_otb()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s4] (Reforco de seguranca S4, C1) BRECHA DE MODULO na escrita das tabelas do OTB (colecoes, colecao_*, mix_padroes/_linhas, otb_simulacao*): com o modulo 'otb'
-- desligado na loja, o cliente nao grava nada (nem direto pela API, nem pelas RPCs SECURITY INVOKER, que gravam como ele).
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, que ja conferem o modulo), CASCADE de FK, migrations/psql e service_role passam. O super admin
-- passa (tenant_module_enabled devolve true para ele). Leitura (SELECT) nao e tocada: sem policy, o Realtime segue igual.
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.tenant_module_enabled('otb') THEN
    RAISE EXCEPTION 'Módulo otb não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [backend B5 / P-258 A] com o modulo ligado, gravar o OTB (direto ou pelas RPCs INVOKER) exige EDITAR a pagina OTB.
  IF current_user IN ('authenticated', 'anon') THEN
    PERFORM public._seg_exige_pagina('otb');
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.otb_salvar_colecao(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant   uuid    := public.get_user_tenant_id();
  v_id       uuid    := nullif(_payload->>'id','')::uuid;
  v_nome     text    := trim(coalesce(_payload->>'nome',''));
  v_subs     jsonb   := coalesce(_payload->'subs', '[]'::jsonb);
  v_has_subs boolean := jsonb_array_length(v_subs) > 0;
  v_kept     uuid[];
  v_sub      jsonb;
  v_sub_id   uuid;
  v_weeks    jsonb;
  v_cats     jsonb;
  v_meta     jsonb;
  v_i        int := 0;
  v_orfa     text;
  v_rev_base int := nullif(_payload->>'rev_base','')::int;
  v_rev      int;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_nome = '' then raise exception 'Informe o nome da coleção.'; end if;

  -- Upsert da coleção.
  if v_id is null then
    insert into colecoes (nome, ano_id, mes_id, orcamento)
    values (v_nome, nullif(_payload->>'ano_id','')::uuid, nullif(_payload->>'mes_id','')::uuid,
            nullif(_payload->>'orcamento','')::numeric)
    returning id into v_id;  -- set_tenant_id_trg preenche tenant_id
  else
    -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. rev_base null = bypass.
    if v_rev_base is not null then
      select otb_rev into v_rev from colecoes where id = v_id and tenant_id = v_tenant for update;
      if v_rev is distinct from v_rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa' using errcode='P0409';
      end if;
    end if;
    update colecoes set
      nome = v_nome,
      ano_id = nullif(_payload->>'ano_id','')::uuid,
      mes_id = nullif(_payload->>'mes_id','')::uuid,
      orcamento = nullif(_payload->>'orcamento','')::numeric
    where id = v_id and tenant_id = v_tenant;
    if not found then raise exception 'Coleção não encontrada'; end if;
  end if;

  -- Regrava do zero: apaga semanas + distribuição (todos os níveis) da coleção (derivado/barato).
  delete from colecao_semana_categorias where colecao_id = v_id;
  delete from colecao_semanas where colecao_id = v_id;

  if v_has_subs then
    -- Subcoleções que continuam (as que trazem id). As demais serão removidas.
    select coalesce(array_agg(nullif(s->>'id','')::uuid) filter (where nullif(s->>'id','') is not null), '{}'::uuid[])
      into v_kept from jsonb_array_elements(v_subs) s;

    -- Antes de remover: bloqueia se alguma removida tem Planejamento de Tecido vinculado.
    select cs.nome into v_orfa
      from colecao_subcolecoes cs
      join plan_tecido_subcolecoes pts on pts.subcolecao_id = cs.id
     where cs.colecao_id = v_id and not (cs.id = any(v_kept))
     order by cs.ordem limit 1;
    if v_orfa is not null then
      raise exception 'A subcoleção "%" tem Planejamento de Tecido vinculado — remova o planejamento dela antes de excluí-la.', v_orfa using errcode='P0001';
    end if;
    delete from colecao_subcolecoes where colecao_id = v_id and not (id = any(v_kept));

    -- Insere/atualiza cada subcoleção (na ordem) + regrava suas semanas e distribuição.
    for v_sub in select value from jsonb_array_elements(v_subs) loop
      v_sub_id := nullif(v_sub->>'id','')::uuid;
      if v_sub_id is null then
        insert into colecao_subcolecoes (colecao_id, nome, ordem)
        values (v_id, v_sub->>'nome', v_i) returning id into v_sub_id;
      else
        update colecao_subcolecoes set nome = v_sub->>'nome', ordem = v_i
        where id = v_sub_id and colecao_id = v_id;
      end if;
      v_weeks := coalesce(v_sub->'weeks', '{}'::jsonb);
      v_cats  := coalesce(v_sub->'cats',  '{}'::jsonb);
      v_meta  := coalesce(v_sub->'meta',  '{}'::jsonb);
      insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada, texto, data)
        select v_id, v_sub_id, k, coalesce((v_weeks->>k)::int, 0),
               nullif(v_meta->k->>'texto',''), nullif(v_meta->k->>'data','')::date
        from jsonb_object_keys(v_weeks) k;
      insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
        select v_id, v_sub_id, wk.key, cat.key::uuid, cat.value::int
        from jsonb_each(v_cats) wk, jsonb_each_text(wk.value) cat
        where (v_weeks ? wk.key) and cat.value::int > 0;
      v_i := v_i + 1;
    end loop;
  else
    -- Sem subcoleções: remove todas — mas bloqueia se alguma tem Planejamento de Tecido.
    select cs.nome into v_orfa
      from colecao_subcolecoes cs
      join plan_tecido_subcolecoes pts on pts.subcolecao_id = cs.id
     where cs.colecao_id = v_id
     order by cs.ordem limit 1;
    if v_orfa is not null then
      raise exception 'A subcoleção "%" tem Planejamento de Tecido vinculado — remova o planejamento dela antes de excluí-la.', v_orfa using errcode='P0001';
    end if;
    delete from colecao_subcolecoes where colecao_id = v_id;
    v_weeks := coalesce(_payload->'weeks',    '{}'::jsonb);
    v_cats  := coalesce(_payload->'weekCats', '{}'::jsonb);
    v_meta  := coalesce(_payload->'weeksMeta','{}'::jsonb);
    insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada, texto, data)
      select v_id, null, k, coalesce((v_weeks->>k)::int, 0),
             nullif(v_meta->k->>'texto',''), nullif(v_meta->k->>'data','')::date
      from jsonb_object_keys(v_weeks) k;
    insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
      select v_id, null, wk.key, cat.key::uuid, cat.value::int
      from jsonb_each(v_cats) wk, jsonb_each_text(wk.value) cat
      where (v_weeks ? wk.key) and cat.value::int > 0;
  end if;

  -- Atribuições de cards feitas NO EDITOR (não-classificados), aplicadas junto no Save.
  if jsonb_array_length(coalesce(_payload->'assignments','[]'::jsonb)) > 0 then
    perform set_config('app.otb_reconciling', 'on', true);
    for v_sub in select value from jsonb_array_elements(_payload->'assignments') loop
      if nullif(v_sub->>'sub_nome','') is not null
         and not exists (select 1 from public.colecao_subcolecoes where colecao_id = v_id and nome = v_sub->>'sub_nome') then
        raise exception 'Subcoleção "%" não encontrada para atribuição', v_sub->>'sub_nome';
      end if;
      update public.modelos set subcolecao = nullif(v_sub->>'sub_nome',''), semana = v_sub->>'semana'
      where id = (v_sub->>'modelo_id')::uuid and colecao_id = v_id and tenant_id = v_tenant;
    end loop;
    perform set_config('app.otb_reconciling', 'off', true);
  end if;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.otb_confirmar(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='confirmada' where id=_colecao_id and tenant_id=v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;
  return jsonb_build_object('confirmada', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_confirmar_pv(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='confirmada'
   where id=_colecao_id and tenant_id=v_tenant and tipo='poder_venda';
  if not found then raise exception 'Coleção (poder de venda) não encontrada'; end if;
  return jsonb_build_object('confirmada', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_desconfirmar(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='rascunho' where id=_colecao_id and tenant_id=v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;
  return jsonb_build_object('confirmada', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_excluir_colecao(_colecao_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_planejados int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  -- [modularidade P-255 A] trava a linha da colecao ANTES de contar: card que grava colecao_id pega FOR KEY SHARE nela (FK)
  -- e conflita com FOR UPDATE - o card em voo termina antes (e e contado) ou espera esta transacao (e falha na FK depois).
  perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Coleção não encontrada'; end if;

  -- [modularidade P-255 A] colecao com QUALQUER card no Planejamento e recusada (antes: so 'planejado'; os demais eram apagados).
  -- O plano de tecido da colecao segue apagado junto (o front avisa).
  select count(*) into v_planejados from modelos
    where tenant_id = v_tenant and colecao_id = _colecao_id;
  if v_planejados > 0 then
    raise exception 'colecao_com_cards: %', v_planejados using errcode = 'P0001';
  end if;

  perform set_config('app.otb_reconciling', 'on', true);
  -- [modularidade P-255 A] o 'delete from modelos' saiu: card NUNCA e apagado com a colecao (a FK NO ACTION de
  -- modelos.colecao_id recusa o delete da colecao se ainda houver card apontando para ela).
  -- apaga a árvore de Plan. Tecido antes do cascade de colecoes (FK NO ACTION em subcolecao_id)
  delete from plan_tecido where colecao_id = _colecao_id;
  delete from colecoes where id = _colecao_id and tenant_id = v_tenant;
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_importar_colecoes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_col_id uuid; v_imp int := 0; v_vin int := 0; v_n int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  perform set_config('app.otb_reconciling', 'on', true);

  for v_nome in
    select distinct trim(colecao) from modelos
    where tenant_id = v_tenant and colecao_id is null and coalesce(trim(colecao),'') <> ''
  loop
    select id into v_col_id from colecoes where tenant_id = v_tenant and nome = v_nome;
    if v_col_id is null then
      insert into colecoes (tenant_id, nome, status) values (v_tenant, v_nome, 'rascunho') returning id into v_col_id;
      v_imp := v_imp + 1;
    end if;
    update modelos set colecao_id = v_col_id
      where tenant_id = v_tenant and colecao_id is null and trim(colecao) = v_nome;
    get diagnostics v_n = row_count;
    v_vin := v_vin + v_n;
  end loop;

  perform set_config('app.otb_reconciling', 'off', true);
  return jsonb_build_object('importadas', v_imp, 'vinculados', v_vin);
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_atribuir_card(_modelo_id uuid, _subcolecao_id uuid, _semana text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_colecao uuid;
  v_subnome text;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if coalesce(_semana,'') = '' then raise exception 'Informe a semana'; end if;

  select colecao_id into v_colecao from modelos where id = _modelo_id and tenant_id = v_tenant;
  if not found or v_colecao is null then raise exception 'Card não encontrado ou sem coleção'; end if;

  if _subcolecao_id is not null then
    select nome into v_subnome from colecao_subcolecoes where id = _subcolecao_id and colecao_id = v_colecao and tenant_id = v_tenant;
    if v_subnome is null then raise exception 'Subcoleção inválida'; end if;
  end if;

  update modelos set subcolecao = v_subnome, semana = _semana
    where id = _modelo_id and tenant_id = v_tenant;
end $function$;

CREATE OR REPLACE FUNCTION public.aplicar_simulacao_modelo(_modelo_id uuid, _oc_id uuid, _variantes jsonb, _grade jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('otb') THEN
    RAISE EXCEPTION 'Módulo otb não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  IF (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id) = 'aprovado' THEN
    RAISE EXCEPTION 'Modelo aprovado — não é possível sobrescrever pela simulação.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._aplicar_sim_no_modelo_core(_modelo_id, _oc_id, _variantes, _grade);
END;
$function$;

CREATE OR REPLACE FUNCTION public.criar_card_simulacao(_colecao_id uuid, _subcolecao_id uuid, _semana text, _linha_id uuid, _categoria_id uuid, _oc_id uuid, _variantes jsonb, _grade jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_modelo uuid; v_subnome text;
BEGIN
  IF NOT public.tenant_module_enabled('otb') THEN
    RAISE EXCEPTION 'Módulo otb não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('otb');  -- [backend B5 / P-258 A] gravar o OTB exige EDITAR a pagina OTB
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.colecoes WHERE id = _colecao_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não encontrada';
  END IF;
  IF _subcolecao_id IS NOT NULL THEN
    SELECT nome INTO v_subnome FROM public.colecao_subcolecoes
     WHERE id = _subcolecao_id AND colecao_id = _colecao_id AND tenant_id = v_tenant;
    IF v_subnome IS NULL THEN RAISE EXCEPTION 'Subcoleção inválida'; END IF;
  END IF;

  INSERT INTO public.modelos
    (tenant_id, nome, colecao_id, subcolecao, semana, linha_id, categoria_principal_id, status_desenvolvimento)
  VALUES (v_tenant, 'Novo modelo', _colecao_id, v_subnome, NULLIF(_semana,''), _linha_id, _categoria_id, 'em_modelagem')
  RETURNING id INTO v_modelo;

  PERFORM public._aplicar_sim_no_modelo_core(v_modelo, _oc_id, _variantes, _grade);
  RETURN v_modelo;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_modulo_otb()', '352310db50b9c65d59ee8cac28b1af80', '{postgres=X/postgres,service_role=X/postgres}', false, 'search_path=public', false),
      ('public.otb_salvar_colecao(jsonb)', '102b85903cb30103c6f68c7715537ba5', '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', true, 'search_path=public', true),
      ('public.otb_confirmar(uuid)', '514245119b80691ff6e1b32b15f5326e', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.otb_confirmar_pv(uuid)', 'd7d3895ee574b7a46f32e429cb2faa14', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.otb_desconfirmar(uuid)', 'c471d040acd2d5f6ddff2a832450ab50', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.otb_excluir_colecao(uuid)', '2ec1895cfcdc3d741835d4e09eddf60a', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.otb_importar_colecoes()', '50a1006be3ee922d619ec05359845baa', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.otb_atribuir_card(uuid,uuid,text)', 'd9ce250866d3f8197ec806ac82e52c14', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.aplicar_simulacao_modelo(uuid,uuid,jsonb,jsonb)', '6c8c12d01dcc19b38c2a81c25c895c45', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true),
      ('public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)', '05334a66c8736637e40f036f14da1dc6', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', true, 'search_path=public', true)
    ) AS x(f, m, acl, sd, cfg, auth) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk5_otb_pagina: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = r.cfg)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.auth
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'bk5_otb_pagina: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
