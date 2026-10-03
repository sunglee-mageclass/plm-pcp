-- Inverso de supabase/migrations/20261101120000_seg_s3a_guarda_oc.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_ocs_tecido() (NOVA)
--     ANTES  ausente
--     DEPOIS dde073565041107e74b3f3e968827239
--     NEUTRA 7d5383af4740bc09ae81bc01b5bf292d (o _down)
--   public.fn_seg_pagina_ocs_tecido_itens() (NOVA)
--     ANTES  ausente
--     DEPOIS 985617196668735f319e0e3ca27fc403
--     NEUTRA edf9eb7e9540238ea69dd079b8c537f2 (o _down)
--   public.fn_seg_pagina_ocs_aviamento() (NOVA)
--     ANTES  ausente
--     DEPOIS 6d17c1dc03677fa49e2c84a8098bed22
--     NEUTRA 11e5cc2eca4e53770eaa4868fa5f8cb7 (o _down)
--   public.fn_seg_pagina_ocs_etiqueta() (NOVA)
--     ANTES  ausente
--     DEPOIS 2419afb8e1b27625f0714657b5b77fc8
--     NEUTRA 32deaa83367e28390f3f2ecd77fd6cbb (o _down)
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / GRANT-REVOKE de função): nenhuma tabela de negócio, nada de
-- auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY.
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
      ('public.fn_seg_pagina_ocs_tecido()', 'dde073565041107e74b3f3e968827239', '7d5383af4740bc09ae81bc01b5bf292d', 'ocs_tecido'),
      ('public.fn_seg_pagina_ocs_tecido_itens()', '985617196668735f319e0e3ca27fc403', 'edf9eb7e9540238ea69dd079b8c537f2', 'ocs_tecido_itens'),
      ('public.fn_seg_pagina_ocs_aviamento()', '6d17c1dc03677fa49e2c84a8098bed22', '11e5cc2eca4e53770eaa4868fa5f8cb7', 'ocs_aviamento'),
      ('public.fn_seg_pagina_ocs_etiqueta()', '2419afb8e1b27625f0714657b5b77fc8', '32deaa83367e28390f3f2ecd77fd6cbb', 'ocs_etiqueta')
    ) AS x(f, d, n, t) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3a_guarda_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3a_guarda_down: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- os gatilhos FICAM (inertes): as funções viram neutras (sem DROP — o DROP prende auth/storage, vai no _down_drop separado)
CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.ocs_tecido, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_tecido_itens()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.ocs_tecido_itens, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_aviamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.ocs_aviamento, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_ocs_etiqueta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3a] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.ocs_etiqueta, mas nao confere nada.
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
      ('public.fn_seg_pagina_ocs_tecido()', 'dde073565041107e74b3f3e968827239', '7d5383af4740bc09ae81bc01b5bf292d', 'ocs_tecido'),
      ('public.fn_seg_pagina_ocs_tecido_itens()', '985617196668735f319e0e3ca27fc403', 'edf9eb7e9540238ea69dd079b8c537f2', 'ocs_tecido_itens'),
      ('public.fn_seg_pagina_ocs_aviamento()', '6d17c1dc03677fa49e2c84a8098bed22', '11e5cc2eca4e53770eaa4868fa5f8cb7', 'ocs_aviamento'),
      ('public.fn_seg_pagina_ocs_etiqueta()', '2419afb8e1b27625f0714657b5b77fc8', '32deaa83367e28390f3f2ecd77fd6cbb', 'ocs_etiqueta')
    ) AS x(f, d, n, t) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3a_guarda_down: pos-condicao falhou em % (esperado o texto neutro)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
