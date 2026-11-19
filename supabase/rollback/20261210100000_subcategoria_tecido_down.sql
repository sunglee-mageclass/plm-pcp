-- NOTA: as linhas 'cadastro_atributos:subcat_tecido' de user_permissions/papel_permissoes (backfill da migration) FICAM:
-- sao inofensivas sem a tabela e, se a migration for reaplicada, o backfill e idempotente (ON CONFLICT DO NOTHING) -
-- assim reverter nao tira acesso de ninguem.
BEGIN;
DROP TRIGGER IF EXISTS trg_act_sub_mesma_categoria ON public.artigo_categorias_tecido;
DROP FUNCTION IF EXISTS public.fn_act_sub_mesma_categoria();
ALTER TABLE public.artigo_categorias_tecido DROP COLUMN IF EXISTS subcategoria_tecido_id;
DROP TABLE IF EXISTS public.subcategorias_tecido;
COMMIT;
