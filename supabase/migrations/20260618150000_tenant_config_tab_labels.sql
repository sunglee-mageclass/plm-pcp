-- Rótulos customizados das abas (módulos e páginas) do menu, por loja.
-- Chave = module key ou page key (do PAGES_CATALOG); valor = nome customizado.
alter table public.tenant_config
  add column if not exists tab_labels jsonb not null default '{}'::jsonb;
