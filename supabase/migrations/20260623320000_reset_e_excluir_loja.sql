-- Reset / Exclusão de loja (super_admin). Todas as FKs p/ tenants são NO ACTION, então
-- é preciso limpar as 60 tabelas de negócio antes. Usa session_replication_role=replica
-- (SET LOCAL → reseta no fim da transação) p/ desligar FK/triggers e apagar em qualquer
-- ordem; as filhas SEM tenant_id são apagadas por JOIN ao pai ANTES dos pais; as demais
-- por um loop dinâmico sobre todas as tabelas com tenant_id (cobre tabelas futuras).
--
--   reset_loja   = "como loja nova": zera negócio, MANTÉM loja/usuários/permissões/config,
--                  re-semeia Corte/Oficina.
--   excluir_loja = apaga tudo + usuários comuns + config + a própria loja. super_admins
--                  NUNCA são apagados (são globais); se algum estava vendo a loja, é solto.

CREATE OR REPLACE FUNCTION public._wipe_tenant_core(_tid uuid, _full boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  -- Desliga FK e triggers só nesta transação (reseta automaticamente no commit/rollback).
  SET LOCAL session_replication_role = replica;

  -- 1) Filhas SEM tenant_id — apagar por JOIN ao pai, ANTES dos pais (mais fundas primeiro).
  DELETE FROM public.cad_tecido_variantes WHERE cad_tecido_id IN (
    SELECT ct.id FROM public.cad_tecidos ct JOIN public.cad c ON c.id = ct.cad_id WHERE c.tenant_id = _tid);
  DELETE FROM public.modelo_tecido_variantes WHERE modelo_tecido_id IN (
    SELECT mt.id FROM public.modelo_tecidos mt JOIN public.modelos m ON m.id = mt.modelo_id WHERE m.tenant_id = _tid);
  DELETE FROM public.cad_tecidos   WHERE cad_id IN (SELECT id FROM public.cad WHERE tenant_id = _tid);
  DELETE FROM public.cad_aviamentos WHERE cad_id IN (SELECT id FROM public.cad WHERE tenant_id = _tid);
  DELETE FROM public.cad_etiquetas WHERE cad_id IN (SELECT id FROM public.cad WHERE tenant_id = _tid);
  DELETE FROM public.cad_grades    WHERE cad_id IN (SELECT id FROM public.cad WHERE tenant_id = _tid);
  DELETE FROM public.modelo_tecidos    WHERE modelo_id IN (SELECT id FROM public.modelos WHERE tenant_id = _tid);
  DELETE FROM public.modelo_aviamentos WHERE modelo_id IN (SELECT id FROM public.modelos WHERE tenant_id = _tid);
  DELETE FROM public.modelo_grades     WHERE modelo_id IN (SELECT id FROM public.modelos WHERE tenant_id = _tid);
  DELETE FROM public.cq_variantes WHERE controle_qualidade_id IN (SELECT id FROM public.controle_qualidade WHERE tenant_id = _tid);
  DELETE FROM public.ocs_tecido_itens    WHERE oc_tecido_id IN (SELECT id FROM public.ocs_tecido WHERE tenant_id = _tid);
  DELETE FROM public.ocs_aviamento_itens WHERE oc_aviamento_id IN (SELECT id FROM public.ocs_aviamento WHERE tenant_id = _tid);

  -- 2) Todas as tabelas de negócio com tenant_id (dinâmico; cobre tabelas futuras),
  --    menos as preservadas (usuários/permissões/config — tratadas no modo _full).
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'tenant_id' AND table_schema = 'public'
      AND table_name NOT IN ('tenant_config', 'users', 'user_permissions')
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', r.table_name) USING _tid;
  END LOOP;

  -- 3) Exclusão total: usuários comuns + permissões + config + (na wrapper) a loja.
  IF _full THEN
    -- super_admins são globais: não apaga; só solta o vínculo se viam esta loja.
    UPDATE public.users SET tenant_id = NULL
      WHERE tenant_id = _tid AND id IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin');
    DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM public.users WHERE tenant_id = _tid);
    DELETE FROM public.user_permissions WHERE tenant_id = _tid;
    DELETE FROM public.tenant_config WHERE tenant_id = _tid;
    DELETE FROM public.users WHERE tenant_id = _tid;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._wipe_tenant_core(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Reset: zera negócio mantendo loja/usuários/config; re-semeia as categorias fixas.
CREATE OR REPLACE FUNCTION public.reset_loja(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas super_admin pode resetar uma loja' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant_id) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  PERFORM public._wipe_tenant_core(_tenant_id, false);
  -- Volta ao estado de loja nova: categorias de serviço fixas presentes.
  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (_tenant_id, 'Corte', 0), (_tenant_id, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reset_loja(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reset_loja(uuid) TO authenticated;

-- Exclusão: apaga tudo da loja + usuários comuns + config + a própria loja.
CREATE OR REPLACE FUNCTION public.excluir_loja(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas super_admin pode excluir uma loja' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant_id) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  PERFORM public._wipe_tenant_core(_tenant_id, true);
  DELETE FROM public.tenants WHERE id = _tenant_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.excluir_loja(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.excluir_loja(uuid) TO authenticated;
