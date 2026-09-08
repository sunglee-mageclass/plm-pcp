-- Produto Acabado — "Criar card(s) no Planejamento" EM LOTE (#2.3, ação em massa da barra de
-- seleção). Reusa `_criar_card_produto_acabado_core` (singular) num loop; ignora silenciosamente
-- produtos que já têm card (modelo_id não-nulo). Materializa o espelho `modelos` (origem='revenda')
-- + modelo_grades + recompute de preços — dá `modelo_id` ao produto, habilitando o Replicar.
-- Wrapper+_core+REVOKE (#9); gate produto_acabado. Idempotente. Espelha o lote do Importado.

BEGIN;

create or replace function public._criar_cards_produto_acabado_lote_core(_produto_ids uuid[])
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

  for r in select id, modelo_id from public.produtos_acabados
           where id = any(_produto_ids) and tenant_id = v_tenant loop
    if r.modelo_id is not null then continue; end if; -- já tem card
    v_modelo := public._criar_card_produto_acabado_core(r.id);
    v_out := v_out || jsonb_build_object('produto_id', r.id, 'modelo_id', v_modelo);
  end loop;
  return v_out;
end $$;
revoke execute on function public._criar_cards_produto_acabado_lote_core(uuid[]) from public, anon, authenticated;

create or replace function public.criar_cards_produto_acabado(_produto_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._criar_cards_produto_acabado_lote_core(_produto_ids);
end $$;
revoke execute on function public.criar_cards_produto_acabado(uuid[]) from public, anon;
grant execute on function public.criar_cards_produto_acabado(uuid[]) to authenticated;

COMMIT;
