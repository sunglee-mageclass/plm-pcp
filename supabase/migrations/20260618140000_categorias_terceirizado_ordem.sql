-- Ordenação manual (drag-n-drop) das categorias de Serviços (terceirizados).
alter table public.categorias_terceirizado
  add column if not exists ordem integer not null default 0;

-- Backfill: ordem inicial = ordem alfabética atual, por tenant.
with ranked as (
  select id, (row_number() over (partition by tenant_id order by nome) - 1) as rn
  from public.categorias_terceirizado
)
update public.categorias_terceirizado c
set ordem = r.rn
from ranked r
where r.id = c.id;
