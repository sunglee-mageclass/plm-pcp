-- Achados MEDIOS, release R10 (Financeiro), carona fin #9 (BAIXA): parser UNICO de prazo na OC de Produto Acabado.
-- Causa (conferida): gerar_parcelas_oc_p_acabado (gatilho de TODO save da OC P. Acabado) separa o prazo SO por '/'
-- (string_to_array), enquanto as outras OCs e servicos_financeiro separam por qualquer caractere nao numerico
-- (regexp '[^0-9]+'). '30, 60' ou '30-60' numa OC P. Acabado viravam 1 parcela (so o '30'; ' 60' falha o regex ancorado).
-- Correcao: regexp_split_to_table(coalesce(prazo,'30'), '[^0-9]+') na geradora. O fallback (nenhum numero -> [30]) e o
-- teto de 24 nao mudam. Mais: parcela_voltar_vencimento_automatico (P-171 A, 20261019220000) ESPELHA a regra da geradora
-- no ramo p_acabado (o proprio comentario dela: "se a regra de uma geradora mudar, esta funcao tem de mudar junto") -
-- recebe o MESMO parser, senao "Voltar ao calculo automatico" daria outra data que a geradora para '30, 60'.
-- Na copia: 0 das 9 OCs P. Acabado mudam de nº de parcelas (prazos '30', '0', '30/45', '30/60/90').
-- O espelho TS (contarParcelasPrazo, src/components/oc-p-acabado/shared.ts:136) e do front da R10 (outra tarefa).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- PROVISORIO: confirmar com o Passo 0 de producao (os md5 "antes" sao da COPIA local 54422, 01/out).
--   public.gerar_parcelas_oc_p_acabado()
--     ANTES  2229a974f172a8302085f15ab2d63ae9  (copia 01/out = producao 30/set)  -- PROVISORIO: confirmar com o Passo 0 de producao
--     DEPOIS 4b90865ad77d4f68a71c41959a283d62  (este arquivo; reaplicar = no-op)
--   public.parcela_voltar_vencimento_automatico(uuid)
--     ANTES  82677bf24887f6e1ad7caadfa920ae45  (copia 01/out = texto da 20261019220000)  -- PROVISORIO: confirmar com o Passo 0 de producao
--     DEPOIS ef80c3c810c22bb32d04d818ebbc6e9c  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (nada em tabela; nada em auth/storage). ACL mantida (conferida no fim).
-- Volta: supabase/rollback/20261020120000_pa_prazo_parser_unico_down.sql (texto de antes das 2, com guarda do de depois).
-- LIFO: o inverso desta roda ANTES de supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql (guarda
-- gerar_parcelas_oc_p_acabado, l.42) e de supabase/rollback/20261019220000_parcela_voltar_vencimento_automatico_down.sql
-- (guarda parcela_voltar_vencimento_automatico = 82677bf2...).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r10_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r10_md5_aceitos VALUES
  ('public.gerar_parcelas_oc_p_acabado()',              '2229a974f172a8302085f15ab2d63ae9', 'antes'),   -- PROVISORIO: confirmar com o Passo 0 de producao
  ('public.gerar_parcelas_oc_p_acabado()',              '4b90865ad77d4f68a71c41959a283d62', 'depois'),
  ('public.parcela_voltar_vencimento_automatico(uuid)', '82677bf24887f6e1ad7caadfa920ae45', 'antes'),   -- PROVISORIO: confirmar com o Passo 0 de producao
  ('public.parcela_voltar_vencimento_automatico(uuid)', 'ef80c3c810c22bb32d04d818ebbc6e9c', 'depois');

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r10_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r10_fin9: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r10_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r10_fin9: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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
REVOKE EXECUTE ON FUNCTION public.parcela_voltar_vencimento_automatico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parcela_voltar_vencimento_automatico(uuid) TO authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT assinatura, md5 FROM _r10_md5_aceitos WHERE papel = 'depois' LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r10_fin9: pos-condicao falhou - % nao ficou com o texto deste arquivo (md5 %)', r.assinatura,
        md5(pg_get_functiondef(to_regprocedure(r.assinatura))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.parcela_voltar_vencimento_automatico(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.parcela_voltar_vencimento_automatico(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r10_fin9: ACL de parcela_voltar_vencimento_automatico errada (so authenticated)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
