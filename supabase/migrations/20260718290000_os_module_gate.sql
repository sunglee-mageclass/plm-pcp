-- Gate de módulo nas RPCs de Ordem de Saída (audit de saúde jul/2026, invariante #9).
-- salvar_os/baixar_os/desmarcar_os são DEFINER (anon já bloqueado, tenant derivado da sessão),
-- mas faltava o `tenant_module_enabled('entrada_saida')` que cancelar_rolo/reverter_rolos_oc/
-- salvar_oc_tecido já têm. Defense-in-depth: loja com o módulo desligado não deve mexer em OS
-- nem por API direta. Corpos reproduzidos como estão (baixar_os já com a guarda anti re-baixa) +
-- a checagem de módulo no topo.

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
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e WHERE NULLIF(e->>'itemId','') IS NOT NULL) THEN
    RAISE EXCEPTION 'Adicione ao menos um item à ordem de saída.';
  END IF;
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
      USING v_tenant, v_os, (r->>'itemId')::uuid, GREATEST(0, COALESCE(NULLIF(r->>'reserva','')::numeric, 0));
  END LOOP;

  RETURN v_os;
END;
$function$;

CREATE OR REPLACE FUNCTION public.baixar_os(_tipo text, _os_id uuid, _utilizado jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_ok boolean; v_baixado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OS inválido'; END IF;
  v_tenant := public.get_user_tenant_id();
  v_htbl := 'ordens_saida_' || _tipo;
  v_itbl := 'ordens_saida_' || _tipo || '_itens';

  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND (tenant_id=$2 OR public.is_super_admin()))', v_htbl)
    INTO v_ok USING _os_id, v_tenant;
  IF NOT v_ok THEN RAISE EXCEPTION 'OS não encontrada ou de outra loja'; END IF;

  -- Idempotência: OS já baixada não re-baixa (evita re-rodar a trava de saldo já defasada e
  -- sobrescrever os valores). Reverter é via desmarcar_os.
  EXECUTE format('SELECT COALESCE(baixado,false) FROM public.%I WHERE id=$1', v_htbl) INTO v_baixado USING _os_id;
  IF v_baixado THEN RAISE EXCEPTION 'OS já baixada — desmarque a baixa antes de baixar novamente.'; END IF;

  -- Trava de saldo (só aviamento): não deixa baixar acima do disponível (fisico da fonte
  -- canônica; a OS atual ainda não está baixada → não entra no fisico).
  IF _tipo = 'aviamento' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.aviamento_id AS k,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_aviamento_itens oi
        WHERE oi.ordem_saida_id = _os_id AND oi.aviamento_id IS NOT NULL
        GROUP BY oi.aviamento_id
      ) g LEFT JOIN public._estoque_aviamento_core(v_tenant) ea ON ea.id = g.k
      WHERE g.usado > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de aviamento';
    END IF;
  ELSIF _tipo = 'tecido' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.variante_tecido_id AS k,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_tecido_itens oi
        WHERE oi.ordem_saida_id = _os_id AND oi.variante_tecido_id IS NOT NULL
        GROUP BY oi.variante_tecido_id
      ) g LEFT JOIN public._estoque_tecido_core(v_tenant) ea ON ea.variante_tecido_id = g.k
      WHERE g.usado > COALESCE(ea.fisico, 0) + 1e-9
    ) THEN
      RAISE EXCEPTION 'Baixa acima do estoque disponível de tecido';
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE public.%I oi SET baixa = GREATEST(0, COALESCE(NULLIF($2->>oi.id::text, '''')::numeric, oi.reserva, 0))
     WHERE oi.ordem_saida_id = $1', v_itbl)
    USING _os_id, _utilizado;
  EXECUTE format('UPDATE public.%I SET baixado = true WHERE id = $1', v_htbl) USING _os_id;
END;
$function$;

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
  IF NOT public.tenant_module_enabled('entrada_saida') THEN RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501'; END IF;
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

select pg_notify('pgrst','reload schema');
