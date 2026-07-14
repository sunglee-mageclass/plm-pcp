-- Produto Relacionado: conjunto de modelos vendidos juntos. conjunto_id compartilhado
-- (mesmos = mesmo conjunto, simétrico). RPCs atômicas cuidam de criar/mover/dissolver.
BEGIN;

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS conjunto_id uuid;
CREATE INDEX IF NOT EXISTS idx_modelos_conjunto ON public.modelos(conjunto_id) WHERE conjunto_id IS NOT NULL;

-- Adiciona _add_id ao conjunto de _modelo_id (cria o conjunto se _modelo_id não tem).
-- Se _add_id já estava noutro conjunto, sai dele; se o antigo ficou com 1, dissolve.
CREATE OR REPLACE FUNCTION public.conjunto_adicionar(_modelo_id uuid, _add_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_target uuid; v_old uuid; v_a_tenant uuid; v_b_tenant uuid;
BEGIN
  IF _modelo_id = _add_id THEN
    RAISE EXCEPTION 'Não é possível relacionar um produto a ele mesmo.';
  END IF;
  v_tenant := get_user_tenant_id();
  SELECT tenant_id, conjunto_id INTO v_a_tenant, v_target FROM public.modelos WHERE id = _modelo_id;
  SELECT tenant_id, conjunto_id INTO v_b_tenant, v_old FROM public.modelos WHERE id = _add_id;
  IF v_a_tenant IS NULL OR v_b_tenant IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.';
  END IF;
  IF v_a_tenant <> v_tenant OR v_b_tenant <> v_tenant THEN
    RAISE EXCEPTION 'Produto de outra loja.';
  END IF;
  IF v_target IS NULL THEN
    v_target := gen_random_uuid();
    UPDATE public.modelos SET conjunto_id = v_target WHERE id = _modelo_id;
  END IF;
  UPDATE public.modelos SET conjunto_id = v_target WHERE id = _add_id;
  IF v_old IS NOT NULL AND v_old <> v_target THEN
    UPDATE public.modelos SET conjunto_id = NULL
    WHERE conjunto_id = v_old
      AND (SELECT count(*) FROM public.modelos WHERE conjunto_id = v_old) = 1;
  END IF;
  RETURN v_target;
END; $$;

-- Remove _modelo_id do seu conjunto; se o conjunto ficou com 1, dissolve.
CREATE OR REPLACE FUNCTION public.conjunto_remover(_modelo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_old uuid; v_mt uuid;
BEGIN
  v_tenant := get_user_tenant_id();
  SELECT tenant_id, conjunto_id INTO v_mt, v_old FROM public.modelos WHERE id = _modelo_id;
  IF v_mt IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  IF v_mt <> v_tenant THEN RAISE EXCEPTION 'Produto de outra loja.'; END IF;
  IF v_old IS NULL THEN RETURN; END IF;
  UPDATE public.modelos SET conjunto_id = NULL WHERE id = _modelo_id;
  UPDATE public.modelos SET conjunto_id = NULL
  WHERE conjunto_id = v_old
    AND (SELECT count(*) FROM public.modelos WHERE conjunto_id = v_old) = 1;
END; $$;

REVOKE EXECUTE ON FUNCTION public.conjunto_adicionar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conjunto_adicionar(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conjunto_remover(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conjunto_remover(uuid) TO authenticated;

COMMIT;
