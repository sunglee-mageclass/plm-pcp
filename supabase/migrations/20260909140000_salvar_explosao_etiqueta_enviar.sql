-- RPC estreita salvar_explosao_etiqueta_enviar (set/2026): grava APENAS
-- cad_etiquetas.quantidade_enviar (a "qtd a enviar/separar" da etiqueta/insumo na Explosão).
-- Espelha salvar_explosao_aviamento_separar (mesmo gate/ACL), mas identifica a linha por `id`
-- (cad_etiquetas não tem UNIQUE por etiqueta×cor — a UI já carrega o id). O filtro por cad_id
-- trava cross-cad; o cad já é do tenant (checado). NÃO toca grade/tecido/aviamento/etiqueta a
-- mais — só o campo editável. Necessária para a seção Insumo da Explosão (troca de etiqueta da
-- revenda + insumo de qualquer modelo).

BEGIN;

CREATE OR REPLACE FUNCTION public.salvar_explosao_etiqueta_enviar(_cad_id uuid, _linhas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  it jsonb;
  v_id uuid;
  v_val numeric;
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

  IF jsonb_typeof(_linhas) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(_linhas) LOOP
      v_id  := NULLIF(it->>'id','')::uuid;
      v_val := GREATEST(COALESCE((it->>'quantidade_enviar')::numeric, 0), 0);
      IF v_id IS NULL THEN CONTINUE; END IF;

      -- Só grava a linha DESTE cad (trava cross-cad/tenant; o cad já é do tenant).
      UPDATE public.cad_etiquetas
         SET quantidade_enviar = v_val
       WHERE id = v_id
         AND cad_id = _cad_id;
    END LOOP;
  END IF;

  RETURN _cad_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.salvar_explosao_etiqueta_enviar(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_explosao_etiqueta_enviar(uuid, jsonb) TO authenticated;

COMMIT;

select pg_notify('pgrst','reload schema');
