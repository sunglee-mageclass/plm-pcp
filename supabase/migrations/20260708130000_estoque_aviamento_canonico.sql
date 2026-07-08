-- M2: fonte ÚNICA para o estoque de aviamento.
--
-- Havia 2 definições divergentes (tela de Estoque × dashboard): status, cancelado,
-- null-recebida e OS entravam diferente — números batiam diferente pro mesmo aviamento.
-- Esta função canônica replica a definição da TELA (a correta) e passa a ser consumida
-- pelo dashboard, pela própria tela e pela trava de saldo da OS (OrdemSaidaPage).
--
-- Definição (por aviamento, escopo _tenant):
--   recebido  = Σ COALESCE(recebida, pedida, 0)  de OC status='recebido', não cancelada
--   prev_receb= Σ pedida                         de OC status='encomendado', não cancelada
--   baixa     = Σ CAD enviado ao corte (separar||enviar) + Σ OS já baixadas
--   reservado = Σ (consumo × grade) de modelos aprovados-sem-CAD + Σ OS abertas (reserva)
--   fisico    = max(0, recebido − baixa)          (físico não pode ser negativo)
--   previsto  = fisico + prev_receb − reservado   (pode ser negativo)

CREATE OR REPLACE FUNCTION public._estoque_aviamento_core(_tenant uuid)
RETURNS TABLE(
  id uuid, nome text, fornecedor_id uuid, fornecedor text,
  categoria_id uuid, categoria text,
  prev_receb numeric, recebido numeric, baixa numeric, reservado numeric,
  fisico numeric, previsto numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH
  rec AS (
    SELECT i.aviamento_id AS av, SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0)) AS tot
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = _tenant
    WHERE i.aviamento_id IS NOT NULL AND oc.status = 'recebido' AND COALESCE(i.cancelado, false) = false
    GROUP BY i.aviamento_id
  ),
  prev AS (
    SELECT i.aviamento_id AS av, SUM(COALESCE(i.quantidade_pedida, 0)) AS tot
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = _tenant
    WHERE i.aviamento_id IS NOT NULL AND oc.status = 'encomendado' AND COALESCE(i.cancelado, false) = false
    GROUP BY i.aviamento_id
  ),
  baixa_cad AS (
    SELECT ca.aviamento_id AS av, SUM(COALESCE(NULLIF(ca.quantidade_separar, 0), ca.quantidade_enviar, 0)) AS tot
    FROM cad_aviamentos ca
    JOIN cad c ON c.id = ca.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
    WHERE ca.aviamento_id IS NOT NULL
    GROUP BY ca.aviamento_id
  ),
  os_baixa AS (
    SELECT oi.aviamento_id AS av, SUM(COALESCE(oi.baixa, 0)) AS tot
    FROM ordens_saida_aviamento_itens oi
    JOIN ordens_saida_aviamento os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
    WHERE oi.aviamento_id IS NOT NULL
    GROUP BY oi.aviamento_id
  ),
  os_reserva AS (
    SELECT oi.aviamento_id AS av, SUM(COALESCE(oi.reserva, 0)) AS tot
    FROM ordens_saida_aviamento_itens oi
    JOIN ordens_saida_aviamento os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND NOT os.baixado
    WHERE oi.aviamento_id IS NOT NULL
    GROUP BY oi.aviamento_id
  ),
  mod_grade AS (
    SELECT modelo_id, SUM(COALESCE(grade_total, 0)) AS gt FROM modelo_grades GROUP BY modelo_id
  ),
  aprovado_nao_cad AS (
    SELECT m.id FROM modelos m
    WHERE m.tenant_id = _tenant
      AND lower(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
      AND NOT EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
  ),
  reserva_modelo AS (
    SELECT ma.aviamento_id AS av, SUM(COALESCE(ma.consumo, 0) * COALESCE(mg.gt, 0)) AS tot
    FROM modelo_aviamentos ma
    JOIN aprovado_nao_cad anc ON anc.id = ma.modelo_id
    LEFT JOIN mod_grade mg ON mg.modelo_id = ma.modelo_id
    WHERE ma.aviamento_id IS NOT NULL
    GROUP BY ma.aviamento_id
  ),
  agg AS (
    SELECT
      a.id,
      a.codigo_nome::text AS nome,
      a.empresa_id AS fornecedor_id,
      COALESCE(e.nome_fantasia, '—')::text AS fornecedor,
      a.categoria_aviamento_id AS categoria_id,
      cav.nome::text AS categoria,
      COALESCE(prev.tot, 0) AS prev_receb,
      COALESCE(rec.tot, 0) AS recebido,
      COALESCE(bc.tot, 0) + COALESCE(ob.tot, 0) AS baixa,
      COALESCE(rm.tot, 0) + COALESCE(orr.tot, 0) AS reservado
    FROM aviamentos a
    LEFT JOIN empresas e ON e.id = a.empresa_id
    LEFT JOIN categorias_aviamento cav ON cav.id = a.categoria_aviamento_id
    LEFT JOIN rec ON rec.av = a.id
    LEFT JOIN prev ON prev.av = a.id
    LEFT JOIN baixa_cad bc ON bc.av = a.id
    LEFT JOIN os_baixa ob ON ob.av = a.id
    LEFT JOIN os_reserva orr ON orr.av = a.id
    LEFT JOIN reserva_modelo rm ON rm.av = a.id
    WHERE a.tenant_id = _tenant
  )
  SELECT
    agg.id, agg.nome, agg.fornecedor_id, agg.fornecedor, agg.categoria_id, agg.categoria,
    agg.prev_receb, agg.recebido, agg.baixa, agg.reservado,
    GREATEST(0, agg.recebido - agg.baixa) AS fisico,
    GREATEST(0, agg.recebido - agg.baixa) + agg.prev_receb - agg.reservado AS previsto
  FROM agg
$function$;

-- Wrapper: resolve o tenant do chamador + gate de módulo (invariante #9). O _core fica
-- sem EXECUTE p/ anon/authenticated (só o wrapper e outras funções DEFINER — ex.: o
-- dashboard — chamam o _core, sempre com o tenant certo).
CREATE OR REPLACE FUNCTION public.estoque_aviamento()
RETURNS TABLE(
  id uuid, nome text, fornecedor_id uuid, fornecedor text,
  categoria_id uuid, categoria text,
  prev_receb numeric, recebido numeric, baixa numeric, reservado numeric,
  fisico numeric, previsto numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_aviamento_core(public.get_user_tenant_id());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._estoque_aviamento_core(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estoque_aviamento() TO authenticated;
