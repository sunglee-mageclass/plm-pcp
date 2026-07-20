-- Bug 1+4 (raiz arquitetural): a Explosão chamava salvar_cad_completo (RPC "substitui TUDO")
-- passando grade/aviamentos/etiquetas VAZIOS → apagava todos ao salvar metragem. A Explosão só
-- edita metragem por variante; ela ganha uma RPC ESTREITA que atualiza APENAS
-- cad_tecido_variantes.metragem_enviada (+ quantidade_folhas), sem tocar em grade/aviamento/etiqueta.
BEGIN;

CREATE OR REPLACE FUNCTION public.salvar_explosao_metragem(_cad_id uuid, _variantes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  it jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      -- Só atualiza variantes que pertencem a ESTE cad (via cad_tecidos) — trava cross-cad/tenant.
      UPDATE public.cad_tecido_variantes ctv
         SET metragem_enviada  = COALESCE((it->>'metragem_enviada')::numeric, ctv.metragem_enviada),
             quantidade_folhas = COALESCE((it->>'quantidade_folhas')::numeric, ctv.quantidade_folhas)
       WHERE ctv.id = (it->>'id')::uuid
         AND ctv.cad_tecido_id IN (SELECT ct.id FROM public.cad_tecidos ct WHERE ct.cad_id = _cad_id);
    END LOOP;
  END IF;

  RETURN _cad_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.salvar_explosao_metragem(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_explosao_metragem(uuid, jsonb) TO authenticated;

COMMIT;
