-- OTB: importar coleções já digitadas (texto) → cria linhas em colecoes e liga o FK.
create or replace function public.otb_importar_colecoes()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_col_id uuid; v_imp int := 0; v_vin int := 0; v_n int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  for v_nome in
    select distinct trim(colecao) from modelos
    where tenant_id = v_tenant and colecao_id is null and coalesce(trim(colecao),'') <> ''
  loop
    select id into v_col_id from colecoes where tenant_id = v_tenant and nome = v_nome;
    if v_col_id is null then
      insert into colecoes (nome, status) values (v_nome, 'confirmada') returning id into v_col_id;
      v_imp := v_imp + 1;
    end if;
    update modelos set colecao_id = v_col_id
      where tenant_id = v_tenant and colecao_id is null and trim(colecao) = v_nome;
    get diagnostics v_n = row_count;
    v_vin := v_vin + v_n;
  end loop;

  return jsonb_build_object('importadas', v_imp, 'vinculados', v_vin);
end;
$function$;

revoke execute on function public.otb_importar_colecoes() from public, anon;
grant execute on function public.otb_importar_colecoes() to authenticated;
select pg_notify('pgrst','reload schema');
