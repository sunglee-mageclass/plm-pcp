-- Kanban PL - Onda 3 (fix round 1 da Task 9): etapas_pl_mover tambem grava com a chave do modo automatico DESLIGADA (modo manual).
-- Motivo: o UPDATE direto da tela bate no gatilho de pagina de `modelos` (S3d: Planejamento OU Desenvolvimento) e quem tem so PCP > Etapas
-- recebia 42501. A RPC e DEFINER (gate producao_etapas), entao passa como dono. Chave LIGADA: ramo de hoje INTACTO.
-- So CREATE OR REPLACE FUNCTION public.etapas_pl_mover(uuid,text): NAO cria trigger, NAO faz DROP, NAO toca auth/storage/realtime
-- (sem trava de tabela alem do catalogo). Idempotente. Volta: supabase/rollback/20261128110000_etapas_pl_mover_manual_down.sql (devolve o corpo de antes: chave off = recusa).
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128110000_etapas_pl_mover_manual.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). RAISE 5xx so ASCII.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.etapas_pl_mover(uuid,text)
--     ANTES  bb027297975166f7df845a80fd729eb0  (20261127120000: chave off = recusa 'etapas_pl_manual')
--     DEPOIS cb0861a016e2548ac3c20871b7f5076c  (20261128110000: chave off = grava manual)
-- ====================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  IF to_regprocedure('public._etapas_pl_cfg(uuid)') IS NULL OR to_regprocedure('public._kanban_fluxo(jsonb,boolean)') IS NULL
     OR to_regprocedure('public._kanban_norm(text)') IS NULL THEN
    RAISE EXCEPTION 'kpl_o3mm: dependencia ausente (aplique a Onda 2 antes)' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.etapas_pl_mover(uuid,text)')));
  IF v IS NULL OR v NOT IN ('bb027297975166f7df845a80fd729eb0', 'cb0861a016e2548ac3c20871b7f5076c') THEN
    RAISE EXCEPTION 'kpl_o3mm: etapas_pl_mover com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.etapas_pl_mover(_modelo_id uuid, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.etapas_pl_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.etapas_pl_lote', true), '');
  v_status   text;
  v_d        record;
  v_drop     jsonb;
  v_acao     text;
  v_novo     text;
  v_rev      integer;
  v_cfg      jsonb;
  v_board    jsonb;
  v_fluxo    text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('producao', 'etapas_pl');
  IF NOT public.user_can_edit('producao_etapas') THEN
    RAISE EXCEPTION 'sem_permissao: editar PCP > Etapas' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'loja_inativa: operacao nao permitida' USING ERRCODE = '42501';
  END IF;

  -- FOR NO KEY UPDATE: serializa 2 movers do mesmo card sem barrar o FOR KEY SHARE dos INSERTs nas filhas (FK -> modelos).
  SELECT m.status_etapa_pl INTO v_status
    FROM public.modelos m
   WHERE m.id = _modelo_id AND m.tenant_id = v_tenant
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._etapas_pl_ligado(v_tenant) THEN
    -- [kpl_o3mm] MODO MANUAL (chave desligada): a PESSOA decide - grava o status pedido DIRETO (sem derivar, sem exigir requisito),
    -- como o Dev com a chave off. Como DEFINER, o UPDATE passa pelo gatilho de pagina de `modelos` (S3d) como dono: quem edita so
    -- PCP > Etapas (gate acima) consegue mover. So valida o que protege o dado: card dentro do PL e etapa dentro do fluxo.
    v_cfg   := coalesce(public._etapas_pl_cfg(v_tenant), '{}'::jsonb);
    v_board := coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb);
    IF jsonb_typeof(v_board) <> 'array' OR jsonb_array_length(v_board) = 0 THEN
      v_fluxo := '{}'::text[];
    ELSE
      v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
    END IF;
    v_novo := public._kanban_norm(_para);
    IF v_status IS NULL OR v_novo = '' OR v_status IS NOT DISTINCT FROM v_novo THEN
      v_acao := 'nada';
    ELSIF cardinality(v_fluxo) = 0 OR NOT (v_novo = ANY (v_fluxo)) THEN
      v_acao := 'fora_do_fluxo';
    ELSE
      v_acao := 'manual';
      PERFORM set_config('app.etapas_pl_sistema', 'manual', true);
      PERFORM set_config('app.etapas_pl_lote', '', true);
      UPDATE public.modelos m
         SET status_etapa_pl = v_novo
       WHERE m.id = _modelo_id
         AND m.status_etapa_pl IS DISTINCT FROM v_novo;
      PERFORM set_config('app.etapas_pl_sistema', v_sis_ant, true);
      PERFORM set_config('app.etapas_pl_lote', v_lote_ant, true);
    END IF;
    SELECT m.status_etapa_pl, m.rev INTO v_status, v_rev FROM public.modelos m WHERE m.id = _modelo_id;
    RETURN jsonb_build_object('acao', v_acao, 'status', v_status, 'faltando', '[]'::jsonb, 'rev', v_rev);
  END IF;

  SELECT * INTO v_d FROM public._etapas_pl_derivar_lote(v_tenant, ARRAY[_modelo_id]) LIMIT 1;
  v_drop := public._kanban_destino_drop_puro(v_d.fluxo, v_d.reqs, v_d.exc, v_d.cond, v_d.status_atual, v_d.elegivel, _para);
  v_acao := v_drop ->> 'acao';
  v_novo := v_drop ->> 'status';

  IF v_acao IN ('fixar', 'soltar') THEN
    PERFORM set_config('app.etapas_pl_sistema', 'manual', true);
    PERFORM set_config('app.etapas_pl_lote', '', true);
    UPDATE public.modelos m
       SET status_etapa_pl = v_novo
     WHERE m.id = _modelo_id
       AND m.status_etapa_pl IS DISTINCT FROM v_novo;
    PERFORM set_config('app.etapas_pl_sistema', v_sis_ant, true);
    PERFORM set_config('app.etapas_pl_lote', v_lote_ant, true);
  END IF;

  SELECT m.status_etapa_pl, m.rev INTO v_status, v_rev FROM public.modelos m WHERE m.id = _modelo_id;
  RETURN jsonb_build_object(
    'acao', v_acao,
    'status', v_status,
    'faltando', coalesce(v_drop -> 'faltando', '[]'::jsonb),
    'rev', v_rev);
END;
$function$;;

-- Invariante #9: so authenticated (PUBLIC/anon sem EXECUTE). Gate producao_etapas segue no topo da funcao.
REVOKE EXECUTE ON FUNCTION public.etapas_pl_mover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_mover(uuid, text) TO authenticated;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.etapas_pl_mover(uuid,text)'))) IS DISTINCT FROM 'cb0861a016e2548ac3c20871b7f5076c' THEN
    RAISE EXCEPTION 'kpl_o3mm: pos-condicao falhou no md5 de etapas_pl_mover' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.etapas_pl_mover(uuid,text)')
                      AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
    RAISE EXCEPTION 'kpl_o3mm: pos-condicao falhou na ACL/secdef/search_path de etapas_pl_mover' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
