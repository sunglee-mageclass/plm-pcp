-- Aprovação por bloco de serviço (externo) — o preço/custo do serviço precisa ser
-- aprovado. Bolinha amarela enquanto nem todos os blocos externos do modelo estão
-- aprovados; verde quando todos estão. Reflete em Serviços (lista) e Planejamento.

alter table public.producao_terceirizados
  add column if not exists aprovado boolean not null default false;

-- Status de aprovação por modelo (só blocos externos): {modelo_id: {tem, todos}}.
-- tem = há bloco externo; todos = todos os externos aprovados.
create or replace function public.servico_aprovacao_por_modelo(_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  select coalesce(jsonb_object_agg(modelo_id::text,
           jsonb_build_object('tem', total > 0, 'todos', total > 0 and aprovados = total)), '{}'::jsonb)
  into v_result
  from (
    select c.modelo_id,
           count(*) filter (where coalesce(pt.interno,false) = false) as total,
           count(*) filter (where coalesce(pt.interno,false) = false and pt.aprovado) as aprovados
    from producao_terceirizados pt
    join cad c on c.id = pt.cad_id and c.tenant_id = v_tenant
    where c.modelo_id = any(_ids)
    group by c.modelo_id
  ) s
  where total > 0;
  return v_result;
end $function$;
