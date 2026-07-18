-- 20260717200000_voltar_modelo_desenvolvimento.sql
-- RPC para reverter o envio de um modelo à Explosão.
-- Seta modelos.enviado_cad = false (NÃO apaga o CAD; só desmarca o envio).
-- SECURITY INVOKER + revoke public/anon (padrão invariante #9).
begin;

create or replace function public.voltar_modelo_desenvolvimento(_modelo_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criação não habilitado' using errcode = '42501';
  end if;

  -- Verifica que o modelo pertence ao tenant do usuário (ou é super_admin).
  if not exists (
    select 1 from public.modelos
    where id = _modelo_id
      and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Modelo não encontrado' using errcode = 'P0002';
  end if;

  update public.modelos
    set enviado_cad = false
  where id = _modelo_id;
end;
$function$;

-- Revoga dos três (PUBLIC herda para anon e authenticated; revogar só anon/auth é inócuo).
revoke execute on function public.voltar_modelo_desenvolvimento(uuid) from public, anon, authenticated;
grant  execute on function public.voltar_modelo_desenvolvimento(uuid) to authenticated;

commit;
