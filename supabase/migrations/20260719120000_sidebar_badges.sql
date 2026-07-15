-- Badges (bolinhas com quantidade) da sidebar. UMA RPC leve, tenant-scoped, que
-- devolve os 4 contadores de atenção usados ao lado dos itens do menu:
--   prontos_lancar        — modelos prontos p/ Lançar (Planejamento)
--   alertas_tecido        — alertas de CQ de tecido pendentes (Alertas de Tecido)
--   oc_tecido_atrasada    — OC de tecido encomendada e vencida (OC Tecido)
--   oc_aviamento_atrasada — OC de aviamento encomendada e vencida (OC Aviamento)
--
-- "Pronto p/ lançar" espelha EXATAMENTE o gate do botão Lançar: CQ liberado
-- (_cq_liberado: Pré + Pós se há serviço pós-costura) E valor dos serviços
-- externos todos aprovados, e o modelo ainda não lançado.
-- "Atrasada" usa a data de HOJE no fuso da loja (tenant_config.timezone), igual
-- aos badges de prazo das telas de OC.

CREATE OR REPLACE FUNCTION public.sidebar_badges()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_tz     text;
  v_hoje   date;
  v_prontos int;
  v_alertas int;
  v_oc_tec  int;
  v_oc_avi  int;
BEGIN
  -- Sem tenant (anon / loja inativa sentinela) → nada a mostrar.
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RETURN jsonb_build_object('prontos_lancar', 0, 'alertas_tecido', 0,
                              'oc_tecido_atrasada', 0, 'oc_aviamento_atrasada', 0);
  END IF;

  SELECT NULLIF(btrim(timezone), '') INTO v_tz FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');
  v_hoje := (now() AT TIME ZONE v_tz)::date;

  -- Prontos para lançar (mesmo gate do botão Lançar em Planejamento).
  SELECT count(*) INTO v_prontos
  FROM public.modelos m
  WHERE m.tenant_id = v_tenant
    AND COALESCE(m.lancado, false) = false
    AND EXISTS (
      SELECT 1 FROM public.cad c
      WHERE c.modelo_id = m.id AND c.tenant_id = v_tenant
        AND public._cq_liberado(c.id)
        AND NOT EXISTS (  -- todo serviço externo do CAD tem o valor aprovado
          SELECT 1 FROM public.producao_terceirizados pt
          WHERE pt.cad_id = c.id
            AND COALESCE(pt.interno, false) = false
            AND COALESCE(pt.aprovado, false) = false
        )
    );

  -- Alertas de CQ de tecido pendentes (alertado / troca_pendente).
  SELECT count(*) INTO v_alertas
  FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = v_tenant
  WHERE it.cq_alerta_status IN ('alertado', 'troca_pendente');

  -- OC de tecido atrasada (encomendada, não-rolo, prevista < hoje).
  SELECT count(*) INTO v_oc_tec
  FROM public.ocs_tecido oc
  WHERE oc.tenant_id = v_tenant
    AND oc.status = 'encomendado'
    AND COALESCE(oc.is_rolo, false) = false
    AND oc.data_prevista_entrega IS NOT NULL
    AND oc.data_prevista_entrega < v_hoje;

  -- OC de aviamento atrasada (encomendada, prevista < hoje).
  SELECT count(*) INTO v_oc_avi
  FROM public.ocs_aviamento oc
  WHERE oc.tenant_id = v_tenant
    AND oc.status = 'encomendado'
    AND oc.data_prevista_entrega IS NOT NULL
    AND oc.data_prevista_entrega < v_hoje;

  RETURN jsonb_build_object(
    'prontos_lancar', COALESCE(v_prontos, 0),
    'alertas_tecido', COALESCE(v_alertas, 0),
    'oc_tecido_atrasada', COALESCE(v_oc_tec, 0),
    'oc_aviamento_atrasada', COALESCE(v_oc_avi, 0)
  );
END $function$;

-- Só usuário autenticado chama (respeita o JWT via get_user_tenant_id()).
REVOKE EXECUTE ON FUNCTION public.sidebar_badges() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sidebar_badges() FROM anon;
GRANT  EXECUTE ON FUNCTION public.sidebar_badges() TO authenticated;

select pg_notify('pgrst','reload schema');
