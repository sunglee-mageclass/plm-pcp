-- DROP separado de supabase/migrations/20261103100000_mod_gates_rpcs.sql — GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod1.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M1/M2, §3 T1, §13); desenho.md (+ RESPOSTAS DO DONO, P-253 A).
-- Apaga _exige_modulos e _tenant_modulo_ligado (o _down deixou-os inertes). RECUSA (P0001) se qualquer funcao de public
-- ainda os citar (pega tambem T2/T3 aplicadas: rode os _down delas e o desta antes).
-- Trava: DROP FUNCTION = catalogo; por cautela (supautils em producao), horario calmo, transacao curtissima.
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname NOT IN ('_exige_modulos', '_tenant_modulo_ligado')
     AND p.prosrc ~ '\y(_exige_modulos|_tenant_modulo_ligado)\y';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'mod1_drop: rode o _down antes (ainda citam os auxiliares: %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._exige_modulos(text[]);
DROP FUNCTION IF EXISTS public._tenant_modulo_ligado(uuid, text);

DO $pos$
BEGIN
  IF to_regprocedure('public._exige_modulos(text[])') IS NOT NULL OR to_regprocedure('public._tenant_modulo_ligado(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'mod1_drop: pos-condicao falhou (auxiliar ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
