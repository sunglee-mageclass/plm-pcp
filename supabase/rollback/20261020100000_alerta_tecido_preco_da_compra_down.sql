-- INVERSO de supabase/migrations/20261020100000_alerta_tecido_preco_da_compra.sql (achados MEDIOS R10, fin #4).
-- Devolve o texto de ANTES das 2 funcoes (refazem o total da OC pelo preco do cadastro, artigos.preco).
-- Guarda: so roda se as 2 estao EXATAMENTE com o texto da ida (md5 de depois); outro -> P0001 e nada muda.
-- Totais de OC ja recalculados com o preco do item ficam como estao ate o proximo recalculo.
-- Ordem geral: LIFO da APLICACAO (inverso da R10 = 120000 -> 110000 -> 100000, todos ANTES dos inversos da release 8/7).
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)', 'e16c604d1ce06fe77151118870c1257c'),
      ('public._receber_reposicao_troca_core(uuid,date,numeric)',                  '95fa0b06c2a5835789c8d0c3d10a8eb5')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r10_fin4 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r10_fin4 (volta): % nao esta com o texto da 20261020100000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._aplicar_resolucao_alerta_tecido_core(_item_id uuid, _acao text, _rep_artigo_id uuid DEFAULT NULL::uuid, _rep_variante_id uuid DEFAULT NULL::uuid, _rep_metragem numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid;
  v_arr jsonb; v_new jsonb; v_removed boolean; v_e jsonb; v_status text; v_idx int; v_i int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT it.oc_tecido_id, it.cq_alerta_status INTO v_oc, v_status FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
   WHERE it.id = _item_id AND oc.tenant_id = v_tenant;
  IF v_oc IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;

  -- Guarda de máquina de estados (C2): só transições válidas — evita corromper estoque/valor
  -- por duplo-clique / cache velho / retry / chamada direta. estilo_ok/cancelar/troca só de
  -- 'alertado'; reabrir só de um estado resolvido.
  IF _acao IN ('cancelar','estilo_ok','troca') AND v_status IS DISTINCT FROM 'alertado' THEN
    RAISE EXCEPTION 'Este item não está em alerta (estado: %) — recarregue a lista.', COALESCE(v_status,'—');
  END IF;
  IF _acao = 'reabrir' AND COALESCE(v_status,'') NOT IN ('estilo_ok','cancelado','troca_pendente') THEN
    RAISE EXCEPTION 'Este item não pode ser reaberto (estado: %).', COALESCE(v_status,'—');
  END IF;

  IF _acao = 'cancelar' THEN
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'cancelado', cancelado = true WHERE id = _item_id;
  ELSIF _acao = 'estilo_ok' THEN
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'estilo_ok', cancelado = false WHERE id = _item_id;
  ELSIF _acao = 'reabrir' THEN
    -- Reabrir uma troca já RECEBIDA duplicaria o previsto e orfanaria a reposição (que tem
    -- estoque); estornar o recebimento é outro fluxo. Bloqueia com mensagem clara.
    IF EXISTS (SELECT 1 FROM public.ocs_tecido_itens
               WHERE substitui_item_id = _item_id AND oc_tecido_id = v_oc
                 AND quantidade_recebida IS NOT NULL) THEN
      RAISE EXCEPTION 'A reposição desta troca já foi recebida — não é possível reabrir.';
    END IF;
    -- "Desfazer troca" (troca pendente): remove o substituto órfão + UMA entrada vazia que a
    -- troca acrescentou no cronograma de recebimento.
    IF EXISTS (SELECT 1 FROM public.ocs_tecido_itens
               WHERE substitui_item_id = _item_id AND oc_tecido_id = v_oc
                 AND quantidade_recebida IS NULL) THEN
      DELETE FROM public.ocs_tecido_itens
       WHERE substitui_item_id = _item_id AND oc_tecido_id = v_oc AND quantidade_recebida IS NULL;
      -- F2: remove a ÚLTIMA entrada vazia (a troca acrescenta no FIM). Remover a última, e não
      -- a primeira, evita apagar uma entrada vazia ANTERIOR que o usuário tenha deixado pra
      -- preencher, quando há 2+ trocas pendentes na mesma OC.
      SELECT parcelas_recebimento INTO v_arr FROM public.ocs_tecido WHERE id = v_oc;
      SELECT max(ord) INTO v_idx FROM (
        SELECT row_number() OVER () AS ord, e FROM jsonb_array_elements(COALESCE(v_arr, '[]'::jsonb)) e
      ) t WHERE COALESCE(t.e->>'data','') = '' AND COALESCE((t.e->>'recebido')::boolean, false) = false;
      IF v_idx IS NOT NULL THEN
        v_new := '[]'::jsonb; v_i := 0;
        FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(v_arr, '[]'::jsonb)) LOOP
          v_i := v_i + 1;
          IF v_i <> v_idx THEN v_new := v_new || jsonb_build_array(v_e); END IF;
        END LOOP;
        UPDATE public.ocs_tecido SET parcelas_recebimento = v_new WHERE id = v_oc;
      END IF;
    END IF;
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'alertado', cancelado = false WHERE id = _item_id;
  ELSIF _acao = 'troca' THEN
    IF _rep_artigo_id IS NULL OR _rep_variante_id IS NULL THEN RAISE EXCEPTION 'Informe o tecido/variante substituto'; END IF;
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'troca_pendente', cancelado = true WHERE id = _item_id;
    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, substitui_item_id, cq_alerta_status)
    VALUES (v_oc, _rep_artigo_id, _rep_variante_id, COALESCE(_rep_metragem, 0), NULL, _item_id, 'sem_alerta');
    UPDATE public.ocs_tecido
       SET parcelas_recebimento = COALESCE(parcelas_recebimento, '[]'::jsonb)
                                  || jsonb_build_array(jsonb_build_object('data', '', 'recebido', false))
     WHERE id = v_oc;
  ELSE
    RAISE EXCEPTION 'Ação inválida: %', _acao;
  END IF;

  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_recebida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0),
    valor_previsto_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_pedida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0)
  WHERE oc.id = v_oc;
  PERFORM public.recalcular_parcelas(v_oc, 'tecido');
END;
$function$;

CREATE OR REPLACE FUNCTION public._receber_reposicao_troca_core(_original_item_id uuid, _data date, _metragem numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid; v_rep uuid; v_arr jsonb; v_new jsonb := '[]'::jsonb; v_done boolean := false; v_e jsonb; v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF _metragem IS NULL OR _metragem <= 0 THEN RAISE EXCEPTION 'Informe a metragem recebida'; END IF;

  SELECT it.oc_tecido_id, it.cq_alerta_status INTO v_oc, v_status FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
   WHERE it.id = _original_item_id AND oc.tenant_id = v_tenant;
  IF v_oc IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  -- idempotência (C1): só recebe reposição de troca PENDENTE (não re-recebe uma já 'trocado').
  IF v_status IS DISTINCT FROM 'troca_pendente' THEN
    RAISE EXCEPTION 'Esta troca não está pendente de recebimento (estado: %).', COALESCE(v_status,'—');
  END IF;

  SELECT id INTO v_rep FROM public.ocs_tecido_itens
   WHERE substitui_item_id = _original_item_id AND oc_tecido_id = v_oc AND quantidade_recebida IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_rep IS NULL THEN RAISE EXCEPTION 'Reposição não encontrada'; END IF;

  UPDATE public.ocs_tecido_itens SET quantidade_recebida = _metragem WHERE id = v_rep;
  UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'trocado' WHERE id = _original_item_id;

  -- marca a 1ª entrada pendente do cronograma de recebimento como recebida (com a data)
  SELECT parcelas_recebimento INTO v_arr FROM public.ocs_tecido WHERE id = v_oc;
  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(v_arr, '[]'::jsonb)) LOOP
    IF NOT v_done AND COALESCE((v_e->>'recebido')::boolean, false) = false THEN
      v_new := v_new || jsonb_build_array(jsonb_build_object('data', _data::text, 'recebido', true));
      v_done := true;
    ELSE
      v_new := v_new || jsonb_build_array(v_e);
    END IF;
  END LOOP;
  IF NOT v_done THEN
    v_new := v_new || jsonb_build_array(jsonb_build_object('data', _data::text, 'recebido', true));
  END IF;
  UPDATE public.ocs_tecido SET parcelas_recebimento = v_new WHERE id = v_oc;

  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_recebida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0),
    valor_previsto_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_pedida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0)
  WHERE oc.id = v_oc;
  PERFORM public.recalcular_parcelas(v_oc, 'tecido');
END;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)', 'f30dff2c2ece193ae5f7b36aa33ccfcf'),
      ('public._receber_reposicao_troca_core(uuid,date,numeric)',                  'd5bf1259b7519bc558c191a4eb5f267d')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r10_fin4 (volta): % nao voltou ao texto de antes', r.s USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r10_fin4 (volta): % ficou executavel por anon/authenticated', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
