-- Produto Importado — completar o Importado (complementar à 3ª origem no fluxo):
--   A) RPC própria de ESTOQUE (`estoque_p_importado`) espelhando `estoque_p_acabado`.
--      Antes a aba Estoque lia `ocs_importado.grade_detalhe` cru no cliente e IGNORAVA o
--      direcionamento. Agora lê o derivado JÁ materializado (`cad_grades.grade_total_real`,
--      gravado por `receber_oc_importado`) e desconta o direcionamento (`direcionamento_lojas`,
--      mesma tabela da revenda, chaveada por `cad_id`). Resultado: real / direcionado / em_maos
--      por produto×variante, idêntico à revenda (invariante #13).
--   B) Badge "OC importado atrasada" no `sidebar_badges` (paridade com `oc_p_acabado_atrasada`):
--      OC `status='encomendado'` cuja `data_prevista` (entrega prevista) já passou. Gated pelo
--      módulo opt-in `produto_importado`.
--
-- Aditiva/idempotente. Segurança: wrapper checa `tenant_module_enabled('produto_importado')`,
-- `_core` recebe tenant por parâmetro e tem EXECUTE revogado dos TRÊS (invariante #9).

-- ─────────────────────────────────────────────────────────────────────────────
-- A) ESTOQUE — cópia literal de _estoque_p_acabado_core, trocando a entidade e o gate.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._estoque_p_importado_core(_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with reais as (
    select p.id as produto_id, cg.variante_numero, coalesce(cg.grade_total_real, 0) as real
    from public.produtos_importados p
    join public.cad c on c.modelo_id = p.modelo_id
    join public.cad_grades cg on cg.cad_id = c.id
    where p.tenant_id = _tenant
  ),
  direcionado as (
    select p.id as produto_id, dl.variante_numero, coalesce(sum((kv.value)::numeric), 0) as direcionado
    from public.produtos_importados p
    join public.cad c on c.modelo_id = p.modelo_id
    join public.direcionamento_lojas dl on dl.cad_id = c.id
    cross join lateral jsonb_each_text(coalesce(dl.grades, '{}'::jsonb)) as kv(key, value)
    where p.tenant_id = _tenant
    group by p.id, dl.variante_numero
  ),
  chaves as (
    select produto_id, variante_numero from reais
    union
    select produto_id, variante_numero from direcionado
  ),
  base as (
    select k.produto_id, k.variante_numero,
      coalesce(r.real, 0) as real,
      coalesce(d.direcionado, 0) as direcionado,
      coalesce(r.real, 0) - coalesce(d.direcionado, 0) as em_maos
    from chaves k
    left join reais r on r.produto_id = k.produto_id and r.variante_numero = k.variante_numero
    left join direcionado d on d.produto_id = k.produto_id and d.variante_numero = k.variante_numero
  ),
  por_produto as (
    select produto_id,
      jsonb_object_agg(
        variante_numero::text,
        jsonb_build_object('real', real, 'direcionado', direcionado, 'em_maos', em_maos)
      ) as variantes
    from base
    group by produto_id
  )
  select coalesce(jsonb_object_agg(produto_id::text, variantes), '{}'::jsonb) from por_produto;
$$;

create or replace function public.estoque_p_importado()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._estoque_p_importado_core(public.get_user_tenant_id());
end;
$$;

revoke execute on function public._estoque_p_importado_core(uuid) from public, anon, authenticated;
revoke execute on function public.estoque_p_importado() from public, anon;
grant execute on function public.estoque_p_importado() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) BADGE — sidebar_badges: adiciona `oc_importado_atrasada` (paridade com revenda).
--    Corpo VIVO preservado byte-a-byte; ADIÇÕES marcadas com "-- [importado]".
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sidebar_badges()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_tz text; v_hoje date;
  v_prontos int; v_alertas int; v_oc_tec int; v_oc_avi int; v_oc_etq int; v_otb int := 0;
  v_err_terc int; v_err_cq int; v_err_dir int; v_oc_pa int := 0;
  v_oc_imp int := 0;  -- [importado]
begin
  if v_tenant is null or v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    return jsonb_build_object('prontos_lancar',0,'alertas_tecido',0,'oc_tecido_atrasada',0,
                              'oc_aviamento_atrasada',0,'oc_etiqueta_atrasada',0,'otb_divergencia',0,
                              'erro_terceirizados',0,'erro_cq',0,'erro_direcionamento',0,
                              'oc_p_acabado_atrasada',0,'oc_importado_atrasada',0);  -- [importado]
  end if;

  select nullif(btrim(timezone),'') into v_tz from public.tenant_config where tenant_id = v_tenant;
  v_tz := coalesce(v_tz,'America/Sao_Paulo');
  v_hoje := (now() at time zone v_tz)::date;

  select count(*) into v_prontos from public.modelos m
  where m.tenant_id = v_tenant and coalesce(m.lancado,false) = false
    and exists (select 1 from public.cad c where c.modelo_id = m.id and c.tenant_id = v_tenant
      and public._cq_liberado(c.id)
      and not exists (select 1 from public.producao_terceirizados pt
        where pt.cad_id = c.id and coalesce(pt.interno,false) = false and coalesce(pt.aprovado,false) = false));

  select count(*) into v_alertas from public.ocs_tecido_itens it
  join public.ocs_tecido oc on oc.id = it.oc_tecido_id and oc.tenant_id = v_tenant
  where it.cq_alerta_status in ('alertado','troca_pendente');

  select count(*) into v_oc_tec from public.ocs_tecido oc
  where oc.tenant_id = v_tenant and oc.status = 'encomendado' and coalesce(oc.is_rolo,false) = false
    and oc.data_prevista_entrega is not null and oc.data_prevista_entrega < v_hoje;

  select count(*) into v_oc_avi from public.ocs_aviamento oc
  where oc.tenant_id = v_tenant and oc.status = 'encomendado'
    and oc.data_prevista_entrega is not null and oc.data_prevista_entrega < v_hoje;

  select count(*) into v_oc_etq from public.ocs_etiqueta oc
  where oc.tenant_id = v_tenant and oc.status = 'encomendado'
    and oc.data_prevista_entrega is not null and oc.data_prevista_entrega < v_hoje;

  -- #Erro por etapa — só conta modelos que estão REALMENTE na etapa (gate igual ao da lista).
  -- Serviços e CQ entram após o corte; Direcionamento após CQ liberado.
  select count(*) into v_err_terc from public.modelos m
  where m.tenant_id = v_tenant and m.revisao_pendente->>'terceirizados' = 'true'
    and exists (select 1 from public.cad c where c.modelo_id = m.id and c.enviado_corte = true);
  select count(*) into v_err_cq from public.modelos m
  where m.tenant_id = v_tenant and m.revisao_pendente->>'cq' = 'true'
    and exists (select 1 from public.cad c where c.modelo_id = m.id and c.enviado_corte = true);
  select count(*) into v_err_dir from public.modelos m
  where m.tenant_id = v_tenant and m.revisao_pendente->>'direcionamento' = 'true'
    and exists (select 1 from public.cad c where c.modelo_id = m.id and public._cq_liberado(c.id));

  if public.tenant_module_enabled('otb') then
    select count(*) into v_otb from public._otb_colecao_totais(v_tenant) t where t.realizado > t.total;
  end if;

  if public.tenant_module_enabled('produto_acabado') then
    select count(*) into v_oc_pa from public.ocs_p_acabado oc
    where oc.tenant_id = v_tenant and oc.status = 'encomendado'
      and oc.data_prevista is not null and oc.data_prevista < v_hoje;
  end if;

  -- [importado] paridade com o ramo revenda: entrega prevista vencida na OC ainda encomendada.
  if public.tenant_module_enabled('produto_importado') then
    select count(*) into v_oc_imp from public.ocs_importado oc
    where oc.tenant_id = v_tenant and oc.status = 'encomendado'
      and oc.data_prevista is not null and oc.data_prevista < v_hoje;
  end if;

  return jsonb_build_object(
    'prontos_lancar', coalesce(v_prontos,0), 'alertas_tecido', coalesce(v_alertas,0),
    'oc_tecido_atrasada', coalesce(v_oc_tec,0), 'oc_aviamento_atrasada', coalesce(v_oc_avi,0),
    'oc_etiqueta_atrasada', coalesce(v_oc_etq,0), 'otb_divergencia', coalesce(v_otb,0),
    'erro_terceirizados', coalesce(v_err_terc,0), 'erro_cq', coalesce(v_err_cq,0),
    'erro_direcionamento', coalesce(v_err_dir,0), 'oc_p_acabado_atrasada', coalesce(v_oc_pa,0),
    'oc_importado_atrasada', coalesce(v_oc_imp,0));  -- [importado]
end $function$;

revoke execute on function public.sidebar_badges() from public, anon;
grant execute on function public.sidebar_badges() to authenticated;
