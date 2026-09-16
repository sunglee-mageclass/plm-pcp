-- Fase 3 — Onda: merge de conflito colaborativo no CANVAS de Produto Importado.
-- Gêmea do canvas de Produto Acabado (20260916220000): N produtos/coleção editados juntos, merge
-- por PRODUTO (rev por linha + _rev_base no save por-produto). Trava no WRAPPER (o _core fica
-- intacto). O salvar_produto_importado tem 4 args (_id,_dados,_variantes,_etapas) — o wrapper novo
-- ganha o 5º (_rev_base). O de 4 args segue p/ retrocompat (bypass), sem ambiguidade (o wrapper
-- chama o _core com 4 args EXPLÍCITOS e o _core tem 1 só assinatura).

BEGIN;

ALTER TABLE public.produtos_importados ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_prod_importado ON public.produtos_importados;
CREATE TRIGGER trg_colab_rev_prod_importado
  BEFORE UPDATE ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

CREATE OR REPLACE FUNCTION public.salvar_produto_importado(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_rev int;
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF _rev_base IS NOT NULL AND _id IS NOT NULL THEN
    v_tenant := public.get_user_tenant_id();
    SELECT rev INTO v_rev FROM public.produtos_importados
      WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
    IF v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
  END IF;
  RETURN public._salvar_produto_importado_core(_id, _dados, _variantes, _etapas);
END;
$function$;

COMMIT;
