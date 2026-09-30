-- Contas certas A1 - P-171 A (dono, 30/set): acao "Voltar ao calculo automatico" no detalhe da parcela.
-- RPC NOVA parcela_voltar_vencimento_automatico(_parcela_id uuid) (SECURITY DEFINER):
--   * so quem EDITA o Financeiro (mesma regra da tela: canEdit de financeiro_parcelas OU financeiro_calendario ->
--     user_can_edit de uma das duas), na loja da parcela, com o modulo financeiro ligado; senao 42501;
--   * parcela PAGA -> P0001 'parcela_paga' (ASCII);
--   * limpa vencimento_manual e recalcula a data pela regra da geradora da familia (Nota + prazo; sem a Nota, o fallback
--     de sempre - ver o comentario da funcao); o valor NAO muda;
--   * o UPDATE liga a GUC app.parcelas_sistema = 'on' so em volta dele (o gatilho trg_parcela_vencimento_manual nao
--     conta como ajuste a mao) e passa pelo audit_parcelas (fn_audit, autor = quem clicou);
--   * ACL: REVOKE de PUBLIC e anon + GRANT authenticated.
-- Depende da 20261019200000 (coluna vencimento_manual + gatilhos) - conferido na guarda.
-- Guarda da funcao nova (L5): so aceita "nao existe" ou o texto deste arquivo (md5 82677bf24887f6e1ad7caadfa920ae45); outro -> P0001.
-- Guarda das regras espelhadas (papel 'dep', copia = PRODUCAO pelo Passo 0 30/set 11:22): _recalcular_parcelas_core
-- 1b03dbd6..., recalcular_parcelas_etiqueta cf86f487..., gerar_parcelas_oc_p_acabado 2229a974..., _gerar_parcelas_importado
-- 6eb370cc... - se a regra de uma geradora mudar, esta funcao tem de mudar junto.
-- Travas: so CREATE FUNCTION + GRANT/REVOKE (nenhuma trava em tabela; nada em auth/storage).
-- Volta: supabase/rollback/20261019220000_parcela_voltar_vencimento_automatico_down.sql (DROP FUNCTION - medido: so a trava
-- de objeto da propria funcao). O front que chama a RPC volta ANTES ou JUNTO.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _cc_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_md5_aceitos VALUES
  ('public._recalcular_parcelas_core(uuid,text)', '1b03dbd69233d761fd150ab45722b7f6', 'dep'),   -- copia = producao (Passo 0)
  ('public.recalcular_parcelas_etiqueta(uuid)',   'cf86f487ca3d643f625087a55395ef73', 'dep'),   -- copia = producao (Passo 0)
  ('public.gerar_parcelas_oc_p_acabado()',        '2229a974f172a8302085f15ab2d63ae9', 'dep'),   -- copia = producao (Passo 0)
  ('public._gerar_parcelas_importado(uuid)',      '6eb370cc35bf882bb4c0e243318b84b3', 'dep');   -- copia = producao (Passo 0)

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _cc_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_p171: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _cc_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'contas_certas_p171: % mudou desde o planejamento (md5 %) - a regra espelhada pode ter mudado', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parcelas'
                 AND column_name = 'vencimento_manual')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcela_vencimento_manual') THEN
    RAISE EXCEPTION 'contas_certas_p171: aplicar a 20261019200000 antes (coluna vencimento_manual + gatilhos)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._imp_etapas_brl_oc(uuid)') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_p171: _imp_etapas_brl_oc nao existe' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.parcela_voltar_vencimento_automatico(uuid)') IS NOT NULL THEN
    IF md5(pg_get_functiondef(to_regprocedure('public.parcela_voltar_vencimento_automatico(uuid)'))) IS DISTINCT FROM '82677bf24887f6e1ad7caadfa920ae45' THEN
      RAISE EXCEPTION 'contas_certas_p171: parcela_voltar_vencimento_automatico existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $guarda$;

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
--   p_acabado:                 base = COALESCE(nota, data_pedido, hoje); dias = prazo 'a/b/c' (padrao 30)
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
      v_dias := ARRAY(SELECT t::int FROM unnest(string_to_array(v_prazo, '/')) AS t WHERE t ~ '^[0-9]+$');
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

REVOKE EXECUTE ON FUNCTION public.parcela_voltar_vencimento_automatico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parcela_voltar_vencimento_automatico(uuid) TO authenticated;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public.parcela_voltar_vencimento_automatico(uuid)'::regprocedure)) IS DISTINCT FROM '82677bf24887f6e1ad7caadfa920ae45' THEN
    RAISE EXCEPTION 'contas_certas_p171: pos-condicao falhou (texto)' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.parcela_voltar_vencimento_automatico(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.parcela_voltar_vencimento_automatico(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_p171: ACL errada (anon nao pode; authenticated pode)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
