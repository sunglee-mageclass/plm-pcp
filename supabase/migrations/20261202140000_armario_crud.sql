-- F7 · Armario - Task C3, BANCO: 6 RPCs de ciclo de vida do armario (cada uma wrapper + _core): criar, renomear, excluir, duplicar, reordenar, status.
-- Plano: docs/superpowers/plans/2026-11-16-f7-armario.md (Task C3). Molde de estrutura/guardas: 20261202130000_armario_salvar.sql (C2).
-- Depende das tabelas da A1 (armarios, armario_itens) e do gatilho da A2 (que so morde o PAPEL do cliente: aqui os _core rodam como DEFINER,
-- entao a guarda de "publicado" e CONFERIDA em cada _core, com a linha travada FOR UPDATE).
--
-- ASSINATURAS (wrappers, o que o front chama):
--   armario_criar(_colecao_id uuid, _colecao text, _subcolecao text, _nome text)            -> uuid   (vazio, status 'rascunho', 5 colunas, FIM da subcolecao)
--   armario_renomear(_id uuid, _nome text)                                                  -> void   (recusa publicado)
--   armario_excluir(_id uuid)                                                               -> void   (itens vao por CASCADE; recusa publicado)
--   armario_duplicar(_id uuid, _novo_nome text)                                             -> uuid   (cabecalho+colunas + TODOS os itens na mesma ordem; status 'rascunho'; FIM da subcolecao)
--   armario_reordenar(_subcolecao_ids jsonb)                                                -> void   (lista ORDENADA de ids da MESMA subcolecao; ordem = indice 1-based; NAO bloqueia publicado)
--   armario_status(_id uuid, _novo text)                                                    -> void   (rascunho<->pronto, pronto<->publicado; unica porta p/ SAIR de publicado)
--
-- REGRAS (nos _core):
--   * ANTI-CROSS-TENANT: todo armario/colecao tem que ser da loja do usuario (get_user_tenant_id()); inexistente ou de outra loja =
--     P0001 armario_nao_encontrado (reordenar: a lista inteira; um id alheio recusa tudo, nada e renumerado).
--   * Guarda de PUBLICADO (SELECT ... FOR UPDATE): renomear e excluir recusam armario publicado (P0001 armario_publicado_travado) - o gatilho A2
--     so morde o papel do cliente, entao a RPC confere por conta propria. DUPLICAR de publicado e permitido (a copia nasce 'rascunho').
--     REORDENAR NAO bloqueia por publicado (decisao do dono: a ordem e meta da subcolecao, nao conteudo do armario).
--   * Status: so as transicoes rascunho->pronto, pronto->rascunho, pronto->publicado, publicado->pronto. Qualquer outra (inclusive "para o
--     mesmo estado", rascunho->publicado, publicado->rascunho, valor desconhecido) = P0001 armario_status_invalido. Espelha a lib B3 transicaoValida.
--   * Ordem no fim: criar/duplicar pegam coalesce(max(ordem),0)+1 da (loja, colecao_id, subcolecao) sob pg_advisory_xact_lock (sem corrida
--     entre 2 criacoes simultaneas). 'ordem' nao e unique; reordenar renumera so os ids recebidos.
--   * Mensagens de RAISE so ASCII nos P0001 (viram 400, a tela traduz pelo prefixo); 42501 ASCII tambem.
--
-- SEGURANCA: wrapper SECURITY DEFINER + SET search_path TO 'public': login (42501) + modulo 'criacao' (42501, como lancar_modelo/C2) +
-- _seg_exige_pagina('criacao_armario') (42501) -> _core. _core SECURITY DEFINER com REVOKE EXECUTE de PUBLIC/anon/authenticated (so o
-- wrapper o alcanca). Wrapper: REVOKE PUBLIC/anon; GRANT authenticated + service_role. Toda tabela lida e filtrada por tenant explicito.
--
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE). Nada em auth/storage/realtime; sem policy/gatilho/tabela. Idempotente.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- Volta: supabase/rollback/20261202140000_armario_crud_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regclass('public.armarios') IS NULL OR to_regclass('public.armario_itens') IS NULL THEN
    RAISE EXCEPTION 'armario_c3_dep: tabelas armarios/armario_itens ausentes (aplicar a A1 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_armario_trava_publicado()') IS NULL THEN
    RAISE EXCEPTION 'armario_c3_dep: gatilho de trava ausente (aplicar a A2 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._seg_exige_pagina(text[])') IS NULL THEN
    RAISE EXCEPTION 'armario_c3_dep: _seg_exige_pagina ausente (S3a)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NULL OR to_regprocedure('public.get_user_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'armario_c3_dep: tenant_module_enabled/get_user_tenant_id ausentes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- ======================================================================================================================================
-- CRIAR
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._armario_criar_core(_colecao_id uuid, _colecao text, _subcolecao text, _nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid := public.get_user_tenant_id();
  v_nome     text := btrim(coalesce(_nome, ''));
  v_sub      text := btrim(coalesce(_subcolecao, ''));
  v_col_nome text;
  v_id       uuid;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF v_nome = '' THEN
    RAISE EXCEPTION 'armario_nome_obrigatorio: informe o nome do armario' USING ERRCODE = 'P0001';
  END IF;
  IF _colecao_id IS NOT NULL THEN
    SELECT c.nome::text INTO v_col_nome FROM public.colecoes c WHERE c.id = _colecao_id AND c.tenant_id = v_tenant;
    IF v_col_nome IS NULL THEN
      RAISE EXCEPTION 'armario_colecao_invalida: colecao nao encontrada nesta loja' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- serializa criacoes na mesma subcolecao (ordem = fim da lista, sem corrida)
  PERFORM pg_advisory_xact_lock(hashtextextended('armario_ordem|' || v_tenant::text || '|' || coalesce(_colecao_id::text, '') || '|' || v_sub, 0));

  INSERT INTO public.armarios (tenant_id, colecao_id, colecao, subcolecao, nome, colunas, status, ordem)
  VALUES (v_tenant, _colecao_id, coalesce(nullif(btrim(coalesce(_colecao, '')), ''), v_col_nome), v_sub, v_nome, 5, 'rascunho',
          coalesce((SELECT max(a.ordem) FROM public.armarios a
                     WHERE a.tenant_id = v_tenant AND a.colecao_id IS NOT DISTINCT FROM _colecao_id AND a.subcolecao = v_sub), 0) + 1)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_criar(_colecao_id uuid, _colecao text, _subcolecao text, _nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [F7 armario C3] ESCRITA: login + modulo Criacao + permissao de PAGINA (EDITAR criacao_armario) -> _core.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  RETURN public._armario_criar_core(_colecao_id, _colecao, _subcolecao, _nome);
END;
$function$;

-- ======================================================================================================================================
-- RENOMEAR
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._armario_renomear_core(_id uuid, _nome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome   text := btrim(coalesce(_nome, ''));
  v_status text;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF v_nome = '' THEN
    RAISE EXCEPTION 'armario_nome_obrigatorio: informe o nome do armario' USING ERRCODE = 'P0001';
  END IF;
  SELECT a.status INTO v_status FROM public.armarios a WHERE a.id = _id AND a.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION 'armario_publicado_travado: armario publicado e so-leitura (despublique antes de renomear)' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.armarios SET nome = v_nome WHERE id = _id AND tenant_id = v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_renomear(_id uuid, _nome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  PERFORM public._armario_renomear_core(_id, _nome);
END;
$function$;

-- ======================================================================================================================================
-- EXCLUIR
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._armario_excluir_core(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_status text;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  SELECT a.status INTO v_status FROM public.armarios a WHERE a.id = _id AND a.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  -- mesma regra do gatilho A2 (que nao morde o DEFINER): publicado nao se exclui - despublica antes
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION 'armario_publicado_travado: armario publicado nao pode ser excluido (despublique antes)' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.armarios WHERE id = _id AND tenant_id = v_tenant; -- itens: ON DELETE CASCADE
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_excluir(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  PERFORM public._armario_excluir_core(_id);
END;
$function$;

-- ======================================================================================================================================
-- DUPLICAR
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._armario_duplicar_core(_id uuid, _novo_nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome   text := btrim(coalesce(_novo_nome, ''));
  v_src    record;
  v_id     uuid;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF v_nome = '' THEN
    RAISE EXCEPTION 'armario_nome_obrigatorio: informe o nome do novo armario' USING ERRCODE = 'P0001';
  END IF;
  -- origem: da loja (ANTI-CROSS-TENANT); FOR SHARE segura um salvar concorrente ate a copia terminar. Publicado PODE ser copiado.
  SELECT a.colecao_id, a.colecao, a.subcolecao, a.colunas INTO v_src
    FROM public.armarios a WHERE a.id = _id AND a.tenant_id = v_tenant FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('armario_ordem|' || v_tenant::text || '|' || coalesce(v_src.colecao_id::text, '') || '|' || v_src.subcolecao, 0));

  INSERT INTO public.armarios (tenant_id, colecao_id, colecao, subcolecao, nome, colunas, status, ordem)
  VALUES (v_tenant, v_src.colecao_id, v_src.colecao, v_src.subcolecao, v_nome, v_src.colunas, 'rascunho',
          coalesce((SELECT max(a.ordem) FROM public.armarios a
                     WHERE a.tenant_id = v_tenant AND a.colecao_id IS NOT DISTINCT FROM v_src.colecao_id AND a.subcolecao = v_src.subcolecao), 0) + 1)
  RETURNING id INTO v_id;

  -- itens: copia fiel (snapshot de cor/ponteiros/origem) na MESMA ordem
  INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem)
  SELECT v_tenant, v_id, i.modelo_id, i.origem, i.variante_tecido_id, i.produto_variante_id, i.cor_id, i.cor_apelido_id, i.ordem
    FROM public.armario_itens i
   WHERE i.armario_id = _id AND i.tenant_id = v_tenant
   ORDER BY i.ordem;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_duplicar(_id uuid, _novo_nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  RETURN public._armario_duplicar_core(_id, _novo_nome);
END;
$function$;

-- ======================================================================================================================================
-- REORDENAR (NAO bloqueia por publicado)
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._armario_reordenar_core(_subcolecao_ids jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_el     jsonb;
  v_n      int;
  v_achou  int;
  v_grupos int;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF _subcolecao_ids IS NULL OR jsonb_typeof(_subcolecao_ids) <> 'array' THEN
    RAISE EXCEPTION 'armario_ids_invalido: informe a lista ordenada de ids dos armarios' USING ERRCODE = 'P0001';
  END IF;

  FOR v_el IN SELECT value FROM jsonb_array_elements(_subcolecao_ids) LOOP
    IF jsonb_typeof(v_el) <> 'string' THEN
      RAISE EXCEPTION 'armario_ids_invalido: a lista deve conter so ids (texto)' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_ids := v_ids || (v_el #>> '{}')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'armario_ids_invalido: id malformado na lista' USING ERRCODE = 'P0001';
    END;
  END LOOP;
  v_n := coalesce(array_length(v_ids, 1), 0);
  IF v_n = 0 THEN
    RETURN; -- nada a renumerar
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> v_n THEN
    RAISE EXCEPTION 'armario_ids_invalido: a lista repete um armario' USING ERRCODE = 'P0001';
  END IF;

  -- ANTI-CROSS-TENANT: todos da loja (travados em ordem de id: sem deadlock entre 2 reordenacoes); todos da MESMA subcolecao
  SELECT count(*), count(DISTINCT (s.colecao_id, s.subcolecao)) INTO v_achou, v_grupos
    FROM (SELECT a.colecao_id, a.subcolecao FROM public.armarios a
           WHERE a.id = ANY (v_ids) AND a.tenant_id = v_tenant ORDER BY a.id FOR UPDATE) s;
  IF v_achou <> v_n THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  IF v_grupos <> 1 THEN
    RAISE EXCEPTION 'armario_ids_invalido: a lista deve ser de uma unica subcolecao' USING ERRCODE = 'P0001';
  END IF;

  -- ordem = indice 1-based (nao confere status: reordenar e meta da subcolecao, publicado incluso)
  UPDATE public.armarios a
     SET ordem = o.pos
    FROM unnest(v_ids) WITH ORDINALITY AS o(id, pos)
   WHERE a.id = o.id AND a.tenant_id = v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_reordenar(_subcolecao_ids jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  PERFORM public._armario_reordenar_core(_subcolecao_ids);
END;
$function$;

-- ======================================================================================================================================
-- STATUS (unica porta para SAIR de 'publicado')
-- ======================================================================================================================================
CREATE OR REPLACE FUNCTION public._armario_status_core(_id uuid, _novo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cur    text;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  SELECT a.status INTO v_cur FROM public.armarios a WHERE a.id = _id AND a.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  -- transicoes validas (espelha transicaoValida da lib B3)
  IF _novo IS NULL OR NOT (   (v_cur = 'rascunho'  AND _novo = 'pronto')
                           OR (v_cur = 'pronto'    AND _novo IN ('rascunho', 'publicado'))
                           OR (v_cur = 'publicado' AND _novo = 'pronto')) THEN
    RAISE EXCEPTION 'armario_status_invalido: transicao % -> % nao permitida', v_cur, coalesce(left(_novo, 20), 'nulo') USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.armarios SET status = _novo WHERE id = _id AND tenant_id = v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_status(_id uuid, _novo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'modulo_desligado: criacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_armario');
  PERFORM public._armario_status_core(_id, _novo);
END;
$function$;

-- ======================================================================================================================================
-- ACL: _core fechado (so o wrapper alcanca); wrapper so authenticated/service_role
-- ======================================================================================================================================
REVOKE EXECUTE ON FUNCTION public._armario_criar_core(uuid, text, text, text)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_renomear_core(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_excluir_core(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_duplicar_core(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_reordenar_core(jsonb)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_status_core(uuid, text)                FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.armario_criar(uuid, text, text, text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_renomear(uuid, text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_excluir(uuid)                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_duplicar(uuid, text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_reordenar(jsonb)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_status(uuid, text)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armario_criar(uuid, text, text, text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_renomear(uuid, text)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_excluir(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_duplicar(uuid, text)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_reordenar(jsonb)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_status(uuid, text)               TO authenticated, service_role;

DO $pos$
DECLARE
  v_w oid[] := ARRAY[
    to_regprocedure('public.armario_criar(uuid,text,text,text)'), to_regprocedure('public.armario_renomear(uuid,text)'),
    to_regprocedure('public.armario_excluir(uuid)'), to_regprocedure('public.armario_duplicar(uuid,text)'),
    to_regprocedure('public.armario_reordenar(jsonb)'), to_regprocedure('public.armario_status(uuid,text)')];
  v_c oid[] := ARRAY[
    to_regprocedure('public._armario_criar_core(uuid,text,text,text)'), to_regprocedure('public._armario_renomear_core(uuid,text)'),
    to_regprocedure('public._armario_excluir_core(uuid)'), to_regprocedure('public._armario_duplicar_core(uuid,text)'),
    to_regprocedure('public._armario_reordenar_core(jsonb)'), to_regprocedure('public._armario_status_core(uuid,text)')];
  v_o oid;
  v_p record;
BEGIN
  FOREACH v_o IN ARRAY v_w || v_c LOOP
    IF v_o IS NULL THEN
      RAISE EXCEPTION 'armario_c3_pos: funcao ausente' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR v_p IN SELECT p.oid, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = ANY (v_w || v_c) LOOP
    IF NOT v_p.prosecdef OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION 'armario_c3_pos: secdef/config errado em %', v_p.oid::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_o IN ARRAY v_c LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE') OR has_function_privilege('authenticated', v_o, 'EXECUTE') THEN
      RAISE EXCEPTION 'armario_c3_pos: _core exposto: %', v_o::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_o IN ARRAY v_w LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_o, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_o, 'EXECUTE') THEN
      RAISE EXCEPTION 'armario_c3_pos: grants errados no wrapper %', v_o::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = ANY (v_w || v_c) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'armario_c3_pos: PUBLIC com EXECUTE' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
