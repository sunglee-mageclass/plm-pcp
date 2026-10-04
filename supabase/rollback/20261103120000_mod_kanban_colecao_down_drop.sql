-- DROP separado de supabase/migrations/20261103120000_mod_kanban_colecao.sql — GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod3.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M3/M4/M5/M10, §5 T3, §13); desenho.md (+ RESPOSTAS DO DONO, P-254 A).
-- Apaga _kanban_cond_modulos, _kanban_cond_na e _modelo_colecao_rotulo (o _down deixou-os inertes). RECUSA (P0001) se
-- qualquer outra funcao de public ainda os citar (rode o _down antes).
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
   WHERE n.nspname = 'public' AND p.proname NOT IN ('_kanban_cond_modulos', '_kanban_cond_na', '_modelo_colecao_rotulo')
     AND p.prosrc ~ '\y(_kanban_cond_modulos|_kanban_cond_na|_modelo_colecao_rotulo)\y';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'mod3_drop: rode o _down antes (ainda citam os auxiliares: %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._kanban_cond_na(uuid);
DROP FUNCTION IF EXISTS public._kanban_cond_modulos();
DROP FUNCTION IF EXISTS public._modelo_colecao_rotulo(uuid, uuid, text);

DO $pos$
BEGIN
  IF to_regprocedure('public._kanban_cond_modulos()') IS NOT NULL
     OR to_regprocedure('public._kanban_cond_na(uuid)') IS NOT NULL
     OR to_regprocedure('public._modelo_colecao_rotulo(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'mod3_drop: pos-condicao falhou (auxiliar ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
