-- Subcoleção: texto livre (digitável) no modelo, ao lado da coleção.
-- Aparece em Planejamento e Desenvolvimento; entra nos filtros. Aditivo.
alter table public.modelos add column if not exists subcolecao text;

select pg_notify('pgrst','reload schema');
