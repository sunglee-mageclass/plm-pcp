-- Plan. Tecido: "Aplicar ao modelo" passa a gravar TAMBÉM a PROPORÇÃO do plano no modelo.
-- Antes, _plan_tecido_gravar_bom_core gravava tecidos/variantes/grade (modelo_grades), mas NÃO
-- atualizava modelos.proporcoes → a grade mudava mas a "proporção" do modelo ficava a antiga.
-- Agora, após gravar o BOM, copia a proporção do slot do plano p/ modelos.proporcoes (quando o slot
-- tem proporção definida).

BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_aplicar_ao_modelo_core(_slot_id uuid, _materiais jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_modelo uuid; v_tenant uuid; v_lancado boolean;
begin
  select modelo_id, tenant_id into v_modelo, v_tenant from plan_tecido_slots where id = _slot_id;
  if v_tenant is null or v_tenant is distinct from public.get_user_tenant_id() then
    raise exception 'Sem permissão sobre este item.' using errcode = '42501';
  end if;
  if v_modelo is null then
    raise exception 'Este item não está ligado a um modelo. Crie o card antes de aplicar.' using errcode = 'P0001';
  end if;
  select lancado into v_lancado from modelos where id = v_modelo;
  if coalesce(v_lancado, false) then
    raise exception 'Modelo já lançado — não é possível alterar o BOM.' using errcode = '42501';
  end if;
  perform public._plan_tecido_gravar_bom_core(v_modelo, _materiais);
  -- aplica também a PROPORÇÃO do plano (senão só a grade mudava, não a proporção do modelo)
  update modelos m set proporcoes = sl.proporcoes
    from plan_tecido_slots sl
    where sl.id = _slot_id and m.id = v_modelo
      and sl.proporcoes is not null and jsonb_typeof(sl.proporcoes) = 'object' and sl.proporcoes <> '{}'::jsonb;
  return v_modelo;
end $function$;

COMMIT;
