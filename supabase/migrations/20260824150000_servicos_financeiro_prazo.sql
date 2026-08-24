-- Task 2 (Etapas PL S3): servicos_financeiro() passa a gerar parcelas_servico
-- pelo split do prazo_pagamento do fornecedor (empresas.prazo_pagamento, ex.: "30/60/90")
-- em vez de uma data-base flat única, e devolve dias_offset por parcela no jsonb.
--
-- Correção crítica preservada: nenhuma parcela PAGA e nenhum vencimento EDITADO À MÃO
-- é jamais alterado ou apagado (ver DELETE + UPDATE WHERE abaixo).
--
-- CREATE OR REPLACE (nunca DROP — preserva ACL). Diff-validado contra o def vivo:
-- as ÚNICAS mudanças são (a) o bloco de sync trocado + empresa_id/numero_parcelas no
-- SELECT do loop, (b) as novas variáveis do DECLARE, (c) o campo dias_offset no SELECT final,
-- (d) [fix round 1] contagem efetiva n_eff (CROSS JOIN LATERAL) usada no output numero_parcelas,
--     no rateio do valor e na visibilidade — display ≡ geração quando o prazo dita a contagem.
-- Fallback sem prazo = DATA-BASE única (flat de sempre), não escalonado.
-- ACL: o gate de segurança segue = REVOKE de PUBLIC, anon (authenticated mantém EXECUTE:
-- o front — financeiro.tsx/HomeLogado.tsx — chama esta RPC como authenticated).

BEGIN;

CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
  v_prazo text; v_dias int[]; v_n int; v_base date; v_venc date; v_off int; i int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  FOR r IN
    SELECT pt.id, pt.cad_id, GREATEST(COALESCE(pt.numero_parcelas,1),1) AS n,
           pt.numero_parcelas, pt.empresa_id,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina, pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    WHERE COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
  LOOP
    IF (NOT r.is_oficina AND r.data_enviado IS NOT NULL AND r.data_entregue IS NOT NULL)
       OR (r.is_oficina AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = r.cad_id AND cq.status = 'confirmado'))
    THEN
      v_base := COALESCE(r.data_entregue, r.data_enviado);
      v_prazo := (SELECT prazo_pagamento FROM public.empresas WHERE id = r.empresa_id);
      v_dias := ARRAY(
        SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo,''),'[^0-9]+') AS t
        WHERE t ~ '^[0-9]+$'
      );
      IF array_length(v_dias,1) >= 1 THEN
        v_n := LEAST(array_length(v_dias,1), 24);
      ELSE
        -- Cap em 24 IGUAL ao n_eff do display (LEAST(...,24)): sem isso, um bloco sem prazo
        -- com numero_parcelas > 24 gera >24 parcelas mas o display mostra/divide por 24 —
        -- parcela a-pagar oculta reaparece só quando paga, inflando o total exibido (money path).
        v_n := LEAST(GREATEST(COALESCE(r.numero_parcelas,1), 1), 24);
      END IF;

      -- Deleta só parcelas NÃO pagas acima de v_n (nunca apaga paga).
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id
         AND ps.numero_parcela > v_n
         AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;

      -- Gera/atualiza 1..v_n preservando pagas e vencimentos editados à mão.
      FOR i IN 1..v_n LOOP
        -- Só escalona quando existe o i-ésimo prazo; sem prazo (ou índice além do array)
        -- cai na DATA-BASE única = comportamento flat de sempre (NÃO usar i*30).
        IF array_length(v_dias,1) >= i THEN v_venc := v_base + v_dias[i]; v_off := v_dias[i];
        ELSE v_venc := v_base; v_off := NULL; END IF;

        INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
        VALUES (v_tenant, r.id, i, v_venc)
        ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;

        -- Só corrige o vencimento de parcela a_pagar que AINDA está na data-base "crua"
        -- (nunca editada à mão, nunca paga). Preserva ajuste manual e pagas.
        UPDATE parcelas_servico ps
           SET data_vencimento = v_venc
         WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela = i
           AND ps.status <> 'pago' AND ps.data_pagamento IS NULL
           AND (ps.data_vencimento IS NULL OR ps.data_vencimento = v_base);
      END LOOP;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.data_entrega DESC NULLS LAST, t.servico, t.numero_parcela), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT ps.id AS parcela_id, ps.producao_terceirizado_id, ps.numero_parcela,
           neff.n_eff AS numero_parcelas,
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
           CASE WHEN ps.numero_parcela >= neff.n_eff
                THEN (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0))
                     - round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / neff.n_eff, 2) * (neff.n_eff - 1)
                ELSE round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / neff.n_eff, 2)
           END AS valor_parcela,
           pt.data_entregue AS data_entrega, ps.data_vencimento, ps.status, ps.data_pagamento, ps.comprovante_url,
           (ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'))[ps.numero_parcela] AS dias_offset
    FROM parcelas_servico ps
    JOIN producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN representantes rep ON rep.id = pt.representante_id
    LEFT JOIN empresas emp ON emp.id = pt.empresa_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    -- Contagem EFETIVA de parcelas (mesma lógica do v_n da geração): nº de prazos válidos
    -- em emp.prazo_pagamento (capado em 24, casando LEAST(...,24)); sem prazo → numero_parcelas.
    -- Usada no output numero_parcelas, no rateio do valor e na visibilidade — display ≡ geração.
    CROSS JOIN LATERAL (SELECT LEAST(GREATEST(
        COALESCE(NULLIF(array_length(ARRAY(SELECT 1 FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'),1),0),
                 GREATEST(COALESCE(pt.numero_parcelas,1),1)),
      1), 24) AS n_eff) neff
    WHERE ps.tenant_id = v_tenant
      AND COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
      -- parcela paga NUNCA some (mesmo fora da faixa efetiva n_eff)
      AND (ps.numero_parcela <= neff.n_eff OR ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
      -- bloco elegível OU que já tenha alguma parcela paga (não esconde dinheiro pago)
      AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
           OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado'))
           OR EXISTS (SELECT 1 FROM parcelas_servico ps2 WHERE ps2.producao_terceirizado_id = pt.id AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL)))
  ) t;

  RETURN v_out;
END;
$function$;

-- Gate de segurança (mesmo do hardening 20260717110000): PUBLIC e anon não executam;
-- authenticated MANTÉM EXECUTE (o front chama esta RPC como authenticated).
REVOKE EXECUTE ON FUNCTION public.servicos_financeiro() FROM PUBLIC, anon;

COMMIT;
