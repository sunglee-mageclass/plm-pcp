-- Direcionamento — correções do review do time (cirúrgico completo).
--
-- Decisões do dono:
--   • Split SEMPRE fecha: servidor deriva loja_fisica/totais da Grade Real (cad_grades)
--     e trava ecommerce ≤ real por tamanho (bloqueia Confirmar; clampa no rascunho).
--   • Grade Real defasada REBAIXA o Direcionamento: se o CQ muda a grade real depois de
--     confirmado (Separado), volta a Pendente e acende o #Erro (etapa 'direcionamento').
--   • Confirmar ATÔMICO: uma RPC (save + flip de status na mesma txn).
--   • 2º lote continua fora do split (a Grade Real já o desconta).

-- ============================================================================
-- [B1] Unique da chave natural do upsert (cad_id, variante_numero). Composta =
-- segura p/ embed (não vira to-one). Serve de índice do UPDATE ...WHERE par e
-- barra duplicata em saves concorrentes.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS direcionamento_cad_variante_uidx
  ON public.direcionamento (cad_id, variante_numero);

-- ============================================================================
-- [A1] Núcleo do save/confirm do Direcionamento. Deriva o split no SERVIDOR a
-- partir da Grade Real autoritativa (cad_grades.grades_reais) — ignora real/
-- loja_fisica/totais do cliente. _strict=true (Confirmar) dá RAISE se ec>real;
-- _strict=false (rascunho) clampa. _confirmar=true marca cad como 'separado'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._salvar_direcionamento_core(_cad_id uuid, _rows jsonb, _strict boolean, _confirmar boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  r jsonb; t text;
  v_nums int[] := '{}';
  v_num int;
  v_real jsonb; v_ec jsonb; v_lf jsonb;
  v_ec_total int; v_lf_total int; v_real_total int;
  v_rt int;   -- real do tamanho (autoritativo)
  v_et int;   -- ec pedido pelo cliente
  v_ecv int;  -- ec efetivo (clampado/validado)
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_rows) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
      v_num := (r->>'variante_numero')::int;
      -- Real AUTORITATIVO = grade real do CQ, não o snapshot do cliente.
      SELECT COALESCE(grades_reais, '{}'::jsonb) INTO v_real
        FROM public.cad_grades WHERE cad_id = _cad_id AND variante_numero = v_num;
      v_real := COALESCE(v_real, '{}'::jsonb);
      v_ec := '{}'::jsonb; v_lf := '{}'::jsonb;
      v_ec_total := 0; v_lf_total := 0; v_real_total := 0;
      FOR t IN SELECT jsonb_object_keys(v_real) LOOP
        v_rt := COALESCE((v_real->>t)::int, 0);
        v_et := COALESCE((r->'ecommerce'->>t)::int, 0);
        IF v_et < 0 THEN v_et := 0; END IF;
        IF v_et > v_rt THEN
          IF _strict THEN
            RAISE EXCEPTION 'E-commerce (%) excede a Grade Real (%) no tamanho % — ajuste antes de confirmar.',
              v_et, v_rt, t USING ERRCODE = '23514';
          END IF;
          v_ecv := v_rt;  -- rascunho tolera: clampa
        ELSE
          v_ecv := v_et;
        END IF;
        v_ec := v_ec || jsonb_build_object(t, v_ecv);
        v_lf := v_lf || jsonb_build_object(t, v_rt - v_ecv);
        v_ec_total := v_ec_total + v_ecv;
        v_lf_total := v_lf_total + (v_rt - v_ecv);
        v_real_total := v_real_total + v_rt;
      END LOOP;

      UPDATE public.direcionamento SET
        ecommerce = v_ec, ecommerce_total = v_ec_total,
        loja_fisica = v_lf, loja_fisica_total = v_lf_total,
        real = v_real, grade_real_total = v_real_total
      WHERE cad_id = _cad_id AND variante_numero = v_num;
      IF NOT FOUND THEN
        INSERT INTO public.direcionamento
          (cad_id, variante_numero, ecommerce, ecommerce_total, loja_fisica, loja_fisica_total, real, grade_real_total)
        VALUES (_cad_id, v_num, v_ec, v_ec_total, v_lf, v_lf_total, v_real, v_real_total);
      END IF;
      v_nums := array_append(v_nums, v_num);
    END LOOP;
  END IF;

  DELETE FROM public.direcionamento
   WHERE cad_id = _cad_id AND NOT (variante_numero = ANY(v_nums));

  IF _confirmar THEN
    UPDATE public.cad
       SET direcionamento_status = 'separado', direcionamento_confirmado_at = now()
     WHERE id = _cad_id;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._salvar_direcionamento_core(uuid, jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- Wrapper de RASCUNHO (clampa ec≤real, não mexe no status).
CREATE OR REPLACE FUNCTION public.salvar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, false, false);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.salvar_direcionamento(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_direcionamento(uuid, jsonb) TO authenticated;

-- [M1] Wrapper de CONFIRMAR: save (strict, RAISE se ec>real) + flip de status na
-- MESMA transação — atômico, um roundtrip só.
CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.confirmar_direcionamento(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_direcionamento(uuid, jsonb) TO authenticated;

-- ============================================================================
-- [A2] Grade Real mudou → rebaixa o Direcionamento confirmado. Trigger em
-- cad_grades: pega TODO caminho que altera a grade real (CQ confirmar, desmarcar,
-- reconfirmar) — não só uma RPC. Se o Direcionamento estava 'separado', volta a
-- 'pendente' e acende o #Erro na etapa 'direcionamento' (espelha o M2 do CQ:
-- mexer na base rebaixa quem se apoia nela).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_rebaixa_direcionamento_grade()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Só age quando a grade real de fato mudou (UPDATE) e há Direcionamento confirmado.
  IF TG_OP = 'UPDATE' AND NEW.grades_reais IS NOT DISTINCT FROM OLD.grades_reais THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cad c
     WHERE c.id = NEW.cad_id
       AND c.direcionamento_status = 'separado'
       AND EXISTS (SELECT 1 FROM public.direcionamento d WHERE d.cad_id = NEW.cad_id)
  ) THEN
    UPDATE public.cad
       SET direcionamento_status = 'pendente', direcionamento_confirmado_at = NULL
     WHERE id = NEW.cad_id AND direcionamento_status = 'separado';
    UPDATE public.modelos
       SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"direcionamento": true}'::jsonb
     WHERE id = (SELECT modelo_id FROM public.cad WHERE id = NEW.cad_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rebaixa_direcionamento_grade ON public.cad_grades;
CREATE TRIGGER trg_rebaixa_direcionamento_grade
  AFTER INSERT OR UPDATE OF grades_reais ON public.cad_grades
  FOR EACH ROW EXECUTE FUNCTION public.fn_rebaixa_direcionamento_grade();
