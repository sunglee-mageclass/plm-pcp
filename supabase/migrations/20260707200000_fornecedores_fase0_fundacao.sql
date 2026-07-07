-- FORNECEDORES — FASE 0: fundação aditiva do modelo Empresa(material|servico) + Representante.
-- Revisada após review do time (data-engineer, security-auditor, domain-plm-pcp).
-- 100% ADITIVA e invisível pro usuário: nenhum comportamento muda. Nada é dropado; reversível.
-- Ver docs/superpowers/plans/2026-07-07-fornecedores-empresa-servico-representante.md

-- 1) empresas.tipo — 'material' (fornece tecido/aviamento) | 'servico' (presta serviço).
--    Default 'material': as empresas de hoje são todas fornecedores de material.
alter table public.empresas add column if not exists tipo text not null default 'material';
alter table public.empresas drop constraint if exists empresas_tipo_check;
alter table public.empresas add constraint empresas_tipo_check check (tipo in ('material','servico'));

-- 2) empresas ganha campos FISCAIS (CNPJ + dados) — hoje a empresa só tem nome_fantasia; o CNPJ
--    vivia só no representante. Na nova visão a empresa tem CNPJ próprio e é quem recebe no
--    financeiro (quando não há rep). Espelha os campos de `representantes`. Tudo NULL → aditivo.
alter table public.empresas
  add column if not exists cnpj text,
  add column if not exists razao_social text,
  add column if not exists situacao_cadastral text,
  add column if not exists telefone text,
  add column if not exists email text,
  add column if not exists logradouro text,
  add column if not exists cep text,
  add column if not exists municipio text,
  add column if not exists uf text,
  add column if not exists contato text,
  add column if not exists observacoes text;

-- 3) empresa_categorias_servico — categorias de serviço (com etapa pré/pós) por empresa.
--    Espelha empresa_categorias_fornecedor: RLS via empresa + tenant por trigger; FKs CASCADE.
create table if not exists public.empresa_categorias_servico (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  categoria_terceirizado_id uuid not null references public.categorias_terceirizado(id) on delete cascade,
  tenant_id uuid,
  created_at timestamptz default now(),
  primary key (empresa_id, categoria_terceirizado_id)
);

create or replace function public.set_emp_cat_serv_tenant()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.tenant_id is null then
    select tenant_id into NEW.tenant_id from public.empresas where id = NEW.empresa_id;
  end if;
  return NEW;
end $$;
revoke execute on function public.set_emp_cat_serv_tenant() from public, anon, authenticated;

drop trigger if exists trg_set_emp_cat_serv_tenant on public.empresa_categorias_servico;
create trigger trg_set_emp_cat_serv_tenant before insert on public.empresa_categorias_servico
  for each row execute function public.set_emp_cat_serv_tenant();

alter table public.empresa_categorias_servico enable row level security;

drop policy if exists tenant_select_emp_cat_serv on public.empresa_categorias_servico;
create policy tenant_select_emp_cat_serv on public.empresa_categorias_servico for select to authenticated
  using (exists (select 1 from public.empresas e where e.id = empresa_categorias_servico.empresa_id and e.tenant_id = public.get_user_tenant_id()));
drop policy if exists tenant_insert_emp_cat_serv on public.empresa_categorias_servico;
create policy tenant_insert_emp_cat_serv on public.empresa_categorias_servico for insert to authenticated
  with check (exists (select 1 from public.empresas e where e.id = empresa_categorias_servico.empresa_id and e.tenant_id = public.get_user_tenant_id()));
drop policy if exists tenant_update_emp_cat_serv on public.empresa_categorias_servico;
create policy tenant_update_emp_cat_serv on public.empresa_categorias_servico for update to authenticated
  using (exists (select 1 from public.empresas e where e.id = empresa_categorias_servico.empresa_id and e.tenant_id = public.get_user_tenant_id()))
  with check (exists (select 1 from public.empresas e where e.id = empresa_categorias_servico.empresa_id and e.tenant_id = public.get_user_tenant_id()));
drop policy if exists tenant_delete_emp_cat_serv on public.empresa_categorias_servico;
create policy tenant_delete_emp_cat_serv on public.empresa_categorias_servico for delete to authenticated
  using (exists (select 1 from public.empresas e where e.id = empresa_categorias_servico.empresa_id and e.tenant_id = public.get_user_tenant_id()));

-- 4) representante_id (opcional) só onde a seleção acontece de fato:
--    ocs_tecido, ocs_aviamento (OC de material) e producao_terceirizados (serviço, inclui oficina).
--    NÃO em `parcelas` (o payee de OC sai por join com a OC) nem em `producao_oficina` (tabela
--    MORTA: 0 linhas, fora do menu; a oficina viva roda em producao_terceirizados cat "Oficina").
--    FK NO ACTION: não apaga rep em uso em silêncio (F2 põe guarda amigável). Nasce NULL.
alter table public.ocs_tecido             add column if not exists representante_id uuid references public.representantes(id);
alter table public.ocs_aviamento          add column if not exists representante_id uuid references public.representantes(id);
alter table public.producao_terceirizados add column if not exists representante_id uuid references public.representantes(id);

-- 5) Trava de MESMO TENANT do representante (defesa em profundidade, no banco — não só na RPC da
--    F3): impede vincular um representante de OUTRA loja (a FK sozinha não garante o tenant).
create or replace function public.enforce_representante_tenant()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_rep_tenant uuid;
begin
  if NEW.representante_id is not null then
    select tenant_id into v_rep_tenant from public.representantes where id = NEW.representante_id;
    if v_rep_tenant is distinct from NEW.tenant_id then
      raise exception 'Representante de outra loja não pode ser vinculado aqui.';
    end if;
  end if;
  return NEW;
end $$;
revoke execute on function public.enforce_representante_tenant() from public, anon, authenticated;

drop trigger if exists trg_repr_tenant on public.ocs_tecido;
create trigger trg_repr_tenant before insert or update of representante_id on public.ocs_tecido
  for each row execute function public.enforce_representante_tenant();
drop trigger if exists trg_repr_tenant on public.ocs_aviamento;
create trigger trg_repr_tenant before insert or update of representante_id on public.ocs_aviamento
  for each row execute function public.enforce_representante_tenant();
drop trigger if exists trg_repr_tenant on public.producao_terceirizados;
create trigger trg_repr_tenant before insert or update of representante_id on public.producao_terceirizados
  for each row execute function public.enforce_representante_tenant();

select pg_notify('pgrst', 'reload schema');
