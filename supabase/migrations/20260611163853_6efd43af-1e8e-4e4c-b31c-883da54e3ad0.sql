
-- 1) Artigos: recalcular preco_por_metro + histórico
CREATE OR REPLACE FUNCTION public.artigos_recalc_preco()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.unidade_medida = 'kg' AND COALESCE(NEW.rendimento,0) > 0 THEN
    NEW.preco_por_metro := NEW.preco / NEW.rendimento;
  ELSIF NEW.unidade_medida = 'metro' THEN
    NEW.preco_por_metro := NEW.preco;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.preco IS DISTINCT FROM OLD.preco THEN
    NEW.historico_precos := COALESCE(OLD.historico_precos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'preco', OLD.preco,
        'preco_por_metro', OLD.preco_por_metro,
        'data', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
      ));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS artigos_recalc_preco_trg ON public.artigos;
CREATE TRIGGER artigos_recalc_preco_trg
BEFORE INSERT OR UPDATE ON public.artigos
FOR EACH ROW EXECUTE FUNCTION public.artigos_recalc_preco();

-- 2) Status automático para terceirizados / acabamento
CREATE OR REPLACE FUNCTION public.auto_status_terceirizado()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.data_entregue IS NOT NULL THEN
    NEW.status := 'finalizado';
  ELSIF NEW.data_enviado IS NOT NULL THEN
    NEW.status := 'em_andamento';
  ELSE
    NEW.status := 'pendente';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_status_prod_terc_trg ON public.producao_terceirizados;
CREATE TRIGGER auto_status_prod_terc_trg
BEFORE INSERT OR UPDATE ON public.producao_terceirizados
FOR EACH ROW EXECUTE FUNCTION public.auto_status_terceirizado();

DROP TRIGGER IF EXISTS auto_status_prod_acab_trg ON public.producao_acabamento;
CREATE TRIGGER auto_status_prod_acab_trg
BEFORE INSERT OR UPDATE ON public.producao_acabamento
FOR EACH ROW EXECUTE FUNCTION public.auto_status_terceirizado();

-- 3) Gerar parcelas para OC de tecido ao receber
CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_tecido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_parcelas INTEGER;
  valor_parcela NUMERIC(12,2);
  base_data DATE;
  i INTEGER;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    -- evita duplicar
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_tecido_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    valor_parcela := ROUND(COALESCE(NEW.valor_real_total, 0) / n_parcelas, 2);
    base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..n_parcelas LOOP
      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_tecido_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        NEW.tenant_id, 'tecido', NEW.id, NEW.empresa_id,
        i, valor_parcela, base_data + (i * 30), 'a_pagar'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gerar_parcelas_oc_tecido_trg ON public.ocs_tecido;
CREATE TRIGGER gerar_parcelas_oc_tecido_trg
AFTER INSERT OR UPDATE ON public.ocs_tecido
FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_tecido();

-- 4) Gerar parcelas para OC de aviamento ao receber
CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_aviamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_parcelas INTEGER;
  valor_total NUMERIC(12,2);
  valor_parcela NUMERIC(12,2);
  base_data DATE;
  i INTEGER;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_aviamento_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);

    -- Soma valor dos itens (qtd_recebida * preco do aviamento)
    SELECT COALESCE(SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) * COALESCE(a.preco, 0)), 0)
      INTO valor_total
    FROM public.ocs_aviamento_itens i
    LEFT JOIN public.aviamentos a ON a.id = i.aviamento_id
    WHERE i.oc_aviamento_id = NEW.id;

    valor_parcela := ROUND(valor_total / n_parcelas, 2);
    base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..n_parcelas LOOP
      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_aviamento_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        NEW.tenant_id, 'aviamento', NEW.id, NEW.empresa_id,
        i, valor_parcela, base_data + (i * 30), 'a_pagar'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gerar_parcelas_oc_aviamento_trg ON public.ocs_aviamento;
CREATE TRIGGER gerar_parcelas_oc_aviamento_trg
AFTER INSERT OR UPDATE ON public.ocs_aviamento
FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_aviamento();
