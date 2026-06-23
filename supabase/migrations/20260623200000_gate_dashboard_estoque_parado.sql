-- Fecha brecha: dashboard_estoque_parado() era SECURITY DEFINER concedida a
-- authenticated SEM checar permissão — qualquer usuário do tenant (sem a permissão
-- dashboard_financeiro) lia a valorização R$ do estoque parado via supabase.rpc.
-- Viola o invariante da Fase 1 (as RPCs dashboard_* gateiam com user_can_view).
--
-- Padrão regra 14 (CLAUDE.md): renomeia o corpo p/ _core, REVOKE do core (só o
-- wrapper, SECURITY DEFINER, pode chamá-lo) e cria o wrapper gateado. O card está
-- na aba Financeiro do dashboard → chave dashboard_financeiro.

ALTER FUNCTION public.dashboard_estoque_parado() RENAME TO _dashboard_estoque_parado_core;
REVOKE EXECUTE ON FUNCTION public._dashboard_estoque_parado_core() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_estoque_parado()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_financeiro') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_estoque_parado' USING ERRCODE = '42501';
  END IF;
  RETURN public._dashboard_estoque_parado_core();
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dashboard_estoque_parado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_estoque_parado() TO authenticated;
