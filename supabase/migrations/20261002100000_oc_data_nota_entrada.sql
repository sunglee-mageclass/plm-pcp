-- Data da Nota de Entrada nas 5 OCs (Tecido, Aviamento, Insumo, P. Acabado, P. Importado).
-- Desenho aprovado pelo dono em 24/set/2026. Spec: docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md
-- Plano: docs/superpowers/plans/2026-09-24-data-nota-entrada.md (Task 3).
-- ARQUIVO GERADO por .superpowers/nota/mig/gerar_sql.py a partir do texto VIVO das 10 funções (cópia local = produção em
-- 23/set) + o diff mínimo do plano. NÃO editar à mão — regenerar.
--
--  1. coluna data_nota_entrada date nas 5 tabelas de OC;
--  2. base do vencimento = COALESCE(data_nota_entrada, base de hoje) nos geradores/recálculos de Tecido, Aviamento, Insumo e
--     P. Acabado. O Importado NÃO muda (vencimento = etapas de câmbio; a data só é registrada);
--  3. os 5 saves gravam a chave data_nota_entrada do jsonb (chave ausente = mantém; "" ou null = limpa);
--  4. mudar a data numa OC já recebida recalcula as NÃO pagas (pagas intactas, soma = total da OC);
--  5. D7 (PENDENTE DO DONO — recomendação): gatilho que recusa data futura ou anterior ao pedido, nas 5 OCs;
--  6. ACL (invariante #9).
-- TRAVAS NO ARQUIVO (R9 — lição do Aviso Global): `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout =
-- '3s'` logo depois do `BEGIN;`, porque `psql -f` é o caminho padrão do CLAUDE.md. O caminho DESTA frente continua sendo o
-- aplica_v2 (R3 — reinjeta as mesmas 2 linhas, redundante e inofensivo, e dá a nova tentativa). Horário calmo.
-- TRAVAS QUE A MIGRATION PEGA: ALTER TABLE ADD COLUMN = AccessExclusive nas 5 OCs até o COMMIT (e ShareRowExclusive dos
-- CREATE/DROP TRIGGER); as policies de OUTRAS tabelas que leem as OCs (enderecamento_tecido endtec_ins/endtec_upd,
-- ocs_tecido_itens, ocs_aviamento_itens, ocs_etiqueta_itens — cópia, 24/set) esperam junto. NÃO há DDL de policy (nenhum
-- CREATE/DROP/ALTER POLICY): o hook supautils.policy_grants (AccessExclusive em 24 tabelas de auth/storage/realtime até o
-- COMMIT) NÃO dispara. Se um dia entrar DDL de policy aqui: vai no FIM do arquivo e este cabeçalho deixa de dizer isso.
-- Inverso: supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql (DESTRUTIVO: apaga as datas digitadas).
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

-- 0) Guarda (R2 do G-plano): cada função está EXATAMENTE no texto de 24/set (md5_antes) ou no desta migration
--    (md5_depois = reaplicação). Qualquer outro texto = outra frente mudou depois → recusa (nada é aplicado).
DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.gerar_parcelas_oc_tecido()', 'ac9fb224249f42133f5bf2750aba5d1c', 'fc5ce68cc48762f681d30168b1e172b6'),
    ('public.gerar_parcelas_oc_aviamento()', '345e55d865a0e4713e6ccbc62f50830d', 'e98640190802afd6de9f82ac4ecb39c3'),
    ('public.gerar_parcelas_oc_p_acabado()', '1d8286d877f32a437b344a0da1766ccb', '2229a974f172a8302085f15ab2d63ae9'),
    ('public._recalcular_parcelas_core(uuid,text)', 'b8af65bc500958202db25ddb5f3d3eed', '1b03dbd69233d761fd150ab45722b7f6'),
    ('public.recalcular_parcelas_etiqueta(uuid)', 'd60ab89c8c25a830aa7a7789ff97eef0', 'cf86f487ca3d643f625087a55395ef73'),
    ('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'b5255dc864f0e7f9f39236b4b9c531d6', 'aa64df90ef7daad675a69dbab7c1d585'),
    ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', '56af6c8a9ecb5619be2de1f2068553b3', '3c5a3d108d7f6e5a37319ceccb4406e2'),
    ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', 'd92d27b1d774ca4d867fc9151f774fda', '4396c443f53c063b31159018bfa3914e'),
    ('public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)', 'bd8139b1a1b1dee8b4b90e4327cb152c', '70b852884f47e55d01cd2b18846bbfa8'),
    ('public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)', 'b74cd38a16fa08482551f1fb7e1487bb', '3b9077848c79865efbe15f0499595d69'),
    ('public.fn_oc_nota_entrada_recalc()', NULL, '4df62f1206fc0ad006f04851c736019e'),
    ('public.fn_oc_nota_entrada_valida()', NULL, 'e2c335a5e09cb45557babadd542cf958')
  ) AS t(sig, md5_antes, md5_depois) LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      IF r.md5_antes IS NOT NULL THEN
        RAISE EXCEPTION 'data_nota_entrada: % não existe neste banco', r.sig USING ERRCODE = 'P0001';
      END IF;
      CONTINUE;  -- função nova desta migration ainda não criada
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.sig)));
    CONTINUE WHEN v_md5 = r.md5_depois;
    IF r.md5_antes IS NULL OR v_md5 <> r.md5_antes THEN
      RAISE EXCEPTION 'data_nota_entrada: % não está nem no texto de 24/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration a partir do texto VIVO (plano, Task 3) antes de aplicar',
        r.sig, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) Coluna nas 5 OCs (sem default, sem backfill)
ALTER TABLE public.ocs_tecido ADD COLUMN IF NOT EXISTS data_nota_entrada date;
ALTER TABLE public.ocs_aviamento ADD COLUMN IF NOT EXISTS data_nota_entrada date;
ALTER TABLE public.ocs_etiqueta ADD COLUMN IF NOT EXISTS data_nota_entrada date;
ALTER TABLE public.ocs_p_acabado ADD COLUMN IF NOT EXISTS data_nota_entrada date;
ALTER TABLE public.ocs_importado ADD COLUMN IF NOT EXISTS data_nota_entrada date;
COMMENT ON COLUMN public.ocs_tecido.data_nota_entrada IS 'Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_entrega). Vazia em OC recebida = vencimento provisório.';
COMMENT ON COLUMN public.ocs_aviamento.data_nota_entrada IS 'Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_entrega). Vazia em OC recebida = vencimento provisório.';
COMMENT ON COLUMN public.ocs_etiqueta.data_nota_entrada IS 'Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_entrega). Vazia em OC recebida = vencimento provisório.';
COMMENT ON COLUMN public.ocs_p_acabado.data_nota_entrada IS 'Data da Nota de Entrada (NF do fornecedor). Base do vencimento das parcelas a pagar: COALESCE(data_nota_entrada, data_pedido). Vazia em OC recebida = vencimento provisório.';
COMMENT ON COLUMN public.ocs_importado.data_nota_entrada IS 'Data da Nota de Entrada (NF do fornecedor). Só registro — os vencimentos seguem as etapas de câmbio.';

-- 2) e 3) As 10 funções: texto de 24/set + diff mínimo (.superpowers/nota/mig/diff-esperado.txt)
CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n_parcelas integer;
  v_valor_parcela numeric(12,2);
  v_valor_ultima numeric(12,2);
  v_valor_total numeric(12,2);
  v_base_data date;
  v_dias integer[];
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF COALESCE(NEW.is_rolo, false) THEN RETURN NEW; END IF;
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_tecido_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_valor_total := COALESCE(NEW.valor_real_total, 0);
    IF v_valor_total <= 0 THEN
      RETURN NEW;  -- OC sem valor (ex.: itens cancelados) não gera parcela.
    END IF;

    v_dias := ARRAY(
      SELECT t::int FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF array_length(v_dias, 1) >= i THEN
        v_vencimento := v_base_data + v_dias[i];
      ELSE
        v_vencimento := v_base_data + (i * 30);
      END IF;
      v_valor_a_inserir := CASE WHEN i = v_n_parcelas THEN v_valor_ultima ELSE v_valor_parcela END;
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (NEW.tenant_id, 'tecido', NEW.id, NEW.empresa_id, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_aviamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_valor_ultima numeric(12,2);
  v_base_data date;
  v_dias integer[];
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_aviamento_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco, 0)), 0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = NEW.id
      AND COALESCE(it.cancelado, false) = false;

    IF v_valor_total <= 0 THEN
      RETURN NEW;  -- OC sem valor não gera parcela.
    END IF;

    v_dias := ARRAY(
      SELECT t::int FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF array_length(v_dias, 1) >= i THEN
        v_vencimento := v_base_data + v_dias[i];
      ELSE
        v_vencimento := v_base_data + (i * 30);
      END IF;
      v_valor_a_inserir := CASE WHEN i = v_n_parcelas THEN v_valor_ultima ELSE v_valor_parcela END;
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (NEW.tenant_id, 'aviamento', NEW.id, NEW.empresa_id, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END LOOP;
  END IF;
  RETURN NEW;
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
  v_dias := array(
    select t::int
    from unnest(string_to_array(coalesce(NEW.prazo_pagamento, '30'), '/')) as t
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

CREATE OR REPLACE FUNCTION public._salvar_oc_tecido_core(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
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
  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_tecido
        where id = _oc_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.artigos a ON a.id = (e->>'artigo_id')::uuid
    WHERE e->>'artigo_id' IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Tecido de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_tecido WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_tecido
      (tenant_id, numero_pedido, responsavel_id, responsavel_nome, empresa_id, representante_id,
       data_pedido, data_prevista_entrega, data_entrega, prazo_pagamento, quantidade_prazos,
       observacoes_entrega, observacoes_defeitos, anexo_pedido_url, modelo_sugerido_url, nf_url,
       parcelas_recebimento, valor_previsto_total, valor_real_total, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, (_oc->>'responsavel_id')::uuid, _oc->>'responsavel_nome',
       (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1),
       _oc->>'observacoes_entrega', _oc->>'observacoes_defeitos', _oc->>'anexo_pedido_url',
       _oc->>'modelo_sugerido_url', _oc->>'nf_url', COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
       COALESCE((_oc->>'valor_previsto_total')::numeric, 0), COALESCE((_oc->>'valor_real_total')::numeric, 0),
       'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida,
       quantidade_recebida, rendimento, cancelado, rolos_planejados, preco)
    SELECT v_oc_id, (e->>'artigo_id')::uuid, (e->>'artigo_numero')::int, (e->>'variante_tecido_id')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           (e->>'rendimento')::numeric, COALESCE((e->>'cancelado')::boolean, false), e->'rolos_planejados',
           NULLIF(e->>'preco','')::numeric
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_tecido SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_tecido
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL);
    DELETE FROM public.ocs_tecido_itens WHERE oc_tecido_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_tecido_itens SET
        artigo_id = (r->>'artigo_id')::uuid,
        artigo_numero = (r->>'artigo_numero')::int,
        variante_tecido_id = (r->>'variante_tecido_id')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        rendimento = (r->>'rendimento')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false),
        rolos_planejados = r->'rolos_planejados',
        preco = NULLIF(r->>'preco','')::numeric
      WHERE id = (r->>'id')::uuid AND oc_tecido_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida,
       quantidade_recebida, rendimento, cancelado, rolos_planejados, preco)
    SELECT v_oc_id, (e->>'artigo_id')::uuid, (e->>'artigo_numero')::int, (e->>'variante_tecido_id')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           (e->>'rendimento')::numeric, COALESCE((e->>'cancelado')::boolean, false), e->'rolos_planejados',
           NULLIF(e->>'preco','')::numeric
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL;

    UPDATE public.ocs_tecido SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_id = (_oc->>'responsavel_id')::uuid,
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      observacoes_entrega = _oc->>'observacoes_entrega',
      observacoes_defeitos = _oc->>'observacoes_defeitos',
      anexo_pedido_url = _oc->>'anexo_pedido_url',
      modelo_sugerido_url = _oc->>'modelo_sugerido_url',
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      valor_previsto_total = COALESCE((_oc->>'valor_previsto_total')::numeric, 0),
      valor_real_total = COALESCE((_oc->>'valor_real_total')::numeric, 0),
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- A OC dita o preço, mas o cadastro reflete o preço da OC MAIS RECENTE por variante (por
  -- data_pedido, depois created_at). Editar uma OC antiga NÃO muda o cadastro se há OC mais recente.
  UPDATE public.variantes_tecido vt SET preco = latest.preco
  FROM (
    SELECT DISTINCT ON (oti.variante_tecido_id) oti.variante_tecido_id, oti.preco
    FROM public.ocs_tecido_itens oti
    JOIN public.ocs_tecido oc ON oc.id = oti.oc_tecido_id
    WHERE oc.tenant_id = v_tenant
      AND oti.preco IS NOT NULL
      AND COALESCE(oti.cancelado, false) = false
      AND oti.variante_tecido_id IN (
        SELECT (e->>'variante_tecido_id')::uuid FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
        WHERE e->>'variante_tecido_id' IS NOT NULL
      )
    ORDER BY oti.variante_tecido_id, oc.data_pedido DESC NULLS LAST, oc.created_at DESC
  ) latest
  WHERE vt.id = latest.variante_tecido_id AND vt.tenant_id = v_tenant AND vt.preco IS DISTINCT FROM latest.preco;

  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'tecido');
  END IF;

  RETURN v_oc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._salvar_oc_aviamento_core(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
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
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1), _oc->>'nf_url',
       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
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
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
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

CREATE OR REPLACE FUNCTION public.salvar_oc_etiqueta(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
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
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int,1), _oc->>'nf_url',
       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado',
       NULLIF(_oc->>'data_nota_entrada', '')::date)
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
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  IF v_recebido THEN PERFORM public.recalcular_parcelas_etiqueta(v_oc_id); END IF;
  RETURN v_oc_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._salvar_oc_p_acabado_core(_id uuid, _dados jsonb, _grade jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_bruto numeric;
  v_total_desc numeric;
  v_unit_real numeric;
  v_soma_pedida numeric := 0;
  v_tem_negativo boolean := false;
  v_produto_id uuid;
  v_atual_status text;
  v_atual_valor_unitario numeric;
  v_atual_desconto_pct numeric;
  v_atual_qtd_total int;
  v_atual_grade jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_p_acabado
        where id = _id and tenant_id = v_tenant for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  v_nome := nullif(_dados->>'nome_produto', '');
  if _id is null then
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
  else
    select status, valor_unitario, desconto_pct, qtd_total, grade_detalhe, produto_acabado_id
      into v_atual_status, v_atual_valor_unitario, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade, v_produto_id
      from public.ocs_p_acabado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario is distinct from v_atual_valor_unitario
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

  select
    coalesce(bool_or(
      coalesce(nullif(t.value->>'pedida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'recebida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'defeito', '')::numeric, 0) < 0
    ), false),
    coalesce(sum(coalesce(nullif(t.value->>'pedida', '')::numeric, 0)), 0)
  into v_tem_negativo, v_soma_pedida
  from jsonb_each(coalesce(_grade, '{}'::jsonb)) o
  cross join lateral jsonb_each(o.value) t;

  if v_tem_negativo then
    raise exception 'As quantidades da grade não podem ser negativas.' using errcode = 'P0001';
  end if;
  if v_qtd_total > 0 and v_soma_pedida <> v_qtd_total then
    raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd_total
      using errcode = 'P0001';
  end if;

  v_bruto := v_qtd_total * v_valor_unitario;
  v_total_desc := v_bruto * (1 - v_desconto_pct / 100);
  v_unit_real := case when v_qtd_total > 0 then v_total_desc / v_qtd_total else 0 end;

  if _id is null then
    v_produto_id := nullif(_dados->>'produto_acabado_id', '')::uuid;
    if v_produto_id is not null then
      perform 1 from public.produtos_acabados where id = v_produto_id and tenant_id = v_tenant;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
    end if;

    insert into public.ocs_p_acabado (
      tenant_id, produto_acabado_id, numero, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega, prazo_pagamento, parcelas_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_unitario, desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url, data_nota_entrada
    ) values (
      v_tenant, v_produto_id, nullif(_dados->>'numero', ''), v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(nullif(_dados->>'data_pedido', '')::date, current_date),
      nullif(_dados->>'data_prevista', '')::date, nullif(_dados->>'data_entrega', '')::date,
      coalesce(nullif(_dados->>'prazo_pagamento', ''), '30'),
      coalesce(nullif(_dados->>'parcelas_entrega', '')::int, 1),
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), coalesce(_grade, '{}'::jsonb), coalesce(_dados->'variantes', '[]'::jsonb),
      v_qtd_total, v_valor_unitario, v_desconto_pct, v_bruto, v_total_desc, v_unit_real,
      _dados->>'nota_fiscal', nullif(_dados->>'responsavel_recebimento_id', '')::uuid, _dados->>'devolucao', _dados->>'revisao',
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url', nullif(_dados->>'data_nota_entrada', '')::date
    ) returning id into v_id;
  else
    update public.ocs_p_acabado set
      numero = coalesce(nullif(_dados->>'numero', ''), numero),
      nome_produto = coalesce(v_nome, nome_produto),
      grupo_id = nullif(_dados->>'grupo_id', '')::uuid,
      categoria_id = nullif(_dados->>'categoria_id', '')::uuid,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      data_pedido = coalesce(nullif(_dados->>'data_pedido', '')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista', '')::date,
      data_entrega = nullif(_dados->>'data_entrega', '')::date,
      prazo_pagamento = coalesce(nullif(_dados->>'prazo_pagamento', ''), prazo_pagamento),
      parcelas_entrega = coalesce(nullif(_dados->>'parcelas_entrega', '')::int, parcelas_entrega),
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      grade_detalhe = coalesce(_grade, '{}'::jsonb),
      variantes = coalesce(_dados->'variantes', '[]'::jsonb),
      qtd_total = v_qtd_total,
      valor_unitario = v_valor_unitario,
      desconto_pct = v_desconto_pct,
      valor_bruto = v_bruto,
      valor_total_desconto = v_total_desc,
      valor_unitario_real = v_unit_real,
      nota_fiscal = _dados->>'nota_fiscal',
      responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
      devolucao = _dados->>'devolucao',
      revisao = _dados->>'revisao',
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      anexo_nf_url = _dados->>'anexo_nf_url',
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
  end if;

  if v_produto_id is not null then
    update public.produtos_acabados
      set valor_unitario = v_valor_unitario, desconto_pct = v_desconto_pct, updated_at = now()
      where id = v_produto_id and tenant_id = v_tenant;

    perform public._pa_recomputar_precos_modelo(v_produto_id);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._salvar_oc_importado_core(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario_m1 numeric;
  v_desconto_pct numeric;
  v_bruto numeric;
  v_total_desc numeric;
  v_unit_real numeric;
  v_soma_pedida numeric := 0;
  v_tem_negativo boolean := false;
  v_produto_id uuid;
  v_etapas jsonb;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  -- Estado atual da OC (só preenchido quando _id is not null) — guarda de congelamento.
  v_atual_status text;
  v_atual_valor_unitario_m1 numeric;
  v_atual_desconto_pct numeric;
  v_atual_qtd_total int;
  v_atual_grade jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_importado
        where id = _id and tenant_id = v_tenant for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  v_nome := nullif(_dados->>'nome_produto', '');
  if _id is null then
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
  else
    select status, valor_unitario_m1, desconto_pct, qtd_total, grade_detalhe, produto_importado_id
      into v_atual_status, v_atual_valor_unitario_m1, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade, v_produto_id
      from public.ocs_importado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario_m1 := coalesce(nullif(_dados->>'valor_unitario_m1', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

  -- Congela ao receber: valor/qtd pedida e a grade "pedida" não mudam mais por este
  -- caminho (recebida/defeito seguem editáveis via receber_oc_importado). NF/revisão/
  -- devolução/anexos/nome/categorias/fornecedor/datas seguem editáveis normalmente.
  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario_m1 is distinct from v_atual_valor_unitario_m1
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

  -- Valida células (nenhuma negativa) e soma da grade "pedida" contra qtd_total.
  select
    coalesce(bool_or(
      coalesce(nullif(t.value->>'pedida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'recebida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'defeito', '')::numeric, 0) < 0
    ), false),
    coalesce(sum(coalesce(nullif(t.value->>'pedida', '')::numeric, 0)), 0)
  into v_tem_negativo, v_soma_pedida
  from jsonb_each(coalesce(_grade, '{}'::jsonb)) o
  cross join lateral jsonb_each(o.value) t;

  if v_tem_negativo then
    raise exception 'As quantidades da grade não podem ser negativas.' using errcode = 'P0001';
  end if;
  if v_qtd_total > 0 and v_soma_pedida <> v_qtd_total then
    raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd_total
      using errcode = 'P0001';
  end if;

  -- Derivados (só exibição — o custo real é o landed, recalculado no final).
  v_bruto := v_qtd_total * v_valor_unitario_m1;
  v_total_desc := v_bruto * (1 - v_desconto_pct / 100);
  v_unit_real := case when v_qtd_total > 0 then v_total_desc / v_qtd_total else 0 end;

  if _id is null then
    v_produto_id := nullif(_dados->>'produto_importado_id', '')::uuid;
    if v_produto_id is not null then
      perform 1 from public.produtos_importados where id = v_produto_id and tenant_id = v_tenant;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
    end if;

    insert into public.ocs_importado (
      tenant_id, produto_importado_id, numero, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, data_nota_entrada
    ) values (
      v_tenant, v_produto_id, nullif(_dados->>'numero', ''), v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(nullif(_dados->>'data_pedido', '')::date, current_date),
      nullif(_dados->>'data_prevista', '')::date, nullif(_dados->>'data_entrega', '')::date,
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), coalesce(_grade, '{}'::jsonb), coalesce(_dados->'variantes', '[]'::jsonb),
      v_qtd_total, v_bruto, v_total_desc, v_unit_real,
      _dados->>'nota_fiscal', nullif(_dados->>'responsavel_recebimento_id', '')::uuid, _dados->>'devolucao', _dados->>'revisao',
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url',
      coalesce(nullif(_dados->>'moeda_compra', ''), 'RMB'), nullif(_dados->>'moeda_intermediaria', ''),
      v_valor_unitario_m1, coalesce(nullif(_dados->>'cotacao_ref', '')::numeric, 0),
      coalesce(nullif(_dados->>'peso_kg', '')::numeric, 0), coalesce(nullif(_dados->>'transporte_m2', '')::numeric, 0),
      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0), nullif(_dados->>'data_nota_entrada', '')::date
    ) returning id into v_id;

    -- "Fazer pedido": se _etapas não veio (vazio/null) e há produto vinculado, copia o
    -- cronograma do CARD (snapshot — a OC pode divergir depois). Se _etapas veio
    -- preenchido, usa ele (ramo comum abaixo).
    if (_etapas is null or jsonb_array_length(_etapas) = 0) and v_produto_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'ordem', e.ordem, 'rotulo', e.rotulo, 'base', e.base,
        'percentual', e.percentual, 'data_vencimento', e.data_vencimento, 'cotacao', e.cotacao
      ) order by e.ordem), '[]'::jsonb)
      into v_etapas
      from public.produto_importado_etapas e
      where e.produto_importado_id = v_produto_id;
    else
      v_etapas := coalesce(_etapas, '[]'::jsonb);
    end if;
  else
    update public.ocs_importado set
      numero = coalesce(nullif(_dados->>'numero', ''), numero),
      nome_produto = coalesce(v_nome, nome_produto),
      grupo_id = nullif(_dados->>'grupo_id', '')::uuid,
      categoria_id = nullif(_dados->>'categoria_id', '')::uuid,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      data_pedido = coalesce(nullif(_dados->>'data_pedido', '')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista', '')::date,
      data_entrega = nullif(_dados->>'data_entrega', '')::date,
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      grade_detalhe = coalesce(_grade, '{}'::jsonb),
      variantes = coalesce(_dados->'variantes', '[]'::jsonb),
      qtd_total = v_qtd_total,
      valor_bruto = v_bruto,
      valor_total_desconto = v_total_desc,
      valor_unitario_real = v_unit_real,
      nota_fiscal = _dados->>'nota_fiscal',
      responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
      devolucao = _dados->>'devolucao',
      revisao = _dados->>'revisao',
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      anexo_nf_url = _dados->>'anexo_nf_url',
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra', ''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria', ''),
      valor_unitario_m1 = v_valor_unitario_m1,
      cotacao_ref = coalesce(nullif(_dados->>'cotacao_ref', '')::numeric, 0),
      peso_kg = coalesce(nullif(_dados->>'peso_kg', '')::numeric, 0),
      transporte_m2 = coalesce(nullif(_dados->>'transporte_m2', '')::numeric, 0),
      desconto_pct = v_desconto_pct,
      cotacao_final = coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0),
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
    v_etapas := coalesce(_etapas, '[]'::jsonb);
  end if;

  -- Etapas: estado completo (delete+reinsere, como _salvar_produto_importado_core).
  -- Valida Σ%=100 por base (só quando há etapas daquela base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(v_etapas) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(v_etapas) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;

  delete from public.ocs_importado_etapas where oc_importado_id = v_id;
  for rec in select * from jsonb_array_elements(v_etapas) loop
    insert into public.ocs_importado_etapas (tenant_id, oc_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recalcular_landed_real_oc(v_id);
  return v_id;
end $function$;

-- 4) Recalcular as NÃO pagas quando a data muda numa OC JÁ recebida (qualquer caminho: RPC ou UPDATE direto)
CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Data da Nota de Entrada (24/set): recalcula pela base nova com a MESMA função do "Recalcular Parcelas" — pagas
  -- intactas, soma = total. Na TRANSIÇÃO para recebido quem gera é o gerador (que já lê a data).
  IF TG_TABLE_NAME = 'ocs_tecido' THEN
    PERFORM public._recalcular_parcelas_core(NEW.id, 'tecido');
  ELSIF TG_TABLE_NAME = 'ocs_aviamento' THEN
    PERFORM public._recalcular_parcelas_core(NEW.id, 'aviamento');
  ELSIF TG_TABLE_NAME = 'ocs_etiqueta' THEN
    PERFORM public.recalcular_parcelas_etiqueta(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_tecido;
CREATE TRIGGER trg_nota_entrada_recalc AFTER UPDATE OF data_nota_entrada ON public.ocs_tecido
  FOR EACH ROW WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido'
                     AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada
                     AND NOT COALESCE(NEW.is_rolo, false))
  EXECUTE FUNCTION public.fn_oc_nota_entrada_recalc();
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_aviamento;
CREATE TRIGGER trg_nota_entrada_recalc AFTER UPDATE OF data_nota_entrada ON public.ocs_aviamento
  FOR EACH ROW WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido'
                     AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada)
  EXECUTE FUNCTION public.fn_oc_nota_entrada_recalc();
DROP TRIGGER IF EXISTS trg_nota_entrada_recalc ON public.ocs_etiqueta;
CREATE TRIGGER trg_nota_entrada_recalc AFTER UPDATE OF data_nota_entrada ON public.ocs_etiqueta
  FOR EACH ROW WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido'
                     AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada)
  EXECUTE FUNCTION public.fn_oc_nota_entrada_recalc();

-- P. Acabado: o gerador já regenera as não pagas a cada save (parcelas nascem no pedido); passa a escutar a data também.
DROP TRIGGER IF EXISTS trg_gerar_parcelas_ocpa ON public.ocs_p_acabado;
CREATE TRIGGER trg_gerar_parcelas_ocpa
  AFTER INSERT OR UPDATE OF valor_total_desconto, prazo_pagamento, data_pedido, data_nota_entrada ON public.ocs_p_acabado
  FOR EACH ROW EXECUTE FUNCTION public.gerar_parcelas_oc_p_acabado();

-- 5) D7 (PENDENTE DO DONO — recomendação): data implausível recusada no SERVIDOR, nas 5 OCs (RPC ou UPDATE direto).
CREATE OR REPLACE FUNCTION public.fn_oc_nota_entrada_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date;
BEGIN
  -- Data da Nota de Entrada (24/set) — D7, PENDENTE DO DONO (recomendação): não pode ser FUTURA (hoje no fuso da loja)
  -- nem ANTERIOR à data do pedido da OC. Só valida quando a data MUDA (linhas antigas e saves sem mudança passam).
  -- Mensagens = as do front (src/lib/nota-entrada.ts, validarDataNota). P0001: o erro-mensagem.ts mostra o texto.
  IF NEW.data_nota_entrada IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.data_nota_entrada IS NOT DISTINCT FROM OLD.data_nota_entrada THEN
    RETURN NEW;
  END IF;
  SELECT (now() AT TIME ZONE coalesce(nullif(tc.timezone, ''), 'America/Sao_Paulo'))::date INTO v_hoje
    FROM public.tenant_config tc WHERE tc.tenant_id = NEW.tenant_id;
  v_hoje := coalesce(v_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF NEW.data_nota_entrada > v_hoje THEN
    RAISE EXCEPTION 'A Data da Nota de Entrada (%) não pode ser no futuro.', to_char(NEW.data_nota_entrada, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.data_pedido IS NOT NULL AND NEW.data_nota_entrada < NEW.data_pedido THEN
    RAISE EXCEPTION 'A Data da Nota de Entrada (%) não pode ser anterior à data do pedido (%).',
      to_char(NEW.data_nota_entrada, 'DD/MM/YYYY'), to_char(NEW.data_pedido, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_tecido;
CREATE TRIGGER trg_nota_entrada_valida BEFORE INSERT OR UPDATE OF data_nota_entrada ON public.ocs_tecido
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_nota_entrada_valida();
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_aviamento;
CREATE TRIGGER trg_nota_entrada_valida BEFORE INSERT OR UPDATE OF data_nota_entrada ON public.ocs_aviamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_nota_entrada_valida();
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_etiqueta;
CREATE TRIGGER trg_nota_entrada_valida BEFORE INSERT OR UPDATE OF data_nota_entrada ON public.ocs_etiqueta
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_nota_entrada_valida();
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_p_acabado;
CREATE TRIGGER trg_nota_entrada_valida BEFORE INSERT OR UPDATE OF data_nota_entrada ON public.ocs_p_acabado
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_nota_entrada_valida();
DROP TRIGGER IF EXISTS trg_nota_entrada_valida ON public.ocs_importado;
CREATE TRIGGER trg_nota_entrada_valida BEFORE INSERT OR UPDATE OF data_nota_entrada ON public.ocs_importado
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_nota_entrada_valida();

-- 6) ACL (#9): internas sem EXECUTE para PUBLIC/anon/authenticated (CREATE OR REPLACE preserva o ACL; aqui reafirma).
REVOKE EXECUTE ON FUNCTION public.fn_oc_nota_entrada_recalc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_oc_nota_entrada_valida() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._recalcular_parcelas_core(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalcular_parcelas_etiqueta(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;

-- 7) Pós-condição (falha alto e desfaz tudo se algo não ficou como o plano)
DO $pos$
DECLARE
  v_n int;
  v_sig text;
  r record;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'data_nota_entrada'
     AND table_name IN ('ocs_tecido', 'ocs_aviamento', 'ocs_etiqueta', 'ocs_p_acabado', 'ocs_importado');
  IF v_n <> 5 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 5 colunas, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_nota_entrada_recalc'
     AND tgrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass);
  IF v_n <> 3 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 3 gatilhos trg_nota_entrada_recalc, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_nota_entrada_valida'
     AND tgrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass,
                     'public.ocs_p_acabado'::regclass, 'public.ocs_importado'::regclass);
  IF v_n <> 5 THEN RAISE EXCEPTION 'data_nota_entrada: esperado 5 gatilhos trg_nota_entrada_valida, achei %', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
                  WHERE t.tgrelid = 'public.ocs_p_acabado'::regclass AND t.tgname = 'trg_gerar_parcelas_ocpa'
                    AND a.attname = 'data_nota_entrada') THEN
    RAISE EXCEPTION 'data_nota_entrada: trg_gerar_parcelas_ocpa não escuta a coluna nova';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['public.fn_oc_nota_entrada_recalc()', 'public.fn_oc_nota_entrada_valida()', 'public._recalcular_parcelas_core(uuid,text)', 'public.recalcular_parcelas_etiqueta(uuid)', 'public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', 'public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)', 'public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)', 'public.gerar_parcelas_oc_tecido()', 'public.gerar_parcelas_oc_aviamento()'] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'data_nota_entrada: % executável por anon/authenticated (invariante #9)', v_sig;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.gerar_parcelas_oc_tecido()', 'fc5ce68cc48762f681d30168b1e172b6'),
    ('public.gerar_parcelas_oc_aviamento()', 'e98640190802afd6de9f82ac4ecb39c3'),
    ('public.gerar_parcelas_oc_p_acabado()', '2229a974f172a8302085f15ab2d63ae9'),
    ('public._recalcular_parcelas_core(uuid,text)', '1b03dbd69233d761fd150ab45722b7f6'),
    ('public.recalcular_parcelas_etiqueta(uuid)', 'cf86f487ca3d643f625087a55395ef73'),
    ('public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)', 'aa64df90ef7daad675a69dbab7c1d585'),
    ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', '3c5a3d108d7f6e5a37319ceccb4406e2'),
    ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '4396c443f53c063b31159018bfa3914e'),
    ('public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)', '70b852884f47e55d01cd2b18846bbfa8'),
    ('public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)', '3b9077848c79865efbe15f0499595d69'),
    ('public.fn_oc_nota_entrada_recalc()', '4df62f1206fc0ad006f04851c736019e'),
    ('public.fn_oc_nota_entrada_valida()', 'e2c335a5e09cb45557babadd542cf958')
  ) AS t(sig, md5_depois) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.sig))) IS DISTINCT FROM r.md5_depois THEN
      RAISE EXCEPTION 'data_nota_entrada: % não ficou no texto desta migration', r.sig;
    END IF;
  END LOOP;
END
$pos$;

select pg_notify('pgrst', 'reload schema');
COMMIT;
