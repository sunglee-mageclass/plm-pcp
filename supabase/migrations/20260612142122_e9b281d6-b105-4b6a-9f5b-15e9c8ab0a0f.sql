
-- 1) Vínculo OC ↔ variante de modelo (sobrevive a save destrutivo)
CREATE TABLE public.modelo_tecido_oc_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  tipo varchar NOT NULL,
  numero int NOT NULL,
  ordem int NOT NULL,
  variante_tecido_id uuid NOT NULL REFERENCES public.variantes_tecido(id) ON DELETE CASCADE,
  oc_tecido_item_id uuid NOT NULL REFERENCES public.ocs_tecido_itens(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modelo_id, tipo, numero, ordem)
);
CREATE INDEX idx_mtocl_oc_item ON public.modelo_tecido_oc_links(oc_tecido_item_id);
CREATE INDEX idx_mtocl_variante ON public.modelo_tecido_oc_links(variante_tecido_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.modelo_tecido_oc_links TO authenticated;
GRANT ALL ON public.modelo_tecido_oc_links TO service_role;
ALTER TABLE public.modelo_tecido_oc_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY mtocl_sel ON public.modelo_tecido_oc_links FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY mtocl_ins ON public.modelo_tecido_oc_links FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY mtocl_upd ON public.modelo_tecido_oc_links FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY mtocl_del ON public.modelo_tecido_oc_links FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER mtocl_set_tenant BEFORE INSERT ON public.modelo_tecido_oc_links
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
CREATE TRIGGER mtocl_updated_at BEFORE UPDATE ON public.modelo_tecido_oc_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Baixas por OC (lote) quando CAD envia ao corte
CREATE TABLE public.estoque_tecido_baixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cad_id uuid NOT NULL REFERENCES public.cad(id) ON DELETE CASCADE,
  variante_tecido_id uuid NOT NULL REFERENCES public.variantes_tecido(id) ON DELETE CASCADE,
  oc_tecido_item_id uuid NOT NULL REFERENCES public.ocs_tecido_itens(id) ON DELETE CASCADE,
  quantidade numeric NOT NULL,
  origem text NOT NULL CHECK (origem IN ('vinculo','fifo')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etb_cad ON public.estoque_tecido_baixas(cad_id);
CREATE INDEX idx_etb_variante ON public.estoque_tecido_baixas(variante_tecido_id);
CREATE INDEX idx_etb_oc_item ON public.estoque_tecido_baixas(oc_tecido_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.estoque_tecido_baixas TO authenticated;
GRANT ALL ON public.estoque_tecido_baixas TO service_role;
ALTER TABLE public.estoque_tecido_baixas ENABLE ROW LEVEL SECURITY;

CREATE POLICY etb_sel ON public.estoque_tecido_baixas FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY etb_ins ON public.estoque_tecido_baixas FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY etb_upd ON public.estoque_tecido_baixas FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY etb_del ON public.estoque_tecido_baixas FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER etb_set_tenant BEFORE INSERT ON public.estoque_tecido_baixas
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- 3) RPC: baixar estoque por OC ao enviar ao corte (idempotente)
CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
  v_total_linhas int := 0;
  v_total_qtd numeric := 0;
  r record;
  v_restante numeric;
  v_link_oc_item uuid;
  v_saldo numeric;
  v_consumir numeric;
  lote record;
BEGIN
  SELECT tenant_id, modelo_id INTO v_tenant, v_modelo
  FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;

  -- idempotente: apagar baixas anteriores deste cad
  DELETE FROM public.estoque_tecido_baixas WHERE cad_id = _cad_id;

  -- itera variantes do cad com metragem_enviada > 0
  FOR r IN
    SELECT
      ct.tipo, ct.numero,
      ctv.variante_tecido_id, ctv.ordem, ctv.metragem_enviada
    FROM public.cad_tecidos ct
    JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
    WHERE ct.cad_id = _cad_id
      AND COALESCE(ctv.metragem_enviada,0) > 0
      AND ctv.variante_tecido_id IS NOT NULL
  LOOP
    v_restante := r.metragem_enviada;

    -- 1) tenta vínculo manual (modelo_tecido_oc_links)
    SELECT oc_tecido_item_id INTO v_link_oc_item
    FROM public.modelo_tecido_oc_links
    WHERE modelo_id = v_modelo
      AND tipo = r.tipo AND numero = r.numero AND ordem = r.ordem
      AND variante_tecido_id = r.variante_tecido_id;

    IF v_link_oc_item IS NOT NULL THEN
      -- saldo do lote em metros equivalentes
      SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(v_link_oc_item);
      v_saldo := COALESCE(v_saldo,0);
      IF v_saldo > 0 THEN
        v_consumir := LEAST(v_restante, v_saldo);
        INSERT INTO public.estoque_tecido_baixas
          (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
        VALUES (v_tenant, _cad_id, r.variante_tecido_id, v_link_oc_item, v_consumir, 'vinculo');
        v_restante := v_restante - v_consumir;
        v_total_linhas := v_total_linhas + 1;
        v_total_qtd := v_total_qtd + v_consumir;
      END IF;
    END IF;

    -- 2) FIFO para o restante
    IF v_restante > 0 THEN
      FOR lote IN
        SELECT it.id AS item_id, s.saldo_m
        FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        CROSS JOIN LATERAL public.saldo_oc_item_m(it.id) s
        WHERE oc.tenant_id = v_tenant
          AND oc.status = 'recebido'
          AND it.variante_tecido_id = r.variante_tecido_id
          AND s.saldo_m > 0
          AND (v_link_oc_item IS NULL OR it.id <> v_link_oc_item)
        ORDER BY oc.data_entrega NULLS LAST, oc.created_at
      LOOP
        EXIT WHEN v_restante <= 0;
        v_consumir := LEAST(v_restante, lote.saldo_m);
        INSERT INTO public.estoque_tecido_baixas
          (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
        VALUES (v_tenant, _cad_id, r.variante_tecido_id, lote.item_id, v_consumir, 'fifo');
        v_restante := v_restante - v_consumir;
        v_total_linhas := v_total_linhas + 1;
        v_total_qtd := v_total_qtd + v_consumir;
      END LOOP;
    END IF;
    -- se ainda houver v_restante > 0 = estoque negativo; segue (não bloqueia)
  END LOOP;

  RETURN jsonb_build_object('linhas', v_total_linhas, 'quantidade', v_total_qtd);
END;
$$;

-- helper: saldo do item OC em metros equivalentes
CREATE OR REPLACE FUNCTION public.saldo_oc_item_m(_item_id uuid)
RETURNS TABLE(saldo_m numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.id, i.variante_tecido_id, i.quantidade_recebida,
           a.unidade_medida, COALESCE(a.rendimento,0) AS rendimento
    FROM public.ocs_tecido_itens i
    LEFT JOIN public.artigos a ON a.id = i.artigo_id
    WHERE i.id = _item_id
  ),
  rec AS (
    SELECT CASE WHEN unidade_medida='kg'
                THEN COALESCE(quantidade_recebida,0) * rendimento
                ELSE COALESCE(quantidade_recebida,0) END AS m
    FROM it
  ),
  bx AS (
    SELECT COALESCE(SUM(quantidade),0) AS m
    FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = _item_id
  )
  SELECT (SELECT m FROM rec) - (SELECT m FROM bx);
$$;

-- detalhamento por OC de uma variante (para tela de estoque)
CREATE OR REPLACE FUNCTION public.detalhe_estoque_variante(_variante_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.id AS oc_id,
      oc.numero_pedido,
      oc.data_entrega,
      oc.created_at,
      e.nome AS fornecedor,
      CASE WHEN a.unidade_medida='kg'
           THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida,0) END AS recebido_m,
      COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS baixado_m,
      COALESCE((
        SELECT SUM(
          CASE WHEN a.unidade_medida='kg'
               THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
               ELSE COALESCE(it.quantidade_recebida,0) END
        ) FILTER (WHERE 1=0)  -- placeholder
      ),0) AS _zero,
      -- reservado: soma do consumo*grade_total dos modelos com vínculo neste item e cujo CAD ainda não tem baixas
      COALESCE((
        SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                   * COALESCE((SELECT SUM(grade_total) FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id),0))
        FROM public.modelo_tecido_oc_links l
        JOIN public.modelo_tecidos mt
          ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
        WHERE l.oc_tecido_item_id = it.id
          AND NOT EXISTS (
            SELECT 1 FROM public.cad c
            JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
            WHERE c.modelo_id = l.modelo_id
          )
      ),0) AS reservado_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.empresas e ON e.id = oc.empresa_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status = 'recebido'
      AND it.variante_tecido_id = _variante_id
  ) t;
  RETURN v_result;
END;
$$;

-- OCs disponíveis (com saldo) para uma variante — usada no select do Desenvolvimento
CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.numero_pedido,
      oc.data_entrega,
      CASE WHEN a.unidade_medida='kg'
           THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida,0) END
      - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
      AS saldo_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status = 'recebido'
      AND it.variante_tecido_id = _variante_id
  ) t
  WHERE (t.saldo_m)::numeric > 0;
  RETURN v_result;
END;
$$;

-- 4) Backfill: para cada CAD já enviado ao corte sem baixas, aplicar FIFO
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.cad WHERE enviado_corte = true LOOP
    IF NOT EXISTS (SELECT 1 FROM public.estoque_tecido_baixas WHERE cad_id = r.id) THEN
      PERFORM public.baixar_estoque_tecido_corte(r.id);
    END IF;
  END LOOP;
END $$;
