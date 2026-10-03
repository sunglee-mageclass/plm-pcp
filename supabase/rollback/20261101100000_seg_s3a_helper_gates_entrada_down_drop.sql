-- DROP separado de supabase/migrations/20261101100000_seg_s3a_helper_gates_entrada.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Apaga o helper _seg_exige_pagina (o _down deixou-o no banco, inerte). Recusa se alguma funcao ainda o chama.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._seg_exige_pagina(text[]) (NOVA)
--     ANTES  ausente
--     DEPOIS 85eff0037e61fdecefb46154ac9479d2
--   public.recalcular_parcelas(uuid,text)
--     ANTES  aa6df4729aeaa0f7bd08a2c0833d8b52
--     DEPOIS eccb4e6c556be0cbc437b60bb480157f
--   public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)
--     ANTES  8167e804a4473e6032c74f8fa4be7a1c
--     DEPOIS 26c656169b6f9ef826e5b93932b15fe9
--   public.excluir_oc_tecido(uuid)
--     ANTES  70d7b13d004c8627bd51c0450f7bbff2
--     DEPOIS ebb2703d25f75956cb1a054e35be954d
--   public.desmarcar_recebimento_oc(text,uuid)
--     ANTES  6c3eb8d58ba58b8a91f08618479d6dce
--     DEPOIS c05f87ae8644aca380db8a200bec13b0
--   public.gerar_rolos_recebimento(uuid,jsonb)
--     ANTES  5fc8dfda7be61fc60bf316ca7d1ebfc7
--     DEPOIS 17654549c944436454a147509f4c113e
--   public.reverter_rolos_oc(uuid)
--     ANTES  4a3cd33ead95ae50c907ca8b3a7e7ade
--     DEPOIS d1f110cd6f340a1db878509f85f597d0
--   public.salvar_oc_aviamento(uuid,jsonb,jsonb)
--     ANTES  7b4dec050314b8b6dae77685297bd73e
--     DEPOIS 69531332f9e78256b042b989dbaffb87
--   public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)
--     ANTES  4ac66c2ed2407b61511a9c61f0eeaee6
--     DEPOIS ffb1f2c87801362f9f9895be07d71dc0
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb)
--     ANTES  598cce7a6f0006cdd111a1b1f7f39d58
--     DEPOIS 484b694ecc31f4c897c435063d18310e
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)
--     ANTES  4396c443f53c063b31159018bfa3914e
--     DEPOIS 2981a2cb4ea80fd5bed5f6999244365b
--   public.desmarcar_recebimento_oc_etiqueta(uuid)
--     ANTES  39a58a5518ec508830747ee70be58372
--     DEPOIS 0b4d22156cf5e2c1a9b4d69ae2a93838
--   public.salvar_oc_p_acabado(uuid,jsonb,jsonb)
--     ANTES  7829bb493f59c0ba821085721e65d4e1
--     DEPOIS 1eb3e4af0ff746aa6121cc00155d97f6
--   public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)
--     ANTES  e9b2d72d81433d07d11f5c4e2156628b
--     DEPOIS 521339232dfb8e20bcd66ad6b4afb93a
--   public.receber_oc_p_acabado(uuid,jsonb,jsonb)
--     ANTES  22b6747afe6e674b1e5d57be3edbea01
--     DEPOIS e342b8e3a8f6e38d267bed5095d3375d
--   public.excluir_oc_p_acabado(uuid)
--     ANTES  c68c7df441da35e63ac79fd23cbae6f8
--     DEPOIS 20bdb6b7e549a5823cc72d833ef745f5
--   public.vincular_oc_p_acabado(uuid,uuid)
--     ANTES  23e205dd4bb98636475f36cad83ff620
--     DEPOIS 625d02a8b991f997d283ffd2fda29aae
--   public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb)
--     ANTES  078132996c6d363b60fec6d6f46cae6d
--     DEPOIS a9c4f0c8452c740206f9579c7c8de929
--   public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)
--     ANTES  053325a7e2633055b4493c5a152f7ae3
--     DEPOIS 31a3dab4acfd24b2f1189c3bfd50b38a
--   public.receber_oc_importado(uuid,jsonb,jsonb)
--     ANTES  b2be2540cbbeb9d95613e484175881fd
--     DEPOIS 989c0b63698dba7476e504acdfd5e0f1
--   public.excluir_oc_importado(uuid)
--     ANTES  301b365ae998c8fe5919a457a585f2f6
--     DEPOIS 5928882b15caaf26add9e22cec9ecae8
--   public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)
--     ANTES  abccaaa6c4646457b50ed4cda8019c01
--     DEPOIS 5c51dc36660259c79d4c4d8b2327e2d8
--   public.receber_reposicao_troca(uuid,date,numeric)
--     ANTES  6f8f2b4d41362fa70f2304afbb85acc7
--     DEPOIS bc4dfc3397ef712b84b0bb5538e6f16a
--   public.cancelar_rolo(uuid)
--     ANTES  75cb967a4385371e61e53fa8cf54f222
--     DEPOIS 30e0bfc32675d3c231295216afa0df55
--   public.reabrir_rolo(uuid)
--     ANTES  24a5df49f898676c4b2e346e2b347c39
--     DEPOIS 1b678fc7e504eceb0268eeaa0c5c6acc
--   public.trocar_rolo(uuid,numeric)
--     ANTES  673d196185425e6946ad5c9b7f6dca20
--     DEPOIS 49f03b7e2ec5e03d3b817d6011a78185
--   public.criar_rolo(text,uuid,jsonb,uuid,text,text)
--     ANTES  5307ecd59ac9517a3b373e3807cd8a15
--     DEPOIS 0413b0c5de00268883ffff65d5298783
--   public.excluir_rolo(uuid)
--     ANTES  96212ced1ada5dc997bf9d2b2e049339
--     DEPOIS 8d8e60ef55c3e485d72bb627f042d83a
--   public.ajustar_rolo(uuid,numeric)
--     ANTES  bbc7057409103ee337446b8bb0876422
--     DEPOIS d7e148e99acc77141a8d96758c16165b
--   public.proximo_codigo_rolo(uuid)
--     ANTES  cbea062409bd8f964f19c40f491b31bd
--     DEPOIS cdcb4ab98c0439edf0695cf678d75532
--   public.remover_metragem_oc(uuid,numeric,text)
--     ANTES  acf07d551cd3ac434ae4262dbce4e6a6
--     DEPOIS e91c8a1dc9236aa8671ff1967d71e3f8
--   public.reverter_ajuste_estoque(uuid)
--     ANTES  a77f4ecd1112725e98c15374df99bf5e
--     DEPOIS e1d01408710ec42ed5cb859f4772fc78
--   public.salvar_os(text,uuid,jsonb,jsonb)
--     ANTES  b30d09c4f0dae41778f0c518f4071468
--     DEPOIS 965b8940c1353799a92523ad1e501b6a
--   public.baixar_os(text,uuid,jsonb)
--     ANTES  b18fa580d263ddeb09b27e06325eb6cc
--     DEPOIS 61e0036db0597f7aa8954c4c5ad813b9
--   public.desmarcar_os(text,uuid)
--     ANTES  de3fc7361120fe7eb7fbe68adf1f7619
--     DEPOIS d57d9ca2e7d4e977df262d0e8117dbb4
-- ====================================================================================
-- ⚠️ TRAVA: DROP FUNCTION como postgres (catálogo); por cautela, mesmo tratamento do DROP TRIGGER (supautils) —
-- auth/storage/realtime até o COMMIT. SÓ em horário calmo, transação curtíssima. Nunca junto da ida de outra release.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname <> '_seg_exige_pagina' AND p.prosrc LIKE '%_seg_exige_pagina%';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 's3a_gates_down_drop: rode antes os inversos (ainda chamam _seg_exige_pagina: %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._seg_exige_pagina(text[]);

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regprocedure('public._seg_exige_pagina(text[])') IS NOT NULL THEN
    RAISE EXCEPTION 's3a_gates_down_drop: pos-condicao falhou (_seg_exige_pagina ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
