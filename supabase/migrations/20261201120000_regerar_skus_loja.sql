-- Botoes Regerar REF / Regerar SKUs - migration 3 de 3: PARTE A, "Regerar todos os SKUs da loja" (Config da Loja, admin).
-- So funcoes NOVAS; o motor de SKU (_skus_previa_core, _skus_plano, _aplicar_skus_modelo_core) e so CHAMADO, nunca redefinido.
-- O statement_timeout de 8 s do role authenticated nao aceita uma chamada para a loja inteira: previa e aplicacao sao PAGINADAS
-- (padrao 25 produtos, teto duro 50 no servidor; o front recua a pagina pela metade se uma estourar o tempo).
--   _regerar_guarda_admin(tenant)                        autenticado + loja ativa + admin da loja/super + loja pedida = a do usuario + modulo criacao
--   _regerar_skus_item_core(modelo)                      classifica UM produto (pulado/igual/muda/conflito) com o MESMO plano da gravacao
--   regerar_skus_loja_previa(tenant, apos, limite)       pagina da previa (cursor por modelos.id); SO LEITURA (GRANT authenticated)
--   _regerar_skus_aplicar_item(tenant, modelo, assin.)   re-checa loja/pulo, confere a assinatura e chama o core de gravacao
--   regerar_skus_loja_aplicar(tenant, itens)             grava uma pagina (max 50) com sub-bloco EXCEPTION por produto; 1 linha de audit_log por pagina
-- Idempotente por pagina: reenviar a mesma pagina reaplica a mesma assinatura (0 operacoes, mesmo estado final).
-- RAISE 5xx so ASCII. Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261201120000_regerar_skus_loja.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Banco ANTES do site. Volta: supabase/rollback/20261201120000_regerar_skus_loja_down.sql
-- ============================== MD5 (guarda) ==============================
--   LIDOS (nao mudam - a migration RECUSA se divergirem):
--     public._skus_previa_core(uuid,text,text,jsonb,text)          61e81486... (copia) OU f2e513e6... (producao, pino oficial da 20261005110000) - so comentarios diferem
--     public._skus_plano(uuid,text,text,jsonb,text)                82ecd0ea... (copia) OU 5980345a... (producao, pino oficial da 20261027120000) - so comentarios diferem
--     public._aplicar_skus_modelo_core(uuid,jsonb,text,text)       858abf9f... (copia) OU fd7ac0cf... (producao) - mesma funcao, so comentarios diferem; a 20261006120000 ja trata os 2 como equivalentes
--   NOVAS (DEPOIS - guarda do _down):
--     public._regerar_guarda_admin(uuid)                           f8431bd9b874c035c1c5ebf4b9bfdf53
--     public._regerar_skus_item_core(uuid)                         8309ee03bd88ca9714bf8843b990db35
--     public.regerar_skus_loja_previa(uuid,uuid,integer)           4299c09d6ee71f7b9922d3443792e3ee
--     public._regerar_skus_aplicar_item(uuid,uuid,text)            87cc663f1a60b460973ff0fd0526033b
--     public.regerar_skus_loja_aplicar(uuid,jsonb)                 90bed8b60f62326056025ec451a33ceb
-- ==========================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
BEGIN
  IF to_regprocedure('public._regerar_pulo_integracao(uuid)') IS NULL THEN
    RAISE EXCEPTION 'regerar_loja: aplique 20261201100000 antes (helper de pulo ausente)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public._skus_previa_core(uuid,text,text,jsonb,text)'::regprocedure)) NOT IN ('61e814868e4b8f014f227db28ee51495', 'f2e513e6f1b6754c968d98b2ee0ea7c1')
     OR md5(pg_get_functiondef('public._skus_plano(uuid,text,text,jsonb,text)'::regprocedure)) NOT IN ('82ecd0ea8f67bf9590a98cbd5851ee38', '5980345a105818b26329c8a4e594fee2')
     OR md5(pg_get_functiondef('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)'::regprocedure)) NOT IN ('858abf9fddb6e3ffb7bcc2b0d2c419d1', 'fd7ac0cf1b778711ac2098d41e16ead6') THEN
    RAISE EXCEPTION 'regerar_loja: motor de SKU com texto inesperado - outra frente mexeu; gere de novo' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._regerar_guarda_admin(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = c_nil THEN
    RAISE EXCEPTION 'loja_inativa: operacao nao permitida' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'sem_permissao_admin: so o administrador da loja regera os SKUs' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'loja_mudou: a loja ativa mudou - recarregue a pagina' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._exige_modulos('criacao');
END
$function$;

CREATE OR REPLACE FUNCTION public._regerar_skus_item_core(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
  v_pulo text;
  v_prev jsonb;
  v_linhas jsonb;
  v_manuais integer;
  v_criados integer;
  v_atualizados integer;
  v_removidos integer;
  v_conflitos integer;
  v_estado text;
  v_base jsonb;
BEGIN
  SELECT mo.id, mo.nome, mo.ref, mo.tamanho_tipo, mo.origem INTO v_m FROM public.modelos mo WHERE mo.id = _modelo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;
  v_base := jsonb_build_object('modelo_id', v_m.id, 'nome', v_m.nome, 'ref', v_m.ref, 'origem', v_m.origem,
                               'tamanho_tipo', v_m.tamanho_tipo);
  v_pulo := public._regerar_pulo_integracao(_modelo_id);
  IF v_pulo IS NOT NULL THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', v_pulo);
  END IF;
  IF btrim(coalesce(v_m.ref, '')) = '' THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', 'sem_ref');
  END IF;
  IF v_m.tamanho_tipo IS NULL THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', 'sem_tamanho');
  END IF;
  -- O MESMO plano da gravacao, com a REF e o "Tamanho em" GRAVADOS (o aplicar tambem le os gravados).
  v_prev := public._skus_previa_core(_modelo_id, v_m.ref, v_m.tamanho_tipo, '[]'::jsonb, 'regerar');
  IF v_prev ->> 'status' <> 'ok' THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo',
             CASE v_prev ->> 'status' WHEN 'sem_formato' THEN 'sem_formato' WHEN 'aguardando_ref' THEN 'sem_ref' ELSE 'sem_tamanho' END);
  END IF;
  v_criados := coalesce((v_prev ->> 'criados')::integer, 0);
  v_atualizados := coalesce((v_prev ->> 'atualizados')::integer, 0);
  v_removidos := coalesce((v_prev ->> 'removidos')::integer, 0);
  v_conflitos := jsonb_array_length(coalesce(v_prev -> 'conflitos', '[]'::jsonb));
  SELECT count(*) FILTER (WHERE (l.value ->> 'manual')::boolean)::integer INTO v_manuais
    FROM jsonb_array_elements(v_prev -> 'linhas') AS l(value);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_key', l.value ->> 'variante_key', 'cor_nome', l.value ->> 'cor_nome', 'apelido_nome', l.value ->> 'apelido_nome',
           'tamanho_key', l.value ->> 'tamanho_key', 'acao', l.value -> 'previa' ->> 'acao',
           'sku_de', l.value -> 'previa' ->> 'sku_de', 'sku_para', l.value -> 'previa' ->> 'sku_para',
           'mensagem', l.value -> 'previa' ->> 'mensagem') ORDER BY l.n), '[]'::jsonb)
    INTO v_linhas
    FROM jsonb_array_elements(v_prev -> 'linhas') WITH ORDINALITY AS l(value, n)
   WHERE l.value -> 'previa' ->> 'acao' IN ('muda', 'novo', 'sai', 'conflito');
  v_estado := CASE WHEN v_criados + v_atualizados + v_removidos > 0 THEN 'muda'
                   WHEN v_conflitos > 0 THEN 'conflito' ELSE 'igual' END;
  RETURN v_base || jsonb_build_object('estado', v_estado, 'assinatura', v_prev ->> 'assinatura',
           'criados', v_criados, 'atualizados', v_atualizados, 'removidos', v_removidos, 'manuais', v_manuais,
           'conflitos', v_conflitos, 'linhas', v_linhas);
END
$function$;

CREATE OR REPLACE FUNCTION public.regerar_skus_loja_previa(_tenant_id uuid, _apos uuid DEFAULT NULL, _limite integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_teto constant integer := 50;
  v_formato boolean;
  v_total integer := NULL;
  v_ids uuid[];
  v_proximo uuid := NULL;
  v_itens jsonb := '[]'::jsonb;
  v_id uuid;
  v_r jsonb;
BEGIN
  PERFORM public._regerar_guarda_admin(_tenant_id);
  IF _limite IS NULL OR _limite < 1 OR _limite > c_teto THEN
    RAISE EXCEPTION 'limite_pagina: a pagina aceita de 1 a 50 produtos' USING ERRCODE = 'P0001';
  END IF;
  -- Mesmo predicado do _skus_plano: sem sku_config ou com partes = [] a loja nao tem Formato.
  SELECT (tc.sku_config IS NOT NULL AND coalesce(tc.sku_config -> 'partes', 'null'::jsonb) <> '[]'::jsonb) INTO v_formato
    FROM public.tenant_config tc WHERE tc.tenant_id = _tenant_id;
  v_formato := coalesce(v_formato, false);
  IF _apos IS NULL THEN
    SELECT count(*)::integer INTO v_total FROM public.modelos mo WHERE mo.tenant_id = _tenant_id;
  END IF;
  IF NOT v_formato THEN
    RETURN jsonb_build_object('formato_ok', false, 'total_modelos', v_total, 'itens', '[]'::jsonb, 'proximo', NULL);
  END IF;
  SELECT coalesce(array_agg(x.id ORDER BY x.id), '{}'::uuid[]) INTO v_ids
    FROM (SELECT mo.id FROM public.modelos mo
           WHERE mo.tenant_id = _tenant_id AND (_apos IS NULL OR mo.id > _apos)
           ORDER BY mo.id LIMIT _limite + 1) x;
  IF coalesce(array_length(v_ids, 1), 0) > _limite THEN
    v_proximo := v_ids[_limite];
  END IF;
  FOR i IN 1 .. least(coalesce(array_length(v_ids, 1), 0), _limite) LOOP
    v_id := v_ids[i];
    BEGIN
      v_r := public._regerar_skus_item_core(v_id);
    EXCEPTION WHEN OTHERS THEN
      v_r := jsonb_build_object('modelo_id', v_id, 'estado', 'erro', 'codigo', SQLSTATE, 'detalhe', left(SQLERRM, 200));
    END;
    v_itens := v_itens || jsonb_build_array(v_r);
  END LOOP;
  RETURN jsonb_build_object('formato_ok', true, 'total_modelos', v_total, 'itens', v_itens, 'proximo', v_proximo);
END
$function$;

CREATE OR REPLACE FUNCTION public._regerar_skus_aplicar_item(_tenant_id uuid, _modelo_id uuid, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
  v_pulo text;
  v_plano jsonb;
  v_exec jsonb;
  v_base jsonb;
  v_trilha jsonb;
BEGIN
  SELECT mo.id, mo.nome, mo.ref, mo.tamanho_tipo, mo.tenant_id INTO v_m FROM public.modelos mo WHERE mo.id = _modelo_id;
  IF NOT FOUND OR v_m.tenant_id IS DISTINCT FROM _tenant_id THEN
    RETURN jsonb_build_object('modelo_id', _modelo_id, 'estado', 'pulado', 'motivo', 'outra_loja');
  END IF;
  v_base := jsonb_build_object('modelo_id', v_m.id, 'nome', v_m.nome, 'ref', v_m.ref);
  -- O estado pode ter mudado desde a previa: re-checa TUDO antes de tocar em SKU.
  v_pulo := public._regerar_pulo_integracao(_modelo_id);
  IF v_pulo IS NOT NULL THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', v_pulo);
  END IF;
  IF btrim(coalesce(v_m.ref, '')) = '' THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', 'sem_ref');
  END IF;
  IF v_m.tamanho_tipo IS NULL THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', 'sem_tamanho');
  END IF;
  v_plano := public._skus_plano(_modelo_id, v_m.ref, v_m.tamanho_tipo, '[]'::jsonb, 'regerar');
  IF v_plano ->> 'status' = 'sem_formato' THEN
    RETURN v_base || jsonb_build_object('estado', 'pulado', 'motivo', 'sem_formato');
  END IF;
  IF _assinatura IS NULL OR _assinatura IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RETURN v_base || jsonb_build_object('estado', 'desatualizado');
  END IF;
  -- Trilha para reverter a mao: de/para por linha que muda/nasce/sai (do MESMO plano que o core vai conferir e executar).
  SELECT jsonb_build_object('de', coalesce(jsonb_object_agg(l.key, l.value -> 'sku_de'), '{}'::jsonb),
                            'para', coalesce(jsonb_object_agg(l.key, l.value -> 'sku_para'), '{}'::jsonb))
    INTO v_trilha
    FROM jsonb_each(v_plano -> 'linhas') AS l(key, value)
   WHERE l.value ->> 'acao' IN ('muda', 'novo', 'sai');
  v_exec := public._aplicar_skus_modelo_core(_modelo_id, '[]'::jsonb, 'regerar', _assinatura);
  RETURN v_base || jsonb_build_object('estado', 'gravado',
           'criados', (v_exec ->> 'criados')::integer, 'atualizados', (v_exec ->> 'atualizados')::integer,
           'removidos', (v_exec ->> 'removidos')::integer,
           'conflitos', jsonb_array_length(coalesce(v_exec -> 'conflitos', '[]'::jsonb)), 'trilha', v_trilha);
END
$function$;

CREATE OR REPLACE FUNCTION public.regerar_skus_loja_aplicar(_tenant_id uuid, _itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_teto constant integer := 50;
  v_it jsonb;
  v_r jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_trilhas jsonb := '{}'::jsonb;
  v_gravados integer := 0;
  v_desatualizados integer := 0;
  v_pulados integer := 0;
  v_erros integer := 0;
  v_nome text;
BEGIN
  PERFORM public._regerar_guarda_admin(_tenant_id);
  IF _itens IS NULL OR jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 OR jsonb_array_length(_itens) > c_teto
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_itens) AS x(value)
                 WHERE jsonb_typeof(x.value) <> 'object'
                    OR jsonb_typeof(x.value -> 'modelo_id') IS DISTINCT FROM 'string'
                    OR lower(x.value ->> 'modelo_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR jsonb_typeof(x.value -> 'assinatura') IS DISTINCT FROM 'string')
     OR (SELECT count(*) FROM jsonb_array_elements(_itens)) <>
        (SELECT count(DISTINCT lower(x.value ->> 'modelo_id')) FROM jsonb_array_elements(_itens) AS x(value)) THEN
    RAISE EXCEPTION 'itens_invalidos: envie de 1 a 50 produtos, sem repetir' USING ERRCODE = 'P0001';
  END IF;
  FOR v_it IN SELECT x.value FROM jsonb_array_elements(_itens) WITH ORDINALITY AS x(value, n) ORDER BY x.n LOOP
    -- Savepoint por produto: o erro de um nao derruba os outros da pagina. (statement_timeout NAO e capturado por OTHERS:
    -- aborta a pagina inteira, que o front reenvia menor - a aplicacao e idempotente.)
    BEGIN
      v_r := public._regerar_skus_aplicar_item(_tenant_id, (v_it ->> 'modelo_id')::uuid, v_it ->> 'assinatura');
    EXCEPTION
      WHEN SQLSTATE 'P0409' THEN
        v_r := jsonb_build_object('modelo_id', v_it ->> 'modelo_id', 'estado', 'desatualizado');
      WHEN OTHERS THEN
        v_r := jsonb_build_object('modelo_id', v_it ->> 'modelo_id', 'estado', 'erro', 'codigo', SQLSTATE, 'detalhe', left(SQLERRM, 200));
    END;
    IF v_r ->> 'estado' = 'gravado' THEN
      v_gravados := v_gravados + 1;
      v_trilhas := v_trilhas || jsonb_build_object(
        coalesce(v_r ->> 'nome', 'produto') || ' (' || coalesce(nullif(v_r ->> 'ref', ''), 'sem REF') || ') #' || left(v_r ->> 'modelo_id', 8),
        v_r -> 'trilha');
    ELSIF v_r ->> 'estado' = 'desatualizado' THEN
      v_desatualizados := v_desatualizados + 1;
    ELSIF v_r ->> 'estado' = 'pulado' THEN
      v_pulados := v_pulados + 1;
    ELSE
      v_erros := v_erros + 1;
    END IF;
    v_resultados := v_resultados || jsonb_build_array(v_r - 'trilha');
  END LOOP;
  IF v_gravados > 0 THEN
    SELECT coalesce(u.nome, u.email) INTO v_nome FROM public.users u WHERE u.id = auth.uid();
    INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
    VALUES (_tenant_id, auth.uid(), v_nome, 'regerar_skus_loja', 'SKU', 'modelo_skus', NULL,
            format('Regerou os SKUs de %s produto(s) (lote da loja)', v_gravados), v_trilhas);
  END IF;
  RETURN jsonb_build_object('resultados', v_resultados, 'gravados', v_gravados, 'desatualizados', v_desatualizados,
                            'pulados', v_pulados, 'erros', v_erros);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._regerar_guarda_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._regerar_skus_item_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._regerar_skus_aplicar_item(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.regerar_skus_loja_previa(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.regerar_skus_loja_aplicar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regerar_skus_loja_previa(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regerar_skus_loja_aplicar(uuid, jsonb) TO authenticated;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('_regerar_guarda_admin', '_regerar_skus_item_core', '_regerar_skus_aplicar_item')
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'regerar_loja: pos-condicao falhou - _core/helper com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('regerar_skus_loja_previa', 'regerar_skus_loja_aplicar')
                AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'regerar_loja: pos-condicao falhou - wrapper com EXECUTE para PUBLIC/anon' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
