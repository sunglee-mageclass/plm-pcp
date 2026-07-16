-- Fase 2a — OC de Insumo (compra) + parcelas no Financeiro. Espelha OC Aviamento, mas o
-- item é por VARIANTE de insumo (tamanho×cor) e carrega o PREÇO (o valor da OC = Σ qtd×preço).
-- Funções etiqueta-específicas (não mexe nos cores compartilhados de tecido/aviamento).

BEGIN;

-- ── OC de insumo (espelha ocs_aviamento) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ocs_etiqueta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  numero_pedido varchar,
  responsavel_nome varchar,
  empresa_id uuid REFERENCES public.empresas(id),
  representante_id uuid REFERENCES public.representantes(id),
  data_pedido date,
  data_prevista_entrega date,
  data_entrega date,
  prazo_pagamento varchar,
  quantidade_prazos integer DEFAULT 1,
  nf_url text,
  nfs jsonb NOT NULL DEFAULT '[]'::jsonb,
  parcelas_recebimento jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar DEFAULT 'encomendado',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ocs_etiqueta_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_etiqueta_id uuid REFERENCES public.ocs_etiqueta(id) ON DELETE CASCADE,
  etiqueta_id uuid REFERENCES public.etiquetas(id),
  variante_etiqueta_id uuid REFERENCES public.variantes_etiqueta(id),  -- null = insumo sem variante
  quantidade_pedida numeric,
  quantidade_recebida numeric,
  preco numeric(10,2),
  cancelado boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ocs_etiqueta_itens_oc ON public.ocs_etiqueta_itens (oc_etiqueta_id);

-- parcelas liga a OC de insumo (depois que ocs_etiqueta existe)
ALTER TABLE public.parcelas ADD COLUMN IF NOT EXISTS oc_etiqueta_id uuid REFERENCES public.ocs_etiqueta(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_parcelas_oc_etiqueta ON public.parcelas (oc_etiqueta_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.ocs_etiqueta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.ocs_etiqueta;
DROP POLICY IF EXISTS tenant_insert ON public.ocs_etiqueta;
DROP POLICY IF EXISTS tenant_update ON public.ocs_etiqueta;
DROP POLICY IF EXISTS tenant_delete ON public.ocs_etiqueta;
DROP POLICY IF EXISTS modgate_ins ON public.ocs_etiqueta;
DROP POLICY IF EXISTS modgate_upd ON public.ocs_etiqueta;
DROP POLICY IF EXISTS modgate_del ON public.ocs_etiqueta;
CREATE POLICY tenant_select ON public.ocs_etiqueta FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_insert ON public.ocs_etiqueta FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_update ON public.ocs_etiqueta FOR UPDATE USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_delete ON public.ocs_etiqueta FOR DELETE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY modgate_ins ON public.ocs_etiqueta AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled('entrada_saida'));
CREATE POLICY modgate_upd ON public.ocs_etiqueta AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled('entrada_saida'));
CREATE POLICY modgate_del ON public.ocs_etiqueta AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled('entrada_saida'));

ALTER TABLE public.ocs_etiqueta_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS child_all ON public.ocs_etiqueta_itens;
DROP POLICY IF EXISTS modgate_ins ON public.ocs_etiqueta_itens;
DROP POLICY IF EXISTS modgate_upd ON public.ocs_etiqueta_itens;
DROP POLICY IF EXISTS modgate_del ON public.ocs_etiqueta_itens;
CREATE POLICY child_all ON public.ocs_etiqueta_itens FOR ALL
  USING (EXISTS (SELECT 1 FROM public.ocs_etiqueta o WHERE o.id = ocs_etiqueta_itens.oc_etiqueta_id AND o.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ocs_etiqueta o WHERE o.id = ocs_etiqueta_itens.oc_etiqueta_id AND o.tenant_id = public.get_user_tenant_id()));
CREATE POLICY modgate_ins ON public.ocs_etiqueta_itens AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled('entrada_saida'));
CREATE POLICY modgate_upd ON public.ocs_etiqueta_itens AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled('entrada_saida'));
CREATE POLICY modgate_del ON public.ocs_etiqueta_itens AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled('entrada_saida'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocs_etiqueta TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocs_etiqueta_itens TO authenticated;

-- tenant + empresa/representante guards (espelha ocs_aviamento)
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.ocs_etiqueta;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.ocs_etiqueta FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
DROP TRIGGER IF EXISTS trg_empresa_tenant ON public.ocs_etiqueta;
CREATE TRIGGER trg_empresa_tenant BEFORE INSERT OR UPDATE ON public.ocs_etiqueta FOR EACH ROW EXECUTE FUNCTION public.enforce_empresa_tenant();
DROP TRIGGER IF EXISTS trg_repr_tenant ON public.ocs_etiqueta;
CREATE TRIGGER trg_repr_tenant BEFORE INSERT OR UPDATE ON public.ocs_etiqueta FOR EACH ROW EXECUTE FUNCTION public.enforce_representante_tenant();

-- ── parcelas: (re)gera preservando pagas (valor = Σ qtd×preço do item) ────────
CREATE OR REPLACE FUNCTION public.recalcular_parcelas_etiqueta(_oc_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_empresa uuid; v_data_entrega date; v_qprazos int; v_prazo text;
  v_valor_total numeric(12,2); v_dias int[]; v_n int; v_pago numeric(12,2) := 0; v_restante numeric(12,2);
  v_n_inserir int := 0; v_vparcela numeric(12,2); v_base date; v_venc date; v_ins numeric(12,2); v_idx int := 0; i int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_oc_id::text));
  SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento
    INTO v_tenant, v_empresa, v_data_entrega, v_qprazos, v_prazo FROM public.ocs_etiqueta WHERE id = _oc_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(it.preco, 0)), 0)
    INTO v_valor_total
  FROM public.ocs_etiqueta_itens it
  WHERE it.oc_etiqueta_id = _oc_id AND COALESCE(it.cancelado, false) = false;

  v_dias := ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo,''),'[^0-9]+') t WHERE t ~ '^[0-9]+$');
  IF array_length(v_dias,1) >= 1 THEN v_n := LEAST(array_length(v_dias,1),24); ELSE v_n := GREATEST(v_qprazos,1); END IF;

  SELECT COALESCE(SUM(valor),0) INTO v_pago FROM public.parcelas
   WHERE oc_etiqueta_id = _oc_id AND (status = 'pago' OR data_pagamento IS NOT NULL);

  DELETE FROM public.parcelas
   WHERE oc_etiqueta_id = _oc_id AND status IS DISTINCT FROM 'pago' AND data_pagamento IS NULL;

  SELECT COUNT(*) INTO v_n_inserir FROM generate_series(1, v_n) g(i)
   WHERE NOT EXISTS (SELECT 1 FROM public.parcelas WHERE oc_etiqueta_id = _oc_id AND numero_parcela = g.i);

  v_restante := v_valor_total - v_pago;
  IF v_valor_total <= 0 OR v_restante <= 0 OR v_n_inserir = 0 THEN RETURN; END IF;

  v_vparcela := ROUND(v_restante / v_n_inserir, 2);
  v_base := COALESCE(v_data_entrega, CURRENT_DATE);
  FOR i IN 1..v_n LOOP
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_etiqueta_id = _oc_id AND numero_parcela = i) THEN CONTINUE; END IF;
    v_idx := v_idx + 1;
    IF array_length(v_dias,1) >= i THEN v_venc := v_base + v_dias[i]; ELSE v_venc := v_base + (i*30); END IF;
    v_ins := CASE WHEN v_idx = v_n_inserir THEN v_restante - v_vparcela*(v_n_inserir-1) ELSE v_vparcela END;
    INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_etiqueta_id, empresa_id, numero_parcela, valor, data_vencimento, status)
    VALUES (v_tenant, 'etiqueta', _oc_id, v_empresa, i, v_ins, v_venc, 'a_pagar');
  END LOOP;
END;
$function$;

-- gera parcelas ao virar 'recebido'
CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_etiqueta()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF NOT EXISTS (SELECT 1 FROM public.parcelas WHERE oc_etiqueta_id = NEW.id) THEN
      PERFORM public.recalcular_parcelas_etiqueta(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS gerar_parcelas_oc_etiqueta_trg ON public.ocs_etiqueta;
CREATE TRIGGER gerar_parcelas_oc_etiqueta_trg AFTER INSERT OR UPDATE ON public.ocs_etiqueta
  FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_etiqueta();

-- recalc quando item muda numa OC já recebida
CREATE OR REPLACE FUNCTION public.recalc_parcelas_etiqueta_on_item()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_oc uuid; v_status text;
BEGIN
  v_oc := COALESCE(NEW.oc_etiqueta_id, OLD.oc_etiqueta_id);
  SELECT status INTO v_status FROM public.ocs_etiqueta WHERE id = v_oc;
  IF v_status = 'recebido' THEN PERFORM public.recalcular_parcelas_etiqueta(v_oc); END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_recalc_parcelas_etiqueta ON public.ocs_etiqueta_itens;
CREATE TRIGGER trg_recalc_parcelas_etiqueta AFTER INSERT OR UPDATE OR DELETE ON public.ocs_etiqueta_itens
  FOR EACH ROW EXECUTE FUNCTION public.recalc_parcelas_etiqueta_on_item();

-- ── salvar OC de insumo (atômico: header + diff itens + recalc) ───────────────
CREATE OR REPLACE FUNCTION public.salvar_oc_etiqueta(_oc_id uuid, _oc jsonb, _itens jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_oc_id uuid := _oc_id;
  v_status text := COALESCE(_oc->>'status', 'encomendado');
  v_recebido boolean := (_oc->>'status' = 'recebido');
  v_keep uuid[];
  r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE='42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- itens só de insumo da loja (IDOR)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    JOIN public.etiquetas et ON et.id = (e->>'etiqueta_id')::uuid
    WHERE e->>'etiqueta_id' IS NOT NULL AND et.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Insumo de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    INSERT INTO public.ocs_etiqueta
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status)
    VALUES
      (v_tenant, _oc->>'numero_pedido', _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int,1), _oc->>'nf_url',
       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado')
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'etiqueta_id' IS NOT NULL;

    IF v_recebido THEN UPDATE public.ocs_etiqueta SET status = 'recebido' WHERE id = v_oc_id; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL);
    DELETE FROM public.ocs_etiqueta_itens WHERE oc_etiqueta_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_etiqueta_itens SET
        etiqueta_id = (r->>'etiqueta_id')::uuid,
        variante_etiqueta_id = NULLIF(r->>'variante_etiqueta_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        preco = NULLIF(r->>'preco','')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean,false)
      WHERE id = (r->>'id')::uuid AND oc_etiqueta_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'etiqueta_id' IS NOT NULL;

    UPDATE public.ocs_etiqueta SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int,1),
      nf_url = _oc->>'nf_url',
      nfs = COALESCE(_oc->'nfs','[]'::jsonb),
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento','[]'::jsonb),
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  IF v_recebido THEN PERFORM public.recalcular_parcelas_etiqueta(v_oc_id); END IF;
  RETURN v_oc_id;
END;
$function$;

-- ── desmarcar recebimento (volta p/ encomendado + apaga parcelas não pagas) ───
CREATE OR REPLACE FUNCTION public.desmarcar_recebimento_oc_etiqueta(_oc_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE='42501';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.ocs_etiqueta WHERE id = _oc_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'OC não encontrada'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;
  UPDATE public.ocs_etiqueta SET status = 'encomendado' WHERE id = _oc_id;
  DELETE FROM public.parcelas WHERE oc_etiqueta_id = _oc_id AND status <> 'pago' AND data_pagamento IS NULL;
END;
$function$;

COMMIT;

select pg_notify('pgrst','reload schema');
