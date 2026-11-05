-- Explosao em RPC unica atomica (Onda 2, frente "Explosao RPC unica"; plano docs/superpowers/plans/2026-11-05-explosao-rpc-unica.md).
-- Hoje o Salvar da Explosao grava em 3 RPCs soltas (3 transacoes; as RPCs 2 e 3 sem _rev_base) e o "Enviar para PCP" em 4.
-- Esta migration cria UMA RPC atomica `salvar_explosao` (metragem + aviamento a separar + insumo a enviar + [opcional] baixa do corte),
-- com portoes UMA vez, o _explosao_check_rev UMA vez (rev real) e retorno {cad_id, rev, deficit}.
--
-- SO ACRESCENTA objetos novos: as 3 RPCs estreitas (salvar_explosao_metragem / _aviamento_separar / _etiqueta_enviar) e
-- baixar_estoque_tecido_corte NAO sao tocadas (site velho + banco novo = inofensivo; a tela velha segue funcionando).
-- Padrao wrapper + _core (invariante 9): os 3 _core novos copiam o CORPO DO LOOP das RPCs vivas (20261103100000) sem portoes e sem
-- _explosao_check_rev, e tem EXECUTE revogado de PUBLIC, anon e authenticated.
-- "cad nao encontrado": P0002 `nao_encontrado: cad` (ASCII, padrao B3); mensagemBackend traduz (entidade `cad` cai no texto generico).
BEGIN;

SET LOCAL lock_timeout = '1500ms';

-- 1) _core da metragem do tecido (cad_tecido_variantes.metragem_enviada / quantidade_folhas).
CREATE OR REPLACE FUNCTION public._salvar_explosao_metragem_core(_cad_id uuid, _variantes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb;
BEGIN
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      UPDATE public.cad_tecido_variantes ctv
         SET metragem_enviada  = COALESCE((it->>'metragem_enviada')::numeric, ctv.metragem_enviada),
             quantidade_folhas = COALESCE((it->>'quantidade_folhas')::numeric, ctv.quantidade_folhas)
       WHERE ctv.id = (it->>'id')::uuid
         AND ctv.cad_tecido_id IN (SELECT ct.id FROM public.cad_tecidos ct WHERE ct.cad_id = _cad_id);
    END LOOP;
  END IF;
END; $function$;

-- 2) _core do aviamento a separar (cad_aviamentos.quantidade_separar: cheio na menor `numero` do grupo, o resto zera).
CREATE OR REPLACE FUNCTION public._salvar_explosao_aviamento_separar_core(_cad_id uuid, _linhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb; v_avi uuid; v_var uuid; v_val numeric; v_first uuid;
BEGIN
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
END; $function$;

-- 3) _core do insumo a enviar (cad_etiquetas.quantidade_enviar por id).
CREATE OR REPLACE FUNCTION public._salvar_explosao_etiqueta_enviar_core(_cad_id uuid, _linhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb; v_id uuid; v_val numeric;
BEGIN
  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_id  := NULLIF(it->>'id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_enviar')::numeric, 0), 0);
      IF v_id IS NULL THEN CONTINUE; END IF;
      UPDATE public.cad_etiquetas SET quantidade_enviar = v_val WHERE id = v_id AND cad_id = _cad_id;
    END LOOP;
  END IF;
END; $function$;

-- Invariante 9: revogar dos TRES (PUBLIC inclui anon/authenticated por heranca; revogar so de anon/authenticated e inocuo).
REVOKE EXECUTE ON FUNCTION public._salvar_explosao_metragem_core(uuid,jsonb),
                           public._salvar_explosao_aviamento_separar_core(uuid,jsonb),
                           public._salvar_explosao_etiqueta_enviar_core(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;

-- 4) A RPC unica (DEFINER): portoes na ordem canonica UMA vez -> _explosao_check_rev UMA vez -> 3 _core -> [baixa do corte].
CREATE OR REPLACE FUNCTION public.salvar_explosao(
  _cad_id uuid,
  _variantes jsonb DEFAULT '[]'::jsonb,
  _aviamentos jsonb DEFAULT '[]'::jsonb,
  _etiquetas jsonb DEFAULT '[]'::jsonb,
  _rev_base integer DEFAULT NULL::integer,
  _enviar boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_rev integer; v_baixa jsonb := jsonb_build_object('deficit', '[]'::jsonb);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado' USING ERRCODE='42501'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Modulo criacao nao habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._exige_modulos('entrada_saida');  -- [modularidade P5] Explosao = Criacao + Entrada e Saida
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_explosao.
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'nao_encontrado: cad' USING ERRCODE='P0002'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissao para este CAD' USING ERRCODE='42501';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);  -- UMA vez, rev real
  PERFORM public._salvar_explosao_metragem_core(_cad_id, _variantes);
  PERFORM public._salvar_explosao_aviamento_separar_core(_cad_id, _aviamentos);
  PERFORM public._salvar_explosao_etiqueta_enviar_core(_cad_id, _etiquetas);
  IF _enviar THEN
    v_baixa := public._baixar_estoque_tecido_corte_core(_cad_id);  -- mesma txn
  END IF;
  SELECT rev INTO v_rev FROM public.cad WHERE id = _cad_id;  -- rev final pos-bump
  RETURN jsonb_build_object('cad_id', _cad_id, 'rev', v_rev, 'deficit', COALESCE(v_baixa->'deficit', '[]'::jsonb));
END; $function$;

REVOKE EXECUTE ON FUNCTION public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean) TO authenticated, service_role;

-- Pos-condicao: privilegios (falha = rollback da migration inteira).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(r, 'public._salvar_explosao_metragem_core(uuid,jsonb)', 'EXECUTE')
       OR has_function_privilege(r, 'public._salvar_explosao_aviamento_separar_core(uuid,jsonb)', 'EXECUTE')
       OR has_function_privilege(r, 'public._salvar_explosao_etiqueta_enviar_core(uuid,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'explosao_rpc_unica_pos: % ainda executa um _core', r;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'explosao_rpc_unica_pos: anon executa salvar_explosao';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'explosao_rpc_unica_pos: authenticated nao executa salvar_explosao';
  END IF;
END $$;

COMMIT;
