-- Serviços (Terceirizados) no Financeiro (nova feature):
-- * numero_parcelas por bloco (default 1) — destrincha o serviço em N parcelas.
-- * tabela parcelas_servico: vencimento (manual)/status/pago por parcela.
-- * RPC servicos_financeiro(): sincroniza (cria N parcelas p/ serviço ELEGÍVEL) e lista
--   p/ a aba "Serviços". Elegível = bloco EXTERNO (interno=false, ativo) e:
--     - não-oficina: data_enviado E data_entregue preenchidas; OU
--     - oficina (categoria nome ~ 'oficina'): CQ do cad CONFIRMADO.
--   Custo: bruto = preço×qtd; líquido = bruto − desconto + multa; parcela = líquido/N.

ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS numero_parcelas int NOT NULL DEFAULT 1;
ALTER TABLE public.producao_terceirizados
  DROP CONSTRAINT IF EXISTS producao_terceirizados_numero_parcelas_check;
ALTER TABLE public.producao_terceirizados
  ADD CONSTRAINT producao_terceirizados_numero_parcelas_check CHECK (numero_parcelas >= 1);

CREATE TABLE IF NOT EXISTS public.parcelas_servico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  producao_terceirizado_id uuid NOT NULL REFERENCES public.producao_terceirizados(id) ON DELETE CASCADE,
  numero_parcela int NOT NULL,
  data_vencimento date,
  status text NOT NULL DEFAULT 'a_pagar',
  data_pagamento date,
  created_at timestamptz DEFAULT now(),
  UNIQUE (producao_terceirizado_id, numero_parcela)
);

ALTER TABLE public.parcelas_servico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parcelas_servico_tenant ON public.parcelas_servico;
CREATE POLICY parcelas_servico_tenant ON public.parcelas_servico
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  r record;
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- 1) Sincroniza parcelas dos blocos externos ELEGÍVEIS.
  FOR r IN
    SELECT pt.id, pt.cad_id, GREATEST(COALESCE(pt.numero_parcelas,1),1) AS n,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina,
           pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    WHERE COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
  LOOP
    IF (NOT r.is_oficina AND r.data_enviado IS NOT NULL AND r.data_entregue IS NOT NULL)
       OR (r.is_oficina AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = r.cad_id AND cq.status = 'confirmado'))
    THEN
      INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela)
      SELECT v_tenant, r.id, gs FROM generate_series(1, r.n) gs
      ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;
      -- remove parcelas extras (acima de N) que NÃO estão pagas (preserva pagas)
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id
         AND ps.numero_parcela > r.n
         AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;
    END IF;
  END LOOP;

  -- 2) Lista as parcelas dos serviços elegíveis.
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.data_entrega DESC NULLS LAST, t.servico, t.numero_parcela), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT ps.id AS parcela_id, ps.producao_terceirizado_id, ps.numero_parcela,
           GREATEST(COALESCE(pt.numero_parcelas,1),1) AS numero_parcelas,
           COALESCE(ct.nome,'—') AS servico,
           COALESCE(ter.nome_responsavel, col.nome, '—') AS responsavel,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina,
           m.ref, m.nome AS modelo_nome,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)) AS custo_bruto,
           COALESCE(pt.desconto_total,0) AS desconto,
           COALESCE(pt.multa_total,0) AS multa,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS custo_liquido,
           round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / GREATEST(COALESCE(pt.numero_parcelas,1),1), 2) AS valor_parcela,
           pt.data_entregue AS data_entrega,
           ps.data_vencimento, ps.status, ps.data_pagamento
    FROM parcelas_servico ps
    JOIN producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN terceirizados ter ON ter.id = pt.terceirizado_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    WHERE ps.tenant_id = v_tenant
      AND COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
      AND ps.numero_parcela <= GREATEST(COALESCE(pt.numero_parcelas,1),1)
      AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
           OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado')))
  ) t;

  RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.servicos_financeiro() FROM anon;
GRANT EXECUTE ON FUNCTION public.servicos_financeiro() TO authenticated;
