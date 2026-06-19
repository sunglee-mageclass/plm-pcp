-- BLOCO A — "- Metragem": remover metragem de uma OC via baixa de AJUSTE no ledger
-- (contagem errada / conserto). Propaga em tudo (físico = recebido − Σ baixas).

ALTER TABLE public.estoque_tecido_baixas
  ADD COLUMN IF NOT EXISTS motivo text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.estoque_tecido_baixas DROP CONSTRAINT IF EXISTS estoque_tecido_baixas_origem_check;
ALTER TABLE public.estoque_tecido_baixas ADD CONSTRAINT estoque_tecido_baixas_origem_check
  CHECK (origem = ANY (ARRAY['vinculo'::text, 'fifo'::text, 'separacao_rolo'::text, 'ajuste'::text]));

-- Remove _metragem (em METROS) do item de OC. Trava no saldo disponível.
CREATE OR REPLACE FUNCTION public.remover_metragem_oc(
  _oc_tecido_item_id uuid,
  _metragem numeric,
  _motivo text DEFAULT NULL::text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_var uuid;
  v_saldo numeric;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF _metragem IS NULL OR _metragem <= 0 THEN RAISE EXCEPTION 'Metragem inválida'; END IF;

  SELECT it.variante_tecido_id INTO v_var
  FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
  WHERE it.id = _oc_tecido_item_id AND oc.tenant_id = v_tenant;
  IF v_var IS NULL THEN RAISE EXCEPTION 'Item não encontrado ou sem variante'; END IF;

  SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(_oc_tecido_item_id);
  IF _metragem > COALESCE(v_saldo, 0) + 1e-6 THEN
    RAISE EXCEPTION 'Só há % m disponíveis nessa OC.', round(COALESCE(v_saldo, 0), 2);
  END IF;

  INSERT INTO public.estoque_tecido_baixas
    (tenant_id, cad_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem, rolo_id, motivo, created_by)
  VALUES
    (v_tenant, NULL, _oc_tecido_item_id, v_var, _metragem, 'ajuste', NULL, NULLIF(_motivo, ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Lista de ajustes (auditoria) do tenant.
CREATE OR REPLACE FUNCTION public.ajustes_estoque_lista()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'created_at', b.created_at,
    'quantidade', b.quantidade,
    'motivo', b.motivo,
    'origem_label', CASE WHEN oc.is_rolo THEN 'Rolo ' || COALESCE(oc.rolo_codigo, oc.numero_pedido, '—')
                         ELSE 'OC ' || COALESCE(oc.numero_pedido, '—') END,
    'artigo', a.nome,
    'variante', COALESCE(vt.nome_variante, vt.codigo_variante, '—'),
    'por', COALESCE(u.nome, u.email, '—')
  ) ORDER BY b.created_at DESC), '[]'::jsonb)
  FROM public.estoque_tecido_baixas b
  JOIN public.ocs_tecido_itens it ON it.id = b.oc_tecido_item_id
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
  LEFT JOIN public.artigos a ON a.id = it.artigo_id
  LEFT JOIN public.variantes_tecido vt ON vt.id = b.variante_tecido_id
  LEFT JOIN public.users u ON u.id = b.created_by
  WHERE b.tenant_id = public.get_user_tenant_id() AND b.origem = 'ajuste';
$function$;

-- Desfaz um ajuste (só apaga baixas de origem 'ajuste' do tenant).
CREATE OR REPLACE FUNCTION public.reverter_ajuste_estoque(_baixa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  DELETE FROM public.estoque_tecido_baixas
  WHERE id = _baixa_id AND tenant_id = v_tenant AND origem = 'ajuste';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.remover_metragem_oc(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ajustes_estoque_lista() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reverter_ajuste_estoque(uuid) FROM anon;
