-- Fase 3 / Onda 2 — Merge de conflito colaborativo na OC Aviamento.
-- CLONE do padrão da OC Tecido (o piloto do colab): mesma estrutura de agregado (cabeçalho + itens
-- por variante + parcelas jsonb), então reusa mergeDraft+mergeLinhas no front (sem merge novo). Ver
-- spec docs/superpowers/specs/2026-09-15-colab-merge-direcionamento.md (Onda 1) p/ o padrão geral.
--
-- Peças (espelham a OC Tecido):
--   1. Coluna `rev` em ocs_aviamento + trigger BEFORE UPDATE fn_colab_touch_rev (genérica, já existe):
--      todo UPDATE da raiz bumpa rev.
--   2. `fn_colab_bump_oc_avi` (variante da fn_colab_bump_oc do tecido, mas com oc_aviamento_id +
--      UPDATE ocs_aviamento) + trigger AFTER INS/DEL/UPD em ocs_aviamento_itens: qualquer mudança de
--      item faz UPDATE no-op na raiz → re-dispara o #1 → rev+1. Assim o rev escalar da raiz reflete
--      mudanças nas FILHAS (o front lê 1 número e detecta conflito no agregado inteiro).
--   3. `_salvar_oc_aviamento_core` recriada BYTE-A-BYTE + `_rev_base integer DEFAULT NULL` (trava
--      otimista FOR UPDATE + P0409, copiada do _salvar_oc_tecido_core). + wrapper salvar_oc_aviamento
--      com o 4º arg.
--
-- Realtime/RLS: ocs_aviamento JÁ está na publication supabase_realtime (REPLICA FULL, Fase 2) e o
-- SELECT já é PERMISSIVE p/ `authenticated` — a lição da Onda 1 (Realtime lê como authenticated, sem
-- modgate no SELECT) JÁ está satisfeita aqui. Nada a mexer em policy.
--
-- Diff-validar _salvar_oc_aviamento_core antes/depois: só ADICIONA a trava + o param (escrita
-- INSERT/UPDATE/DELETE/diff de itens e recálculo de parcelas INTACTOS).

BEGIN;

-- ── 1. rev na raiz + trigger de bump ──────────────────────────────────────────
ALTER TABLE public.ocs_aviamento ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_oc_avi ON public.ocs_aviamento;
CREATE TRIGGER trg_colab_rev_oc_avi
  BEFORE UPDATE ON public.ocs_aviamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- ── 2. Bump da raiz pelas filhas (itens) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_avi()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare v_id uuid := coalesce(new.oc_aviamento_id, old.oc_aviamento_id);
begin update public.ocs_aviamento set id = id where id = v_id; return coalesce(new, old); end
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_colab_bump_oc_avi() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_colab_bump_oc_avi ON public.ocs_aviamento_itens;
CREATE TRIGGER trg_colab_bump_oc_avi
  AFTER INSERT OR UPDATE OR DELETE ON public.ocs_aviamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_bump_oc_avi();

-- ── 3. _salvar_oc_aviamento_core + _rev_base (trava otimista) ──────────────────
CREATE OR REPLACE FUNCTION public._salvar_oc_aviamento_core(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL)
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
  -- trava otimista (spec 2026-08-03) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev int;
    BEGIN
      SELECT rev INTO v_rev FROM public.ocs_aviamento
        WHERE id = _oc_id AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
        FOR UPDATE;
      IF v_rev IS DISTINCT FROM _rev_base THEN
        RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa'
          USING ERRCODE = 'P0409';
      END IF;
    END;
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- A3: itens não podem referenciar aviamento de outra loja (nem de outro fornecedor que
  -- não o da OC). Fecha item órfão/IDOR via payload forjado. (empresa_id da OC é validada
  -- pelo trigger enforce_empresa_tenant.)
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.aviamentos a ON a.id = (e->>'aviamento_id')::uuid
    WHERE e->>'aviamento_id' IS NOT NULL
      AND ( a.tenant_id IS DISTINCT FROM v_tenant
            OR ( (_oc->>'empresa_id') IS NOT NULL AND a.empresa_id IS NOT NULL
                 AND a.empresa_id IS DISTINCT FROM (_oc->>'empresa_id')::uuid ) )
  ) THEN
    RAISE EXCEPTION 'Aviamento de outra loja ou fornecedor não pode ser adicionado à OC.';
  END IF;

  -- Variante (se informada) tem de pertencer ao aviamento do MESMO item e à loja
  -- (espelha o vínculo cor-apelido de salvar_variantes_aviamento). LEFT JOIN p/ que
  -- id inexistente/forjado (va.id IS NULL) também caia no RAISE.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    LEFT JOIN public.variantes_aviamento va ON va.id = (e->>'variante_aviamento_id')::uuid
    WHERE NULLIF(e->>'variante_aviamento_id','') IS NOT NULL
      AND ( va.id IS NULL
            OR va.aviamento_id IS DISTINCT FROM (e->>'aviamento_id')::uuid
            OR va.tenant_id IS DISTINCT FROM v_tenant )
  ) THEN
    RAISE EXCEPTION 'Variante não pertence ao aviamento informado (ou é de outra loja).';
  END IF;

  IF v_oc_id IS NULL THEN
    -- INSERT: cria como 'encomendado' (trigger não gera parcela), itens, depois status final.
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_aviamento WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_aviamento
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1), _oc->>'nf_url',
       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado')
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_aviamento SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_aviamento
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    -- diff de itens por id (preserva ids). keep = ids enviados.
    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL);
    DELETE FROM public.ocs_aviamento_itens
      WHERE oc_aviamento_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_aviamento_itens SET
        aviamento_id = (r->>'aviamento_id')::uuid,
        variante_aviamento_id = NULLIF(r->>'variante_aviamento_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false)
      WHERE id = (r->>'id')::uuid AND oc_aviamento_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'aviamento_id' IS NOT NULL;

    -- update da OC (dispara o trigger já com itens corretos)
    UPDATE public.ocs_aviamento SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- Recalcula parcelas quando recebida (preserva pagas; o trigger não regenera se já existe).
  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'aviamento');
  END IF;

  RETURN v_oc_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_oc_aviamento_core(uuid, jsonb, jsonb, integer) FROM public, anon, authenticated;

-- Wrapper com _rev_base (o de 3 args segue existindo p/ retrocompat).
CREATE OR REPLACE FUNCTION public.salvar_oc_aviamento(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_aviamento_core(_oc_id, _oc, _itens, _rev_base);
END;
$function$;

COMMIT;
