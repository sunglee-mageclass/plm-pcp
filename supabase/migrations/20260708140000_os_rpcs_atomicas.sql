-- M3: RPCs ATÔMICAS para Ordem de Saída (tecido e aviamento).
--
-- Antes salvar/baixar/desmarcar eram VÁRIAS chamadas no cliente (OrdemSaidaPage): header +
-- delete itens + insert itens; ou loop de updates + update header. Janela de falha parcial
-- (queda de rede no meio → OS inconsistente). Agora cada operação é 1 transação.
--
-- baixar_os TRAVA o saldo no SERVIDOR para aviamento (usa a fonte canônica
-- _estoque_aviamento_core): defesa em profundidade além da trava do cliente (C1). Tecido
-- mantém o comportamento de hoje (sem trava — usa seu próprio motor de estoque).
--
-- Funções SECURITY DEFINER com checagem de auth + tenant (RLS é bypassada por DEFINER, então
-- valido tenant explicitamente). Genéricas por _tipo ∈ {tecido, aviamento} via SQL dinâmico
-- com %I (identificador). Editar só é permitido em OS não-baixada (regra da UI preservada).

-- ============ salvar_os (criar/editar) ============
CREATE OR REPLACE FUNCTION public.salvar_os(_tipo text, _os_id uuid, _header jsonb, _itens jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_fk text; v_os uuid := _os_id; v_num int; v_ok boolean; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';
  v_fk := CASE _tipo WHEN 'tecido' THEN 'variante_tecido_id' ELSE 'aviamento_id' END;
  v_num := NULLIF(_header->>'numero', '')::int;

  IF v_os IS NULL THEN
    IF v_num IS NULL THEN
      EXECUTE format('SELECT COALESCE(MAX(numero),0)+1 FROM public.%I WHERE tenant_id=$1', v_htbl)
        INTO v_num USING v_tenant;
    END IF;
    EXECUTE format(
      'INSERT INTO public.%I (tenant_id,numero,responsavel,data_solicitacao,data_corte,destino_id,observacao,baixado,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,auth.uid()) RETURNING id', v_htbl)
      INTO v_os USING v_tenant, v_num, _header->>'responsavel',
        NULLIF(_header->>'data_solicitacao','')::date, NULLIF(_header->>'data_corte','')::date,
        NULLIF(_header->>'destino_id','')::uuid, _header->>'observacao';
  ELSE
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()) AND NOT baixado)', v_htbl)
      INTO v_ok USING v_os, v_tenant;
    IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada, de outra loja, ou já baixada'; END IF;
    EXECUTE format(
      'UPDATE public.%I SET numero=COALESCE($2,numero),responsavel=$3,data_solicitacao=$4,data_corte=$5,destino_id=$6,observacao=$7
       WHERE id=$1', v_htbl)
      USING v_os, v_num, _header->>'responsavel',
        NULLIF(_header->>'data_solicitacao','')::date, NULLIF(_header->>'data_corte','')::date,
        NULLIF(_header->>'destino_id','')::uuid, _header->>'observacao';
    EXECUTE format('DELETE FROM public.%I WHERE ordem_saida_id=$1', v_itbl) USING v_os;
  END IF;

  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
           WHERE NULLIF(e->>'itemId', '') IS NOT NULL
  LOOP
    EXECUTE format(
      'INSERT INTO public.%I (tenant_id,ordem_saida_id,%I,reserva,baixa) VALUES ($1,$2,$3,$4,0)', v_itbl, v_fk)
      USING v_tenant, v_os, (r->>'itemId')::uuid, COALESCE(NULLIF(r->>'reserva','')::numeric, 0);
  END LOOP;

  RETURN v_os;
END;
$function$;

-- ============ baixar_os (confirmar baixa, com trava de saldo p/ aviamento) ============
CREATE OR REPLACE FUNCTION public.baixar_os(_tipo text, _os_id uuid, _utilizado jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';

  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()))', v_htbl)
    INTO v_ok USING _os_id, v_tenant;
  IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada ou de outra loja'; END IF;

  -- Trava de saldo (só aviamento): não deixa baixar acima do disponível (fisico da fonte
  -- canônica; a OS atual ainda não está baixada → não entra no fisico).
  IF _tipo = 'aviamento' THEN
    IF EXISTS (
      SELECT 1 FROM public.ordens_saida_aviamento_itens oi
      LEFT JOIN public._estoque_aviamento_core(v_tenant) ea ON ea.id = oi.aviamento_id
      WHERE oi.ordem_saida_id = _os_id
        AND COALESCE(NULLIF(_utilizado->>oi.id::text, '')::numeric, oi.reserva, 0) > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de aviamento';
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE public.%I oi SET baixa = COALESCE(NULLIF($2->>oi.id::text, '''')::numeric, oi.reserva, 0)
     WHERE oi.ordem_saida_id = $1', v_itbl)
    USING _os_id, _utilizado;
  EXECUTE format('UPDATE public.%I SET baixado = true WHERE id = $1', v_htbl) USING _os_id;
END;
$function$;

-- ============ desmarcar_os (reverter baixa) ============
CREATE OR REPLACE FUNCTION public.desmarcar_os(_tipo text, _os_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';

  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()))', v_htbl)
    INTO v_ok USING _os_id, v_tenant;
  IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada ou de outra loja'; END IF;

  EXECUTE format('UPDATE public.%I SET baixa = 0 WHERE ordem_saida_id = $1', v_itbl) USING _os_id;
  EXECUTE format('UPDATE public.%I SET baixado = false WHERE id = $1', v_htbl) USING _os_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.salvar_os(text, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_os(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desmarcar_os(text, uuid) TO authenticated;
