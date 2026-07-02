-- Requisitos de entrada por status do kanban (motor de regras). Mapa
-- { status_key: ["chave_condicao", ...] } — chaves do catálogo src/lib/kanban-condicoes.ts.
alter table public.tenant_config
  add column if not exists kanban_requisitos jsonb not null default '{}'::jsonb;
