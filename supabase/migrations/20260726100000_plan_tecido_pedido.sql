-- 20260726100000_plan_tecido_pedido.sql — Fase B: vínculo plano↔OC + prévia do pedido.
-- Déficit = necessidade (só produtos "encomenda", SEM perda) − estoque PREVISTO (travado ≥0),
-- por fornecedor→tecido→variante. Arredonda p/ cima: metro→dezena 0; kg→múltiplo de 5.
begin;

-- vínculo plano/coleção ↔ OC gerada (p/ badge de status e desfazer)
create table if not exists public.plan_tecido_ocs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  oc_tecido_id uuid not null references public.ocs_tecido(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_plan_tecido_oc unique (colecao_id, oc_tecido_id)
);
create index if not exists idx_plan_tecido_ocs_colecao on public.plan_tecido_ocs(colecao_id);
create index if not exists idx_plan_tecido_ocs_oc on public.plan_tecido_ocs(oc_tecido_id);

do $$ begin
  execute 'alter table public.plan_tecido_ocs enable row level security';
  execute 'drop policy if exists tenant_select on public.plan_tecido_ocs';
  execute 'create policy tenant_select on public.plan_tecido_ocs for select to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'drop policy if exists tenant_insert on public.plan_tecido_ocs';
  execute 'create policy tenant_insert on public.plan_tecido_ocs for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)';
  execute 'drop policy if exists tenant_update on public.plan_tecido_ocs';
  execute 'create policy tenant_update on public.plan_tecido_ocs for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id())';
  execute 'drop policy if exists tenant_delete on public.plan_tecido_ocs';
  execute 'create policy tenant_delete on public.plan_tecido_ocs for delete to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'grant all on public.plan_tecido_ocs to anon, authenticated, service_role';
  execute 'create or replace trigger set_tenant_id_trg before insert on public.plan_tecido_ocs for each row execute function public.set_tenant_id()';
end $$;

-- PRÉVIA do pedido (read-only)
create or replace function public._plan_tecido_previa_pedido_core(_tenant uuid, _colecao_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_res jsonb;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;

  with slot_tec1 as (  -- grade total do Tecido 1 por slot (base de peças do forro)
    select sl.id as slot_id, sum(coalesce(vv.grade_total,0)) as tec1_total
    from plan_tecido p
    join plan_tecido_subcolecoes s on s.plan_id = p.id
    join plan_tecido_linhas l on l.sub_id = s.id
    join plan_tecido_slots sl on sl.linha_ref_id = l.id
    join plan_tecido_materiais mt on mt.slot_id = sl.id and mt.tipo = 'tecido' and mt.numero = 1
    join plan_tecido_variantes vv on vv.material_id = mt.id
    where p.colecao_id = _colecao_id and p.tenant_id = _tenant
    group by sl.id
  ),
  necessidade as (  -- só slots ENCOMENDA (usar_estoque=false); SEM perda
    select mt.artigo_id, vv.variante_tecido_id,
           sum(coalesce(mt.consumo,0)
               * (case when mt.tipo = 'forro' then coalesce(st.tec1_total,0) else coalesce(vv.grade_total,0) end)
               * coalesce(vv.multiplicador,1)) as nec_m
    from plan_tecido p
    join plan_tecido_subcolecoes s on s.plan_id = p.id
    join plan_tecido_linhas l on l.sub_id = s.id
    join plan_tecido_slots sl on sl.linha_ref_id = l.id and coalesce(sl.usar_estoque,false) = false
    join plan_tecido_materiais mt on mt.slot_id = sl.id
    join plan_tecido_variantes vv on vv.material_id = mt.id
    left join slot_tec1 st on st.slot_id = sl.id
    where p.colecao_id = _colecao_id and p.tenant_id = _tenant
      and mt.artigo_id is not null and vv.variante_tecido_id is not null
    group by mt.artigo_id, vv.variante_tecido_id
  ),
  est as ( select variante_tecido_id, previsto from public._estoque_tecido_core(_tenant) ),
  base as (
    select n.artigo_id, n.variante_tecido_id, n.nec_m,
           greatest(0, coalesce(e.previsto,0)) as estoque_m,
           round(greatest(0, n.nec_m - greatest(0, coalesce(e.previsto,0)))::numeric, 4) as deficit_m,
           a.nome as artigo_nome, a.unidade_medida, a.rendimento, a.empresa_id, a.representante_id,
           concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome) as label,
           coalesce(vt.preco, a.preco, 0) as preco
    from necessidade n
    join artigos a on a.id = n.artigo_id
    left join variantes_tecido vt on vt.id = n.variante_tecido_id
    left join cores cor on cor.id = vt.cor_id
    left join cores_apelido ap on ap.id = vt.cor_apelido_id
    left join est e on e.variante_tecido_id = n.variante_tecido_id
  ),
  calc as (
    select *,
      case when deficit_m <= 0 then 0
           when unidade_medida = 'kg' then
             case when coalesce(rendimento,0) > 0 then ceil((deficit_m / rendimento) / 5.0) * 5 else null end
           else ceil(deficit_m / 10.0) * 10 end as qtd
    from base
  )
  select jsonb_build_object(
    'fornecedores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'empresa_id', emp_id, 'representante_id', rep_id,
        'empresa_nome', emp_nome, 'representante_nome', rep_nome,
        'itens', itens) order by emp_nome)
      from (
        select c.empresa_id as emp_id, c.representante_id as rep_id,
               e.nome_fantasia as emp_nome, r.nome as rep_nome,
               jsonb_agg(jsonb_build_object(
                 'artigo_id', c.artigo_id, 'artigo_nome', c.artigo_nome,
                 'unidade_medida', c.unidade_medida, 'rendimento', c.rendimento,
                 'variante_tecido_id', c.variante_tecido_id, 'label', c.label,
                 'necessidade_m', c.nec_m, 'estoque_m', c.estoque_m, 'deficit_m', c.deficit_m,
                 'qtd', c.qtd, 'unidade', coalesce(c.unidade_medida,'metro'), 'preco', c.preco)
                 order by c.artigo_nome, c.label) as itens
        from calc c
        left join empresas e on e.id = c.empresa_id
        left join representantes r on r.id = c.representante_id
        where c.empresa_id is not null and c.deficit_m > 0
        group by c.empresa_id, c.representante_id, e.nome_fantasia, r.nome
      ) f), '[]'::jsonb),
    'sem_fornecedor', coalesce((
      select jsonb_agg(distinct jsonb_build_object('artigo_id', c.artigo_id, 'artigo_nome', c.artigo_nome))
      from calc c where c.empresa_id is null and c.deficit_m > 0), '[]'::jsonb),
    'bloqueios', coalesce((
      select jsonb_agg(distinct jsonb_build_object('artigo_nome', c.artigo_nome, 'motivo', 'Artigo em kg sem rendimento cadastrado'))
      from calc c where c.unidade_medida = 'kg' and coalesce(c.rendimento,0) <= 0 and c.deficit_m > 0), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

create or replace function public.plan_tecido_previa_pedido(_colecao_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_previa_pedido_core(public.get_user_tenant_id(), _colecao_id);
end $$;

revoke execute on function public._plan_tecido_previa_pedido_core(uuid,uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_previa_pedido(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
