-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261030110000_integracao_3_campos.sql: DROP das 3 auxiliares (_integracao_padrao, _integracao_opcionais,
-- _integracao_extras) e das 3 colunas de integracao_linhas (colecao, categoria_tecido, linha). GERADO por
-- .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs. Rodar SÓ depois de supabase/rollback/20261030110000_integracao_3_campos_down.sql (exige
-- _integracao_retrato_core = o de antes bfcd6aba0a2f0ebd1a5908888f9c0568 e o DEFAULT de antes).
-- DROP COLUMN pega AccessExclusive em integracao_linhas: horário calmo. Valores das 3 colunas (linhas da API marcadas depois da
-- ida) SÃO APAGADOS: com algum preenchido exige SET app.confirmo_apagar_campos_informativos = 'sim'. _bkp_i3c_reprocesso
-- (backup da I3c) NÃO é apagado aqui. Sem DROP TRIGGER/POLICY (não prende auth/storage).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v_n bigint := 0;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)')))
       IS DISTINCT FROM 'bfcd6aba0a2f0ebd1a5908888f9c0568'
     OR (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = 'public.integracao_config'::regclass AND a.attname = 'campos') IS DISTINCT FROM '(_integracao_layout())[1:17]' THEN
    RAISE EXCEPTION 'i3b_volta_drop: rode antes o _down da 20261030110000' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'colecao' AND NOT a.attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM public.integracao_linhas WHERE colecao IS NOT NULL OR categoria_tecido IS NOT NULL OR linha IS NOT NULL'
      INTO v_n;
  END IF;
  IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_campos_informativos', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'i3b_volta_drop: % linha(s) da API com Colecao/Categoria/Linha preenchidas; o DROP apaga - confirme com SET app.confirmo_apagar_campos_informativos = ''sim''', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._integracao_padrao();
DROP FUNCTION IF EXISTS public._integracao_opcionais();
DROP FUNCTION IF EXISTS public._integracao_extras(uuid);
ALTER TABLE public.integracao_linhas DROP COLUMN IF EXISTS colecao, DROP COLUMN IF EXISTS categoria_tecido, DROP COLUMN IF EXISTS linha;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'colecao' AND NOT a.attisdropped) OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'categoria_tecido' AND NOT a.attisdropped) OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'linha' AND NOT a.attisdropped)
     OR to_regprocedure('public._integracao_padrao()') IS NOT NULL OR to_regprocedure('public._integracao_opcionais()') IS NOT NULL OR to_regprocedure('public._integracao_extras(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'i3b_volta_drop: coluna ou funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
