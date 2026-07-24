-- Permissão por SEÇÃO (camada abaixo de "página"): custo/preço e aprovar mão de obra.
-- O grão é o mesmo `user_permissions(user_id, pagina)` — `pagina` é string livre; usamos
-- chaves de seção (ex.: 'criacao_desenvolvimento:custos'). Enforcement REAL (não só esconder):
--   • Custo/preço: a RPC compartilhada `custo_unitario_modelos` só devolve custos a quem pode
--     vê-los (senão retorna '{}' → todos os 6 consumidores mostram "—").
--   • Aprovar mão de obra: trigger bloqueia mudar `modelos.custo_terceirizados_aprovado` sem a
--     permissão (independe do caminho — o front faz update direto).
-- Rollout NÃO quebra: backfill concede as novas permissões a quem HOJE vê a página-mãe / aprova.

BEGIN;

-- Espelho de user_can_view p/ pode_editar (admins furam).
CREATE OR REPLACE FUNCTION public.user_can_edit(_pagina text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    public.is_super_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tenant_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = auth.uid() AND pagina = _pagina AND pode_editar = true
    );
$$;

-- Pode ver custos/preços? (qualquer permissão de custo já concede — admins furam via user_can_view)
CREATE OR REPLACE FUNCTION public._pode_ver_custos()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.user_can_view('criacao_planejamento:custos')
      OR public.user_can_view('criacao_desenvolvimento:custos')
      OR public.user_can_view('producao_terceirizados:precos')
      OR public.user_can_view('dashboard_custos')
      OR public.user_can_view('dashboard_comercial');
$$;
REVOKE EXECUTE ON FUNCTION public._pode_ver_custos() FROM PUBLIC, anon, authenticated;

-- Gate da RPC de custo: renomeia o corpo p/ _core (revoga) + wrapper que só devolve a quem pode ver.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_custo_unitario_modelos_core') THEN
    ALTER FUNCTION public.custo_unitario_modelos(uuid[]) RENAME TO _custo_unitario_modelos_core;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public._custo_unitario_modelos_core(uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.custo_unitario_modelos(_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public._pode_ver_custos() THEN RETURN '{}'::jsonb; END IF;
  RETURN public._custo_unitario_modelos_core(_ids);
END $$;

-- Aprovar mão de obra: bloqueia mudar o flag sem permissão de edição na chave dedicada.
CREATE OR REPLACE FUNCTION public.enforce_maodeobra_aprovacao()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.custo_terceirizados_aprovado IS DISTINCT FROM OLD.custo_terceirizados_aprovado THEN
    IF NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enforce_maodeobra_aprovacao ON public.modelos;
CREATE TRIGGER trg_enforce_maodeobra_aprovacao BEFORE UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_maodeobra_aprovacao();

-- Backfill (rollout não-quebra): concede as novas permissões a quem HOJE já tem a página-mãe,
-- para preservar o comportamento atual. O admin depois REVOGA de quem não deve ver/aprovar.
--  • ver custos por tela: herda o pode_ver da página-mãe.
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, m.secao, true, up.pode_editar
FROM public.user_permissions up
JOIN LATERAL (VALUES
  ('criacao_planejamento','criacao_planejamento:custos'),
  ('criacao_desenvolvimento','criacao_desenvolvimento:custos'),
  ('producao_terceirizados','producao_terceirizados:precos')
) AS m(pagina_mae, secao) ON m.pagina_mae = up.pagina
WHERE up.pode_ver = true
ON CONFLICT (user_id, pagina) DO NOTHING;
--  • aprovar mão de obra: quem HOJE pode EDITAR o Planejamento (aprovava direto) mantém.
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, 'producao_servico_aprovacao', true, true
FROM public.user_permissions up
WHERE up.pagina = 'criacao_planejamento' AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

COMMIT;

select pg_notify('pgrst','reload schema');
