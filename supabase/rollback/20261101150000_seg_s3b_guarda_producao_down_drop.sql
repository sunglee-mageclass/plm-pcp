-- DROP separado de supabase/migrations/20261101150000_seg_s3b_guarda_producao.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.3-2.4, §3, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A).
-- Apaga os 3 gatilhos trg_aaa_seg_pagina (cad, controle_qualidade, producao_oficina) e as 3 funcoes (o _down as deixou NEUTRAS).
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
      ('public.fn_seg_pagina_cad()', 'ebe2e35d3f617c3de27304294553c4ba', 'a8576e43dacb0bb3d280f86eb22f5a15', 'cad', 19),
      ('public.fn_seg_pagina_controle_qualidade()', '95a0241d7ec2691c49e3a87a89ab2ed8', '21f12cc9d8e0175456233c1c32ec2ab2', 'controle_qualidade', 19),
      ('public.fn_seg_pagina_producao_oficina()', 'f852373524c41e60c117148b6ffc87e0', '468a65bc549fcc0dd7106be99205cbb6', 'producao_oficina', 31)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3b_guarda_down_drop: rode antes o _down (% ainda confere a pagina; md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.cad;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_cad();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.controle_qualidade;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_controle_qualidade();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.producao_oficina;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_producao_oficina();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_aaa_seg_pagina'
              AND t.tgrelid IN ('public.cad'::regclass, 'public.controle_qualidade'::regclass, 'public.producao_oficina'::regclass))
     OR to_regprocedure('public.fn_seg_pagina_cad()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_controle_qualidade()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_producao_oficina()') IS NOT NULL THEN
    RAISE EXCEPTION 's3b_guarda_down_drop: pos-condicao falhou (gatilho ou funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
