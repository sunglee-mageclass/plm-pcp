-- PASSO SEPARADO E OPCIONAL da volta de supabase/migrations/20261019300000_custo_previsto_servidor.sql (contas certas C1,
-- ruling R2 do G-plano do delta): os DROPs. So DEPOIS do _down.sql (gatilhos DESLIGADOS + funcoes neutralizadas +
-- precos_tecido_congelado com o texto de ANTES) - a guarda confere e recusa senao.
-- ⚠ HORARIO CALMO, transacao curtissima: no Supabase o DROP TRIGGER como postgres pega AccessExclusiveLock em ~24 tabelas de
-- auth/storage/realtime (supautils.policy_grants) ATE O COMMIT - login e upload param enquanto esta transacao estiver aberta.
-- lock_timeout 500ms: se estourar, NADA foi apagado; tente de novo mais tarde.
-- Apaga: os 30 gatilhos, a fila custo_recalculo_fila (e o gatilho adiado dela) e as 15 funcoes novas (inclusive
-- _precos_tecido_congelado_core, que o texto de antes de precos_tecido_congelado nao usa). NAO mexe em valores.
-- Depois disto, reaplicar a migration recria tudo do zero.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF md5(pg_get_functiondef('public.precos_tecido_congelado(uuid)'::regprocedure)) IS DISTINCT FROM 'd6fa813be9e183be5f4e166e4c882218' THEN
    RAISE EXCEPTION 'contas_certas_c1 (drop): rode antes o _down.sql - precos_tecido_congelado ainda usa o _core' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado')) THEN
    RAISE EXCEPTION 'contas_certas_c1 (drop): rode antes o _down.sql - ha gatilho da 20261019300000 ligado' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.custo_recalculo_fila') IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
                      AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado'))
     AND to_regprocedure('public._custo_recalcular_modelos(uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_c1 (drop): nada a apagar' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DO $apaga$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT t.tgname, t.tgrelid::regclass AS tabela FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
              AND c.relname <> 'custo_recalculo_fila'
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado') LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tabela);
  END LOOP;
END $apaga$;

DROP TABLE IF EXISTS public.custo_recalculo_fila;

DROP FUNCTION IF EXISTS public.fn_modelo_custo_derivado();
DROP FUNCTION IF EXISTS public.fn_custo_fila_modelo();
DROP FUNCTION IF EXISTS public.fn_custo_fila_cad();
DROP FUNCTION IF EXISTS public.fn_custo_fila_preco();
DROP FUNCTION IF EXISTS public.fn_custo_fila_por_modelo_tecido();
DROP FUNCTION IF EXISTS public.fn_custo_fila_por_modelo();
DROP FUNCTION IF EXISTS public.fn_custo_processar_fila();
DROP FUNCTION IF EXISTS public._custo_enfileirar(uuid[], boolean);
DROP FUNCTION IF EXISTS public._custo_recalcular_modelos(uuid, uuid[]);
DROP FUNCTION IF EXISTS public._custo_calcular(uuid, uuid[]);
DROP FUNCTION IF EXISTS public._custo_preco_etiqueta(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._custo_preco_etiqueta(uuid, uuid);  -- texto da 1a versao (antes do fix round do G-MIGRATION)
DROP FUNCTION IF EXISTS public._custo_preco_tecido(uuid, uuid);
DROP FUNCTION IF EXISTS public._custo_adicionais_soma(jsonb);
DROP FUNCTION IF EXISTS public._custo_linha(numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public._precos_tecido_congelado_core(uuid, uuid);

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado'))
     OR to_regclass('public.custo_recalculo_fila') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND p.proname IN ('_precos_tecido_congelado_core', '_custo_linha', '_custo_adicionais_soma', '_custo_preco_tecido',
                                   '_custo_preco_etiqueta', '_custo_calcular', '_custo_recalcular_modelos', '_custo_enfileirar',
                                   'fn_custo_processar_fila', 'fn_custo_fila_por_modelo', 'fn_custo_fila_por_modelo_tecido',
                                   'fn_custo_fila_preco', 'fn_custo_fila_cad', 'fn_custo_fila_modelo', 'fn_modelo_custo_derivado')) THEN
    RAISE EXCEPTION 'contas_certas_c1 (drop): sobrou objeto da 20261019300000' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
