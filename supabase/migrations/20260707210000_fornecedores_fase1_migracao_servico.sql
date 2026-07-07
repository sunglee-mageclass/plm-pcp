-- FORNECEDORES — FASE 1: migração serviço→empresa (expand/migrate/contract).
-- Cada `terceirizados` vira uma `empresas` tipo servico; as categorias do serviço migram para
-- `empresa_categorias_servico`; `producao_terceirizados` ganha `empresa_id` (backfill), MANTENDO
-- `terceirizado_id` em paralelo (dual) até a F5. Idempotente (re-runnable). Nada é apagado.
-- Ver docs/superpowers/plans/2026-07-07-fornecedores-*.

-- 1) Coluna de PROVENIÊNCIA/mapa: de qual terceirizado a empresa veio. uuid simples (sem FK, pois
--    terceirizados será dropado na F5). Também marca quais empresas nasceram da migração.
alter table public.empresas add column if not exists origem_terceirizado_id uuid;
-- unique parcial: 1 empresa por terceirizado (idempotência forte) + acelera os joins do backfill.
create unique index if not exists uq_empresas_origem_terc
  on public.empresas (origem_terceirizado_id) where origem_terceirizado_id is not null;

-- 2) empresa_id em producao_terceirizados (o serviço passa a apontar pra empresa). Dual com
--    terceirizado_id até F5. FK NO ACTION. Índice pro FK/join (leituras de serviço na F3+).
alter table public.producao_terceirizados add column if not exists empresa_id uuid references public.empresas(id);
create index if not exists idx_prod_terc_empresa on public.producao_terceirizados (empresa_id);

-- 3) Guarda tipo↔categoria (material XOR servico vale no BANCO, não só na UI):
--    empresa_categorias_servico só p/ empresa tipo servico; empresa_categorias_fornecedor só material.
create or replace function public.enforce_empresa_cat_tipo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_tipo text; v_expect text;
begin
  select tipo into v_tipo from public.empresas where id = NEW.empresa_id;
  v_expect := case TG_TABLE_NAME when 'empresa_categorias_servico' then 'servico' else 'material' end;
  if v_tipo is distinct from v_expect then
    raise exception 'Categoria incompatível: empresa é tipo % mas a tabela % exige %.', coalesce(v_tipo,'?'), TG_TABLE_NAME, v_expect;
  end if;
  return NEW;
end $$;
revoke execute on function public.enforce_empresa_cat_tipo() from public, anon, authenticated;

-- só BEFORE INSERT (as categorias são gravadas por delete+insert, nunca UPDATE na junção).
drop trigger if exists trg_emp_cat_tipo on public.empresa_categorias_servico;
create trigger trg_emp_cat_tipo before insert on public.empresa_categorias_servico
  for each row execute function public.enforce_empresa_cat_tipo();
drop trigger if exists trg_emp_cat_tipo on public.empresa_categorias_fornecedor;
create trigger trg_emp_cat_tipo before insert on public.empresa_categorias_fornecedor
  for each row execute function public.enforce_empresa_cat_tipo();

-- 4) Criar empresas (tipo servico) a partir dos terceirizados ainda não migrados.
--    Só há nome_responsavel pra copiar (terceirizados não tem CNPJ); fiscais o dono preenche na F2.
insert into public.empresas (tenant_id, nome_fantasia, tipo, origem_terceirizado_id)
select t.tenant_id, t.nome_responsavel, 'servico', t.id
from public.terceirizados t
where not exists (select 1 from public.empresas e where e.origem_terceirizado_id = t.id);

-- 5) Migrar categorias do serviço: terceirizado_categorias -> empresa_categorias_servico.
insert into public.empresa_categorias_servico (empresa_id, categoria_terceirizado_id, tenant_id)
select e.id, tc.categoria_terceirizado_id, e.tenant_id
from public.terceirizado_categorias tc
join public.empresas e on e.origem_terceirizado_id = tc.terceirizado_id
on conflict (empresa_id, categoria_terceirizado_id) do nothing;

-- 6) Backfill producao_terceirizados.empresa_id via o mapa. terceirizado_id NULL (serviço interno/PL,
--    sem terceiro) fica com empresa_id NULL — correto.
update public.producao_terceirizados pt
set empresa_id = e.id
from public.empresas e
where e.origem_terceirizado_id = pt.terceirizado_id and pt.empresa_id is null;

select pg_notify('pgrst', 'reload schema');
