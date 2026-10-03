-- Inverso de supabase/migrations/20261031220000_seg_s2_gate_financeiro.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S2, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.servicos_financeiro()
--     ANTES  a06f4cc32646cc41ed249d91a68dcd51
--     DEPOIS 85fbaba16664cb6f585e533b5041a139
--   public.recalcular_parcelas(uuid,text)
--     ANTES  5db77cc2c9c3dcf8bae6fc297457978a
--     DEPOIS aa6df4729aeaa0f7bd08a2c0833d8b52
--   public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)
--     ANTES  e16c604d1ce06fe77151118870c1257c
--     DEPOIS d0933c6d48292b7309c6b2ac9e783466
--   public._receber_reposicao_troca_core(uuid,date,numeric)
--     ANTES  95fa0b06c2a5835789c8d0c3d10a8eb5
--     DEPOIS 887c95f8f439a87eec9d1dd7a1303e3d
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / GRANT-REVOKE): nenhuma tabela de negócio, nada de auth/storage.
-- Sem DROP, sem CREATE TRIGGER/POLICY.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.servicos_financeiro()', 'a06f4cc32646cc41ed249d91a68dcd51', '85fbaba16664cb6f585e533b5041a139'),
      ('public.recalcular_parcelas(uuid,text)', '5db77cc2c9c3dcf8bae6fc297457978a', 'aa6df4729aeaa0f7bd08a2c0833d8b52'),
      ('public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)', 'e16c604d1ce06fe77151118870c1257c', 'd0933c6d48292b7309c6b2ac9e783466'),
      ('public._receber_reposicao_troca_core(uuid,date,numeric)', '95fa0b06c2a5835789c8d0c3d10a8eb5', '887c95f8f439a87eec9d1dd7a1303e3d')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's2_c6_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
  v_prazo text; v_dias int[]; v_n int; v_base date; v_venc date; v_off int; i int; v_comp int;
  v_guc text := COALESCE(current_setting('app.parcelas_servico_sistema', true), '');
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  FOR r IN
    SELECT pt.id, pt.cad_id, GREATEST(COALESCE(pt.numero_parcelas,1),1) AS n,
           pt.numero_parcelas, pt.empresa_id,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina, pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    WHERE COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
  LOOP
    IF (NOT r.is_oficina AND r.data_enviado IS NOT NULL AND r.data_entregue IS NOT NULL)
       OR (r.is_oficina AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = r.cad_id AND cq.status = 'confirmado'))
    THEN
      v_base := COALESCE(r.data_entregue, r.data_enviado);
      v_prazo := (SELECT prazo_pagamento FROM public.empresas WHERE id = r.empresa_id);
      v_dias := ARRAY(
        SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo,''),'[^0-9]+') AS t
        WHERE t ~ '^[0-9]+$'
      );
      IF array_length(v_dias,1) >= 1 THEN
        v_n := LEAST(array_length(v_dias,1), 24);
      ELSE
        -- Cap em 24 IGUAL ao n_eff do display (LEAST(...,24)): sem isso, um bloco sem prazo
        -- com numero_parcelas > 24 gera >24 parcelas mas o display mostra/divide por 24 —
        -- parcela a-pagar oculta reaparece só quando paga, inflando o total exibido (money path).
        v_n := LEAST(GREATEST(COALESCE(r.numero_parcelas,1), 1), 24);
      END IF;

      -- [medios R16 RA1, P-187 A] nº da parcela COMPLEMENTO (nao paga, acima de v_n) que a fonte unica
      -- _servico_parcelas_valores pede: todas as do prazo pagas e saldo > 0. NULL = nenhuma.
      SELECT max(v.numero_parcela) INTO v_comp
        FROM public._servico_parcelas_valores(r.id) v
       WHERE v.numero_parcela > v_n
         AND NOT EXISTS (SELECT 1 FROM parcelas_servico ps2
                          WHERE ps2.producao_terceirizado_id = r.id AND ps2.numero_parcela = v.numero_parcela
                            AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL));

      -- Deleta só parcelas NÃO pagas acima de v_n (nunca apaga paga), menos o complemento pedido (saldo voltou a
      -- <= 0 -> o complemento nao pago some aqui).
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id
         AND ps.numero_parcela > v_n
         AND ps.numero_parcela IS DISTINCT FROM v_comp
         AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;

      -- Gera/atualiza 1..v_n preservando pagas e vencimentos editados à mão.
      FOR i IN 1..v_n LOOP
        -- Só escalona quando existe o i-ésimo prazo; sem prazo (ou índice além do array)
        -- cai na DATA-BASE única = comportamento flat de sempre (NÃO usar i*30).
        IF array_length(v_dias,1) >= i THEN v_venc := v_base + v_dias[i]; v_off := v_dias[i];
        ELSE v_venc := v_base; v_off := NULL; END IF;

        INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
        VALUES (v_tenant, r.id, i, v_venc)
        ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;

        -- [medios R10 fin #6, P-165 A] a parcela NAO paga e NAO ajustada a mao (vencimento_manual) acompanha a data
        -- calculada (entrega/prazo mudou -> ela anda); a ajustada a mao fica; a paga nunca muda. Sem data calculada
        -- (sem entrega nem envio) nao mexe. A GUC app.parcelas_servico_sistema liga SO em volta do UPDATE (o gatilho
        -- trg_servico_parcela_vencimento_manual nao conta como ajuste a mao) e volta ao valor de antes.
        IF v_venc IS NOT NULL THEN
          PERFORM set_config('app.parcelas_servico_sistema', 'on', true);
          UPDATE parcelas_servico ps
             SET data_vencimento = v_venc
           WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela = i
             AND ps.status <> 'pago' AND ps.data_pagamento IS NULL
             AND NOT ps.vencimento_manual
             AND ps.data_vencimento IS DISTINCT FROM v_venc;
          PERFORM set_config('app.parcelas_servico_sistema', v_guc, true);
        END IF;
      END LOOP;

      -- [medios R16 RA1] o complemento vence junto com a ultima parcela do prazo (a data calculada da parcela v_n);
      -- mesma regra de data das outras: nao paga e nao ajustada a mao acompanha; a manual fica; nunca grava NULL.
      IF v_comp IS NOT NULL THEN
        IF array_length(v_dias,1) >= v_n THEN v_venc := v_base + v_dias[v_n];
        ELSE v_venc := v_base; END IF;
        INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
        VALUES (v_tenant, r.id, v_comp, v_venc)
        ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;
        IF v_venc IS NOT NULL THEN
          PERFORM set_config('app.parcelas_servico_sistema', 'on', true);
          UPDATE parcelas_servico ps
             SET data_vencimento = v_venc
           WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela = v_comp
             AND ps.status <> 'pago' AND ps.data_pagamento IS NULL
             AND NOT ps.vencimento_manual
             AND ps.data_vencimento IS DISTINCT FROM v_venc;
          PERFORM set_config('app.parcelas_servico_sistema', v_guc, true);
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- [contas-certas A2] valores por bloco calculados 1x por bloco da loja (nao por parcela)
  WITH vals AS (
    SELECT b.id AS pt_id, v.numero_parcela, v.valor
      FROM (SELECT DISTINCT ps0.producao_terceirizado_id AS id FROM parcelas_servico ps0 WHERE ps0.tenant_id = v_tenant) b
      CROSS JOIN LATERAL public._servico_parcelas_valores(b.id) v
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.data_entrega DESC NULLS LAST, t.servico, t.numero_parcela), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT ps.id AS parcela_id, ps.producao_terceirizado_id, ps.numero_parcela,
           neff.n_eff AS numero_parcelas,
           COALESCE(ct.nome,'—') AS servico,
           COALESCE(rep.nome, emp.nome_fantasia, col.nome, '—') AS responsavel,
           COALESCE(rep.cnpj, emp.cnpj) AS responsavel_cnpj,
           emp.nome_fantasia AS empresa_nome, emp.cnpj AS empresa_cnpj,
           rep.nome AS representante_nome, rep.cnpj AS representante_cnpj,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina,
           m.ref, m.nome AS modelo_nome,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)) AS custo_bruto,
           COALESCE(pt.desconto_total,0) AS desconto, COALESCE(pt.multa_total,0) AS multa,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS custo_liquido,
           -- [contas-certas A2] valor da parcela = fonte unica _servico_parcelas_valores: PAGA leva o valor_pago
           -- congelado; as nao pagas (1..n_eff) dividem o saldo (liquido - pago). Mesmo formato de saida.
           COALESCE(vp.valor, 0) AS valor_parcela,
           pt.data_entregue AS data_entrega, ps.data_vencimento, ps.status, ps.data_pagamento, ps.comprovante_url,
           (ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'))[ps.numero_parcela] AS dias_offset
    FROM parcelas_servico ps
    JOIN producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN representantes rep ON rep.id = pt.representante_id
    LEFT JOIN empresas emp ON emp.id = pt.empresa_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    -- Contagem EFETIVA de parcelas (mesma lógica do v_n da geração): nº de prazos válidos
    -- em emp.prazo_pagamento (capado em 24, casando LEAST(...,24)); sem prazo → numero_parcelas.
    -- Usada no output numero_parcelas, no rateio do valor e na visibilidade — display ≡ geração.
    LEFT JOIN vals vp ON vp.pt_id = ps.producao_terceirizado_id AND vp.numero_parcela = ps.numero_parcela
    CROSS JOIN LATERAL (SELECT LEAST(GREATEST(
        COALESCE(NULLIF(array_length(ARRAY(SELECT 1 FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'),1),0),
                 GREATEST(COALESCE(pt.numero_parcelas,1),1)),
      1), 24) AS n_eff) neff
    WHERE ps.tenant_id = v_tenant
      AND (
        -- [contas-certas A2] parcela PAGA sempre aparece - mesmo de bloco inativo ou interno (dinheiro pago nao some)
        (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
        OR (COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
            -- nao paga: so dentro da faixa efetiva n_eff - ou o COMPLEMENTO que a fonte unica pede (medios R16 RA1)
            AND (ps.numero_parcela <= neff.n_eff OR vp.numero_parcela IS NOT NULL)
            -- bloco elegível OU que já tenha alguma parcela paga (não esconde dinheiro pago)
            AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
                 OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado'))
                 OR EXISTS (SELECT 1 FROM parcelas_servico ps2 WHERE ps2.producao_terceirizado_id = pt.id AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL))))
      )
  ) t;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_parcelas(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _tipo NOT IN ('tecido','aviamento','p_acabado','p_importado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento, p_acabado ou p_importado';
  END IF;
  IF _tipo = 'tecido' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_aviamento WHERE id = _oc_id;
  ELSIF _tipo = 'p_importado' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_importado WHERE id = _oc_id;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;
  RETURN public._recalcular_parcelas_core(_oc_id, _tipo);
END;
$function$;

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

  -- [medios R10 fin #4] preco do ITEM da OC (o negociado na compra), senao o do cadastro do tecido - a mesma
  -- conta de precoItem (oc-tecido/shared.ts). Antes usava so artigos.preco e refazia o total pelo cadastro.
  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_recebida,0)*COALESCE(it.preco,a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0),
    valor_previsto_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_pedida,0)*COALESCE(it.preco,a.preco,0))
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

  -- [medios R10 fin #4] preco do ITEM da OC (o negociado na compra), senao o do cadastro do tecido - a mesma
  -- conta de precoItem (oc-tecido/shared.ts). Antes usava so artigos.preco e refazia o total pelo cadastro.
  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_recebida,0)*COALESCE(it.preco,a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0),
    valor_previsto_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_pedida,0)*COALESCE(it.preco,a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0)
  WHERE oc.id = v_oc;
  PERFORM public.recalcular_parcelas(v_oc, 'tecido');
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.servicos_financeiro()', 'a06f4cc32646cc41ed249d91a68dcd51'),
      ('public.recalcular_parcelas(uuid,text)', '5db77cc2c9c3dcf8bae6fc297457978a'),
      ('public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)', 'e16c604d1ce06fe77151118870c1257c'),
      ('public._receber_reposicao_troca_core(uuid,date,numeric)', '95fa0b06c2a5835789c8d0c3d10a8eb5')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's2_c6_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
