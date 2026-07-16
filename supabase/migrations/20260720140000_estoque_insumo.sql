-- Fase 2c — Estoque de Insumo. Físico por variante = recebido (OC) − baixa (consumo no CAD).
-- Baixa por variante: enviar_por_tamanho (por tamanho) casado por (etiqueta, tamanho, cor); e o
-- caso sem tamanho (quantidade_enviar) casado pela variante (etiqueta, tamanho NULL, cor).
-- Wrapper + core (invariante #9): core revogado; wrapper gateia entrada_saida.

CREATE OR REPLACE FUNCTION public._estoque_etiqueta_core(_tenant uuid)
 RETURNS TABLE(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text,
               recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  rec AS (
    SELECT i.etiqueta_id, i.variante_etiqueta_id AS var, SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0)) AS tot
    FROM ocs_etiqueta_itens i JOIN ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant
    WHERE o.status = 'recebido' AND COALESCE(i.cancelado, false) = false
    GROUP BY 1, 2
  ),
  prev AS (
    SELECT i.etiqueta_id, i.variante_etiqueta_id AS var, SUM(COALESCE(i.quantidade_pedida, 0)) AS tot
    FROM ocs_etiqueta_itens i JOIN ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant
    WHERE o.status = 'encomendado' AND COALESCE(i.cancelado, false) = false
    GROUP BY 1, 2
  ),
  baixa_var AS (  -- consumo por tamanho (enviar_por_tamanho) → variante (etiqueta,tamanho,cor)
    SELECT v.etiqueta_id, v.id AS var, SUM((kv.value)::numeric) AS tot
    FROM cad_etiquetas ce
    JOIN cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
    JOIN LATERAL jsonb_each_text(COALESCE(ce.enviar_por_tamanho, '{}'::jsonb)) kv ON true
    JOIN variantes_etiqueta v ON v.etiqueta_id = ce.etiqueta_id AND v.tamanho = kv.key AND v.cor_id IS NOT DISTINCT FROM ce.cor_id
    GROUP BY 1, 2
  ),
  baixa_sem AS (  -- consumo sem tamanho (quantidade_enviar) → variante (etiqueta,tamanho NULL,cor) ou etiqueta
    SELECT ce.etiqueta_id, v.id AS var, SUM(COALESCE(ce.quantidade_enviar, 0)) AS tot
    FROM cad_etiquetas ce
    JOIN cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
    LEFT JOIN variantes_etiqueta v ON v.etiqueta_id = ce.etiqueta_id AND v.tamanho IS NULL AND v.cor_id IS NOT DISTINCT FROM ce.cor_id
    WHERE COALESCE(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
    GROUP BY 1, v.id
  ),
  baixa AS (
    SELECT etiqueta_id, var, SUM(tot) AS tot
    FROM (SELECT * FROM baixa_var UNION ALL SELECT * FROM baixa_sem) x
    GROUP BY 1, 2
  ),
  keys AS (
    SELECT etiqueta_id, var FROM rec
    UNION SELECT etiqueta_id, var FROM prev
    UNION SELECT etiqueta_id, var FROM baixa
  )
  SELECT k.etiqueta_id, e.nome::text, k.var, ve.tamanho, cor.nome::text,
         COALESCE(rec.tot, 0), COALESCE(prev.tot, 0), COALESCE(baixa.tot, 0),
         COALESCE(rec.tot, 0) - COALESCE(baixa.tot, 0)
  FROM keys k
  JOIN etiquetas e ON e.id = k.etiqueta_id AND e.tenant_id = _tenant
  LEFT JOIN variantes_etiqueta ve ON ve.id = k.var
  LEFT JOIN cores cor ON cor.id = ve.cor_id
  LEFT JOIN rec  ON rec.etiqueta_id  = k.etiqueta_id AND rec.var  IS NOT DISTINCT FROM k.var
  LEFT JOIN prev ON prev.etiqueta_id = k.etiqueta_id AND prev.var IS NOT DISTINCT FROM k.var
  LEFT JOIN baixa ON baixa.etiqueta_id = k.etiqueta_id AND baixa.var IS NOT DISTINCT FROM k.var
  ORDER BY e.nome, ve.tamanho NULLS FIRST;
$function$;

REVOKE EXECUTE ON FUNCTION public._estoque_etiqueta_core(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._estoque_etiqueta_core(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._estoque_etiqueta_core(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.estoque_etiqueta()
 RETURNS TABLE(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text,
               recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_etiqueta_core(v_tenant);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.estoque_etiqueta() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.estoque_etiqueta() FROM anon;
GRANT  EXECUTE ON FUNCTION public.estoque_etiqueta() TO authenticated;

select pg_notify('pgrst','reload schema');
