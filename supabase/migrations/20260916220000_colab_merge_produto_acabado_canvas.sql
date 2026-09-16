-- Fase 3 — Onda: merge de conflito colaborativo no CANVAS de Produto Acabado (ProdutoAcabadoSheet).
--
-- A tela edita N produtos de uma coleção de uma vez (um card por produto), hoje só com ring de
-- presença. Molde = Direcionamento (N linhas por âncora) / merge por id: cada PRODUTO tem seu `rev`
-- e o save por-produto (`salvar_produto_acabado`, chamado 1×/produto num Promise.all) manda o
-- `_rev_base` daquele produto → P0409 se alguém salvou aquele card no meio.
--
-- Decisão: a trava vai no WRAPPER (que já valida o módulo), NÃO no `_core` — evita recriar as ~200
-- linhas do `_salvar_produto_acabado_core` (menos risco). O wrapper novo de 4 args faz o rev-check
-- `FOR UPDATE` + P0409 e delega ao `_core` intacto. O `_core` NÃO muda.
--
-- ⚠️ LIÇÃO do overload ambíguo (fix 20260916170000): ao criar o wrapper de 4 args com `_rev_base`,
-- o de 3 args continua existindo p/ retrocompat — mas NÃO há ambiguidade aqui porque o wrapper
-- chama o `_core` com 3 args EXPLÍCITOS (não N args variádicos) e o `_core` tem só 1 assinatura.

BEGIN;

-- ── rev na tabela + trigger de bump (genérico) ────────────────────────────────
ALTER TABLE public.produtos_acabados ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_prod_acabado ON public.produtos_acabados;
CREATE TRIGGER trg_colab_rev_prod_acabado
  BEFORE UPDATE ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- ── Wrapper novo de 4 args: rev-check (P0409) + delega ao _core intacto ────────
CREATE OR REPLACE FUNCTION public.salvar_produto_acabado(_id uuid, _dados jsonb, _variantes jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_rev int;
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- trava otimista (Fase 3): P0409 se outra pessoa salvou ESTE produto no meio. _rev_base null OU
  -- _id null (criação) = bypass. Bloqueia a linha p/ serializar com o UPDATE do _core.
  IF _rev_base IS NOT NULL AND _id IS NOT NULL THEN
    v_tenant := public.get_user_tenant_id();
    SELECT rev INTO v_rev FROM public.produtos_acabados
      WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
    IF v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
  END IF;
  RETURN public._salvar_produto_acabado_core(_id, _dados, _variantes);
END;
$function$;

COMMIT;
