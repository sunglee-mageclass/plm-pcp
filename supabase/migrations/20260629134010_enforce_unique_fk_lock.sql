-- R3: fecha o write-skew do enforce_unique_fk (EXISTS sem lock). 2 inserts simultaneos
-- do mesmo modelo_id/cad_id podiam ambos passar a checagem 1:1. Advisory xact lock por valor.

CREATE OR REPLACE FUNCTION public.enforce_unique_fk()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_col text := TG_ARGV[0];
  v_val uuid;
  v_exists boolean;
BEGIN
  v_val := (to_jsonb(NEW) ->> v_col)::uuid;
  IF v_val IS NULL THEN
    RETURN NEW;
  END IF;

  -- R3 fix: serializa inserts/updates concorrentes do MESMO (tabela, coluna, valor)
  -- para fechar o write-skew — o EXISTS sem lock deixava 2 inserts do mesmo valor passarem,
  -- furando a invariante 1:1. Lock fino por valor (sem contention p/ valores diferentes);
  -- deadlock-free (operacao single-row). Mesmo padrao de recalcular_parcelas/corte.
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || v_col || ':' || v_val::text));
  EXECUTE format(
    'SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I = $1 AND id IS DISTINCT FROM $2)',
    TG_TABLE_NAME, v_col
  ) INTO v_exists USING v_val, NEW.id;
  IF v_exists THEN
    RAISE EXCEPTION 'Já existe registro em % para %=% (invariante 1:1)', TG_TABLE_NAME, v_col, v_val
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$function$;
