-- DROP separado de supabase/migrations/20261101180000_seg_s3c_guarda_ficha.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.5, §2.7 B3, §5, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B).
-- Apaga os 2 gatilhos trg_aaa_seg_pagina (modelo_etiquetas, modelo_observacoes) e as 2 funcoes (o _down as deixou NEUTRAS).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_modelo_etiquetas() (NOVA)
--     ANTES  ausente
--     DEPOIS 7e8cb620cd8c697d068bc712e5f2c0df
--     NEUTRA 2930cab11f9b2836e2005cf0229f9754 (o _down)
--   public.fn_seg_pagina_modelo_observacoes() (NOVA)
--     ANTES  ausente
--     DEPOIS 649719a1ac1b14f87fdf07bab66aa8f1
--     NEUTRA 63076d0418d076f0799a58cb48e78eb3 (o _down)
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
      ('public.fn_seg_pagina_modelo_etiquetas()', '7e8cb620cd8c697d068bc712e5f2c0df', '2930cab11f9b2836e2005cf0229f9754', 'modelo_etiquetas', 31),
      ('public.fn_seg_pagina_modelo_observacoes()', '649719a1ac1b14f87fdf07bab66aa8f1', '63076d0418d076f0799a58cb48e78eb3', 'modelo_observacoes', 31)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3c_guarda_down_drop: rode antes o _down (% ainda confere a pagina; md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.modelo_etiquetas;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_modelo_etiquetas();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.modelo_observacoes;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_modelo_observacoes();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_aaa_seg_pagina'
              AND t.tgrelid IN ('public.modelo_etiquetas'::regclass, 'public.modelo_observacoes'::regclass))
     OR to_regprocedure('public.fn_seg_pagina_modelo_etiquetas()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_modelo_observacoes()') IS NOT NULL THEN
    RAISE EXCEPTION 's3c_guarda_down_drop: pos-condicao falhou (gatilho ou funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
