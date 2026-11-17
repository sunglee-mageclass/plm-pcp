-- F7 · Armario - ANO/MES proprio do armario (nao mais por colecao/subcolecao). BANCO: schema + 5 RPCs reemitidas.
-- Decisao do dono: Ano e Mes sao dado NOVO e PROPRIO do armario, so para ORGANIZAR (SEM relacao com colecao), OBRIGATORIOS ao criar.
-- Criar armario deixa de exigir colecao/subcolecao; o dialog "+ Variante" ve variantes de QUALQUER colecao (a RPC deixa de restringir).
-- Os filtros Ano/Mes na lista passam a filtrar os ARMARIOS pelo ano/mes do PROPRIO armario.
--
-- O QUE MUDA:
--   1) SCHEMA armarios: + ano_id/mes_id (FK anos/meses, NO ACTION); subcolecao deixa de ser NOT NULL; indice de ordem passa a ser
--      por (tenant, ano_id, mes_id). colecao_id/colecao/subcolecao ficam como colunas LEGADAS (nullable; o salvar nao grava mais).
--   2) armario_criar: NOVA ASSINATURA (_ano_id uuid, _mes_id uuid, _nome text) - exige nome + ano + mes; SEM colecao. DROP da antiga de 4 args.
--   3) armario_salvar: NOVA ASSINATURA (_id, _ano_id, _mes_id, _nome, _colunas, _status, _itens) - grava ano/mes; SEM colecao/sub. DROP da antiga de 8 args.
--   4) armario_duplicar: copia ano_id/mes_id (ordem = fim do periodo). Assinatura inalterada (_id, _novo_nome).
--   5) armario_reordenar: agrupa por (ano_id, mes_id) (era colecao/sub). Assinatura inalterada (_subcolecao_ids jsonb).
--   6) armario_variantes_disponiveis: NOVA ASSINATURA (_armario_id uuid) - devolve TODAS as variantes da loja (sem restringir por colecao/sub)
--      + facetas novas colecao_nome/subcolecao/mes_nome para os filtros do dialog. DROP da antiga de 3 args (uuid,text,uuid).
--      GUARDA MD5: so reemite se o corpo vivo e o do deploy T4 (85bdc5cabf90c87c951a12a7f8aae310) ou ja o desta migration.
--
-- Mensagens de RAISE so ASCII nos P0001 (viram 400, a tela traduz pelo prefixo); 42501 ASCII tambem.
-- Trava: catalogo + ALTER TABLE armarios (AccessExclusive por instantes; tabela nova da frente F7, 0 linhas em prod). Idempotente.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- Volta: supabase/rollback/20261204100000_armario_ano_mes_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_oid oid := to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)');
  v_md5 text;
BEGIN
  IF to_regclass('public.armarios') IS NULL OR to_regclass('public.armario_itens') IS NULL THEN
    RAISE EXCEPTION 'armario_anomes_dep: tabelas armarios/armario_itens ausentes (aplicar a A1 antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.anos') IS NULL OR to_regclass('public.meses') IS NULL THEN
    RAISE EXCEPTION 'armario_anomes_dep: tabelas anos/meses ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._seg_exige_pagina(text[])') IS NULL
     OR to_regprocedure('public.tenant_module_enabled(text)') IS NULL
     OR to_regprocedure('public.get_user_tenant_id()') IS NULL
     OR to_regprocedure('public._grupo_eh_acessorio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'armario_anomes_dep: helper ausente (_seg_exige_pagina/tenant_module_enabled/get_user_tenant_id/_grupo_eh_acessorio)' USING ERRCODE = 'P0001';
  END IF;
  -- armario_variantes_disponiveis: GUARDA MD5 (so reemite do corpo esperado; ja desta migration = idempotente)
  IF v_oid IS NOT NULL THEN
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_oid;
    IF v_md5 NOT IN ('85bdc5cabf90c87c951a12a7f8aae310') THEN
      RAISE EXCEPTION 'armario_anomes_dep: corpo vivo de armario_variantes_disponiveis(uuid,text,uuid) difere do T4 esperado (md5 %)', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
END
$guarda$;

-- ======================================================================================================================================
-- 1) SCHEMA: ano_id/mes_id proprios; subcolecao deixa de ser NOT NULL; indice de ordem por (tenant, ano_id, mes_id)
-- ======================================================================================================================================
ALTER TABLE public.armarios ADD COLUMN IF NOT EXISTS ano_id uuid REFERENCES public.anos(id);
ALTER TABLE public.armarios ADD COLUMN IF NOT EXISTS mes_id uuid REFERENCES public.meses(id);
ALTER TABLE public.armarios ALTER COLUMN subcolecao DROP NOT NULL;

DROP INDEX IF EXISTS public.idx_armarios_tenant_colecao_sub_ordem;
CREATE INDEX IF NOT EXISTS idx_armarios_tenant_periodo_ordem ON public.armarios (tenant_id, ano_id, mes_id, ordem);

-- ======================================================================================================================================
-- 2) CRIAR - NOVA ASSINATURA (_ano_id, _mes_id, _nome); exige nome + ano + mes; SEM colecao
-- ======================================================================================================================================
DROP FUNCTION IF EXISTS public.armario_criar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public._armario_criar_core(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public._armario_criar_core(_ano_id uuid, _mes_id uuid, _nome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome   text := btrim(coalesce(_nome, ''));
  v_id     uuid;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF v_nome = '' THEN
    RAISE EXCEPTION 'armario_nome_obrigatorio: informe o nome do armario' USING ERRCODE = 'P0001';
  END IF;
  IF _ano_id IS NULL OR _mes_id IS NULL THEN
    RAISE EXCEPTION 'armario_periodo_obrigatorio: informe o ano e o mes do armario' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.anos a WHERE a.id = _ano_id AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'armario_periodo_invalido: ano nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meses m WHERE m.id = _mes_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'armario_periodo_invalido: mes nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;

  -- serializa criacoes do mesmo periodo (ordem = fim da lista, sem corrida)
  PERFORM pg_advisory_xact_lock(hashtextextended('armario_ordem|' || v_tenant::text || '|' || _ano_id::text || '|' || _mes_id::text, 0));

  INSERT INTO public.armarios (tenant_id, ano_id, mes_id, nome, colunas, status, ordem)
  VALUES (v_tenant, _ano_id, _mes_id, v_nome, 5, 'rascunho',
          coalesce((SELECT max(a.ordem) FROM public.armarios a
                     WHERE a.tenant_id = v_tenant AND a.ano_id = _ano_id AND a.mes_id = _mes_id), 0) + 1)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_criar(_ano_id uuid, _mes_id uuid, _nome text)
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
  RETURN public._armario_criar_core(_ano_id, _mes_id, _nome);
END;
$function$;

-- ======================================================================================================================================
-- 3) SALVAR - NOVA ASSINATURA (_id, _ano_id, _mes_id, _nome, _colunas, _status, _itens); grava ano/mes; SEM colecao/sub
-- ======================================================================================================================================
DROP FUNCTION IF EXISTS public.armario_salvar(uuid, uuid, text, text, text, integer, text, jsonb);
DROP FUNCTION IF EXISTS public._armario_salvar_core(uuid, uuid, text, text, text, integer, text, jsonb);

CREATE OR REPLACE FUNCTION public._armario_salvar_core(_id uuid, _ano_id uuid, _mes_id uuid, _nome text, _colunas integer, _status text, _itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid := public.get_user_tenant_id();
  v_id       uuid := _id;
  v_cur      record;
  v_nome     text := btrim(coalesce(_nome, ''));
  v_status   text;
  v_colunas  int;
  v_arr      jsonb;
  v_it       jsonb;
  v_i        int := 0;
  v_mod      uuid;
  v_vt       uuid;
  v_pv       uuid;
  v_origem   text;
  v_cor      uuid;
  v_ap       uuid;
  v_achou    boolean;
  v_rows     jsonb := '[]'::jsonb;
  v_chaves   text[] := ARRAY[]::text[];
  v_chave    text;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'armario_sem_loja: usuario sem loja ativa' USING ERRCODE = '42501';
  END IF;
  IF v_nome = '' THEN
    RAISE EXCEPTION 'armario_nome_obrigatorio: informe o nome do armario' USING ERRCODE = 'P0001';
  END IF;
  IF _ano_id IS NULL OR _mes_id IS NULL THEN
    RAISE EXCEPTION 'armario_periodo_obrigatorio: informe o ano e o mes do armario' USING ERRCODE = 'P0001';
  END IF;
  IF _colunas IS NOT NULL AND _colunas NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'armario_colunas_invalidas: colunas deve estar entre 1 e 12' USING ERRCODE = 'P0001';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('rascunho', 'pronto') THEN
    RAISE EXCEPTION 'armario_status_invalido: o salvar grava rascunho ou pronto (publicar e pela acao de status)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.anos a WHERE a.id = _ano_id AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'armario_periodo_invalido: ano nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meses m WHERE m.id = _mes_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'armario_periodo_invalido: mes nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;

  -- lista: NULL / 'null' / [] = vazia (aceita); so ARRAY e valido
  IF _itens IS NULL OR jsonb_typeof(_itens) = 'null' THEN
    v_arr := '[]'::jsonb;
  ELSIF jsonb_typeof(_itens) <> 'array' THEN
    RAISE EXCEPTION 'armario_itens_invalido: itens deve ser uma lista' USING ERRCODE = 'P0001';
  ELSE
    v_arr := _itens;
  END IF;

  -- armario existente: da loja (ANTI-CROSS-TENANT), travado, e NAO publicado
  IF v_id IS NOT NULL THEN
    SELECT a.status, a.colunas INTO v_cur FROM public.armarios a WHERE a.id = v_id AND a.tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
    END IF;
    IF v_cur.status = 'publicado' THEN
      RAISE EXCEPTION 'armario_publicado_travado: armario publicado e so-leitura (despublique antes de editar)' USING ERRCODE = 'P0001';
    END IF;
    v_status  := coalesce(_status, v_cur.status);
    v_colunas := coalesce(_colunas, v_cur.colunas);
  ELSE
    v_status  := coalesce(_status, 'rascunho');
    v_colunas := coalesce(_colunas, 5);
  END IF;

  -- itens: valida + deriva o snapshot ANTES de gravar (qualquer recusa desfaz tudo - a funcao e atomica)
  FOR v_it IN SELECT value FROM jsonb_array_elements(v_arr) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_it) <> 'object' THEN
      RAISE EXCEPTION 'armario_item_invalido: item % nao e um objeto', v_i USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_mod := nullif(v_it->>'modelo_id', '')::uuid;
      v_vt  := nullif(v_it->>'variante_tecido_id', '')::uuid;
      v_pv  := nullif(v_it->>'produto_variante_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'armario_item_invalido: item % com id malformado', v_i USING ERRCODE = 'P0001';
    END;
    IF v_mod IS NULL THEN
      RAISE EXCEPTION 'armario_item_invalido: item % sem modelo_id', v_i USING ERRCODE = 'P0001';
    END IF;
    IF v_vt IS NULL AND v_pv IS NULL THEN
      RAISE EXCEPTION 'armario_item_sem_variante: item % sem variante (produto sem cor nao entra no armario)', v_i USING ERRCODE = 'P0001';
    END IF;

    SELECT m.origem::text INTO v_origem FROM public.modelos m WHERE m.id = v_mod AND m.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'armario_item_modelo_invalido: item % com modelo inexistente ou de outra loja', v_i USING ERRCODE = 'P0001';
    END IF;

    -- de-dup (modelo + ponteiro; o ponteiro determina a cor, entao e a mesma tupla de identidade)
    v_chave := v_mod::text || '|' || coalesce(v_vt::text, '') || '|' || coalesce(v_pv::text, '');
    IF v_chave = ANY (v_chaves) THEN
      RAISE EXCEPTION 'armario_item_duplicado: item % repete uma variante ja colocada neste armario', v_i USING ERRCODE = 'P0001';
    END IF;
    v_chaves := v_chaves || v_chave;

    -- deriva a cor do PONTEIRO (a origem do modelo decide qual ponteiro vale)
    v_cor := NULL; v_ap := NULL; v_achou := false;
    IF v_origem = 'revenda' THEN
      IF v_vt IS NOT NULL OR v_pv IS NULL THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - produto de revenda usa produto_variante_id', v_i USING ERRCODE = 'P0001';
      END IF;
      SELECT true, pav.cor_id, pav.cor_apelido_id INTO v_achou, v_cor, v_ap
        FROM public.produto_acabado_variantes pav
        JOIN public.produtos_acabados pa ON pa.id = pav.produto_acabado_id AND pa.tenant_id = v_tenant
       WHERE pav.id = v_pv AND pav.tenant_id = v_tenant AND pa.modelo_id = v_mod;
    ELSIF v_origem = 'importado' THEN
      IF v_vt IS NOT NULL OR v_pv IS NULL THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - produto importado usa produto_variante_id', v_i USING ERRCODE = 'P0001';
      END IF;
      SELECT true, piv.cor_id, piv.cor_apelido_id INTO v_achou, v_cor, v_ap
        FROM public.produto_importado_variantes piv
        JOIN public.produtos_importados pi ON pi.id = piv.produto_importado_id AND pi.tenant_id = v_tenant
       WHERE piv.id = v_pv AND piv.tenant_id = v_tenant AND pi.modelo_id = v_mod;
    ELSE
      IF v_pv IS NOT NULL OR v_vt IS NULL THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - produto interno usa variante_tecido_id', v_i USING ERRCODE = 'P0001';
      END IF;
      -- interno: a variante tem que ser do Tecido 1 do BOM do modelo (regra da C1)
      SELECT true, vt.cor_id, vt.cor_apelido_id INTO v_achou, v_cor, v_ap
        FROM public.variantes_tecido vt
       WHERE vt.id = v_vt AND vt.tenant_id = v_tenant
         AND EXISTS (SELECT 1
                       FROM public.modelo_tecido_variantes mtv
                       JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
                      WHERE mtv.variante_tecido_id = vt.id AND mt.modelo_id = v_mod AND mt.tipo = 'tecido' AND mt.numero = 1);
    END IF;

    IF NOT coalesce(v_achou, false) OR v_cor IS NULL THEN
      -- "cor removida": item que ja esta NESTE armario com o mesmo ponteiro preserva o snapshot gravado; item novo = recusa
      v_cor := NULL; v_ap := NULL; v_achou := false;
      IF v_id IS NOT NULL THEN
        SELECT true, ai.cor_id, ai.cor_apelido_id INTO v_achou, v_cor, v_ap
          FROM public.armario_itens ai
         WHERE ai.armario_id = v_id AND ai.tenant_id = v_tenant AND ai.modelo_id = v_mod
           AND ai.variante_tecido_id IS NOT DISTINCT FROM v_vt AND ai.produto_variante_id IS NOT DISTINCT FROM v_pv
         LIMIT 1;
      END IF;
      IF NOT coalesce(v_achou, false) THEN
        RAISE EXCEPTION 'armario_item_variante_invalida: item % - variante inexistente, sem cor ou que nao pertence ao produto', v_i USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_rows := v_rows || jsonb_build_object(
      'modelo_id', v_mod, 'origem', coalesce(v_origem, 'interno'), 'variante_tecido_id', v_vt, 'produto_variante_id', v_pv,
      'cor_id', v_cor, 'cor_apelido_id', v_ap, 'ordem', v_i);
  END LOOP;

  -- cabecalho (ano/mes proprios; colecao_id/colecao/subcolecao ficam NULL - colunas legadas)
  IF v_id IS NULL THEN
    INSERT INTO public.armarios (tenant_id, ano_id, mes_id, nome, colunas, status, ordem)
    VALUES (v_tenant, _ano_id, _mes_id, v_nome, v_colunas, v_status,
            coalesce((SELECT max(a.ordem) FROM public.armarios a
                       WHERE a.tenant_id = v_tenant AND a.ano_id = _ano_id AND a.mes_id = _mes_id), 0) + 1)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.armarios
       SET ano_id  = _ano_id,
           mes_id  = _mes_id,
           nome    = v_nome,
           colunas = v_colunas,
           status  = v_status
     WHERE id = v_id AND tenant_id = v_tenant;
    DELETE FROM public.armario_itens WHERE armario_id = v_id AND tenant_id = v_tenant;
  END IF;

  -- itens: estado completo, ordem = indice 1-based
  BEGIN
    INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem)
    SELECT v_tenant, v_id, r.modelo_id, r.origem, r.variante_tecido_id, r.produto_variante_id, r.cor_id, r.cor_apelido_id, r.ordem
      FROM jsonb_to_recordset(v_rows) AS r(modelo_id uuid, origem text, variante_tecido_id uuid, produto_variante_id uuid, cor_id uuid, cor_apelido_id uuid, ordem int)
     ORDER BY r.ordem;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'armario_item_duplicado: a mesma variante aparece mais de uma vez neste armario' USING ERRCODE = 'P0001';
  END;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.armario_salvar(_id uuid, _ano_id uuid, _mes_id uuid, _nome text, _colunas integer, _status text, _itens jsonb)
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
  RETURN public._armario_salvar_core(_id, _ano_id, _mes_id, _nome, _colunas, _status, _itens);
END;
$function$;

-- ======================================================================================================================================
-- 4) DUPLICAR - copia ano_id/mes_id (ordem = fim do periodo). Assinatura inalterada (_id, _novo_nome).
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
  SELECT a.ano_id, a.mes_id, a.colunas INTO v_src
    FROM public.armarios a WHERE a.id = _id AND a.tenant_id = v_tenant FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('armario_ordem|' || v_tenant::text || '|' || coalesce(v_src.ano_id::text, '') || '|' || coalesce(v_src.mes_id::text, ''), 0));

  INSERT INTO public.armarios (tenant_id, ano_id, mes_id, nome, colunas, status, ordem)
  VALUES (v_tenant, v_src.ano_id, v_src.mes_id, v_nome, v_src.colunas, 'rascunho',
          coalesce((SELECT max(a.ordem) FROM public.armarios a
                     WHERE a.tenant_id = v_tenant AND a.ano_id IS NOT DISTINCT FROM v_src.ano_id AND a.mes_id IS NOT DISTINCT FROM v_src.mes_id), 0) + 1)
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

-- ======================================================================================================================================
-- 5) REORDENAR - agrupa por (ano_id, mes_id). Assinatura inalterada (_subcolecao_ids jsonb).
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

  -- ANTI-CROSS-TENANT: todos da loja (travados em ordem de id: sem deadlock entre 2 reordenacoes); todos do MESMO periodo (ano/mes)
  SELECT count(*), count(DISTINCT (s.ano_id, s.mes_id)) INTO v_achou, v_grupos
    FROM (SELECT a.ano_id, a.mes_id FROM public.armarios a
           WHERE a.id = ANY (v_ids) AND a.tenant_id = v_tenant ORDER BY a.id FOR UPDATE) s;
  IF v_achou <> v_n THEN
    RAISE EXCEPTION 'armario_nao_encontrado: armario inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  IF v_grupos <> 1 THEN
    RAISE EXCEPTION 'armario_ids_invalido: a lista deve ser de um unico periodo (ano/mes)' USING ERRCODE = 'P0001';
  END IF;

  -- ordem = indice 1-based (nao confere status: reordenar e meta do periodo, publicado incluso)
  UPDATE public.armarios a
     SET ordem = o.pos
    FROM unnest(v_ids) WITH ORDINALITY AS o(id, pos)
   WHERE a.id = o.id AND a.tenant_id = v_tenant;
END;
$function$;

-- ======================================================================================================================================
-- 6) VARIANTES DISPONIVEIS - NOVA ASSINATURA (_armario_id); TODAS as variantes da loja + facetas colecao/subcolecao/periodo p/ o dialog
-- ======================================================================================================================================
DROP FUNCTION IF EXISTS public.armario_variantes_disponiveis(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.armario_variantes_disponiveis(_armario_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_res    jsonb;
BEGIN
  -- [F7 armario ANO/MES] LEITURA: so confere login + loja; sem gate de pagina/modulo (leitura segue RLS/loja). TODAS as colecoes da loja.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'armario_nao_autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();

  WITH mods AS (
    SELECT m.id, m.nome::text AS nome, m.origem,
           coalesce(nullif(btrim(m.ref), ''), m.ref_auto) AS ref,
           coalesce(nullif(m.fotos_modelo[1], ''), nullif(m.desenho_tecnico_url, ''), nullif(m.croqui_url, '')) AS foto,
           m.categoria_principal_id, m.subcategoria1_id, m.linha_id, m.status_planejamento::text AS status_planejamento,
           m.mes_id, m.ano_id,
           -- faceta Colecao (rotulo): nome da colecao do OTB, senao o texto livre; vazio = null. Faceta Subcolecao: o texto do modelo.
           coalesce((SELECT c.nome::text FROM public.colecoes c WHERE c.id = m.colecao_id AND c.tenant_id = m.tenant_id),
                    nullif(btrim(coalesce(m.colecao, '')), '')) AS colecao_nome,
           nullif(btrim(coalesce(m.subcolecao, '')), '') AS subcolecao
      FROM public.modelos m
     WHERE m.tenant_id = v_tenant
  ),
  v_int AS (
    -- INTERNO = variantes do Tecido 1 do BOM (tipo 'tecido', numero 1); 1 por variante_tecido (menor ordem)
    SELECT DISTINCT ON (mo.id, vt.id)
           mo.id AS modelo_id, vt.id AS variante_tecido_id, NULL::uuid AS produto_variante_id,
           vt.cor_id, vt.cor_apelido_id, mtv.ordem
      FROM mods mo
      JOIN LATERAL (SELECT mt.id FROM public.modelo_tecidos mt
                     WHERE mt.modelo_id = mo.id AND mt.tipo = 'tecido' AND mt.numero = 1
                     ORDER BY mt.created_at, mt.id LIMIT 1) t1 ON true
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = t1.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
     WHERE mo.origem NOT IN ('revenda', 'importado') AND vt.cor_id IS NOT NULL
     ORDER BY mo.id, vt.id, mtv.ordem
  ),
  v_rev AS (
    SELECT mo.id AS modelo_id, NULL::uuid AS variante_tecido_id, pav.id AS produto_variante_id,
           pav.cor_id, pav.cor_apelido_id, pav.ordem
      FROM mods mo
      JOIN public.produtos_acabados pa ON pa.modelo_id = mo.id AND pa.tenant_id = v_tenant
      JOIN public.produto_acabado_variantes pav ON pav.produto_acabado_id = pa.id AND pav.tenant_id = v_tenant
     WHERE mo.origem = 'revenda' AND pav.cor_id IS NOT NULL
  ),
  v_imp AS (
    SELECT mo.id AS modelo_id, NULL::uuid AS variante_tecido_id, piv.id AS produto_variante_id,
           piv.cor_id, piv.cor_apelido_id, piv.ordem
      FROM mods mo
      JOIN public.produtos_importados pi ON pi.modelo_id = mo.id AND pi.tenant_id = v_tenant
      JOIN public.produto_importado_variantes piv ON piv.produto_importado_id = pi.id AND piv.tenant_id = v_tenant
     WHERE mo.origem = 'importado' AND piv.cor_id IS NOT NULL
  ),
  v_all AS (
    SELECT * FROM v_int UNION ALL SELECT * FROM v_rev UNION ALL SELECT * FROM v_imp
  ),
  v_json AS (
    SELECT v.modelo_id,
           jsonb_agg(jsonb_build_object(
             'variante_tecido_id',  v.variante_tecido_id,
             'produto_variante_id', v.produto_variante_id,
             'cor_id',              v.cor_id,
             'cor_apelido_id',      v.cor_apelido_id,
             'cor_nome',            (SELECT c.nome::text FROM public.cores c WHERE c.id = v.cor_id),
             'cor_apelido_nome',    (SELECT ca.nome::text FROM public.cores_apelido ca WHERE ca.id = v.cor_apelido_id),
             'ordem',               v.ordem,
             'ja_em_outro',         x.com <> '[]'::jsonb,
             'armarios_com',        x.com
           ) ORDER BY v.ordem, v.variante_tecido_id, v.produto_variante_id) AS variantes
      FROM v_all v
      CROSS JOIN LATERAL (
        -- tupla de identidade igual (espelho de chaveVariante), CROSS-colecao, mesma loja, armario <> o atual
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'nome', q.nome) ORDER BY q.ordem, q.nome, q.id), '[]'::jsonb) AS com
          FROM (SELECT DISTINCT a.id, a.nome::text AS nome, a.ordem
                  FROM public.armario_itens ai
                  JOIN public.armarios a ON a.id = ai.armario_id AND a.tenant_id = v_tenant
                 WHERE ai.tenant_id = v_tenant
                   AND ai.modelo_id = v.modelo_id
                   AND ai.variante_tecido_id  IS NOT DISTINCT FROM v.variante_tecido_id
                   AND ai.produto_variante_id IS NOT DISTINCT FROM v.produto_variante_id
                   AND ai.cor_id              IS NOT DISTINCT FROM v.cor_id
                   AND ai.cor_apelido_id      IS NOT DISTINCT FROM v.cor_apelido_id
                   AND (_armario_id IS NULL OR a.id <> _armario_id)) q
      ) x
     GROUP BY v.modelo_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'modelo_id',          mo.id,
           'nome',               mo.nome,
           'ref',                mo.ref,
           'foto_path',          mo.foto,
           'origem',             mo.origem,
           'em_desenvolvimento', j.variantes IS NULL,
           'variantes',          coalesce(j.variantes, '[]'::jsonb),
           -- facetas p/ os filtros do dialog: colecao/subcolecao/periodo + categoria/sub1/grupo(+Acessorios)/linha/status
           'colecao_nome',           mo.colecao_nome,
           'subcolecao',             mo.subcolecao,
           'categoria_principal_id', mo.categoria_principal_id,
           'categoria_nome',         cp.nome::text,
           'subcategoria1_id',       mo.subcategoria1_id,
           'subcategoria1_nome',     s1.nome::text,
           'grupo_id',               cp.grupo_id,
           'grupo_nome',             g.nome::text,
           'eh_acessorio',           coalesce(public._grupo_eh_acessorio(g.id), false),
           'linha_id',               mo.linha_id,
           'linha_nome',             li.nome::text,
           'status_planejamento',    mo.status_planejamento,
           'mes_id',                 mo.mes_id,
           'mes_nome',               me.mes::text,
           'mes_ordem',              me.ordem,
           'ano_id',                 mo.ano_id,
           'ano',                    an.ano
         ) ORDER BY mo.nome, mo.id), '[]'::jsonb)
    INTO v_res
    FROM mods mo
    LEFT JOIN v_json j ON j.modelo_id = mo.id
    -- todo join de apoio filtrado pela loja (a RPC e DEFINER: ignora RLS); grupo derivado via categoria (modelos nao tem grupo_id)
    LEFT JOIN public.categorias_produto     cp ON cp.id = mo.categoria_principal_id AND cp.tenant_id = v_tenant
    LEFT JOIN public.subcategorias1_produto s1 ON s1.id = mo.subcategoria1_id       AND s1.tenant_id = v_tenant
    LEFT JOIN public.grupos_produto         g  ON g.id  = cp.grupo_id               AND g.tenant_id  = v_tenant
    LEFT JOIN public.linhas                 li ON li.id = mo.linha_id               AND li.tenant_id = v_tenant
    LEFT JOIN public.meses                  me ON me.id = mo.mes_id                 AND me.tenant_id = v_tenant
    LEFT JOIN public.anos                   an ON an.id = mo.ano_id                 AND an.tenant_id = v_tenant;

  RETURN v_res;
END;
$function$;

-- ======================================================================================================================================
-- ACL: _core fechado (so o wrapper alcanca); wrapper so authenticated/service_role; leitura so authenticated/service_role
-- ======================================================================================================================================
REVOKE EXECUTE ON FUNCTION public._armario_criar_core(uuid, uuid, text)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_salvar_core(uuid, uuid, uuid, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_duplicar_core(uuid, text)                                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._armario_reordenar_core(jsonb)                                     FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.armario_criar(uuid, uuid, text)                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_salvar(uuid, uuid, uuid, text, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid)                          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armario_criar(uuid, uuid, text)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_salvar(uuid, uuid, uuid, text, integer, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.armario_variantes_disponiveis(uuid)                          TO authenticated, service_role;

DO $pos$
DECLARE
  v_w oid[] := ARRAY[
    to_regprocedure('public.armario_criar(uuid,uuid,text)'),
    to_regprocedure('public.armario_salvar(uuid,uuid,uuid,text,integer,text,jsonb)'),
    to_regprocedure('public.armario_duplicar(uuid,text)'),
    to_regprocedure('public.armario_reordenar(jsonb)'),
    to_regprocedure('public.armario_variantes_disponiveis(uuid)')];
  v_c oid[] := ARRAY[
    to_regprocedure('public._armario_criar_core(uuid,uuid,text)'),
    to_regprocedure('public._armario_salvar_core(uuid,uuid,uuid,text,integer,text,jsonb)'),
    to_regprocedure('public._armario_duplicar_core(uuid,text)'),
    to_regprocedure('public._armario_reordenar_core(jsonb)')];
  v_o oid;
BEGIN
  FOREACH v_o IN ARRAY v_w || v_c LOOP
    IF v_o IS NULL THEN
      RAISE EXCEPTION 'armario_anomes_pos: funcao ausente' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- a antiga de 4 args / 8 args / 3 args NAO deve mais existir (assinaturas trocadas)
  IF to_regprocedure('public.armario_criar(uuid,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.armario_salvar(uuid,uuid,text,text,text,integer,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'armario_anomes_pos: assinatura antiga ainda presente (DROP falhou)' USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_o IN ARRAY v_c LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE') OR has_function_privilege('authenticated', v_o, 'EXECUTE') THEN
      RAISE EXCEPTION 'armario_anomes_pos: _core exposto: %', v_o::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_o IN ARRAY v_w LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_o, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_o, 'EXECUTE') THEN
      RAISE EXCEPTION 'armario_anomes_pos: grants errados no wrapper %', v_o::regprocedure USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = ANY (v_w || v_c) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'armario_anomes_pos: PUBLIC com EXECUTE' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
