-- Fluxo de Revenda configurável por loja (módulo opt-in produto_acabado, ago/2026).
-- 3 chaves em tenant_config que dão à Revenda (modelos origem='revenda') um kanban/
-- campos-visíveis próprios, diferentes do fluxo manufaturado. Mesmo padrão jsonb de
-- kanban_requisitos/pcp_etapas — colunas típicas, não um blob único (o upsert do save
-- em admin/configuracoes.tsx grava por coluna). Ver invariante #13 + src/lib/revenda-config.ts.
alter table public.tenant_config
  -- KEYS de colunas do kanban permitidas p/ revenda. [] = todas (sem trava por omissão).
  add column if not exists revenda_kanban_colunas jsonb not null default '[]'::jsonb,
  -- Requisitos por coluna { colKey: ["chave_condicao", ...] } — keys de kanban-condicoes.ts.
  add column if not exists revenda_kanban_requisitos jsonb not null default '{}'::jsonb,
  -- Campo/seção key → visível p/ revenda { key: boolean }. Ausência = default do helper.
  add column if not exists revenda_campos jsonb not null default '{}'::jsonb;
