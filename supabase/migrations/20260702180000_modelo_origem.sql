-- Origem do modelo: Interno (produção própria) ou Revenda. Revenda terá modificações
-- de fluxo depois; por ora é só o campo.
alter table public.modelos add column if not exists origem text not null default 'interno';
alter table public.modelos drop constraint if exists modelos_origem_check;
alter table public.modelos add constraint modelos_origem_check check (origem in ('interno','revenda'));
