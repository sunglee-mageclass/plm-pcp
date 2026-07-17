-- 20260723100000_otb_simulador_cores.sql — cores reais (variantes por subcoleção).
begin;

alter table public.otb_simulacao_unidades
  add column if not exists oc_tecido_id uuid references public.ocs_tecido(id) on delete set null;
alter table public.otb_simulacao_unidades
  drop column if exists oc_tecido_item_id;

create table if not exists public.otb_simulacao_variantes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid,
  unidade_id        uuid not null references public.otb_simulacao_unidades(id) on delete cascade,
  oc_tecido_item_id uuid references public.ocs_tecido_itens(id) on delete set null,
  ordem             integer not null default 0
);
create index if not exists idx_otb_sim_var_un on public.otb_simulacao_variantes(unidade_id);

alter table public.otb_simulacao_variantes enable row level security;
drop policy if exists tenant_select on public.otb_simulacao_variantes;
drop policy if exists tenant_insert on public.otb_simulacao_variantes;
drop policy if exists tenant_update on public.otb_simulacao_variantes;
drop policy if exists tenant_delete on public.otb_simulacao_variantes;
create policy tenant_select on public.otb_simulacao_variantes for select to authenticated using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.otb_simulacao_variantes for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null);
create policy tenant_update on public.otb_simulacao_variantes for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.otb_simulacao_variantes for delete to authenticated using (tenant_id = get_user_tenant_id());
create or replace trigger set_tenant_id_trg before insert on public.otb_simulacao_variantes for each row execute function set_tenant_id();

create or replace function public.salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb)
returns uuid language plpgsql set search_path to 'public' as $function$
declare
  v_id uuid := _id; v_colecao uuid; v_un jsonb; v_ln jsonb; v_md jsonb; v_var jsonb;
  v_un_id uuid; v_ln_id uuid; v_li int; v_mi int; v_vi int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  v_colecao := nullif(_header->>'colecao_id','')::uuid;
  if v_colecao is null then raise exception 'Informe a coleção.'; end if;
  if coalesce(btrim(_header->>'nome'),'') = '' then raise exception 'Informe o nome do cenário.'; end if;
  if not exists (select 1 from public.colecoes where id = v_colecao and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Coleção não encontrada.';
  end if;

  if v_id is null then
    insert into public.otb_simulacoes (colecao_id, nome) values (v_colecao, btrim(_header->>'nome')) returning id into v_id;
  else
    update public.otb_simulacoes set nome = btrim(_header->>'nome')
      where id = v_id and colecao_id = v_colecao and tenant_id = public.get_user_tenant_id();
    if not found then raise exception 'Cenário não encontrado.'; end if;
    delete from public.otb_simulacao_unidades where simulacao_id = v_id; -- cascata: variantes/linhas/modelos
  end if;

  for v_un in select value from jsonb_array_elements(coalesce(_arvore,'[]'::jsonb)) loop
    insert into public.otb_simulacao_unidades (simulacao_id, subcolecao_id, oc_tecido_id)
    values (v_id, nullif(v_un->>'subcolecao_id','')::uuid, nullif(v_un->>'oc_tecido_id','')::uuid)
    returning id into v_un_id;

    v_vi := 0;
    for v_var in select value from jsonb_array_elements(coalesce(v_un->'variantes','[]'::jsonb)) loop
      insert into public.otb_simulacao_variantes (unidade_id, oc_tecido_item_id, ordem)
      values (v_un_id, nullif(v_var->>'oc_tecido_item_id','')::uuid, v_vi);
      v_vi := v_vi + 1;
    end loop;

    v_li := 0;
    for v_ln in select value from jsonb_array_elements(coalesce(v_un->'linhas','[]'::jsonb)) loop
      insert into public.otb_simulacao_linhas (unidade_id, linha_id, prof_cor, cores, num_modelos, ordem)
      values (v_un_id, nullif(v_ln->>'linha_id','')::uuid,
              greatest(0, coalesce((v_ln->>'prof_cor')::int, 0)),
              greatest(0, coalesce((v_ln->>'cores')::int, 0)),
              greatest(0, coalesce((v_ln->>'num_modelos')::int, 0)), v_li)
      returning id into v_ln_id;
      v_li := v_li + 1;
      v_mi := 0;
      for v_md in select value from jsonb_array_elements(coalesce(v_ln->'modelos','[]'::jsonb)) loop
        insert into public.otb_simulacao_modelos (linha_ref_id, modelo_id, slot_index, consumo)
        values (v_ln_id, nullif(v_md->>'modelo_id','')::uuid,
                coalesce((v_md->>'slot_index')::int, v_mi),
                greatest(0, coalesce((v_md->>'consumo')::numeric, 0)));
        v_mi := v_mi + 1;
      end loop;
    end loop;
  end loop;
  return v_id;
end $function$;

revoke execute on function public.salvar_simulacao(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.salvar_simulacao(uuid, jsonb, jsonb) to authenticated;

create or replace function public.aplicar_simulacao(_simulacao_id uuid, _unidade_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_colecao uuid; v_tipo text; v_sub uuid; v_semanas int[];
  v_ln record; v_q jsonb; v_n int; v_rem int; j int;
  v_ncores int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;

  select s.colecao_id into v_colecao from public.otb_simulacoes s where s.id = _simulacao_id and s.tenant_id = v_tenant;
  if v_colecao is null then raise exception 'Cenário não encontrado.'; end if;
  select tipo into v_tipo from public.colecoes where id = v_colecao and tenant_id = v_tenant;

  select subcolecao_id into v_sub from public.otb_simulacao_unidades
    where id = _unidade_id and simulacao_id = _simulacao_id and tenant_id = v_tenant;
  if not found then raise exception 'Unidade não encontrada.'; end if;

  if v_tipo = 'poder_venda' then
    select count(*) into v_ncores from public.otb_simulacao_variantes where unidade_id = _unidade_id;
    select coalesce(semanas, '{}') into v_semanas from public.colecao_subcolecoes where id = v_sub and colecao_id = v_colecao;
    for v_ln in select linha_id, prof_cor, cores, num_modelos from public.otb_simulacao_linhas where unidade_id = _unidade_id and linha_id is not null loop
      v_q := '{}'::jsonb;
      v_n := coalesce(array_length(v_semanas, 1), 0);
      if v_n > 0 then
        v_rem := v_ln.num_modelos - (v_ln.num_modelos / v_n) * v_n;   -- splitEven: resto nas primeiras
        for j in 1..v_n loop
          v_q := v_q || jsonb_build_object(v_semanas[j]::text, (v_ln.num_modelos / v_n) + (case when (j-1) < v_rem then 1 else 0 end));
        end loop;
      end if;
      update public.colecao_pv_itens
        set prof_cor = greatest(0, v_ln.prof_cor),
            cores    = v_ncores,
            qtd_semanas = case when v_n > 0 then v_q else qtd_semanas end
      where colecao_id = v_colecao and subcolecao_id = v_sub and linha_id = v_ln.linha_id and tenant_id = v_tenant;
    end loop;
  else
    -- Orçamento: distribui Σ num_modelos da unidade nas semanas de colecao_semanas dessa unidade.
    declare
      v_total int; v_nweeks int; v_rem int; v_new int; r record;
    begin
      select coalesce(sum(num_modelos), 0) into v_total from public.otb_simulacao_linhas where unidade_id = _unidade_id;
      select count(*) into v_nweeks from public.colecao_semanas
        where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and tenant_id = v_tenant;
      if v_nweeks = 0 then raise exception 'A coleção não tem semanas para aplicar.'; end if;
      v_rem := v_total - (v_total / v_nweeks) * v_nweeks;
      -- Premissa: colecao_semanas.semana é numérica "1".."5" (fluxo OTB) — o order/idx usa semana::int.
      -- Guarda: nenhuma semana pode ficar abaixo de Σ categorias.
      for r in
        select semana, (row_number() over (order by semana::int)) - 1 as idx
        from public.colecao_semanas
        where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and tenant_id = v_tenant
        order by semana::int
      loop
        v_new := (v_total / v_nweeks) + (case when r.idx < v_rem then 1 else 0 end);
        if (select coalesce(sum(qtd), 0) from public.colecao_semana_categorias
              where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and semana = r.semana) > v_new then
          raise exception 'Ajuste as categorias da semana % no editor da coleção antes de aplicar (o novo total ficaria abaixo do já distribuído).', r.semana;
        end if;
      end loop;
      -- Aplica.
      for r in
        select semana, (row_number() over (order by semana::int)) - 1 as idx
        from public.colecao_semanas
        where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and tenant_id = v_tenant
        order by semana::int
      loop
        v_new := (v_total / v_nweeks) + (case when r.idx < v_rem then 1 else 0 end);
        update public.colecao_semanas set qtd_planejada = v_new
          where colecao_id = v_colecao and subcolecao_id is not distinct from v_sub and semana = r.semana and tenant_id = v_tenant;
      end loop;
    end;
  end if;

  return jsonb_build_object('aplicado', true);
end $function$;

revoke execute on function public.aplicar_simulacao(uuid, uuid) from public, anon;
grant  execute on function public.aplicar_simulacao(uuid, uuid) to authenticated;

commit;
