-- 20260817160000_plan_tecido_aplicar_gate_enviado_cad.sql
-- Bug #9 / regra do dono: até "Enviado à Explosão" (modelos.enviado_cad) o card do Plan. Tecido pode
-- alterar o BOM (o front auto-aplica no save); A PARTIR da Explosão, o card TRAVA — e a trava NÃO pode
-- ser só no front. Adiciona o gate de enviado_cad em _plan_tecido_aplicar_ao_modelo_core (o mesmo core
-- usado pelo botão "Aplicar ao modelo" E pelo auto-aplicar do save): RAISE 42501 em PT se enviado_cad.
--
-- CREATE OR REPLACE com a MESMA assinatura (uuid,jsonb,boolean) → ACL preservada (invariante #9: o
-- _core segue com EXECUTE revogado de PUBLIC/anon/authenticated; o wrapper inalterado). Corpo idêntico
-- ao vivo (20260814110000) + o gate novo (2 linhas) → diff-validável. `criar_card` NÃO passa por aqui
-- (usa _plan_tecido_gravar_bom_core direto e o card nasce enviado_cad=false), então segue livre.

begin;

create or replace function public._plan_tecido_aplicar_ao_modelo_core(_slot_id uuid, _materiais jsonb, _confirmar_sobrescrita boolean DEFAULT false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_modelo uuid; v_tenant uuid; v_lancado boolean; v_enviado boolean;
  v_ocs uuid[];
  rec record;
  v_grade_total numeric;
  v_need numeric;
  v_cur_var_count int;
  v_new_var_count int;
  v_cur_grade_filled boolean;
  v_new_grade_filled boolean;
begin
  select modelo_id, tenant_id into v_modelo, v_tenant from plan_tecido_slots where id = _slot_id;
  if v_tenant is null or v_tenant is distinct from public.get_user_tenant_id() then
    raise exception 'Sem permissão sobre este item.' using errcode = '42501';
  end if;
  if v_modelo is null then
    raise exception 'Este item não está ligado a um modelo. Crie o card antes de aplicar.' using errcode = 'P0001';
  end if;
  select lancado, enviado_cad into v_lancado, v_enviado from modelos where id = v_modelo;
  if coalesce(v_lancado, false) then
    raise exception 'Modelo já lançado — não é possível alterar o BOM.' using errcode = '42501';
  end if;
  -- [GATE bug #9] pós-explosão: o BOM já foi explodido pelo CAD → o card não pode reescrevê-lo.
  -- Ajustes seguem pelo Desenvolvimento/CAD (destravar lá). Trava server-side (o front também desabilita).
  if coalesce(v_enviado, false) then
    raise exception 'Modelo já enviado à Explosão — edição de tecido pelo card bloqueada. Ajuste pelo Desenvolvimento/CAD.' using errcode = '42501';
  end if;

  -- [BLINDAGEM 2] guarda vazio-sobre-preenchido: aplicar rescreve tecido/forro+grade do modelo.
  -- Se o payload esvaziaria variantes hoje existentes (ou zeraria a grade preenchida), exige
  -- _confirmar_sobrescrita. hint estável 'plan_tecido_sobrescrita' → front abre AlertDialog.
  if not _confirmar_sobrescrita then
    select count(*) into v_cur_var_count
    from modelo_tecido_variantes mtv
    join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id
    where mt.modelo_id = v_modelo and mt.tipo in ('tecido','forro');

    select count(*) into v_new_var_count
    from jsonb_array_elements(coalesce(_materiais,'[]'::jsonb)) m
    cross join lateral jsonb_array_elements(coalesce(m->'variantes','[]'::jsonb)) v
    where coalesce(nullif(m->>'tipo',''),'tecido') in ('tecido','forro')
      and nullif(v->>'variante_tecido_id','') is not null;

    select exists(select 1 from modelo_grades where modelo_id = v_modelo and coalesce(grade_total,0) > 0)
      into v_cur_grade_filled;

    select exists(
      select 1 from jsonb_array_elements(coalesce(_materiais,'[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'variantes','[]'::jsonb)) v
      where coalesce(nullif(m->>'tipo',''),'tecido') = 'tecido'
        and coalesce((m->>'numero')::int,1) = 1
        and coalesce((v->>'grade_total')::numeric,0) > 0
    ) into v_new_grade_filled;

    if v_cur_var_count > 0 and v_new_var_count = 0 then
      raise exception 'Aplicar apagaria % cor(es) já cadastrada(s) no modelo — confirme para prosseguir.', v_cur_var_count
        using errcode = 'P0001', hint = 'plan_tecido_sobrescrita';
    elsif v_cur_grade_filled and not v_new_grade_filled then
      raise exception 'Aplicar zeraria a grade já preenchida do modelo — confirme para prosseguir.'
        using errcode = 'P0001', hint = 'plan_tecido_sobrescrita';
    end if;
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

-- ACL (invariante #9): CREATE OR REPLACE preserva o ACL existente; reafirmo por garantia idempotente.
revoke execute on function public._plan_tecido_aplicar_ao_modelo_core(uuid, jsonb, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
