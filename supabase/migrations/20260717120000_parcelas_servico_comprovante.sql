-- Comprovante de pagamento nas parcelas de SERVIÇO (paridade com parcelas de OC):
-- o "Marcar pago" de Serviços passa a abrir o mesmo diálogo (data + comprovante
-- opcional). RLS/modgate de parcelas_servico já cobrem a coluna nova.
BEGIN;

ALTER TABLE public.parcelas_servico ADD COLUMN IF NOT EXISTS comprovante_url text;

-- servicos_financeiro retorna comprovante_url (única linha alterada: SELECT interno).
CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  FOR r IN
    SELECT pt.id, pt.cad_id, GREATEST(COALESCE(pt.numero_parcelas,1),1) AS n,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina, pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    WHERE COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
  LOOP
    IF (NOT r.is_oficina AND r.data_enviado IS NOT NULL AND r.data_entregue IS NOT NULL)
       OR (r.is_oficina AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = r.cad_id AND cq.status = 'confirmado'))
    THEN
      INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
      SELECT v_tenant, r.id, gs, COALESCE(r.data_entregue, r.data_enviado) FROM generate_series(1, r.n) gs
      ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;
      -- Garante a data-base nas parcelas ainda sem vencimento (não sobrescreve manual).
      UPDATE parcelas_servico ps SET data_vencimento = COALESCE(r.data_entregue, r.data_enviado)
       WHERE ps.producao_terceirizado_id = r.id AND ps.data_vencimento IS NULL
         AND COALESCE(r.data_entregue, r.data_enviado) IS NOT NULL;
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela > r.n
         AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.data_entrega DESC NULLS LAST, t.servico, t.numero_parcela), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT ps.id AS parcela_id, ps.producao_terceirizado_id, ps.numero_parcela,
           GREATEST(COALESCE(pt.numero_parcelas,1),1) AS numero_parcelas,
           COALESCE(ct.nome,'—') AS servico,
           COALESCE(rep.nome, emp.nome_fantasia, col.nome, '—') AS responsavel,
           COALESCE(rep.cnpj, emp.cnpj) AS responsavel_cnpj,
           emp.nome_fantasia AS empresa_nome, emp.cnpj AS empresa_cnpj,
           rep.nome AS representante_nome, rep.cnpj AS representante_cnpj,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina,
           m.ref, m.nome AS modelo_nome,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)) AS custo_bruto,
           COALESCE(pt.desconto_total,0) AS desconto, COALESCE(pt.multa_total,0) AS multa,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS custo_liquido,
           CASE WHEN ps.numero_parcela >= GREATEST(COALESCE(pt.numero_parcelas,1),1)
                THEN (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0))
                     - round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / GREATEST(COALESCE(pt.numero_parcelas,1),1), 2) * (GREATEST(COALESCE(pt.numero_parcelas,1),1) - 1)
                ELSE round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / GREATEST(COALESCE(pt.numero_parcelas,1),1), 2)
           END AS valor_parcela,
           pt.data_entregue AS data_entrega, ps.data_vencimento, ps.status, ps.data_pagamento, ps.comprovante_url
    FROM parcelas_servico ps
    JOIN producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN representantes rep ON rep.id = pt.representante_id
    LEFT JOIN empresas emp ON emp.id = pt.empresa_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    WHERE ps.tenant_id = v_tenant
      AND COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
      -- parcela paga NUNCA some (mesmo fora da faixa numero_parcelas)
      AND (ps.numero_parcela <= GREATEST(COALESCE(pt.numero_parcelas,1),1) OR ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
      -- bloco elegível OU que já tenha alguma parcela paga (não esconde dinheiro pago)
      AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
           OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado'))
           OR EXISTS (SELECT 1 FROM parcelas_servico ps2 WHERE ps2.producao_terceirizado_id = pt.id AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL)))
  ) t;

  RETURN v_out;
END;
$function$

;

COMMIT;
