-- Cascata de requisitos do Kanban (set/2026): coluna de EXCEÇÕES por etapa.
-- `kanban_requisitos_excecoes` = { status_key: [chave_condicao_herdada_desligada] }. Vazio/ausente
-- = cascata pura (cada etapa herda os requisitos das anteriores na ordem do board). Uma exceção é
-- um requisito HERDADO que o admin desligou naquela etapa (com alerta) — a etapa de origem segue
-- exigindo. Espelha o shape de `kanban_requisitos` (jsonb, default {}). Aditivo, idempotente.

ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS kanban_requisitos_excecoes jsonb NOT NULL DEFAULT '{}'::jsonb;
