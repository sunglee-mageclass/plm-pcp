-- G6 (Pacote G-feat, Ondas 3+4): criação de cards em MASSA no Plan. Tecido.
-- Batch = loop do core de 1 (`_plan_tecido_criar_card_core`) — REUSO PURO, zero duplicação da
-- lógica de INSERT/BOM/migração de referência (G4). Funções NOVAS (CREATE, sem DROP): ACL de
-- nenhuma função existente é tocada; o `_core` novo é revogado dos TRÊS (invariante #9) e o
-- wrapper já nasce hardened (grant só authenticated — espelha 20260820100000, sem o
-- "anon=true latente" dos wrappers antigos).
-- Guarda server-side: slot JÁ materializado (`modelo_id IS NOT NULL`) é PULADO (regra do dono:
-- "criar em massa pula os já materializados" — o front avisa; aqui protege contra corrida de
-- colaboração: 2 usuários materializando ao mesmo tempo NÃO duplicam modelo). Slot pulado fica
-- FORA do array retornado — retorno = [{slot_id, modelo_id}] só dos CRIADOS.
-- Atômico: qualquer erro no meio desfaz o batch inteiro (mesma txn).
BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_criar_cards_core(_tenant uuid, _colecao_id uuid, _slots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v jsonb; v_sid uuid; v_mid uuid; v_out jsonb := '[]'::jsonb;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;

  for v in select * from jsonb_array_elements(coalesce(_slots, '[]'::jsonb)) loop
    v_sid := nullif(v->>'slot_id','')::uuid;
    -- pula slot já materializado (corrida de colab: outro usuário criou o card no meio)
    if v_sid is not null and exists (
      select 1 from plan_tecido_slots s
      where s.id = v_sid and s.tenant_id = _tenant and s.modelo_id is not null
    ) then
      continue;
    end if;
    v_mid := public._plan_tecido_criar_card_core(_tenant, _colecao_id, v);
    v_out := v_out || jsonb_build_object('slot_id', v_sid, 'modelo_id', v_mid);
  end loop;

  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_criar_cards(_colecao_id uuid, _slots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_criar_cards_core(public.get_user_tenant_id(), _colecao_id, _slots);
end $function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_criar_cards_core(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_criar_cards(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_criar_cards(uuid,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
