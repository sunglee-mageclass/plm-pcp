-- Inverso de supabase/migrations/20261101180000_seg_s3c_guarda_ficha.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.5, §2.7 B3, §5, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
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
      ('public.fn_seg_pagina_modelo_etiquetas()', '7e8cb620cd8c697d068bc712e5f2c0df', '2930cab11f9b2836e2005cf0229f9754', 'modelo_etiquetas', 31),
      ('public.fn_seg_pagina_modelo_observacoes()', '649719a1ac1b14f87fdf07bab66aa8f1', '63076d0418d076f0799a58cb48e78eb3', 'modelo_observacoes', 31)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3c_guarda_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3c_guarda_down: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- os gatilhos FICAM (inertes): as funções viram neutras (sem DROP — o DROP prende auth/storage, vai no _down_drop separado)
CREATE OR REPLACE FUNCTION public.fn_seg_pagina_modelo_etiquetas()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3c] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.modelo_etiquetas, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_modelo_observacoes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3c] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.modelo_observacoes, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelo_etiquetas()', '7e8cb620cd8c697d068bc712e5f2c0df', '2930cab11f9b2836e2005cf0229f9754', 'modelo_etiquetas', 31),
      ('public.fn_seg_pagina_modelo_observacoes()', '649719a1ac1b14f87fdf07bab66aa8f1', '63076d0418d076f0799a58cb48e78eb3', 'modelo_observacoes', 31)
    ) AS x(f, d, n, t, tt) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3c_guarda_down: pos-condicao falhou em % (esperado o texto neutro)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
