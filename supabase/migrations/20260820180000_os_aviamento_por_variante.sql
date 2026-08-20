-- FF#3 (ago/2026): Ordem de Saída de AVIAMENTO por VARIANTE (cor).
--
-- `ordens_saida_aviamento_itens.variante_aviamento_id` existia mas estava INERTE. Agora a OS de
-- aviamento grava a variante do item, e a TRAVA de saldo + a baixa passam a valer/debitar POR
-- VARIANTE. O `_estoque_aviamento_core` JÁ é por variante (os_reserva/os_baixa coalescem
-- variante_aviamento_id → variante ÚNICA do legado), então ele NÃO muda — só a trava do
-- baixar_os (que hoje SOMA por aviamento) e o salvar_os (que não gravava a variante).
--
-- Aviamento sem variante = comportamento atual (variante null → bucket "Sem variante"/única).

-- ── salvar_os: grava variante_aviamento_id nos itens de aviamento ────────────────────────────
CREATE OR REPLACE FUNCTION public.salvar_os(_tipo text, _os_id uuid, _header jsonb, _itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_htbl text; v_itbl text; v_os uuid := _os_id; v_num int; v_ok boolean; r jsonb;
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
    -- FF#3: aviamento grava a VARIANTE (variante_aviamento_id); tecido segue por variante_tecido_id.
    IF _tipo = 'aviamento' THEN
      INSERT INTO public.ordens_saida_aviamento_itens
        (tenant_id, ordem_saida_id, aviamento_id, variante_aviamento_id, reserva, baixa)
      VALUES (v_tenant, v_os, (r->>'itemId')::uuid, NULLIF(r->>'varianteId','')::uuid,
              GREATEST(0, COALESCE(NULLIF(r->>'reserva','')::numeric, 0)), 0);
    ELSE
      INSERT INTO public.ordens_saida_tecido_itens
        (tenant_id, ordem_saida_id, variante_tecido_id, reserva, baixa)
      VALUES (v_tenant, v_os, (r->>'itemId')::uuid,
              GREATEST(0, COALESCE(NULLIF(r->>'reserva','')::numeric, 0)), 0);
    END IF;
  END LOOP;

  RETURN v_os;
END;
$function$;

-- ── baixar_os: trava de saldo POR VARIANTE (aviamento) ───────────────────────────────────────
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
  -- canônica; a OS atual ainda não está baixada → não entra no fisico). FF#3: agora POR VARIANTE
  -- (aviamento × variante). Espelha o bucketing do _estoque_aviamento_core: item sem variante
  -- recai na variante ÚNICA do aviamento (quando há 1); com 2+ variantes o bucket "Sem variante"
  -- (NULL) tem fisico ~0 e barra — força escolher a variante.
  IF _tipo = 'aviamento' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT oi.aviamento_id AS av,
               COALESCE(oi.variante_aviamento_id, s.var) AS var,
               SUM(GREATEST(0, COALESCE(NULLIF(_utilizado->>oi.id::text,'')::numeric, oi.reserva, 0))) AS usado
        FROM public.ordens_saida_aviamento_itens oi
        LEFT JOIN (
          SELECT aviamento_id, (array_agg(id ORDER BY created_at, id))[1] AS var
          FROM public.variantes_aviamento
          WHERE tenant_id = v_tenant
          GROUP BY aviamento_id HAVING count(*) = 1
        ) s ON s.aviamento_id = oi.aviamento_id
        WHERE oi.ordem_saida_id = _os_id AND oi.aviamento_id IS NOT NULL
        GROUP BY oi.aviamento_id, COALESCE(oi.variante_aviamento_id, s.var)
      ) g
      LEFT JOIN public._estoque_aviamento_core(v_tenant) ea
        ON ea.id = g.av AND ea.variante_id IS NOT DISTINCT FROM g.var
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

-- ACL (invariante #9): wrappers seguem só p/ authenticated (checam módulo/loja dentro); o
-- _estoque_aviamento_core continua revogado de PUBLIC/anon/authenticated (não tocado aqui).
-- CREATE OR REPLACE preserva os grants existentes; reafirmamos por garantia.
REVOKE EXECUTE ON FUNCTION public.salvar_os(text,uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.baixar_os(text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_os(text,uuid,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_os(text,uuid,jsonb) TO authenticated;
