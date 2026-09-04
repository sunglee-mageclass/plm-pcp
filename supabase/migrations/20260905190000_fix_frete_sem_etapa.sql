-- FIX crítico (review adversarial): frete sem etapa de frete era PERDIDO no `_imp_etapas_brl_oc`
-- (custo real da OC + parcelas), divergindo do `_imp_custo_landed` (previsto do card), que inclui o
-- frete inteiro como fallback quando não há etapa de frete. Resultado: real < previsto e parcelas
-- subestimavam a dívida pelo valor do frete.
-- Fix: quando há frete (peso_kg×transporte_m2 > 0) e NENHUMA etapa de frete, o helper emite uma
-- ETAPA DE FRETE IMPLÍCITA (100%, sem conversão — frete já em M2), espelhando o fallback do
-- `_imp_custo_landed`. Assim as 3 fórmulas (previsto/real/parcelas) convergem. Idempotente.

BEGIN;

create or replace function public._imp_etapas_brl_oc(_oc_id uuid)
returns table (ordem int, rotulo text, base text, data_vencimento date, valor_brl numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  o record;
  v_desc numeric;
  v_merc_liq_m1 numeric;
  v_frete_liq_m2 numeric;
  v_tem_etapa_frete boolean;
  v_prox_ordem int;
begin
  select valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final, data_pedido
    into o from public.ocs_importado where id = _oc_id;
  if not found or coalesce(o.qtd_total,0) <= 0 then
    return;
  end if;
  v_desc := 1 - coalesce(o.desconto_pct,0) / 100.0;
  v_merc_liq_m1 := coalesce(o.valor_unitario_m1,0) * o.qtd_total * v_desc;
  v_frete_liq_m2 := coalesce(o.peso_kg,0) * coalesce(o.transporte_m2,0) * o.qtd_total * v_desc;

  -- etapas reais
  return query
  select e.ordem, e.rotulo::text, e.base::text, e.data_vencimento,
    round(
      case
        when e.base = 'mercadoria' then
          case when coalesce(e.cotacao,0) > 0
            then (v_merc_liq_m1 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else 0 end
        else -- frete: já em M2
          case when coalesce(e.cotacao,0) > 0 and e.cotacao <> 1
            then (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) end
      end * coalesce(o.cotacao_final,0)
    , 2) as valor_brl
  from public.ocs_importado_etapas e
  where e.oc_importado_id = _oc_id
  order by e.ordem;

  -- Frete IMPLÍCITO: há frete mas nenhuma etapa de frete → emite 100% do frete (sem conversão,
  -- já em M2), espelhando o fallback do _imp_custo_landed. Vence na data do pedido.
  select exists(select 1 from public.ocs_importado_etapas ie where ie.oc_importado_id = _oc_id and ie.base = 'frete')
    into v_tem_etapa_frete;
  if not v_tem_etapa_frete and v_frete_liq_m2 > 0 then
    select coalesce(max(ie.ordem),0)+1 into v_prox_ordem from public.ocs_importado_etapas ie where ie.oc_importado_id = _oc_id;
    return query select v_prox_ordem, 'Frete'::text, 'frete'::text, o.data_pedido,
      round(v_frete_liq_m2 * coalesce(o.cotacao_final,0), 2);
  end if;
end $$;
revoke execute on function public._imp_etapas_brl_oc(uuid) from public, anon, authenticated;

COMMIT;
