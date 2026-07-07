-- FORNECEDORES — FASE 2 (schema, complemento do review): ao EXCLUIR uma empresa de serviço,
-- apaga o `terceirizados` espelho órfão (senão sobra um serviço-fantasma sem categoria na
-- Produção). A guarda da tela já bloqueia excluir empresa de serviço EM USO (conta
-- producao_terceirizados por empresa_id e terceirizado_id), então o espelho não está referenciado
-- e o delete passa limpo. Nota: no DELETE em cascata de empresa_categorias_servico, o T2 não
-- consegue resolver a empresa (já deletada), então limpamos terceirizado_categorias aqui também.
create or replace function public.fn_mirror_empresa_terc_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.terc_mirror', true), '') = 'on' then return OLD; end if;
  if OLD.tipo = 'servico' and OLD.origem_terceirizado_id is not null then
    perform set_config('app.terc_mirror', 'on', true);
    delete from public.terceirizado_categorias where terceirizado_id = OLD.origem_terceirizado_id;
    delete from public.terceirizados where id = OLD.origem_terceirizado_id;
    perform set_config('app.terc_mirror', 'off', true);
  end if;
  return OLD;
end $$;
revoke execute on function public.fn_mirror_empresa_terc_delete() from public, anon, authenticated;

drop trigger if exists trg_mirror_empresa_terc_del on public.empresas;
create trigger trg_mirror_empresa_terc_del after delete on public.empresas
  for each row execute function public.fn_mirror_empresa_terc_delete();

select pg_notify('pgrst', 'reload schema');
