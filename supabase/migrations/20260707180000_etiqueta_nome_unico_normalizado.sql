-- Etiqueta: nome único por loja, agora normalizado (minúsculo + sem espaços nas pontas) — evita
-- "Etiqueta X", "etiqueta x" e "Etiqueta X " entrarem como se fossem diferentes. Troca a unique
-- exata (tenant_id, nome) por uma sobre lower(trim(nome)). (0 duplicatas hoje sob a chave nova.)
-- drop tanto de constraint quanto de index (o nome ..._key pode ser um ou outro) — if exists nos dois.
alter table public.etiquetas drop constraint if exists etiquetas_tenant_id_nome_key;
drop index if exists public.etiquetas_tenant_id_nome_key;

create unique index if not exists uq_etiquetas_tenant_nome
  on public.etiquetas (tenant_id, lower(trim(nome)));

select pg_notify('pgrst', 'reload schema');
