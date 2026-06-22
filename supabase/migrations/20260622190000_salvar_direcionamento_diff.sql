-- Item 16c (Fase 2): save de Direcionamento era delete-all + insert-all no front.
-- RPC transacional com diff pela chave natural (cad_id, variante_numero): UPDATE
-- a variante existente / INSERT a nova / DELETE as que sumiram. Atômico; preserva
-- a linha (e o id) das variantes mantidas. Guard de módulo (producao).

CREATE OR REPLACE FUNCTION public.salvar_direcionamento(_cad_id uuid, _rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  r jsonb;
  v_nums int[] := '{}';
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
      UPDATE public.direcionamento SET
        ecommerce = COALESCE(r->'ecommerce', '{}'::jsonb),
        ecommerce_total = COALESCE((r->>'ecommerce_total')::int, 0),
        loja_fisica = COALESCE(r->'loja_fisica', '{}'::jsonb),
        loja_fisica_total = COALESCE((r->>'loja_fisica_total')::int, 0),
        real = COALESCE(r->'real', '{}'::jsonb),
        grade_real_total = COALESCE((r->>'grade_real_total')::int, 0)
      WHERE cad_id = _cad_id AND variante_numero = (r->>'variante_numero')::int;
      IF NOT FOUND THEN
        INSERT INTO public.direcionamento (
          cad_id, variante_numero, ecommerce, ecommerce_total, loja_fisica, loja_fisica_total, real, grade_real_total
        ) VALUES (
          _cad_id, (r->>'variante_numero')::int,
          COALESCE(r->'ecommerce', '{}'::jsonb), COALESCE((r->>'ecommerce_total')::int, 0),
          COALESCE(r->'loja_fisica', '{}'::jsonb), COALESCE((r->>'loja_fisica_total')::int, 0),
          COALESCE(r->'real', '{}'::jsonb), COALESCE((r->>'grade_real_total')::int, 0)
        );
      END IF;
      v_nums := array_append(v_nums, (r->>'variante_numero')::int);
    END LOOP;
  END IF;

  DELETE FROM public.direcionamento
   WHERE cad_id = _cad_id AND NOT (variante_numero = ANY(v_nums));
END;
$function$;
