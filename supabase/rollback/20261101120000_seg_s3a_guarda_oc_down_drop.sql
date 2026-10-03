-- DROP separado de supabase/migrations/20261101120000_seg_s3a_guarda_oc.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Apaga os 4 gatilhos trg_aaa_seg_pagina e as 4 funcoes fn_seg_pagina_* (que o _down deixou NEUTRAS).
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
-- ⚠️ TRAVA: DROP TRIGGER/DROP FUNCTION como postgres → AccessExclusive nas 4 tabelas de OC E (supautils) em ~23 tabelas de
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
      ('public.fn_seg_pagina_ocs_tecido()', 'dde073565041107e74b3f3e968827239', '7d5383af4740bc09ae81bc01b5bf292d', 'ocs_tecido'),
      ('public.fn_seg_pagina_ocs_tecido_itens()', '985617196668735f319e0e3ca27fc403', 'edf9eb7e9540238ea69dd079b8c537f2', 'ocs_tecido_itens'),
      ('public.fn_seg_pagina_ocs_aviamento()', '6d17c1dc03677fa49e2c84a8098bed22', '11e5cc2eca4e53770eaa4868fa5f8cb7', 'ocs_aviamento'),
      ('public.fn_seg_pagina_ocs_etiqueta()', '2419afb8e1b27625f0714657b5b77fc8', '32deaa83367e28390f3f2ecd77fd6cbb', 'ocs_etiqueta')
    ) AS x(f, d, n, t) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's3a_guarda_down_drop: rode antes o _down (% ainda confere a pagina; md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.ocs_tecido;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_ocs_tecido();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.ocs_tecido_itens;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_ocs_tecido_itens();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.ocs_aviamento;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_ocs_aviamento();
DROP TRIGGER IF EXISTS trg_aaa_seg_pagina ON public.ocs_etiqueta;
DROP FUNCTION IF EXISTS public.fn_seg_pagina_ocs_etiqueta();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_aaa_seg_pagina'
              AND t.tgrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_tecido_itens'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass))
     OR to_regprocedure('public.fn_seg_pagina_ocs_tecido()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_ocs_tecido_itens()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_ocs_aviamento()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_pagina_ocs_etiqueta()') IS NOT NULL THEN
    RAISE EXCEPTION 's3a_guarda_down_drop: pos-condicao falhou (gatilho ou funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
