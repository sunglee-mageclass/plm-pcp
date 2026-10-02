-- Achados LEVES, release L9 (banco ANTES do site): OC de aviamento guarda o PRECO DA COMPRA (fin #8, P-206 A) e exige a
-- COR quando o aviamento tem 2+ cores (est #5, P-208 A). Respostas do dono de 01/out (plan.md, "Respostas do dono").
--   1) Coluna nova ocs_aviamento_itens.preco numeric (NULL = legado: vale o preco do cadastro, como hoje). ADD COLUMN sem
--      DEFAULT = so catalogo (AccessExclusive por um instante em ocs_aviamento_itens): lock_timeout 500ms; o kit tenta ate 3
--      vezes em horario calmo. Medido na copia 54422: ver l9-report.md.
--   2) Todo leitor do valor do item de OC de aviamento passa a usar COALESCE(it.preco, aviamentos.preco, 0):
--        gerar_parcelas_oc_aviamento      gatilho ao virar 'recebido' (1a geracao das parcelas)
--        _recalcular_parcelas_core        ramo aviamento (recalculo, saves, Nota, itens; o complemento da R16 segue igual)
--        _dashboard_financeiro_core       "investido" do Dashboard Financeiro (OCs de aviamento recebidas)
--      Conferidos e SEM leitura de preco de OC de aviamento (nada a trocar): _estoque_aviamento_core, _desmarcar_recebimento_oc_core,
--      _variante_aviamento_em_uso, _wipe_tenant_core, sidebar_badges, fn_audit, proximo_numero_oc; custo do modelo
--      (_custo_calcular / _custo_unitario_modelos_core) le o preco do CADASTRO do aviamento no BOM, nunca o da OC (nao ha
--      "custo congelado pela OC" para aviamento); alerta/troca so existem para tecido (ja usam o preco da compra, release 9).
--      Site (mesma release): lista (totais), dialogo (valor previsto/real), documento impresso.
--   3) _salvar_oc_aviamento_core (4 args, o da tela): grava o preco do item (numero >= 0; vazio/ausente = cadastro de hoje;
--      chave AUSENTE = tela antiga -> mantem o gravado, salvo se o aviamento do item mudou), recusa preco negativo
--      (P0001 oc_aviamento_preco_invalido:) e exige a cor do item NOVO ou EDITADO quando o aviamento tem 2+ variantes
--      (P0001 oc_aviamento_cor_obrigatoria: <aviamento em ASCII>). Item antigo sem cor e nao mexido = so aviso na tela.
--      A sobrecarga legada de 3 args (_salvar_oc_aviamento_core(uuid,jsonb,jsonb) e o wrapper salvar_oc_aviamento de 3 args)
--      NAO muda: ela e INALCANCAVEL hoje - toda chamada com 3 argumentos e ambigua com a de 4 (DEFAULT no _rev_base) e da
--      "function ... is not unique" (pre-existente; a tela usa so a de 4). Remover = backlog de faxina.
--      Colaboracao (rev/P0409): igual - a trava do _rev_base nao mudou; editar o preco do item sobe o rev da OC pelo gatilho
--      de sempre (fn_colab_bump_oc_avi) e o merge 3-vias da tela trata o preco como mais um campo da linha.
-- Nada gravado muda na ida (a coluna nasce NULL = mesmo valor de hoje). Congelar o preco de hoje nas OCs existentes e a
-- correcao unica SEPARADA 20261029110000_oc_preco_congelar_correcao_unica.sql (com previa supabase/consultas/l9_preco_previa.sql).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public.gerar_parcelas_oc_aviamento()
--     ANTES  e98640190802afd6de9f82ac4ecb39c3  -- PROVISORIO: = DEPOIS da 20261002100000 (Nota de Entrada, no ar desde 26/set; copia 54422) - conferir no kit
--     DEPOIS 11f384d54071402055205fd2ad66f2c6  (este arquivo; reaplicar = no-op)
--   public._recalcular_parcelas_core(uuid,text)
--     ANTES  3dcb59e6958c89d2d06901c50af390d7  -- = DEPOIS da R16 20261026100000 (antes dela: 1b03dbd6 CONFIRMADO no Passo 0 dos MEDIOS)
--     DEPOIS cdd88638886087b9fd71a631be1035f1  (este arquivo; reaplicar = no-op)
--   public._dashboard_financeiro_core(date,date)
--     ANTES  49b55c7be514483ced274ed05178a430  -- PROVISORIO: copia 54422 (20260717130000; fora do Passo 0) - conferir no kit
--     DEPOIS c6069728c11a900047531eb4e1f5e920  (este arquivo; reaplicar = no-op)
--   public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)
--     ANTES  3c5a3d108d7f6e5a37319ceccb4406e2  -- PROVISORIO: = DEPOIS da 20261002100000 (no ar desde 26/set; copia 54422) - conferir no kit
--     DEPOIS cd78ec5bb7e2570db19f41c84584bfcc  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda; o desenho depende deles):
--     public.recalc_parcelas_aviamento_on_item()  a91921832ee054076b87954ef0daec35  -- PROVISORIO: copia 54422 (gatilho do item que chama o core)
--     public.fn_colab_bump_oc_avi()  acab05e51f702c0912d0138d49a4c555  -- PROVISORIO: copia 54422 (rev da OC no save do item)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: ADD COLUMN IF NOT EXISTS (AccessExclusive curtissimo em ocs_aviamento_itens; nada em auth/storage) + CREATE OR
-- REPLACE FUNCTION. Sem DROP, sem gatilho novo, sem funcao nova. ACL: a pos-condicao exige a MESMA de antes nas 4 e ainda:
-- os 3 internos (_recalcular_parcelas_core, _dashboard_financeiro_core e _salvar_oc_aviamento_core de 4 args) sem EXECUTE p/
-- PUBLIC/anon/authenticated (inv. #9); gerar_parcelas_oc_aviamento (RETURNS trigger) idem e o gatilho
-- gerar_parcelas_oc_aviamento_trg segue ligado a ela; os wrappers salvar_oc_aviamento (3 e 4 args) nao mudam.
-- Volta: supabase/rollback/20261029100000_oc_aviamento_preco_down.sql (devolve os 4 textos; a COLUNA FICA, inerte - os
-- precos digitados ficam guardados). Apagar a coluna = 20261029100000_oc_aviamento_preco_down_drop.sql, SEPARADO (PERDE os
-- precos digitados; so com decisao do dono).
-- LIFO: o inverso da correcao unica 20261029110000 (se aplicada) roda ANTES do inverso DESTA; o inverso DESTA roda ANTES de
-- 20261026100000_parcela_complemento_down (R16, confere _recalcular_parcelas_core 3dcb59e6), de
-- 20261002100000_oc_data_nota_entrada_down (confere gerar_parcelas_oc_aviamento e9864019 e o core de 4 args 3c5a3d10) e dos
-- inversos da release 9. Reaplicar a ida da R16 ou da 20261002100000 exige desfazer esta antes.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l9a_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l9a_md5_aceitos VALUES
  ('public.gerar_parcelas_oc_aviamento()', 'e98640190802afd6de9f82ac4ecb39c3', 'antes'),  -- PROVISORIO: = DEPOIS da 20261002100000 (Nota de Entrada, no ar desde 26/set; copia 54422) - conferir no kit
  ('public.gerar_parcelas_oc_aviamento()', '11f384d54071402055205fd2ad66f2c6', 'depois'),  -- este arquivo; reaplicar = no-op
  ('public._recalcular_parcelas_core(uuid,text)', '3dcb59e6958c89d2d06901c50af390d7', 'antes'),  -- = DEPOIS da R16 20261026100000 (antes dela: 1b03dbd6 CONFIRMADO no Passo 0 dos MEDIOS)
  ('public._recalcular_parcelas_core(uuid,text)', 'cdd88638886087b9fd71a631be1035f1', 'depois'),  -- este arquivo; reaplicar = no-op
  ('public._dashboard_financeiro_core(date,date)', '49b55c7be514483ced274ed05178a430', 'antes'),  -- PROVISORIO: copia 54422 (20260717130000; fora do Passo 0) - conferir no kit
  ('public._dashboard_financeiro_core(date,date)', 'c6069728c11a900047531eb4e1f5e920', 'depois'),  -- este arquivo; reaplicar = no-op
  ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', '3c5a3d108d7f6e5a37319ceccb4406e2', 'antes'),  -- PROVISORIO: = DEPOIS da 20261002100000 (no ar desde 26/set; copia 54422) - conferir no kit
  ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', 'cd78ec5bb7e2570db19f41c84584bfcc', 'depois'),  -- este arquivo; reaplicar = no-op
  ('public.recalc_parcelas_aviamento_on_item()', 'a91921832ee054076b87954ef0daec35', 'dep'),  -- PROVISORIO: copia 54422 (gatilho do item que chama o core)
  ('public.fn_colab_bump_oc_avi()', 'acab05e51f702c0912d0138d49a4c555', 'dep');  -- PROVISORIO: copia 54422 (rev da OC no save do item)

-- ACL de antes (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _l9a_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _l9a_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  IF to_regclass('public.ocs_aviamento_itens') IS NULL OR to_regclass('public.aviamentos') IS NULL THEN
    RAISE EXCEPTION 'leves_l9: tabelas ocs_aviamento_itens/aviamentos ausentes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT DISTINCT assinatura FROM _l9a_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l9: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l9a_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l9: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- a coluna, se ja existe (reaplicar), tem de ser numeric
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ocs_aviamento_itens'
               AND column_name = 'preco' AND data_type <> 'numeric') THEN
    RAISE EXCEPTION 'leves_l9: ocs_aviamento_itens.preco existe com tipo inesperado' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- [fin #8, P-206 A] preco da compra por item (NULL = legado: preco do cadastro). Sem DEFAULT: so catalogo, sem reescrita.
ALTER TABLE public.ocs_aviamento_itens ADD COLUMN IF NOT EXISTS preco numeric;
COMMENT ON COLUMN public.ocs_aviamento_itens.preco IS
  'Preco unitario da COMPRA (L9, P-206 A). Preenchido com o cadastro ao incluir o item, editavel. NULL = legado: vale aviamentos.preco.';

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

    -- [leves L9 fin #8, P-206 A] preco da COMPRA gravado no item; NULL (legado) = preco do cadastro.
    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(it.preco, a.preco, 0)), 0)
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
  v_num_comp integer;
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

    -- [leves L9 fin #8, P-206 A] preco da COMPRA gravado no item; NULL (legado) = preco do cadastro.
    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(it.preco, a.preco, 0)),0)
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

  -- [medios R16 RA1, P-187 A] COMPLEMENTO: saldo > 0 com TODAS as parcelas do prazo (1..n) pagas -> UMA parcela extra
  -- com a diferenca, nº = maior nº existente (>= n) + 1, vencendo junto com a ultima parcela do prazo (a data calculada
  -- da parcela n). Nao paga, ela e apagada no DELETE acima a cada recalculo e so volta se ainda houver saldo (saldo de
  -- volta a <= 0 -> some); paga, fica (e entra no pago). Data ajustada a mao: a guarda/reaplica por nº devolve.
  IF v_valor_total > 0 AND v_restante_valor > 0 AND v_n_inserir = 0 THEN
    SELECT GREATEST(v_n_parcelas, COALESCE(MAX(numero_parcela), 0)) + 1 INTO v_num_comp
      FROM public.parcelas
     WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id));
    v_base_data := COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE);
    IF array_length(v_dias, 1) >= v_n_parcelas THEN v_vencimento := v_base_data + v_dias[v_n_parcelas]; v_offset := v_dias[v_n_parcelas];
    ELSE v_vencimento := v_base_data + (v_n_parcelas * 30); v_offset := NULL; END IF;
    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'tecido', _oc_id, v_empresa, v_num_comp, v_restante_valor, v_vencimento, 'a_pagar', v_offset);
    ELSIF _tipo = 'aviamento' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, v_num_comp, v_restante_valor, v_vencimento, 'a_pagar', v_offset);
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_p_acabado_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'p_acabado', _oc_id, v_empresa, v_num_comp, v_restante_valor, v_vencimento, 'a_pagar', v_offset);
    END IF;
    RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
      'deletadas',v_deletadas,'criadas',1,'valor_total',v_valor_total,
      'restante',v_restante_valor,'complemento',v_num_comp,'fonte','prazo_pagamento');
  END IF;

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

CREATE OR REPLACE FUNCTION public._dashboard_financeiro_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_investido numeric := 0; v_pago numeric := 0; v_pendente numeric := 0;
  v_chart jsonb; v_aging jsonb; v_top_forn jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT COALESCE(SUM(valor_real_total),0) INTO v_investido
  FROM ocs_tecido
  WHERE tenant_id = v_tenant AND status = 'recebido'
    AND (p_inicio IS NULL OR COALESCE(data_entrega, data_pedido) >= p_inicio)
    AND (p_fim    IS NULL OR COALESCE(data_entrega, data_pedido) <= p_fim);

  v_investido := v_investido + COALESCE((
    -- [leves L9 fin #8, P-206 A] preco da COMPRA gravado no item; NULL (legado) = preco do cadastro.
    SELECT SUM(COALESCE(i.quantidade_recebida,0) * COALESCE(i.preco, a.preco, 0))
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant AND oc.status = 'recebido'
      AND (p_inicio IS NULL OR COALESCE(oc.data_entrega, oc.data_pedido) >= p_inicio)
      AND (p_fim    IS NULL OR COALESCE(oc.data_entrega, oc.data_pedido) <= p_fim)
    LEFT JOIN aviamentos a ON a.id = i.aviamento_id
    WHERE COALESCE(i.cancelado, false) = false
  ), 0);

  -- Pendente (a pagar): por VENCIMENTO no período.
  SELECT COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pendente
  FROM parcelas
  WHERE tenant_id = v_tenant
    AND (p_inicio IS NULL OR data_vencimento >= p_inicio)
    AND (p_fim    IS NULL OR data_vencimento <= p_fim);

  -- Pago: por DATA DE PAGAMENTO no período (fluxo de caixa real, não vencimento).
  SELECT COALESCE(SUM(valor), 0)
  INTO v_pago
  FROM parcelas
  WHERE tenant_id = v_tenant AND (status='pago' OR data_pagamento IS NOT NULL)
    AND (p_inicio IS NULL OR data_pagamento >= p_inicio)
    AND (p_fim    IS NULL OR data_pagamento <= p_fim);

  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL THEN
    WITH gs AS (
      SELECT generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') AS d
    ),
    base AS (SELECT to_char(d,'YYYY-MM') AS k, to_char(d,'Mon/YY') AS mes FROM gs)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
    INTO v_chart
    FROM base
    LEFT JOIN (
      SELECT to_char(data_vencimento,'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', p_inicio)
        AND data_vencimento <  date_trunc('month', p_fim) + interval '1 month'
      GROUP BY 1
    ) t USING (k);
  ELSE
    WITH meses AS (SELECT generate_series(0, 5) AS i),
    base AS (
      SELECT to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'YYYY-MM') AS k,
             to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'Mon/YY') AS mes
      FROM meses
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
    INTO v_chart
    FROM base
    LEFT JOIN (
      SELECT to_char(data_vencimento,'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', current_date)
        AND data_vencimento <  date_trunc('month', current_date) + interval '6 months'
      GROUP BY 1
    ) t USING (k);
  END IF;

  -- Aging das contas a pagar EM ABERTO (snapshot atual, por idade do vencimento).
  v_aging := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('faixa', faixa, 'total', total) ORDER BY ord)
    FROM (
      SELECT faixa, ord, SUM(valor) AS total FROM (
        SELECT valor,
          CASE WHEN data_vencimento < current_date THEN 'Vencido'
               WHEN data_vencimento <= current_date + 30 THEN '0–30 dias'
               WHEN data_vencimento <= current_date + 60 THEN '31–60 dias'
               WHEN data_vencimento <= current_date + 90 THEN '61–90 dias'
               ELSE '90+ dias' END AS faixa,
          CASE WHEN data_vencimento < current_date THEN 0
               WHEN data_vencimento <= current_date + 30 THEN 1
               WHEN data_vencimento <= current_date + 60 THEN 2
               WHEN data_vencimento <= current_date + 90 THEN 3
               ELSE 4 END AS ord
        FROM parcelas
        WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
      ) x GROUP BY faixa, ord
    ) a
  ), '[]'::jsonb);

  -- Top fornecedores por valor das parcelas no período.
  v_top_forn := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('nome', nome, 'total', total) ORDER BY total DESC)
    FROM (
      SELECT COALESCE(e.nome_fantasia, 'Sem fornecedor') AS nome, SUM(p.valor) AS total
      FROM parcelas p
      LEFT JOIN empresas e ON e.id = p.empresa_id
      WHERE p.tenant_id = v_tenant
        AND (p_inicio IS NULL OR p.data_vencimento >= p_inicio)
        AND (p_fim    IS NULL OR p.data_vencimento <= p_fim)
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 8
    ) f
  ), '[]'::jsonb);

  RETURN jsonb_build_object(
    'investido', v_investido, 'pago', v_pago, 'pendente', v_pendente, 'chartData', v_chart,
    'aging', v_aging, 'topFornecedores', v_top_forn
  );
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
  v_sem_cor text;
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

  -- [leves L9 fin #8, P-206 A] preco da COMPRA no item: numero >= 0. Vazio/ausente = preco do cadastro (gravado abaixo).
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL
      AND NULLIF(e->>'preco','') IS NOT NULL
      AND (e->>'preco')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'oc_aviamento_preco_invalido: o preco do item nao pode ser negativo' USING ERRCODE = 'P0001';
  END IF;

  -- [leves L9 est #5, P-208 A] aviamento com 2+ cores (variantes) exige a cor no item. Vale para item NOVO e para item
  -- EDITADO neste save (aviamento, cor, quantidades, cancelado ou preco efetivo diferentes do gravado); item antigo sem cor
  -- e NAO mexido (legado, ex.: FRANJA 00003118 da Ave Rara) so ganha aviso na tela e nao trava o save do resto da OC.
  -- Item cancelado nao exige (nao entra no estoque). Mesma regra no front (src/lib/oc-aviamento-item.ts).
  SELECT regexp_replace(COALESCE(a.codigo_nome, a.codigo, '?'), '[^ -~]', '?', 'g') INTO v_sem_cor
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) WITH ORDINALITY AS e(j, n)
    JOIN public.aviamentos a ON a.id = (e.j->>'aviamento_id')::uuid
    LEFT JOIN public.ocs_aviamento_itens s
      ON v_oc_id IS NOT NULL AND s.id = NULLIF(e.j->>'id','')::uuid AND s.oc_aviamento_id = v_oc_id
   WHERE NULLIF(e.j->>'variante_aviamento_id','') IS NULL
     AND NOT COALESCE((e.j->>'cancelado')::boolean, false)
     AND (SELECT count(*) FROM public.variantes_aviamento va WHERE va.aviamento_id = a.id) >= 2
     AND ( s.id IS NULL
           OR s.aviamento_id IS DISTINCT FROM a.id
           OR s.variante_aviamento_id IS NOT NULL
           OR COALESCE(s.cancelado, false)
           OR s.quantidade_pedida IS DISTINCT FROM (e.j->>'quantidade_pedida')::numeric
           OR s.quantidade_recebida IS DISTINCT FROM (e.j->>'quantidade_recebida')::numeric
           OR ( e.j ? 'preco'
                AND COALESCE(NULLIF(e.j->>'preco','')::numeric, a.preco) IS DISTINCT FROM COALESCE(s.preco, a.preco) ) )
   ORDER BY e.n
   LIMIT 1;
  IF v_sem_cor IS NOT NULL THEN
    RAISE EXCEPTION 'oc_aviamento_cor_obrigatoria: %', v_sem_cor USING ERRCODE = 'P0001';
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

    -- [leves L9] preco: o da compra (payload) ou, vazio/ausente, o do cadastro de hoje (congelado no item).
    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado, preco)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false),
           COALESCE(NULLIF(e->>'preco','')::numeric,
                    (SELECT a.preco FROM public.aviamentos a WHERE a.id = (e->>'aviamento_id')::uuid))
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

    -- [leves L9] preco: numero no payload = grava; chave presente vazia/nula OU aviamento trocado = preco do cadastro de
    -- hoje; chave AUSENTE (tela antiga) com o mesmo aviamento = mantem o gravado.
    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_aviamento_itens it SET
        aviamento_id = (r->>'aviamento_id')::uuid,
        variante_aviamento_id = NULLIF(r->>'variante_aviamento_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false),
        preco = CASE
                  WHEN NULLIF(r->>'preco','') IS NOT NULL THEN (r->>'preco')::numeric
                  WHEN r ? 'preco' OR it.aviamento_id IS DISTINCT FROM (r->>'aviamento_id')::uuid
                    THEN (SELECT a.preco FROM public.aviamentos a WHERE a.id = (r->>'aviamento_id')::uuid)
                  ELSE it.preco
                END
      WHERE it.id = (r->>'id')::uuid AND it.oc_aviamento_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado, preco)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false),
           COALESCE(NULLIF(e->>'preco','')::numeric,
                    (SELECT a.preco FROM public.aviamentos a WHERE a.id = (e->>'aviamento_id')::uuid))
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

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _l9a_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'leves_l9: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL identica a de antes (CREATE OR REPLACE nao mexe; conferido).
  FOR r IN SELECT assinatura, acl FROM _l9a_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l9: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: internos sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._recalcular_parcelas_core(uuid,text)'),
                                 ('public._dashboard_financeiro_core(date,date)'),
                                 ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'),
                                 ('public.gerar_parcelas_oc_aviamento()')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l9: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l9: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'gerar_parcelas_oc_aviamento_trg' AND t.tgrelid = to_regclass('public.ocs_aviamento')
                    AND t.tgfoid = to_regprocedure('public.gerar_parcelas_oc_aviamento()') AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'leves_l9: gatilho gerar_parcelas_oc_aviamento_trg ausente ou desligado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'trg_recalc_parcelas_aviamento' AND t.tgrelid = to_regclass('public.ocs_aviamento_itens')
                    AND t.tgfoid = to_regprocedure('public.recalc_parcelas_aviamento_on_item()') AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'leves_l9: gatilho trg_recalc_parcelas_aviamento ausente ou desligado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ocs_aviamento_itens'
                   AND column_name = 'preco' AND data_type = 'numeric' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'leves_l9: pos-condicao falhou - coluna ocs_aviamento_itens.preco fora do esperado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
