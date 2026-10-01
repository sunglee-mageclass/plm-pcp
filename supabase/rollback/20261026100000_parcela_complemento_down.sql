-- INVERSO de supabase/migrations/20261026100000_parcela_complemento.sql (achados MEDIOS R16: RA1, P-187 A).
-- Devolve o texto de ANTES das 7 funcoes: _recalcular_parcelas_core, gerar_parcelas_oc_p_acabado,
-- recalcular_parcelas_etiqueta, parcela_voltar_vencimento_automatico, _servico_parcelas_valores, servicos_financeiro e
-- parcela_servico_voltar_vencimento_automatico (sem parcela "complemento": saldo com tudo pago volta a nao virar conta).
-- Guarda: so roda se as 7 estao EXATAMENTE com o texto da ida (md5 de depois) e as dependencias seguem com o texto
-- conferido; outro -> P0001 e nada muda. Nada gravado muda na volta: complementos ja criados ficam como parcelas comuns
-- (os NAO pagos de OC somem no proximo recalculo do texto antigo - que apaga toda nao paga e so recria 1..n; os de
-- servico nao pagos acima de n_eff somem na proxima leitura de servicos_financeiro; os PAGOS ficam).
-- LIFO: este inverso roda ANTES de 20261020120000_pa_prazo_parser_unico_down, 20261020110000_servico_vencimento_manual_down,
-- 20261019210000_servico_parcela_valor_pago_down e 20261002100000_oc_data_nota_entrada_down (que conferem os textos que
-- esta volta devolve). Sem site a voltar.
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
      ('public._recalcular_parcelas_core(uuid,text)', '3dcb59e6958c89d2d06901c50af390d7'),
      ('public.gerar_parcelas_oc_p_acabado()', '99865f2335e0d2392a5bd42231c22dfd'),
      ('public.recalcular_parcelas_etiqueta(uuid)', '2127d43b976ab54a4490abae27fd4fd8'),
      ('public.parcela_voltar_vencimento_automatico(uuid)', '05f05e87411e9dcb6be9aeee9602cf70'),
      ('public._servico_parcelas_valores(uuid)', '913a2d324244a6a0b4bacb8fa94cb049'),
      ('public.servicos_financeiro()', 'a06f4cc32646cc41ed249d91a68dcd51'),
      ('public.parcela_servico_voltar_vencimento_automatico(uuid)', '9ea5069e414c736bf3dc02c22405cbeb'),
      ('public.fn_servico_parcela_valor_pago()', 'de9914b310477de1331f076a874696f1'),
      ('public.fn_parcela_vencimento_manual()', '4b56d7ad6d44a8e5dd5d11e71ee951cf'),
      ('public.fn_parcela_vencimento_guarda()', '506e431966a4891a178f38df08c88086'),
      ('public.fn_parcela_vencimento_reaplica()', '5896aac11ce8c1b80dec651f30e57a24'),
      ('public.fn_servico_parcela_vencimento_manual()', '3cbad67dc2f335929ffadb19d26b2019')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): % nao esta com o texto esperado da ida (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r16av_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._recalcular_parcelas_core(uuid,text)'), ('public.gerar_parcelas_oc_p_acabado()'), ('public.recalcular_parcelas_etiqueta(uuid)'), ('public.parcela_voltar_vencimento_automatico(uuid)'), ('public._servico_parcelas_valores(uuid)'), ('public.servicos_financeiro()'), ('public.parcela_servico_voltar_vencimento_automatico(uuid)')) v(s);

CREATE OR REPLACE FUNCTION public._recalcular_parcelas_core(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_base_data date;
  v_empresa uuid;
  -- Data-base do cronograma: `data_entrega` p/ tecido/aviamento, `data_pedido` p/
  -- p_acabado (nome do campo mantido pra não alterar o resto da função).
  v_data_entrega date;
  v_data_nota date;  -- Data da Nota de Entrada (24/set): quando preenchida, é a base do vencimento.
  v_quantidade_prazos integer;
  v_prazo_pagamento text;
  v_dias integer[];
  v_existentes_pagas integer := 0;
  v_pago_total numeric(12,2) := 0;
  v_deletadas integer := 0;
  v_criadas integer := 0;
  v_n_inserir integer := 0;
  v_restante_valor numeric(12,2);
  v_vencimento date;
  v_offset int;
  v_valor_a_inserir numeric(12,2);
  v_idx integer := 0;
  i integer;
BEGIN
  -- Importado: as parcelas nascem das ETAPAS da OC (não de prazo-dias). "Recalcular" =
  -- re-rodar o gerador que já neta as pagas. Retorna cedo, sem a lógica de prazo abaixo.
  IF _tipo = 'p_importado' THEN
    PERFORM public._gerar_parcelas_importado(_oc_id);
    RETURN jsonb_build_object('ok', true, 'importado', true);
  END IF;
  IF _tipo = 'tecido' AND EXISTS (SELECT 1 FROM public.ocs_tecido WHERE id = _oc_id AND COALESCE(is_rolo,false)) THEN
    RETURN jsonb_build_object('ok', true, 'rolo', true);
  END IF;
  IF _tipo NOT IN ('tecido','aviamento','p_acabado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento ou p_acabado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_oc_id::text));

  IF _tipo = 'tecido' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1),
           prazo_pagamento, COALESCE(valor_real_total,0), data_nota_entrada
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total, v_data_nota
    FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_data_nota
    FROM public.ocs_aviamento WHERE id = _oc_id;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco,0)),0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = _oc_id
      AND COALESCE(it.cancelado, false) = false;
  ELSE
    -- p_acabado: espelha gerar_parcelas_oc_p_acabado (base=data_pedido, total=valor_total_desconto).
    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0), data_nota_entrada
      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total, v_data_nota
    FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;

  v_dias := ARRAY(
    SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo_pagamento, ''), '[^0-9]+') AS t WHERE t ~ '^[0-9]+$'
  );
  IF array_length(v_dias, 1) >= 1 THEN
    v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
  ELSE
    v_n_parcelas := GREATEST(v_quantidade_prazos, 1);
  END IF;

  SELECT COUNT(*), COALESCE(SUM(valor),0)
    INTO v_existentes_pagas, v_pago_total
  FROM public.parcelas
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
      AND status IS DISTINCT FROM 'pago' AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  SELECT COUNT(*) INTO v_n_inserir
  FROM generate_series(1, v_n_parcelas) g(i)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
      AND numero_parcela = g.i
  );

  v_restante_valor := v_valor_total - v_pago_total;

  IF v_valor_total <= 0 OR v_restante_valor <= 0 OR v_n_inserir = 0 THEN
    RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
      'deletadas',v_deletadas,'criadas',0,'valor_total',v_valor_total,
      'restante',GREATEST(v_restante_valor,0),'fonte','prazo_pagamento');
  END IF;

  v_valor_parcela := ROUND(v_restante_valor / v_n_inserir, 2);
  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
  v_base_data := COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    IF EXISTS (SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
        AND numero_parcela = i) THEN
      CONTINUE;
    END IF;
    v_idx := v_idx + 1;
    IF array_length(v_dias, 1) >= i THEN v_vencimento := v_base_data + v_dias[i]; v_offset := v_dias[i];
    ELSE v_vencimento := v_base_data + (i * 30); v_offset := NULL; END IF;
    v_valor_a_inserir := CASE WHEN v_idx = v_n_inserir
      THEN v_restante_valor - v_valor_parcela * (v_n_inserir - 1) ELSE v_valor_parcela END;
    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'tecido', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar', v_offset);
    ELSIF _tipo = 'aviamento' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar', v_offset);
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_p_acabado_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'p_acabado', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar', v_offset);
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
    'deletadas',v_deletadas,'criadas',v_criadas,'valor_total',v_valor_total,
    'valor_parcela',v_valor_parcela,'fonte','prazo_pagamento');
END;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_p_acabado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias integer[];
  v_n_parcelas integer;
  v_valor_total numeric(14,2);
  v_pago_total numeric(14,2) := 0;
  v_restante_valor numeric(14,2);
  v_n_inserir integer := 0;
  v_valor_parcela numeric(12,2);
  v_valor_a_inserir numeric(12,2);
  v_vencimento date;
  v_base_data date;
  v_idx integer := 0;
  i integer;
begin
  -- [medios R10 fin #9] parser UNICO de prazo (o mesmo das outras OCs e de servicos_financeiro): separa por qualquer
  -- caractere nao numerico ('30/60', '30, 60', '30-60', '30 60'); antes so por '/' (e ' 60' caia fora).
  v_dias := array(
    select t::int
    from regexp_split_to_table(coalesce(NEW.prazo_pagamento, '30'), '[^0-9]+') as t
    where t ~ '^[0-9]+$'
  );
  if v_dias is null or array_length(v_dias, 1) is null or array_length(v_dias, 1) < 1 then
    v_dias := array[30];
  end if;
  v_n_parcelas := least(array_length(v_dias, 1), 24);

  -- Soma o que já está pago ANTES de apagar (o DELETE abaixo só atinge não-pagas
  -- de qualquer forma — ordem não muda o resultado, só espelha a leitura do core).
  select coalesce(sum(valor), 0) into v_pago_total
    from public.parcelas
   where oc_p_acabado_id = NEW.id
     and tipo_oc = 'p_acabado'
     and (status = 'pago' or data_pagamento is not null);

  delete from public.parcelas
   where oc_p_acabado_id = NEW.id
     and tipo_oc = 'p_acabado'
     and status is distinct from 'pago'
     and data_pagamento is null;

  -- Quantos slots (1..v_n_parcelas) ainda precisam de INSERT (os demais continuam
  -- ocupados pelas parcelas pagas preservadas pelo DELETE acima).
  select count(*) into v_n_inserir
    from generate_series(1, v_n_parcelas) g(i)
   where not exists (
     select 1 from public.parcelas
      where oc_p_acabado_id = NEW.id and numero_parcela = g.i
   );

  v_valor_total := coalesce(NEW.valor_total_desconto, 0);
  v_restante_valor := v_valor_total - v_pago_total;

  -- Nada a inserir: total zerado, já tudo pago (ou pago > total — não deveria
  -- acontecer, mas não inventa parcela negativa), ou todos os slots já ocupados.
  if v_valor_total <= 0 or v_restante_valor <= 0 or v_n_inserir = 0 then
    return NEW;
  end if;

  v_valor_parcela := round(v_restante_valor / v_n_inserir, 2);
  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
  v_base_data := coalesce(NEW.data_nota_entrada, NEW.data_pedido, current_date);

  for i in 1..v_n_parcelas loop
    if exists (
      select 1 from public.parcelas
       where oc_p_acabado_id = NEW.id and numero_parcela = i
    ) then
      continue;
    end if;
    v_idx := v_idx + 1;

    if array_length(v_dias, 1) >= i then
      v_vencimento := v_base_data + v_dias[i];
    else
      v_vencimento := v_base_data + (i * 30);
    end if;

    -- O ÚLTIMO SLOT REALMENTE INSERIDO (v_idx = v_n_inserir) absorve o resto de
    -- arredondamento de v_restante_valor — não necessariamente numero_parcela = N,
    -- se um número do meio já estiver ocupado por uma parcela paga.
    v_valor_a_inserir := case when v_idx = v_n_inserir
      then v_restante_valor - v_valor_parcela * (v_n_inserir - 1)
      else v_valor_parcela end;

    insert into public.parcelas (
      tenant_id, tipo_oc, oc_p_acabado_id, empresa_id,
      numero_parcela, valor, data_vencimento, status
    ) values (
      NEW.tenant_id, 'p_acabado', NEW.id, NEW.empresa_id,
      i, v_valor_a_inserir, v_vencimento, 'a_pagar'
    );
  end loop;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_parcelas_etiqueta(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_empresa uuid; v_data_entrega date; v_qprazos int; v_prazo text; v_nota date;
  v_valor_total numeric(12,2); v_dias int[]; v_n int; v_pago numeric(12,2) := 0; v_restante numeric(12,2);
  v_n_inserir int := 0; v_vparcela numeric(12,2); v_base date; v_venc date; v_ins numeric(12,2); v_idx int := 0; i int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_oc_id::text));
  SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada
    INTO v_tenant, v_empresa, v_data_entrega, v_qprazos, v_prazo, v_nota FROM public.ocs_etiqueta WHERE id = _oc_id;
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
  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
  v_base := COALESCE(v_nota, v_data_entrega, CURRENT_DATE);
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

CREATE OR REPLACE FUNCTION public.parcela_voltar_vencimento_automatico(_parcela_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas P-171 A] "Voltar ao calculo automatico": tira a marca vencimento_manual de UMA parcela NAO paga e
-- recalcula o vencimento dela pela regra da geradora da familia (Data da Nota + prazo; sem a Nota, o fallback de sempre).
-- So quem EDITA o Financeiro (mesma regra da tela: canEdit de financeiro_parcelas OU financeiro_calendario), na loja da
-- parcela, com o modulo financeiro ligado. Parcela paga -> P0001. O UPDATE liga app.parcelas_sistema (o gatilho de
-- marcacao nao conta como ajuste a mao) e passa pelo audit_parcelas (autor = quem clicou). O valor nao muda.
-- Regras espelhadas (nº = numero_parcela; dias = prazos da OC):
--   tecido/aviamento/etiqueta: base = COALESCE(nota, data_entrega, hoje); dias = numeros do prazo_pagamento;
--                              venc = base + dias[nº] (ou base + nº*30 alem do prazo)   (= _recalcular_parcelas_core)
--   p_acabado:                 base = COALESCE(nota, data_pedido, hoje); dias = numeros do prazo (padrao 30)
--                              (= gerar_parcelas_oc_p_acabado, a geradora de todo save)
--   p_importado:               venc = data da etapa de mesma ordem, senao data_pedido, senao hoje (= _gerar_parcelas_importado)
DECLARE
  p record;
  v_prazo text;
  v_base date;
  v_dias int[];
  v_venc date;
  v_guc text := COALESCE(current_setting('app.parcelas_sistema', true), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.parcelas WHERE id = _parcela_id FOR UPDATE;
  IF NOT FOUND OR p.tenant_id IS DISTINCT FROM public.get_user_tenant_id() THEN
    RAISE EXCEPTION 'parcela_nao_encontrada: parcela inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.tenant_module_enabled('financeiro') THEN
    RAISE EXCEPTION 'Modulo financeiro nao habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.user_can_edit('financeiro_parcelas') OR public.user_can_edit('financeiro_calendario')) THEN
    RAISE EXCEPTION 'Sem permissao para editar o Financeiro' USING ERRCODE = '42501';
  END IF;
  IF p.status = 'pago' OR p.data_pagamento IS NOT NULL THEN
    RAISE EXCEPTION 'parcela_paga: o vencimento de parcela paga nao muda' USING ERRCODE = 'P0001';
  END IF;

  IF p.tipo_oc = 'tecido' THEN
    SELECT o.prazo_pagamento, COALESCE(o.data_nota_entrada, o.data_entrega, CURRENT_DATE) INTO v_prazo, v_base
      FROM public.ocs_tecido o WHERE o.id = p.oc_tecido_id;
  ELSIF p.tipo_oc = 'aviamento' THEN
    SELECT o.prazo_pagamento, COALESCE(o.data_nota_entrada, o.data_entrega, CURRENT_DATE) INTO v_prazo, v_base
      FROM public.ocs_aviamento o WHERE o.id = p.oc_aviamento_id;
  ELSIF p.tipo_oc = 'etiqueta' THEN
    SELECT o.prazo_pagamento, COALESCE(o.data_nota_entrada, o.data_entrega, CURRENT_DATE) INTO v_prazo, v_base
      FROM public.ocs_etiqueta o WHERE o.id = p.oc_etiqueta_id;
  ELSIF p.tipo_oc = 'p_acabado' THEN
    SELECT COALESCE(o.prazo_pagamento, '30'), COALESCE(o.data_nota_entrada, o.data_pedido, CURRENT_DATE) INTO v_prazo, v_base
      FROM public.ocs_p_acabado o WHERE o.id = p.oc_p_acabado_id;
  ELSIF p.tipo_oc = 'p_importado' THEN
    SELECT COALESCE(et.data_vencimento, o.data_pedido, CURRENT_DATE) INTO v_venc
      FROM public.ocs_importado o
      LEFT JOIN public._imp_etapas_brl_oc(o.id) et ON et.ordem = p.numero_parcela
     WHERE o.id = p.oc_importado_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'oc_nao_encontrada: a OC desta parcela nao existe' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'tipo_oc_sem_regra: %', p.tipo_oc USING ERRCODE = 'P0001';
  END IF;

  IF p.tipo_oc <> 'p_importado' THEN
    IF v_base IS NULL THEN
      RAISE EXCEPTION 'oc_nao_encontrada: a OC desta parcela nao existe' USING ERRCODE = 'P0001';
    END IF;
    IF p.tipo_oc = 'p_acabado' THEN
      -- [medios R10 fin #9] mesmo parser da geradora gerar_parcelas_oc_p_acabado (qualquer separador nao numerico)
      v_dias := ARRAY(SELECT t::int FROM regexp_split_to_table(v_prazo, '[^0-9]+') AS t WHERE t ~ '^[0-9]+$');
      IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN v_dias := ARRAY[30]; END IF;
    ELSE
      v_dias := ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo, ''), '[^0-9]+') AS t WHERE t ~ '^[0-9]+$');
    END IF;
    IF array_length(v_dias, 1) >= p.numero_parcela THEN
      v_venc := v_base + v_dias[p.numero_parcela];
    ELSE
      v_venc := v_base + (p.numero_parcela * 30);
    END IF;
  END IF;

  PERFORM set_config('app.parcelas_sistema', 'on', true);
  UPDATE public.parcelas SET data_vencimento = v_venc, vencimento_manual = false WHERE id = _parcela_id;
  PERFORM set_config('app.parcelas_sistema', v_guc, true);

  RETURN jsonb_build_object('id', _parcela_id, 'data_vencimento', v_venc, 'vencimento_manual', false);
END
$function$;

CREATE OR REPLACE FUNCTION public._servico_parcelas_valores(_pt uuid)
 RETURNS TABLE(numero_parcela integer, valor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas A2] FONTE UNICA do valor das parcelas de um bloco de servico (producao_terceirizados):
--   liquido = preco x qtd enviada - desconto + multa;
--   PAGA  -> o valor_pago congelado no pagamento (legado sem valor_pago: a formula antiga, igual a tela de antes);
--   NAO PAGAS dentro de 1..n_eff -> dividem o saldo (liquido - soma das pagas) em partes iguais; a ultima nao paga leva
--   o arredondamento; saldo <= 0 -> valem 0. n_eff = a mesma conta de servicos_financeiro (nº de prazos da empresa,
--   senao numero_parcelas; entre 1 e 24). Espelha _recalcular_parcelas_core (congela as pagas e divide o saldo).
-- Devolve uma linha por parcela PAGA (qualquer numero) e por numero NAO pago em 1..n_eff (exista a linha ou nao).
-- So conta parcelas da MESMA loja do bloco (L1: um INSERT de cliente com o id de bloco de outra loja nao entra na conta).
DECLARE
  v_tenant uuid;
  v_liq numeric;
  v_neff int;
  v_pago numeric := 0;
  v_pagos int[] := '{}';
  v_k int;
  v_saldo numeric;
  v_parte numeric;
  v_idx int := 0;
  r record;
  i int;
BEGIN
  SELECT (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)),
         LEAST(GREATEST(
           COALESCE(NULLIF(array_length(ARRAY(SELECT 1 FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'),1),0),
                    GREATEST(COALESCE(pt.numero_parcelas,1),1)),
         1), 24),
         c.tenant_id
    INTO v_liq, v_neff, v_tenant
    FROM public.producao_terceirizados pt
    JOIN public.cad c ON c.id = pt.cad_id
    LEFT JOIN public.empresas emp ON emp.id = pt.empresa_id
   WHERE pt.id = _pt;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR r IN SELECT ps.numero_parcela AS n, ps.valor_pago AS vp
             FROM public.parcelas_servico ps
            WHERE ps.producao_terceirizado_id = _pt AND ps.tenant_id = v_tenant
              AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
            ORDER BY ps.numero_parcela LOOP
    numero_parcela := r.n;
    valor := COALESCE(r.vp,
               CASE WHEN r.n >= v_neff THEN v_liq - round(v_liq / v_neff, 2) * (v_neff - 1)
                    ELSE round(v_liq / v_neff, 2) END);
    v_pago := v_pago + valor;
    v_pagos := v_pagos || r.n;
    RETURN NEXT;
  END LOOP;

  SELECT count(*) INTO v_k FROM generate_series(1, v_neff) g(n) WHERE NOT (g.n = ANY (v_pagos));
  IF v_k = 0 THEN
    RETURN;
  END IF;
  v_saldo := GREATEST(v_liq - v_pago, 0);
  v_parte := round(v_saldo / v_k, 2);
  FOR i IN 1..v_neff LOOP
    CONTINUE WHEN i = ANY (v_pagos);
    v_idx := v_idx + 1;
    numero_parcela := i;
    valor := CASE WHEN v_idx = v_k THEN v_saldo - v_parte * (v_k - 1) ELSE v_parte END;
    RETURN NEXT;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
  v_prazo text; v_dias int[]; v_n int; v_base date; v_venc date; v_off int; i int;
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

      -- Deleta só parcelas NÃO pagas acima de v_n (nunca apaga paga).
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id
         AND ps.numero_parcela > v_n
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
            -- nao paga: so dentro da faixa efetiva n_eff
            AND ps.numero_parcela <= neff.n_eff
            -- bloco elegível OU que já tenha alguma parcela paga (não esconde dinheiro pago)
            AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
                 OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado'))
                 OR EXISTS (SELECT 1 FROM parcelas_servico ps2 WHERE ps2.producao_terceirizado_id = pt.id AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL))))
      )
  ) t;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.parcela_servico_voltar_vencimento_automatico(_parcela_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R10 fin #6, P-171 A] "Voltar ao calculo automatico" de UMA parcela de SERVICO NAO paga: limpa
-- vencimento_manual e recalcula a data pela MESMA regra do LOOP de servicos_financeiro:
--   base = COALESCE(data_entregue, data_enviado) do servico; dias = numeros do prazo_pagamento da empresa
--   (regexp '[^0-9]+'); venc = base + dias[nº] quando existe o nº-esimo prazo, senao a base (flat, NAO nº*30).
-- So quem EDITA a aba Servicos do Financeiro (user_can_edit('financeiro_servicos')), na loja da parcela, com o modulo
-- financeiro ligado; senao 42501. Parcela paga -> P0001. Sem base (servico sem entrega nem envio) -> P0001.
-- O UPDATE liga app.parcelas_servico_sistema SO em volta dele (o gatilho de marcacao nao conta como ajuste a mao) e
-- passa pelo audit_parcelas_servico (autor = quem clicou). O valor nao muda.
DECLARE
  p record;
  v_base date;
  v_prazo text;
  v_dias int[];
  v_venc date;
  v_guc text := COALESCE(current_setting('app.parcelas_servico_sistema', true), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.parcelas_servico WHERE id = _parcela_id FOR UPDATE;
  IF NOT FOUND OR p.tenant_id IS DISTINCT FROM public.get_user_tenant_id() THEN
    RAISE EXCEPTION 'parcela_nao_encontrada: parcela inexistente ou de outra loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.tenant_module_enabled('financeiro') THEN
    RAISE EXCEPTION 'Modulo financeiro nao habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_edit('financeiro_servicos') THEN
    RAISE EXCEPTION 'Sem permissao para editar os Servicos do Financeiro' USING ERRCODE = '42501';
  END IF;
  IF p.status = 'pago' OR p.data_pagamento IS NOT NULL THEN
    RAISE EXCEPTION 'parcela_paga: o vencimento de parcela paga nao muda' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(pt.data_entregue, pt.data_enviado), emp.prazo_pagamento INTO v_base, v_prazo
    FROM public.producao_terceirizados pt
    JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = p.tenant_id
    LEFT JOIN public.empresas emp ON emp.id = pt.empresa_id
   WHERE pt.id = p.producao_terceirizado_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'servico_nao_encontrado: o servico desta parcela nao existe nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'servico_sem_data_base: o servico nao tem data de entrega nem de envio para calcular o vencimento'
      USING ERRCODE = 'P0001';
  END IF;
  v_dias := ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo, ''), '[^0-9]+') AS t WHERE t ~ '^[0-9]+$');
  IF array_length(v_dias, 1) >= p.numero_parcela THEN
    v_venc := v_base + v_dias[p.numero_parcela];
  ELSE
    v_venc := v_base;
  END IF;

  PERFORM set_config('app.parcelas_servico_sistema', 'on', true);
  UPDATE public.parcelas_servico SET data_vencimento = v_venc, vencimento_manual = false WHERE id = _parcela_id;
  PERFORM set_config('app.parcelas_servico_sistema', v_guc, true);

  RETURN jsonb_build_object('id', _parcela_id, 'data_vencimento', v_venc, 'vencimento_manual', false);
END
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._recalcular_parcelas_core(uuid,text)', '1b03dbd69233d761fd150ab45722b7f6'),
      ('public.gerar_parcelas_oc_p_acabado()', '4b90865ad77d4f68a71c41959a283d62'),
      ('public.recalcular_parcelas_etiqueta(uuid)', 'cf86f487ca3d643f625087a55395ef73'),
      ('public.parcela_voltar_vencimento_automatico(uuid)', 'ef80c3c810c22bb32d04d818ebbc6e9c'),
      ('public._servico_parcelas_valores(uuid)', '3fa1069d5eff17633c0d31b8ba392225'),
      ('public.servicos_financeiro()', 'da903333e753e75c8a6e033226b0a78c'),
      ('public.parcela_servico_voltar_vencimento_automatico(uuid)', '4d6681d10b3e0cf3a4ea57abd3b2ac4d')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _r16av_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._recalcular_parcelas_core(uuid,text)'),
                                 ('public.recalcular_parcelas_etiqueta(uuid)'),
                                 ('public._servico_parcelas_valores(uuid)'),
                                 ('public.fn_servico_parcela_valor_pago()'),
                                 ('public.fn_parcela_vencimento_manual()'),
                                 ('public.fn_parcela_vencimento_guarda()'),
                                 ('public.fn_parcela_vencimento_reaplica()'),
                                 ('public.fn_servico_parcela_vencimento_manual()')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- RPCs da tela: authenticated SIM; anon e PUBLIC NAO (como hoje).
  FOR r IN SELECT * FROM (VALUES ('public.parcela_voltar_vencimento_automatico(uuid)'),
                                 ('public.servicos_financeiro()'),
                                 ('public.parcela_servico_voltar_vencimento_automatico(uuid)')) v(s) LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_ra1 (volta): ACL de % fora do esperado (authenticated sim; anon/PUBLIC nao)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'trg_gerar_parcelas_ocpa' AND t.tgrelid = to_regclass('public.ocs_p_acabado')
                    AND t.tgfoid = to_regprocedure('public.gerar_parcelas_oc_p_acabado()') AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'medios_r16_ra1 (volta): gatilho trg_gerar_parcelas_ocpa ausente ou desligado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
