-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261028200000_revenda_insumo_preco.sql (achados
-- LEVES L8, preco M2): DROP TRIGGER trg_preco_comprado_insumo_ins/_upd/_del (modelo_etiquetas) + DROP FUNCTION
-- fn_preco_comprado_por_insumo.
-- ATENCAO: DROP TRIGGER pega AccessExclusive em modelo_etiquetas e prende ~23 tabelas auth/storage/realtime
-- (supautils.policy_grants) ate o COMMIT: HORARIO CALMO, transacao curtissima. Rodar SO depois do _down (exige a funcao
-- NEUTRA, md5 28dc17f09237af0b177e38ee2a1da92a). Volta os gatilhos de modelo_etiquetas ao conjunto de antes (5:2d1af35be2988276abee2be35a82f13f).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_preco_comprado_por_insumo()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_preco_comprado_por_insumo()'))) IS DISTINCT FROM '28dc17f09237af0b177e38ee2a1da92a' THEN
    RAISE EXCEPTION 'leves_l8 (volta drop): a funcao do gatilho nao esta NEUTRA - rodar o _down antes' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DROP TRIGGER IF EXISTS trg_preco_comprado_insumo_ins ON public.modelo_etiquetas;
DROP TRIGGER IF EXISTS trg_preco_comprado_insumo_upd ON public.modelo_etiquetas;
DROP TRIGGER IF EXISTS trg_preco_comprado_insumo_del ON public.modelo_etiquetas;
DROP FUNCTION IF EXISTS public.fn_preco_comprado_por_insumo();

DO $pos$
DECLARE
  v_set text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg\_preco\_comprado\_insumo\_%') OR to_regprocedure('public.fn_preco_comprado_por_insumo()') IS NOT NULL THEN
    RAISE EXCEPTION 'leves_l8 (volta drop): gatilho ou funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
    INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.modelo_etiquetas') AND NOT t.tgisinternal;
  IF v_set IS DISTINCT FROM '5:2d1af35be2988276abee2be35a82f13f' THEN
    RAISE EXCEPTION 'leves_l8 (volta drop): gatilhos de modelo_etiquetas = % (esperado o de antes 5:2d1af35be2988276abee2be35a82f13f)', v_set USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
