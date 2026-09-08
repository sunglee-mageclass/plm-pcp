-- Reverte a faixa-ALVO de custo na Linha (decisão do dono: Atributos > Linha é SÓ markup, custo não
-- pertence a esse cadastro). Dropa as 3 colunas de custo introduzidas em 20260908260000. Idempotente
-- (IF EXISTS). NÃO mexe em categorias_terceirizado.valor_padrao (M.O. sugerida por serviço — outra
-- feature, mantida). markup_min/max da Linha (20260907120000) seguem intactos.

BEGIN;

ALTER TABLE public.linhas
  DROP COLUMN IF EXISTS custo_min,
  DROP COLUMN IF EXISTS custo_ideal,
  DROP COLUMN IF EXISTS custo_max;

COMMIT;

select pg_notify('pgrst','reload schema');
