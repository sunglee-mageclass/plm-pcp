BEGIN;
DROP TRIGGER IF EXISTS trg_act_sub_mesma_categoria ON public.artigo_categorias_tecido;
DROP FUNCTION IF EXISTS public.fn_act_sub_mesma_categoria();
ALTER TABLE public.artigo_categorias_tecido DROP COLUMN IF EXISTS subcategoria_tecido_id;
DROP TABLE IF EXISTS public.subcategorias_tecido;
COMMIT;
