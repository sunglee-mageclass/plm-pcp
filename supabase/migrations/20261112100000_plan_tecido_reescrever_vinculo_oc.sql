-- F1 C (dono 06/nov): LIBERAR trocar/remover o vinculo de OC do modelo a partir do Plan. Tecido.
-- Ate aqui so o Dev (salvar_modelo_bom) e _plan_tecido_aplicar_ao_modelo_core escreviam modelo_tecido_oc_links.
-- Esta RPC recebe o CONJUNTO DESEJADO de OCs do modelo e deixa os vinculos tipo tecido/forro exatamente nele:
--   * _oc_ids vazio  -> limpa todos os vinculos tecido/forro do modelo (so quando era a ultima OC);
--   * _oc_ids com N  -> apaga os vinculos atuais e re-reparte cada variante do BOM do modelo pelas N OCs,
--                       por quantidade_m (MESMA alocacao do _plan_tecido_aplicar_ao_modelo_core, 20260802110000).
-- "Remover uma OC" = o front manda a lista atual SEM ela; "adicionar/trocar" = manda a lista nova.
-- Efeitos DESEJADOS: o custo congelado (inv. 15, trg_custo_fila_*) e a reserva (quantidade_m por vinculo, lida por
-- ocs_disponiveis_variante / _plan_tecido_situacao_ocs_core) recalculam sozinhos pelos gatilhos da tabela.
-- Dono: liberar SEMPRE (inclusive apos o corte, enviado_cad); o AVISO de recalculo e no front, aqui nao bloqueia.
-- O wrapper tambem sincroniza o hint de OC do card (plan_tecido_slot_oc) com o conjunto desejado.
-- _core reutilizavel internamente (Task D: vinculo no pedido): chamado com o tenant do usuario logado, nunca exposto.
BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_reescrever_vinculo_oc_core(_tenant uuid, _modelo_id uuid, _oc_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record;
  v_ocs uuid[];
  v_grade_total numeric;
  v_need numeric;
  v_tenant_modelo uuid;
begin
  select tenant_id into v_tenant_modelo from modelos where id = _modelo_id;
  if v_tenant_modelo is null or _tenant is null or v_tenant_modelo is distinct from _tenant then
    raise exception 'Sem permissao sobre este modelo.' using errcode = '42501';
  end if;

  -- so OCs da propria loja (ids de outra loja/inexistentes sao ignorados); dedup
  select coalesce(array_agg(distinct oc.id), '{}'::uuid[]) into v_ocs
    from public.ocs_tecido oc
   where oc.id = any(coalesce(_oc_ids, '{}'::uuid[])) and oc.tenant_id = _tenant;

  -- o conjunto desejado e a verdade: apaga TODOS os vinculos tecido/forro do modelo (as OCs removidas somem;
  -- as mantidas sao realocadas abaixo). Com v_ocs vazio, e a limpeza total.
  delete from modelo_tecido_oc_links l
    where l.modelo_id = _modelo_id and l.tipo in ('tecido','forro');

  if array_length(v_ocs, 1) is null then
    return;
  end if;

  for rec in
    select mt.tipo, mt.numero, mt.consumo, mt.loss_percent,
           mtv.ordem, mtv.variante_tecido_id, mtv.multiplicador
    from modelo_tecidos mt
    join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
    where mt.modelo_id = _modelo_id and mt.tipo in ('tecido','forro')
  loop
    v_grade_total := coalesce(
      (select mg.grade_total from modelo_grades mg
        where mg.modelo_id = _modelo_id and mg.variante_numero = rec.ordem), 0);
    v_need := coalesce(rec.consumo, 0)
            * (1 + coalesce(rec.loss_percent, 0) / 100.0)
            * v_grade_total
            * coalesce(rec.multiplicador, 1);

    insert into modelo_tecido_oc_links
      (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
    select _tenant, _modelo_id, rec.tipo, rec.numero, rec.ordem, rec.variante_tecido_id,
           a.item_id, a.q, a.rn
    from (
      with cand as (
        -- renumera 1..n APOS filtrar as OCs desejadas (o ord do array inteiro pularia numeros)
        select item_id, saldo, row_number() over (order by ord) as rn
        from (
          select (e->>'oc_tecido_item_id')::uuid as item_id,
                 greatest(0, coalesce((e->>'disponivel_m')::numeric, 0)) as saldo,
                 ord
          from jsonb_array_elements(public.ocs_disponiveis_variante(rec.variante_tecido_id, _modelo_id))
                 with ordinality as t(e, ord)
          where exists (
            select 1 from public.ocs_tecido_itens it
            where it.id = (e->>'oc_tecido_item_id')::uuid and it.oc_tecido_id = any(v_ocs)
          )
        ) s
      ),
      cum as (
        select item_id, saldo, rn,
               coalesce(sum(saldo) over (order by rn rows between unbounded preceding and 1 preceding), 0) as prev
        from cand
      )
      select item_id, rn,
             round(greatest(0, least(saldo, v_need - prev))::numeric, 2) as q
      from cum
      -- so itens que recebem alocacao (q>0); garante >=1 vinculo (o 1o) p/ a OC aparecer selecionada mesmo com
      -- necessidade 0. Evita vinculos q=0 excedentes (reserva fantasma).
      where greatest(0, least(saldo, v_need - prev)) > 0 or rn = 1
    ) a;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_reescrever_vinculo_oc(_modelo_id uuid, _oc_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Modulo criacao nao habilitado' using errcode='42501'; end if;
  PERFORM public._exige_modulos('otb');  -- Plan. Tecido faz parte do OTB (mesmo gate do plan_tecido_aplicar_ao_modelo)
  -- permissao de PAGINA no servidor (Reforco de seguranca S3): exige EDITAR criacao_plan_tecido.
  PERFORM public._seg_exige_pagina('criacao_plan_tecido');
  v_tenant := public.get_user_tenant_id();
  perform public._plan_tecido_reescrever_vinculo_oc_core(v_tenant, _modelo_id, _oc_ids);  -- valida modelo x loja (42501)

  -- Mantem o HINT de OC do(s) card(s) deste modelo (plan_tecido_slot_oc) igual ao vinculo: senao o proximo
  -- auto-aplicar do save (_plan_tecido_aplicar_ao_modelo_core le o hint) RE-VINCULARIA a OC que o usuario removeu.
  -- Fica no wrapper (o _core so mexe em modelo_tecido_oc_links, reutilizavel pela Task D).
  delete from plan_tecido_slot_oc so
    using plan_tecido_slots sl
   where so.slot_id = sl.id and sl.modelo_id = _modelo_id and sl.tenant_id = v_tenant;
  insert into plan_tecido_slot_oc (tenant_id, colecao_id, slot_id, oc_tecido_id)
  select v_tenant, p.colecao_id, sl.id, oc.id
    from plan_tecido_slots sl
    join plan_tecido_linhas ln on ln.id = sl.linha_ref_id
    join plan_tecido_subcolecoes sc on sc.id = ln.sub_id
    join plan_tecido p on p.id = sc.plan_id
    join ocs_tecido oc on oc.id = any(coalesce(_oc_ids, '{}'::uuid[])) and oc.tenant_id = v_tenant
   where sl.modelo_id = _modelo_id and sl.tenant_id = v_tenant
  on conflict (slot_id, oc_tecido_id) do nothing;
end $function$;

-- ACL (inv. #9): _core fora de PUBLIC/anon/authenticated; wrapper so authenticated.
REVOKE EXECUTE ON FUNCTION public._plan_tecido_reescrever_vinculo_oc_core(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_reescrever_vinculo_oc(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_reescrever_vinculo_oc(uuid,uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
