-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261102100000_integracao_gerar_json.sql ("Gerar JSON"):
-- DROP das 2 RPCs (integracao_gerar_json_ler / integracao_gerar_json_confirmar) e CHECK integracao_acessos_modo_chk de volta
-- ao de antes ('normal','teste'). Rodar SÓ depois do site velho no ar e do passo 1
-- (supabase/rollback/20261102100000_integracao_gerar_json_down.sql — exige as 2 funções NEUTRALIZADAS, md5
-- 4b96da8c8d2b529d4fbcf99e52c1dc9f / 78ccc308fdfc2456b2fee148d0c61287). O CHECK antigo não aceita o modo novo: os acessos 'manual' (registro de cada
-- geração do Gerar JSON) SÃO APAGADOS — com algum, exige SET app.confirmo_apagar_acessos_manuais = 'sim'.
-- NÃO mexe em integracao_log (as linhas 'integrado' das gerações manuais ficam: a ação segue válida e é a prova) nem em
-- integracao_produtos (produto integrado manualmente SEGUE integrado; voltá-lo seria reentregá-lo à API como novo — o Desfazer
-- do super admin, com motivo, é o caminho por produto).
-- ALTER TABLE pega AccessExclusive em integracao_acessos por um instante (lock_timeout 1500 ms; horário calmo). Sem DROP
-- TRIGGER/POLICY (não prende auth/storage). Idempotente (funções ausentes + CHECK de antes = nada a fazer).
-- Aplicar fora de transação. SEM acessos 'manual': psql "$DB" -v ON_ERROR_STOP=1 -f <arquivo>.
-- COM acessos 'manual' (confirmação de que podem ser apagados), passe a GUC na SESSÃO — um destes dois jeitos:
--   PGOPTIONS='-c app.confirmo_apagar_acessos_manuais=sim' psql "$DB" -v ON_ERROR_STOP=1 -f <arquivo>
--   psql "$DB" -v ON_ERROR_STOP=1 -c "SET app.confirmo_apagar_acessos_manuais = 'sim'" -f <arquivo>
-- (o SET de sessão vale para o -f seguinte na MESMA conexão; SET LOCAL não serve — o arquivo abre a própria transação).
-- Contar antes (só leitura): SELECT count(*) FROM public.integracao_acessos WHERE modo = 'manual';
-- 55P03/40P01 = rodar o arquivo de novo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
  v_n bigint;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_ler(uuid[],uuid)')));
  IF v IS NOT NULL AND v <> '4b96da8c8d2b529d4fbcf99e52c1dc9f' THEN
    RAISE EXCEPTION 'gerar_json_drop: rode o _down antes (integracao_gerar_json_ler md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_gerar_json_confirmar(uuid,jsonb)')));
  IF v IS NOT NULL AND v <> '78ccc308fdfc2456b2fee148d0c61287' THEN
    RAISE EXCEPTION 'gerar_json_drop: rode o _down antes (integracao_gerar_json_confirmar md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_acessos WHERE modo = 'manual';
  IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_acessos_manuais', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'gerar_json_drop: % acesso(s) manual(is) no Log de acessos; o CHECK antigo exige apaga-los - confirme com SET app.confirmo_apagar_acessos_manuais = ''sim''', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DELETE FROM public.integracao_acessos WHERE modo = 'manual';
DROP FUNCTION IF EXISTS public.integracao_gerar_json_ler(uuid[], uuid);
DROP FUNCTION IF EXISTS public.integracao_gerar_json_confirmar(uuid, jsonb);
ALTER TABLE public.integracao_acessos DROP CONSTRAINT IF EXISTS integracao_acessos_modo_chk;
ALTER TABLE public.integracao_acessos ADD CONSTRAINT integracao_acessos_modo_chk CHECK (modo IN ('normal', 'teste'));

DO $pos$
BEGIN
  IF to_regprocedure('public.integracao_gerar_json_ler(uuid[],uuid)') IS NOT NULL
     OR to_regprocedure('public.integracao_gerar_json_confirmar(uuid,jsonb)') IS NOT NULL
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
          WHERE c.conrelid = 'public.integracao_acessos'::regclass AND c.conname = 'integracao_acessos_modo_chk')
        IS DISTINCT FROM 'CHECK ((modo = ANY (ARRAY[''normal''::text, ''teste''::text])))' THEN
    RAISE EXCEPTION 'gerar_json_drop: funcao ainda existe ou CHECK diferente do antigo' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
