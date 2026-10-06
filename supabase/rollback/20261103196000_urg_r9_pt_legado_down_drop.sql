-- DROP opcional de supabase/migrations/20261103196000_urg_r9_pt_legado.sql (urg R9e): apaga os 2 backups
-- public._bkp_r9_pt_legado e public._bkp_r9_exige_pl. Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 4 / R9e).
-- Rodar SO depois do supabase/rollback/20261103196000_urg_r9_pt_legado_down.sql: RECUSA enquanto alguma categoria que a ida ligou
--   seguir ligada (o _backup_ e a unica copia do "antes"). Exige SET app.confirmo_apagar_backup_r9 = 'sim' quando ha backup a apagar.
--   As tentativas origem 'legado' NAO sao tocadas (saem no 192000_down_drop). Sem os backups, reaplicar a ida reclassifica os blocos
--   (os ja migrados viram 'legado_ja_tem'; nada duplica).
-- Trava: AccessExclusive so nos 2 backups (nenhuma FK, ninguem le); nada em auth/storage/realtime. Idempotente (2a vez = NOTICE).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_n integer;
BEGIN
  IF to_regclass('public._bkp_r9_pt_legado') IS NULL AND to_regclass('public._bkp_r9_exige_pl') IS NULL THEN
    RAISE NOTICE 'urg_r9e_down_drop: backups ja ausentes - nada a fazer';
    RETURN;
  END IF;
  IF coalesce(current_setting('app.confirmo_apagar_backup_r9', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'urg_r9e_down_drop: exige SET app.confirmo_apagar_backup_r9 = ''sim'' (apaga os backups da correcao unica R9e)'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public._bkp_r9_exige_pl') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public._bkp_r9_exige_pl b JOIN public.categorias_terceirizado c ON c.id = b.categoria_id'
         || ' WHERE c.exige_peca_teste AND NOT b.antes' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'urg_r9e_down_drop: % categoria(s) ainda ligada(s) pela ida - rode o 20261103196000_down antes', v_n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END
$guarda$;

DROP TABLE IF EXISTS public._bkp_r9_pt_legado;
DROP TABLE IF EXISTS public._bkp_r9_exige_pl;

DO $pos$
BEGIN
  IF to_regclass('public._bkp_r9_pt_legado') IS NOT NULL OR to_regclass('public._bkp_r9_exige_pl') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r9e_down_drop: pos-condicao falhou (backup ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
