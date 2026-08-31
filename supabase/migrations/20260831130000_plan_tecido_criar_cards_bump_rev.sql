-- Fast-follow (achado da revisão G6): criar cards em massa não avança `colecoes.plan_rev`
-- → lost-update + duplicação em edição simultânea de 2 usuários.
--
-- Diagnóstico: `_plan_tecido_criar_cards_core` faz `UPDATE plan_tecido_slots SET modelo_id=…`
-- (via `_plan_tecido_criar_card_core`) mas não bumpa `plan_rev`. O trigger `trg_colab_bump`
-- (que dispara `fn_colab_bump_plan`, cujo corpo é `UPDATE colecoes SET id = id WHERE id = …`
-- — um no-op que só serve para acionar `trg_colab_plan_rev`/`fn_colab_touch_plan_rev`, que
-- de fato incrementa `plan_rev`) só existe em `plan_tecido` e `plan_tecido_slot_oc`, tabelas
-- que o criar-card não toca.
--
-- Efeito: usuário 2 com o plano aberto (slot vazio no draft dele) salva DEPOIS que o usuário 1
-- criou um card → `_rev_base` do usuário 2 ainda bate com `colecoes.plan_rev` (não mudou) →
-- o save passa → reinsere o slot com `modelo_id: null` → desvincula em silêncio o card recém-
-- criado pelo usuário 1 (card fica órfão) → recriar duplica o modelo.
--
-- Correção: copia o MESMO padrão de `fn_colab_bump_plan` (UPDATE no-op em `colecoes`, que já
-- dispara `trg_colab_plan_rev`) para dentro de `_plan_tecido_criar_cards_core`, só quando pelo
-- menos 1 card foi de fato criado (`jsonb_array_length(v_out) > 0` — array vazio não bumpa).
--
-- CREATE OR REPLACE com a MESMA assinatura (uuid,uuid,jsonb) — sem DROP, ACL preservada.
-- Diff pg_get_functiondef antes/depois: só o bloco do bump; resto byte-a-byte idêntico.
-- Testado em transação revertida (BEGIN…ROLLBACK): array vazio não bumpa `plan_rev`; o mesmo
-- UPDATE no-op, executado fora do guard, bumpa `plan_rev` (+1) — prova o comportamento do
-- bloco sem precisar criar card real (evita sujar dado).

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

  -- bump de plan_rev (mesmo padrão de fn_colab_bump_plan): UPDATE em plan_tecido_slots (feito por
  -- _plan_tecido_criar_card_core) NÃO tem trg_colab_bump (só plan_tecido/plan_tecido_oc_aplicada/
  -- plan_tecido_slot_oc têm) — sem isso, um 2º usuário com plano aberto salva por cima com
  -- modelo_id:null (P0409 não dispara pq plan_rev não mudou) e desvincula o card recém-criado.
  if jsonb_array_length(v_out) > 0 then
    update public.colecoes set id = id where id = _colecao_id and tenant_id = _tenant;
  end if;

  return v_out;
end $function$;

-- Invariante #9: REVOKE defensivo dos TRÊS (idempotente; a função já era f|f antes desta
-- migração, mas CREATE OR REPLACE não altera ACL — reafirma por precaução).
REVOKE EXECUTE ON FUNCTION public._plan_tecido_criar_cards_core(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
