-- Diagnóstico Admin › Gerenciar Lojas — correções backend (pacote completo):
-- 1) _seed_tenant_defaults(_tid): semeia config + Corte/Oficina + 12 meses + ano corrente/próximo.
--    Compartilhado pela criação da loja E pelo reset (não divergem). Corrige o CRÍTICO
--    (reset apagava os 12 meses fixos e a loja não reoperava) + MÉDIO (anos nunca semeado).
-- 2) _wipe_tenant_core: apaga cq_pos_variantes (filha SEM tenant_id, órfã no wipe em replica).
-- 3) salvar_loja: UPDATE tenants + UPSERT tenant_config numa txn (edição atômica; super_admin).

BEGIN;

-- 1) Seed compartilhado -------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (_tid, 'Corte', 0), (_tid, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 12 meses FIXOS (ordem 1..12) — a UI não deixa criar (atributo `fixed`), então precisam
  -- existir sempre; senão o dropdown de Mês (Planejamento/CAD/CQ/OTB/Lançamentos) fica vazio.
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (_tid, '01| Janeiro', 1), (_tid, '02| Fevereiro', 2), (_tid, '03| Março', 3),
    (_tid, '04| Abril', 4), (_tid, '05| Maio', 5), (_tid, '06| Junho', 6),
    (_tid, '07| Julho', 7), (_tid, '08| Agosto', 8), (_tid, '09| Setembro', 9),
    (_tid, '10| Outubro', 10), (_tid, '11| Novembro', 11), (_tid, '12| Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;

  -- Ano corrente + próximo, p/ a loja já posicionar modelos no calendário ao abrir/resetar.
  INSERT INTO public.anos (tenant_id, ano) VALUES
    (_tid, EXTRACT(YEAR FROM CURRENT_DATE)::int::text),
    (_tid, (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text)
  ON CONFLICT (tenant_id, ano) DO NOTHING;
END;
$function$;

-- Trigger de criação de loja passa a usar o seed compartilhado.
CREATE OR REPLACE FUNCTION public.criar_tenant_config_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._seed_tenant_defaults(NEW.id);
  RETURN NEW;
END;
$function$;

-- 2) Wipe: apaga cq_pos_variantes (não tem tenant_id; CASCADE não dispara em replica) ------
CREATE OR REPLACE FUNCTION public._wipe_tenant_core(_tid uuid, _full boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  SET LOCAL session_replication_role = replica;

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
  -- CQ Pós (Fase 3): filha sem tenant_id, referencia controle_qualidade (NOT NULL) — apagar
  -- ANTES dos pais, senão fica órfã (replica não cascateia).
  DELETE FROM public.cq_pos_variantes WHERE controle_qualidade_id IN (SELECT id FROM public.controle_qualidade WHERE tenant_id = _tid);
  DELETE FROM public.cq_variantes WHERE controle_qualidade_id IN (SELECT id FROM public.controle_qualidade WHERE tenant_id = _tid);
  DELETE FROM public.ocs_tecido_itens    WHERE oc_tecido_id IN (SELECT id FROM public.ocs_tecido WHERE tenant_id = _tid);
  DELETE FROM public.ocs_aviamento_itens WHERE oc_aviamento_id IN (SELECT id FROM public.ocs_aviamento WHERE tenant_id = _tid);

  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'tenant_id' AND table_schema = 'public'
      AND table_name NOT IN ('tenant_config', 'users', 'user_permissions')
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', r.table_name) USING _tid;
  END LOOP;

  IF _full THEN
    UPDATE public.users SET tenant_id = NULL
      WHERE tenant_id = _tid AND id IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin');
    DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM public.users WHERE tenant_id = _tid);
    DELETE FROM public.user_permissions WHERE tenant_id = _tid;
    DELETE FROM public.tenant_config WHERE tenant_id = _tid;
    DELETE FROM public.users WHERE tenant_id = _tid;
  END IF;
END;
$function$;

-- reset_loja: re-semeia o padrão completo (meses/anos/config/categorias) após o wipe.
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
  PERFORM public._seed_tenant_defaults(_tenant_id);
END;
$function$;

-- 3) salvar_loja: edição atômica (tenants + tenant_config) --------------------
-- _modules NULL = não toca em tenant_config.modules (front só envia quando já carregou a config).
CREATE OR REPLACE FUNCTION public.salvar_loja(
  _id uuid, _nome text, _cnpj text, _contato text, _logo_url text, _modules jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas super_admin pode editar uma loja' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenants
     SET nome = _nome,
         cnpj = _cnpj,
         contato = _contato,
         logo_url = COALESCE(_logo_url, logo_url)  -- NULL = mantém a logo atual
   WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada'; END IF;

  IF _modules IS NOT NULL THEN
    INSERT INTO public.tenant_config (tenant_id, modules)
    VALUES (_id, _modules || '{"cadastro": true}'::jsonb)  -- cadastro sempre on
    ON CONFLICT (tenant_id) DO UPDATE SET modules = EXCLUDED.modules;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._seed_tenant_defaults(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_loja(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_loja(uuid, text, text, text, text, jsonb) TO authenticated;

COMMIT;
