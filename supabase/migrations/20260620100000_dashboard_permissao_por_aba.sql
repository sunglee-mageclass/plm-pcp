-- P0-5: Dashboard vazava Financeiro/Custos. O gate de permissão era na rota
-- inteira (anyOf das 5), e as RPCs dashboard_* (SECURITY DEFINER) podiam ser
-- chamadas direto por qualquer usuário do tenant sem a permissão da aba.
--
-- Parte A (front): renderizar só as abas com canView (dashboard.tsx).
-- Parte B (banco, aqui): helper user_can_view (replica o canView do front) +
-- embrulhar cada dashboard_* num wrapper que checa a permissão antes de chamar o
-- núcleo. Sem reescrever os corpos grandes: ALTER ... RENAME TO _core + wrapper.

-- Helper: replica exatamente o canView do useAuth (admin/tenant_admin/super_admin
-- bypassam; senão exige user_permissions.pode_ver da página).
CREATE OR REPLACE FUNCTION public.user_can_view(_pagina text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tenant_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = auth.uid() AND pagina = _pagina AND pode_ver = true
    );
$function$;

-- Renomeia cada dashboard_* para _core (idempotente: só se o core ainda não existe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_dashboard_colecao_core') THEN
    ALTER FUNCTION public.dashboard_colecao(date,date,text,uuid,uuid) RENAME TO _dashboard_colecao_core;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_dashboard_estoque_core') THEN
    ALTER FUNCTION public.dashboard_estoque() RENAME TO _dashboard_estoque_core;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_dashboard_producao_core') THEN
    ALTER FUNCTION public.dashboard_producao(date,date,text,uuid) RENAME TO _dashboard_producao_core;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_dashboard_financeiro_core') THEN
    ALTER FUNCTION public.dashboard_financeiro(date,date) RENAME TO _dashboard_financeiro_core;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='_dashboard_custos_core') THEN
    ALTER FUNCTION public.dashboard_custos(date,date,text,uuid,uuid) RENAME TO _dashboard_custos_core;
  END IF;
END $$;

-- Wrappers (mesma assinatura): checam a permissão e chamam o core.
CREATE OR REPLACE FUNCTION public.dashboard_colecao(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL, p_colecao text DEFAULT NULL, p_estilista uuid DEFAULT NULL, p_linha uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_colecao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_colecao' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_colecao_core(p_inicio, p_fim, p_colecao, p_estilista, p_linha);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_estoque()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_estoque') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_estoque' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_estoque_core();
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_producao(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL, p_colecao text DEFAULT NULL, p_linha uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_producao' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_producao_core(p_inicio, p_fim, p_colecao, p_linha);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_financeiro(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_financeiro') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_financeiro' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_financeiro_core(p_inicio, p_fim);
END $function$;

CREATE OR REPLACE FUNCTION public.dashboard_custos(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL, p_colecao text DEFAULT NULL, p_categoria uuid DEFAULT NULL, p_linha uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_custos') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_custos' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_custos_core(p_inicio, p_fim, p_colecao, p_categoria, p_linha);
END $function$;

-- Os cores não devem ser chamáveis direto pelo cliente (burlariam o wrapper).
REVOKE EXECUTE ON FUNCTION public._dashboard_colecao_core(date,date,text,uuid,uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_estoque_core() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_producao_core(date,date,text,uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_financeiro_core(date,date) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_custos_core(date,date,text,uuid,uuid) FROM public, anon, authenticated;
