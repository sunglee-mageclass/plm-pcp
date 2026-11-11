-- F5-3 Task 1: helper _audit_evento_secao (1 linha de auditoria por secao da ficha).
-- Chamado de dentro dos _core de Salvar (SECURITY DEFINER). Auditoria nunca derruba o negocio.
BEGIN;
CREATE OR REPLACE FUNCTION public._audit_evento_secao(_modelo_id uuid, _tenant uuid, _entidade text, _tabela text, _diff jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_user uuid; v_nome text;
BEGIN
  IF _diff IS NULL OR _diff = '{}'::jsonb OR jsonb_typeof(_diff) <> 'object' THEN RETURN; END IF;
  v_user := auth.uid();
  SELECT coalesce(nome, email) INTO v_nome FROM public.users WHERE id = v_user;
  INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
  VALUES (_tenant, v_user, v_nome, 'editar', _entidade, _tabela, _modelo_id, 'Editou ' || _entidade, _diff);
EXCEPTION WHEN OTHERS THEN
  RETURN; -- auditoria nunca derruba o negocio (padrao fn_audit)
END $fn$;
REVOKE EXECUTE ON FUNCTION public._audit_evento_secao(uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
COMMIT;
