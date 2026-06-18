-- Controle de Qualidade: status de confirmação.
-- Padrão "pendente"; muda para "confirmado" ao Confirmar o Controle de Qualidade.
-- Só quando confirmado o modelo segue para o Direcionamento (e a Grade Real é
-- gravada em cad_grades.grades_reais).
alter table public.controle_qualidade
  add column if not exists status text not null default 'pendente',
  add column if not exists confirmado_at timestamptz;
