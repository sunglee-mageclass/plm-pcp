-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261030130000_integracao_api_loja_obrigatoria.sql
-- (Release A2): DROP de public._integracao_ler_loja e CHECK integracao_acessos_status_chk de volta ao de antes (sem
-- 'loja_nao_autorizada'). Rodar SÓ depois do site velho no ar e do passo 1
-- (supabase/rollback/20261030130000_integracao_api_loja_obrigatoria_down.sql — exige a função NEUTRALIZADA, md5
-- ccfa5fa7d3867203259c5dcc8039ca31). O CHECK antigo não aceita o status novo: os registros 'loja_nao_autorizada' do Log de
-- acessos SÃO APAGADOS (só recusas de chamada com a loja errada) — com algum, exige SET app.confirmo_apagar_acessos_loja = 'sim'.
-- ALTER TABLE pega AccessExclusive em integracao_acessos por um instante (lock_timeout 500 ms; horário calmo). Sem DROP
-- TRIGGER/POLICY (não prende auth/storage). Idempotente (função ausente + CHECK de antes = nada a fazer).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text := md5(pg_get_functiondef(to_regprocedure('public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)')));
  v_n bigint;
BEGIN
  IF v IS NOT NULL AND v <> 'ccfa5fa7d3867203259c5dcc8039ca31' THEN
    RAISE EXCEPTION 'a2_loja_volta_drop: rode antes o _down da 20261030130000 (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_acessos WHERE status = 'loja_nao_autorizada';
  IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_acessos_loja', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'a2_loja_volta_drop: % registro(s) loja_nao_autorizada no Log de acessos; o CHECK antigo exige apaga-los - confirme com SET app.confirmo_apagar_acessos_loja = ''sim''', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DELETE FROM public.integracao_acessos WHERE status = 'loja_nao_autorizada';
DROP FUNCTION IF EXISTS public._integracao_ler_loja(text, uuid, boolean, text, integer, text, text);
ALTER TABLE public.integracao_acessos DROP CONSTRAINT IF EXISTS integracao_acessos_status_chk;
ALTER TABLE public.integracao_acessos ADD CONSTRAINT integracao_acessos_status_chk
  CHECK (status IN ('reservado', 'ok', 'teste', 'chave_invalida', 'loja_inativa', 'ip_bloqueado', 'limite_excedido'));

DO $pos$
BEGIN
  IF to_regprocedure('public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)') IS NOT NULL
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
          WHERE c.conrelid = 'public.integracao_acessos'::regclass AND c.conname = 'integracao_acessos_status_chk') LIKE '%loja_nao_autorizada%' THEN
    RAISE EXCEPTION 'a2_loja_volta_drop: funcao ou CHECK novo ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
