-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261030100000_produto_categoria_tecido_material.sql: DROP dos 2 gatilhos de loja, da função, dos 4 índices e das
-- 4 COLUNAS (categoria_tecido_id / material_aviamento_id em produtos_acabados e produtos_importados). GERADO por
-- .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs.
-- ATENÇÃO: DROP TRIGGER prende ~23 tabelas auth/storage/realtime (supautils.policy_grants) até o COMMIT e DROP COLUMN pega
-- AccessExclusive nos 2 produtos: HORÁRIO CALMO, transação curtíssima. Rodar SÓ depois de supabase/rollback/20261030100000_produto_categoria_tecido_material_down.sql (exige a função NEUTRA
-- 9484dc06ee6aaf871308dc2745a7068a) E do _down_drop da I3b (supabase/rollback/20261030110000_integracao_3_campos_down_drop.sql — _integracao_extras lê estas colunas e precisa ter saído antes).
-- Valores gravados nas colunas SÃO APAGADOS: com algum preenchido exige SET app.confirmo_apagar_categoria_material = 'sim'.
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
  v_n bigint := 0;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_produto_cat_material_tenant()')));
  IF v IS NOT NULL AND v <> '9484dc06ee6aaf871308dc2745a7068a' THEN
    RAISE EXCEPTION 'i3a_volta_drop: o gatilho de loja nao esta NEUTRO - rodar o _down antes (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._integracao_extras(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'i3a_volta_drop: _integracao_extras ainda existe - rodar antes o _down_drop da 20261030110000 (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produtos_acabados') AND a.attname = 'categoria_tecido_id' AND NOT a.attisdropped) THEN
    EXECUTE 'SELECT (SELECT count(*) FROM public.produtos_acabados WHERE categoria_tecido_id IS NOT NULL OR material_aviamento_id IS NOT NULL)
                  + (SELECT count(*) FROM public.produtos_importados WHERE categoria_tecido_id IS NOT NULL OR material_aviamento_id IS NOT NULL)'
      INTO v_n;
  END IF;
  IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_categoria_material', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'i3a_volta_drop: % produto(s) com Categoria do tecido/Material do aviamento preenchidos; o DROP apaga - confirme com SET app.confirmo_apagar_categoria_material = ''sim''', v_n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_pa_cat_material_tenant ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_pi_cat_material_tenant ON public.produtos_importados;
DROP FUNCTION IF EXISTS public.fn_produto_cat_material_tenant();
DROP INDEX IF EXISTS public.idx_pa_categoria_tecido;
DROP INDEX IF EXISTS public.idx_pa_material_aviamento;
DROP INDEX IF EXISTS public.idx_pi_categoria_tecido;
DROP INDEX IF EXISTS public.idx_pi_material_aviamento;
ALTER TABLE public.produtos_acabados DROP COLUMN IF EXISTS categoria_tecido_id, DROP COLUMN IF EXISTS material_aviamento_id;
ALTER TABLE public.produtos_importados DROP COLUMN IF EXISTS categoria_tecido_id, DROP COLUMN IF EXISTS material_aviamento_id;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produtos_acabados') AND a.attname = 'categoria_tecido_id' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produtos_acabados') AND a.attname = 'material_aviamento_id' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produtos_importados') AND a.attname = 'categoria_tecido_id' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.produtos_importados') AND a.attname = 'material_aviamento_id' AND NOT a.attisdropped)
     OR to_regprocedure('public.fn_produto_cat_material_tenant()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_pa_cat_material_tenant', 'trg_pi_cat_material_tenant')) THEN
    RAISE EXCEPTION 'i3a_volta_drop: coluna, funcao ou gatilho ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
