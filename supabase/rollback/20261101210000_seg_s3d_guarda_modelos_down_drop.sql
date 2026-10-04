-- DROP separado de supabase/migrations/20261101210000_seg_s3d_guarda_modelos.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3d.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A).
-- Apaga os 3 gatilhos trg_aaa_seg_pagina (modelos, produtos_acabados, produtos_importados) e as 3 funcoes (o _down as deixou NEUTRAS).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_modelos() (NOVA)
--     ANTES  ausente
--     DEPOIS f2e6579a764661ed6be0afe643050c6d
--     NEUTRA 382c59774ba779b27fcf2ebc6a0901be (o _down)
--   public.fn_seg_pagina_produtos_acabados() (NOVA)
--     ANTES  ausente
--     DEPOIS d3faa369eeccc8759cb1ca1c195bde1c
--     NEUTRA ab09f88a63e984fea51b9d6a5f3bccea (o _down)
--   public.fn_seg_pagina_produtos_importados() (NOVA)
--     ANTES  ausente
--     DEPOIS 854fefdd5519e875d5f2f6c947d086ae
--     NEUTRA 151187e6ad8c8c6ea168602b103185db (o _down)
-- ====================================================================================
-- ⚠️ TRAVA: DROP TRIGGER/DROP FUNCTION como postgres → AccessExclusive nas 3 tabelas E (supautils) em ~23 tabelas de
-- auth/storage/realtime até o COMMIT. SÓ em horário calmo, transação curtíssima. Nunca junto da ida de outra release.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelos()', 'f2e6579a764661ed6be0afe643050c6d', '382c59774ba779b27fcf2ebc6a0901be', 'modelos', 31),
      ('public.fn_seg_pagina_produtos_acabados()', 'd3faa369eeccc8759cb1ca1c195bde1c', 'ab09f88a63e984fea51b9d6a5f3bccea', 'produtos_acabados', 19),
      ('public.fn_seg_pagina_produtos_importados()', '854fefdd5519e875d5f2f6c947d086ae', '151187e6ad8c8c6ea168602b103185db', 'produtos_importados', 19)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3d_guarda_down_drop: rode antes o _down (% ainda confere a pagina; md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.modelos;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_modelos();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.produtos_acabados;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_produtos_acabados();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.produtos_importados;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_produtos_importados();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_aaa_seg_pagina'
              AND t.tgrelid IN ('public.modelos'::regclass, 'public.produtos_acabados'::regclass, 'public.produtos_importados'::regclass))
     OR to_regprocedure('public.fn_seg_pagina_modelos()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_produtos_acabados()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_produtos_importados()') IS NOT NULL THEN
    RAISE EXCEPTION 's3d_guarda_down_drop: pos-condicao falhou (gatilho ou funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
