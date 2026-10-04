-- Inverso de supabase/migrations/20261101210000_seg_s3d_guarda_modelos.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3d.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
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
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION): nenhuma tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

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
    IF v IS NULL OR (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3d_guarda_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3d_guarda_down: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- os gatilhos FICAM (inertes): as funções viram neutras (sem DROP — o DROP prende auth/storage, vai no _down_drop separado)
CREATE OR REPLACE FUNCTION public.fn_seg_pagina_modelos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3d] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.modelos, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_produtos_acabados()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3d] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.produtos_acabados, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_produtos_importados()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3d] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.produtos_importados, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN NEW;
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelos()', 'f2e6579a764661ed6be0afe643050c6d', '382c59774ba779b27fcf2ebc6a0901be', 'modelos', 31),
      ('public.fn_seg_pagina_produtos_acabados()', 'd3faa369eeccc8759cb1ca1c195bde1c', 'ab09f88a63e984fea51b9d6a5f3bccea', 'produtos_acabados', 19),
      ('public.fn_seg_pagina_produtos_importados()', '854fefdd5519e875d5f2f6c947d086ae', '151187e6ad8c8c6ea168602b103185db', 'produtos_importados', 19)
    ) AS x(f, d, n, t, tt) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3d_guarda_down: pos-condicao falhou em % (esperado o texto neutro)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
