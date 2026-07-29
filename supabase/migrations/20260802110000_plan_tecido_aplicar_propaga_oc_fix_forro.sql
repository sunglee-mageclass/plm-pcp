-- Correção da propagação de OC do "aplicar ao modelo" (20260802100000), após revisão adversarial:
--
-- [1] DATA-LOSS do FORRO: o DELETE `tipo in ('tecido','forro')` apagava TODOS os vínculos, mas o
--     re-link só recria variantes cujas OCs estão em plan_tecido_slot_oc (restrito à lane do
--     tecido#1). Forro em OC SEPARADA (ou variante de tecido fora da OC do plano) tinha o vínculo
--     do Dev apagado e nunca recriado → perda silenciosa de custo congelado + reserva. Agora o
--     DELETE só atinge variantes que as OCs do plano REALMENTE cobrem (mesma variante existe em
--     item de v_ocs); o resto é preservado.
-- [2] OVER-RESERVA por vínculos q=0 EXCEDENTES: ocs_disponiveis_variante reserva a necessidade
--     cheia por vínculo (ignora quantidade_m), então itens excedentes viravam reserva fantasma.
--     Agora só insere itens que recebem alocação (q>0), mantendo ≥1 vínculo (o 1º) p/ a OC ainda
--     aparecer selecionada quando a necessidade é 0 (consumo não preenchido) — nesse caso a reserva
--     também é 0, então é inofensivo.
-- (A over-reserva RESIDUAL quando UMA variante é legitimamente coberta por 2+ OCs é um problema
--  PRÉ-EXISTENTE de ocs_disponiveis_variante — reservar por quantidade_m — fora do escopo aqui.)

BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_aplicar_ao_modelo_core(_slot_id uuid, _materiais jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo uuid; v_tenant uuid; v_lancado boolean;
  v_ocs uuid[];
  rec record;
  v_grade_total numeric;
  v_need numeric;
begin
  select modelo_id, tenant_id into v_modelo, v_tenant from plan_tecido_slots where id = _slot_id;
  if v_tenant is null or v_tenant is distinct from public.get_user_tenant_id() then
    raise exception 'Sem permissão sobre este item.' using errcode = '42501';
  end if;
  if v_modelo is null then
    raise exception 'Este item não está ligado a um modelo. Crie o card antes de aplicar.' using errcode = 'P0001';
  end if;
  select lancado into v_lancado from modelos where id = v_modelo;
  if coalesce(v_lancado, false) then
    raise exception 'Modelo já lançado — não é possível alterar o BOM.' using errcode = '42501';
  end if;

  perform public._plan_tecido_gravar_bom_core(v_modelo, _materiais);

  -- aplica também a PROPORÇÃO do plano (senão só a grade mudava, não a proporção do modelo)
  update modelos m set proporcoes = sl.proporcoes
    from plan_tecido_slots sl
    where sl.id = _slot_id and m.id = v_modelo
      and sl.proporcoes is not null and jsonb_typeof(sl.proporcoes) = 'object' and sl.proporcoes <> '{}'::jsonb;

  -- PROPAGA a(s) OC(s) do plano p/ o vínculo do Dev (só quando o plano especifica OC).
  select array_agg(oc_tecido_id) into v_ocs from plan_tecido_slot_oc where slot_id = _slot_id;
  if v_ocs is not null and array_length(v_ocs, 1) > 0 then
    -- Reescreve SÓ as variantes que as OCs do plano cobrem (mesma variante existe em item de v_ocs).
    -- Preserva vínculos de variantes que o plano NÃO cobre (ex.: forro em OC separada).
    delete from modelo_tecido_oc_links l
      where l.modelo_id = v_modelo and l.tipo in ('tecido','forro')
        and exists (
          select 1 from public.ocs_tecido_itens it
          where it.oc_tecido_id = any(v_ocs) and it.variante_tecido_id = l.variante_tecido_id
        );

    for rec in
      select mt.tipo, mt.numero, mt.consumo, mt.loss_percent,
             mtv.ordem, mtv.variante_tecido_id, mtv.multiplicador
      from modelo_tecidos mt
      join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
      where mt.modelo_id = v_modelo and mt.tipo in ('tecido','forro')
    loop
      v_grade_total := coalesce(
        (select mg.grade_total from modelo_grades mg
          where mg.modelo_id = v_modelo and mg.variante_numero = rec.ordem), 0);
      v_need := coalesce(rec.consumo, 0)
              * (1 + coalesce(rec.loss_percent, 0) / 100.0)
              * v_grade_total
              * coalesce(rec.multiplicador, 1);

      insert into modelo_tecido_oc_links
        (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
      select v_tenant, v_modelo, rec.tipo, rec.numero, rec.ordem, rec.variante_tecido_id,
             a.item_id, a.q, a.rn
      from (
        with cand as (
          -- renumera 1..n APÓS filtrar às OCs do slot (o ord do array inteiro pularia números)
          select item_id, saldo, row_number() over (order by ord) as rn
          from (
            select (e->>'oc_tecido_item_id')::uuid as item_id,
                   greatest(0, coalesce((e->>'disponivel_m')::numeric, 0)) as saldo,
                   ord
            from jsonb_array_elements(public.ocs_disponiveis_variante(rec.variante_tecido_id, v_modelo))
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
        -- só itens que recebem alocação (q>0); garante ≥1 vínculo (o 1º) p/ a OC aparecer
        -- selecionada mesmo com necessidade 0. Evita vínculos q=0 excedentes (reserva fantasma).
        where greatest(0, least(saldo, v_need - prev)) > 0 or rn = 1
      ) a;
    end loop;
  end if;

  return v_modelo;
end $function$;

COMMIT;
