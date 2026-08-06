-- MO por serviço — contagem p/ o KPI da Home (2026-08-06).
-- O card "Mão de obra a aprovar" contava modelos.custo_terceirizados_aprovado IS NULL — mas o flag
-- virou BOOLEAN DERIVADO por trigger (nunca mais é NULL), então o card dava sempre 0. A pendência
-- agora mora nas LINHAS (modelo_servico_mo.aprovado IS NULL). Como a tabela é RLS zero-policy
-- (escrita/leitura só por RPC DEFINER), exponho a contagem por RPC no padrão wrapper+_core.
-- Gate espelha modelo_mo_resumo: _pode_ver_custos() OR user_can_edit('producao_servico_aprovacao').
-- Idempotente (CREATE OR REPLACE). REVOKE dos TRÊS no core (invariante #9).
BEGIN;

-- Core: conta, no tenant do chamador, modelos com AO MENOS uma linha de MO pendente (aprovado IS NULL).
CREATE OR REPLACE FUNCTION public._modelos_mo_a_aprovar_count_core()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(DISTINCT s.modelo_id)::int
  FROM public.modelo_servico_mo s
  JOIN public.modelos m ON m.id = s.modelo_id
  WHERE m.tenant_id = public.get_user_tenant_id()
    AND s.aprovado IS NULL;
$function$;

-- Wrapper: 0 p/ quem não pode ver custos NEM aprovar (mesma superfície do editor/badge).
CREATE OR REPLACE FUNCTION public.modelos_mo_a_aprovar_count()
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public._pode_ver_custos() OR public.user_can_edit('producao_servico_aprovacao')) THEN
    RETURN 0;
  END IF;
  RETURN public._modelos_mo_a_aprovar_count_core();
END $function$;

-- REVOKE dos três (PUBLIC herda p/ anon/authenticated) — invariante #9.
REVOKE EXECUTE ON FUNCTION public._modelos_mo_a_aprovar_count_core() FROM PUBLIC, anon, authenticated;

COMMIT;
