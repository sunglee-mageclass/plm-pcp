-- rolo_origem_item_id é apenas informativo. O FK para ocs_tecido_itens criava um
-- 2º relacionamento entre ocs_tecido e ocs_tecido_itens, tornando os embeds do
-- PostgREST ambíguos ("more than one relationship"). Remove o FK, mantém a coluna.
ALTER TABLE public.ocs_tecido DROP CONSTRAINT IF EXISTS ocs_tecido_rolo_origem_item_id_fkey;
