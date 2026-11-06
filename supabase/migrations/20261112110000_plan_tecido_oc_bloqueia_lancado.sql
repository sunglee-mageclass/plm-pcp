-- F1 C fix 1 (dono 06/nov): TOGGLE na Config da Loja - "bloquear troca/remocao de OC em modelo LANCADO", LIGADO por padrao.
--   1) coluna NOVA public.tenant_config.plan_tecido_oc_bloqueia_lancado boolean NOT NULL DEFAULT true (ADD COLUMN: AccessExclusive por ms em
--      tenant_config - tentativa atomica com lock_timeout 1500ms, ate 3x; padrao da R12). Nenhum dado muda (todas as lojas nascem true).
--   2) salvar_config_loja (CREATE OR REPLACE por troca EXATA sobre o texto vivo, 3 ancoras 1x cada; ACL/DEFINER/search_path preservados): a coluna entra
--      na lista branca, na validacao (boolean, igual markup_analise_faixa) e no UPDATE estatico; o compare-and-set por coluna e o generico
--      (P0409 conflito_versao: config_loja, DETAIL plan_tecido_oc_bloqueia_lancado).
--   3) _plan_tecido_reescrever_vinculo_oc_core (da 20261112100000): modelo lancado + toggle ligado -> 42501 'oc_vinculo_lancado_bloqueado: ...' (ASCII).
-- ATENCAO (LIFO): desfazer ESTA antes de qualquer inverso que fixe o md5 de salvar_config_loja (43c4b4d6a658bfcbaf1c29dc615aecf0 = depois da R12).
-- ACCEPTED-MD5  public.salvar_config_loja(uuid,jsonb,jsonb,boolean)  ANTES 43c4b4d6a658bfcbaf1c29dc615aecf0  DEPOIS 6d35eb844c03afebccdc110e970f46d0
-- Volta: supabase/rollback/20261112110000_plan_tecido_oc_bloqueia_lancado_down.sql (devolve as 2 funcoes; a coluna fica inerte);
--        drop opcional da coluna: ..._down_drop.sql.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')));
  IF v IS NULL OR v NOT IN ('43c4b4d6a658bfcbaf1c29dc615aecf0', '6d35eb844c03afebccdc110e970f46d0') THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia: salvar_config_loja com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_reescrever_vinculo_oc_core(uuid,uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia: aplique antes a 20261112100000' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'plan_tecido_oc_bloqueia_lancado' AND NOT attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                      WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = 'plan_tecido_oc_bloqueia_lancado' AND NOT a.attisdropped
                        AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = 'true') THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia: tenant_config.plan_tecido_oc_bloqueia_lancado existe com outra forma' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $col$
DECLARE
  i int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'plan_tecido_oc_bloqueia_lancado' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.tenant_config ADD COLUMN plan_tecido_oc_bloqueia_lancado boolean NOT NULL DEFAULT true;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$col$;

COMMENT ON COLUMN public.tenant_config.plan_tecido_oc_bloqueia_lancado IS 'Config da Loja (F1 C): true (padrao) = o servidor RECUSA trocar/remover o vinculo de OC (plan_tecido_reescrever_vinculo_oc) de modelo LANCADO; false = permite. Gravado SO por salvar_config_loja (compare-and-set por coluna).';

-- salvar_config_loja: troca EXATA sobre o texto vivo (cada ancora tem que aparecer exatamente 1x; senao recusa e nada muda).
DO $troca$
DECLARE
  d text;
  a text[];
  b text[];
  i int;
BEGIN
  a := ARRAY[
    $x$'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao'];$x$,
    $x$      WHEN 'markup_analise_faixa' THEN$x$,
    $x$                                         ELSE aprovar_custo_auto_por_versao END
$x$];
  b := ARRAY[
    $x$'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado'];$x$,
    $x$      WHEN 'markup_analise_faixa', 'plan_tecido_oc_bloqueia_lancado' THEN$x$,
    $x$                                         ELSE aprovar_custo_auto_por_versao END,
    plan_tecido_oc_bloqueia_lancado = CASE WHEN v_m ? 'plan_tecido_oc_bloqueia_lancado'
                                           THEN (v_m ->> 'plan_tecido_oc_bloqueia_lancado')::boolean
                                           ELSE plan_tecido_oc_bloqueia_lancado END
$x$];
  d := pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'));
  IF position('plan_tecido_oc_bloqueia_lancado' IN d) > 0 THEN
    RETURN;  -- ja trocada (reaplicar e inofensivo)
  END IF;
  FOR i IN 1..3 LOOP
    IF (length(d) - length(replace(d, a[i], ''))) / length(a[i]) <> 1 THEN
      RAISE EXCEPTION 'plan_tecido_oc_bloqueia: ancora % nao aparece exatamente 1x em salvar_config_loja', i USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR i IN 1..3 LOOP
    d := replace(d, a[i], b[i]);
  END LOOP;
  EXECUTE d;
END
$troca$;

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

  -- F1 C fix 1 (dono 06/nov): modelo LANCADO so tem o vinculo trocado/removido se a loja desligar o bloqueio na Config da Loja
  -- (tenant_config.plan_tecido_oc_bloqueia_lancado, default true; sem linha de config = bloqueia). Server-side: fecha a API.
  if exists (select 1 from modelos m where m.id = _modelo_id and coalesce(m.lancado, false))
     and coalesce((select tc.plan_tecido_oc_bloqueia_lancado from tenant_config tc where tc.tenant_id = _tenant), true) then
    raise exception 'oc_vinculo_lancado_bloqueado: modelo lancado; desligue o bloqueio na Config da Loja' using errcode = '42501';
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

-- pos-condicoes
DO $pos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)') AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres}'
                  AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
     OR has_function_privilege('anon', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia: pos-condicao falhou na ACL/secdef/search_path de salvar_config_loja' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) IS DISTINCT FROM '6d35eb844c03afebccdc110e970f46d0' THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia: pos-condicao falhou no texto de salvar_config_loja' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._plan_tecido_reescrever_vinculo_oc_core(uuid,uuid,uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public._plan_tecido_reescrever_vinculo_oc_core(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia: ACL do _core mudou' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
