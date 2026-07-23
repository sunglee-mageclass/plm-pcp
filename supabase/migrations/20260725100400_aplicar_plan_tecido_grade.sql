-- 20260725100400_aplicar_plan_tecido_grade.sql — Plan. Tecido: "aplicar grade ao modelo" (#10)
-- Empurra a GRADE por variante (do slot do plano) para modelo_grades do card real.
-- Guardas: exige modelo ligado; BLOQUEIA se o modelo já foi ao CAD (grade se ajusta no CAD);
-- acende #Erro só se a grade mudou de fato. NÃO toca consumo/custo (CAD é dono do consumo).
begin;

create or replace function public._aplicar_plan_tecido_grade_core(_slot_id uuid, _variantes jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_modelo uuid;
  v_slot_tenant uuid;
  v_enviado boolean;
  v_var jsonb;
  v_ordem int;
  v_gt int;
  v_grades jsonb;
  v_old_gt int;
  v_old_grades jsonb;
  v_changed boolean := false;
begin
  select modelo_id, tenant_id into v_modelo, v_slot_tenant from plan_tecido_slots where id = _slot_id;
  if v_slot_tenant is null or v_slot_tenant is distinct from public.get_user_tenant_id() then
    raise exception 'Sem permissão sobre este item.' using errcode = '42501';
  end if;
  if v_modelo is null then
    raise exception 'Este item não está ligado a um modelo (card). Crie/associe o card antes de aplicar.' using errcode = 'P0001';
  end if;

  select enviado_cad into v_enviado from modelos where id = v_modelo;
  if coalesce(v_enviado, false) then
    raise exception 'Modelo já foi enviado ao CAD — ajuste a grade no CAD.' using errcode = '42501';
  end if;

  for v_var in select * from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) loop
    v_ordem  := coalesce((v_var->>'ordem')::int, 1);
    v_gt     := coalesce((v_var->>'grade_total')::int, 0);
    v_grades := coalesce(v_var->'grades', '{}'::jsonb);

    select grade_total, grades into v_old_gt, v_old_grades
      from modelo_grades where modelo_id = v_modelo and variante_numero = v_ordem;

    if v_old_gt is distinct from v_gt or coalesce(v_old_grades, '{}'::jsonb) is distinct from v_grades then
      v_changed := true;
    end if;

    delete from modelo_grades where modelo_id = v_modelo and variante_numero = v_ordem;
    insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
      values (v_modelo, v_ordem, v_grades, v_gt);
  end loop;

  -- purge variantes no longer present in the plan
  delete from modelo_grades
  where modelo_id = v_modelo
    and variante_numero not in (
      select (e->>'ordem')::int from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) e
    );

  if v_changed then
    perform public.marcar_revisao_por_mudanca(v_modelo, true, false, false);
  end if;

  return jsonb_build_object('modelo_id', v_modelo, 'changed', v_changed);
end $$;

create or replace function public.aplicar_plan_tecido_grade(_slot_id uuid, _variantes jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._aplicar_plan_tecido_grade_core(_slot_id, _variantes);
end $$;

revoke execute on function public._aplicar_plan_tecido_grade_core(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_plan_tecido_grade(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
