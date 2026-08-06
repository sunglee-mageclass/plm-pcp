-- MO por serviço — fix round 1 (review, 2026-08-06): guard no rollup contra rev bump espúrio.
-- fn_modelo_servico_mo_rollup fazia UPDATE modelos SEM guard a cada INSERT/UPDATE/DELETE em
-- modelo_servico_mo — mesmo quando o flag derivado não mudava (ex.: editar só o `valor` de uma
-- linha já aprovada) o UPDATE disparava o trigger PRÉ-EXISTENTE trg_colab_rev (fn_colab_touch_rev:
-- new.rev := old.rev + 1), bumpando modelos.rev à toa. O Planejamento usa colab otimista por
-- modelos.rev (.eq('rev', revRef.current), commit 4c09338) — isso geraria P0409 falso nas
-- Tasks 4/5 (aprovar/reprovar linha em paralelo a alguém editando o card do Planejamento).
-- Fix: mesmo padrão IS DISTINCT FROM já usado no recompute inicial da migração anterior
-- (20260806120000, linhas 66-67) — o UPDATE só grava quando o flag REALMENTE muda.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_modelo_servico_mo_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid := COALESCE(NEW.modelo_id, OLD.modelo_id);
BEGIN
  UPDATE public.modelos
     SET custo_terceirizados_aprovado = public._mo_liberada(v_modelo)
   WHERE id = v_modelo
     AND custo_terceirizados_aprovado IS DISTINCT FROM public._mo_liberada(v_modelo);
  RETURN COALESCE(NEW, OLD);
END $function$;

COMMIT;
