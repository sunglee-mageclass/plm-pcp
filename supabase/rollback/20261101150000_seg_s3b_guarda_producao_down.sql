-- Inverso de supabase/migrations/20261101150000_seg_s3b_guarda_producao.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.3-2.4, §3, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_cad() (NOVA)
--     ANTES  ausente
--     DEPOIS ebe2e35d3f617c3de27304294553c4ba
--     NEUTRA a8576e43dacb0bb3d280f86eb22f5a15 (o _down)
--   public.fn_seg_pagina_controle_qualidade() (NOVA)
--     ANTES  ausente
--     DEPOIS 95a0241d7ec2691c49e3a87a89ab2ed8
--     NEUTRA 21f12cc9d8e0175456233c1c32ec2ab2 (o _down)
--   public.fn_seg_pagina_producao_oficina() (NOVA)
--     ANTES  ausente
--     DEPOIS f852373524c41e60c117148b6ffc87e0
--     NEUTRA 468a65bc549fcc0dd7106be99205cbb6 (o _down)
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
      ('public.fn_seg_pagina_cad()', 'ebe2e35d3f617c3de27304294553c4ba', 'a8576e43dacb0bb3d280f86eb22f5a15', 'cad', 19),
      ('public.fn_seg_pagina_controle_qualidade()', '95a0241d7ec2691c49e3a87a89ab2ed8', '21f12cc9d8e0175456233c1c32ec2ab2', 'controle_qualidade', 19),
      ('public.fn_seg_pagina_producao_oficina()', 'f852373524c41e60c117148b6ffc87e0', '468a65bc549fcc0dd7106be99205cbb6', 'producao_oficina', 31)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3b_guarda_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3b_guarda_down: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- os gatilhos FICAM (inertes): as funções viram neutras (sem DROP — o DROP prende auth/storage, vai no _down_drop separado)
CREATE OR REPLACE FUNCTION public.fn_seg_pagina_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3b] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.cad, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_controle_qualidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3b] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.controle_qualidade, mas nao confere nada.
-- O DROP do gatilho e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_producao_oficina()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3b] NEUTRALIZADA pelo inverso (_down): o gatilho trg_aaa_seg_pagina segue em public.producao_oficina, mas nao confere nada.
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
      ('public.fn_seg_pagina_cad()', 'ebe2e35d3f617c3de27304294553c4ba', 'a8576e43dacb0bb3d280f86eb22f5a15', 'cad', 19),
      ('public.fn_seg_pagina_controle_qualidade()', '95a0241d7ec2691c49e3a87a89ab2ed8', '21f12cc9d8e0175456233c1c32ec2ab2', 'controle_qualidade', 19),
      ('public.fn_seg_pagina_producao_oficina()', 'f852373524c41e60c117148b6ffc87e0', '468a65bc549fcc0dd7106be99205cbb6', 'producao_oficina', 31)
    ) AS x(f, d, n, t, tt) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3b_guarda_down: pos-condicao falhou em % (esperado o texto neutro)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
