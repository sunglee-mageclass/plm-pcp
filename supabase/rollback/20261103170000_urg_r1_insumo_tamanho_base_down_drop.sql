-- DROP opcional de supabase/migrations/20261103170000_urg_r1_insumo_tamanho_base.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Rodar SO com o SITE ja voltado e DEPOIS dos _down de 170500..173000 (e do _down_drop da 170500), em HORARIO CALMO:
-- DROP COLUMN pega AccessExclusiveLock em public.etiquetas ate o COMMIT (leitura e escrita de etiquetas esperam). Os vinculos
-- gravados SE PERDEM: com algum vinculo preenchido exige SET LOCAL app.confirmo_apagar_vinculo_tamanho = 'sim' na mesma txn.
-- Guarda: nenhuma OUTRA funcao de public cita os 6 helpers nem a coluna (varre o prosrc, inclusive comentarios).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
  n bigint := 0;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT (p.oid = ANY (array_remove(ARRAY[to_regprocedure('public._insumo_tamanho_efetivo(text,text,boolean)'), to_regprocedure('public._insumo_pecas(text,jsonb,numeric)'), to_regprocedure('public._insumo_fator_custo(text,jsonb,numeric)'), to_regprocedure('public._insumo_tamanho_de(uuid)'), to_regprocedure('public._grade_mapa_modelo(uuid)'), to_regprocedure('public._grade_mapa_cad(uuid,boolean)')]::oid[], NULL)))
     AND (p.prosrc ~ '_insumo_tamanho_efetivo|_insumo_pecas|_insumo_fator_custo|_insumo_tamanho_de|_grade_mapa_modelo|_grade_mapa_cad' OR p.prosrc ~ 'tamanho_vinculado');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r1_170000_down_drop: funcoes ainda citam os helpers ou a coluna: % - rode os _down dos blocos seguintes antes', v
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                AND column_name = 'tamanho_vinculado') THEN
    EXECUTE 'SELECT count(*) FROM public.etiquetas WHERE nullif(btrim(tamanho_vinculado), '''') IS NOT NULL' INTO n;
  END IF;
  IF n > 0 AND coalesce(current_setting('app.confirmo_apagar_vinculo_tamanho', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'urg_r1_170000_down_drop: % insumo(s) com vinculo de tamanho gravado - confirme com SET LOCAL app.confirmo_apagar_vinculo_tamanho = sim', n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._grade_mapa_cad(uuid,boolean);
DROP FUNCTION IF EXISTS public._grade_mapa_modelo(uuid);
DROP FUNCTION IF EXISTS public._insumo_tamanho_de(uuid);
DROP FUNCTION IF EXISTS public._insumo_fator_custo(text,jsonb,numeric);
DROP FUNCTION IF EXISTS public._insumo_pecas(text,jsonb,numeric);
DROP FUNCTION IF EXISTS public._insumo_tamanho_efetivo(text,text,boolean);
ALTER TABLE public.etiquetas DROP COLUMN IF EXISTS tamanho_vinculado;

DO $pos$
BEGIN
  IF to_regprocedure('public._insumo_tamanho_efetivo(text,text,boolean)') IS NOT NULL
     OR to_regprocedure('public._insumo_pecas(text,jsonb,numeric)') IS NOT NULL
     OR to_regprocedure('public._insumo_fator_custo(text,jsonb,numeric)') IS NOT NULL
     OR to_regprocedure('public._insumo_tamanho_de(uuid)') IS NOT NULL
     OR to_regprocedure('public._grade_mapa_modelo(uuid)') IS NOT NULL
     OR to_regprocedure('public._grade_mapa_cad(uuid,boolean)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                   AND column_name = 'tamanho_vinculado') THEN
    RAISE EXCEPTION 'urg_r1_170000_down_drop: pos-condicao falhou (helper ou coluna ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
