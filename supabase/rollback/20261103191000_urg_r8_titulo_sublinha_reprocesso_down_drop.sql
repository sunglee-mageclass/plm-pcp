-- DROP opcional de supabase/migrations/20261103191000_urg_r8_titulo_sublinha_reprocesso.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 5 / R8b; Ruling 18; P-303 A). Molde: I3c 20261030120000
-- (correcao unica dos integraveis) + release 4 20261013100000 (P-127 B / P-129 A: reprocesso so do nome das sublinhas).
-- Rodar SO depois do supabase/rollback/20261103191000_urg_r8_titulo_sublinha_reprocesso_down.sql (o backup e a UNICA copia do antes): DROP do backup public._bkp_r8_titulo_sublinha. RECUSA enquanto algum
-- integravel seguir com a assinatura do reprocesso (assinatura_depois de alguma linha do backup). Trava: AccessExclusive so no
-- proprio backup (nenhuma FK; nada em auth/storage/realtime). Sem o backup o _down nao tem mais o que devolver.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_n integer;
BEGIN
  IF to_regclass('public._bkp_r8_titulo_sublinha') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public._bkp_r8_titulo_sublinha k JOIN public.integracao_produtos p ON p.modelo_id = k.modelo_id'
         || ' AND p.tenant_id = k.tenant_id WHERE p.estado = ''integravel'' AND p.assinatura = k.assinatura_depois' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'r8b_down_drop: % integravel(is) ainda reprocessado(s) - rode o 20261103191000_down antes', v_n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END
$guarda$;

DROP TABLE IF EXISTS public._bkp_r8_titulo_sublinha;

DO $pos$
BEGIN
  IF to_regclass('public._bkp_r8_titulo_sublinha') IS NOT NULL THEN
    RAISE EXCEPTION 'r8b_down_drop: pos-condicao falhou (backup ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
