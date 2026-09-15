-- Fase 3 / Onda 3a — Merge de conflito colaborativo na OC Insumo (etiquetas).
-- CLONE LITERAL do padrão da OC Aviamento (agregado: cabeçalho + itens por etiqueta×variante +
-- parcelas jsonb). A grade 2-níveis (bloco por etiqueta → variantes) é só UI: cada item persiste como
-- LINHA por id em ocs_etiqueta_itens, então o merge é mergeDraft (cabeçalho) + mergeLinhas (itens por
-- id) — igual ao aviamento, sem merge novo.
--
-- Peças (espelham 20260915180000_colab_merge_oc_aviamento):
--   1. rev em ocs_etiqueta + trigger BEFORE UPDATE fn_colab_touch_rev.
--   2. fn_colab_bump_oc_etq + trigger AFTER INS/DEL/UPD em ocs_etiqueta_itens (bump da raiz via
--      UPDATE no-op → o rev escalar reflete mudanças nas filhas).
--   3. salvar_oc_etiqueta (função ÚNICA, sem _core) recriada BYTE-A-BYTE + `_rev_base integer
--      DEFAULT NULL` (trava FOR UPDATE + P0409). O de 3 args segue existindo p/ retrocompat.
--
-- Realtime/RLS: ocs_etiqueta JÁ está na publication (Fase 2) e o SELECT é PERMISSIVE p/ authenticated
-- SEM modgate (verificado) — a lição da Onda 1 já está satisfeita, nada a mexer em policy.
--
-- Diff-validar salvar_oc_etiqueta antes/depois: só ADICIONA _rev_base + trava (validação IDOR,
-- INSERT/UPDATE/DELETE/diff de itens e recálculo de parcelas INTACTOS).

BEGIN;

-- ── 1. rev na raiz + trigger de bump ──────────────────────────────────────────
ALTER TABLE public.ocs_etiqueta ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_oc_etq ON public.ocs_etiqueta;
CREATE TRIGGER trg_colab_rev_oc_etq
  BEFORE UPDATE ON public.ocs_etiqueta
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- ── 2. Bump da raiz pelas filhas (itens) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_etq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare v_id uuid := coalesce(new.oc_etiqueta_id, old.oc_etiqueta_id);
begin update public.ocs_etiqueta set id = id where id = v_id; return coalesce(new, old); end
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_oc_etq() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_colab_bump_oc_etq ON public.ocs_etiqueta_itens;
CREATE TRIGGER trg_colab_bump_oc_etq
  AFTER INSERT OR UPDATE OR DELETE ON public.ocs_etiqueta_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_bump_oc_etq();

-- ── 3. salvar_oc_etiqueta + _rev_base (trava otimista) ─────────────────────────
CREATE OR REPLACE FUNCTION public.salvar_oc_etiqueta(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_oc_id uuid := _oc_id;
  v_status text := COALESCE(_oc->>'status', 'encomendado');
  v_recebido boolean := (_oc->>'status' = 'recebido');
  v_keep uuid[];
  v_num text;
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

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev int;
    BEGIN
      SELECT rev INTO v_rev FROM public.ocs_etiqueta
        WHERE id = _oc_id AND (tenant_id = v_tenant OR public.is_super_admin())
        FOR UPDATE;
      IF v_rev IS DISTINCT FROM _rev_base THEN
        RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa'
          USING ERRCODE = 'P0409';
      END IF;
    END;
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
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_etiqueta
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
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

COMMIT;
