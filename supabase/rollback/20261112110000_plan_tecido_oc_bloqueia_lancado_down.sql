-- Inverso de 20261112110000_plan_tecido_oc_bloqueia_lancado.sql: devolve salvar_config_loja ao texto da R12 (md5 43c4b4d6a658bfcbaf1c29dc615aecf0)
-- e o _core ao da 20261112100000 (sem o bloqueio de lancado). A COLUNA tenant_config.plan_tecido_oc_bloqueia_lancado FICA (inerte);
-- drop opcional: 20261112110000_plan_tecido_oc_bloqueia_lancado_down_drop.sql. Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
DO $destroca$
DECLARE
  d text;
  a text[];
  b text[];
  i int;
BEGIN
  a := ARRAY[
    $x$'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado'];$x$,
    $x$      WHEN 'markup_analise_faixa', 'plan_tecido_oc_bloqueia_lancado' THEN$x$,
    $x$                                         ELSE aprovar_custo_auto_por_versao END,
    plan_tecido_oc_bloqueia_lancado = CASE WHEN v_m ? 'plan_tecido_oc_bloqueia_lancado'
                                           THEN (v_m ->> 'plan_tecido_oc_bloqueia_lancado')::boolean
                                           ELSE plan_tecido_oc_bloqueia_lancado END
$x$];
  b := ARRAY[
    $x$'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao'];$x$,
    $x$      WHEN 'markup_analise_faixa' THEN$x$,
    $x$                                         ELSE aprovar_custo_auto_por_versao END
$x$];
  d := pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'));
  IF position('plan_tecido_oc_bloqueia_lancado' IN d) = 0 THEN
    RETURN;  -- ja desfeita (reaplicar e inofensivo)
  END IF;
  FOR i IN 1..3 LOOP
    IF (length(d) - length(replace(d, a[i], ''))) / length(a[i]) <> 1 THEN
      RAISE EXCEPTION 'plan_tecido_oc_bloqueia: ancora % nao aparece exatamente 1x em salvar_config_loja (down)', i USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR i IN 1..3 LOOP
    d := replace(d, a[i], b[i]);
  END LOOP;
  EXECUTE d;
END
$destroca$;

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

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) IS DISTINCT FROM '43c4b4d6a658bfcbaf1c29dc615aecf0' THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia_down: salvar_config_loja nao voltou ao texto da R12' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
NOTIFY pgrst, 'reload schema';
COMMIT;
