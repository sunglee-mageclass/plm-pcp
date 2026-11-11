BEGIN;
-- Coluna da Programada (meta oficial). NULL = ainda não congelada.
ALTER TABLE public.modelo_grades ADD COLUMN IF NOT EXISTS grades_programada jsonb;

-- Congela ao enviar a Ordem de Criação: copia grades -> grades_programada nas linhas que ainda estão NULL.
-- AFTER (fn_modelo_ref_auto é BEFORE, sem conflito) + escreve em modelo_grades (tabela-filha, sem recursão).
CREATE OR REPLACE FUNCTION public.fn_modelo_grade_programada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.ordem_criacao_enviada IS TRUE
     AND OLD.ordem_criacao_enviada IS DISTINCT FROM NEW.ordem_criacao_enviada THEN
    UPDATE public.modelo_grades
       SET grades_programada = grades
     WHERE modelo_id = NEW.id
       AND grades_programada IS NULL;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_grade_programada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_modelo_grade_programada ON public.modelos;
CREATE TRIGGER trg_modelo_grade_programada
  AFTER UPDATE OF ordem_criacao_enviada ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_grade_programada();

-- ── Task 2: editar a Programada (a meta oficial) ───────────────────────────────────────────────────────────────────────
-- _grades = array [{variante_numero:int, grades:jsonb}]. Grava a Programada SÓ das variantes enviadas (estado por variante):
-- variante ausente do array NÃO é tocada nem apagada. Edição explícita: grava mesmo que a linha de modelo_grades tenha nascido
-- DEPOIS do envio da Ordem (grades_programada NULL até o próximo congelamento — nota M3 da Task 1). Variante sem linha em
-- modelo_grades = nada a gravar (a Programada mora na linha da grade; quem cria a linha é o Salvar do BOM).
CREATE OR REPLACE FUNCTION public._salvar_grade_programada_core(_modelo_id uuid, _grades jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF _grades IS NULL OR jsonb_typeof(_grades) <> 'array' THEN
    RAISE EXCEPTION 'grade_invalida: esperado uma lista' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_grades) AS e
     WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
        OR jsonb_typeof(e->'variante_numero') IS DISTINCT FROM 'number'
        OR jsonb_typeof(e->'grades') IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'grade_invalida: cada item precisa de variante_numero e grades' USING ERRCODE='P0001';
  END IF;
  UPDATE public.modelo_grades mg
     SET grades_programada = x.grades
    FROM jsonb_array_elements(_grades) AS e
         CROSS JOIN LATERAL (SELECT (e->>'variante_numero')::int AS vn, e->'grades' AS grades) x
   WHERE mg.modelo_id = _modelo_id AND mg.variante_numero = x.vn;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._salvar_grade_programada_core(uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_grade_programada(_modelo_id uuid, _grades jsonb, _rev_base integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_rev integer; v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Modulo criacao nao habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._seg_exige_pagina('criacao_planejamento','criacao_desenvolvimento');
  SELECT m.tenant_id INTO v_tenant FROM public.modelos m
   WHERE m.id=_modelo_id AND (m.tenant_id=public.get_user_tenant_id() OR public.is_super_admin());
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE='P0002'; END IF;
  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id=_modelo_id FOR UPDATE;
  IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
    RAISE EXCEPTION 'conflito_versao: card' USING ERRCODE='P0409'; END IF;
  PERFORM public._salvar_grade_programada_core(_modelo_id, _grades);
  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id=_modelo_id;
  RETURN jsonb_build_object('modelo_id', _modelo_id, 'rev', v_rev);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.salvar_grade_programada(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_grade_programada(uuid,jsonb,integer) TO authenticated, service_role;
COMMIT;
