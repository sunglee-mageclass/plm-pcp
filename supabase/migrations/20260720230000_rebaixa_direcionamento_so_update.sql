-- Fix 2: o trigger trg_rebaixa_direcionamento_grade dispara em INSERT E UPDATE, mas a guarda
-- de "grade não mudou" só cobre UPDATE. Como _salvar_cad_completo_core faz DELETE+INSERT de
-- cad_grades, qualquer SAVE no Desenvolvimento (mesmo sem mudar a grade) re-INSERE a grade e o
-- trigger REBAIXAVA o Direcionamento confirmado espuriamente. Numa RE-inserção a grade real é
-- a mesma (preservada quando CQ confirmado; invariante #6), então o INSERT nunca representa uma
-- mudança real de grade → ignora o INSERT. Mudança real de grade real vem sempre por UPDATE
-- (CQ confirmar/desmarcar/reconfirmar).
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_rebaixa_direcionamento_grade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_real jsonb;
  v_ec_old jsonb;
  v_ec jsonb := '{}'::jsonb;
  v_lf jsonb := '{}'::jsonb;
  v_ec_t int := 0; v_lf_t int := 0; v_r_t int := 0;
  t text; v_rt int; v_et int; v_ecv int;
BEGIN
  -- Só age em mudança REAL da grade real (UPDATE). Re-inserção (DELETE+INSERT do
  -- salvar_cad_completo) não é mudança de grade → não rebaixa nem re-deriva.
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.grades_reais IS NOT DISTINCT FROM OLD.grades_reais THEN
    RETURN NEW;
  END IF;

  -- Rebaixa o status quando estava 'separado' (grade real mudou → split defasado).
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

  -- Re-deriva o SNAPSHOT armazenado desta variante a partir da grade real nova (clampa ec ≤ real).
  IF EXISTS (SELECT 1 FROM public.direcionamento d
              WHERE d.cad_id = NEW.cad_id AND d.variante_numero = NEW.variante_numero) THEN
    v_real := COALESCE(NEW.grades_reais, '{}'::jsonb);
    SELECT COALESCE(ecommerce, '{}'::jsonb) INTO v_ec_old
      FROM public.direcionamento
     WHERE cad_id = NEW.cad_id AND variante_numero = NEW.variante_numero;
    v_ec_old := COALESCE(v_ec_old, '{}'::jsonb);

    FOR t IN SELECT jsonb_object_keys(v_real) LOOP
      v_rt := COALESCE((v_real->>t)::int, 0);
      v_et := COALESCE((v_ec_old->>t)::int, 0);
      IF v_et < 0 THEN v_et := 0; END IF;
      v_ecv := LEAST(v_et, v_rt);
      v_ec := v_ec || jsonb_build_object(t, v_ecv);
      v_lf := v_lf || jsonb_build_object(t, v_rt - v_ecv);
      v_ec_t := v_ec_t + v_ecv;
      v_lf_t := v_lf_t + (v_rt - v_ecv);
      v_r_t := v_r_t + v_rt;
    END LOOP;

    UPDATE public.direcionamento
       SET real = v_real, grade_real_total = v_r_t,
           ecommerce = v_ec, ecommerce_total = v_ec_t,
           loja_fisica = v_lf, loja_fisica_total = v_lf_t
     WHERE cad_id = NEW.cad_id AND variante_numero = NEW.variante_numero;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
