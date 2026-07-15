-- baixar_os — guarda anti re-baixa (audit de saúde jul/2026).
-- ANTES: chamar baixar_os numa OS JÁ baixada re-rodava a trava de saldo (agora a OS já entra no
-- físico → checagem incorreta) e sobrescrevia `baixa` dos itens. Fix: bloquear se já baixado
-- (desmarcar_os é o caminho de reverter). Espelha o padrão de idempotência dos outros _core.

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
    -- TECIDO agora TAMBÉM trava (antes não travava → baixa-fantasma negativa corrompia o
    -- estoque). Agrega o utilizado por variante (uma OS pode ter 2 itens da mesma variante).
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

select pg_notify('pgrst','reload schema');
