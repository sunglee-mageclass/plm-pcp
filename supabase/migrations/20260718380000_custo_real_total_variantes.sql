-- Fase 2 (EXPERIMENTAL, acompanhamento): custo real TOTAL por modelo com base no preço de cada
-- VARIANTE de tecido — Σ(consumo real da variante × preço/metro da variante). Separado do custo
-- oficial (custo_unitario_modelos/dashboard_custos NÃO mudam). Só considera variantes COM preço.
-- consumo da variante = cad_tecido_variantes.metragem_enviada (ou planejada) — já em metros, c/ loss.
-- preço/metro = variantes_tecido.preco convertido (kg→ ÷ rendimento; metro→ direto).
CREATE OR REPLACE FUNCTION public.custo_real_total_variantes(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  with cad_latest as (
    select distinct on (c.modelo_id) c.modelo_id, c.id as cad_id
    from cad c
    where c.tenant_id = v_tenant
    order by c.modelo_id, c.enviado_corte desc, c.data_enviado_corte desc nulls last, c.created_at desc
  ),
  tot as (
    select cl.modelo_id,
      sum(
        coalesce(nullif(ctv.metragem_enviada, 0), ctv.metragem_planejada, 0)
        * (case when a.unidade_medida = 'kg' and coalesce(a.rendimento, 0) > 0
                then vt.preco / a.rendimento else vt.preco end)
      ) as total
    from cad_latest cl
    join cad_tecidos ct on ct.cad_id = cl.cad_id
    join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
    join variantes_tecido vt on vt.id = ctv.variante_tecido_id
    join artigos a on a.id = vt.artigo_id
    where vt.preco is not null
    group by cl.modelo_id
  )
  select coalesce(jsonb_object_agg(m.id::text, round(coalesce(t.total, 0), 2)), '{}'::jsonb)
  into v_result
  from modelos m
  left join tot t on t.modelo_id = m.id
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.custo_real_total_variantes(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custo_real_total_variantes(uuid[]) TO authenticated;

select pg_notify('pgrst','reload schema');
