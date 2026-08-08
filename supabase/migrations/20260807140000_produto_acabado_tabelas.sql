-- Produto Acabado (Revenda) — Task 1/8: tabelas-base, RLS, códigos automáticos, vínculo único.
-- Idempotente (guards IF EXISTS/IF NOT EXISTS) para poder reaplicar.

-- Tabelas ------------------------------------------------------------
create table if not exists public.produtos_acabados (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  modelo_id uuid references public.modelos(id) on delete set null, -- espelho (1:1 via trigger)
  nome varchar(200) not null,
  ref text,                          -- gerada por trigger na criação
  grupo_id uuid references public.grupos_produto(id),
  categoria_id uuid references public.categorias_produto(id),
  subcategoria1_id uuid references public.subcategorias1_produto(id),
  subcategoria2_id uuid references public.subcategorias2_produto(id),
  colecao_id uuid references public.colecoes(id),
  subcolecao text,
  semana varchar(50),
  empresa_id uuid references public.empresas(id),
  representante_id uuid references public.representantes(id),
  ref_fornecedor varchar(120),
  composicao text,
  grade_proporcao jsonb not null default '{}'::jsonb, -- {"38":1,"40":1,...} peso por size-key; acessório = {}
  qtd_total integer not null default 0,
  valor_unitario numeric(12,2) not null default 0,
  desconto_pct numeric(6,2) not null default 0,
  insumos_total numeric(12,2) not null default 0,     -- Σ BOM (derivado, cache p/ card)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.produto_acabado_variantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_acabado_id uuid not null references public.produtos_acabados(id) on delete cascade,
  ordem integer not null,
  cor_id uuid references public.cores(id),
  cor_apelido_id uuid references public.cores_apelido(id),
  peso numeric(8,2) not null default 0,
  qtd integer not null default 0,
  unique (produto_acabado_id, ordem)
);
create table if not exists public.ocs_p_acabado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  produto_acabado_id uuid references public.produtos_acabados(id) on delete set null,
  numero text,                       -- AUTO por trigger
  nome_produto varchar(200) not null,
  grupo_id uuid references public.grupos_produto(id),
  categoria_id uuid references public.categorias_produto(id),
  subcategoria1_id uuid references public.subcategorias1_produto(id),
  subcategoria2_id uuid references public.subcategorias2_produto(id),
  empresa_id uuid references public.empresas(id),
  representante_id uuid references public.representantes(id),
  ref_fornecedor varchar(120),
  composicao text,
  data_pedido date not null default current_date,
  data_prevista date,
  data_entrega date,
  prazo_pagamento text not null default '30',   -- "30/60/90"
  parcelas_entrega integer not null default 1,
  grade_proporcao jsonb not null default '{}'::jsonb,
  grade_detalhe jsonb not null default '{}'::jsonb, -- {"<ordem>":{"<tam>":{"pedida":n,"recebida":n,"defeito":n}}}
  variantes jsonb not null default '[]'::jsonb,     -- [{ordem,cor_id,cor_apelido_id,peso,qtd}] snapshot da OC
  qtd_total integer not null default 0,
  valor_unitario numeric(12,2) not null default 0,
  desconto_pct numeric(6,2) not null default 0,
  valor_bruto numeric(14,2) not null default 0,       -- derivados no servidor
  valor_total_desconto numeric(14,2) not null default 0,
  valor_unitario_real numeric(12,2) not null default 0,
  nota_fiscal varchar(120),
  responsavel_recebimento_id uuid references public.colaboradores(id),
  devolucao text,
  revisao text,
  status text not null default 'encomendado' check (status in ('encomendado','recebido')),
  anexo_pedido_url text,
  anexo_nf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS padrão por tenant (espelha ocs_tecido: select/insert/update/delete com tenant_id = get_user_tenant_id())
alter table public.produtos_acabados enable row level security;
alter table public.produto_acabado_variantes enable row level security;
alter table public.ocs_p_acabado enable row level security;

drop policy if exists tenant_select on public.produtos_acabados;
drop policy if exists tenant_insert on public.produtos_acabados;
drop policy if exists tenant_update on public.produtos_acabados;
drop policy if exists tenant_delete on public.produtos_acabados;
create policy tenant_select on public.produtos_acabados for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.produtos_acabados for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.produtos_acabados for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.produtos_acabados for delete to authenticated
  using (tenant_id = get_user_tenant_id());

drop policy if exists tenant_select on public.produto_acabado_variantes;
drop policy if exists tenant_insert on public.produto_acabado_variantes;
drop policy if exists tenant_update on public.produto_acabado_variantes;
drop policy if exists tenant_delete on public.produto_acabado_variantes;
create policy tenant_select on public.produto_acabado_variantes for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.produto_acabado_variantes for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.produto_acabado_variantes for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.produto_acabado_variantes for delete to authenticated
  using (tenant_id = get_user_tenant_id());

drop policy if exists tenant_select on public.ocs_p_acabado;
drop policy if exists tenant_insert on public.ocs_p_acabado;
drop policy if exists tenant_update on public.ocs_p_acabado;
drop policy if exists tenant_delete on public.ocs_p_acabado;
create policy tenant_select on public.ocs_p_acabado for select to authenticated
  using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.ocs_p_acabado for insert to authenticated
  with check (tenant_id = get_user_tenant_id());
create policy tenant_update on public.ocs_p_acabado for update to authenticated
  using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.ocs_p_acabado for delete to authenticated
  using (tenant_id = get_user_tenant_id());

-- tenant_id automático (padrão universal do sistema — toda tabela de negócio tem este
-- trigger; sem ele, INSERT sem tenant_id explícito violaria o NOT NULL, e é assim que o
-- front chama .insert() em todo o resto do app). Nome do trigger com prefixo "set_" para
-- ordenar (alfabético) ANTES dos demais BEFORE INSERT ("trg_...") na mesma tabela.
drop trigger if exists set_tenant_id_trg on public.produtos_acabados;
create trigger set_tenant_id_trg before insert on public.produtos_acabados
  for each row execute function public.set_tenant_id();
drop trigger if exists set_tenant_id_trg on public.produto_acabado_variantes;
create trigger set_tenant_id_trg before insert on public.produto_acabado_variantes
  for each row execute function public.set_tenant_id();
drop trigger if exists set_tenant_id_trg on public.ocs_p_acabado;
create trigger set_tenant_id_trg before insert on public.ocs_p_acabado
  for each row execute function public.set_tenant_id();

-- 1:1 produto→modelo (NUNCA UNIQUE em coluna embedada)
drop trigger if exists trg_pa_unique_modelo on public.produtos_acabados;
create trigger trg_pa_unique_modelo
  before insert or update of modelo_id on public.produtos_acabados
  for each row execute function public.enforce_unique_fk('modelo_id');
create index if not exists idx_pa_modelo on public.produtos_acabados(modelo_id);
create index if not exists idx_ocpa_produto on public.ocs_p_acabado(produto_acabado_id);

-- Helpers de código ---------------------------------------------------
create or replace function public._grupo_eh_acessorio(_grupo_id uuid) returns boolean
language sql stable as $$
  select coalesce((select lower(translate(nome,'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc')) like '%acessor%'
                   from public.grupos_produto where id = _grupo_id), false);
$$;
create or replace function public._norm3(_s text) returns text
language sql immutable as $$
  select upper(substr(regexp_replace(translate(coalesce(_s,''),'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),'[^A-Za-z]','','g'),1,3));
$$;
-- REF do produto: sigla + 7 dígitos por tenant (advisory lock próprio)
create or replace function public._produto_acabado_ref_next(_tenant uuid) returns bigint
language plpgsql as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtext('modelo_ref_rev:'||_tenant::text));
  select coalesce(max((substring(ref from '([0-9]{7})$'))::bigint),0)+1 into v
    from public.produtos_acabados where tenant_id=_tenant and ref ~ '[0-9]{7}$';
  return v;
end $$;
create or replace function public.fn_produto_acabado_ref() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_sig text;
begin
  if new.ref is not null and new.ref <> '' then return new; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then
    v_sig := public._norm3((select nome from grupos_produto where id=new.grupo_id));
    v_sig := substr(v_sig,1,2) || public._norm3((select nome from categorias_produto where id=new.categoria_id)); -- 2 grupo + 3 categoria
  else
    v_sig := substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,2)
          || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,1)
          || substr(public._norm3((select nome from subcategorias1_produto where id=new.subcategoria1_id)),1,2);
  end if;
  new.ref := v_sig || lpad(public._produto_acabado_ref_next(new.tenant_id)::text, 7, '0');
  return new;
end $$;
drop trigger if exists trg_pa_ref on public.produtos_acabados;
create trigger trg_pa_ref before insert on public.produtos_acabados
  for each row execute function public.fn_produto_acabado_ref();

-- Nº da OC: 3 fornecedor + (1 grupo + 2 categoria | 'ACE') + '-' + 5 díg por sigla (padrão fn_aviamento_codigo, MAX+1 regex)
-- NOTA: empresas não tem coluna "nome" (é "nome_fantasia") — corrigido em relação ao brief.
create or replace function public.fn_oc_p_acabado_numero() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome_fantasia from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_p_acabado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
  return new;
end $$;
drop trigger if exists trg_ocpa_numero on public.ocs_p_acabado;
create trigger trg_ocpa_numero before insert on public.ocs_p_acabado
  for each row execute function public.fn_oc_p_acabado_numero();

-- Vínculo único (1 OC ativa por produto)
create or replace function public.enforce_oc_pa_vinculo_unico() returns trigger
language plpgsql as $$
declare v_num text;
begin
  if new.produto_acabado_id is null then return new; end if;
  select numero into v_num from public.ocs_p_acabado
   where produto_acabado_id = new.produto_acabado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_ocpa_vinculo_unico on public.ocs_p_acabado;
create trigger trg_ocpa_vinculo_unico before insert or update of produto_acabado_id on public.ocs_p_acabado
  for each row execute function public.enforce_oc_pa_vinculo_unico();

revoke execute on function public._grupo_eh_acessorio(uuid) from public, anon, authenticated;
revoke execute on function public._norm3(text) from public, anon, authenticated;
revoke execute on function public._produto_acabado_ref_next(uuid) from public, anon, authenticated;
