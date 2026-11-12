-- Kanban PL configuravel - Onda 2, Task 6: GUARD do status do board PL + RPC de mover (arraste/"Mover para...").
-- ADITIVA e idempotente (CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER). SO BANCO; com etapas_pl_automatico=false
-- (default) TUDO e inerte: o guard sai cedo (modo manual = a PESSOA decide) e a RPC recusa com P0001. Nenhuma tela usa
-- ainda (a frente so liga na Onda 3).
--
-- Espelha o Dev:
--   - fn_etapas_pl_status_guard  <- fn_kanban_status_guard (20260930140000:592) + trg_kanban_status_guard (:651)
--   - etapas_pl_mover            <- kanban_mover (20260930150000:36, vivo apos a B3 20261103147000: nao_encontrado ASCII)
-- Trocas: status_desenvolvimento->status_etapa_pl, _kanban_cfg/_kanban_ligado->_etapas_pl_cfg/_etapas_pl_ligado,
-- kanban_recalculo_fila/_kanban_enfileirar->etapas_pl_recalculo_fila/_etapas_pl_enfileirar, GUC app.kanban_sistema ->
-- app.etapas_pl_sistema, _kanban_derivar_lote -> _etapas_pl_derivar_lote, _avaliar_condicoes_kanban_core ->
-- _avaliar_condicoes_etapas_pl_core. O fluxo PL canonico (Task 1) =
--   _kanban_fluxo(jsonb_build_object('status_kanban', coalesce(cfg -> 'etapas_pl_kanban','[]')), false)
-- (board UNICO; sem revenda/comprado). Excecoes sempre {}. As PURAS do Dev (_kanban_fluxo, _kanban_derivar_puro,
-- _kanban_destino_drop_puro, _kanban_coluna_manual, _kanban_norm) sao REUSADAS, nao duplicadas.
--
-- Decisoes de espelho (diferencas deliberadas do Dev):
--   - "card nao esta no PL" (sai cedo no guard) = OLD.status_etapa_pl IS NULL (entrando no PL) OU NEW.status_etapa_pl
--     IS NULL (saindo do PL). No Dev a elegibilidade e uma propriedade do CARD (ordem_criacao_enviada AND NOT lancado),
--     aqui e o PROPRIO status (elegivel = status_etapa_pl IS NOT NULL, Task 1): sem isso, tirar um card do PL (NULL)
--     seria "revertido" para o status antigo pelo ramo ''/NULL -> mantem o atual. Entrar/sair do PL passa; o AFTER da
--     fila (trg_etapas_pl_fila_upd) enfileira e o COMMIT re-deriva.
--   - etapas_pl_mover NAO mexe em revisao_pendente (a chave 'kanban' e do Dev; o PL nao tem marca de revisao propria).
--   - mensagens de RAISE em ASCII (5xx do PostgREST derruba o code com nao-ASCII); o guard usa
--     'etapas_pl_fora_do_fluxo: <etapa>' no lugar do texto acentuado do Dev (mesmo P0001).
--
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127120000_etapas_pl_guard_mover.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: CREATE TRIGGER pega ShareRowExclusive em `modelos`
-- (bloqueia ESCRITA por ms; lock_timeout 1500ms -> 55P03 = nada mudou, rodar de novo; horario calmo). O CREATE TRIGGER
-- NAO prende auth/storage (so o DROP TRIGGER em modelos prende - ver o _down_drop).
-- Volta: supabase/rollback/20261127120000_etapas_pl_guard_mover_down.sql (NEUTRALIZA as 2 funcoes; sem DROP) e
-- opcional/separado ..._down_drop.sql (DROP TRIGGER + funcoes, HORARIO CALMO).
-- Todas as funcoes sao NOVAS: nao ha guarda de md5 de funcao redefinida; a guarda abaixo confere so as PURAS reusadas.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   dependencias FIXADAS (nao redefinidas aqui):
--     public._kanban_fluxo(jsonb,boolean)                                     7b3bbef69c25e08727553fb69c570fb4
--     public._kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)      7f115cb6001b10b2daa52f13cd531b97
-- ====================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- Guarda: as puras reusadas tem o texto esperado e as dependencias da Sessao A existem.
DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._kanban_fluxo(jsonb,boolean)', '7b3bbef69c25e08727553fb69c570fb4'),
      ('public._kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)', '7f115cb6001b10b2daa52f13cd531b97')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'kpl_o2gm: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._etapas_pl_cfg(uuid)'),
      ('public._etapas_pl_ligado(uuid)'),
      ('public._etapas_pl_derivar_lote(uuid,uuid[],jsonb)'),
      ('public._etapas_pl_enfileirar(uuid[])'),
      ('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'),
      ('public._kanban_destino_drop_puro(text[],jsonb,jsonb,jsonb,text,boolean,text)'),
      ('public._kanban_coluna_manual(text,jsonb)'),
      ('public._kanban_norm(text)'),
      ('public._exige_modulos(text[])')
    ) AS x(f) LOOP
    IF to_regprocedure(r.f) IS NULL THEN
      RAISE EXCEPTION 'kpl_o2gm: dependencia % ausente (aplique a Sessao A antes)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Guard do status (BEFORE UPDATE OF status_etapa_pl). Espelho de fn_kanban_status_guard.
--    Passa (sai cedo): status igual, GUC do sistema, chave desligada (modo manual = a pessoa decide), card fora do PL,
--    fluxo vazio. Senao (e sempre re-enfileira - o COMMIT re-deriva com o estado final):
--      ''/NULL -> mantem o atual - fora do fluxo -> P0001 - entrada ou coluna MANUAL -> passa (fixa) -
--      coluna AUTOMATICA de fora do motor: estava FIXADO -> vai p/ a posicao DERIVADA ("tirar de manual solta");
--      senao mantem o atual (draft velho e ignorado).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg      jsonb;
  v_fluxo    text[];
  v_reqs     jsonb;
  v_para     text;
  v_atual    text;
  v_cond     jsonb;
BEGIN
  IF NEW.status_etapa_pl IS NOT DISTINCT FROM OLD.status_etapa_pl THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NEW; END IF;
  IF NOT public._etapas_pl_ligado(NEW.tenant_id) THEN RETURN NEW; END IF;
  -- fora do PL (entrando OU saindo): elegivel = status_etapa_pl IS NOT NULL (Task 1); nao ha o que guardar.
  IF OLD.status_etapa_pl IS NULL OR NEW.status_etapa_pl IS NULL THEN RETURN NEW; END IF;

  v_cfg   := coalesce(public._etapas_pl_cfg(NEW.tenant_id), '{}'::jsonb);
  v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb)), false);
  IF cardinality(v_fluxo) = 0 THEN RETURN NEW; END IF;
  v_reqs  := coalesce(v_cfg -> 'etapas_pl_requisitos', '{}'::jsonb);

  PERFORM public._etapas_pl_enfileirar(ARRAY[NEW.id]);

  v_para := public._kanban_norm(NEW.status_etapa_pl);
  IF v_para = '' THEN
    NEW.status_etapa_pl := OLD.status_etapa_pl;
    RETURN NEW;
  END IF;
  IF NOT (v_para = ANY (v_fluxo)) THEN
    RAISE EXCEPTION 'etapas_pl_fora_do_fluxo: %', NEW.status_etapa_pl USING ERRCODE = 'P0001';
  END IF;
  IF v_para = v_fluxo[1] OR public._kanban_coluna_manual(v_para, v_reqs) THEN
    RETURN NEW;
  END IF;

  v_atual := public._kanban_norm(OLD.status_etapa_pl);
  IF v_atual <> '' AND v_atual = ANY (v_fluxo) AND v_atual <> v_fluxo[1]
     AND public._kanban_coluna_manual(v_atual, v_reqs) THEN
    v_cond := coalesce(public._avaliar_condicoes_etapas_pl_core(NEW.tenant_id, ARRAY[NEW.id]) -> NEW.id::text, '{}'::jsonb);
    NEW.status_etapa_pl :=
      public._kanban_derivar_puro(v_fluxo, v_reqs, '{}'::jsonb, v_cond, OLD.status_etapa_pl, true) ->> 'alvo';
  ELSE
    NEW.status_etapa_pl := OLD.status_etapa_pl;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_etapas_pl_status_guard ON public.modelos;
CREATE TRIGGER trg_etapas_pl_status_guard
  BEFORE UPDATE OF status_etapa_pl ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_status_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- 2) etapas_pl_mover - aplica a tabela UNICA de arraste (_kanban_destino_drop_puro) no servidor, para o board PL.
--    Espelho de kanban_mover. Gate: login + modulos (producao + etapas_pl; super admin passa) + editar PCP > Etapas.
--    Chave desligada -> P0001 (modo manual: a tela grava direto). Acoes fixar/soltar/nada: marca
--    app.etapas_pl_sistema='manual' em volta do UPDATE (o guard sai cedo) e RESTAURA o valor anterior.
-- ────────────────────────────────────────────────────────────────────────────
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
    RAISE EXCEPTION 'etapas_pl_manual: ligue o kanban automatico das etapas' USING ERRCODE = 'P0001';
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
$function$;

-- Invariante #9 - o guard (DEFINER de gatilho) sem EXECUTE para ninguem; a RPC so para authenticated.
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_status_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_mover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_mover(uuid, text) TO authenticated;

-- Pos-condicao: ACL, DEFINER, search_path=public; gatilho presente (BEFORE UPDATE OF status_etapa_pl, habilitado).
DO $pos$
DECLARE
  r record;
BEGIN
  IF has_function_privilege('public', 'public.fn_etapas_pl_status_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapas_pl_status_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapas_pl_status_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'kpl_o2gm: pos-condicao falhou - fn_etapas_pl_status_guard com EXECUTE aberto' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'kpl_o2gm: pos-condicao falhou - ACL de etapas_pl_mover' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_etapas_pl_status_guard()'),
      ('public.etapas_pl_mover(uuid,text)')
    ) AS x(f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
      RAISE EXCEPTION 'kpl_o2gm: pos-condicao falhou - % sem secdef/search_path=public', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.modelos'::regclass AND t.tgname = 'trg_etapas_pl_status_guard'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND (t.tgtype & 2) = 2) THEN
    RAISE EXCEPTION 'kpl_o2gm: pos-condicao falhou - trg_etapas_pl_status_guard ausente/desabilitado' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
