-- Produtos Importados — "Criar card(s) no Planejamento" EM LOTE (ação em massa da barra de seleção).
-- Reusa `_criar_card_produto_importado_core` (singular) num loop; ignora silenciosamente produtos
-- que já têm card (modelo_id não-nulo). Materializa o espelho `modelos` (origem='importado') +
-- modelo_grades + recompute de preços — dá `modelo_id` ao produto, habilitando o Replicar (que
-- exige card p/ versionar). Wrapper+_core+REVOKE (#9); gate produto_importado. Idempotente.

BEGIN;

create or replace function public._criar_cards_produto_importado_lote_core(_produto_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  r record;
  v_modelo uuid;
  v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  for r in select id, modelo_id from public.produtos_importados
           where id = any(_produto_ids) and tenant_id = v_tenant loop
    if r.modelo_id is not null then continue; end if; -- já tem card
    v_modelo := public._criar_card_produto_importado_core(r.id);
    v_out := v_out || jsonb_build_object('produto_id', r.id, 'modelo_id', v_modelo);
  end loop;
  return v_out;
end $$;
revoke execute on function public._criar_cards_produto_importado_lote_core(uuid[]) from public, anon, authenticated;

create or replace function public.criar_cards_produto_importado(_produto_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._criar_cards_produto_importado_lote_core(_produto_ids);
end $$;
revoke execute on function public.criar_cards_produto_importado(uuid[]) from public, anon;
grant execute on function public.criar_cards_produto_importado(uuid[]) to authenticated;

COMMIT;
