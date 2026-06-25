-- Troca de rolo (v2): o rolo defeituoso é SUBSTITUÍDO — ele DESAPARECE (deletado, não
-- fica como "trocado" no recebido) e um rolo de reposição é gerado. A reposição pode
-- ser MAIOR ou MENOR (não bloqueia pelo número / saldo da origem). Bloqueia só se o
-- rolo defeituoso já foi consumido adiante.
CREATE OR REPLACE FUNCTION public._trocar_rolo_core(_rolo_id uuid, _nova_metragem numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem uuid;
  v_artigo uuid;
  v_variante uuid;
  v_item_def uuid;
  v_metros numeric;
  v_unidade text;
  v_rend numeric;
  v_codigo text;
  v_new_rolo uuid;
  v_qtd numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT tenant_id, rolo_origem_item_id INTO v_tenant, v_origem
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;
  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'Rolo sem origem (não foi separado de uma OC) — troca indisponível.';
  END IF;

  SELECT id, artigo_id, variante_tecido_id INTO v_item_def, v_artigo, v_variante
  FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id LIMIT 1;

  -- Bloqueia se o rolo defeituoso já foi consumido adiante (baixa com o item dele como origem).
  IF v_item_def IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = v_item_def
  ) THEN
    RAISE EXCEPTION 'Rolo já em uso — desfaça o uso antes de trocar.';
  END IF;

  -- Metragem (metros) da separação do defeituoso; usada como padrão se não informarem.
  SELECT quantidade INTO v_metros
  FROM public.estoque_tecido_baixas
  WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo' LIMIT 1;
  v_metros := COALESCE(_nova_metragem, v_metros, 0);
  IF v_metros <= 0 THEN RAISE EXCEPTION 'Metragem do rolo de reposição inválida.'; END IF;

  -- Remove o rolo defeituoso por completo (reverte separação + apaga itens + rolo).
  DELETE FROM public.estoque_tecido_baixas WHERE rolo_id = _rolo_id;
  DELETE FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id;
  DELETE FROM public.ocs_tecido WHERE id = _rolo_id;

  -- Cria a reposição (novo código). SEM checagem de saldo: a reposição pode ter
  -- metragem diferente (maior/menor) — não bloquear pelo número.
  SELECT unidade_medida, COALESCE(rendimento, 0) INTO v_unidade, v_rend
  FROM public.artigos WHERE id = v_artigo;
  v_codigo := public.proximo_codigo_rolo(v_artigo);
  v_qtd := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_metros / v_rend ELSE v_metros END;

  INSERT INTO public.ocs_tecido (tenant_id, is_rolo, rolo_codigo, rolo_origem_item_id,
                                 status, data_pedido, data_entrega, numero_pedido)
  VALUES (v_tenant, true, v_codigo, v_origem, 'recebido', current_date, current_date, v_codigo)
  RETURNING id INTO v_new_rolo;

  INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id,
                                       quantidade_pedida, quantidade_recebida)
  VALUES (v_new_rolo, v_artigo, v_variante, v_qtd, v_qtd);

  INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id,
                                            variante_tecido_id, quantidade, origem, rolo_id)
  VALUES (v_tenant, NULL, v_origem, v_variante, v_metros, 'separacao_rolo', v_new_rolo);

  RETURN v_new_rolo;
END;
$function$;
