-- Controle de Qualidade: marca por variante se a peça foi fotografada.
-- Mapa jsonb { "<variante_numero>": true/false }. Usado no card de Lançamentos
-- (ícone de câmera quando todas as variantes do modelo estão fotografadas).
alter table public.controle_qualidade
  add column if not exists fotografado_variantes jsonb not null default '{}'::jsonb;
