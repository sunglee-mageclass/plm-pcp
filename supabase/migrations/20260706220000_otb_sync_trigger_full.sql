-- Integridade total OTB↔Planejamento em QUALQUER caminho: um gatilho único em modelos
-- (INSERT/UPDATE/DELETE) mantém colecao_semanas.qtd_planejada e colecao_semana_categorias.qtd
-- conforme o card entra/sai/muda de bucket (coleção, subcoleção, semana, categoria). Assim,
-- reclassificar um card DIRETO no Planejamento (mudar semana/subcoleção/categoria) ou criar um
-- card já classificado também ajusta o OTB. A trava app.otb_reconciling desliga o gatilho
-- durante otb_confirmar (gera/remove blanks já batendo), otb_excluir_colecao e otb_importar_colecoes.

create or replace function public.fn_otb_sync_semana()
returns trigger language plpgsql as $$
declare
  v_old_sub uuid; v_new_sub uuid;
  v_bucket_changed boolean;
begin
  if coalesce(current_setting('app.otb_reconciling', true), '') = 'on' then
    return coalesce(NEW, OLD);
  end if;

  v_bucket_changed := (TG_OP <> 'UPDATE')
    or OLD.colecao_id is distinct from NEW.colecao_id
    or coalesce(OLD.subcolecao,'') is distinct from coalesce(NEW.subcolecao,'')
    or coalesce(OLD.semana,'') is distinct from coalesce(NEW.semana,'')
    or OLD.categoria_principal_id is distinct from NEW.categoria_principal_id;

  -- baixa o bucket antigo (DELETE, ou UPDATE que mudou o bucket)
  if (TG_OP in ('DELETE','UPDATE')) and v_bucket_changed
     and OLD.colecao_id is not null and coalesce(OLD.semana,'') <> '' then
    if coalesce(OLD.subcolecao,'') <> '' then
      select id into v_old_sub from public.colecao_subcolecoes
        where colecao_id = OLD.colecao_id and nome = OLD.subcolecao limit 1;
    else v_old_sub := null; end if;
    update public.colecao_semanas set qtd_planejada = greatest(0, qtd_planejada - 1)
      where colecao_id = OLD.colecao_id and coalesce(semana,'') = coalesce(OLD.semana,'')
        and coalesce(subcolecao_id::text,'') = coalesce(v_old_sub::text,'');
    if OLD.categoria_principal_id is not null then
      update public.colecao_semana_categorias set qtd = greatest(0, qtd - 1)
        where colecao_id = OLD.colecao_id and semana = coalesce(OLD.semana,'')
          and coalesce(subcolecao_id::text,'') = coalesce(v_old_sub::text,'')
          and categoria_id = OLD.categoria_principal_id;
    end if;
  end if;

  -- sobe o bucket novo (INSERT, ou UPDATE que mudou o bucket)
  if (TG_OP in ('INSERT','UPDATE')) and v_bucket_changed
     and NEW.colecao_id is not null and coalesce(NEW.semana,'') <> '' then
    if coalesce(NEW.subcolecao,'') <> '' then
      select id into v_new_sub from public.colecao_subcolecoes
        where colecao_id = NEW.colecao_id and nome = NEW.subcolecao limit 1;
    else v_new_sub := null; end if;
    insert into public.colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada)
      values (NEW.colecao_id, v_new_sub, NEW.semana, 1)
      on conflict (colecao_id, subcolecao_id, semana)
      do update set qtd_planejada = colecao_semanas.qtd_planejada + 1;
    if NEW.categoria_principal_id is not null then
      insert into public.colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
        values (NEW.colecao_id, v_new_sub, NEW.semana, NEW.categoria_principal_id, 1)
        on conflict (colecao_id, subcolecao_id, semana, categoria_id)
        do update set qtd = colecao_semana_categorias.qtd + 1;
    end if;
  end if;

  return coalesce(NEW, OLD);
end $$;

-- substitui o gatilho antigo (só DELETE) pelo unificado
drop trigger if exists trg_otb_dec_semana on public.modelos;
drop trigger if exists trg_otb_sync_semana on public.modelos;
create trigger trg_otb_sync_semana after insert or update or delete on public.modelos
  for each row execute function public.fn_otb_sync_semana();

-- otb_atribuir_card: agora só valida + atualiza o card; o gatilho faz o +1 na semana/categoria.
create or replace function public.otb_atribuir_card(_modelo_id uuid, _subcolecao_id uuid, _semana text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_colecao uuid;
  v_subnome text;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if coalesce(_semana,'') = '' then raise exception 'Informe a semana'; end if;

  select colecao_id into v_colecao from modelos where id = _modelo_id and tenant_id = v_tenant;
  if not found or v_colecao is null then raise exception 'Card não encontrado ou sem coleção'; end if;

  if _subcolecao_id is not null then
    select nome into v_subnome from colecao_subcolecoes where id = _subcolecao_id and colecao_id = v_colecao and tenant_id = v_tenant;
    if v_subnome is null then raise exception 'Subcoleção inválida'; end if;
  end if;

  update modelos set subcolecao = v_subnome, semana = _semana
    where id = _modelo_id and tenant_id = v_tenant;
end $$;

-- Importar não deve disparar o gatilho (importada nasce sem semanas; os modelos ficam como
-- "não classificados" até o dono montar o plano).
create or replace function public.otb_importar_colecoes()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_col_id uuid; v_imp int := 0; v_vin int := 0; v_n int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  perform set_config('app.otb_reconciling', 'on', true);

  for v_nome in
    select distinct trim(colecao) from modelos
    where tenant_id = v_tenant and colecao_id is null and coalesce(trim(colecao),'') <> ''
  loop
    select id into v_col_id from colecoes where tenant_id = v_tenant and nome = v_nome;
    if v_col_id is null then
      insert into colecoes (tenant_id, nome, status) values (v_tenant, v_nome, 'rascunho') returning id into v_col_id;
      v_imp := v_imp + 1;
    end if;
    update modelos set colecao_id = v_col_id
      where tenant_id = v_tenant and colecao_id is null and trim(colecao) = v_nome;
    get diagnostics v_n = row_count;
    v_vin := v_vin + v_n;
  end loop;

  perform set_config('app.otb_reconciling', 'off', true);
  return jsonb_build_object('importadas', v_imp, 'vinculados', v_vin);
end;
$function$;

select pg_notify('pgrst', 'reload schema');
